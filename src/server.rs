//! Servidor HTTP local: API do studio, proxy para o llama-server e interface embutida.

use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Query, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post};
use axum::{Json, Router};
use rust_embed::RustEmbed;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::app::{self, file_name, is_inside, looks_binary, rel_to, resolve, App, UiMsg};
use crate::{locate, skills, tools};

#[derive(RustEmbed)]
#[folder = "ui/"]
struct Assets;

type S = State<Arc<App>>;
type Q = Query<HashMap<String, String>>;

pub struct ApiErr(StatusCode, String);
type Res = Result<Json<Value>, ApiErr>;

impl IntoResponse for ApiErr {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}
fn bad(m: impl Into<String>) -> ApiErr {
    ApiErr(StatusCode::BAD_REQUEST, m.into())
}
fn ok(v: Value) -> Res {
    Ok(Json(v))
}
fn body(b: &Bytes) -> Value {
    serde_json::from_slice(b).unwrap_or_else(|_| json!({}))
}
fn st<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}
fn strs(v: &Value, k: &str) -> Vec<String> {
    v.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default()
}
fn q<'a>(q: &'a HashMap<String, String>, k: &str) -> &'a str {
    q.get(k).map(String::as_str).unwrap_or("")
}
/// Pasta de trabalho da conversa (a do projeto) ou a geral.
fn ws_of(app: &App, p: &str) -> PathBuf {
    let p = p.trim();
    if !p.is_empty() {
        let pb = PathBuf::from(p);
        if pb.is_absolute() && pb.is_dir() {
            return app::normalize(&pb);
        }
    }
    app.workspace()
}

pub fn router(app: Arc<App>) -> Router {
    Router::new()
        .route("/api/state", get(state))
        .route("/api/ui", get(ui_all).post(ui_put))
        .route("/api/config", post(set_config))
        .route("/api/bins", get(bins_list))
        .route("/api/bins/install", post(bins_install))
        .route("/api/bins/remove", post(bins_remove))
        .route("/api/app", get(app_info))
        .route("/api/app/show", post(app_show))
        .route("/api/app/quit", post(app_quit))
        .route("/api/workspace", post(set_workspace))
        .route("/api/ws/list", get(ws_list))
        .route("/api/ws/read", get(ws_read))
        .route("/api/ws/upload", post(ws_upload))
        .route("/api/reveal", post(reveal))
        .route("/api/export", post(export_conv))
        .route("/api/browse", get(browse))
        .route("/api/locate", post(locate_h))
        .route("/api/remember", post(remember))
        .route("/api/stat", post(stat))
        .route("/api/skills", get(skills_list))
        .route("/api/skills/get", get(skills_get))
.route("/api/nim-status", get(nim_status_handler))
        .route("/api/limit-status", get(nim_status_handler))
        .route("/api/skills/save", post(skills_save))
        .route("/api/skills/delete", post(skills_delete))
        .route("/api/skills/import-path", post(skills_import_path))
        .route("/api/skills/import-zip", post(skills_import_zip))
        .route("/api/skills/open", post(skills_open))
        .route("/api/mcp", get(mcp_list))
        .route("/api/mcp/config", get(mcp_config_get).post(mcp_config_set))
        .route("/api/mcp/upsert", post(mcp_upsert))
        .route("/api/mcp/import", post(mcp_import))
        .route("/api/mcp/delete", post(mcp_delete))
        .route("/api/mcp/toggle", post(mcp_toggle))
        .route("/api/mcp/hide", post(mcp_hide))
        .route("/api/mcp/reconnect", post(mcp_reconnect))
        .route("/api/tools", post(tools_list))
        .route("/api/context", post(context))
        .route("/api/tools/call", post(tools_call))
        .route("/api/tools/search", post(tools_search))
        .route("/api/update", get(update_check))
        .route("/api/update/ui", post(update_ui))
        .route("/api/update/reset-ui", post(update_reset_ui))
        .route("/api/update/exe", post(update_exe))
        .route("/api/llama", get(llama_get))
        .route("/api/llama/config", post(llama_config))
        .route("/api/llama/start", post(llama_start))
        .route("/api/llama/stop", post(llama_stop))
        .route("/api/llama/restart", post(llama_restart))
        .route("/api/llama/log", get(llama_log))
        .route("/api/models", get(models_list).post(models_save))
        .route("/api/models/activate", post(models_activate))
        .route("/api/engines", get(engines_list))
        .route("/api/engines/install", post(engines_install))
        .route("/api/engines/use", post(engines_use))
        .route("/api/engines/remove", post(engines_remove))
        .route("/api/engines/cancel", post(engines_cancel))
        .route("/api/hf", get(hf_info).post(hf_token))
        .route("/api/hf/search", get(hf_search))
        .route("/api/hf/files", get(hf_files))
        .route("/api/hf/download", post(hf_download))
        .route("/api/hf/downloads", get(hf_downloads))
        .route("/api/hf/cancel", post(hf_cancel))
        .route("/remote/v1/chat/completions", post(remote_chat))
        .route("/api/remote/models", get(remote_models))
        .route("/api/videos", get(videos_list))
        .route("/api/videos/create", post(videos_create))
        .route("/api/videos/job", get(videos_job))
        .route("/api/videos/compositions", get(videos_comps))
        .route("/api/videos/render", post(videos_render))
        .route("/api/videos/studio", post(videos_studio))
        .route("/api/videos/delete", post(videos_delete))
        .route("/api/videos/skills", post(videos_skills))
        .route("/api/videos/check", post(videos_check))
        .route("/api/videos/smoke", post(videos_smoke))
        .route("/api/videos/edit", post(videos_edit))
        .route("/api/videos/speech", post(videos_speech))
        .route("/api/videos/media", post(videos_media))
        // vídeos grandes: sem o limite de 200 MB dos outros pedidos (o arquivo vai direto para o disco)
        .route("/api/videos/upload", post(videos_upload).layer(DefaultBodyLimit::disable()))
        .route("/api/dictate", post(dictate).layer(DefaultBodyLimit::max(64 * 1024 * 1024)))
        .route("/api/dictate/status", get(dictate_status))
        .route("/api/backup", get(backup_status))
        .route("/api/sandbox", get(sandbox_status))
        .route("/api/sandbox/settings", post(sandbox_settings))
        .route("/api/sandbox/prepare", post(sandbox_prepare))
        .route("/api/sandbox/remove", post(sandbox_remove))
        .route("/api/sandbox/packages", post(sandbox_packages))
        .route("/api/backup/settings", post(backup_settings))
        .route("/api/backup/now", post(backup_now))
        .route("/api/backup/restore", post(backup_restore))
        .route("/api/dictate/setup", post(dictate_setup))
        .route("/api/videos/frames", post(videos_frames))
        .route("/api/videos/captions", post(videos_captions))
        .route("/api/videos/peaks", post(videos_peaks))
        .route("/api/videos/captions-save", post(videos_captions_save))
        .route("/api/videos/render-all", post(videos_render_all))
        .route("/api/videos/thumbnail", post(videos_thumbnail))
        .route("/api/videos/wire", post(videos_wire))
        .route("/api/videos/file", get(videos_file))
        .route("/api/remote/warm", post(remote_warm))
        .route("/api/remote/ping", get(remote_ping))
        .route("/v1/{*rest}", any(proxy))
        .route("/props", any(proxy))
        .route("/health", any(proxy))
        .route("/slots", any(proxy))
        .route("/slots/{*rest}", any(proxy))
        .route("/api/kvcache/prune", post(kv_prune))
        .route("/api/checkpoints", post(cp_list))
        .route("/api/projmap", post(projmap_get))
        .route("/api/projmap/summary", post(projmap_summary))
        .route("/api/notebook", post(nb_get))
        .route("/api/arrumar", post(arr_get))
        .route("/api/arrumar/rules", post(arr_rules))
        .route("/api/arrumar/plan", post(arr_plan))
        .route("/api/arrumar/apply", post(arr_apply))
        .route("/api/arrumar/undo", post(arr_undo))
        .route("/api/share/collect", post(share_collect))
        .route("/api/share/save", post(share_save))
        .route("/api/share/read", post(share_read))
        .route("/api/share/apply", post(share_apply))
        .route("/api/sig", post(sig_list))
        .route("/api/sig/save", post(sig_save))
        .route("/api/sig/make", post(sig_make))
        .route("/api/sig/scan", post(sig_scan))
        .route("/api/notebook/save", post(nb_put))
        .route("/api/checkpoints/undo", post(cp_undo))
        .route("/api/checkpoints/diff", post(cp_diff))
        .route("/api/img", post(img_data))
        .route("/api/checkpoints/prune", post(cp_prune))
        .route("/api/bench", get(bench_status))
        .route("/api/bench/start", post(bench_start))
        .route("/api/bench/cancel", post(bench_cancel))
        .route("/tokenize", any(proxy))
        .route("/detokenize", any(proxy))
        .route("/apply-template", any(proxy))
        .route("/models", any(proxy))
        .fallback(static_file)
        .layer(DefaultBodyLimit::max(200 * 1024 * 1024))
        .layer(middleware::from_fn(guard))
        .with_state(app)
}

