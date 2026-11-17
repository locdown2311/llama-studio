//! Strata (github.com/Niko1221/Strata) como motor adicional: roda modelos grandes (Qwen3.8-Flash-Next e família,
//! até 125B) numa placa de 12 GB, espalhando o modelo entre placa, RAM e SSD.
//!
//! O Strata não é um llama-server: tem motor próprio, catálogo e preparo dos modelos. Por isso o studio usa o
//! terminal oficial dele (o mesmo do `install.ps1` / `install.sh` das versões publicadas), que escolhe o motor da
//! placa de vídeo, confere assinaturas e baixa o modelo. O studio só comanda:
//!
//! - instalar: baixa e roda o instalador oficial (sem administrador, sem mexer no PATH do Windows);
//! - catálogo: lê a tabela de modelos do próprio terminal, com o "cabe / pode ficar lento" desta máquina;
//! - iniciar: `strata launch --family F --model M --no-tui` (baixa o que faltar e serve na porta do studio);
//! - parar: `strata launch --stop`.
//!
//! Servindo, o Strata vira uma API do studio ("Strata", id `strata`) apontando para 127.0.0.1, então as conversas,
//! ferramentas e o agente funcionam igual às outras APIs.

use crate::app::{ApiProvider, App};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

pub const REPO: &str = "Niko1221/Strata";
/// Porta do servidor do Strata quando o studio inicia (a 8080, padrão dele, costuma estar em uso).
pub const PORT: u16 = 8095;
pub const PROVIDER_ID: &str = "strata";

fn feed() -> String {
    std::env::var("STRATA_FEED").unwrap_or_else(|_| format!("https://github.com/{REPO}/releases/latest/download"))
}

/// Pasta de dados do Strata (a mesma que o instalador oficial usa).
pub fn data_dir() -> PathBuf {
    if let Some(d) = std::env::var_os("STRATA_DATA_DIR") {
        return PathBuf::from(d);
    }
    if cfg!(windows) {
        if let Some(l) = std::env::var_os("LOCALAPPDATA") {
            return PathBuf::from(l).join("Strata");
        }
    }
    std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| crate::app::home_dir().join(".local").join("share")).join("strata")
}

fn term_root() -> PathBuf {
    data_dir().join("terminal").join("current")
}

/// O comando `strata` instalado.
pub fn cli() -> Option<PathBuf> {
    let r = term_root();
    let p = if cfg!(windows) { r.join("bin").join("strata.cmd") } else { r.join("bin").join("strata") };
    p.is_file().then_some(p)
}

/// O Python que vem com o terminal (para ler o catálogo).
fn python() -> Option<PathBuf> {
    let r = term_root();
    let c = if cfg!(windows) { vec![r.join("python").join("python.exe")] } else { vec![r.join("python").join("bin").join("python3"), r.join("python").join("bin").join("python")] };
    c.into_iter().find(|p| p.is_file()).or_else(|| if cfg!(windows) { None } else { crate::bins::which("python3") })
}

fn version() -> String {
    // terminal/current aponta para terminal/<versão> (junção no Windows, link no Linux)
    std::fs::canonicalize(term_root()).ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned())).filter(|v| v != "current").unwrap_or_default()
}

pub fn supported() -> bool {
    !crate::app::cloud() && (cfg!(windows) || cfg!(target_os = "linux")) && cfg!(target_arch = "x86_64")
}

fn command(exe: &std::path::Path) -> tokio::process::Command {
    let mut c = tokio::process::Command::new(exe);
    c.env("PYTHONUTF8", "1").env("PYTHONIOENCODING", "utf-8").env("NO_COLOR", "1").env("STRATA_NO_PATH", "1");
    c.stdin(std::process::Stdio::null());
    #[cfg(windows)]
    c.creation_flags(crate::CREATE_NO_WINDOW);
    c
}

