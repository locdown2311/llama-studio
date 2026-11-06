//! Busca e download de modelos GGUF do Hugging Face.
//! Os arquivos vão para <pasta do llama>\models\<dono>__<repo>\ e, ao terminar,
//! viram um perfil em Servidor > Modelos.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

use crate::app::App;

const HF: &str = "https://huggingface.co";

fn base() -> String {
    std::env::var("STUDIO_HF_BASE").unwrap_or_else(|_| HF.into())
}

fn token(app: &App) -> String {
    app.config.read().unwrap().hf_token.trim().to_string()
}

fn models_dir(app: &App) -> PathBuf {
    app.llama_dir.join("models")
}

/// GET com o token (se houver). No Windows, se o reqwest não conseguir conectar, tenta o curl.exe.
async fn get_json(app: &App, url: &str) -> Result<Value, String> {
    let tk = token(app);
    let mut rb = app.web.get(url).header("User-Agent", "llama-studio").timeout(Duration::from_secs(25));
    if !tk.is_empty() {
        rb = rb.bearer_auth(&tk);
    }
    let (status, body) = match rb.send().await {
        Ok(r) => {
            let s = r.status().as_u16();
            (s, r.bytes().await.map_err(|e| e.to_string())?.to_vec())
        }
        Err(e) => {
            let first = crate::update::chain(&e);
            curl_get(url, &tk).await.map_err(|e2| format!("Sem conexão com o Hugging Face: {first} ({e2})"))?
        }
    };
    if status == 401 || status == 403 {
        return Err("O Hugging Face recusou o acesso. Modelos restritos precisam de um token (Servidor > Modelos > Token).".into());
    }
    if status != 200 {
        return Err(format!("O Hugging Face respondeu {status}."));
    }
    serde_json::from_slice(&body).map_err(|e| e.to_string())
}

async fn curl_get(url: &str, tk: &str) -> Result<(u16, Vec<u8>), String> {
    let curl = which::which("curl").map_err(|_| "curl não encontrado".to_string())?;
    let mut c = tokio::process::Command::new(curl);
    c.args(["-sSL", "-A", "llama-studio", "-w", "\n%{http_code}", "--max-time", "25"]);
    if !tk.is_empty() {
        c.args(["-H", &format!("Authorization: Bearer {tk}")]);
    }
    c.arg(url).kill_on_drop(true);
    #[cfg(windows)]
    c.creation_flags(crate::CREATE_NO_WINDOW);
    let out = c.output().await.map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let mut body = out.stdout;
    let nl = body.iter().rposition(|&b| b == b'\n').unwrap_or(0);
    let code = String::from_utf8_lossy(&body[nl..]).trim().parse().unwrap_or(0);
    body.truncate(nl);
    Ok((code, body))
}

fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

pub async fn search(app: &App, q: &str) -> Result<Value, String> {
    let url = format!("{}/api/models?search={}&filter=gguf&sort=downloads&direction=-1&limit=40&full=false", base(), enc(q.trim()));
    let v = get_json(app, &url).await?;
    let list: Vec<Value> = v
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|m| {
            json!({
                "id": m["id"].as_str().or(m["modelId"].as_str()).unwrap_or(""),
                "downloads": m["downloads"].as_u64().unwrap_or(0),
                "likes": m["likes"].as_u64().unwrap_or(0),
                "updated": m["lastModified"].clone(),
                "gated": m["gated"].as_bool().unwrap_or(false) || m["gated"].is_string(),
            })
        })
        .collect();
    Ok(json!({"models": list}))
}

/// Quantização a partir do nome (Q4_K_M, IQ3_XS, F16...).
fn quant_of(name: &str) -> String {
    let re = regex_lite::Regex::new(r"(?i)(?:^|[-_.])((?:IQ|Q)\d(?:_[A-Z0-9]+)*|BF16|F16|F32|MXFP4)(?:[-_.]|$)").unwrap();
    re.captures(name).map(|c| c[1].to_uppercase()).unwrap_or_default()
}

