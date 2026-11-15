//! Páginas e arquivos da própria central: login, o script que entra na interface do studio, o manifesto e o
//! service worker do app (PWA: "Adicionar à tela inicial" no celular).

use axum::body::Body;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};

fn file(ct: &'static str, body: &'static [u8], cache: &'static str) -> Response {
    let mut r = Response::new(Body::from(body));
    r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(ct));
    r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    r
}

pub async fn login() -> Response {
    file("text/html; charset=utf-8", include_bytes!("../assets/login.html"), "no-store")
}
pub async fn client_js() -> Response {
    file("text/javascript; charset=utf-8", include_bytes!("../assets/client.js"), "no-cache")
}
pub async fn icon() -> Response {
    file("image/svg+xml", include_bytes!("../assets/icon.svg"), "max-age=86400")
}
pub async fn icon192() -> Response {
    file("image/png", include_bytes!("../assets/icon-192.png"), "max-age=86400")
}
pub async fn icon512() -> Response {
    file("image/png", include_bytes!("../assets/icon-512.png"), "max-age=86400")
}
pub async fn manifest() -> Response {
    file(
        "application/manifest+json",
        br##"{"name":"Llama Studio","short_name":"Studio","start_url":"/","scope":"/","display":"standalone","background_color":"#17181c","theme_color":"#17181c",
"icons":[{"src":"/hub/icon-192.png","sizes":"192x192","type":"image/png"},{"src":"/hub/icon-512.png","sizes":"512x512","type":"image/png"},{"src":"/hub/icon-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"},{"src":"/hub/icon.svg","sizes":"any","type":"image/svg+xml"}]}"##,
        "max-age=3600",
    )
}
/// Sem cache de nada: o studio é sempre o da hora (PC ou nuvem); o service worker só existe para o app instalar.
pub async fn sw() -> Response {
    file("text/javascript; charset=utf-8", b"self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',()=>{});", "no-cache")
}

/// Põe o manifesto e o script da central na página do studio.
pub async fn inject(resp: Response, target: &str) -> Response {
    let ok = resp.status() == StatusCode::OK && resp.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|c| c.contains("text/html"));
    if !ok {
        return resp;
    }
    let (mut parts, body) = resp.into_parts();
    let Some(html) = crate::body_text(body).await else { return StatusCode::BAD_GATEWAY.into_response() };
    let tag = format!(
        "<link rel=\"manifest\" href=\"/hub/manifest.json\"><meta name=\"theme-color\" content=\"#17181c\"><meta name=\"mobile-web-app-capable\" content=\"yes\"><link rel=\"apple-touch-icon\" href=\"/hub/icon-192.png\"><script>window.__hubTarget=\"{}\"</script><script src=\"/hub/client.js\" defer></script>",
        if target == "pc" { "pc" } else { "cloud" }
    );
    let html = match html.find("</head>") {
        Some(i) => format!("{}{tag}{}", &html[..i], &html[i..]),
        None => format!("{tag}{html}"),
    };
    parts.headers.remove(header::CONTENT_LENGTH);
    parts.headers.remove(header::CONTENT_ENCODING);
    parts.headers.remove(header::ETAG);
    parts.headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Response::from_parts(parts, Body::from(html))
}
