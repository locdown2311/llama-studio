//! Cliente MCP enxuto: stdio, Streamable HTTP e SSE (antigo).
//! JSON-RPC 2.0 com mensagens em serde_json::Value.

use futures_util::StreamExt;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

const PROTOCOL: &str = "2025-06-18";

type Reply = Result<Value, String>;

enum Tx {
    Stdio(tokio::sync::Mutex<tokio::process::ChildStdin>),
    Http { url: String, headers: Vec<(String, String)>, session: Mutex<Option<String>>, proto: Mutex<Option<String>> },
    Sse { post_url: Mutex<Option<String>>, headers: Vec<(String, String)> },
}

pub struct Conn {
    tx: Tx,
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    next: AtomicU64,
    alive: AtomicBool,
    http: reqwest::Client,
    tasks: Mutex<Vec<JoinHandle<()>>>,
    _child: Mutex<Option<tokio::process::Child>>,
    log: Arc<Mutex<String>>,
}

impl Drop for Conn {
    fn drop(&mut self) {
        for t in self.tasks.lock().unwrap().drain(..) {
            t.abort();
        }
        // o filho tem kill_on_drop
    }
}

/// Mensagem de erro com a causa original (o reqwest esconde o motivo na cadeia).
fn chain(e: &dyn std::error::Error) -> String {
    let mut out = e.to_string();
    let mut cur = e.source();
    while let Some(c) = cur {
        let t = c.to_string();
        if !out.contains(&t) {
            out.push_str(": ");
            out.push_str(&t);
        }
        cur = c.source();
    }
    out
}

fn push_log(log: &Mutex<String>, s: &str) {
    let mut l = log.lock().unwrap();
    l.push_str(s);
    if l.len() > 6000 {
        let cut = l.len() - 6000;
        let mut c = cut;
        while !l.is_char_boundary(c) {
            c += 1;
        }
        l.drain(..c);
    }
}

impl Conn {
    fn new(tx: Tx, http: reqwest::Client, log: Arc<Mutex<String>>) -> Arc<Conn> {
        Arc::new(Conn {
            tx,
            pending: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
            alive: AtomicBool::new(true),
            http,
            tasks: Mutex::new(vec![]),
            _child: Mutex::new(None),
            log,
        })
    }

    fn fail_all(&self, why: &str) {
        self.alive.store(false, Ordering::SeqCst);
        for (_, tx) in self.pending.lock().unwrap().drain() {
            let _ = tx.send(Err(why.to_string()));
        }
    }

