//! Tarefas em segundo plano: o agente roda numa página do próprio studio aberta num navegador sem janela
//! (o "executor"), no PC ou na nuvem. Quem pediu (o celular) pode fechar o app: a conversa vai sendo gravada
//! e sincroniza sozinha, as permissões pedidas pelo agente chegam a qualquer tela aberta e, no fim, vai uma
//! notificação pela central.
//!
//! O executor é o mesmo agente da interface (07-agente.js): nada de uma segunda implementação para manter.

use crate::app::App;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

#[derive(Clone)]
struct Job {
    id: String,
    conv: String,
    title: String,
    state: &'static str,
    created: u64,
    finished: u64,
    note: String,
    /// O que o agente está fazendo agora ("Pesquisando na web", "Escrevendo a resposta"), para quem pediu.
    progress: String,
    /// Última notícia do executor sobre esta tarefa.
    pat: u64,
    /// Quem pediu (id do aparelho): o aviso de erro aparece só nele.
    origin: String,
    /// A resposta final (rede de segurança: se a conversa não sincronizar, quem pediu ainda recebe o texto).
    result: String,
}

#[derive(Default)]
struct St {
    jobs: Vec<Job>,
    answers: Vec<Value>,
    runner: Option<tokio::process::Child>,
    runner_seen: Option<Instant>,
    /// Última vez que a página do executor pediu tarefa ou deu batida (prova de que ela carregou).
    polled: Option<Instant>,
    activity: Option<Instant>,
}

fn st() -> &'static Mutex<St> {
    static S: OnceLock<Mutex<St>> = OnceLock::new();
    S.get_or_init(Default::default)
}

fn wake() -> &'static tokio::sync::Notify {
    static N: OnceLock<tokio::sync::Notify> = OnceLock::new();
    N.get_or_init(tokio::sync::Notify::new)
}

/// Chave do executor desta execução do studio. Na nuvem o contêiner só aceita pedidos da central (com o
/// segredo dela); o executor roda dentro do próprio contêiner e entra com esta chave num cookie.
pub fn exec_token() -> &'static str {
    static T: OnceLock<String> = OnceLock::new();
    T.get_or_init(|| {
        let mut b = [0u8; 32];
        let ok = std::fs::File::open("/dev/urandom").and_then(|mut f| std::io::Read::read_exact(&mut f, &mut b)).is_ok();
        if !ok {
            use sha2::Digest;
            let seed = format!("{:?}{}{:p}", std::time::SystemTime::now(), std::process::id(), &b);
            b.copy_from_slice(&sha2::Sha256::digest(seed.as_bytes()));
        }
        b.iter().map(|x| format!("{x:02x}")).collect()
    })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn pub_job(j: &Job) -> Value {
    json!({ "id": j.id, "conv": j.conv, "title": j.title, "state": j.state, "created": j.created, "finished": j.finished, "note": j.note, "progress": j.progress, "pat": j.pat, "result": j.result, "origin": j.origin })
}

/// Fecha um executor que sobrou de uma execução anterior do studio (atualização, reinício): ele segura a pasta
/// do perfil e o novo navegador desiste ("SingletonLock: File exists"), deixando as tarefas presas na fila.
fn kill_orphans(profile: &std::path::Path) {
    #[cfg(unix)]
    {
        // SingletonLock aponta para "máquina-PID"; só mata se o processo for mesmo um navegador com este perfil
        if let Ok(t) = std::fs::read_link(profile.join("SingletonLock")) {
            let pid = t.to_string_lossy().rsplit('-').next().and_then(|p| p.parse::<i32>().ok());
            if let Some(pid) = pid.filter(|p| *p > 1 && *p != std::process::id() as i32) {
                let cmd = std::fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
                let flag = format!("--user-data-dir={}", profile.display());
                if String::from_utf8_lossy(&cmd).split('\0').any(|a| a == flag) {
                    let _ = std::process::Command::new("kill").args(["-9", &pid.to_string()]).status();
                    std::thread::sleep(Duration::from_millis(300));
                }
            }
        }
        for f in ["SingletonLock", "SingletonSocket", "SingletonCookie"] {
            let _ = std::fs::remove_file(profile.join(f));
        }
    }
    #[cfg(windows)]
    {
        let p = profile.display().to_string().replace('\'', "''");
        let ps = format!("Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' or Name='chrome.exe' or Name='chromium.exe'\" | Where-Object {{ $_.CommandLine -like '*--user-data-dir={p}*' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}");
        let mut c = std::process::Command::new("powershell");
        c.args(["-NoProfile", "-NonInteractive", "-Command", &ps]);
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(crate::CREATE_NO_WINDOW);
        }
        let _ = c.status();
    }
}