/// Só aceita o próprio computador e exige o cabeçalho X-Studio nas rotas que mudam algo.
async fn guard(req: Request, next: Next) -> Response {
    let host = req.headers().get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or("");
    let host = if host.starts_with('[') { host.split(']').next().map(|h| format!("{h}]")).unwrap_or_default() } else { host.split(':').next().unwrap_or("").to_string() };
    if !matches!(host.as_str(), "127.0.0.1" | "localhost" | "[::1]") {
        return (StatusCode::FORBIDDEN, L!("Host não permitido", "Host not allowed")).into_response();
    }
    let path = req.uri().path();
    // o <video> da página não manda cabeçalhos: o arquivo renderizado é só leitura
    let is_api = path.starts_with("/api/") && !(req.method() == Method::GET && path == "/api/videos/file");
    let is_proxy_write = req.method() != Method::GET && !is_api && path != "/" && !path.contains('.');
    if (is_api || is_proxy_write) && req.headers().get("x-studio").map(|v| v.as_bytes()) != Some(b"1") {
        return (StatusCode::FORBIDDEN, Json(json!({"error":L!("Cabeçalho ausente", "Missing header")}))).into_response();
    }
    next.run(req).await
}

// ---------------------------------------------------------------- estáticos

async fn static_file(State(app): S, req: Request) -> Response {
    if req.method() != Method::GET {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    let path = req.uri().path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    // interface atualizada (dados\ui) tem prioridade sobre a embutida
    if crate::update::ui_override_version(&app).is_some() {
        let dir = crate::update::ui_dir(&app);
        let file = resolve(&dir, path);
        if is_inside(&dir, &file) && file.is_file() {
            if let Ok(data) = std::fs::read(&file) {
                let mime = mime_guess::from_path(path).first_or_octet_stream();
                let mut r = Response::new(Body::from(data));
                r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_str(mime.as_ref()).unwrap());
                r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
                return r;
            }
        }
    }
    match Assets::get(path) {
        Some(f) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            let mut r = Response::new(Body::from(f.data.into_owned()));
            r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_str(mime.as_ref()).unwrap());
            r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
            r
        }
        None => (StatusCode::NOT_FOUND, L!("Não encontrado", "Not found")).into_response(),
    }
}

// ---------------------------------------------------------------- proxy

