//! studio-hub: a central da versão nuvem do Llama Studio.
//!
//! - Contas (cadastro, login, sessão em cookie) e o PC vinculado de cada conta.
//! - Cada pedido da interface vai para o PC do usuário, se ele estiver conectado (túnel por WebSocket que o
//!   próprio PC abre), ou para o studio do usuário na nuvem: um contêiner só dele, com pasta própria,
//!   limites de CPU/RAM/disco, desligado quando fica parado e sem rede direta (a saída passa pelo proxy daqui).
//! - Sincroniza conversas, projetos e personalidades entre o PC e a nuvem.

mod admin;
mod auth;
mod boxes;
mod db;
mod link;
mod pages;
mod proxy;
mod push;
mod sync;
mod totp;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub struct Cfg {
    pub bind: String,
    pub proxy_bind: String,
    pub data: std::path::PathBuf,
    pub public_url: String,
    pub image: String,
    pub network: String,
    pub hub_host: String,
    pub signup_open: bool,
    pub signups_per_ip: u32,
    pub mem: String,
    pub cpus: String,
    pub pids: u32,
    pub disk_mb: u64,
    pub idle_min: u64,
    pub max_running: usize,
    pub trust_proxy: bool,
    pub allow: Vec<String>,
    pub docker: String,
    /// endereço do contêiner ({id} = número do usuário); só muda em testes sem Docker
    pub box_addr: String,
}

fn env(k: &str, d: &str) -> String {
    std::env::var(k).ok().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| d.to_string())
}

impl Cfg {
    fn load() -> Cfg {
        Cfg {
            bind: env("HUB_BIND", "0.0.0.0:8700"),
            proxy_bind: env("HUB_PROXY_BIND", "0.0.0.0:3128"),
            data: env("HUB_DATA", "/srv/studio-hub").into(),
            public_url: env("HUB_PUBLIC_URL", "").trim_end_matches('/').to_string(),
            image: env("HUB_IMAGE", "llama-studio-cloud:latest"),
            network: env("HUB_NETWORK", "studio-users"),
            hub_host: env("HUB_HOST", "hub"),
            signup_open: env("HUB_SIGNUP", "open") == "open",
            signups_per_ip: env("HUB_SIGNUPS_PER_IP", "3").parse().unwrap_or(3),
            mem: env("HUB_MEM", "1g"),
            cpus: env("HUB_CPUS", "1"),
            pids: env("HUB_PIDS", "256").parse().unwrap_or(256),
            disk_mb: env("HUB_DISK_MB", "2048").parse().unwrap_or(2048),
            idle_min: env("HUB_IDLE_MIN", "20").parse().unwrap_or(20),
            max_running: env("HUB_MAX_RUNNING", "8").parse().unwrap_or(8),
            trust_proxy: env("HUB_TRUST_PROXY", "0") == "1",
            allow: env("HUB_ALLOW", "").split(',').map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()).collect(),
            docker: env("HUB_DOCKER", "docker"),
            box_addr: env("HUB_BOX_ADDR", "http://studio-u{id}:8080"),
        }
    }
    pub fn secure(&self) -> bool {
        self.public_url.starts_with("https://")
    }
}

pub struct Hub {
    pub cfg: Cfg,
    pub db: Mutex<rusqlite::Connection>,
    pub links: Mutex<HashMap<i64, Arc<link::Link>>>,
    pub boxes: boxes::Boxes,
    pub http: reqwest::Client,
    pub fails: Mutex<HashMap<String, (u32, std::time::Instant)>>,
}

pub type H = Arc<Hub>;

pub fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