pub async fn files(app: &App, repo: &str) -> Result<Value, String> {
    let url = format!("{}/api/models/{}/tree/main?recursive=true", base(), repo);
    let v = get_json(app, &url).await?;
    let split = regex_lite::Regex::new(r"(?i)^(.*)-(\d{5})-of-(\d{5})\.gguf$").unwrap();
    // agrupa partes de modelos divididos
    let mut groups: Vec<(String, Vec<(String, u64)>)> = vec![];
    let mut mmproj = vec![];
    for f in v.as_array().cloned().unwrap_or_default() {
        if f["type"] != "file" {
            continue;
        }
        let path = f["path"].as_str().unwrap_or("").to_string();
        if !path.to_lowercase().ends_with(".gguf") {
            continue;
        }
        let size = f["lfs"]["size"].as_u64().or(f["size"].as_u64()).unwrap_or(0);
        let fname = path.rsplit('/').next().unwrap_or(&path).to_lowercase();
        if fname.contains("mmproj") {
            mmproj.push(json!({"path": path, "size": size, "quant": quant_of(&fname)}));
            continue;
        }
        let key = split.captures(&path).map(|c| c[1].to_string()).unwrap_or_else(|| path.clone());
        match groups.iter_mut().find(|(k, _)| *k == key) {
            Some((_, v)) => v.push((path, size)),
            None => groups.push((key, vec![(path, size)])),
        }
    }
    let mut out: Vec<Value> = groups
        .into_iter()
        .map(|(key, mut parts)| {
            parts.sort();
            let size: u64 = parts.iter().map(|p| p.1).sum();
            let name = key.rsplit('/').next().unwrap_or(&key).trim_end_matches(".gguf").to_string();
            json!({"name": name, "quant": quant_of(&key), "size": size, "parts": parts.iter().map(|p| p.0.clone()).collect::<Vec<_>>()})
        })
        .collect();
    out.sort_by_key(|f| f["size"].as_u64().unwrap_or(0));
    Ok(json!({"repo": repo, "files": out, "mmproj": mmproj, "dir": models_dir(app).join(repo.replace('/', "__"))}))
}

// ---------------------------------------------------------------- downloads

pub struct Job {
    pub id: String,
    pub repo: String,
    pub name: String,
    parts: Vec<String>,
    mmproj: Option<String>,
    total: AtomicU64,
    done: AtomicU64,
    status: Mutex<String>,
    error: Mutex<Option<String>>,
    cancel: AtomicBool,
    started: Instant,
    rate: Mutex<(Instant, u64, f64)>,
    profile: Mutex<Option<String>>,
}

impl Job {
    fn to_json(&self) -> Value {
        let (_, _, rate) = *self.rate.lock().unwrap();
        json!({
            "id": self.id, "repo": self.repo, "name": self.name,
            "total": self.total.load(Ordering::Relaxed), "done": self.done.load(Ordering::Relaxed),
            "status": *self.status.lock().unwrap(), "error": *self.error.lock().unwrap(),
            "rate": rate, "secs": self.started.elapsed().as_secs(), "profile": *self.profile.lock().unwrap(),
        })
    }
    fn add(&self, n: u64) {
        let d = self.done.fetch_add(n, Ordering::Relaxed) + n;
        let mut r = self.rate.lock().unwrap();
        let dt = r.0.elapsed().as_secs_f64();
        if dt >= 1.0 {
            let inst = (d - r.1) as f64 / dt;
            r.2 = if r.2 == 0.0 { inst } else { r.2 * 0.6 + inst * 0.4 };
            *r = (Instant::now(), d, r.2);
        }
    }
}

static JOBS: Mutex<Vec<Arc<Job>>> = Mutex::new(Vec::new());

pub fn list() -> Value {
    json!({"jobs": JOBS.lock().unwrap().iter().map(|j| j.to_json()).collect::<Vec<_>>()})
}