async fn proxy(State(app): S, req: Request) -> Response {
    let (parts, b) = req.into_parts();
    
    // Extrai o body do request antecipadamente para podermos redirecionar
    let bytes = match axum::body::to_bytes(b, 64 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => return (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    };

    // INTERCEPTADOR REMOTO: Se o modelo selecionado no dropdown for uma API Externa
    let current_model = app.llama.cfg().model;
    if current_model.starts_with("remote:") {
        let provider_id = current_model.trim_start_matches("remote:");
        let path = parts.uri.path();
        
        if path.ends_with("/chat/completions") || path.ends_with("/completions") {
            // Manda o request transparente para o crate::remote em vez do llama-server
            // pelo proxy só chegam pedidos laterais (a conversa num perfil remoto vai direto em /remote)
            return crate::remote::chat(&app, provider_id, bytes, true).await;
        } else if path.ends_with("/models") {
            return (StatusCode::OK, Json(json!({"data": [{"id": current_model, "object": "model"}]}))).into_response();
        } else if path == "/props" {
            let prov = app.cfg().api_providers.iter().find(|p| p.id == provider_id).cloned();
            let ctx = prov.as_ref().map(crate::remote::context_of).unwrap_or(crate::remote::DEFAULT_CONTEXT);
            let vision = prov.is_some_and(|p| p.vision);
            return (StatusCode::OK, Json(json!({"model_alias": current_model, "default_generation_settings": {"n_ctx": ctx}, "total_slots": 1, "modalities": {"vision": vision}, "ignored_by_remote": true}))).into_response();
        } else {
            // Resposta vazia gentil para endpoints locais que não existem em APIs remotas (ex: /tokenize)
            return (StatusCode::OK, Json(json!({"status": "ok", "ignored_by_remote": true}))).into_response();
        }
    }

    // FLUXO NORMAL: Se for um GGUF local, encaminha para o llama-server
    let base = app.cfg().llama_url;
    let url = format!("{}{}", base.trim_end_matches('/'), parts.uri.path_and_query().map(|p| p.as_str()).unwrap_or("/"));
    
    let mut rb = app.http.request(parts.method.clone(), &url);
    for (k, v) in parts.headers.iter() {
        let n = k.as_str();
        if matches!(n, "host" | "x-studio" | "origin" | "referer" | "content-length" | "connection" | "accept-encoding") {
            continue;
        }
        rb = rb.header(k, v);
    }
    match rb.body(bytes).send().await {
        Ok(resp) => {
            let mut out = Response::builder().status(resp.status().as_u16());
            for (k, v) in resp.headers() {
                if matches!(k.as_str(), "transfer-encoding" | "connection" | "keep-alive" | "content-length") {
                    continue;
                }
                out = out.header(k, v);
            }
            out.body(Body::from_stream(crate::remote::safe_stream(resp, "llama-server".into()))).unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error":{"message": LF!("llama-server indisponível em {base} ({}). Ele está rodando?", "llama-server unavailable at {base} ({}). Is it running?", e.without_url())}})),
        )
            .into_response(),
    }
}

async fn remote_chat(State(app): S, Query(qs): Q, b: Bytes) -> Response {
    crate::remote::chat(&app, q(&qs, "p"), b, q(&qs, "bg") == "1").await
}

// ---------------------------------------------------------------- vídeos (Remotion)
async fn videos_list(State(app): S) -> Res {
    ok(app.videos.list(&app).await)
}
async fn videos_create(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    app.videos.create(app.clone(), st(&v, "name")).map(ok).map_err(bad)?
}
async fn videos_job(State(app): S, Query(qs): Q) -> Res {
    ok(app.videos.job(q(&qs, "id")))
}
async fn videos_comps(State(app): S, Query(qs): Q) -> Res {
    match app.videos.compositions(&app, q(&qs, "id")).await {
        Ok(c) => ok(json!({ "compositions": c })),
        Err(e) => Err(bad(e)),
    }
}
async fn videos_render(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    app.videos.render(&app, st(&v, "id"), st(&v, "comp")).map(ok).map_err(bad)?
}
async fn videos_studio(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    if st(&v, "action") == "stop" {
        app.videos.studio_stop();
        return ok(json!({}));
    }
    match app.videos.studio_start(&app, st(&v, "id")).await {
        Ok(r) => ok(r),
        Err(e) => Err(bad(e)),
    }
}
async fn videos_delete(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    app.videos.delete(&app, st(&v, "id")).map(|_| ok(json!({}))).map_err(bad)?
}
async fn videos_media(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    app.videos.media(&app, st(&v, "id")).await.map(ok).map_err(bad)?
}
async fn videos_upload(State(app): S, Query(qs): Q, req: Request) -> Res {
    let (id, name) = (q(&qs, "id").to_string(), q(&qs, "name").to_string());
    app.videos.upload(&app, &id, &name, req.into_body()).await.map(ok).map_err(bad)?
}
async fn videos_frames(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let times: Vec<f64> = v["times"].as_array().map(|a| a.iter().filter_map(Value::as_f64).take(36).collect()).unwrap_or_default();
    let width = v["width"].as_u64().unwrap_or(480) as u32;
    let count = v["count"].as_u64().unwrap_or(12) as usize;
    let (from, to) = (v["from"].as_f64().unwrap_or(0.0), v["to"].as_f64().unwrap_or(0.0));
    app.videos.frames(&app, st(&v, "id"), st(&v, "file"), &times, count, from, to, width).await.map(ok).map_err(bad)?
}
async fn videos_thumbnail(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    app.videos.thumbnail(&app, st(&v, "id"), st(&v, "name"), &v).await.map(ok).map_err(bad)?
}
async fn videos_render_all(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    app.videos.render_all(&app, st(&v, "id"), &strs(&v, "comps")).map(ok).map_err(bad)?
}
async fn videos_captions_save(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let edits: Vec<(f64, f64, String)> = v["edits"].as_array().map(|a| a.iter().filter_map(|e| Some((e["from"].as_f64()?, e["to"].as_f64()?, e["text"].as_str()?.to_string()))).collect()).unwrap_or_default();
    app.videos.captions_save(&app, st(&v, "id"), st(&v, "file"), &edits).map(ok).map_err(bad)?
}
async fn dictate(State(app): S, Query(q): Query<HashMap<String, String>>, b: Bytes) -> Res {
    let g = |k: &str| q.get(k).map(String::as_str).unwrap_or("");
    crate::dictate::transcribe(&app, &b, g("lang"), g("model")).await.map(ok).map_err(bad)?
}
async fn sandbox_status(State(app): S) -> Res {
    let mut v = crate::sandbox::status(&app).await;
    if let Some(list) = v["distros"].as_array().cloned() {
        v["distros"] = json!(list.iter().filter_map(|d| d.as_str()).map(|d| json!({ "name": d, "folder": crate::sandbox::folder_of(&app, d) })).collect::<Vec<_>>());
    }
    ok(v)
}
async fn sandbox_settings(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    {
        let mut c = app.config.write().unwrap();
        if let Some(x) = v["enabled"].as_bool() {
            c.sandbox.enabled = x;
        }
        if let Some(x) = v["noNet"].as_bool() {
            c.sandbox.no_net = x;
        }
        if let Some(x) = v["packages"].as_str() {
            c.sandbox.packages = x.trim().to_string();
        }
        if let Some(x) = v["distro"].as_str() {
            if crate::sandbox::DISTROS.iter().any(|d| d.0 == x) {
                c.sandbox.distro = x.to_string();
            }
        }
        if let (Some(f), Some(off)) = (v["folder"].as_str(), v["off"].as_bool()) {
            c.sandbox.set_off(f, off);
        }
    }
    app.save_config();
    ok(crate::sandbox::status(&app).await)
}
async fn sandbox_prepare(State(app): S) -> Res {
    crate::sandbox::prepare(app.clone());
    ok(json!({ "started": true }))
}
/// Pacotes do Linux de uma pasta: {name} lista, {name, q} procura, {name, add, del} instala ou remove.
async fn sandbox_packages(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let name = st(&v, "name");
    let r = if v.get("add").is_some() || v.get("del").is_some() {
        crate::sandbox::change(&app, name, &strs(&v, "add"), &strs(&v, "del")).await
    } else if let Some(q) = v["q"].as_str() {
        crate::sandbox::search(&app, name, q).await
    } else {
        crate::sandbox::packages(&app, name).await
    };
    r.map(ok).map_err(bad)?
}
async fn sandbox_remove(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    crate::sandbox::remove(&app, st(&v, "name"), v["all"] == json!(true)).await.map(ok).map_err(bad)?
}
async fn backup_status(State(app): S) -> Res {
    ok(crate::backup::status(&app))
}
async fn backup_settings(State(app): S, b: Bytes) -> Res {
    ok(crate::backup::set(&app, &body(&b)))
}
async fn backup_now(State(app): S) -> Res {
    let a = app.clone();
    let r = tokio::task::spawn_blocking(move || crate::backup::run(&a)).await.map_err(|e| bad(e.to_string()))?;
    r.map(|mut v| {
        v["status"] = crate::backup::status(&app);
        ok(v)
    })
    .map_err(bad)?
}
async fn backup_restore(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    crate::backup::restore(&app, st(&v, "file")).await.map(ok).map_err(bad)?
}
async fn dictate_status(State(app): S) -> Res {
    ok(crate::dictate::status(&app))
}
async fn dictate_setup(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    crate::dictate::setup(&app, st(&v, "model")).await.map(ok).map_err(bad)?
}
async fn videos_peaks(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let (from, to) = (v["from"].as_f64().unwrap_or(0.0), v["to"].as_f64().unwrap_or(0.0));
    let min = v["min"].as_f64().unwrap_or(8.0);
    let top = v["top"].as_u64().unwrap_or(15) as usize;
    app.videos.peaks(&app, st(&v, "id"), st(&v, "file"), from, to, min, top).await.map(ok).map_err(bad)?
}
async fn videos_captions(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    app.videos.captions(app.clone(), st(&v, "id"), st(&v, "file"), st(&v, "model"), st(&v, "lang")).map(ok).map_err(bad)?
}
async fn videos_edit(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    app.videos.edit(&app, st(&v, "id"), st(&v, "name"), v["edl"].clone()).await.map(ok).map_err(bad)?
}
async fn videos_speech(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let f = |k: &str| v[k].as_f64().unwrap_or(0.0);
    app.videos.speech(&app, st(&v, "id"), st(&v, "file"), f("gap"), f("from"), f("to"), st(&v, "query")).map(ok).map_err(bad)?
}
async fn videos_smoke(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    app.videos.smoke(&app, st(&v, "id"), st(&v, "comp")).await.map(ok).map_err(bad)?
}
async fn videos_check(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    app.videos.check(&app, st(&v, "id")).await.map(ok).map_err(bad)?
}
async fn videos_wire(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    app.videos.wire(&app, st(&v, "id")).map(ok).map_err(bad)?
}
async fn videos_skills(State(app): S) -> Res {
    match app.videos.install_skills(&app).await {
        Ok(n) => ok(json!({ "installed": n })),
        Err(e) => Err(bad(e)),
    }
}
/// Arquivo do projeto de vídeo: os renderizados (out/) ou a mídia (in=public, até uma subpasta, ex.:
/// captions/x.srt). Com Range, lido do disco só o trecho pedido (o player pula sem baixar o vídeo inteiro).
async fn videos_file(State(app): S, Query(qs): Q, headers: axum::http::HeaderMap) -> Response {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    let (id, f) = (q(&qs, "id"), q(&qs, "f"));
    let base = if q(&qs, "in") == "public" { "public" } else { "out" };
    let parts: Vec<&str> = f.split('/').collect();
    let bad_part = |x: &str| x.is_empty() || x.contains(['\\', ':']) || x.starts_with('.');
    if id.is_empty() || bad_part(id) || id.contains('/') || parts.len() > if base == "public" { 2 } else { 1 } || parts.iter().any(|p| bad_part(p)) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let path = crate::videos::root(&app).join(id).join(base).join(f);
    let Ok(mut file) = tokio::fs::File::open(&path).await else { return StatusCode::NOT_FOUND.into_response() };
    let total = file.metadata().await.map(|m| m.len()).unwrap_or(0);
    let ct = match f.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
        "webm" => "video/webm",
        "gif" => "image/gif",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" | "aac" => "audio/mp4",
        "ogg" | "opus" => "audio/ogg",
        "json" => "application/json",
        "srt" => "text/plain; charset=utf-8",
        _ => "video/mp4",
    };
    let range = headers.get("range").and_then(|h| h.to_str().ok()).and_then(|r| r.strip_prefix("bytes=")).and_then(|r| {
        let (a, b) = r.split_once('-')?;
        let a: u64 = a.parse().ok()?;
        // pedaço aberto ("bytes=N-"): no máximo 8 MB por resposta; o player pede o resto
        let b: u64 = if b.is_empty() { (a + 8 * 1024 * 1024 - 1).min(total.saturating_sub(1)) } else { b.parse::<u64>().ok()?.min(total.saturating_sub(1)) };
        (a <= b && b < total).then_some((a, b))
    });
    let download = q(&qs, "dl") == "1";
    let disp = format!("attachment; filename=\"{}\"", f.rsplit('/').next().unwrap_or(f));
    match range {
        Some((a, b)) => {
            let len = (b - a + 1) as usize;
            let mut buf = vec![0u8; len];
            if file.seek(std::io::SeekFrom::Start(a)).await.is_err() || file.read_exact(&mut buf).await.is_err() {
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
            Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header("Content-Type", ct)
                .header("Accept-Ranges", "bytes")
                .header("Content-Range", format!("bytes {a}-{b}/{total}"))
                .header("Content-Length", len)
                .body(Body::from(buf))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        None => {
            let mut rb = Response::builder().header("Content-Type", ct).header("Accept-Ranges", "bytes").header("Content-Length", total);
            if download {
                rb = rb.header("Content-Disposition", disp);
            }
            rb.body(Body::from_stream(tokio_util_stream(file))).unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
    }
}

/// O arquivo inteiro como stream, em blocos de 256 KB (sem carregar na memória).
fn tokio_util_stream(file: tokio::fs::File) -> impl futures_util::Stream<Item = std::io::Result<Bytes>> {
    use tokio::io::AsyncReadExt;
    futures_util::stream::unfold(Some(file), |st| async move {
        let mut file = st?;
        let mut buf = vec![0u8; 256 * 1024];
        match file.read(&mut buf).await {
            Ok(0) => None,
            Ok(n) => {
                buf.truncate(n);
                Some((Ok(Bytes::from(buf)), Some(file)))
            }
            Err(e) => Some((Err(e), None)),
        }
    })
}

async fn remote_warm(State(app): S, Query(qs): Q) -> Res {
    let id = q(&qs, "p").to_string();
    tokio::spawn(async move { crate::remote::warm(&app, &id).await });
    ok(json!({}))
}

async fn remote_models(State(app): S, Query(qs): Q) -> Res {
    match crate::remote::models(&app, q(&qs, "p")).await {
        Ok(m) => ok(json!({ "models": m })),
        Err(e) => Err(bad(e)),
    }
}

async fn remote_ping(State(app): S, Query(qs): Q) -> Res {
    match crate::remote::ping(&app, q(&qs, "p")).await {
        Ok(()) => ok(json!({ "ok": true })),
        Err(e) => ok(json!({ "ok": false, "error": e })),
    }
}

// ---------------------------------------------------------------- estado e config

async fn ui_all(State(app): S) -> Res {
    ok(crate::uistate::all(&app))
}
async fn ui_put(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let t = v["t"].as_u64().unwrap_or(0);
    if v["del"] == json!(true) {
        return crate::uistate::remove(&app, st(&v, "key"), t).map(|saved| ok(json!({ "saved": saved }))).map_err(bad)?;
    }
    crate::uistate::put(&app, st(&v, "key"), t, &v["v"]).map(|saved| ok(json!({ "saved": saved }))).map_err(bad)?
}
async fn state(State(app): S) -> Res {
    let c = app.cfg();
    ok(json!({
        "workspace": c.workspace,
        "recentWorkspaces": c.recent_workspaces,
        "llamaUrl": c.llama_url,
        "extraSkillsDirs": c.extra_skills_dirs,
        "skillsDir": app.skills_dir(),
        "mcpFile": app.mcp_file(),
        "platform": if app::IS_WIN { "win32" } else { std::env::consts::OS },
        "home": app::home_dir(),
        "sep": std::path::MAIN_SEPARATOR.to_string(),
        "native": app.native_window.load(std::sync::atomic::Ordering::SeqCst),
        "version": crate::update::exe_version(),
        "uiVersion": crate::update::ui_version(&app),
        "repo": crate::update::REPO,
        "windowGpu": c.window_gpu,
        "closeToTray": c.close_to_tray,
        "compactOutput": c.compact_output,
        "useRtk": c.use_rtk,
        "lang": c.lang,
        "apis": crate::remote::public(&app),
    }))
}

async fn set_config(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    {
        let mut c = app.config.write().unwrap();
        if let Some(u) = v.get("llamaUrl").and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
            c.llama_url = u.trim().trim_end_matches('/').to_string();
        }
        if v.get("extraSkillsDirs").is_some() {
            c.extra_skills_dirs = strs(&v, "extraSkillsDirs");
        }
        if let Some(g) = v.get("windowGpu").and_then(Value::as_bool) {
            c.window_gpu = g;
        }
        if let Some(g) = v.get("closeToTray").and_then(Value::as_bool) {
            c.close_to_tray = g;
        }
        if let Some(g) = v.get("compactOutput").and_then(Value::as_bool) {
            c.compact_output = g;
        }
        if let Some(g) = v.get("useRtk").and_then(Value::as_bool) {
            c.use_rtk = g;
        }
        // {"apiProvider": {"id", "name"?, "base"?, "model"?, "key"?}}: cria ou atualiza (chave só troca quando vem)
        if let Some(p) = v.get("apiProvider").filter(|p| p.is_object()) {
            let id = p["id"].as_str().unwrap_or("").trim().to_string();
            if !id.is_empty() {
                let i = match c.api_providers.iter().position(|x| x.id == id) {
                    Some(i) => i,
                    None => {
                        c.api_providers.push(crate::app::ApiProvider { id: id.clone(), ..Default::default() });
                        c.api_providers.len() - 1
                    }
                };
                let e = &mut c.api_providers[i];
                for (k, f) in [("name", &mut e.name), ("base", &mut e.base), ("model", &mut e.model), ("fallbackModel", &mut e.fallback_model), ("key", &mut e.key)] {
                    if let Some(x) = p.get(k).and_then(Value::as_str) {
                        *f = x.trim().to_string();
                    }
                }
                if let Some(x) = p.get("vision").and_then(Value::as_bool) {
                    e.vision = x;
                }
                if let Some(x) = p.get("context") {
                    e.context = x.as_u64().map(|n| n.min(4_000_000) as u32).unwrap_or(0);
                }
                if let Some(x) = p.get("rpm") {
                    e.rpm = x.as_u64().map(|n| n.min(100_000) as u32).unwrap_or(0);
                }
                if let Some(x) = p.get("rpd") {
                    e.rpd = x.as_u64().map(|n| n.min(10_000_000) as u32).unwrap_or(0);
                }
                if let Some(r) = p.get("retries") {
                    e.retries = r.as_u64().map(|n| (n as u32).min(10));
                }
                if let Some(x) = p.get("params").and_then(Value::as_object) {
                    e.params = x.iter().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k.clone(), v.clone())).collect();
                }
                if let Some(x) = p.get("thinkParams") {
                    if let Ok(v) = serde_json::from_value(x.clone()) {
                        e.think_params = v;
                    }
                }
            }
        }
        if let Some(id) = v.get("apiProviderDelete").and_then(Value::as_str) {
            c.api_providers.retain(|x| x.id != id);
        }
        if let Some(l) = v.get("lang").and_then(Value::as_str).filter(|l| !l.is_empty()) {
            c.lang = if l.starts_with("en") { "en".into() } else { "pt".into() };
            crate::i18n::set(&c.lang);
        }
    }
    app.save_config();
    ok(json!({"ok": true}))
}

