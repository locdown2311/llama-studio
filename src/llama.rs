//! Inicia, para e acompanha o llama-server (substitui o llama-gui.ps1).
//! Usa o mesmo arquivo llama-gui.json, então as duas ferramentas compartilham a configuração.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::oneshot;

use crate::app::{App, UiMsg};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub struct LlamaCfg {
    pub server_exe: String,
    pub model: String,
    pub bind_host: String,
    pub port: u16,
    pub context: u32,
    pub cpu_moe: u32,
    pub threads: u32,
    pub hip_devices: String,
    pub extra_args: String,
    pub auto_start: bool,
    pub start_minimized: bool,
    pub close_to_tray: bool,
}

impl Default for LlamaCfg {
    fn default() -> Self {
        Self::defaults(Path::new("."))
    }
}

impl LlamaCfg {
    fn defaults(app_dir: &Path) -> Self {
        LlamaCfg {
            server_exe: app_dir.join(if cfg!(windows) { "llama-server.exe" } else { "llama-server" }).to_string_lossy().into_owned(),
            model: String::new(),
            bind_host: "127.0.0.1".into(),
            port: 1235,
            context: 65536,
            cpu_moe: 0,
            threads: 0,
            hip_devices: String::new(),
            extra_args: "-ngl 99 -fa on --jinja".into(),
            auto_start: false,
            start_minimized: false,
            close_to_tray: true,
        }
    }

    pub fn base_url(&self) -> String {
        let h = self.bind_host.trim();
        let h = if h.is_empty() || h == "0.0.0.0" || h == "::" { "127.0.0.1" } else { h };
        format!("http://{h}:{}", self.port)
    }
}

const LOG_CAP: usize = 3000;

struct LogBuf {
    first: u64,
    lines: VecDeque<String>,
}

pub struct Llama {
    file: PathBuf,
    studio_page: PathBuf,
    pub cfg: RwLock<LlamaCfg>,
    kill: Mutex<Option<oneshot::Sender<()>>>,
    running: std::sync::atomic::AtomicBool,
    pid: AtomicU32,
    /// quando o servidor foi iniciado pelo studio (ms desde 1970), para a tela de abertura
    started_at: std::sync::atomic::AtomicU64,
    state: Mutex<String>,
    log: Mutex<LogBuf>,
}

impl Llama {
    pub fn new(llama_dir: &Path, app_dir: &Path) -> Self {
        let file = llama_dir.join("llama-gui.json");
        let mut cfg = LlamaCfg::defaults(llama_dir);
        if let Some(v) = crate::app::read_json::<Value>(&file) {
            // mescla campo a campo (o arquivo pode ter só alguns)
            let mut base = serde_json::to_value(&cfg).unwrap();
            if let (Some(b), Some(o)) = (base.as_object_mut(), v.as_object()) {
                for (k, val) in o {
                    if b.contains_key(k) && !val.is_null() {
                        b.insert(k.clone(), val.clone());
                    }
                }
            }
            if let Ok(c) = serde_json::from_value(base) {
                cfg = c;
            }
        }
        Llama {
            file,
            studio_page: app_dir.join("llama-path"),
            cfg: RwLock::new(cfg),
            kill: Mutex::new(None),
            running: false.into(),
            pid: AtomicU32::new(0),
            started_at: std::sync::atomic::AtomicU64::new(0),
            state: Mutex::new("stopped".into()),
            log: Mutex::new(LogBuf { first: 0, lines: VecDeque::new() }),
        }
    }

    pub fn cfg(&self) -> LlamaCfg {
        self.cfg.read().unwrap().clone()
    }

    pub fn save(&self, c: LlamaCfg) {
        if let Ok(s) = serde_json::to_string_pretty(&c) {
            let _ = std::fs::write(&self.file, s);
        }
        *self.cfg.write().unwrap() = c;
    }