/// Roda o `strata` com saída em JSON e devolve o JSON (ou o erro que ele disser).
async fn cli_json(args: &[&str], secs: u64) -> Result<Value, String> {
    let exe = cli().ok_or(L!("O Strata não está instalado.", "Strata isn't installed."))?;
    let mut c = command(&exe);
    c.args(args).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
    let o = tokio::time::timeout(Duration::from_secs(secs), c.output()).await.map_err(|_| L!("O Strata não respondeu a tempo.", "Strata didn't answer in time.").to_string())?.map_err(|e| e.to_string())?;
    let out = String::from_utf8_lossy(&o.stdout);
    let line = out.lines().rev().find(|l| l.trim_start().starts_with('{')).unwrap_or("");
    match serde_json::from_str::<Value>(line) {
        Ok(v) if v["ok"].as_bool() == Some(false) => Err(v["error"]["message"].as_str().unwrap_or("strata").to_string()),
        Ok(v) => Ok(v),
        Err(_) => {
            let err = String::from_utf8_lossy(&o.stderr);
            Err(err.lines().chain(out.lines()).filter(|l| !l.trim().is_empty()).last().unwrap_or("strata").trim().to_string())
        }
    }
}

// ---------------------------------------------------------------- tarefa em andamento (instalar / iniciar)

#[derive(Default)]
struct Job {
    kind: String,
    state: String,
    lines: Vec<String>,
    pct: Option<f64>,
    error: String,
    started: u64,
    child_pid: u32,
}

fn job() -> &'static Mutex<Option<Job>> {
    static J: OnceLock<Mutex<Option<Job>>> = OnceLock::new();
    J.get_or_init(Default::default)
}

fn job_json() -> Value {
    match job().lock().unwrap().as_ref() {
        Some(j) => json!({"kind": j.kind, "state": j.state, "lines": j.lines.iter().rev().take(12).rev().collect::<Vec<_>>(), "pct": j.pct, "error": j.error, "started": j.started}),
        None => Value::Null,
    }
}

fn push_line(raw: &str) {
    // as linhas de progresso usam \r; "Baixando o modelo… 34%" vira a porcentagem da tarefa
    for part in raw.split('\r') {
        let t = part.trim();
        if t.is_empty() {
            continue;
        }
        let mut g = job().lock().unwrap();
        let Some(j) = g.as_mut() else { return };
        if let Some(c) = regex_lite::Regex::new(r"(\d{1,3}(?:[.,]\d+)?)\s*%\s*$").unwrap().captures(t) {
            j.pct = c[1].replace(',', ".").parse().ok();
            // a mesma frase com outra porcentagem substitui a anterior
            let key = t.rsplit_once(char::is_whitespace).map(|x| x.0).unwrap_or(t);
            if j.lines.last().is_some_and(|l| l.starts_with(key.trim_end_matches(|c: char| c.is_ascii_digit() || c == '%' || c == ' '))) {
                j.lines.pop();
            }
        }
        j.lines.push(t.chars().take(1200).collect());
        if j.lines.len() > 300 {
            j.lines.remove(0);
        }
    }
}

fn busy() -> bool {
    job().lock().unwrap().as_ref().is_some_and(|j| j.state == "running")
}

fn begin(kind: &str) -> Result<(), String> {
    let mut g = job().lock().unwrap();
    if g.as_ref().is_some_and(|j| j.state == "running") {
        return Err(L!("O Strata já está fazendo outra coisa; espere terminar.", "Strata is already doing something else; wait for it to finish.").into());
    }
    *g = Some(Job { kind: kind.into(), state: "running".into(), started: crate::app::now_ms() as u64, ..Default::default() });
    Ok(())
}

fn finish(r: &Result<(), String>) {
    if let Some(j) = job().lock().unwrap().as_mut() {
        match r {
            Ok(()) => {
                j.state = "done".into();
                j.pct = Some(100.0);
            }
            Err(e) => {
                j.state = "error".into();
                j.error = e.clone();
            }
        }
    }
}