async fn app_info(State(app): S) -> Res {
    ok(json!({"native": app.native_window.load(std::sync::atomic::Ordering::SeqCst), "version": crate::update::exe_version(), "uiVersion": crate::update::ui_version(&app)}))
}

// ---------------------------------------------------------------- atualizações

async fn update_check(State(app): S, Query(qs): Q) -> Res {
    ok(crate::update::check(&app, q(&qs, "force") == "1").await)
}

async fn update_ui(State(app): S) -> Res {
    let v = crate::update::apply_ui(&app).await.map_err(bad)?;
    ok(json!({"version": v}))
}

async fn update_reset_ui(State(app): S) -> Res {
    crate::update::reset_ui(&app);
    ok(json!({"ok": true}))
}

async fn update_exe(State(app): S) -> Res {
    crate::update::apply_exe(&app).await.map_err(bad)?;
    // dá tempo da resposta chegar à interface; depois sai e a versão nova assume
    let a = app.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        if a.native_window.load(std::sync::atomic::Ordering::SeqCst) {
            a.ui(UiMsg::Quit);
        } else {
            let _ = tokio::task::spawn_blocking(move || {
                a.shutdown();
                std::process::exit(0);
            });
        }
    });
    ok(json!({"ok": true}))
}

async fn app_show(State(app): S, Query(qs): Q) -> Res {
    if q(&qs, "start") == "1" && app.llama.state() == "stopped" {
        let _ = app.llama.start(&app);
    }
    app.ui(UiMsg::Show);
    ok(json!({"ok": true}))
}

async fn app_quit(State(app): S) -> Res {
    app.ui(UiMsg::Quit);
    ok(json!({"ok": true}))
}

// ---------------------------------------------------------------- pasta de trabalho

async fn set_workspace(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let p = resolve(&app::home_dir(), st(&v, "path"));
    if !p.is_dir() {
        return Err(bad(LF!("Pasta não encontrada: {}", "Folder not found: {}", p.display())));
    }
    let s = p.to_string_lossy().into_owned();
    {
        let mut c = app.config.write().unwrap();
        c.workspace = s.clone();
        c.recent_workspaces.retain(|x| !x.eq_ignore_ascii_case(&s));
        c.recent_workspaces.insert(0, s.clone());
        c.recent_workspaces.truncate(8);
    }
    app.save_config();
    ok(json!({"workspace": s}))
}

