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
    /// onde o llama-server guarda o cache de cada conversa (--slot-save-path)
    pub kv_dir: PathBuf,
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
    pub fn new(llama_dir: &Path, app_dir: &Path, root: &Path) -> Self {
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
            kv_dir: root.join("kvcache"),
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
        self.args_for(None).0
    }

    /// Monta os argumentos. Com `help` (saída do --help do motor), tira o que o motor não aceita
    /// (ex.: opções novas do llama.cpp no ik_llama.cpp) e devolve o que foi ignorado.
    fn args_for(&self, help: Option<&Help>) -> (String, Vec<String>) {
        let c = self.cfg();
        let has = |f: &str| help.map(|h| h.flags.contains(f)).unwrap_or(true);
        let mut a = vec![format!("-m \"{}\"", c.model), format!("--host {} --port {}", c.bind_host, c.port), format!("-c {}", c.context)];
        if c.cpu_moe > 0 {
            if has("--n-cpu-moe") {
                a.push(format!("--n-cpu-moe {}", c.cpu_moe));
            } else if has("-ncmoe") {
                a.push(format!("-ncmoe {}", c.cpu_moe));
            } else {
                // equivalente com -ot: especialistas das N primeiras camadas na CPU
                let layers: Vec<String> = (0..c.cpu_moe).map(|i| i.to_string()).collect();
                a.push(format!("-ot \"blk\\.({})\\.ffn_(up|down|gate)_exps.*=CPU\"", layers.join("|")));
            }
        }
        if c.threads > 0 {
            a.push(format!("-t {}", c.threads));
        }
        let mut dropped = vec![];
        if !c.extra_args.trim().is_empty() {
            match help {
                Some(h) => {
                    let (kept, d) = filter_args(&c.extra_args, h);
                    dropped = d;
                    if !kept.is_empty() {
                        a.push(kept);
                    }
                }
                None => a.push(c.extra_args.trim().to_string()),
            }
        }
        if self.studio_page.is_dir() && !c.extra_args.contains("--path") && has("--path") {
            a.push(format!("--path \"{}\"", self.studio_page.display()));
        }
        if !c.extra_args.contains("--slot-save-path") && help.is_some_and(|h| h.flags.contains("--slot-save-path")) {
            let _ = std::fs::create_dir_all(&self.kv_dir);
            a.push(format!("--slot-save-path \"{}\"", self.kv_dir.display()));
        }
        (a.join(" "), dropped)
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
            return Err(LF!("llama-server não encontrado: {}", "llama-server not found: {}", c.server_exe));
        }
        if !Path::new(&c.model).is_file() {
            return Err(LF!("Modelo não encontrado: {}", "Model not found: {}", c.model));
        }
        // não sobe um segundo servidor na mesma porta
        let host = if c.bind_host.trim().is_empty() || c.bind_host == "0.0.0.0" { "127.0.0.1" } else { c.bind_host.trim() };
        if let Ok(addr) = format!("{host}:{}", c.port).parse::<std::net::SocketAddr>() {
            if std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
                return Err(LF!("Já existe um llama-server (ou outro programa) usando a porta {}. O studio usa esse; para iniciar pelo studio, feche o outro antes.", "A llama-server (or another program) is already using port {}. The studio uses that one; to start it from the studio, close the other one first.", c.port));
            }
        }
        let help = engine_help(&c.server_exe);
        let (args, dropped) = self.args_for(help.as_ref());
        if !dropped.is_empty() {
            self.push_log(LF!("Ignorado (este motor não aceita): {}", "Ignored (this engine does not accept it): {}", dropped.join(" ")));
        }
        self.push_log(LF!("Iniciando: \"{}\" {}", "Starting: \"{}\" {}", c.server_exe, args));
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
        let mut child = cmd.spawn().map_err(|e| LF!("Erro ao iniciar: {e}", "Error starting: {e}"))?;
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
                Some(c) => LF!("Servidor encerrado (código {c}).", "Server exited (code {c})."),
                None => L!("Servidor parado.", "Server stopped.").into(),
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
        // Seguidas sem resposta. Durante uma geração pesada (MoE na CPU, prompt longo) o
        // llama-server pode demorar para atender o /health: isso NÃO é "carregando".
        let mut misses = 0u32;
        loop {
            let url = format!("{}/health", app.llama.cfg().base_url());
            // 200 = pronto; 503 = carregando; sem resposta = ocupado ou fora do ar
            let health = match app.http.get(&url).timeout(Duration::from_secs(8)).send().await {
                Ok(r) if r.status().is_success() => 2,
                Ok(r) if r.status().as_u16() == 503 => 1,
                Ok(_) => 2, // respondeu algo: está de pé
                Err(_) => 0,
            };
            misses = if health == 0 { misses + 1 } else { 0 };
            let ours = app.llama.is_running();
            let prev = app.llama.state();
            let s = match (ours, health) {
                (true, 2) => "ready",
                (true, 1) => "loading",
                // processo nosso vivo e já estava pronto: só está ocupado
                (true, _) if prev == "ready" => "ready",
                (true, _) => "loading",
                (false, 2) => "external",
                (false, 1) => "external-loading",
                // externo pronto que parou de responder: espera ~30 s antes de dar como parado
                (false, _) if (prev == "external" || prev == "external-loading") && misses < 4 => sticky(prev),
                (false, _) => "stopped",
            };
            app.llama.set_state(&app, s);
            let wait = if s.ends_with("loading") { 1 } else { 5 };
            tokio::time::sleep(Duration::from_secs(wait)).await;
        }
    }
}

fn sticky(s: String) -> &'static str {
    match s.as_str() {
        "external" => "external",
        _ => "external-loading",
    }
}


