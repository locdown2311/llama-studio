//! "Otimizar para meu PC": roda o llama-bench do motor com algumas combinações de
//! microlote (-ub) e threads, escolhe a mais rápida e grava no perfil do modelo.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::app::App;

#[derive(Default)]
struct State {
    running: bool,
    model: String,
    done: usize,
    total: usize,
    rows: Vec<Value>,
    log: Vec<String>,
    result: Option<Value>,
    error: Option<String>,
}

static ST: Mutex<Option<State>> = Mutex::new(None);
static CANCEL: AtomicBool = AtomicBool::new(false);

pub fn status() -> Value {
    let g = ST.lock().unwrap();
    match g.as_ref() {
        None => json!({"running": false}),
        Some(s) => json!({"running": s.running, "model": s.model, "done": s.done, "total": s.total, "rows": s.rows, "log": s.log.iter().rev().take(12).rev().collect::<Vec<_>>(), "result": s.result, "error": s.error}),
    }
}

pub fn cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

fn with<F: FnOnce(&mut State)>(f: F) {
    if let Some(s) = ST.lock().unwrap().as_mut() {
        f(s);
    }
}

/// Valor de uma opção nos argumentos (ex.: "-ub" -> "512").
fn arg_val(toks: &[String], names: &[&str]) -> Option<String> {
    toks.iter().position(|t| names.contains(&t.as_str())).and_then(|i| toks.get(i + 1)).cloned()
}

fn set_arg(extra: &str, names: &[&str], val: &str) -> String {
    let mut toks = crate::llama::split_args(extra);
    match toks.iter().position(|t| names.contains(&t.as_str())) {
        Some(i) if i + 1 < toks.len() => toks[i + 1] = val.to_string(),
        Some(i) => toks.insert(i + 1, val.to_string()),
        None => {
            toks.push(names[0].to_string());
            toks.push(val.to_string());
        }
    }
    toks.iter().map(|t| crate::llama::quote_arg(t)).collect::<Vec<_>>().join(" ")
}

fn bench_exe(server: &str) -> Option<PathBuf> {
    let dir = Path::new(server).parent()?;
    let p = dir.join(format!("llama-bench{}", std::env::consts::EXE_SUFFIX));
    p.is_file().then_some(p)
}

pub fn start(app: &Arc<App>, model_id: &str) -> Result<Value, String> {
    if ST.lock().unwrap().as_ref().is_some_and(|s| s.running) {
        return Err("Já tem uma otimização rodando.".into());
    }
    let list = crate::models::load(app);
    let p = list.iter().find(|m| m.id == model_id).cloned().ok_or("Modelo não encontrado.")?;
    if !Path::new(&p.model).is_file() {
        return Err(format!("O arquivo do modelo não existe: {}", p.model));
    }
    let server = app.llama.cfg().server_exe;
    let bench = bench_exe(&server).ok_or("O motor em uso não tem o llama-bench. Instale um motor pelo studio (Servidor > Motor).")?;
    let help = crate::llama::engine_help(&bench.to_string_lossy());
    let has = |f: &str| help.as_ref().map(|h| h.flags.contains(f)).unwrap_or(true);

    // combinações: microlotes comuns e duas ou três contagens de threads
    let logical = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(8);
    let mut threads: Vec<usize> = vec![(logical / 2).max(1), (logical * 3 / 8).max(1)];
    if p.threads > 0 {
        threads.push(p.threads as usize);
    }
    threads.sort();
    threads.dedup();
    let ubs = ["256", "512", "1024", "2048"];
    let toks = crate::llama::split_args(&p.extra_args);
    let mut args: Vec<String> = vec!["-m".into(), p.model.clone(), "-p".into(), "512".into(), "-n".into(), "64".into(), "-r".into(), "2".into(), "-o".into(), "jsonl".into()];
    args.extend(["-ub".into(), ubs.join(","), "-b".into(), "2048".into()]);
    args.extend(["-t".into(), threads.iter().map(|t| t.to_string()).collect::<Vec<_>>().join(",")]);
    let ngl = arg_val(&toks, &["-ngl", "--gpu-layers", "--n-gpu-layers"]).unwrap_or_else(|| "99".into());
    args.extend(["-ngl".into(), ngl]);
    if let Some(fa) = arg_val(&toks, &["-fa", "--flash-attn"]) {
        args.extend(["-fa".into(), if fa == "off" || fa == "0" { "0".into() } else { "1".into() }]);
    }
    for (k, names) in [("-ctk", ["-ctk", "--cache-type-k"]), ("-ctv", ["-ctv", "--cache-type-v"])] {
        if let Some(v) = arg_val(&toks, &names) {
            if has(k) {
                args.extend([k.to_string(), v]);
            }
        }
    }
    if p.cpu_moe > 0 {
        if has("--n-cpu-moe") {
            args.extend(["--n-cpu-moe".into(), p.cpu_moe.to_string()]);
        } else if has("-ncmoe") {
            args.extend(["-ncmoe".into(), p.cpu_moe.to_string()]);
        }
    }
    let total = ubs.len() * threads.len() * 2;
    *ST.lock().unwrap() = Some(State { running: true, model: p.name.clone(), total, ..Default::default() });
    CANCEL.store(false, Ordering::SeqCst);
    let app2 = app.clone();
    let rt = app.rt.get().cloned().ok_or("sem runtime")?;
    rt.spawn(async move {
        let was_running = app2.llama.is_running();
        let res = run(&app2, &bench, &args, &p).await;
        match res {
            Ok(r) => with(|s| s.result = Some(r)),
            Err(e) => with(|s| s.error = Some(e)),
        }
        with(|s| s.running = false);
        if was_running {
            let _ = app2.llama.start(&app2);
        }
    });
    Ok(status())
}