fn list_dir(dir: &Path, dirs_only: bool) -> std::io::Result<Vec<Value>> {
    let mut items = vec![];
    for e in std::fs::read_dir(dir)?.flatten() {
        let full = e.path();
        let is_dir = full.is_dir();
        if dirs_only && !is_dir {
            continue;
        }
        let (size, mtime) = if is_dir {
            (0, 0.0)
        } else {
            e.metadata()
                .map(|m| (m.len(), m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as f64).unwrap_or(0.0)))
                .unwrap_or((0, 0.0))
        };
        items.push(json!({"name": e.file_name().to_string_lossy(), "path": full, "dir": is_dir, "size": size, "mtime": mtime}));
    }
    items.sort_by(|a, b| {
        let (da, db) = (a["dir"].as_bool().unwrap(), b["dir"].as_bool().unwrap());
        db.cmp(&da).then_with(|| natural_cmp(a["name"].as_str().unwrap(), b["name"].as_str().unwrap()))
    });
    Ok(items)
}

fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let (a, b) = (a.to_lowercase(), b.to_lowercase());
    let (mut ai, mut bi) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, _) => return std::cmp::Ordering::Less,
            (_, None) => return std::cmp::Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let mut na = String::new();
                while let Some(c) = ai.peek().copied().filter(char::is_ascii_digit) {
                    na.push(c);
                    ai.next();
                }
                let mut nb = String::new();
                while let Some(c) = bi.peek().copied().filter(char::is_ascii_digit) {
                    nb.push(c);
                    bi.next();
                }
                let o = na.len().cmp(&nb.len()).then(na.cmp(&nb));
                if o != std::cmp::Ordering::Equal {
                    return o;
                }
            }
            (Some(x), Some(y)) => {
                if x != y {
                    return x.cmp(&y);
                }
                ai.next();
                bi.next();
            }
        }
    }
}

async fn ws_list(State(app): S, Query(qs): Q) -> Res {
    let ws = ws_of(&app, q(&qs, "ws"));
    let dir = resolve(&ws, q(&qs, "path"));
    if !is_inside(&ws, &dir) {
        return Err(ApiErr(StatusCode::FORBIDDEN, L!("Fora da pasta de trabalho", "Outside the workspace").into()));
    }
    let items = tokio::task::spawn_blocking(move || list_dir(&dir, false)).await.unwrap().map_err(|e| bad(e.to_string()))?;
    let more = items.len().saturating_sub(2000);
    let items: Vec<Value> = items
        .into_iter()
        .take(2000)
        .map(|mut i| {
            let r = rel_to(&ws, Path::new(i["path"].as_str().unwrap_or("")));
            i["rel"] = json!(r);
            i
        })
        .collect();
    ok(json!({"items": items, "more": more}))
}

async fn ws_read(State(app): S, Query(qs): Q) -> Res {
    let ws = ws_of(&app, q(&qs, "ws"));
    let file = resolve(&ws, q(&qs, "path"));
    if !is_inside(&ws, &file) {
        return Err(ApiErr(StatusCode::FORBIDDEN, L!("Fora da pasta de trabalho", "Outside the workspace").into()));
    }
    let md = std::fs::metadata(&file).map_err(|e| bad(e.to_string()))?;
    if md.len() > 2 * 1024 * 1024 {
        return ok(json!({"path": file, "tooBig": true, "size": md.len()}));
    }
    let buf = std::fs::read(&file).map_err(|e| bad(e.to_string()))?;
    if looks_binary(&buf) {
        return ok(json!({"path": file, "binary": true, "size": md.len()}));
    }
    ok(json!({"path": file, "text": String::from_utf8_lossy(&buf), "size": md.len()}))
}

async fn ws_upload(State(app): S, Query(qs): Q, b: Bytes) -> Res {
    let name = file_name(Path::new(q(&qs, "name")));
    let name = if name.is_empty() { "arquivo".into() } else { name };
    let dir = ws_of(&app, q(&qs, "ws")).join("anexos");
    std::fs::create_dir_all(&dir).map_err(|e| bad(e.to_string()))?;
    let p = Path::new(&name);
    let (stem, ext) = (p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(), p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default());
    let mut target = dir.join(&name);
    let mut i = 2;
    while target.exists() {
        target = dir.join(format!("{stem} ({i}){ext}"));
        i += 1;
    }
    std::fs::write(&target, &b).map_err(|e| bad(e.to_string()))?;
    ok(json!({"path": target}))
}

/// Salva a conversa em Markdown na pasta "conversas" do espaço de trabalho.
async fn export_conv(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let mut name: String = st(&v, "name").chars().map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { '_' } else { c }).collect();
    name = name.trim().trim_end_matches('.').chars().take(80).collect();
    if name.is_empty() {
        name = "conversa".into();
    }
    let dir = ws_of(&app, st(&v, "ws")).join("conversas");
    std::fs::create_dir_all(&dir).map_err(|e| bad(e.to_string()))?;
    let mut target = dir.join(format!("{name}.md"));
    let mut i = 2;
    while target.exists() {
        target = dir.join(format!("{name} ({i}).md"));
        i += 1;
    }
    std::fs::write(&target, st(&v, "text")).map_err(|e| bad(e.to_string()))?;
    ok(json!({"path": target}))
}

async fn reveal(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let p = resolve(&ws_of(&app, st(&v, "ws")), st(&v, "path"));
    if !p.exists() {
        return Err(ApiErr(StatusCode::NOT_FOUND, LF!("Não encontrado: {}", "Not found: {}", p.display())));
    }
    app::reveal(&p, !p.is_dir());
    ok(json!({"ok": true}))
}

async fn browse(Query(qs): Q) -> Res {
    let p = q(&qs, "path");
    let files = q(&qs, "files") == "1";
    if p.is_empty() {
        let drives: Vec<Value> = if app::IS_WIN {
            (b'A'..=b'Z').map(|c| format!("{}:\\", c as char)).filter(|d| Path::new(d).exists()).map(|d| json!({"name": d, "path": d, "dir": true})).collect()
        } else {
            vec![json!({"name":"/","path":"/","dir":true})]
        };
        return ok(json!({"path":"","parent":null,"items":drives,"home":app::home_dir()}));
    }
    let dir = app::normalize(&PathBuf::from(p));
    let d2 = dir.clone();
    let items = tokio::task::spawn_blocking(move || list_dir(&d2, !files)).await.unwrap().map_err(|e| bad(e.to_string()))?;
    let items: Vec<Value> = items.into_iter().filter(|i| !i["name"].as_str().unwrap_or("").starts_with('$')).collect();
    let parent = dir.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    ok(json!({"path": dir, "parent": parent, "items": items, "home": app::home_dir()}))
}

async fn locate_h(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    if st(&v, "name").is_empty() {
        return Err(bad(L!("Falta o nome do arquivo.", "The file name is missing.")));
    }
    ok(locate::locate(&app, st(&v, "name"), v.get("size").and_then(Value::as_u64), v.get("lastModified").and_then(Value::as_f64), v.get("isDir").and_then(Value::as_bool).unwrap_or(false)).await)
}

async fn remember(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    if !st(&v, "path").is_empty() {
        locate::remember_dir(&app, Path::new(st(&v, "path")));
    }
    ok(json!({"ok": true}))
}

async fn stat(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let p = resolve(&ws_of(&app, st(&v, "ws")), st(&v, "path"));
    match std::fs::metadata(&p) {
        Ok(m) => ok(json!({"exists": true, "path": p, "dir": m.is_dir(), "size": m.len()})),
        Err(_) => ok(json!({"exists": false, "path": p})),
    }
}

// ---------------------------------------------------------------- habilidades

async fn skills_list(State(app): S) -> Res {
    ok(json!({"skills": skills::list(&app), "dir": app.skills_dir()}))
}

async fn skills_get(State(app): S, Query(qs): Q) -> Res {
    let s = skills::get(&app, q(&qs, "id")).ok_or_else(|| ApiErr(StatusCode::NOT_FOUND, L!("Skill não encontrada", "Skill not found").into()))?;
    let text = std::fs::read_to_string(s.dir.join("SKILL.md")).unwrap_or_default();
    let (meta, b) = skills::parse_frontmatter(&text);
    let mut v = serde_json::to_value(&s).unwrap();
    v["body"] = json!(b);
    v["meta"] = json!(meta);
    ok(v)
}

/// Medidor de limite da API (`id`); sem `id`, a primeira API do NIM (compatibilidade).
async fn nim_status_handler(State(app): S, Query(q): Query<HashMap<String, String>>) -> Res {
    let cfg = app.cfg();
    let p = match q.get("id") {
        Some(id) => cfg.api_providers.iter().find(|p| &p.id == id),
        None => cfg.api_providers.iter().find(|p| crate::remote::is_nim(p)),
    };
    ok(match p {
        Some(p) => app.limits.status(&app, p),
        None => json!({ "limited": false }),
    })
}

