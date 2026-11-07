//! Motores do llama.cpp: baixa as builds oficiais para Windows (CPU, Vulkan, CUDA, ROCm, SYCL),
//! guarda cada uma em <pasta do llama>\engines\<variante>-<build>\ e troca o llama-server em uso.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

use crate::app::App;

pub struct Variant {
    pub id: &'static str,
    /// "llama" (ggml-org/llama.cpp) ou "ik" (builds do ik_llama.cpp feitas no CI deste repositório)
    pub family: &'static str,
    name_t: (&'static str, &'static str),
    desc_t: (&'static str, &'static str),
    /// padrão do nome do pacote principal
    pat: &'static str,
    /// padrão do pacote de runtime (CUDA)
    runtime: Option<&'static str>,
}

impl Variant {
    pub fn name(&self) -> &'static str { if crate::i18n::en() { self.name_t.1 } else { self.name_t.0 } }
    pub fn desc(&self) -> &'static str { if crate::i18n::en() { self.desc_t.1 } else { self.desc_t.0 } }
}

pub const VARIANTS: &[Variant] = &[
    Variant { id: "vulkan", family: "llama", name_t: ("Vulkan", "Vulkan"), desc_t: ("AMD, NVIDIA e Intel. A escolha mais segura para placas de vídeo.", "AMD, NVIDIA and Intel. The safest choice for graphics cards."), pat: r"-bin-win-vulkan-x64\.zip$", runtime: None },
    Variant { id: "cuda", family: "llama", name_t: ("CUDA", "CUDA"), desc_t: ("Placas NVIDIA. Em geral o mais rápido nelas; vem com as bibliotecas de runtime.", "NVIDIA cards. Usually the fastest on them; comes with the runtime libraries."), pat: r"-bin-win-cuda-(\d[\d.]*)-x64\.zip$", runtime: Some(r"^cudart-llama-bin-win-cuda-{V}-x64\.zip$") },
    Variant { id: "rocm", family: "llama", name_t: ("ROCm (HIP)", "ROCm (HIP)"), desc_t: ("Placas AMD Radeon compatíveis com ROCm. Pode ser mais rápido que o Vulkan na leitura do prompt.", "AMD Radeon cards compatible with ROCm. Can be faster than Vulkan at reading the prompt."), pat: r"-bin-win-(rocm|hip)[^/]*-x64\.zip$", runtime: None },
    Variant { id: "sycl", family: "llama", name_t: ("SYCL", "SYCL"), desc_t: ("Placas Intel Arc e iGPUs Intel recentes.", "Intel Arc cards and recent Intel iGPUs."), pat: r"-bin-win-sycl-x64\.zip$", runtime: None },
    Variant { id: "cpu", family: "llama", name_t: ("Só CPU", "CPU only"), desc_t: ("Sem placa de vídeo. Funciona em qualquer computador.", "No graphics card. Works on any computer."), pat: r"-bin-win-cpu-x64\.zip$", runtime: None },
    Variant { id: "ik-cpu", family: "ik", name_t: ("CPU", "CPU"), desc_t: ("ik_llama.cpp: bem mais rápido que o llama.cpp para MoE na CPU e quantizações IQ_K.", "ik_llama.cpp: much faster than llama.cpp for MoE on the CPU and IQ_K quantizations."), pat: r"^ik_llama-.*-bin-win-cpu-x64\.zip$", runtime: None },
    Variant { id: "ik-vulkan", family: "ik", name_t: ("Vulkan", "Vulkan"), desc_t: ("ik_llama.cpp com Vulkan (AMD, NVIDIA, Intel). Suporte mais novo que o de CUDA.", "ik_llama.cpp with Vulkan (AMD, NVIDIA, Intel). Newer support than CUDA."), pat: r"^ik_llama-.*-bin-win-vulkan-x64\.zip$", runtime: None },
];

fn engines_dir(app: &App) -> PathBuf {
    app.llama_dir.join("engines")
}

fn server_name() -> String {
    format!("llama-server{}", std::env::consts::EXE_SUFFIX)
}

static RELEASES: Mutex<Option<std::collections::HashMap<&'static str, (Instant, Vec<Value>)>>> = Mutex::new(None);

fn repo_of(family: &str) -> &'static str {
    if family == "ik" { crate::update::REPO } else { "ggml-org/llama.cpp" }
}