pub fn err(code: StatusCode, msg: &str) -> Response {
    (code, Json(json!({ "error": msg }))).into_response()
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let cfg = Cfg::load();
    let _ = std::fs::create_dir_all(cfg.data.join("users"));
    let conn = db::open(&cfg.data.join("hub.db")).expect("banco de dados");
    push::init(&conn);
    if args.len() > 1 {
        std::process::exit(db::cli(&conn, &args[1..]));
    }
    let hub: H = Arc::new(Hub {
        boxes: boxes::Boxes::default(),
        http: reqwest::Client::builder().no_proxy().pool_idle_timeout(std::time::Duration::from_secs(20)).build().expect("http"),
        db: Mutex::new(conn),
        links: Mutex::new(HashMap::new()),
        fails: Mutex::new(HashMap::new()),
        cfg,
    });
    tokio::spawn(boxes::reaper(hub.clone()));
    tokio::spawn(proxy::serve(hub.clone()));
    let app = Router::new()
        .route("/hub/health", get(|| async { "ok" }))
        .route("/hub/login", get(pages::login))
        .route("/hub/client.js", get(pages::client_js))
        .route("/hub/manifest.json", get(pages::manifest))
        .route("/hub/icon.svg", get(pages::icon))
        .route("/hub/icon-192.png", get(pages::icon192))
        .route("/hub/icon-512.png", get(pages::icon512))
        .route("/sw.js", get(pages::sw))
        .route("/hub/api/signup", post(auth::signup))
        .route("/hub/api/login", post(auth::login))
        .route("/hub/api/login/2fa", post(auth::login_2fa))
        .route("/hub/api/password", post(auth::change_password))
        .route("/hub/api/2fa/setup", post(totp::setup))
        .route("/hub/api/2fa/enable", post(totp::enable))
        .route("/hub/api/2fa/disable", post(totp::disable))
        .route("/hub/api/2fa/recovery", post(totp::new_recovery))
        .route("/hub/admin", get(admin::page))
        .route("/hub/api/admin/users", get(admin::users))
        .route("/hub/api/admin/action", post(admin::action))
        .route("/hub/sync/apis", post(sync::push_apis))
        .route("/hub/api/push/key", get(push::key))
        .route("/hub/api/push/subscribe", post(push::subscribe))
        .route("/hub/api/push/unsubscribe", post(push::unsubscribe))
        .route("/hub/internal/notify", post(push::internal))
        .route("/hub/api/logout", post(auth::logout))
        .route("/hub/api/me", get(auth::me))
        .route("/hub/api/pair", post(auth::pair))
        .route("/hub/api/devices", get(auth::devices))
        .route("/hub/api/devices/remove", post(auth::device_remove))
        .route("/hub/api/cloud/stop", post(stop_cloud))
        .route("/hub/link", get(link::ws))
        .route("/hub/sync/index", get(sync::index))
        .route("/hub/sync/item", get(sync::get_item).post(sync::put_item))
        .fallback(route)
        .layer(axum::extract::DefaultBodyLimit::max(200 * 1024 * 1024))
        .with_state(hub.clone());
    let l = tokio::net::TcpListener::bind(&hub.cfg.bind).await.expect("porta");
    eprintln!("studio-hub em {}", hub.cfg.bind);
    axum::serve(l, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).await.expect("servidor");
}

async fn stop_cloud(State(h): State<H>, headers: HeaderMap) -> Response {
    let Some(u) = auth::user(&h, &headers) else { return err(StatusCode::UNAUTHORIZED, "login") };
    if !auth::csrf_ok(&headers) {
        return err(StatusCode::FORBIDDEN, "x-hub");
    }
    h.boxes.stop(&h, u.id).await;
    Json(json!({ "ok": true })).into_response()
}

fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers.get_all(header::COOKIE).iter().filter_map(|v| v.to_str().ok()).flat_map(|v| v.split(';')).find_map(|p| {
        let (k, v) = p.trim().split_once('=')?;
        (k == name).then(|| v.to_string())
    })
}

