//! O studio de cada usuário na nuvem: um contêiner Docker só dele.
//!
//! - Pasta própria (`HUB_DATA/users/<id>` em /data), raiz do sistema só de leitura, usuário sem privilégios.
//! - Limites de RAM, CPU, processos e disco; liga no primeiro pedido e desliga depois de `HUB_IDLE_MIN` parado.
//! - Rede interna sem saída: a internet passa pelo proxy da central (só endereços públicos).
//! - Imagem nova: o contêiner é recriado no próximo uso (a pasta continua).

use crate::db::User;
use crate::{err, H};
use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::response::Response;
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const UID: u32 = 1000;
const PORT: u16 = 8080;

#[derive(Default)]
struct St {
    running: bool,
    last: Option<Instant>,
    checked: Option<Instant>,
    disk_mb: u64,
    disk_at: Option<Instant>,
}

#[derive(Default)]
pub struct Boxes {
    st: Mutex<HashMap<i64, St>>,
    locks: Mutex<HashMap<i64, Arc<tokio::sync::Mutex<()>>>>,
}

pub fn name(uid: i64) -> String {
    format!("studio-u{uid}")
}

pub fn dir(h: &crate::Hub, uid: i64) -> PathBuf {
    h.cfg.data.join("users").join(uid.to_string())
}

/// Cria a pasta (e as de cima dentro de users/) com o dono do contêiner.
pub fn mkdir_owned(p: &Path) {
    let _ = std::fs::create_dir_all(p);
    #[cfg(unix)]
    {
        let _ = std::os::unix::fs::chown(p, Some(UID), Some(UID));
    }
}

fn du(p: &Path) -> u64 {
    let mut total = 0u64;
    let mut stack = vec![p.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let Ok(m) = e.metadata() else { continue };
            if m.is_dir() {
                stack.push(e.path());
            } else {
                total += m.len();
            }
        }
    }
    total
}