    fn dispatch(self: &Arc<Self>, msg: Value) {
        if let Value::Array(items) = msg {
            for m in items {
                self.dispatch(m);
            }
            return;
        }
        let has_id = msg.get("id").is_some_and(|v| !v.is_null());
        if has_id && (msg.get("result").is_some() || msg.get("error").is_some()) {
            let id = msg["id"].as_u64().or_else(|| msg["id"].as_str().and_then(|s| s.parse().ok()));
            if let Some(id) = id {
                if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
                    let r = match msg.get("error") {
                        Some(e) if !e.is_null() => Err(e.get("message").and_then(Value::as_str).unwrap_or(L!("erro do servidor MCP", "MCP server error")).to_string()),
                        _ => Ok(msg.get("result").cloned().unwrap_or(Value::Null)),
                    };
                    let _ = tx.send(r);
                }
            }
        } else if has_id && msg.get("method").is_some() {
            // pedido do servidor para o cliente
            let id = msg["id"].clone();
            let reply = match msg["method"].as_str().unwrap_or("") {
                "ping" => json!({"jsonrpc":"2.0","id":id,"result":{}}),
                "roots/list" => json!({"jsonrpc":"2.0","id":id,"result":{"roots":[]}}),
                m => json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":LF!("Método não suportado pelo cliente: {m}", "Method not supported by the client: {m}")}}),
            };
            let me = self.clone();
            tokio::spawn(async move {
                let _ = me.send_raw(reply).await;
            });
        }
    }

    async fn send_raw(self: &Arc<Self>, msg: Value) -> Result<(), String> {
        match &self.tx {
            Tx::Stdio(stdin) => {
                let mut line = serde_json::to_vec(&msg).unwrap();
                line.push(b'\n');
                let mut w = stdin.lock().await;
                w.write_all(&line).await.map_err(|e| e.to_string())?;
                w.flush().await.map_err(|e| e.to_string())
            }
            Tx::Http { url, headers, session, proto } => {
                let mut rb = self
                    .http
                    .post(url)
                    .header("Accept", "application/json, text/event-stream")
                    .header("Content-Type", "application/json");
                for (k, v) in headers {
                    rb = rb.header(k, v);
                }
                if let Some(s) = session.lock().unwrap().clone() {
                    rb = rb.header("Mcp-Session-Id", s);
                }
                if let Some(p) = proto.lock().unwrap().clone() {
                    rb = rb.header("MCP-Protocol-Version", p);
                }
                let resp = tokio::time::timeout(Duration::from_secs(30), rb.body(serde_json::to_vec(&msg).unwrap()).send())
                    .await
                    .map_err(|_| L!("O servidor não respondeu em 30 s.", "The server did not answer within 30 s.").to_string())?
                    .map_err(|e| chain(&e))?;
                if let Some(s) = resp.headers().get("mcp-session-id").and_then(|v| v.to_str().ok()) {
                    *session.lock().unwrap() = Some(s.to_string());
                }
                let status = resp.status();
                if status.as_u16() == 202 || status.as_u16() == 204 {
                    return Ok(());
                }
                if !status.is_success() {
                    let body = resp.text().await.unwrap_or_default();
                    return Err(format!("HTTP {status}: {}", body.chars().take(300).collect::<String>()));
                }
                let ct = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_lowercase();
                if ct.contains("text/event-stream") {
                    let me = self.clone();
                    let h = tokio::spawn(async move {
                        read_sse(resp, |event, data| {
                            if event == "endpoint" {
                                // é um servidor do transporte SSE antigo: desiste já para tentar SSE
                                me.fail_all(L!("O servidor usa o transporte SSE antigo.", "The server uses the legacy SSE transport."));
                                return;
                            }
                            if let Ok(v) = serde_json::from_str::<Value>(&data) {
                                me.dispatch(v);
                            }
                        })
                        .await;
                    });
                    self.tasks.lock().unwrap().push(h);
                } else {
                    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
                    if !bytes.is_empty() {
                        let v: Value = serde_json::from_slice(&bytes).map_err(|e| LF!("Resposta inválida: {e}", "Invalid response: {e}"))?;
                        self.dispatch(v);
                    }
                }
                Ok(())
            }
            Tx::Sse { post_url, headers } => {
                let url = post_url.lock().unwrap().clone().ok_or(L!("Servidor SSE ainda não informou o endereço.", "The SSE server has not given the address yet."))?;
                let mut rb = self.http.post(url).header("Content-Type", "application/json");
                for (k, v) in headers {
                    rb = rb.header(k, v);
                }
                let resp = tokio::time::timeout(Duration::from_secs(30), rb.body(serde_json::to_vec(&msg).unwrap()).send())
                    .await
                    .map_err(|_| L!("O servidor não respondeu em 30 s.", "The server did not answer within 30 s.").to_string())?
                    .map_err(|e| chain(&e))?;
                if !resp.status().is_success() {
                    return Err(format!("HTTP {}", resp.status()));
                }
                Ok(())
            }
        }
    }

    pub async fn request(self: &Arc<Self>, method: &str, params: Value, timeout: Duration) -> Reply {
        if !self.alive.load(Ordering::SeqCst) {
            return Err(L!("Conexão encerrada.", "Connection closed.").into());
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        let started = std::time::Instant::now();
        match tokio::time::timeout(timeout, self.send_raw(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                self.pending.lock().unwrap().remove(&id);
                return Err(e);
            }
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                return Err(LF!("Tempo esgotado ({}s) ao enviar {method}", "Timed out ({}s) sending {method}", timeout.as_secs()));
            }
        }
        match tokio::time::timeout(timeout.saturating_sub(started.elapsed()), rx).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Err(L!("Conexão encerrada.", "Connection closed.").into()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(LF!("Tempo esgotado ({}s) em {method}", "Timed out ({}s) on {method}", timeout.as_secs()))
            }
        }
    }

    async fn notify(self: &Arc<Self>, method: &str) {
        let _ = self.send_raw(json!({"jsonrpc":"2.0","method":method})).await;
    }

    async fn initialize(self: &Arc<Self>) -> Result<(), String> {
        let r = self
            .request(
                "initialize",
                json!({"protocolVersion":PROTOCOL,"capabilities":{"roots":{"listChanged":false}},"clientInfo":{"name":"llama-studio","version":env!("CARGO_PKG_VERSION")}}),
                Duration::from_secs(110),
            )
            .await?;
        if let Tx::Http { proto, .. } = &self.tx {
            *proto.lock().unwrap() = r.get("protocolVersion").and_then(Value::as_str).map(str::to_string);
        }
        self.notify("notifications/initialized").await;
        Ok(())
    }

    async fn list_tools(self: &Arc<Self>) -> Result<Vec<Value>, String> {
        let mut out = vec![];
        let mut cursor: Option<String> = None;
        loop {
            let params = match &cursor {
                Some(c) => json!({"cursor": c}),
                None => json!({}),
            };
            let r = self.request("tools/list", params, Duration::from_secs(30)).await?;
            if let Some(t) = r.get("tools").and_then(Value::as_array) {
                out.extend(t.iter().cloned());
            }
            cursor = r.get("nextCursor").and_then(Value::as_str).map(str::to_string);
            if cursor.is_none() || out.len() > 2000 {
                break;
            }
        }
        Ok(out)
    }
}