async fn skills_save(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    if st(&v, "name").trim().is_empty() {
        return Err(bad(L!("Dê um nome à habilidade.", "Give the skill a name.")));
    }
    let id = st(&v, "id");
    if !id.is_empty() && !skills::get(&app, id).is_some_and(|s| s.editable) {
        return Err(bad(L!("Essa habilidade fica fora da pasta do studio; importe-a para editar.", "That skill is outside the studio folder; import it to edit it.")));
    }
    let id = skills::write(&app, (!id.is_empty()).then_some(id), st(&v, "name").trim(), st(&v, "description").trim(), st(&v, "body")).map_err(bad)?;
    ok(json!({"id": id}))
}

async fn skills_delete(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let s = skills::get(&app, st(&v, "id")).ok_or_else(|| bad(L!("Habilidade não encontrada", "Skill not found")))?;
    if !s.editable {
        return Err(bad(L!("Essa habilidade fica numa pasta externa; remova a pasta nas configurações.", "That skill is in an external folder; remove the folder in Settings.")));
    }
    std::fs::remove_dir_all(&s.dir).map_err(|e| bad(e.to_string()))?;
    ok(json!({"ok": true}))
}

async fn skills_import_path(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let p = resolve(&app::home_dir(), st(&v, "path"));
    let app2 = app.clone();
    let r = tokio::task::spawn_blocking(move || skills::import_path(&app2, &p)).await.unwrap().map_err(bad)?;
    ok(json!({"imported": r}))
}

async fn skills_import_zip(State(app): S, Query(qs): Q, b: Bytes) -> Res {
    let name = q(&qs, "name").to_string();
    let app2 = app.clone();
    let r = tokio::task::spawn_blocking(move || {
        if name.to_lowercase().ends_with(".md") {
            skills::import_md(&app2, &String::from_utf8_lossy(&b), &name)
        } else {
            skills::import_zip(&app2, &b, &name)
        }
    })
    .await
    .unwrap()
    .map_err(bad)?;
    ok(json!({"imported": r}))
}

async fn skills_open(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let dir = match st(&v, "id") {
        "" => app.skills_dir(),
        id => skills::get(&app, id).map(|s| s.dir).unwrap_or_else(|| app.skills_dir()),
    };
    app::reveal(&dir, false);
    ok(json!({"ok": true}))
}

// ---------------------------------------------------------------- MCP

fn write_mcp(app: &App, cfg: &Value) -> Result<(), ApiErr> {
    std::fs::write(app.mcp_file(), serde_json::to_string_pretty(cfg).unwrap()).map_err(|e| bad(e.to_string()))
}

async fn mcp_list(State(app): S) -> Res {
    ok(json!({"servers": app.mcp.status_json_mem(), "file": app.mcp_file()}))
}

async fn mcp_config_get(State(app): S) -> Res {
    ok(json!({"text": std::fs::read_to_string(app.mcp_file()).unwrap_or_else(|_| "{\"mcpServers\":{}}".into())}))
}

async fn mcp_config_set(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let mut cfg: Value = serde_json::from_str(st(&v, "text")).map_err(|e| bad(LF!("JSON inválido: {e}", "Invalid JSON: {e}")))?;
    if cfg.get("mcpServers").is_none() {
        cfg = json!({"mcpServers": cfg});
    }
    write_mcp(&app, &cfg)?;
    app.mcp.sync(&app.http, &app.mcp_file()).await;
    ok(json!({"servers": app.mcp.status_json()}))
}

async fn mcp_upsert(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let name = st(&v, "name").trim().to_string();
    if name.is_empty() {
        return Err(bad(L!("Dê um nome ao servidor.", "Give the server a name.")));
    }
    let c = v.get("config").filter(|c| c.is_object()).cloned().ok_or_else(|| bad(L!("Configuração ausente.", "Missing configuration.")))?;
    let mut cfg = crate::mcp::Mcp::read_config(&app.mcp_file());
    let old = st(&v, "oldName");
    if !old.is_empty() && old != name {
        cfg["mcpServers"].as_object_mut().unwrap().remove(old);
    }
    cfg["mcpServers"][&name] = c;
    write_mcp(&app, &cfg)?;
    app.mcp.sync(&app.http, &app.mcp_file()).await;
    ok(json!({"servers": app.mcp.status_json()}))
}

async fn mcp_import(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let obj: Value = serde_json::from_str(st(&v, "text")).map_err(|e| bad(LF!("JSON inválido: {e}", "Invalid JSON: {e}")))?;
    let servers = obj.get("mcpServers").or_else(|| obj.get("servers")).unwrap_or(&obj).clone();
    let mut cfg = crate::mcp::Mcp::read_config(&app.mcp_file());
    let mut added = vec![];
    for (k, s) in servers.as_object().cloned().unwrap_or_default() {
        if s.get("command").is_some() || s.get("url").is_some() {
            cfg["mcpServers"][&k] = s;
            added.push(k);
        }
    }
    if added.is_empty() {
        return Err(bad(L!("Nenhum servidor encontrado no JSON (espera \"command\" ou \"url\").", "No server found in the JSON (expects \"command\" or \"url\").")));
    }
    write_mcp(&app, &cfg)?;
    app.mcp.sync(&app.http, &app.mcp_file()).await;
    ok(json!({"added": added, "servers": app.mcp.status_json()}))
}

async fn mcp_delete(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let mut cfg = crate::mcp::Mcp::read_config(&app.mcp_file());
    cfg["mcpServers"].as_object_mut().unwrap().remove(st(&v, "name"));
    write_mcp(&app, &cfg)?;
    app.mcp.sync(&app.http, &app.mcp_file()).await;
    ok(json!({"servers": app.mcp.status_json()}))
}

async fn mcp_toggle(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let mut cfg = crate::mcp::Mcp::read_config(&app.mcp_file());
    let s = cfg["mcpServers"].get_mut(st(&v, "name")).filter(|s| s.is_object()).ok_or_else(|| bad(L!("Servidor não encontrado", "Server not found")))?;
    if v.get("disabled").and_then(Value::as_bool).unwrap_or(false) {
        s["disabled"] = json!(true);
    } else {
        s.as_object_mut().unwrap().remove("disabled");
    }
    write_mcp(&app, &cfg)?;
    app.mcp.sync(&app.http, &app.mcp_file()).await;
    ok(json!({"servers": app.mcp.status_json()}))
}

/// Esconde ferramentas de um conector do modelo (sem reconectar).
async fn mcp_hide(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let mut cfg = crate::mcp::Mcp::read_config(&app.mcp_file());
    let s = cfg["mcpServers"].get_mut(st(&v, "name")).filter(|s| s.is_object()).ok_or_else(|| bad(L!("Servidor não encontrado", "Server not found")))?;
    let mut names = strs(&v, "hidden");
    names.sort();
    names.dedup();
    if names.is_empty() {
        s.as_object_mut().unwrap().remove("disabledTools");
    } else {
        s["disabledTools"] = json!(names);
    }
    write_mcp(&app, &cfg)?;
    app.mcp.sync(&app.http, &app.mcp_file()).await;
    ok(json!({"servers": app.mcp.status_json()}))
}

async fn mcp_reconnect(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let only = v.get("name").and_then(Value::as_str);
    app.mcp.reconnect(&app.http, &app.mcp_file(), only).await;
    ok(json!({"servers": app.mcp.status_json()}))
}

// ---------------------------------------------------------------- ferramentas e contexto

fn groups_of(v: &Value) -> Vec<String> {
    match v.get("groups") {
        Some(_) => strs(v, "groups"),
        // compatibilidade: "builtin" = arquivos
        None if v.get("builtin").and_then(Value::as_bool).unwrap_or(true) => vec!["read".into(), "write".into(), "edit".into()],
        None => vec![],
    }
}

async fn tools_list(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let only = v.get("only").map(|_| strs(&v, "only"));
    let lazy = v.get("lazy").and_then(Value::as_bool).unwrap_or(false);
    
    // Pega as ferramentas normais geradas pelo sistema
    let mut built = tools::build_tools(&app, &groups_of(&v), &strs(&v, "mcp"), !strs(&v, "skills").is_empty(), &strs(&v, "extra"), only.as_deref(), lazy, &strs(&v, "eager"), &strs(&v, "full"));
    
    // APIs remotas como ferramentas: só no pedido principal da conversa e com a opção ligada ("apis": true).
    // Exploradores, auditor e listas restritas não recebem (gastaria contexto em todo pedido).
    if !v.get("apis").and_then(Value::as_bool).unwrap_or(false) || only.is_some() {
        return ok(built);
    }
    if let Some(tools_arr) = built.get_mut("tools").and_then(Value::as_array_mut) {
        for p in app.cfg().api_providers.iter().filter(|p| crate::remote::ready(p)) {
            tools_arr.push(json!({
                "type": "function",
                "function": {
                    "name": format!("remote_api_{}", p.id),
                    "description": format!("Envia um prompt para o modelo/API remoto: {} ({})", p.name, p.model),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "prompt": { "type": "string", "description": "A instrução a ser enviada para a API" }
                        },
                        "required": ["prompt"]
                    }
                }
            }));
        }
    }
    
    ok(built)
}