/// Roda um processo jogando as linhas na tarefa; erro se sair com código diferente de 0.
async fn run_streaming(mut c: tokio::process::Command) -> Result<(), String> {
    use tokio::io::AsyncReadExt;
    c.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    if let Some(j) = job().lock().unwrap().as_mut() {
        j.child_pid = child.id().unwrap_or(0);
    }
    let mut out = child.stdout.take().unwrap();
    let mut err = child.stderr.take().unwrap();
    let errs = Arc::new(Mutex::new(String::new()));
    let e2 = errs.clone();
    let et = tokio::spawn(async move {
        let mut buf = vec![0u8; 4096];
        while let Ok(n) = err.read(&mut buf).await {
            if n == 0 {
                break;
            }
            let s = String::from_utf8_lossy(&buf[..n]).into_owned();
            push_line(&s);
            let mut e = e2.lock().unwrap();
            e.push_str(&s);
            if e.len() > 8000 {
                let cut = e.len() - 8000;
                e.drain(..cut);
            }
        }
    });
    let mut buf = vec![0u8; 4096];
    let mut pending = String::new();
    while let Ok(n) = out.read(&mut buf).await {
        if n == 0 {
            break;
        }
        pending.push_str(&String::from_utf8_lossy(&buf[..n]));
        while let Some(i) = pending.find(['\n', '\r']) {
            let line: String = pending.drain(..=i).collect();
            push_line(&line);
        }
    }
    push_line(&pending);
    let st = child.wait().await.map_err(|e| e.to_string())?;
    let _ = et.await;
    if st.success() {
        return Ok(());
    }
    if job().lock().unwrap().as_ref().is_some_and(|j| j.error == "cancel") {
        return Err(L!("Cancelado.", "Cancelled.").into());
    }
    let last = {
        let g = job().lock().unwrap();
        g.as_ref().and_then(|j| j.lines.iter().rev().find(|l| l.contains("[X]") || l.to_lowercase().contains("error") || l.contains("strata:")).cloned())
    };
    Err(last.unwrap_or_else(|| LF!("O Strata parou com o código {}.", "Strata stopped with code {}.", st.code().unwrap_or(-1))))
}

pub fn cancel() {
    let pid = {
        let mut g = job().lock().unwrap();
        let Some(j) = g.as_mut().filter(|j| j.state == "running") else { return };
        j.error = "cancel".into();
        j.child_pid
    };
    if pid == 0 {
        return;
    }
    // a árvore toda: o terminal do Strata abre outros processos (Python, downloads)
    #[cfg(windows)]
    {
        let mut c = std::process::Command::new("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]);
        use std::os::windows::process::CommandExt;
        c.creation_flags(crate::CREATE_NO_WINDOW);
        let _ = c.status();
    }
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("pkill").args(["-TERM", "-P", &pid.to_string()]).status();
        let _ = std::process::Command::new("kill").args(["-TERM", &pid.to_string()]).status();
    }
}

// ---------------------------------------------------------------- estado

#[derive(serde::Serialize, serde::Deserialize, Default, Clone)]
struct Last {
    family: String,
    model: String,
    context: String,
    vision: String,
}

fn last_file(app: &App) -> PathBuf {
    app.root.join("strata.json")
}

/// O que o servidor do Strata está servindo nesta porta (modelo, contexto, aceita imagem), se já carregou.
async fn served(app: &App) -> Option<(String, u64, bool)> {
    let r = app.http.get(format!("http://127.0.0.1:{PORT}/v1/models")).timeout(Duration::from_secs(3)).send().await.ok()?;
    if !r.status().is_success() {
        return None;
    }
    let v: Value = serde_json::from_slice(&r.bytes().await.ok()?).ok()?;
    let m = &v["data"][0];
    let ctx = m["meta"]["n_ctx"].as_u64().or(m["context_length"].as_u64()).unwrap_or(0);
    let img = m["architecture"]["input_modalities"].as_array().is_some_and(|a| a.iter().any(|x| x == "image"));
    Some((m["id"].as_str()?.to_string(), ctx, img))
}

pub async fn status(app: &App) -> Value {
    let installed = cli().is_some();
    let srv = served(app).await;
    // o que o `strata launch` está servendo (em qualquer porta), sem travar a tela se o terminal demorar
    let running = if installed && !busy() { cli_json(&["launch", "--status", "--output", "json"], 20).await.ok().map(|v| v["running"].clone()) } else { None };
    let last: Last = crate::app::read_json(&last_file(app)).unwrap_or_default();
    json!({
        "supported": supported(),
        "installed": installed,
        "version": version(),
        "dataDir": data_dir(),
        "port": PORT,
        "serving": srv.as_ref().map(|s| json!({"model": s.0, "context": s.1, "vision": s.2, "url": format!("http://127.0.0.1:{PORT}/v1")})),
        "running": running,
        "job": job_json(),
        "last": last,
        "provider": app.cfg().api_providers.iter().any(|p| p.id == PROVIDER_ID),
        "repo": REPO,
    })
}