// ---------------------------------------------------------------- compatibilidade de argumentos entre motores

pub struct Help {
    pub flags: std::collections::HashSet<String>,
    /// opções que aceitam valor on|off|auto (o -fa no llama.cpp novo; no ik_llama é só -fa)
    fa_takes_value: bool,
}

static HELP: Mutex<Option<std::collections::HashMap<String, (u64, Option<std::sync::Arc<Help>>)>>> = Mutex::new(None);

/// Lê (e guarda) as opções que o llama-server aceita, pelo --help.
pub fn engine_help(exe: &str) -> Option<Help> {
    let mtime = std::fs::metadata(exe).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    if let Some((t, h)) = HELP.lock().unwrap().as_ref().and_then(|m| m.get(exe)) {
        if *t == mtime {
            return h.as_ref().map(|h| Help { flags: h.flags.clone(), fa_takes_value: h.fa_takes_value });
        }
    }
    let mut c = std::process::Command::new(exe);
    c.arg("--help").stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(crate::CREATE_NO_WINDOW);
    }
    let parsed = (|| {
        let mut child = c.spawn().ok()?;
        let t0 = std::time::Instant::now();
        loop {
            if child.try_wait().ok()?.is_some() {
                break;
            }
            if t0.elapsed() > Duration::from_secs(15) {
                let _ = child.kill();
                return None;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let o = child.wait_with_output().ok()?;
        let text = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
        let re = regex_lite::Regex::new(r"(?m)(?:^|[\s,])(--?[a-zA-Z][a-zA-Z0-9-]*)").unwrap();
        let flags: std::collections::HashSet<String> = re.captures_iter(&text).map(|m| m[1].to_string()).collect();
        if flags.len() < 30 {
            return None; // não parece um --help de verdade: não filtra nada
        }
        let fa_line = text.lines().find(|l| l.contains("-fa,") || l.contains("--flash-attn")).unwrap_or("");
        let fa_takes_value = fa_line.contains("on") && (fa_line.contains("off") || fa_line.contains("auto"));
        Some(Help { flags, fa_takes_value })
    })();
    let stored = parsed.as_ref().map(|h| std::sync::Arc::new(Help { flags: h.flags.clone(), fa_takes_value: h.fa_takes_value }));
    HELP.lock().unwrap().get_or_insert_with(Default::default).insert(exe.to_string(), (mtime, stored));
    parsed
}

/// Divide uma linha de comando respeitando aspas (e \" dentro delas).
pub fn split_args(s: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut started = false;
    let mut it = s.chars().peekable();
    while let Some(ch) = it.next() {
        match quote {
            Some('"') if ch == '\\' && it.peek() == Some(&'"') => {
                it.next();
                cur.push('"');
            }
            Some(q) if ch == q => quote = None,
            Some(_) => cur.push(ch),
            None if ch == '"' || ch == '\'' => {
                quote = Some(ch);
                started = true;
            }
            None if ch.is_whitespace() => {
                if started || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                    started = false;
                }
            }
            None => cur.push(ch),
        }
    }
    if started || !cur.is_empty() {
        out.push(cur);
    }
    out
}

pub fn quote_arg(a: &str) -> String {
    if a.is_empty() || a.contains(char::is_whitespace) || a.contains('"') {
        format!("\"{}\"", a.replace('"', "\\\""))
    } else {
        a.to_string()
    }
}

fn is_flag(t: &str) -> bool {
    t.starts_with('-') && t.len() > 1 && !t[1..].starts_with(|c: char| c.is_ascii_digit() || c == '.')
}

/// Tira as opções que o motor não conhece (com o valor delas).
fn filter_args(extra: &str, h: &Help) -> (String, Vec<String>) {
    let toks = split_args(extra);
    let mut kept = vec![];
    let mut dropped = vec![];
    let mut i = 0;
    while i < toks.len() {
        let t = &toks[i];
        let flag = t.split('=').next().unwrap_or(t);
        let has_value = i + 1 < toks.len() && !is_flag(&toks[i + 1]) && !t.contains('=');
        if is_flag(t) && !h.flags.contains(flag) {
            dropped.push(t.clone());
            if has_value {
                dropped.push(toks[i + 1].clone());
                i += 1;
            }
        } else if (flag == "-fa" || flag == "--flash-attn") && !h.fa_takes_value {
            // ik_llama.cpp: -fa sem valor
            let v = if has_value { toks[i + 1].to_lowercase() } else { String::new() };
            if matches!(v.as_str(), "on" | "off" | "auto" | "1" | "0" | "true" | "false") {
                i += 1;
            }
            if v != "off" && v != "0" && v != "false" {
                kept.push(flag.to_string());
            }
        } else {
            kept.push(quote_arg(t));
        }
        i += 1;
    }
    (kept.join(" "), dropped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filtra_para_motor_antigo() {
        let flags: std::collections::HashSet<String> = ["-ngl", "-fa", "-b", "-ub", "--jinja", "--temp", "-ctk", "-ctv"].iter().map(|s| s.to_string()).collect();
        let h = Help { flags, fa_takes_value: false };
        let (k, d) = filter_args("-ngl 99 -fa on -ctk q8_0 --kv-unified --ctx-checkpoints 32 --jinja --reasoning-budget-message \"I have to answer now.\" --temp 0.6", &h);
        assert_eq!(k, "-ngl 99 -fa -ctk q8_0 --jinja --temp 0.6");
        assert_eq!(d, vec!["--kv-unified", "--ctx-checkpoints", "32", "--reasoning-budget-message", "I have to answer now."]);
    }
}