async fn run(app: &Arc<App>, bench: &Path, args: &[String], p: &crate::models::Profile) -> Result<Value, String> {
    // o modelo não cabe duas vezes na memória: para o servidor durante o teste
    if app.llama.is_running() {
        with(|s| s.log.push("Parando o llama-server para medir...".into()));
        app.llama.stop();
        for _ in 0..100 {
            if !app.llama.is_running() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    with(|s| s.log.push(format!("llama-bench {}", args.join(" "))));
    let mut c = tokio::process::Command::new(bench);
    c.args(args).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).stdin(std::process::Stdio::null()).kill_on_drop(true);
    if let Some(d) = bench.parent() {
        c.current_dir(d);
    }
    #[cfg(windows)]
    c.creation_flags(crate::CREATE_NO_WINDOW);
    let mut child = c.spawn().map_err(|e| format!("Não consegui rodar o llama-bench: {e}"))?;
    let out = child.stdout.take().unwrap();
    let err = child.stderr.take().unwrap();
    tokio::spawn(async move {
        let mut lines = BufReader::new(err).lines();
        while let Ok(Some(l)) = lines.next_line().await {
            let l = l.trim().to_string();
            if !l.is_empty() {
                with(|s| {
                    s.log.push(l);
                    if s.log.len() > 200 {
                        s.log.remove(0);
                    }
                });
            }
        }
    });
    let mut lines = BufReader::new(out).lines();
    loop {
        if CANCEL.load(Ordering::SeqCst) {
            let _ = child.kill().await;
            return Err("Cancelado.".into());
        }
        let next = tokio::time::timeout(Duration::from_millis(500), lines.next_line()).await;
        match next {
            Err(_) => continue,
            Ok(Ok(Some(l))) => {
                if let Ok(v) = serde_json::from_str::<Value>(&l) {
                    let row = json!({
                        "ub": v["n_ubatch"], "t": v["n_threads"], "pp": v["n_prompt"], "tg": v["n_gen"],
                        "ts": v["avg_ts"].as_f64().unwrap_or(0.0),
                    });
                    with(|s| {
                        s.rows.push(row);
                        s.done = s.rows.len();
                    });
                }
            }
            Ok(Ok(None)) | Ok(Err(_)) => break,
        }
    }
    let st = child.wait().await.map_err(|e| e.to_string())?;
    let rows = ST.lock().unwrap().as_ref().map(|s| s.rows.clone()).unwrap_or_default();
    if rows.is_empty() {
        let tail = ST.lock().unwrap().as_ref().map(|s| s.log.iter().rev().take(4).rev().cloned().collect::<Vec<_>>().join(" | ")).unwrap_or_default();
        return Err(format!("O llama-bench terminou sem resultados (código {:?}). {tail}", st.code()));
    }
    // pontua cada (ub, threads): metade leitura do prompt, metade geração
    let mut combos: Vec<(u64, u64, f64, f64)> = vec![];
    for r in &rows {
        let (ub, t) = (r["ub"].as_u64().unwrap_or(0), r["t"].as_u64().unwrap_or(0));
        let i = match combos.iter().position(|c| c.0 == ub && c.1 == t) {
            Some(i) => i,
            None => {
                combos.push((ub, t, 0.0, 0.0));
                combos.len() - 1
            }
        };
        if r["pp"].as_u64().unwrap_or(0) > 0 {
            combos[i].2 = r["ts"].as_f64().unwrap_or(0.0);
        } else {
            combos[i].3 = r["ts"].as_f64().unwrap_or(0.0);
        }
    }
    let maxpp = combos.iter().map(|c| c.2).fold(0.0, f64::max).max(1e-9);
    let maxtg = combos.iter().map(|c| c.3).fold(0.0, f64::max).max(1e-9);
    let best = combos.iter().max_by(|a, b| (a.2 / maxpp + a.3 / maxtg).partial_cmp(&(b.2 / maxpp + b.3 / maxtg)).unwrap()).cloned().unwrap();
    // o que estava configurado, para comparar
    let toks = crate::llama::split_args(&p.extra_args);
    let cur_ub: u64 = arg_val(&toks, &["-ub", "--ubatch-size"]).and_then(|v| v.parse().ok()).unwrap_or(512);
    let before = combos.iter().find(|c| c.0 == cur_ub && (p.threads == 0 || c.1 == p.threads as u64)).cloned();

    // grava no perfil
    let mut list = crate::models::load(app);
    if let Some(m) = list.iter_mut().find(|m| m.id == p.id) {
        let mut extra = set_arg(&m.extra_args, &["-ub", "--ubatch-size"], &best.0.to_string());
        let b: u64 = arg_val(&crate::llama::split_args(&extra), &["-b", "--batch-size"]).and_then(|v| v.parse().ok()).unwrap_or(2048);
        if b < best.0 {
            extra = set_arg(&extra, &["-b", "--batch-size"], &best.0.to_string());
        }
        m.extra_args = extra;
        m.threads = best.1 as u32;
        let active = crate::models::active_id(app, &list) == Some(p.id.clone());
        let m2 = list.iter().find(|m| m.id == p.id).cloned().unwrap();
        crate::models::save(app, &list);
        if active {
            let mut c = app.llama.cfg();
            c.extra_args = m2.extra_args.clone();
            c.threads = m2.threads;
            app.llama.save(c);
        }
    }
    Ok(json!({
        "ub": best.0, "threads": best.1, "pp": best.2, "tg": best.3,
        "beforePp": before.map(|b| b.2), "beforeTg": before.map(|b| b.3),
        "combos": combos.iter().map(|c| json!({"ub": c.0, "t": c.1, "pp": c.2, "tg": c.3})).collect::<Vec<_>>(),
    }))
}
