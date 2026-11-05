//! Controle de navegador pelo protocolo de depuração do Chromium (Edge ou Chrome).
//! O studio abre uma janela própria do navegador, com perfil separado, e a controla por WebSocket.

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;

const PORT: u16 = 9333;

type Ws = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

struct Session {
    ws: Ws,
    next: u64,
}

pub struct Browser {
    profile: PathBuf,
    session: Mutex<Option<Session>>,
}

const SNAPSHOT_JS: &str = r#"(() => {
  const sel = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=checkbox],[role=tab],[role=menuitem],[role=option],[contenteditable=""],[contenteditable=true],[onclick],summary';
  document.querySelectorAll('[data-sid]').forEach(e => e.removeAttribute('data-sid'));
  const vis = e => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const items = []; let n = 0;
  for (const e of document.querySelectorAll(sel)) {
    if (!vis(e)) continue;
    if (n >= 300) break;
    n++; e.setAttribute('data-sid', n);
    const tag = e.tagName.toLowerCase();
    const type = e.getAttribute('type') || e.getAttribute('role') || '';
    const label = (e.getAttribute('aria-label') || e.innerText || e.value || e.getAttribute('placeholder') || e.getAttribute('title') || e.getAttribute('alt') || e.getAttribute('name') || '').trim().replace(/\s+/g, ' ').slice(0, 90);
    let extra = '';
    if (tag === 'a') extra = ' -> ' + (e.getAttribute('href') || '').slice(0, 90);
    if ((tag === 'input' || tag === 'textarea') && e.value && type !== 'password') extra += ' = "' + String(e.value).slice(0, 50) + '"';
    if (e.disabled) extra += ' (desativado)';
    items.push('[' + n + '] ' + tag + (type ? '(' + type + ')' : '') + ' "' + label + '"' + extra);
  }
  const text = (document.body ? document.body.innerText : '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return JSON.stringify({ title: document.title, url: location.href, text, items });
})()"#;

fn find_exe() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("STUDIO_BROWSER") {
        return Some(PathBuf::from(p));
    }
    #[cfg(windows)]
    {
        let mut c: Vec<PathBuf> = vec![];
        for var in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"] {
            if let Some(base) = std::env::var_os(var) {
                let b = PathBuf::from(base);
                c.push(b.join(r"Microsoft\Edge\Application\msedge.exe"));
                c.push(b.join(r"Google\Chrome\Application\chrome.exe"));
            }
        }
        c.into_iter().find(|p| p.is_file())
    }
    #[cfg(not(windows))]
    {
        ["chromium", "chromium-browser", "google-chrome", "microsoft-edge"].iter().find_map(|n| which::which(n).ok())
    }
}

impl Browser {
    pub fn new(root: &Path) -> Self {
        Browser { profile: root.join("navegador"), session: Mutex::new(None) }
    }

    async fn page_ws_url(http: &reqwest::Client) -> Result<String, String> {
        let base = format!("http://127.0.0.1:{PORT}");
        let list: Value = http.get(format!("{base}/json/list")).timeout(Duration::from_secs(3)).send().await.map_err(|e| e.to_string())?.bytes().await.map_err(|e| e.to_string()).and_then(|b| serde_json::from_slice(&b).map_err(|e| e.to_string()))?;
        if let Some(p) = list.as_array().and_then(|a| a.iter().find(|t| t["type"] == "page" && !t["url"].as_str().unwrap_or("").starts_with("devtools://"))) {
            return Ok(p["webSocketDebuggerUrl"].as_str().unwrap_or("").to_string());
        }
        let t: Value = http.put(format!("{base}/json/new?about:blank")).send().await.map_err(|e| e.to_string())?.bytes().await.map_err(|e| e.to_string()).and_then(|b| serde_json::from_slice(&b).map_err(|e| e.to_string()))?;
        Ok(t["webSocketDebuggerUrl"].as_str().unwrap_or("").to_string())
    }