async fn releases(app: &App, family: &'static str) -> Result<Vec<Value>, String> {
    if let Some((t, v)) = RELEASES.lock().unwrap().as_ref().and_then(|m| m.get(family)) {
        if t.elapsed() < Duration::from_secs(1800) {
            return Ok(v.clone());
        }
    }
    let base = std::env::var("STUDIO_GITHUB_API").unwrap_or_else(|_| "https://api.github.com".into());
    let (status, body) = crate::update::fetch(app, &format!("{base}/repos/{}/releases?per_page=30", repo_of(family)), true, Duration::from_secs(25)).await?;
    if status != 200 {
        return Err(format!("GitHub respondeu {status}."));
    }
    let mut v: Vec<Value> = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
    if family == "ik" {
        v.retain(|r| r["tag_name"].as_str().is_some_and(|t| t.starts_with("ik-")));
    }
    RELEASES.lock().unwrap().get_or_insert_with(Default::default).insert(family, (Instant::now(), v.clone()));
    Ok(v)
}

/// Pacote mais novo de cada variante (o ROCm nem sempre sai em toda build).
fn pick(rels: &[Value], v: &Variant) -> Option<(String, String, u64, Vec<(String, u64)>)> {
    let re = regex_lite::Regex::new(v.pat).unwrap();
    for r in rels {
        let assets = r["assets"].as_array()?;
        // CUDA: a versão de CUDA mais alta da build
        let mut cands: Vec<&Value> = assets.iter().filter(|a| a["name"].as_str().is_some_and(|n| re.is_match(n))).collect();
        if cands.is_empty() {
            continue;
        }
        cands.sort_by_key(|a| std::cmp::Reverse(a["name"].as_str().unwrap_or("").to_string()));
        let a = cands[0];
        let name = a["name"].as_str().unwrap_or("").to_string();
        let mut files = vec![(a["browser_download_url"].as_str().unwrap_or("").to_string(), a["size"].as_u64().unwrap_or(0))];
        if let Some(rt) = v.runtime {
            let ver = re.captures(&name).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
            let rre = regex_lite::Regex::new(&rt.replace("{V}", &regex_lite::escape(&ver))).unwrap();
            if let Some(x) = assets.iter().find(|a| a["name"].as_str().is_some_and(|n| rre.is_match(n))) {
                files.push((x["browser_download_url"].as_str().unwrap_or("").to_string(), x["size"].as_u64().unwrap_or(0)));
            }
        }
        let size = files.iter().map(|f| f.1).sum();
        let tag = r["tag_name"].as_str().unwrap_or("").to_string();
        let label = if v.id == "cuda" { re.captures(&name).and_then(|c| c.get(1)).map(|m| format!("CUDA {}", m.as_str())).unwrap_or_default() } else { String::new() };
        return Some((tag, label, size, files));
    }
    None
}

/// Motores instalados (pastas com llama-server.exe dentro de engines\).
fn installed(app: &App) -> Vec<(String, PathBuf)> {
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(engines_dir(app)) {
        for e in rd.flatten() {
            let p = e.path();
            if p.join(server_name()).is_file() {
                out.push((e.file_name().to_string_lossy().to_string(), p));
            }
        }
    }
    out.sort();
    out.reverse();
    out
}

fn same(a: &Path, b: &Path) -> bool {
    let n = |p: &Path| p.to_string_lossy().replace('/', "\\").to_lowercase();
    n(a) == n(b)
}

/// Placas de vídeo (nomes), para sugerir o motor. Lido uma vez.
static GPUS: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();

fn gpus() -> Vec<String> {
    GPUS.get_or_init(|| {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let o = std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }"])
                .creation_flags(crate::CREATE_NO_WINDOW)
                .output();
            if let Ok(o) = o {
                return String::from_utf8_lossy(&o.stdout).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
            }
        }
        std::env::var("STUDIO_FAKE_GPU").map(|g| vec![g]).unwrap_or_default()
    })
    .clone()
}

/// Variante sugerida para as placas encontradas.
fn suggest(g: &[String]) -> &'static str {
    let all = g.join(" ").to_lowercase();
    if all.contains("nvidia") || all.contains("geforce") || all.contains("rtx") {
        "cuda"
    } else if all.contains("radeon") || all.contains("amd") || all.contains("intel") || all.contains("arc") {
        "vulkan"
    } else {
        "cpu"
    }
}