/// Lê um fluxo text/event-stream chamando `on_event(evento, dados)`.
async fn read_sse(resp: reqwest::Response, mut on_event: impl FnMut(&str, String)) {
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = vec![];
    while let Some(Ok(chunk)) = stream.next().await {
        buf.extend(chunk.iter().filter(|&&b| b != b'\r'));
        while let Some(pos) = buf.windows(2).position(|w| w == b"\n\n") {
            let block: Vec<u8> = buf.drain(..pos + 2).collect();
            let text = String::from_utf8_lossy(&block);
            let mut event = String::from("message");
            let mut data: Vec<&str> = vec![];
            for line in text.lines() {
                if let Some(v) = line.strip_prefix("event:") {
                    event = v.trim().to_string();
                } else if let Some(v) = line.strip_prefix("data:") {
                    data.push(v.strip_prefix(' ').unwrap_or(v));
                }
            }
            if !data.is_empty() {
                on_event(&event, data.join("\n"));
            }
        }
    }
}

// ---------------------------------------------------------------- servidores

pub struct Entry {
    pub name: String,
    pub cfg: Value,
    kind: Mutex<String>,
    status: Mutex<String>,
    error: Mutex<Option<String>>,
    log: Arc<Mutex<String>>,
    tools: Mutex<Vec<Value>>,
    conn: Mutex<Option<Arc<Conn>>>,
    since: u128,
    /// ferramentas escondidas do modelo ("disabledTools" no mcp.json)
    hidden: Mutex<std::collections::HashSet<String>>,
}

fn hidden_of(cfg: &Value) -> std::collections::HashSet<String> {
    cfg.get("disabledTools").and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default()
}

/// Configuração sem o que não exige reconectar.
fn conn_cfg(cfg: &Value) -> Value {
    let mut c = cfg.clone();
    if let Some(o) = c.as_object_mut() {
        o.remove("disabledTools");
    }
    c
}

impl Entry {
    pub fn status(&self) -> String {
        let s = self.status.lock().unwrap().clone();
        if s == "connected" && !self.conn.lock().unwrap().as_ref().is_some_and(|c| c.alive.load(Ordering::SeqCst)) {
            return "disconnected".into();
        }
        s
    }
    pub fn tools(&self) -> Vec<Value> {
        self.tools.lock().unwrap().clone()
    }
    /// Só as que o modelo pode ver.
    pub fn visible_tools(&self) -> Vec<Value> {
        let h = self.hidden.lock().unwrap();
        self.tools.lock().unwrap().iter().filter(|t| !t["name"].as_str().is_some_and(|n| h.contains(n))).cloned().collect()
    }
    pub fn set_hidden(&self, names: std::collections::HashSet<String>) {
        *self.hidden.lock().unwrap() = names;
    }
    fn set(&self, status: &str, err: Option<String>) {
        *self.status.lock().unwrap() = status.to_string();
        *self.error.lock().unwrap() = err;
    }
    /// pid do processo do conector local (None para conectores por URL ou desconectados).
    fn pid(&self) -> Option<u32> {
        let conn = self.conn.lock().unwrap();
        let c = conn.as_ref()?;
        let child = c._child.lock().unwrap();
        child.as_ref()?.id()
    }

