//! Túnel até o PC: o studio do PC abre um WebSocket de saída para cá (sem porta aberta no roteador) e os
//! pedidos HTTP da interface passam por ele, vários ao mesmo tempo, cada um com um número.
//!
//! Quadro binário: [tipo u8][id u32 BE][dados]
//!   1 REQ_HEAD  {"m","p","h"}   2 REQ_BODY   3 REQ_END
//!   4 RES_HEAD  {"s","h"}       5 RES_BODY   6 RES_END   7 RES_ERR (texto)
//!   8 CANCEL (quem pediu desistiu: a interface fechou ou parou)

use crate::{err, H};
use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::Response;
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

pub const REQ_HEAD: u8 = 1;
pub const REQ_BODY: u8 = 2;
pub const REQ_END: u8 = 3;
pub const RES_HEAD: u8 = 4;
pub const RES_BODY: u8 = 5;
pub const RES_END: u8 = 6;
pub const RES_ERR: u8 = 7;
pub const CANCEL: u8 = 8;
/// do PC: manda uma notificação para os celulares da conta
pub const NOTIFY: u8 = 9;
const CHUNK: usize = 256 * 1024;

pub fn frame(kind: u8, id: u32, data: &[u8]) -> Vec<u8> {
    let mut v = Vec::with_capacity(5 + data.len());
    v.push(kind);
    v.extend_from_slice(&id.to_be_bytes());
    v.extend_from_slice(data);
    v
}

enum Ev {
    Head(u16, Vec<(String, String)>),
    Body(Bytes),
    End,
    Err(String),
}

pub struct Link {
    pub name: String,
    pub device: i64,
    pub since: Instant,
    tx: mpsc::UnboundedSender<Message>,
    pending: Mutex<HashMap<u32, mpsc::UnboundedSender<Ev>>>,
    next: AtomicU32,
    closed: AtomicBool,
}

impl Link {
    fn send(&self, kind: u8, id: u32, data: &[u8]) -> bool {
        self.tx.send(Message::Binary(frame(kind, id, data).into())).is_ok()
    }
    pub fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        let _ = self.tx.send(Message::Close(None));
    }
    fn fail_all(&self, why: &str) {
        for (_, tx) in self.pending.lock().unwrap().drain() {
            let _ = tx.send(Ev::Err(why.to_string()));
        }
    }
}

fn bearer(headers: &HeaderMap) -> Option<String> {
    headers.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).map(|s| s.trim().to_string())
}

/// O PC se conecta aqui com o token que recebeu ao se vincular.
pub async fn ws(State(h): State<H>, headers: HeaderMap, up: WebSocketUpgrade) -> Response {
    let Some(tok) = bearer(&headers) else { return err(StatusCode::UNAUTHORIZED, "token") };
    let Some((u, device, name)) = crate::db::user_by_device(&h.db.lock().unwrap(), &tok) else { return err(StatusCode::UNAUTHORIZED, "token") };
    up.max_message_size(64 << 20).on_upgrade(move |sock| run(h, u.id, device, name, sock))
}

async fn run(h: H, uid: i64, device: i64, name: String, sock: WebSocket) {
    let (mut sink, mut stream) = sock.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    let link = Arc::new(Link { name, device, since: Instant::now(), tx: tx.clone(), pending: Mutex::new(HashMap::new()), next: AtomicU32::new(1), closed: AtomicBool::new(false) });
    // um PC por conta: o novo assume
    if let Some(old) = h.links.lock().unwrap().insert(uid, link.clone()) {
        old.fail_all("outro PC assumiu");
        old.close();
    }
    let writer = tokio::spawn(async move {
        while let Some(m) = rx.recv().await {
            let close = matches!(m, Message::Close(_));
            if sink.send(m).await.is_err() || close {
                break;
            }
        }
        let _ = sink.close().await;
    });
    let pinger = {
        let tx = tx.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(20)).await;
                if tx.send(Message::Ping(Bytes::from_static(b"hub"))).is_err() {
                    break;
                }
            }
        })
    };
    // sem nada do PC por 60 s (nem o pong): caiu
    while let Ok(Some(Ok(m))) = tokio::time::timeout(Duration::from_secs(60), stream.next()).await {
        let Message::Binary(b) = m else {
            if matches!(m, Message::Close(_)) {
                break;
            }
            continue;
        };
        if b.len() < 5 {
            continue;
        }
        let kind = b[0];
        let id = u32::from_be_bytes([b[1], b[2], b[3], b[4]]);
        let data = b.slice(5..);
        if kind == NOTIFY {
            let v: Value = serde_json::from_slice(&data).unwrap_or_default();
            let h2 = h.clone();
            tokio::spawn(async move { crate::push::send(&h2, uid, &crate::push::clean(&v)).await });
            continue;
        }
        let ev = match kind {
            RES_HEAD => {
                let v: Value = serde_json::from_slice(&data).unwrap_or_default();
                let hs = v["h"].as_array().map(|a| a.iter().filter_map(|p| Some((p[0].as_str()?.to_string(), p[1].as_str()?.to_string()))).collect()).unwrap_or_default();
                Ev::Head(v["s"].as_u64().unwrap_or(502) as u16, hs)
            }
            RES_BODY => Ev::Body(data),
            RES_END => Ev::End,
            RES_ERR => Ev::Err(String::from_utf8_lossy(&data).to_string()),
            _ => continue,
        };
        let done = matches!(ev, Ev::End | Ev::Err(_));
        let mut p = link.pending.lock().unwrap();
        if let Some(tx) = p.get(&id) {
            let _ = tx.send(ev);
        }
        if done {
            p.remove(&id);
        }
    }
    pinger.abort();
    link.fail_all("O PC desconectou.");
    {
        let mut links = h.links.lock().unwrap();
        if links.get(&uid).is_some_and(|l| Arc::ptr_eq(l, &link)) {
            links.remove(&uid);
        }
    }
    let _ = tx.send(Message::Close(None));
    let _ = writer.await;
}