pub async fn list(app: &App, check: bool) -> Value {
    let cur = PathBuf::from(app.llama.cfg().server_exe);
    let inst: Vec<Value> = installed(app)
        .into_iter()
        .map(|(id, p)| {
            let exe = p.join(server_name());
            let size: u64 = std::fs::read_dir(&p).map(|rd| rd.flatten().filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum()).unwrap_or(0);
            json!({"id": id, "path": exe, "active": same(&exe, &cur), "size": size})
        })
        .collect();
    let mut out = json!({
        "current": cur, "currentExists": cur.is_file(),
        "managed": inst.iter().any(|e| e["active"] == true),
        "installed": inst, "dir": engines_dir(app), "jobs": jobs_json(),
    });
    let g = tokio::task::spawn_blocking(gpus).await.unwrap_or_default();
    out["suggest"] = json!(suggest(&g));
    out["gpus"] = json!(g);
    if check {
        let mut avail = vec![];
        for fam in ["llama", "ik"] {
            match releases(app, fam).await {
                Ok(rels) => {
                    for v in VARIANTS.iter().filter(|v| v.family == fam) {
                        avail.push(match pick(&rels, v) {
                            Some((tag, label, size, _)) => json!({"id": v.id, "family": fam, "name": v.name(), "desc": v.desc(), "tag": tag, "label": label, "size": size}),
                            None => json!({"id": v.id, "family": fam, "name": v.name(), "desc": v.desc(), "missing": true}),
                        });
                    }
                }
                Err(e) if fam == "llama" => out["error"] = json!(e),
                Err(_) => {}
            }
        }
        out["available"] = json!(avail);
    }
    out
}

// ---------------------------------------------------------------- instalação em segundo plano

struct Job {
    id: String,
    variant: String,
    tag: String,
    total: AtomicU64,
    done: AtomicU64,
    status: Mutex<String>,
    error: Mutex<Option<String>>,
    cancel: AtomicBool,
}

static JOBS: Mutex<Vec<Arc<Job>>> = Mutex::new(Vec::new());

fn jobs_json() -> Value {
    json!(JOBS
        .lock()
        .unwrap()
        .iter()
        .map(|j| json!({"id": j.id, "variant": j.variant, "tag": j.tag, "total": j.total.load(Ordering::Relaxed), "done": j.done.load(Ordering::Relaxed), "status": *j.status.lock().unwrap(), "error": *j.error.lock().unwrap()}))
        .collect::<Vec<_>>())
}

pub fn cancel(id: &str) {
    let mut g = JOBS.lock().unwrap();
    for j in g.iter() {
        if j.id == id {
            j.cancel.store(true, Ordering::SeqCst);
        }
    }
    g.retain(|j| !(j.id == id && *j.status.lock().unwrap() != "downloading"));
}

pub async fn install(app: &Arc<App>, variant: &str, activate: bool) -> Result<Value, String> {
    let v = VARIANTS.iter().find(|v| v.id == variant).ok_or("Motor desconhecido.")?;
    let rels = releases(app, v.family).await?;
    let (tag, _, size, files) = pick(&rels, v).ok_or_else(|| LF!("Não há pacote {} para Windows nas releases recentes do llama.cpp.", "There is no {} package for Windows in the recent llama.cpp releases.", v.name()))?;
    if JOBS.lock().unwrap().iter().any(|j| j.variant == variant && *j.status.lock().unwrap() == "downloading") {
        return Err(L!("Esse motor já está sendo baixado.", "That engine is already downloading.").into());
    }
    let job = Arc::new(Job {
        id: format!("e{}", crate::app::now_ms()),
        variant: variant.into(),
        tag: tag.clone(),
        total: AtomicU64::new(size),
        done: AtomicU64::new(0),
        status: Mutex::new("downloading".into()),
        error: Mutex::new(None),
        cancel: AtomicBool::new(false),
    });
    JOBS.lock().unwrap().retain(|j| *j.status.lock().unwrap() == "downloading");
    JOBS.lock().unwrap().push(job.clone());
    let app2 = app.clone();
    let j = job.clone();
    let rt = app.rt.get().cloned().ok_or("sem runtime")?;
    rt.spawn(async move {
        let dir = engines_dir(&app2).join(format!("{}-{}", j.variant, j.tag));
        let res = run(&app2, &j, &files, &dir).await;
        match res {
            Ok(()) => {
                *j.status.lock().unwrap() = "done".into();
                if activate {
                    let _ = use_engine(&app2, &dir.join(server_name())).await;
                }
            }
            Err(e) => {
                let _ = std::fs::remove_dir_all(&dir);
                *j.status.lock().unwrap() = if j.cancel.load(Ordering::SeqCst) { "canceled".into() } else { "error".into() };
                *j.error.lock().unwrap() = Some(e);
            }
        }
    });
    Ok(jobs_json())
}