pub fn cancel(id: &str) {
    for j in JOBS.lock().unwrap().iter() {
        if j.id == id {
            j.cancel.store(true, Ordering::SeqCst);
        }
    }
    // tira da lista os que já acabaram
    JOBS.lock().unwrap().retain(|j| !(j.id == id && *j.status.lock().unwrap() != "downloading"));
}

pub fn start(app: &Arc<App>, repo: &str, name: &str, parts: Vec<String>, mmproj: Option<String>, sizes: u64) -> Result<Value, String> {
    if parts.is_empty() {
        return Err("Nenhum arquivo escolhido.".into());
    }
    if JOBS.lock().unwrap().iter().any(|j| j.repo == repo && j.parts == parts && *j.status.lock().unwrap() == "downloading") {
        return Err("Esse arquivo já está sendo baixado.".into());
    }
    let job = Arc::new(Job {
        id: format!("d{}", crate::app::now_ms()),
        repo: repo.into(),
        name: name.into(),
        parts,
        mmproj,
        total: AtomicU64::new(sizes),
        done: AtomicU64::new(0),
        status: Mutex::new("downloading".into()),
        error: Mutex::new(None),
        cancel: AtomicBool::new(false),
        started: Instant::now(),
        rate: Mutex::new((Instant::now(), 0, 0.0)),
        profile: Mutex::new(None),
    });
    JOBS.lock().unwrap().push(job.clone());
    let app2 = app.clone();
    let j = job.clone();
    let rt = app.rt.get().cloned().ok_or("sem runtime")?;
    rt.spawn(async move {
        let res = run(&app2, &j).await;
        match res {
            Ok(()) => *j.status.lock().unwrap() = "done".into(),
            Err(e) if j.cancel.load(Ordering::SeqCst) => {
                let _ = e;
                *j.status.lock().unwrap() = "canceled".into();
            }
            Err(e) => {
                *j.status.lock().unwrap() = "error".into();
                *j.error.lock().unwrap() = Some(e);
            }
        }
    });
    Ok(job.to_json())
}