async fn tools_search(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    ok(tools::search_tools(&app, st(&v, "query"), &strs(&v, "names")))
}

async fn context(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    if v.get("skillsOnly").and_then(Value::as_bool).unwrap_or(false) {
        return ok(json!({ "text": tools::skill_blocks(&app, &strs(&v, "skills"), v.get("lazy").and_then(Value::as_bool).unwrap_or(false)) }));
    }
    let mut text = tools::build_context(&app, &ws_of(&app, st(&v, "ws")), &strs(&v, "skills"), &groups_of(&v), &strs(&v, "refs"), st(&v, "now"), v.get("lazy").and_then(Value::as_bool).unwrap_or(false), v.get("map").and_then(Value::as_bool).unwrap_or(false));
    // pacotes de instruções: {"packs": {"ponytail": "full", "caveman": "on"}} (ou o antigo "ponytail": "full")
    let mut levels = v.get("packs").cloned().unwrap_or_else(|| json!({}));
    if levels.get("ponytail").is_none() && !st(&v, "ponytail").is_empty() {
        levels["ponytail"] = json!(st(&v, "ponytail"));
    }
    let pt = crate::packs::sections(&app, &levels);
    if !pt.is_empty() {
        text = format!("{text}\n\n{pt}");
    }
    ok(json!({ "text": text }))
}

async fn tools_call(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let args = match v.get("arguments") {
        Some(Value::String(s)) if s.trim().is_empty() => json!({}),
        Some(Value::String(s)) => match serde_json::from_str::<Value>(s) {
            Ok(a) => a,
            Err(_) => return ok(json!({"content": LF!("Erro: os argumentos não são um JSON válido: {}", "Error: the arguments are not valid JSON: {}", s.chars().take(300).collect::<String>()), "isError": true})),
        },
        Some(a) => a.clone(),
        None => json!({}),
    };
    let ws = ws_of(&app, st(&v, "ws"));
    let name = st(&v, "name");
    if name.starts_with("remote_api_") {
        let provider_id = name.trim_start_matches("remote_api_");
        let prompt = args.get("prompt").and_then(Value::as_str).unwrap_or("");
        
        return match crate::remote::call_provider_direct(&app, provider_id, prompt).await {
            Ok(text) => ok(json!({"content": text, "isError": false})),
            Err(e) => ok(json!({"content": format!("Erro na API remota: {e}"), "isError": true})),
        };
    }
    // ponto de restauração antes de mexer em arquivo
    if matches!(name, "write_file" | "edit_file" | "create_directory") && !st(&v, "cp").is_empty() {
        if let Ok(file) = tools::resolve_write(&ws, args.get("path").and_then(Value::as_str).unwrap_or("")) {
            if let Err(e) = crate::checkpoint::snapshot(&app, st(&v, "conv"), st(&v, "cp"), &file) {
                eprintln!("ponto de restauração: {e}");
            }
        }
    }
    let r = tools::call(&app, ws, name, args, &strs(&v, "allow")).await;
    ok(json!({"content": r.content, "isError": r.is_error, "images": r.images}))
}

// ---------------------------------------------------------------- llama-server

async fn llama_get(State(app): S) -> Res {
    ok(app.llama.to_json())
}

async fn llama_config(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let cur = serde_json::to_value(app.llama.cfg()).unwrap();
    let mut merged = cur.clone();
    if let (Some(m), Some(o)) = (merged.as_object_mut(), v.get("config").and_then(Value::as_object)) {
        for (k, val) in o {
            if m.contains_key(k) {
                m.insert(k.clone(), val.clone());
            }
        }
    }
    let c: crate::llama::LlamaCfg = serde_json::from_value(merged).map_err(|e| bad(LF!("Configuração inválida: {e}", "Invalid configuration: {e}")))?;
    let url = c.base_url();
    let old_model = app.llama.cfg().model;
    app.llama.save(c);
    crate::models::sync_from_cfg(&app, &old_model);
    {
        app.config.write().unwrap().llama_url = url;
    }
    app.save_config();
    ok(app.llama.to_json())
}

async fn llama_start(State(app): S) -> Res {
    app.llama.start(&app).map_err(bad)?;
    ok(app.llama.to_json())
}

async fn llama_stop(State(app): S) -> Res {
    app.llama.stop();
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    ok(app.llama.to_json())
}

async fn llama_restart(State(app): S) -> Res {
    app.llama.stop();
    for _ in 0..50 {
        if !app.llama.is_running() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    app.llama.start(&app).map_err(bad)?;
    ok(app.llama.to_json())
}

async fn llama_log(State(app): S, Query(qs): Q) -> Res {
    ok(app.llama.log_since(q(&qs, "since").parse().unwrap_or(0)))
}

#[allow(dead_code)]
fn _unused(_: HeaderMap) {}

// ---------------------------------------------------------------- ferramentas do sistema (uv, rg, fd, rtk...)

async fn bins_list(State(app): S, Query(qs): Q) -> Res {
    ok(crate::bins::list(&app, q(&qs, "latest") == "1").await)
}

async fn bins_install(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    match crate::bins::install(&app, v["id"].as_str().unwrap_or("")).await {
        Ok(ver) => ok(json!({"ok": true, "version": ver})),
        Err(e) => Err(bad(e)),
    }
}

async fn bins_remove(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    match crate::bins::remove(&app, v["id"].as_str().unwrap_or("")) {
        Ok(()) => ok(json!({"ok": true})),
        Err(e) => Err(bad(e)),
    }
}

// ---------------------------------------------------------------- vários modelos (um carregado por vez)

async fn models_list(State(app): S) -> Res {
    let a = app.clone();
    ok(tokio::task::spawn_blocking(move || crate::models::list_json(&a)).await.map_err(|e| bad(e.to_string()))?)
}

async fn models_save(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let list: Vec<crate::models::Profile> = serde_json::from_value(v.get("models").cloned().unwrap_or(json!([]))).map_err(|e| bad(LF!("Lista inválida: {e}", "Invalid list: {e}")))?;
    crate::models::save(&app, &list);
    let a = app.clone();
    ok(tokio::task::spawn_blocking(move || crate::models::list_json(&a)).await.map_err(|e| bad(e.to_string()))?)
}

async fn models_activate(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    crate::models::activate(&app, st(&v, "id")).await.map(ok).map_err(bad)?
}

// ---------------------------------------------------------------- Hugging Face

async fn hf_info(State(app): S) -> Res {
    ok(crate::hf::info(&app))
}

async fn hf_token(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    app.config.write().unwrap().hf_token = st(&v, "token").trim().to_string();
    app.save_config();
    ok(crate::hf::info(&app))
}

async fn hf_search(State(app): S, Query(qs): Q) -> Res {
    crate::hf::search(&app, q(&qs, "q")).await.map(ok).map_err(bad)?
}

async fn hf_files(State(app): S, Query(qs): Q) -> Res {
    crate::hf::files(&app, q(&qs, "repo")).await.map(ok).map_err(bad)?
}

async fn hf_download(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let mm = v.get("mmproj").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
    crate::hf::start(&app, st(&v, "repo"), st(&v, "name"), strs(&v, "parts"), mm, v["size"].as_u64().unwrap_or(0)).map(ok).map_err(bad)?
}

async fn hf_downloads() -> Res {
    ok(crate::hf::list())
}

async fn hf_cancel(b: Bytes) -> Res {
    let v = body(&b);
    crate::hf::cancel(st(&v, "id"));
    ok(crate::hf::list())
}

// ---------------------------------------------------------------- motores do llama.cpp

async fn engines_list(State(app): S, Query(qs): Q) -> Res {
    ok(crate::engines::list(&app, q(&qs, "check") == "1").await)
}

async fn engines_install(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    crate::engines::install(&app, st(&v, "variant"), v["activate"].as_bool().unwrap_or(true)).await.map(ok).map_err(bad)?
}

async fn engines_use(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    crate::engines::use_engine(&app, std::path::Path::new(st(&v, "path"))).await.map(ok).map_err(bad)?
}

async fn engines_remove(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    crate::engines::remove(&app, st(&v, "id")).map_err(bad)?;
    ok(crate::engines::list(&app, false).await)
}

async fn engines_cancel(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    crate::engines::cancel(st(&v, "id"));
    ok(crate::engines::list(&app, false).await)
}

// ---------------------------------------------------------------- cache das conversas em disco

/// Apaga os caches de conversa mais antigos (mantém `keep`) e os de `drop` (conversas apagadas).
async fn projmap_get(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let ws = ws_of(&app, st(&v, "ws"));
    let refresh = v["refresh"] == true;
    let r = tokio::task::spawn_blocking({ let app = app.clone(); move || crate::projmap::get(&app, &ws, refresh) }).await.map_err(|e| bad(e.to_string()))?;
    ok(r)
}

async fn projmap_summary(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    ok(crate::projmap::set_summary(&app, &ws_of(&app, st(&v, "ws")), st(&v, "summary")))
}

async fn arr_get(State(app): S) -> Res {
    ok(crate::arrumar::load(&app))
}

async fn arr_rules(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    crate::arrumar::save_rules(&app, &v["rules"]).map_err(bad)?;
    ok(json!({"ok": true}))
}

async fn arr_plan(b: Bytes) -> Res {
    let v = body(&b);
    let rule = v["rule"].clone();
    let moves = tokio::task::spawn_blocking(move || crate::arrumar::plan(&rule)).await.map_err(|e| bad(e.to_string()))?.map_err(bad)?;
    ok(json!({"count": moves.len(), "moves": moves.iter().take(300).map(|(a, b)| json!([a, b])).collect::<Vec<_>>()}))
}

async fn arr_apply(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let rule = v["rule"].clone();
    let r = tokio::task::spawn_blocking(move || crate::arrumar::apply(&app, &rule, false)).await.map_err(|e| bad(e.to_string()))?;
    ok(r.map_err(bad)?)
}

async fn arr_undo(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    ok(crate::arrumar::undo(&app, st(&v, "run")).map_err(bad)?)
}

async fn share_collect(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    ok(crate::share::collect(&app, &strs(&v, "parts"), &strs(&v, "skills")))
}

/// Grava o pacote em Downloads (ou na pasta pedida) e devolve o caminho.
async fn share_save(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let dir = if st(&v, "dir").is_empty() {
        dirs_home().map(|h| h.join("Downloads")).filter(|d| d.is_dir()).unwrap_or_else(|| app.root.clone())
    } else {
        std::path::PathBuf::from(st(&v, "dir"))
    };
    let name: String = st(&v, "name").chars().filter(|c| c.is_alphanumeric() || " -_.".contains(*c)).collect();
    let name = if name.trim().is_empty() { "llama-studio".to_string() } else { name.trim().to_string() };
    let mut path = dir.join(format!("{name}.studio.json"));
    let mut i = 2;
    while path.exists() {
        path = dir.join(format!("{name} ({i}).studio.json"));
        i += 1;
    }
    std::fs::write(&path, serde_json::to_vec_pretty(&v["data"]).unwrap_or_default()).map_err(|e| bad(e.to_string()))?;
    ok(json!({"path": path}))
}

fn dirs_home() -> Option<std::path::PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(std::path::PathBuf::from)
}