async fn run(app: &App, j: &Job, files: &[(String, u64)], dir: &Path) -> Result<(), String> {
    let tmp = dir.with_extension("baixando");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    for (i, (url, _)) in files.iter().enumerate() {
        let zip = tmp.join(format!("pacote{i}.zip"));
        download(app, j, url, &zip).await?;
        let f = std::fs::File::open(&zip).map_err(|e| e.to_string())?;
        zip::ZipArchive::new(f).and_then(|mut z| z.extract(&tmp)).map_err(|e| LF!("Pacote inválido: {e}", "Invalid package: {e}"))?;
        let _ = std::fs::remove_file(&zip);
    }
    // o llama-server pode vir dentro de uma subpasta
    let exe = walkdir::WalkDir::new(&tmp).max_depth(3).into_iter().flatten().find(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(&server_name())).map(|e| e.path().to_path_buf()).ok_or(L!("O pacote não tem o llama-server.", "The package does not have the llama-server."))?;
    let src = exe.parent().unwrap().to_path_buf();
    let _ = std::fs::remove_dir_all(dir);
    std::fs::rename(&src, dir).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&tmp);
    Ok(())
}

async fn download(app: &App, j: &Job, url: &str, dest: &Path) -> Result<(), String> {
    let mut resp = app.web.get(url).header("User-Agent", "llama-studio").timeout(Duration::from_secs(3600)).send().await.map_err(|e| crate::update::chain(&e))?;
    if !resp.status().is_success() {
        return Err(format!("Download falhou ({}).", resp.status()));
    }
    let mut f = tokio::fs::File::create(dest).await.map_err(|e| e.to_string())?;
    loop {
        if j.cancel.load(Ordering::SeqCst) {
            return Err("cancelado".into());
        }
        let c = tokio::time::timeout(Duration::from_secs(90), resp.chunk()).await.map_err(|_| L!("A conexão parou de responder.", "The connection stopped responding.").to_string())?.map_err(|e| crate::update::chain(&e))?;
        let Some(c) = c else { break };
        f.write_all(&c).await.map_err(|e| LF!("Erro ao gravar (disco cheio?): {e}", "Error writing (disk full?): {e}"))?;
        j.done.fetch_add(c.len() as u64, Ordering::Relaxed);
    }
    f.flush().await.map_err(|e| e.to_string())
}

/// Aponta o llama-server para este executável e reinicia se estiver rodando.
pub async fn use_engine(app: &Arc<App>, exe: &Path) -> Result<Value, String> {
    if !exe.is_file() {
        return Err(L!("Esse motor não está instalado.", "That engine is not installed.").into());
    }
    let mut c = app.llama.cfg();
    c.server_exe = exe.to_string_lossy().to_string();
    app.llama.save(c);
    if app.llama.is_running() {
        app.llama.stop();
        for _ in 0..80 {
            if !app.llama.is_running() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
        app.llama.start(app)?;
    }
    Ok(app.llama.to_json())
}

pub fn remove(app: &App, id: &str) -> Result<(), String> {
    let dir = engines_dir(app).join(id);
    if !crate::app::is_inside(&engines_dir(app), &dir) || id.contains(['/', '\\']) {
        return Err(L!("Motor inválido.", "Invalid engine.").into());
    }
    if same(&dir.join(server_name()), Path::new(&app.llama.cfg().server_exe)) {
        return Err(L!("Esse é o motor em uso. Troque para outro antes de remover.", "That is the engine in use. Switch to another one before removing it.").into());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| LF!("Não consegui remover (está em uso?): {e}", "Could not remove it (is it in use?): {e}"))
}
