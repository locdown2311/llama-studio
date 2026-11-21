//! Ligação do PC com a conta na nuvem (studio-hub).
//!
//! - O PC abre um WebSocket de saída para a central (nada de porta aberta no roteador). Enquanto ele está
//!   conectado, quem abre o studio pelo celular ou por outro navegador usa este PC: modelo local, ferramentas,
//!   arquivos, tudo. Os pedidos chegam pelo túnel e são feitos aqui mesmo, no 127.0.0.1.
//! - Sincroniza o que a interface guarda (conversas, projetos, personalidades) com a conta: a cópia mais
//!   nova vence e o que foi apagado não volta.
//! - Vincular troca e-mail e senha por um token deste PC; a senha não fica guardada.
//!
//! Quadro do túnel: [tipo u8][id u32 BE][dados] (o mesmo da central, hub/src/link.rs).

use crate::app::App;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

const REQ_HEAD: u8 = 1;
const REQ_BODY: u8 = 2;
const REQ_END: u8 = 3;
const RES_HEAD: u8 = 4;
const RES_BODY: u8 = 5;
const RES_END: u8 = 6;
const RES_ERR: u8 = 7;
const CANCEL: u8 = 8;
const NOTIFY: u8 = 9;
const CHUNK: usize = 256 * 1024;
/// Corpo de pedido maior que isso pelo túnel é recusado.
const MAX_BODY: usize = 200 * 1024 * 1024;

pub static PORT: OnceLock<u16> = OnceLock::new();

/// O túnel aberto agora (para mandar notificações à central).
fn link_tx() -> &'static Mutex<Option<mpsc::UnboundedSender<Message>>> {
    static T: OnceLock<Mutex<Option<mpsc::UnboundedSender<Message>>>> = OnceLock::new();
    T.get_or_init(Default::default)
}

/// Notificação no celular (Web Push pela central): do contêiner direto para a central; do PC pelo túnel.
pub async fn notify(app: &App, title: &str, body: &str, url: &str) {
    let v = json!({ "title": title, "body": body, "url": url });
    if crate::app::cloud() {
        let (Ok(hub), Some(secret)) = (std::env::var("STUDIO_HUB_URL"), crate::app::hub_secret()) else { return };
        let _ = local().post(format!("{}/hub/internal/notify", hub.trim_end_matches('/'))).header("x-hub-secret", secret).header("content-type", "application/json").body(v.to_string()).timeout(Duration::from_secs(10)).send().await;
        return;
    }
    let _ = app;
    if let Some(tx) = link_tx().lock().unwrap().as_ref() {
        let _ = tx.send(frame(NOTIFY, 0, v.to_string().as_bytes()));
    }
}

#[derive(Default)]
struct St {
    connected: bool,
    since: Option<Instant>,
    error: String,
    last_sync: Option<Instant>,
    synced: (usize, usize),
    requests: u64,
}

fn st() -> &'static Mutex<St> {
    static S: OnceLock<Mutex<St>> = OnceLock::new();
    S.get_or_init(Default::default)
}

fn wake() -> &'static tokio::sync::Notify {
    static N: OnceLock<tokio::sync::Notify> = OnceLock::new();
    N.get_or_init(tokio::sync::Notify::new)
}

pub fn status(app: &App) -> Value {
    let c = app.cfg().cloud;
    let s = st().lock().unwrap();
    json!({
        "url": c.url,
        "email": c.email,
        "device": c.device,
        "linked": !c.token.is_empty(),
        "enabled": c.enabled,
        "connected": s.connected,
        "secs": s.since.map(|t| t.elapsed().as_secs()),
        "error": s.error,
        "syncAgo": s.last_sync.map(|t| t.elapsed().as_secs()),
        "pulled": s.synced.0,
        "pushed": s.synced.1,
        "requests": s.requests,
    })
}

fn base(url: &str) -> String {
    let u = url.trim().trim_end_matches('/');
    if u.starts_with("http://") || u.starts_with("https://") { u.to_string() } else { format!("https://{u}") }
}