    async fn ensure(&self, http: &reqwest::Client) -> Result<(), String> {
        let mut s = self.session.lock().await;
        if s.is_some() {
            return Ok(());
        }
        let alive = http.get(format!("http://127.0.0.1:{PORT}/json/version")).timeout(Duration::from_secs(2)).send().await.is_ok();
        if !alive {
            let exe = find_exe().ok_or("Não encontrei o Edge nem o Chrome neste computador.")?;
            let _ = std::fs::create_dir_all(&self.profile);
            let mut c = std::process::Command::new(&exe);
            c.arg(format!("--remote-debugging-port={PORT}"))
                .arg(format!("--user-data-dir={}", self.profile.display()))
                .args(["--no-first-run", "--no-default-browser-check", "--disable-features=Translate", "--new-window", "about:blank"]);
            #[cfg(not(windows))]
            c.arg("--no-sandbox");
            if std::env::var_os("STUDIO_BROWSER_HEADLESS").is_some() {
                c.arg("--headless=new");
            }
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                c.creation_flags(0x0000_0020); // prioridade normal
            }
            c.spawn().map_err(|e| format!("Não consegui abrir o navegador: {e}"))?;
            let mut ok = false;
            for _ in 0..60 {
                tokio::time::sleep(Duration::from_millis(250)).await;
                if http.get(format!("http://127.0.0.1:{PORT}/json/version")).timeout(Duration::from_secs(1)).send().await.is_ok() {
                    ok = true;
                    break;
                }
            }
            if !ok {
                return Err("O navegador abriu, mas não respondeu ao controle remoto. Feche outras janelas do Edge abertas com o perfil do studio e tente de novo.".into());
            }
        }
        let url = Self::page_ws_url(http).await?;
        let (ws, _) = tokio_tungstenite::connect_async(url.as_str()).await.map_err(|e| format!("Falha ao conectar ao navegador: {e}"))?;
        *s = Some(Session { ws, next: 1 });
        Ok(())
    }

    async fn cmd(&self, http: &reqwest::Client, method: &str, params: Value) -> Result<Value, String> {
        for attempt in 0..2 {
            self.ensure(http).await?;
            let mut guard = self.session.lock().await;
            let s = guard.as_mut().unwrap();
            let id = s.next;
            s.next += 1;
            let msg = json!({"id": id, "method": method, "params": params}).to_string();
            if s.ws.send(Message::Text(msg.into())).await.is_err() {
                *guard = None;
                if attempt == 0 {
                    continue;
                }
                return Err("Conexão com o navegador perdida.".into());
            }
            let r = tokio::time::timeout(Duration::from_secs(40), async {
                while let Some(m) = s.ws.next().await {
                    let Ok(m) = m else { return None };
                    if let Ok(t) = m.to_text() {
                        if let Ok(v) = serde_json::from_str::<Value>(t) {
                            if v["id"].as_u64() == Some(id) {
                                return Some(v);
                            }
                        }
                    }
                }
                None
            })
            .await;
            match r {
                Ok(Some(v)) => {
                    if let Some(e) = v.get("error") {
                        return Err(e["message"].as_str().unwrap_or("erro do navegador").to_string());
                    }
                    return Ok(v["result"].clone());
                }
                Ok(None) => {
                    // a aba fechou: tenta reconectar uma vez
                    *guard = None;
                    if attempt == 0 {
                        continue;
                    }
                    return Err("A aba do navegador foi fechada.".into());
                }
                Err(_) => return Err(format!("O navegador não respondeu a {method}.")),
            }
        }
        Err("Conexão com o navegador perdida.".into())
    }

    async fn eval(&self, http: &reqwest::Client, expr: &str) -> Result<Value, String> {
        let r = self.cmd(http, "Runtime.evaluate", json!({"expression": expr, "awaitPromise": true, "returnByValue": true})).await?;
        if let Some(ex) = r.get("exceptionDetails") {
            let msg = ex.pointer("/exception/description").and_then(Value::as_str).or_else(|| ex["text"].as_str()).unwrap_or("erro no script");
            return Err(msg.to_string());
        }
        Ok(r.pointer("/result/value").cloned().unwrap_or(Value::Null))
    }

    async fn wait_load(&self, http: &reqwest::Client) {
        tokio::time::sleep(Duration::from_millis(400)).await;
        for _ in 0..30 {
            if let Ok(v) = self.eval(http, "document.readyState").await {
                if v == "complete" {
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    async fn snapshot(&self, http: &reqwest::Client, max_text: usize) -> Result<String, String> {
        let v = self.eval(http, SNAPSHOT_JS).await?;
        let d: Value = serde_json::from_str(v.as_str().unwrap_or("{}")).unwrap_or(json!({}));
        let text = d["text"].as_str().unwrap_or("");
        let mut t: String = text.chars().take(max_text).collect();
        if text.chars().count() > max_text {
            t.push_str(&format!("\n[... texto cortado; a página tem {} caracteres]", text.chars().count()));
        }
        let items: Vec<&str> = d["items"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        Ok(format!(
            "Título: {}\nURL: {}\n\nTexto da página:\n{}\n\nElementos interativos (use o número em browser_click / browser_type):\n{}",
            d["title"].as_str().unwrap_or(""),
            d["url"].as_str().unwrap_or(""),
            t,
            if items.is_empty() { "(nenhum)".to_string() } else { items.join("\n") }
        ))
    }

    /// Executa uma ferramenta browser_*. Devolve (texto, imagens em data URL).
    pub async fn tool(&self, http: &reqwest::Client, ws_dir: &Path, name: &str, a: &Value) -> Result<(String, Vec<String>), String> {
        let s = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or("").to_string();
        let id = a.get("id").and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))).unwrap_or(0);
        match name {
            "browser_navigate" => {
                let mut url = s("url");
                if url.is_empty() {
                    return Err("Informe a url.".into());
                }
                if !url.contains("://") && !url.starts_with("about:") {
                    url = format!("https://{url}");
                }
                let _ = self.cmd(http, "Page.bringToFront", json!({})).await;
                let r = self.cmd(http, "Page.navigate", json!({"url": url})).await?;
                if let Some(e) = r.get("errorText").and_then(Value::as_str) {
                    return Err(format!("Não consegui abrir {url}: {e}"));
                }
                self.wait_load(http).await;
                Ok((self.snapshot(http, 8000).await?, vec![]))
            }
            "browser_read" => Ok((self.snapshot(http, 16000).await?, vec![])),
            "browser_click" => {
                let r = self.eval(http, &format!("(() => {{ const e = document.querySelector('[data-sid=\"{id}\"]'); if (!e) return 'nao'; e.scrollIntoView({{block:'center'}}); e.click(); return 'ok'; }})()")).await?;
                if r != "ok" {
                    return Err(format!("Elemento [{id}] não encontrado. Chame browser_read para atualizar a lista."));
                }
                self.wait_load(http).await;
                Ok((format!("Cliquei em [{id}].\n\n{}", self.snapshot(http, 6000).await?), vec![]))
            }
            "browser_type" => {
                let r = self
                    .eval(http, &format!("(() => {{ const e = document.querySelector('[data-sid=\"{id}\"]'); if (!e) return 'nao'; e.scrollIntoView({{block:'center'}}); e.focus(); if (e.select) e.select(); else if (e.isContentEditable) document.execCommand('selectAll'); return 'ok'; }})()"))
                    .await?;
                if r != "ok" {
                    return Err(format!("Elemento [{id}] não encontrado. Chame browser_read para atualizar a lista."));
                }
                self.cmd(http, "Input.insertText", json!({"text": s("text")})).await?;
                if a.get("submit").and_then(Value::as_bool).unwrap_or(false) {
                    for t in ["rawKeyDown", "char", "keyUp"] {
                        self.cmd(http, "Input.dispatchKeyEvent", json!({"type": t, "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13, "text": if t == "char" { "\r" } else { "" }})).await?;
                    }
                    self.wait_load(http).await;
                    return Ok((format!("Digitei em [{id}] e enviei.\n\n{}", self.snapshot(http, 6000).await?), vec![]));
                }
                Ok((format!("Digitei em [{id}]."), vec![]))
            }
            "browser_press" => {
                let key = s("key");
                let (code, vk, text) = match key.to_lowercase().as_str() {
                    "enter" => ("Enter", 13, "\r"),
                    "tab" => ("Tab", 9, ""),
                    "escape" | "esc" => ("Escape", 27, ""),
                    "backspace" => ("Backspace", 8, ""),
                    "arrowdown" | "down" => ("ArrowDown", 40, ""),
                    "arrowup" | "up" => ("ArrowUp", 38, ""),
                    "pagedown" => ("PageDown", 34, ""),
                    "pageup" => ("PageUp", 33, ""),
                    _ => return Err("Teclas aceitas: Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp, PageDown, PageUp.".into()),
                };
                for t in ["rawKeyDown", "char", "keyUp"] {
                    if t == "char" && text.is_empty() {
                        continue;
                    }
                    self.cmd(http, "Input.dispatchKeyEvent", json!({"type": t, "key": code, "code": code, "windowsVirtualKeyCode": vk, "text": if t == "char" { text } else { "" }})).await?;
                }
                Ok((format!("Tecla {code} enviada."), vec![]))
            }
            "browser_back" => {
                self.eval(http, "history.back(); true").await?;
                self.wait_load(http).await;
                Ok((self.snapshot(http, 6000).await?, vec![]))
            }
            "browser_screenshot" => {
                let r = self.cmd(http, "Page.captureScreenshot", json!({"format": "jpeg", "quality": 70})).await?;
                let b64 = r["data"].as_str().unwrap_or("");
                use base64::Engine;
                let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
                let path = save_capture(ws_dir, "navegador", &bytes)?;
                Ok((format!("Captura salva em {}", path.display()), vec![format!("data:image/jpeg;base64,{b64}")]))
            }
            "browser_eval" => {
                let v = self.eval(http, &s("code")).await?;
                Ok((if v.is_string() { v.as_str().unwrap().to_string() } else { serde_json::to_string_pretty(&v).unwrap_or_default() }, vec![]))
            }
            _ => Err(format!("Ferramenta desconhecida: {name}")),
        }
    }
}

pub fn save_capture(ws_dir: &Path, prefix: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let dir = ws_dir.join("capturas");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join(format!("{prefix}-{}.jpg", crate::app::now_ms()));
    std::fs::write(&p, bytes).map_err(|e| e.to_string())?;
    Ok(p)
}