/// Liga o executor (navegador sem janela apontando para a própria interface) se ainda não estiver de pé.
fn ensure_runner(app: &App) -> Result<(), String> {
    let mut s = st().lock().unwrap();
    if let Some(c) = s.runner.as_mut() {
        if c.try_wait().ok().flatten().is_none() {
            return Ok(());
        }
    }
    let exe = crate::browser::find_exe().ok_or(L!(
        "Não achei um navegador (Edge, Chrome ou Chromium) para rodar a tarefa em segundo plano.",
        "Couldn't find a browser (Edge, Chrome or Chromium) to run the task in the background."
    ))?;
    let port = *crate::cloud::PORT.get().unwrap_or(&app.cfg().port);
    let profile = app.root.join("executor");
    let _ = std::fs::create_dir_all(&profile);
    // primeira vez nesta execução do studio: um executor antigo pode ter ficado para trás
    if s.runner.is_none() {
        kill_orphans(&profile);
    }
    // o cache do navegador do executor só cresce e não serve para nada entre tarefas: fica fora do perfil,
    // limitado a 50 MB, e é apagado toda vez que o executor sobe
    let cache = app.root.join("cache").join("executor");
    let _ = std::fs::remove_dir_all(&cache);
    for d in ["Default/Cache", "Default/Code Cache", "Default/GPUCache", "Default/Service Worker/CacheStorage", "Default/Service Worker/ScriptCache", "GrShaderCache", "ShaderCache"] {
        let _ = std::fs::remove_dir_all(profile.join(d));
    }
    let mut cmd = tokio::process::Command::new(exe);
    cmd.args([
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--mute-audio",
        &format!("--user-data-dir={}", profile.display()),
        &format!("--disk-cache-dir={}", cache.display()),
        "--disk-cache-size=52428800",
    ]);
    // como root o Chrome não abre com o sandbox dele (Linux)
    let root = std::fs::read_to_string("/proc/self/status").ok().and_then(|t| t.lines().find(|l| l.starts_with("Uid:")).map(|l| l.split_whitespace().nth(1) == Some("0"))).unwrap_or(false);
    if crate::app::cloud() || root {
        // dentro do contêiner o isolamento é o próprio contêiner (sem namespaces para o sandbox do Chrome)
        cmd.args(["--no-sandbox", "--disable-dev-shm-usage"]);
    }
    cmd.arg(format!("http://127.0.0.1:{port}/__exec?k={}", exec_token()));
    // o que o navegador reclamar fica em executor.log (para entender quando ele não sobe)
    let log = std::fs::File::create(app.root.join("executor.log")).map(std::process::Stdio::from).unwrap_or_else(|_| std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null()).stderr(log).kill_on_drop(true);
    #[cfg(windows)]
    {
        cmd.creation_flags(crate::CREATE_NO_WINDOW);
    }
    let child = cmd.spawn().map_err(|e| e.to_string())?;
    s.runner = Some(child);
    s.runner_seen = Some(Instant::now());
    Ok(())
}

pub fn start(app: &App, conv: &str, title: &str, origin: &str) -> Result<Value, String> {
    if !crate::uistate::valid_key(&format!("c-{conv}")) {
        return Err("conversa".into());
    }
    {
        let mut s = st().lock().unwrap();
        if s.jobs.iter().any(|j| j.conv == conv && matches!(j.state, "queued" | "running")) {
            return Err(L!("Essa conversa já está rodando em segundo plano.", "This chat is already running in the background.").into());
        }
        let id = format!("{:x}", now_ms());
        s.jobs.push(Job { id: id.clone(), conv: conv.into(), title: title.chars().take(80).collect(), state: "queued", created: now_ms(), finished: 0, note: String::new(), progress: String::new(), pat: 0, result: String::new(), origin: origin.chars().take(40).collect() });
        let keep = s.jobs.len().saturating_sub(30);
        s.jobs.drain(..keep);
        s.activity = Some(Instant::now());
    }
    ensure_runner(app)?;
    wake().notify_waiters();
    let s = st().lock().unwrap();
    Ok(pub_job(s.jobs.last().unwrap()))
}