async fn docker(h: &crate::Hub, args: &[&str]) -> Result<String, String> {
    let out = tokio::process::Command::new(&h.cfg.docker).args(args).output().await.map_err(|e| format!("docker: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().chars().take(400).collect())
    }
}

impl Boxes {
    fn lock_for(&self, uid: i64) -> Arc<tokio::sync::Mutex<()>> {
        self.locks.lock().unwrap().entry(uid).or_default().clone()
    }

    pub fn info(&self, uid: i64) -> Value {
        let st = self.st.lock().unwrap();
        let s = st.get(&uid);
        json!({ "running": s.is_some_and(|s| s.running), "diskMb": s.map(|s| s.disk_mb) })
    }

    async fn disk(&self, h: &crate::Hub, uid: i64) -> u64 {
        let fresh = self.st.lock().unwrap().get(&uid).and_then(|s| s.disk_at).is_some_and(|t| t.elapsed() < Duration::from_secs(600));
        if fresh {
            return self.st.lock().unwrap().get(&uid).map(|s| s.disk_mb).unwrap_or(0);
        }
        let d = dir(h, uid);
        let mb = tokio::task::spawn_blocking(move || du(&d) / (1024 * 1024)).await.unwrap_or(0);
        let mut st = self.st.lock().unwrap();
        let s = st.entry(uid).or_default();
        s.disk_mb = mb;
        s.disk_at = Some(Instant::now());
        mb
    }

    pub async fn stop(&self, h: &crate::Hub, uid: i64) {
        let _ = docker(h, &["stop", "-t", "10", &name(uid)]).await;
        if let Some(s) = self.st.lock().unwrap().get_mut(&uid) {
            s.running = false;
            s.checked = None;
        }
    }

    /// Liga (ou cria) o contêiner do usuário e devolve o endereço dele na rede interna.
    pub async fn ensure(&self, h: &crate::Hub, u: &User) -> Result<String, String> {
        let addr = h.cfg.box_addr.replace("{id}", &u.id.to_string());
        {
            let mut st = self.st.lock().unwrap();
            let s = st.entry(u.id).or_default();
            s.last = Some(Instant::now());
            if s.running && s.checked.is_some_and(|t| t.elapsed() < Duration::from_secs(60)) {
                return Ok(addr);
            }
        }
        let lock = self.lock_for(u.id);
        let _g = lock.lock().await;
        let mb = self.disk(h, u.id).await;
        if mb > h.cfg.disk_mb {
            self.stop(h, u.id).await;
            return Err(format!("Sua pasta na nuvem passou do limite ({mb} MB de {} MB). Apague arquivos pelo PC ou peça mais espaço.", h.cfg.disk_mb));
        }
        let n = name(u.id);
        let want = match docker(h, &["image", "inspect", "-f", "{{.Id}}", &h.cfg.image]).await {
            Ok(id) => id,
            Err(_) => {
                // primeira vez: baixa a imagem
                docker(h, &["pull", &h.cfg.image]).await.map_err(|e| format!("Imagem da nuvem não encontrada ({}): {e}", h.cfg.image))?;
                docker(h, &["image", "inspect", "-f", "{{.Id}}", &h.cfg.image]).await?
            }
        };
        let state = docker(h, &["inspect", "-f", "{{.State.Running}} {{.Image}}", &n]).await.ok();
        match state.as_deref().and_then(|s| s.split_once(' ')) {
            // ligado fica como está (imagem nova só entra quando ele desligar, para não cortar uma tarefa)
            Some(("true", _)) => {}
            Some((_, img)) if img == want => {
                self.make_room(h, u.id).await?;
                docker(h, &["start", &n]).await?;
            }
            other => {
                if other.is_some() {
                    let _ = docker(h, &["rm", "-f", &n]).await;
                }
                self.make_room(h, u.id).await?;
                self.create(h, u).await?;
            }
        }
        // espera o studio de dentro responder
        let t0 = Instant::now();
        loop {
            let ok = h.http.get(format!("{addr}/api/app")).header("host", "127.0.0.1").header("x-studio", "1").header("x-hub-secret", &u.secret).timeout(Duration::from_secs(2)).send().await.is_ok_and(|r| r.status().is_success());
            if ok {
                break;
            }
            if t0.elapsed() > Duration::from_secs(40) {
                return Err("O studio na nuvem não respondeu ao ligar.".into());
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        let mut st = self.st.lock().unwrap();
        let s = st.entry(u.id).or_default();
        s.running = true;
        s.checked = Some(Instant::now());
        s.last = Some(Instant::now());
        Ok(addr)
    }

    /// Respeita o máximo de contêineres ligados: desliga o mais parado (há mais de 2 min sem uso) ou recusa.
    async fn make_room(&self, h: &crate::Hub, me: i64) -> Result<(), String> {
        let victim = {
            let st = self.st.lock().unwrap();
            let running: Vec<(i64, Instant)> = st.iter().filter(|(id, s)| s.running && **id != me).map(|(id, s)| (*id, s.last.unwrap_or_else(Instant::now))).collect();
            if running.len() < h.cfg.max_running {
                return Ok(());
            }
            running.into_iter().filter(|(_, t)| t.elapsed() > Duration::from_secs(120)).min_by_key(|(_, t)| *t).map(|(id, _)| id)
        };
        match victim {
            Some(id) => {
                self.stop(h, id).await;
                Ok(())
            }
            None => Err("A nuvem está cheia agora. Tente de novo em alguns minutos.".into()),
        }
    }

    async fn create(&self, h: &crate::Hub, u: &User) -> Result<(), String> {
        let d = dir(h, u.id);
        mkdir_owned(&h.cfg.data.join("users"));
        mkdir_owned(&d);
        mkdir_owned(&d.join("home"));
        let proxy_port = h.cfg.proxy_bind.rsplit(':').next().unwrap_or("3128");
        let proxy = format!("http://u{}:{}@{}:{proxy_port}", u.id, u.secret, h.cfg.hub_host);
        let vol = format!("{}:/data", d.display());
        let user = format!("{UID}:{UID}");
        let pids = h.cfg.pids.to_string();
        let envs = [
            "STUDIO_CLOUD=1".to_string(),
            "STUDIO_DIR=/data".into(),
            format!("STUDIO_PORT={PORT}"),
            "STUDIO_BIND=0.0.0.0".into(),
            format!("STUDIO_HUB_SECRET={}", u.secret),
            "STUDIO_NO_OPEN=1".into(),
            "HOME=/data/home".into(),
            format!("HTTPS_PROXY={proxy}"),
            format!("HTTP_PROXY={proxy}"),
            format!("https_proxy={proxy}"),
            format!("http_proxy={proxy}"),
            "NO_PROXY=localhost,127.0.0.1".into(),
        ];
        let n = name(u.id);
        let mut args: Vec<&str> = vec![
            "run", "-d", "--name", &n, "--hostname", "studio", "--network", &h.cfg.network, "--user", &user,
            "--memory", &h.cfg.mem, "--memory-swap", &h.cfg.mem, "--cpus", &h.cfg.cpus, "--pids-limit", &pids,
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only",
            "--tmpfs", "/tmp:rw,size=256m,mode=1777", "-v", &vol, "--restart", "no", "--label", "studio-hub=1",
        ];
        for e in &envs {
            args.push("-e");
            args.push(e);
        }
        args.push(&h.cfg.image);
        docker(h, &args).await.map(|_| ()).map_err(|e| format!("Não consegui criar o studio na nuvem: {e}"))
    }
}

/// Repassa o pedido para o contêiner (resposta em streaming; se a interface desistir, a conexão cai e o
/// studio de lá percebe).
pub async fn forward(h: &crate::Hub, addr: &str, u: &User, req: Request) -> Response {
    let (parts, body) = req.into_parts();
    let pq = parts.uri.path_and_query().map(|p| p.as_str().to_string()).unwrap_or_else(|| "/".into());
    let method = reqwest::Method::from_bytes(parts.method.as_str().as_bytes()).unwrap_or(reqwest::Method::GET);
    let mut rb = h.http.request(method, format!("{addr}{pq}")).timeout(Duration::from_secs(45 * 60));
    for (k, v) in parts.headers.iter() {
        if !crate::skip_header(k.as_str()) {
            rb = rb.header(k.as_str(), v.as_bytes());
        }
    }
    rb = rb.header("host", "127.0.0.1").header("x-hub-secret", &u.secret);
    let stream = body.into_data_stream().map(|r| r.map_err(std::io::Error::other));
    let resp = match rb.body(reqwest::Body::wrap_stream(stream)).send().await {
        Ok(r) => r,
        Err(e) => {
            if let Some(s) = h.boxes.st.lock().unwrap().get_mut(&u.id) {
                s.checked = None;
            }
            return err(StatusCode::BAD_GATEWAY, &format!("studio na nuvem: {e}"));
        }
    };
    if let Some(s) = h.boxes.st.lock().unwrap().get_mut(&u.id) {
        s.last = Some(Instant::now());
    }
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let hs: Vec<(String, Vec<u8>)> = resp.headers().iter().map(|(k, v)| (k.as_str().to_string(), v.as_bytes().to_vec())).collect();
    let mut r = Response::new(Body::from_stream(resp.bytes_stream().map(|r| r.map_err(std::io::Error::other))));
    *r.status_mut() = status;
    for (k, v) in hs {
        if crate::skip_header(&k) {
            continue;
        }
        if let (Ok(k), Ok(v)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_bytes(&v)) {
            r.headers_mut().append(k, v);
        }
    }
    r
}

/// Desliga quem ficou parado e confere o disco de quem está ligado.
pub async fn reaper(h: H) {
    // imagem nova publicada: baixa ao abrir e a cada 6 h (cada studio troca no próximo uso; as pastas ficam)
    if h.cfg.image.contains('/') {
        let h2 = h.clone();
        tokio::spawn(async move {
            loop {
                if let Err(e) = docker(&h2, &["pull", "-q", &h2.cfg.image]).await {
                    eprintln!("pull {}: {e}", h2.cfg.image);
                }
                tokio::time::sleep(Duration::from_secs(6 * 3600)).await;
            }
        });
    }
    // ao abrir, descobre quem já está ligado (a central pode ter reiniciado)
    if let Ok(out) = docker(&h, &["ps", "--filter", "label=studio-hub=1", "--format", "{{.Names}}"]).await {
        let mut st = h.boxes.st.lock().unwrap();
        for n in out.lines() {
            if let Some(id) = n.strip_prefix("studio-u").and_then(|s| s.parse::<i64>().ok()) {
                let s = st.entry(id).or_default();
                s.running = true;
                s.last = Some(Instant::now());
            }
        }
    }
    loop {
        tokio::time::sleep(Duration::from_secs(60)).await;
        let idle = Duration::from_secs(h.cfg.idle_min * 60);
        let (stale, live): (Vec<i64>, Vec<i64>) = {
            let st = h.boxes.st.lock().unwrap();
            let r: Vec<(i64, bool)> = st.iter().filter(|(_, s)| s.running).map(|(id, s)| (*id, s.last.is_none_or(|t| t.elapsed() > idle))).collect();
            (r.iter().filter(|x| x.1).map(|x| x.0).collect(), r.iter().filter(|x| !x.1).map(|x| x.0).collect())
        };
        for id in stale {
            h.boxes.stop(&h, id).await;
        }
        for id in live {
            if h.boxes.disk(&h, id).await > h.cfg.disk_mb {
                h.boxes.stop(&h, id).await;
            }
        }
    }
}