    pub fn to_json(&self) -> Value {
        json!({
            "name": self.name,
            "kind": *self.kind.lock().unwrap(),
            "status": self.status(),
            "error": *self.error.lock().unwrap(),
            "log": *self.log.lock().unwrap(),
            "config": self.cfg,
            "since": self.since as u64,
            "tools": self.tools.lock().unwrap().iter().map(|t| json!({"name": t["name"], "description": t.get("description").cloned().unwrap_or(json!(""))})).collect::<Vec<_>>(),
            "hidden": self.hidden.lock().unwrap().iter().cloned().collect::<Vec<_>>(),
        })
    }
}

fn kind_of(cfg: &Value) -> &'static str {
    if cfg.get("url").and_then(Value::as_str).is_some() {
        match cfg.get("type").or_else(|| cfg.get("transport")).and_then(Value::as_str).unwrap_or("").to_lowercase().as_str() {
            "sse" => "sse",
            "http" | "streamable-http" | "streamablehttp" | "streamable_http" => "http",
            _ => "auto",
        }
    } else {
        "stdio"
    }
}

fn headers_of(cfg: &Value) -> Vec<(String, String)> {
    cfg.get("headers")
        .and_then(Value::as_object)
        .map(|o| o.iter().filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string()))).collect())
        .unwrap_or_default()
}

#[derive(Default)]
pub struct Mcp {
    servers: RwLock<BTreeMap<String, Arc<Entry>>>,
    index: Mutex<HashMap<String, (String, String)>>,
}

impl Mcp {
    pub fn get(&self, name: &str) -> Option<Arc<Entry>> {
        self.servers.read().unwrap().get(name).cloned()
    }

    pub fn status_json(&self) -> Vec<Value> {
        self.servers.read().unwrap().values().map(|e| e.to_json()).collect()
    }

    /// Como status_json, com a memória de cada conector local (processo e filhos), em bytes.
    pub fn status_json_mem(&self) -> Vec<Value> {
        let map = self.servers.read().unwrap();
        let pids: Vec<(String, u32)> = map.values().filter_map(|e| e.pid().map(|p| (e.name.clone(), p))).collect();
        let mem = crate::procmem::trees(&pids.iter().map(|x| x.1).collect::<Vec<_>>());
        map.values()
            .map(|e| {
                let mut v = e.to_json();
                if let Some((_, pid)) = pids.iter().find(|x| x.0 == e.name) {
                    v["mem"] = json!(mem.get(pid).copied().unwrap_or(0));
                }
                v
            })
            .collect()
    }

    pub fn set_index(&self, idx: HashMap<String, (String, String)>) {
        self.index.lock().unwrap().extend(idx);
    }

    pub fn read_config(file: &std::path::Path) -> Value {
        let mut v: Value = crate::app::read_json(file).unwrap_or_else(|| json!({}));
        if !v.get("mcpServers").is_some_and(Value::is_object) {
            v["mcpServers"] = json!({});
        }
        v
    }

    /// Conecta os servidores novos/alterados e remove os que saíram do mcp.json.
    pub async fn sync(&self, http: &reqwest::Client, file: &std::path::Path) {
        let cfg = Self::read_config(file);
        let wanted = cfg["mcpServers"].as_object().cloned().unwrap_or_default();
        let mut todo = vec![];
        {
            let mut map = self.servers.write().unwrap();
            map.retain(|k, _| wanted.contains_key(k));
            for (name, c) in &wanted {
                let cur = map.get(name).filter(|e| conn_cfg(&e.cfg) == conn_cfg(c) && matches!(e.status().as_str(), "connected" | "connecting" | "disabled"));
                if let Some(e) = cur {
                    e.set_hidden(hidden_of(c));
                } else {
                    let e = Arc::new(Entry {
                        name: name.clone(),
                        cfg: c.clone(),
                        kind: Mutex::new(kind_of(c).into()),
                        status: Mutex::new("connecting".into()),
                        error: Mutex::new(None),
                        log: Arc::new(Mutex::new(String::new())),
                        tools: Mutex::new(vec![]),
                        conn: Mutex::new(None),
                        since: crate::app::now_ms(),
                        hidden: Mutex::new(hidden_of(c)),
                    });
                    map.insert(name.clone(), e.clone());
                    todo.push(e);
                }
            }
        }
        let futs = todo.into_iter().map(|e| connect(e, http.clone()));
        futures_util::future::join_all(futs).await;
    }