/// Sinal de vida do executor (qualquer pedido dele).
pub fn touch() {
    if let Ok(mut s) = st().lock() {
        s.runner_seen = Some(Instant::now());
    }
}

/// O executor conta o que está fazendo (vale também como sinal de vida da tarefa).
pub fn progress(v: &Value) {
    let id = v["job"].as_str().unwrap_or("");
    let text: String = v["text"].as_str().unwrap_or("").chars().take(160).collect();
    let mut s = st().lock().unwrap();
    if let Some(j) = s.jobs.iter_mut().find(|j| j.id == id && (j.state == "running" || j.state == "queued")) {
        j.progress = text;
        j.pat = now_ms();
    }
    s.runner_seen = Some(Instant::now());
    s.activity = Some(Instant::now());
}

pub fn list() -> Value {
    let s = st().lock().unwrap();
    // vivo = a página do executor pediu tarefa há pouco (o processo de pé não garante que ela carregou)
    let alive = s.polled.is_some_and(|t| t.elapsed() < Duration::from_secs(60));
    json!({ "jobs": s.jobs.iter().rev().map(pub_job).collect::<Vec<_>>(), "executor": alive })
}

/// O executor pede a próxima tarefa (espera até `wait` segundos).
pub async fn next(wait: u64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(wait.min(30));
    loop {
        let notified = wake().notified();
        {
            let mut s = st().lock().unwrap();
            s.runner_seen = Some(Instant::now());
            s.polled = Some(Instant::now());
            if let Some(j) = s.jobs.iter_mut().find(|j| j.state == "queued") {
                j.state = "running";
                let v = pub_job(j);
                s.activity = Some(Instant::now());
                return json!({ "job": v });
            }
        }
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return json!({});
        }
        let _ = tokio::time::timeout(left, notified).await;
    }
}

/// Batida do executor enquanto roda (as respostas de permissão e os pedidos de parar vão junto).
pub fn answers() -> Value {
    let mut s = st().lock().unwrap();
    s.runner_seen = Some(Instant::now());
    s.polled = Some(Instant::now());
    s.activity = Some(Instant::now());
    json!({ "answers": std::mem::take(&mut s.answers) })
}

/// Uma tela respondeu a um pedido de permissão (ou pediu para parar) de uma tarefa em segundo plano.
pub fn answer(v: Value) {
    let mut s = st().lock().unwrap();
    // parar uma tarefa que ainda está na fila: sai da fila na hora (o executor nem chegou a pegar)
    if let Some(conv) = v["stop"].as_str() {
        if let Some(j) = s.jobs.iter_mut().find(|j| j.conv == conv && j.state == "queued") {
            j.state = "error";
            j.finished = now_ms();
            j.note = L!("Você parou a tarefa.", "You stopped the task.").into();
            return;
        }
    }
    s.answers.push(v);
    if s.answers.len() > 200 {
        s.answers.remove(0);
    }
}

pub async fn done(app: Arc<App>, v: &Value) {
    let id = v["job"].as_str().unwrap_or("");
    let ok = v["ok"].as_bool().unwrap_or(true);
    let (title, conv) = {
        let mut s = st().lock().unwrap();
        s.activity = Some(Instant::now());
        let Some(j) = s.jobs.iter_mut().find(|j| j.id == id) else { return };
        j.state = if ok { "done" } else { "error" };
        j.finished = now_ms();
        j.note = v["note"].as_str().unwrap_or("").chars().take(300).collect();
        if let Some(t) = v["title"].as_str().filter(|t| !t.is_empty()) {
            j.title = t.chars().take(80).collect();
        }
        j.result = v["text"].as_str().unwrap_or("").chars().take(60_000).collect();
        (j.title.clone(), j.conv.clone())
    };
    let text: String = v["text"].as_str().unwrap_or("").split_whitespace().collect::<Vec<_>>().join(" ").chars().take(160).collect();
    let head = if ok { LF!("Pronto: {title}", "Done: {title}") } else { LF!("A tarefa parou: {title}", "The task stopped: {title}") };
    crate::cloud::notify(&app, &head, &text, &format!("/?c={conv}")).await;
}