/// A tabela de modelos do terminal do Strata, com o que cabe nesta máquina.
pub async fn catalog() -> Result<Value, String> {
    static CACHE: OnceLock<Mutex<Option<(Instant, String, Value)>>> = OnceLock::new();
    let ver = version();
    if let Some((t, v, c)) = CACHE.get_or_init(Default::default).lock().unwrap().as_ref() {
        if t.elapsed() < Duration::from_secs(600) && *v == ver {
            return Ok(c.clone());
        }
    }
    let py = python().ok_or(L!("Não achei o Python do terminal do Strata. Reinstale o Strata.", "Couldn't find the Strata terminal's Python. Reinstall Strata."))?;
    let root = term_root();
    let script = r#"
import json, sys, dataclasses
sys.path.insert(0, sys.argv[1])
from strata_cli.launch import catalog
c = catalog.Catalog()
hw = c.hardware()
rows = [dataclasses.asdict(r) for r in c.rows(hw)]
try: un = [{"title": t, "why": w} for t, w in c.unavailable(hw)]
except Exception: un = []
try: ctx = c.contexts()
except Exception: ctx = []
gpus = [{"name": g.get("name"), "vram_gb": g.get("vram_gb") or g.get("vramGb")} for g in (hw.get("gpus") or [])]
print(json.dumps({"rows": rows, "recommended": c.recommendation(hw), "unavailable": un, "contexts": ctx, "ram_gb": hw.get("ram_gb"), "gpus": gpus}))
"#;
    let mut c = command(&py);
    c.arg("-c").arg(script).arg(&root).current_dir(&root).env("PYTHONNOUSERSITE", "1").env_remove("PYTHONHOME").env_remove("PYTHONPATH");
    c.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
    let o = tokio::time::timeout(Duration::from_secs(90), c.output()).await.map_err(|_| L!("O catálogo do Strata não respondeu a tempo.", "Strata's catalog didn't answer in time.").to_string())?.map_err(|e| e.to_string())?;
    let out = String::from_utf8_lossy(&o.stdout);
    let line = out.lines().rev().find(|l| l.starts_with('{')).unwrap_or("");
    let v: Value = serde_json::from_str(line).map_err(|_| {
        let e = String::from_utf8_lossy(&o.stderr);
        LF!("Não consegui ler o catálogo do Strata: {}", "Couldn't read Strata's catalog: {}", e.lines().filter(|l| !l.trim().is_empty()).last().unwrap_or("?"))
    })?;
    *CACHE.get().unwrap().lock().unwrap() = Some((Instant::now(), ver, v.clone()));
    Ok(v)
}

// ---------------------------------------------------------------- ações

/// Baixa e roda o instalador oficial do terminal do Strata.
pub async fn install(app: Arc<App>) -> Result<(), String> {
    if !supported() {
        return Err(L!("O Strata roda no Windows ou Linux de 64 bits (x86), fora da nuvem.", "Strata runs on 64-bit (x86) Windows or Linux, outside the cloud.").into());
    }
    begin("install")?;
    tokio::spawn(async move {
        let r = async {
            let name = if cfg!(windows) { "install.ps1" } else { "install.sh" };
            push_line(&LF!("Baixando o instalador oficial ({}/{name})...", "Downloading the official installer ({}/{name})...", REPO));
            let r = app.web.get(format!("{}/{name}", feed())).header("User-Agent", "llama-studio").timeout(Duration::from_secs(120)).send().await.map_err(|e| e.to_string())?;
            if !r.status().is_success() {
                return Err(LF!("Não consegui baixar o instalador (HTTP {}).", "Couldn't download the installer (HTTP {}).", r.status().as_u16()));
            }
            let body = r.bytes().await.map_err(|e| e.to_string())?;
            let dir = app.root.join("cache").join("strata");
            let _ = std::fs::create_dir_all(&dir);
            let f = dir.join(name);
            std::fs::write(&f, &body).map_err(|e| e.to_string())?;
            let mut c = if cfg!(windows) {
                let mut c = command(&PathBuf::from("powershell"));
                c.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]).arg(&f);
                c
            } else {
                let mut c = command(&PathBuf::from("sh"));
                c.arg(&f);
                c
            };
            c.current_dir(&dir);
            run_streaming(c).await?;
            if cli().is_none() {
                return Err(L!("O instalador terminou, mas o comando strata não apareceu.", "The installer finished, but the strata command didn't show up.").into());
            }
            Ok(())
        }
        .await;
        finish(&r);
    });
    Ok(())
}