async fn run(app: &Arc<App>, j: &Arc<Job>) -> Result<(), String> {
    let dir = models_dir(app).join(j.repo.replace('/', "__"));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Não consegui criar {}: {e}", dir.display()))?;
    let mut files: Vec<String> = j.parts.clone();
    if let Some(m) = &j.mmproj {
        files.push(m.clone());
    }
    let mut local = vec![];
    for f in &files {
        let name = f.rsplit('/').next().unwrap_or(f);
        let dest = dir.join(name);
        get_file(app, j, f, &dest).await?;
        local.push(dest);
    }
    // vira um perfil de modelo
    let model = local[0].to_string_lossy().to_string();
    let mut list = crate::models::load(app);
    let defaults = app.llama.cfg();
    let mut extra = defaults.extra_args.clone();
    // tira um --mmproj de outro modelo e põe o deste, se houver
    let re = regex_lite::Regex::new(r#"\s*--mmproj\s+("[^"]*"|\S+)"#).unwrap();
    extra = re.replace_all(&extra, "").trim().to_string();
    if j.mmproj.is_some() {
        extra = format!("{extra} --mmproj \"{}\"", local.last().unwrap().display()).trim().to_string();
    }
    let id = format!("m{}", crate::app::now_ms());
    if !list.iter().any(|p| p.model.eq_ignore_ascii_case(&model)) {
        list.push(crate::models::Profile {
            id: id.clone(),
            name: crate::models::name_of(&model),
            model,
            context: defaults.context.min(32768).max(4096),
            cpu_moe: 0,
            threads: defaults.threads,
            extra_args: extra,
        });
        crate::models::save(app, &list);
        *j.profile.lock().unwrap() = Some(id);
    }
    Ok(())
}

/// Baixa um arquivo, continuando de um .part se já existir.
async fn get_file(app: &App, j: &Job, path: &str, dest: &Path) -> Result<(), String> {
    let url = format!("{}/{}/resolve/main/{}?download=true", base(), j.repo, path.split('/').map(enc).collect::<Vec<_>>().join("/"));
    if dest.is_file() {
        // já baixado antes
        let n = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
        j.add(n);
        return Ok(());
    }
    let part = PathBuf::from(format!("{}.part", dest.display()));
    let have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    let tk = token(app);
    let mut rb = app.web.get(&url).header("User-Agent", "llama-studio").timeout(Duration::from_secs(60 * 60 * 6));
    if !tk.is_empty() {
        rb = rb.bearer_auth(&tk);
    }
    if have > 0 {
        rb = rb.header("Range", format!("bytes={have}-"));
    }
    let mut resp = match rb.send().await {
        Ok(r) => r,
        Err(e) => {
            let first = crate::update::chain(&e);
            return curl_file(j, &url, &tk, &part, dest, have).await.map_err(|e2| format!("{first} ({e2})"));
        }
    };
    let status = resp.status().as_u16();
    if status == 401 || status == 403 {
        return Err("Acesso negado. Este modelo é restrito: aceite os termos na página dele e informe um token.".into());
    }
    if status != 200 && status != 206 {
        return Err(format!("Download falhou ({status})."));
    }
    let resume = status == 206;
    let mut f = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(resume)
        .truncate(!resume)
        .open(&part)
        .await
        .map_err(|e| e.to_string())?;
    if resume {
        j.add(have);
    }
    let mut last = Instant::now();
    loop {
        if j.cancel.load(Ordering::SeqCst) {
            return Err("cancelado".into());
        }
        let chunk = tokio::time::timeout(Duration::from_secs(90), resp.chunk())
            .await
            .map_err(|_| "A conexão parou de responder. Clique em baixar de novo para continuar de onde parou.".to_string())?
            .map_err(|e| format!("{} (clique em baixar de novo para continuar de onde parou)", crate::update::chain(&e)))?;
        let Some(c) = chunk else { break };
        f.write_all(&c).await.map_err(|e| format!("Erro ao gravar (disco cheio?): {e}"))?;
        j.add(c.len() as u64);
        if last.elapsed() > Duration::from_secs(5) {
            let _ = f.flush().await;
            last = Instant::now();
        }
    }
    f.flush().await.map_err(|e| e.to_string())?;
    drop(f);
    std::fs::rename(&part, dest).map_err(|e| e.to_string())?;
    Ok(())
}

/// Plano B no Windows: curl.exe (usa o certificado/proxy do sistema), acompanhando pelo tamanho do .part.
async fn curl_file(j: &Job, url: &str, tk: &str, part: &Path, dest: &Path, have: u64) -> Result<(), String> {
    let curl = which::which("curl").map_err(|_| "curl não encontrado".to_string())?;
    let mut c = tokio::process::Command::new(curl);
    c.args(["-sSfL", "-A", "llama-studio", "-C", "-", "-o"]).arg(part);
    if !tk.is_empty() {
        c.args(["-H", &format!("Authorization: Bearer {tk}")]);
    }
    c.arg(url).kill_on_drop(true).stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    c.creation_flags(crate::CREATE_NO_WINDOW);
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    let mut counted = have;
    j.add(have);
    loop {
        if j.cancel.load(Ordering::SeqCst) {
            let _ = child.kill().await;
            return Err("cancelado".into());
        }
        if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
            let now = std::fs::metadata(part).map(|m| m.len()).unwrap_or(counted);
            if now > counted {
                j.add(now - counted);
            }
            if !st.success() {
                return Err(format!("curl terminou com erro {}", st.code().unwrap_or(-1)));
            }
            break;
        }
        let now = std::fs::metadata(part).map(|m| m.len()).unwrap_or(counted);
        if now > counted {
            j.add(now - counted);
            counted = now;
        }
        tokio::time::sleep(Duration::from_millis(700)).await;
    }
    std::fs::rename(part, dest).map_err(|e| e.to_string())
}

pub fn info(app: &App) -> Value {
    json!({"dir": models_dir(app), "hasToken": !token(app).is_empty()})
}