fn web() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| reqwest::Client::builder().timeout(Duration::from_secs(60)).user_agent("Llama-Studio").build().expect("http"))
}

fn local() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| reqwest::Client::builder().no_proxy().pool_idle_timeout(Duration::from_secs(20)).build().expect("http"))
}

/// Vincula este PC à conta (e-mail e senha só passam por aqui, para a central devolver o token).
pub async fn link(app: &App, url: &str, email: &str, password: &str, code: &str, device: &str) -> Result<(), String> {
    let b = base(url);
    if b.starts_with("http://") && !b.contains("://127.0.0.1") && !b.contains("://localhost") {
        return Err(L!("Use https:// (a senha e o acesso ao PC não podem trafegar sem criptografia).", "Use https:// (your password and PC access must not travel unencrypted).").into());
    }
    let device = if device.trim().is_empty() { hostname() } else { device.trim().to_string() };
    let r = web()
        .post(format!("{b}/hub/api/pair"))
        .header("content-type", "application/json")
        .body(json!({ "email": email.trim(), "password": password, "code": code.trim(), "name": device }).to_string())
        .send()
        .await
        .map_err(|e| LF!("Não consegui falar com a nuvem: {e}", "Couldn't reach the cloud: {e}"))?;
    let ok = r.status().is_success();
    let v: Value = r.bytes().await.ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    if !ok {
        return Err(v["error"].as_str().unwrap_or("erro").to_string());
    }
    let tok = v["token"].as_str().unwrap_or("").to_string();
    if tok.len() < 32 {
        return Err("token".into());
    }
    {
        let mut c = app.config.write().unwrap();
        c.cloud.url = b;
        c.cloud.token = tok;
        c.cloud.device = device;
        c.cloud.email = email.trim().to_lowercase();
        c.cloud.enabled = true;
    }
    app.save_config();
    wake().notify_waiters();
    Ok(())
}

pub fn set_enabled(app: &App, on: bool) {
    app.config.write().unwrap().cloud.enabled = on;
    app.save_config();
    wake().notify_waiters();
}

pub fn unlink(app: &App) {
    {
        let mut c = app.config.write().unwrap();
        c.cloud.token.clear();
        c.cloud.enabled = false;
    }
    app.save_config();
    wake().notify_waiters();
}

fn hostname() -> String {
    std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).ok().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "PC".into())
}

/// Fica conectado enquanto houver vínculo e ele estiver ligado; reconecta sozinho.
pub async fn run(app: Arc<App>) {
    if crate::app::cloud() {
        return;
    }
    let mut backoff = 2u64;
    loop {
        let c = app.cfg().cloud;
        if c.token.is_empty() || !c.enabled {
            {
                let mut s = st().lock().unwrap();
                s.connected = false;
                s.since = None;
            }
            wake().notified().await;
            continue;
        }
        let t0 = Instant::now();
        let r = session(&app, &c.url, &c.token).await;
        {
            let mut s = st().lock().unwrap();
            s.connected = false;
            s.since = None;
            if let Err(e) = &r {
                s.error = e.clone();
            }
        }
        // ficou conectado um bom tempo: volta rápido; senão espera cada vez mais (até 1 min)
        backoff = if t0.elapsed() > Duration::from_secs(60) { 2 } else { (backoff * 2).min(60) };
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(backoff)) => {}
            _ = wake().notified() => {}
        }
    }
}

fn frame(kind: u8, id: u32, data: &[u8]) -> Message {
    let mut v = Vec::with_capacity(5 + data.len());
    v.push(kind);
    v.extend_from_slice(&id.to_be_bytes());
    v.extend_from_slice(data);
    Message::Binary(v.into())
}

struct Pending {
    head: Value,
    body: Vec<u8>,
}