/// Inicia um modelo (baixa motor e modelo se faltar) e liga a API "Strata" do studio a ele.
pub async fn launch(app: Arc<App>, family: String, model: String, context: String, vision: String) -> Result<(), String> {
    let exe = cli().ok_or(L!("Instale o Strata primeiro.", "Install Strata first."))?;
    let ok = |s: &str| !s.is_empty() && s.len() < 40 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'));
    if !ok(&family) || !ok(&model) || (!context.is_empty() && !ok(&context)) || (!vision.is_empty() && !ok(&vision)) {
        return Err(L!("Modelo inválido.", "Invalid model.").into());
    }
    begin("launch")?;
    // a placa de vídeo fica para o Strata: o modelo do llama.cpp sai da memória
    app.llama.stop();
    let last = Last { family: family.clone(), model: model.clone(), context: context.clone(), vision: vision.clone() };
    let _ = std::fs::write(last_file(&app), serde_json::to_vec_pretty(&last).unwrap());
    tokio::spawn(async move {
        let r = async {
            let port = PORT.to_string();
            let mut args = vec!["launch", "--family", &family, "--model", &model, "--port", &port, "--access", "local", "--yes", "--no-tui"];
            if !context.is_empty() {
                args.extend(["--context", &context]);
            }
            if !vision.is_empty() {
                args.extend(["--vision", &vision]);
            }
            let mut c = command(&exe);
            c.args(&args);
            run_streaming(c).await?;
            // espera o servidor responder (o modelo pode levar minutos para carregar)
            push_line(L!("Esperando o servidor do Strata responder...", "Waiting for the Strata server to answer..."));
            let t0 = Instant::now();
            let (id, ctx, img) = loop {
                if let Some(s) = served(&app).await {
                    break s;
                }
                if t0.elapsed() > Duration::from_secs(900) {
                    return Err(L!("O Strata não respondeu na porta depois de 15 minutos.", "Strata didn't answer on the port after 15 minutes.").to_string());
                }
                tokio::time::sleep(Duration::from_secs(3)).await;
            };
            connect(&app, &id, ctx, img);
            push_line(&LF!("Pronto: {id} está servindo. Escolha \"Strata\" na lista de modelos.", "Ready: {id} is serving. Pick \"Strata\" in the model list."));
            Ok(())
        }
        .await;
        finish(&r);
    });
    Ok(())
}

/// Cria (ou atualiza) a API "Strata" do studio apontando para o servidor local.
fn connect(app: &App, model: &str, ctx: u64, vision: bool) {
    {
        let mut c = app.config.write().unwrap();
        let p = ApiProvider {
            id: PROVIDER_ID.into(),
            name: "Strata".into(),
            base: format!("http://127.0.0.1:{PORT}/v1"),
            model: model.into(),
            context: if ctx >= 1024 { ctx.min(u32::MAX as u64) as u32 } else { 131072 },
            vision,
            ..Default::default()
        };
        match c.api_providers.iter_mut().find(|x| x.id == PROVIDER_ID) {
            Some(x) => {
                x.base = p.base;
                x.model = p.model;
                x.context = p.context;
                x.vision = p.vision;
            }
            None => c.api_providers.push(p),
        }
    }
    app.save_config();
}

/// Liga a API "Strata" a um servidor que já está servindo na porta do studio.
pub async fn attach(app: &App) -> Result<(), String> {
    let (id, ctx, img) = served(app).await.ok_or(LF!("Nenhum Strata servindo em 127.0.0.1:{PORT}.", "No Strata serving at 127.0.0.1:{PORT}."))?;
    connect(app, &id, ctx, img);
    Ok(())
}

pub async fn stop() -> Result<Value, String> {
    if cli().is_none() {
        return Err(L!("O Strata não está instalado.", "Strata isn't installed.").into());
    }
    let exe = cli().unwrap();
    let mut c = command(&exe);
    c.args(["launch", "--stop"]).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
    let o = tokio::time::timeout(Duration::from_secs(120), c.output()).await.map_err(|_| "timeout".to_string())?.map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&o.stdout).trim().to_string();
    Ok(json!({"message": text}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_lines() {
        *job().lock().unwrap() = Some(Job { state: "running".into(), ..Default::default() });
        push_line("    Checking the engine for this computer…\n");
        push_line("\r  Downloading the model… 10%   \r  Downloading the model… 20%   ");
        push_line("Downloading the model… 30%");
        let g = job().lock().unwrap();
        let j = g.as_ref().unwrap();
        assert_eq!(j.pct, Some(30.0));
        assert_eq!(j.lines.len(), 2, "{:?}", j.lines);
        assert!(j.lines[1].ends_with("30%"));
    }
}