    pub fn state(&self) -> String {
        self.state.lock().unwrap().clone()
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn push_log(&self, line: String) {
        let mut l = self.log.lock().unwrap();
        l.lines.push_back(line);
        if l.lines.len() > LOG_CAP {
            l.lines.pop_front();
            l.first += 1;
        }
    }

    pub fn log_since(&self, since: u64) -> Value {
        let l = self.log.lock().unwrap();
        let next = l.first + l.lines.len() as u64;
        let start = since.max(l.first);
        let lines: Vec<&String> = l.lines.iter().skip((start - l.first) as usize).collect();
        json!({"lines": lines, "next": next, "from": start})
    }

    pub fn args_string(&self) -> String {
        let c = self.cfg();
        let mut a = vec![format!("-m \"{}\"", c.model), format!("--host {} --port {}", c.bind_host, c.port), format!("-c {}", c.context)];
        if c.cpu_moe > 0 {
            a.push(format!("--n-cpu-moe {}", c.cpu_moe));
        }
        if c.threads > 0 {
            a.push(format!("-t {}", c.threads));
        }
        if !c.extra_args.trim().is_empty() {
            a.push(c.extra_args.trim().to_string());
        }
        if self.studio_page.is_dir() && !c.extra_args.contains("--path") {
            a.push(format!("--path \"{}\"", self.studio_page.display()));
        }
        a.join(" ")
    }

    pub fn command_line(&self) -> String {
        format!("\"{}\" {}", self.cfg().server_exe, self.args_string())
    }

    pub fn to_json(&self) -> Value {
        let c = self.cfg();
        json!({
            "config": c,
            "state": self.state(),
            "running": self.is_running(),
            "pid": self.pid.load(Ordering::SeqCst),
            "startedAt": self.started_at.load(Ordering::SeqCst),
            "url": c.base_url(),
            "command": self.command_line(),
        })
    }

    fn set_state(&self, app: &App, s: &str) {
        let mut st = self.state.lock().unwrap();
        if *st != s {
            *st = s.to_string();
            drop(st);
            app.ui(UiMsg::LlamaState(s.to_string()));
        }
    }

    pub fn start(&self, app: &Arc<App>) -> Result<(), String> {
        if self.is_running() {
            return Ok(());
        }
        let c = self.cfg();
        if !Path::new(&c.server_exe).is_file() {
            return Err(format!("llama-server não encontrado: {}", c.server_exe));
        }
        if !Path::new(&c.model).is_file() {
            return Err(format!("Modelo não encontrado: {}", c.model));
        }
        // não sobe um segundo servidor na mesma porta
        let host = if c.bind_host.trim().is_empty() || c.bind_host == "0.0.0.0" { "127.0.0.1" } else { c.bind_host.trim() };
        if let Ok(addr) = format!("{host}:{}", c.port).parse::<std::net::SocketAddr>() {
            if std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
                return Err(format!("Já existe um llama-server (ou outro programa) usando a porta {}. O studio usa esse; para iniciar pelo studio, feche o outro antes.", c.port));
            }
        }
        let args = self.args_string();
        self.push_log(format!("Iniciando: \"{}\" {}", c.server_exe, args));
        let mut cmd = tokio::process::Command::new(&c.server_exe);
        #[cfg(windows)]
        {
            cmd.raw_arg(&args);
            // sem console e com prioridade normal (o studio roda abaixo do normal)
            cmd.creation_flags(crate::CREATE_NO_WINDOW | 0x0000_0020);
        }
        #[cfg(not(windows))]
        cmd.args(split_args(&args));
        if let Some(dir) = Path::new(&c.server_exe).parent() {
            cmd.current_dir(dir);
        }
        if !c.hip_devices.trim().is_empty() {
            cmd.env("HIP_VISIBLE_DEVICES", c.hip_devices.trim());
        }
        cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
        let mut child = cmd.spawn().map_err(|e| format!("Erro ao iniciar: {e}"))?;
        self.pid.store(child.id().unwrap_or(0), Ordering::SeqCst);
        self.started_at.store(crate::app::now_ms() as u64, Ordering::SeqCst);
        self.running.store(true, Ordering::SeqCst);
        self.set_state(app, "loading");

        for out in [child.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), child.stderr.take().map(|s| Box::new(s) as _)].into_iter().flatten() {
            let app = app.clone();
            tokio::spawn(async move {
                let mut r = BufReader::new(out);
                let mut buf = Vec::new();
                loop {
                    buf.clear();
                    match r.read_until(b'\n', &mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            let line = String::from_utf8_lossy(&buf).trim_end().to_string();
                            app.llama.push_log(line);
                        }
                    }
                }
            });
        }

        let (ktx, krx) = oneshot::channel();
        *self.kill.lock().unwrap() = Some(ktx);
        let app2 = app.clone();
        tokio::spawn(async move {
            let code = tokio::select! {
                s = child.wait() => s.ok().and_then(|s| s.code()),
                _ = krx => { let _ = child.kill().await; let _ = child.wait().await; None }
            };
            let l = &app2.llama;
            l.running.store(false, Ordering::SeqCst);
            l.pid.store(0, Ordering::SeqCst);
            l.push_log(match code {
                Some(c) => format!("Servidor encerrado (código {c})."),
                None => "Servidor parado.".into(),
            });
            l.set_state(&app2, "stopped");
        });
        Ok(())
    }

    pub fn stop(&self) {
        if let Some(k) = self.kill.lock().unwrap().take() {
            let _ = k.send(());
        }
    }

    /// Acompanha a saúde do servidor: 1 s enquanto carrega, 5 s no resto do tempo.
    pub async fn monitor(app: Arc<App>) {
        loop {
            let url = format!("{}/health", app.llama.cfg().base_url());
            // 200 = pronto; qualquer outra resposta (503 enquanto carrega) = existe, mas carregando
            let health = match app.http.get(&url).timeout(Duration::from_secs(3)).send().await {
                Ok(r) if r.status().is_success() => 2,
                Ok(_) => 1,
                Err(_) => 0,
            };
            let ours = app.llama.is_running();
            let s = match (ours, health) {
                (true, 2) => "ready",
                (true, _) => "loading",
                (false, 2) => "external",
                (false, 1) => "external-loading",
                (false, _) => "stopped",
            };
            app.llama.set_state(&app, s);
            let wait = if s.ends_with("loading") { 1 } else { 5 };
            tokio::time::sleep(Duration::from_secs(wait)).await;
        }
    }
}

/// Divide uma linha de comando respeitando aspas (só fora do Windows).
#[cfg(not(windows))]
fn split_args(s: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let mut quote = false;
    let mut has = false;
    for ch in s.chars() {
        match ch {
            '"' => {
                quote = !quote;
                has = true;
            }
            c if c.is_whitespace() && !quote => {
                if has || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                    has = false;
                }
            }
            c => cur.push(c),
        }
    }
    if has || !cur.is_empty() {
        out.push(cur);
    }
    out
}