async fn session(app: &Arc<App>, url: &str, token: &str) -> Result<(), String> {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let ws_url = base(url).replacen("https://", "wss://", 1).replacen("http://", "ws://", 1) + "/hub/link";
    let mut req = ws_url.as_str().into_client_request().map_err(|e| e.to_string())?;
    req.headers_mut().insert("authorization", format!("Bearer {token}").parse().map_err(|_| "token")?);
    let (ws, _) = tokio::time::timeout(Duration::from_secs(20), tokio_tungstenite::connect_async(req))
        .await
        .map_err(|_| L!("A nuvem não respondeu.", "The cloud didn't answer.").to_string())?
        .map_err(|e| {
            let s = e.to_string();
            if s.contains("401") { L!("O vínculo deste PC foi removido. Vincule de novo.", "This PC was unlinked. Link it again.").to_string() } else { s }
        })?;
    {
        let mut s = st().lock().unwrap();
        s.connected = true;
        s.since = Some(Instant::now());
        s.error.clear();
    }
    let (mut sink, mut stream) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    *link_tx().lock().unwrap() = Some(tx.clone());
    let writer = tokio::spawn(async move {
        while let Some(m) = rx.recv().await {
            if sink.send(m).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });
    // sincroniza ao conectar e a cada 30 s
    let syncer = {
        let app = app.clone();
        let (url, token) = (url.to_string(), token.to_string());
        tokio::spawn(async move {
            loop {
                if let Ok(n) = sync(&app, &url, &token).await {
                    let mut s = st().lock().unwrap();
                    s.last_sync = Some(Instant::now());
                    s.synced = n;
                }
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
        })
    };
    let mut pending: HashMap<u32, Pending> = HashMap::new();
    let running: Arc<Mutex<HashMap<u32, tokio::task::AbortHandle>>> = Default::default();
    let port = *PORT.get().unwrap_or(&app.cfg().port);
    let mut stop = false;
    // sem nada da central por 75 s (ela manda ping a cada 20): caiu
    let mut res: Result<(), String> = Ok(());
    while !stop {
        let next = tokio::select! {
            m = tokio::time::timeout(Duration::from_secs(75), stream.next()) => m,
            _ = wake().notified() => { stop = true; continue; }
        };
        let m = match next {
            Ok(Some(Ok(m))) => m,
            Ok(Some(Err(e))) => {
                res = Err(e.to_string());
                break;
            }
            Ok(None) => break,
            Err(_) => {
                res = Err(L!("A conexão com a nuvem ficou muda.", "The cloud connection went silent.").into());
                break;
            }
        };
        let b = match m {
            Message::Binary(b) => b,
            Message::Ping(p) => {
                let _ = tx.send(Message::Pong(p));
                continue;
            }
            Message::Close(_) => break,
            _ => continue,
        };
        if b.len() < 5 {
            continue;
        }
        let kind = b[0];
        let id = u32::from_be_bytes([b[1], b[2], b[3], b[4]]);
        let data = &b[5..];
        match kind {
            REQ_HEAD => {
                pending.insert(id, Pending { head: serde_json::from_slice(data).unwrap_or_default(), body: vec![] });
            }
            REQ_BODY => {
                if let Some(p) = pending.get_mut(&id) {
                    if p.body.len() + data.len() > MAX_BODY {
                        pending.remove(&id);
                        let _ = tx.send(frame(RES_ERR, id, b"corpo grande demais"));
                    } else {
                        p.body.extend_from_slice(data);
                    }
                }
            }
            REQ_END => {
                if let Some(p) = pending.remove(&id) {
                    st().lock().unwrap().requests += 1;
                    let tx = tx.clone();
                    let running2 = running.clone();
                    let h = tokio::spawn(async move {
                        serve(port, id, p, &tx).await;
                        running2.lock().unwrap().remove(&id);
                    });
                    running.lock().unwrap().insert(id, h.abort_handle());
                }
            }
            CANCEL => {
                pending.remove(&id);
                if let Some(h) = running.lock().unwrap().remove(&id) {
                    h.abort();
                }
            }
            _ => {}
        }
    }
    syncer.abort();
    *link_tx().lock().unwrap() = None;
    for (_, h) in running.lock().unwrap().drain() {
        h.abort();
    }
    let _ = tx.send(Message::Close(None));
    drop(tx);
    let _ = writer.await;
    res
}

/// Faz aqui no PC o pedido que veio pelo túnel e devolve a resposta em pedaços (o streaming do chat passa
/// do mesmo jeito). Se a outra ponta desistir, a tarefa é abortada e a conexão local cai junto.
async fn serve(port: u16, id: u32, p: Pending, tx: &mpsc::UnboundedSender<Message>) {
    let method = reqwest::Method::from_bytes(p.head["m"].as_str().unwrap_or("GET").as_bytes()).unwrap_or(reqwest::Method::GET);
    let path = p.head["p"].as_str().unwrap_or("/");
    if !path.starts_with('/') {
        let _ = tx.send(frame(RES_ERR, id, b"caminho"));
        return;
    }
    let mut rb = local().request(method, format!("http://127.0.0.1:{port}{path}")).timeout(Duration::from_secs(45 * 60));
    for h in p.head["h"].as_array().into_iter().flatten() {
        let (Some(k), Some(v)) = (h[0].as_str(), h[1].as_str()) else { continue };
        let kl = k.to_ascii_lowercase();
        if matches!(kl.as_str(), "host" | "connection" | "content-length" | "transfer-encoding" | "cookie" | "origin" | "referer" | "accept-encoding") {
            continue;
        }
        rb = rb.header(k, v);
    }
    let resp = match rb.body(p.body).send().await {
        Ok(r) => r,
        Err(e) => {
            let _ = tx.send(frame(RES_ERR, id, e.to_string().as_bytes()));
            return;
        }
    };
    let hs: Vec<(String, String)> = resp.headers().iter().filter_map(|(k, v)| Some((k.as_str().to_string(), v.to_str().ok()?.to_string()))).collect();
    let _ = tx.send(frame(RES_HEAD, id, json!({ "s": resp.status().as_u16(), "h": hs }).to_string().as_bytes()));
    let mut s = resp.bytes_stream();
    while let Some(c) = s.next().await {
        match c {
            Ok(c) => {
                for part in c.chunks(CHUNK) {
                    if tx.send(frame(RES_BODY, id, part)).is_err() {
                        return;
                    }
                }
            }
            Err(e) => {
                let _ = tx.send(frame(RES_ERR, id, e.to_string().as_bytes()));
                return;
            }
        }
    }
    let _ = tx.send(frame(RES_END, id, &[]));
}

/// Manda as APIs deste PC (com as chaves) para o studio da nuvem da conta.
pub async fn push_apis(app: &App) -> Result<Value, String> {
    let c = app.cfg();
    if c.cloud.token.is_empty() {
        return Err(L!("Este PC não está vinculado.", "This PC isn't linked.").into());
    }
    let list = serde_json::to_value(&c.api_providers).map_err(|e| e.to_string())?;
    let r = web()
        .post(format!("{}/hub/sync/apis", base(&c.cloud.url)))
        .header("authorization", format!("Bearer {}", c.cloud.token))
        .header("content-type", "application/json")
        .body(json!({ "apiProviders": list }).to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let ok = r.status().is_success();
    let v: Value = r.bytes().await.ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    if !ok {
        return Err(v["error"].as_str().unwrap_or("erro").to_string());
    }
    Ok(v)
}

/// Acerta as duas cópias: a mais nova de cada chave vence; lápides apagam do outro lado.
/// Devolve (trazidas, enviadas).
pub async fn sync(app: &App, url: &str, token: &str) -> Result<(usize, usize), String> {
    let b = base(url);
    let auth = format!("Bearer {token}");
    let remote: Value = web().get(format!("{b}/hub/sync/index")).header("authorization", &auth).send().await.map_err(|e| e.to_string())?.bytes().await.ok().and_then(|b| serde_json::from_slice(&b).ok()).ok_or("índice")?;
    let r_items: HashMap<String, u64> = remote["items"].as_object().map(|o| o.iter().filter_map(|(k, v)| Some((k.clone(), v.as_u64()?))).collect()).unwrap_or_default();
    let r_tombs: HashMap<String, u64> = remote["tombs"].as_object().map(|o| o.iter().filter_map(|(k, v)| Some((k.clone(), v.as_u64()?))).collect()).unwrap_or_default();
    let l_items = crate::uistate::index(app);
    let l_tombs: HashMap<String, u64> = crate::uistate::tombs(app).into_iter().filter_map(|(k, v)| Some((k, v.as_u64()?))).collect();
    let mut keys: Vec<&String> = r_items.keys().chain(r_tombs.keys()).chain(l_items.keys()).chain(l_tombs.keys()).collect();
    keys.sort();
    keys.dedup();
    let (mut pulled, mut pushed) = (0, 0);
    for k in keys {
        if !crate::uistate::valid_key(k) {
            continue;
        }
        let (li, lt) = (l_items.get(k).copied().unwrap_or(0), l_tombs.get(k).copied().unwrap_or(0));
        let (ri, rt) = (r_items.get(k).copied().unwrap_or(0), r_tombs.get(k).copied().unwrap_or(0));
        let (local, remote) = (li.max(lt), ri.max(rt));
        if local > remote {
            let body = if li >= lt {
                let Some(v) = crate::uistate::get(app, k) else { continue };
                json!({ "k": k, "t": li, "v": v["v"] })
            } else if ri > 0 {
                json!({ "k": k, "t": lt, "del": true })
            } else {
                continue;
            };
            let r = web().post(format!("{b}/hub/sync/item")).header("authorization", &auth).header("content-type", "application/json").body(body.to_string()).send().await.map_err(|e| e.to_string())?;
            if r.status().is_success() {
                pushed += 1;
            }
        } else if remote > local {
            if ri >= rt {
                let r = web().get(format!("{b}/hub/sync/item?k={k}")).header("authorization", &auth).send().await.map_err(|e| e.to_string())?;
                if let Some(v) = r.bytes().await.ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) {
                    if let Some(t) = v["t"].as_u64() {
                        if crate::uistate::put(app, k, t, &v["v"]).unwrap_or(false) {
                            pulled += 1;
                        }
                    }
                }
            } else if li > 0 && crate::uistate::remove(app, k, rt).unwrap_or(false) {
                pulled += 1;
            }
        }
    }
    Ok((pulled, pushed))
}

/* ---------------------------------------------------------------- API padrão posta pelo administrador
   Na nuvem, o painel de administração da central grava `admin-apis.json` na pasta do usuário
   ({"providers": [...], "default": "id"}). O studio junta essas APIs às dele (trocando a de mesmo id),
   torna a padrão ativa e apaga o arquivo (a chave não fica largada fora do config.json). */
pub async fn admin_apis(app: Arc<App>) {
    let f = app.root.join("admin-apis.json");
    loop {
        if let Some(v) = std::fs::read(&f).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) {
            let list: Vec<crate::app::ApiProvider> = v["providers"].as_array().into_iter().flatten().filter_map(|p| serde_json::from_value(p.clone()).ok()).filter(|p: &crate::app::ApiProvider| !p.id.trim().is_empty()).collect();
            {
                let mut c = app.config.write().unwrap();
                for p in list {
                    match c.api_providers.iter_mut().find(|x| x.id == p.id) {
                        Some(x) => *x = p,
                        None => c.api_providers.push(p),
                    }
                }
            }
            // a padrão vai para o começo da lista: na nuvem, sem escolha salva, a primeira API é a ativa
            if let Some(d) = v["default"].as_str() {
                let mut c = app.config.write().unwrap();
                if let Some(i) = c.api_providers.iter().position(|x| x.id == d) {
                    let p = c.api_providers.remove(i);
                    c.api_providers.insert(0, p);
                }
            }
            app.save_config();
            if let Some(d) = v["default"].as_str().filter(|d| !d.is_empty()) {
                let _ = crate::models::activate(&app, &format!("api_{d}")).await;
            }
            let _ = std::fs::remove_file(&f);
        }
        tokio::time::sleep(std::time::Duration::from_secs(20)).await;
    }
}