async fn share_read(b: Bytes) -> Res {
    let v = body(&b);
    let p = std::path::PathBuf::from(st(&v, "path"));
    let md = std::fs::metadata(&p).map_err(|e| bad(format!("{}: {e}", p.display())))?;
    if md.len() > 64 * 1024 * 1024 {
        return Err(bad(L!("Arquivo grande demais.", "File too large.").to_string()));
    }
    let data: Value = serde_json::from_slice(&std::fs::read(&p).map_err(|e| bad(e.to_string()))?).map_err(|e| bad(LF!("Não é um pacote do Llama Studio: {e}", "Not a Llama Studio package: {e}")))?;
    if data["format"] != crate::share::FORMAT {
        return Err(bad(L!("Não é um pacote do Llama Studio (.studio.json).", "Not a Llama Studio package (.studio.json).").to_string()));
    }
    ok(data)
}

async fn share_apply(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let secrets = v["secrets"].as_object().cloned().unwrap_or_default();
    let r = crate::share::apply(&app, &v["data"], &strs(&v, "parts"), v["overwrite"] == true, &secrets);
    if strs(&v, "parts").iter().any(|p| p == "mcp") {
        app.mcp.sync(&app.http, &app.mcp_file()).await;
    }
    ok(r)
}

async fn sig_list(State(app): S) -> Res {
    ok(crate::pe::load(&app))
}

async fn sig_save(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    crate::pe::save(&app, &json!({"sigs": v["sigs"]})).map_err(bad)?;
    ok(json!({"ok": true}))
}

async fn sig_make(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let path = resolve(&ws_of(&app, st(&v, "ws")), st(&v, "file"));
    let (addr, base, len) = (st(&v, "addr").to_string(), st(&v, "base").to_string(), v["len"].as_u64().unwrap_or(48) as usize);
    let r = tokio::task::spawn_blocking(move || crate::pe::make(&path, &addr, &base, len)).await.map_err(|e| bad(e.to_string()))?;
    ok(r.map_err(bad)?)
}

async fn sig_scan(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let path = resolve(&ws_of(&app, st(&v, "ws")), st(&v, "file"));
    let app2 = app.clone();
    let r = tokio::task::spawn_blocking(move || crate::pe::scan(&app2, &path)).await.map_err(|e| bad(e.to_string()))?;
    ok(r.map_err(bad)?)
}

async fn nb_get(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    ok(crate::projmap::nb_load(&app, st(&v, "key")))
}

async fn nb_put(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    crate::projmap::nb_save(&app, st(&v, "key"), &json!({"cards": v["cards"], "next": v["next"]})).map_err(bad)?;
    ok(json!({"ok": true}))
}

async fn cp_list(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    ok(crate::checkpoint::list(&app, st(&v, "conv")))
}

async fn cp_diff(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    ok(crate::checkpoint::diff(&app, st(&v, "conv"), st(&v, "id")))
}

/// Imagem referenciada na mensagem, como data URL (para modelos com visão e miniaturas).
async fn img_data(State(app): S, b: Bytes) -> Res {
    use base64::Engine;
    let v = body(&b);
    let ws = ws_of(&app, st(&v, "ws"));
    let file = resolve(&ws, st(&v, "path"));
    let ext = file.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        _ => return Err(bad(L!("Não é uma imagem.", "Not an image.").to_string())),
    };
    let md = std::fs::metadata(&file).map_err(|e| bad(e.to_string()))?;
    if md.len() > 15 * 1024 * 1024 {
        return Err(bad(L!("Imagem grande demais (mais de 15 MB).", "Image too large (over 15 MB).").to_string()));
    }
    let buf = std::fs::read(&file).map_err(|e| bad(e.to_string()))?;
    ok(json!({"data": format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(buf))}))
}

async fn cp_undo(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    ok(crate::checkpoint::undo(&app, st(&v, "conv"), &strs(&v, "ids")))
}

/// {forget: [conversas]} apaga os pontos delas; {keep: [conversas]} apaga os das outras.
async fn cp_prune(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    for c in strs(&v, "forget") {
        crate::checkpoint::forget(&app, &c);
    }
    if v.get("keep").is_some() {
        crate::checkpoint::prune(&app, &strs(&v, "keep"));
    }
    ok(json!({"ok": true}))
}

async fn kv_prune(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let keep = v["keep"].as_u64().unwrap_or(6) as usize;
    let drop_ids = strs(&v, "drop");
    let dir = app.llama.kv_dir.clone();
    let mut files: Vec<(std::time::SystemTime, std::path::PathBuf, u64)> = std::fs::read_dir(&dir)
        .map(|rd| rd.flatten().filter_map(|e| { let m = e.metadata().ok()?; Some((m.modified().ok()?, e.path(), m.len())) }).collect())
        .unwrap_or_default();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    let mut removed = 0;
    for (i, (_, p, _)) in files.iter().enumerate() {
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if i >= keep || drop_ids.iter().any(|d| !d.is_empty() && name.starts_with(d.as_str())) {
            if std::fs::remove_file(p).is_ok() {
                removed += 1;
            }
        }
    }
    let total: u64 = files.iter().map(|f| f.2).sum();
    ok(json!({"removed": removed, "files": files.len(), "bytes": total}))
}

// ---------------------------------------------------------------- otimizar para o PC

async fn bench_status() -> Res {
    ok(crate::bench::status())
}

async fn bench_start(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    crate::bench::start(&app, st(&v, "id")).map(ok).map_err(bad)?
}

async fn bench_cancel() -> Res {
    crate::bench::cancel();
    ok(crate::bench::status())
}