/// Cabeçalhos que não atravessam (de salto em salto, e os da central).
pub fn skip_header(n: &str) -> bool {
    matches!(
        n,
        "connection" | "keep-alive" | "transfer-encoding" | "te" | "trailer" | "upgrade" | "proxy-authorization" | "proxy-authenticate" | "host" | "cookie" | "content-length" | "x-hub-secret" | "x-forwarded-for" | "x-forwarded-proto" | "x-forwarded-host" | "x-real-ip" | "accept-encoding"
    )
}

/// Tudo que não é da central vai para o PC ou para a nuvem do usuário.
async fn route(State(h): State<H>, req: Request) -> Response {
    let headers = req.headers().clone();
    let path = req.uri().path().to_string();
    let Some(u) = auth::user(&h, &headers) else {
        if req.method() == Method::GET && (path == "/" || headers.get(header::ACCEPT).and_then(|v| v.to_str().ok()).is_some_and(|a| a.contains("text/html"))) {
            return Redirect::to("/hub/login").into_response();
        }
        return err(StatusCode::UNAUTHORIZED, "login");
    };
    let online = h.links.lock().unwrap().get(&u.id).cloned();
    let is_page = req.method() == Method::GET && path == "/";
    let query: HashMap<String, String> = req.uri().query().map(|q| q.split('&').filter_map(|p| p.split_once('=')).map(|(a, b)| (a.to_string(), b.to_string())).collect()).unwrap_or_default();
    // o destino é escolhido quando a página abre e fica fixo até ela ser recarregada
    // (a interface de um lado não conversa com o servidor do outro)
    let target = if is_page {
        match query.get("t").map(String::as_str) {
            Some("cloud") => "cloud",
            Some("pc") if online.is_some() => "pc",
            _ => if online.is_some() { "pc" } else { "cloud" },
        }
    } else {
        match cookie(&headers, "hub_t").as_deref() {
            Some("cloud") => "cloud",
            Some("pc") => "pc",
            _ => if online.is_some() { "pc" } else { "cloud" },
        }
    };
    let mut resp = if target == "pc" {
        match online {
            Some(l) => link::forward(&l, req).await,
            None => {
                let mut r = err(StatusCode::SERVICE_UNAVAILABLE, "O PC desconectou. Recarregue para continuar na nuvem.");
                r.headers_mut().insert("x-hub-switch", HeaderValue::from_static("cloud"));
                r
            }
        }
    } else {
        match h.boxes.ensure(&h, &u, is_page).await {
            Ok(addr) => boxes::forward(&h, &addr, &u, req).await,
            Err(e) => {
                let mut r = err(StatusCode::SERVICE_UNAVAILABLE, &e);
                r.headers_mut().insert("x-hub-cloud", HeaderValue::from_static("down"));
                r
            }
        }
    };
    if is_page {
        resp = pages::inject(resp, target).await;
        let c = format!("hub_t={target}; Path=/; HttpOnly; SameSite=Lax{}", if h.cfg.secure() { "; Secure" } else { "" });
        if let Ok(v) = HeaderValue::from_str(&c) {
            resp.headers_mut().append(header::SET_COOKIE, v);
        }
    }
    resp.headers_mut().insert("x-hub-target", HeaderValue::from_static(if target == "pc" { "pc" } else { "cloud" }));
    resp
}

pub fn client_ip(h: &Hub, headers: &HeaderMap, peer: Option<std::net::SocketAddr>) -> String {
    if h.cfg.trust_proxy {
        // o último da lista é o que o proxy da frente viu (os anteriores vêm do cliente e podem ser forjados)
        if let Some(ip) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()).and_then(|v| v.rsplit(',').next()).filter(|v| !v.trim().is_empty()) {
            return ip.trim().to_string();
        }
    }
    peer.map(|p| p.ip().to_string()).unwrap_or_default()
}

pub fn body_text(b: Body) -> impl std::future::Future<Output = Option<String>> {
    async move { axum::body::to_bytes(b, 8 * 1024 * 1024).await.ok().map(|b| String::from_utf8_lossy(&b).to_string()) }
}