/// O agente parou esperando uma permissão: notifica (no máximo uma vez por minuto por tarefa).
pub async fn ask(app: Arc<App>, v: &Value) {
    let id = v["job"].as_str().unwrap_or("");
    let found = {
        let s = st().lock().unwrap();
        s.jobs.iter().find(|j| j.id == id).map(|j| (j.title.clone(), j.conv.clone()))
    };
    let Some((title, conv)) = found else { return };
    static LAST: OnceLock<Mutex<std::collections::HashMap<String, Instant>>> = OnceLock::new();
    {
        let mut m = LAST.get_or_init(Default::default).lock().unwrap();
        if m.get(id).is_some_and(|t| t.elapsed() < Duration::from_secs(60)) {
            return;
        }
        m.insert(id.to_string(), Instant::now());
    }
    if v["kind"].as_str() == Some("question") {
        crate::cloud::notify(&app, &LF!("Uma pergunta para você: {title}", "A question for you: {title}"), v["text"].as_str().filter(|t| !t.is_empty()).unwrap_or(L!("O agente parou e está esperando sua resposta.", "The agent paused and is waiting for your answer.")), &format!("/?c={conv}")).await;
        return;
    }
    crate::cloud::notify(&app, &LF!("Precisa da sua permissão: {title}", "Needs your permission: {title}"), L!("O agente parou e está esperando você permitir uma ação.", "The agent paused and is waiting for you to allow an action."), &format!("/?c={conv}")).await;
}

/// Desliga o executor parado há 10 minutos e marca como erro a tarefa cujo executor sumiu.
pub async fn watch(app: Arc<App>) {
    loop {
        tokio::time::sleep(Duration::from_secs(20)).await;
        let lost = {
            let mut s = st().lock().unwrap();
            let busy = s.jobs.iter().any(|j| matches!(j.state, "queued" | "running"));
            let seen_ago = s.runner_seen.map(|t| t.elapsed()).unwrap_or(Duration::MAX);
            let alive = s.runner.as_mut().is_some_and(|c| c.try_wait().ok().flatten().is_none());
            if !busy && s.activity.is_none_or(|t| t.elapsed() > Duration::from_secs(600)) {
                if let Some(mut c) = s.runner.take() {
                    let _ = c.start_kill();
                }
            }
            let mut lost = vec![];
            // na fila há mais de 90 s e a página do executor não pede tarefa há 75 s: ele não subiu
            if s.polled.is_none_or(|t| t.elapsed() > Duration::from_secs(75)) {
                let now = now_ms();
                for j in s.jobs.iter_mut().filter(|j| j.state == "queued" && now.saturating_sub(j.created) > 90_000) {
                    j.state = "error";
                    j.finished = now;
                    j.note = L!("O navegador que roda as tarefas em segundo plano não iniciou. Rode nesta tela.", "The browser that runs background tasks didn't start. Run it on this screen.").into();
                    lost.push(j.clone());
                }
            }
            // rodando e o processo do executor morreu, ou está de pé mas sem dar nenhum sinal há 10 min
            // (travado). Sinal = qualquer pedido dele ao studio; uma tarefa longa de exploração faz vários.
            // (o processo pode ter passado a vez para outra janela do mesmo perfil: aí ela é que dá sinal)
            if busy && ((!alive && seen_ago > Duration::from_secs(60)) || seen_ago > Duration::from_secs(600)) {
                for j in s.jobs.iter_mut().filter(|j| j.state == "running") {
                    j.state = "error";
                    j.finished = now_ms();
                    j.note = L!("O executor caiu no meio da tarefa.", "The executor crashed mid-task.").into();
                    lost.push(j.clone());
                }
                if let Some(mut c) = s.runner.take() {
                    let _ = c.start_kill();
                }
            }
            (lost, busy && !alive)
        };
        for j in &lost.0 {
            crate::cloud::notify(&app, &LF!("A tarefa parou: {}", "The task stopped: {}", j.title), &j.note, &format!("/?c={}", j.conv)).await;
        }
        // ainda há tarefas na fila: sobe o executor de novo
        if lost.1 && st().lock().unwrap().jobs.iter().any(|j| j.state == "queued") {
            let _ = ensure_runner(&app);
        }
    }
}