    pub async fn reconnect(&self, http: &reqwest::Client, file: &std::path::Path, only: Option<&str>) {
        {
            let mut map = self.servers.write().unwrap();
            match only {
                Some(n) => {
                    map.remove(n);
                }
                None => map.clear(),
            }
        }
        self.sync(http, file).await;
    }

    pub async fn call_by_tool(&self, exposed: &str, args: Value) -> Result<(String, bool, Vec<String>), String> {
        let target = self.index.lock().unwrap().get(exposed).cloned();
        let (server, tool) = match target {
            Some(t) => t,
            None => {
                // procura pelo nome exposto em todos os servidores
                let map = self.servers.read().unwrap();
                let mut found = None;
                for (sn, e) in map.iter() {
                    for t in e.tools() {
                        let tn = t["name"].as_str().unwrap_or("");
                        if exposed == format!("{}__{}", sn, tn) {
                            found = Some((sn.clone(), tn.to_string()));
                        }
                    }
                }
                found.ok_or_else(|| LF!("Ferramenta não disponível: {exposed}", "Tool not available: {exposed}"))?
            }
        };
        let e = self.get(&server).ok_or_else(|| LF!("Servidor MCP \"{server}\" não existe mais.", "MCP server \"{server}\" no longer exists."))?;
        if e.hidden.lock().unwrap().contains(&tool) {
            return Err(LF!("A ferramenta {tool} foi desativada pelo usuário no conector {server}.", "The tool {tool} was turned off by the user in the connector {server}."));
        }
        let conn = e.conn.lock().unwrap().clone().filter(|c| c.alive.load(Ordering::SeqCst)).ok_or_else(|| LF!("Servidor MCP \"{server}\" não está conectado.", "MCP server \"{server}\" is not connected."))?;
        let args = if args.is_object() { args } else { json!({}) };
        let a = args.to_string();
        push_log(&e.log, &format!("→ tools/call {tool} {}\n", cut_log(&a, 400)));
        let r = match conn.request("tools/call", json!({"name": tool, "arguments": args}), Duration::from_secs(600)).await {
            Ok(r) => r,
            Err(err) => {
                push_log(&e.log, &LF!("← {tool}: erro: {err}\n", "← {tool}: error: {err}\n"));
                return Err(err);
            }
        };
        push_log(&e.log, &format!("← {tool}{}: {}\n", if r.get("isError").and_then(Value::as_bool).unwrap_or(false) { " (isError)" } else { "" }, cut_log(&result_to_text(&r).replace('\n', " "), 300)));
        let images = r.get("content").and_then(Value::as_array).map(|a| a.iter().filter(|c| c["type"] == "image").filter_map(|c| Some(format!("data:{};base64,{}", c["mimeType"].as_str().unwrap_or("image/png"), c["data"].as_str()?))).collect()).unwrap_or_default();
        Ok((result_to_text(&r), r.get("isError").and_then(Value::as_bool).unwrap_or(false), images))
    }
}

pub fn result_to_text(r: &Value) -> String {
    let mut parts = vec![];
    for c in r.get("content").and_then(Value::as_array).cloned().unwrap_or_default() {
        match c.get("type").and_then(Value::as_str).unwrap_or("") {
            "text" => parts.push(c["text"].as_str().unwrap_or("").to_string()),
            "image" => parts.push(format!("[imagem {}, {} KB]", c["mimeType"].as_str().unwrap_or(""), c["data"].as_str().map(|d| d.len() * 3 / 4 / 1024).unwrap_or(0))),
            "audio" => parts.push(LF!("[áudio {}]", "[audio {}]", c["mimeType"].as_str().unwrap_or(""))),
            "resource" => parts.push(c.pointer("/resource/text").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("[recurso {}]", c.pointer("/resource/uri").and_then(Value::as_str).unwrap_or("")))),
            "resource_link" => parts.push(LF!("[link de recurso] {} {}", "[resource link] {} {}", c["name"].as_str().unwrap_or(""), c["uri"].as_str().unwrap_or(""))),
            _ => parts.push(c.to_string()),
        }
    }
    if parts.is_empty() {
        if let Some(sc) = r.get("structuredContent") {
            parts.push(serde_json::to_string_pretty(sc).unwrap_or_default());
        }
    }
    let t = parts.join("\n");
    if t.is_empty() { L!("(sem conteúdo)", "(no content)").into() } else { t }
}