/// Avisa o PC se a resposta for abandonada no meio (a interface fechou a conexão ou clicou em parar).
struct Guard {
    link: Arc<Link>,
    id: u32,
    done: bool,
}

impl Drop for Guard {
    fn drop(&mut self) {
        self.link.pending.lock().unwrap().remove(&self.id);
        if !self.done {
            self.link.send(CANCEL, self.id, &[]);
        }
    }
}

pub async fn forward(link: &Arc<Link>, req: Request) -> Response {
    let id = link.next.fetch_add(1, Ordering::Relaxed);
    let (etx, mut erx) = mpsc::unbounded_channel();
    link.pending.lock().unwrap().insert(id, etx);
    let mut guard = Guard { link: link.clone(), id, done: false };
    let (parts, body) = req.into_parts();
    let p = parts.uri.path_and_query().map(|p| p.as_str().to_string()).unwrap_or_else(|| "/".into());
    let hs: Vec<(String, String)> = parts.headers.iter().filter(|(k, _)| !crate::skip_header(k.as_str())).filter_map(|(k, v)| Some((k.as_str().to_string(), v.to_str().ok()?.to_string()))).collect();
    if !link.send(REQ_HEAD, id, json!({ "m": parts.method.as_str(), "p": p, "h": hs }).to_string().as_bytes()) {
        return err(StatusCode::BAD_GATEWAY, "O PC desconectou.");
    }
    // o corpo vai em pedaços enquanto chega
    let l2 = link.clone();
    tokio::spawn(async move {
        let mut s = body.into_data_stream();
        while let Some(c) = s.next().await {
            match c {
                Ok(c) => {
                    for part in c.chunks(CHUNK) {
                        if !l2.send(REQ_BODY, id, part) {
                            return;
                        }
                    }
                }
                Err(_) => {
                    l2.send(CANCEL, id, &[]);
                    return;
                }
            }
        }
        l2.send(REQ_END, id, &[]);
    });
    let first = tokio::time::timeout(Duration::from_secs(30 * 60), erx.recv()).await;
    let (status, hs) = match first {
        Ok(Some(Ev::Head(s, hs))) => (s, hs),
        Ok(Some(Ev::Err(e))) => {
            guard.done = true;
            return err(StatusCode::BAD_GATEWAY, &e);
        }
        _ => return err(StatusCode::GATEWAY_TIMEOUT, "O PC não respondeu."),
    };
    let stream = async_stream(erx, guard);
    let mut r = Response::new(Body::from_stream(stream));
    *r.status_mut() = StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
    for (k, v) in hs {
        if crate::skip_header(&k.to_lowercase()) {
            continue;
        }
        if let (Ok(k), Ok(v)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(&v)) {
            r.headers_mut().append(k, v);
        }
    }
    r
}

fn async_stream(rx: mpsc::UnboundedReceiver<Ev>, guard: Guard) -> impl futures_util::Stream<Item = Result<Bytes, std::io::Error>> + Send {
    futures_util::stream::unfold((rx, guard), |(mut rx, mut g)| async move {
        match rx.recv().await {
            Some(Ev::Body(b)) => Some((Ok(b), (rx, g))),
            Some(Ev::Err(e)) => {
                g.done = true;
                Some((Err(std::io::Error::other(e)), (rx, g)))
            }
            Some(Ev::Head(..)) => Some((Ok(Bytes::new()), (rx, g))),
            Some(Ev::End) | None => {
                g.done = true;
                drop(g);
                None
            }
        }
    })
    .fuse()
}
