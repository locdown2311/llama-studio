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
}

#[derive(Default)]
struct St {
    jobs: Vec<Job>,
    answers: Vec<Value>,
    runner: Option<tokio::process::Child>,
    runner_seen: Option<Instant>,
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

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn pub_job(j: &Job) -> Value {
    json!({ "id": j.id, "conv": j.conv, "title": j.title, "state": j.state, "created": j.created, "finished": j.finished, "note": j.note })
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
    ]);
    // como root o Chrome não abre com o sandbox dele (Linux)
    let root = std::fs::read_to_string("/proc/self/status").ok().and_then(|t| t.lines().find(|l| l.starts_with("Uid:")).map(|l| l.split_whitespace().nth(1) == Some("0"))).unwrap_or(false);
    if crate::app::cloud() || root {
        // dentro do contêiner o isolamento é o próprio contêiner (sem namespaces para o sandbox do Chrome)
        cmd.args(["--no-sandbox", "--disable-dev-shm-usage"]);
    }
    cmd.arg(format!("http://127.0.0.1:{port}/?executor=1"));
    cmd.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    {
        cmd.creation_flags(crate::CREATE_NO_WINDOW);
    }
    let child = cmd.spawn().map_err(|e| e.to_string())?;
    s.runner = Some(child);
    s.runner_seen = Some(Instant::now());
    Ok(())
}

pub fn start(app: &App, conv: &str, title: &str) -> Result<Value, String> {
    if !crate::uistate::valid_key(&format!("c-{conv}")) {
        return Err("conversa".into());
    }
    {
        let mut s = st().lock().unwrap();
        if s.jobs.iter().any(|j| j.conv == conv && matches!(j.state, "queued" | "running")) {
            return Err(L!("Essa conversa já está rodando em segundo plano.", "This chat is already running in the background.").into());
        }
        let id = format!("{:x}", now_ms());
        s.jobs.push(Job { id: id.clone(), conv: conv.into(), title: title.chars().take(80).collect(), state: "queued", created: now_ms(), finished: 0, note: String::new() });
        let keep = s.jobs.len().saturating_sub(30);
        s.jobs.drain(..keep);
        s.activity = Some(Instant::now());
    }
    ensure_runner(app)?;
    wake().notify_waiters();
    let s = st().lock().unwrap();
    Ok(pub_job(s.jobs.last().unwrap()))
}

pub fn list() -> Value {
    let s = st().lock().unwrap();
    let alive = s.runner_seen.is_some_and(|t| t.elapsed() < Duration::from_secs(60));
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
    s.activity = Some(Instant::now());
    json!({ "answers": std::mem::take(&mut s.answers) })
}

/// Uma tela respondeu a um pedido de permissão (ou pediu para parar) de uma tarefa em segundo plano.
pub fn answer(v: Value) {
    let mut s = st().lock().unwrap();
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
            // rodando e o executor sem dar sinal há 90 s: caiu no meio
            let mut lost = vec![];
            if busy && (!alive || seen_ago > Duration::from_secs(90)) {
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