async fn connect(e: Arc<Entry>, http: reqwest::Client) {
    if e.cfg.get("disabled").and_then(Value::as_bool).unwrap_or(false) {
        e.set("disabled", None);
        return;
    }
    // prazo total: locais podem demorar para subir (ex.: Ghidra), remotos não
    let limit = Duration::from_secs(if kind_of(&e.cfg) == "stdio" { 120 } else { 45 });
    if tokio::time::timeout(limit, connect_inner(e.clone(), http)).await.is_err() {
        *e.conn.lock().unwrap() = None;
        e.set("error", Some(LF!("Tempo esgotado: o servidor não terminou de conectar em {} s. Veja o log.", "Timed out: the server did not finish connecting within {} s. See the log.", limit.as_secs())));
    }
}

fn cut_log(s: &str, n: usize) -> String {
    if s.chars().count() <= n { s.to_string() } else { s.chars().take(n).collect::<String>() + "…" }
}

async fn connect_inner(e: Arc<Entry>, http: reqwest::Client) {
    let kind = kind_of(&e.cfg);
    let url_is_sse = e.cfg.get("url").and_then(Value::as_str).is_some_and(|u| u.trim_end_matches('/').ends_with("/sse"));
    let result = match kind {
        "stdio" => connect_stdio(&e, http).await,
        "http" => {
            let url = e.cfg.get("url").and_then(Value::as_str).unwrap_or("").to_string();
            // ex.: x64dbg-mcp: Streamable HTTP fica na raiz e /sse é o transporte antigo
            let root = url_is_sse.then(|| url.trim_end_matches('/').trim_end_matches("/sse").to_string() + "/");
            let mut r = Err(String::new());
            if let Some(root) = &root {
                r = connect_http(&e, http.clone(), root).await;
                match &r {
                    Ok(_) => push_log(&e.log, &LF!("Conectado por Streamable HTTP em {root} (o endereço /sse é do transporte antigo).\n", "Connected through Streamable HTTP at {root} (the /sse address is the legacy transport).\n")),
                    Err(err) => push_log(&e.log, &LF!("Streamable HTTP em {root} falhou ({err}); tentando {url}...\n", "Streamable HTTP at {root} failed ({err}); trying {url}...\n")),
                }
            }
            if r.is_err() {
                r = connect_http(&e, http.clone(), &url).await;
            }
            match r {
                Err(err) if url_is_sse => {
                    push_log(&e.log, &LF!("HTTP falhou ({err}); o endereço termina em /sse, tentando SSE...\n", "HTTP failed ({err}); the address ends in /sse, trying SSE...\n"));
                    let r = connect_sse(&e, http).await;
                    if r.is_ok() {
                        *e.kind.lock().unwrap() = "sse".into();
                    }
                    r
                }
                r => r,
            }
        }
        "sse" => connect_sse(&e, http).await,
        _ => match connect_http(&e, http.clone(), e.cfg.get("url").and_then(Value::as_str).unwrap_or("")).await {
            Ok(c) => {
                *e.kind.lock().unwrap() = "http".into();
                Ok(c)
            }
            Err(err) => {
                push_log(&e.log, &format!("HTTP falhou ({err}); tentando SSE...\n"));
                let r = connect_sse(&e, http).await;
                if r.is_ok() {
                    *e.kind.lock().unwrap() = "sse".into();
                }
                r
            }
        },
    };
    match result {
        Ok(conn) => match conn.list_tools().await {
            Ok(tools) => {
                *e.tools.lock().unwrap() = tools;
                *e.conn.lock().unwrap() = Some(conn);
                e.set("connected", None);
            }
            Err(err) => e.set("error", Some(LF!("Conectou, mas falhou ao listar ferramentas: {err}", "Connected, but failed to list tools: {err}"))),
        },
        Err(err) => e.set("error", Some(err)),
    }
}

fn resolve_command(cmd: &str) -> std::path::PathBuf {
    crate::bins::which(cmd).unwrap_or_else(|| std::path::PathBuf::from(cmd))
}

async fn connect_stdio(e: &Arc<Entry>, http: reqwest::Client) -> Result<Arc<Conn>, String> {
    let command = e.cfg.get("command").and_then(Value::as_str).ok_or("Falta o campo \"command\".")?;
    let mut c = tokio::process::Command::new(resolve_command(command));
    if let Some(args) = e.cfg.get("args").and_then(Value::as_array) {
        c.args(args.iter().map(|a| a.as_str().map(str::to_string).unwrap_or_else(|| a.to_string())));
    }
    c.env("PATH", crate::bins::path_env());
    if let Some(env) = e.cfg.get("env").and_then(Value::as_object) {
        for (k, v) in env {
            c.env(k, v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string()));
        }
    }
    if let Some(cwd) = e.cfg.get("cwd").and_then(Value::as_str).filter(|s| !s.is_empty()) {
        c.current_dir(cwd);
    }
    c.stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)]
    c.creation_flags(crate::CREATE_NO_WINDOW);
    let mut child = c.spawn().map_err(|err| LF!("Não consegui iniciar \"{command}\": {err}", "Could not start \"{command}\": {err}"))?;
    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let conn = Conn::new(Tx::Stdio(tokio::sync::Mutex::new(stdin)), http, e.log.clone());
    *conn._child.lock().unwrap() = Some(child);

    let weak = Arc::downgrade(&conn);
    let reader = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Some(c) = weak.upgrade() else { return };
            let t = line.trim();
            if t.is_empty() {
                continue;
            }
            match serde_json::from_str::<Value>(t) {
                Ok(v) => c.dispatch(v),
                Err(_) => push_log(&c.log, &format!("{t}\n")),
            }
        }
        if let Some(c) = weak.upgrade() {
            c.fail_all(L!("O processo do servidor MCP terminou.", "The MCP server process exited."));
        }
    });
    let log = e.log.clone();
    let errt = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            push_log(&log, &format!("{line}\n"));
        }
    });
    conn.tasks.lock().unwrap().extend([reader, errt]);
    conn.initialize().await?;
    Ok(conn)
}

async fn connect_http(e: &Arc<Entry>, http: reqwest::Client, url: &str) -> Result<Arc<Conn>, String> {
    let url = url.to_string();
    reqwest::Url::parse(&url).map_err(|err| LF!("URL inválida: {err}", "Invalid URL: {err}"))?;
    let conn = Conn::new(Tx::Http { url, headers: headers_of(&e.cfg), session: Mutex::new(None), proto: Mutex::new(None) }, http, e.log.clone());
    conn.initialize().await?;
    Ok(conn)
}

async fn connect_sse(e: &Arc<Entry>, http: reqwest::Client) -> Result<Arc<Conn>, String> {
    let url = e.cfg["url"].as_str().unwrap_or("").to_string();
    let base = reqwest::Url::parse(&url).map_err(|err| LF!("URL inválida: {err}", "Invalid URL: {err}"))?;
    let headers = headers_of(&e.cfg);
    let mut rb = http.get(base.clone()).header("Accept", "text/event-stream");
    for (k, v) in &headers {
        rb = rb.header(k, v);
    }
    let resp = tokio::time::timeout(Duration::from_secs(20), rb.send())
        .await
        .map_err(|_| L!("O servidor SSE não respondeu em 20 s.", "The SSE server did not answer within 20 s.").to_string())?
        .map_err(|err| chain(&err))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let conn = Conn::new(Tx::Sse { post_url: Mutex::new(None), headers }, http, e.log.clone());
    let (ready_tx, ready_rx) = oneshot::channel::<()>();
    let weak = Arc::downgrade(&conn);
    let task = tokio::spawn(async move {
        let mut ready = Some(ready_tx);
        read_sse(resp, |event, data| {
            let Some(c) = weak.upgrade() else { return };
            if event == "endpoint" {
                if let Ok(u) = base.join(data.trim()) {
                    if let Tx::Sse { post_url, .. } = &c.tx {
                        *post_url.lock().unwrap() = Some(u.to_string());
                    }
                    if let Some(t) = ready.take() {
                        let _ = t.send(());
                    }
                }
            } else if let Ok(v) = serde_json::from_str::<Value>(&data) {
                c.dispatch(v);
            }
        })
        .await;
        if let Some(c) = weak.upgrade() {
            c.fail_all("O fluxo SSE foi encerrado.");
        }
    });
    conn.tasks.lock().unwrap().push(task);
    tokio::time::timeout(Duration::from_secs(30), ready_rx).await.map_err(|_| L!("O servidor SSE não enviou o endereço de mensagens.", "The SSE server did not send the messages address.").to_string())?.map_err(|_| "Fluxo SSE encerrado.".to_string())?;
    conn.initialize().await?;
    Ok(conn)
}
