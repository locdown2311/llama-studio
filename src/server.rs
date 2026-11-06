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
        return (StatusCode::FORBIDDEN, "Host não permitido").into_response();
    }
    let path = req.uri().path();
    let is_api = path.starts_with("/api/");
    let is_proxy_write = req.method() != Method::GET && !is_api && path != "/" && !path.contains('.');
    if (is_api || is_proxy_write) && req.headers().get("x-studio").map(|v| v.as_bytes()) != Some(b"1") {
        return (StatusCode::FORBIDDEN, Json(json!({"error":"Cabeçalho ausente"}))).into_response();
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
        None => (StatusCode::NOT_FOUND, "Não encontrado").into_response(),
    }
}

// ---------------------------------------------------------------- proxy

async fn proxy(State(app): S, req: Request) -> Response {
    let (parts, b) = req.into_parts();
    let base = app.cfg().llama_url;
    let url = format!("{}{}", base.trim_end_matches('/'), parts.uri.path_and_query().map(|p| p.as_str()).unwrap_or("/"));
    let bytes = match axum::body::to_bytes(b, 64 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => return (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    };
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
            out.body(Body::from_stream(resp.bytes_stream())).unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error":{"message": format!("llama-server indisponível em {base} ({}). Ele está rodando?", e.without_url())}})),
        )
            .into_response(),
    }
}

// ---------------------------------------------------------------- estado e config

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
        return Err(bad(format!("Pasta não encontrada: {}", p.display())));
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
        return Err(ApiErr(StatusCode::FORBIDDEN, "Fora da pasta de trabalho".into()));
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
        return Err(ApiErr(StatusCode::FORBIDDEN, "Fora da pasta de trabalho".into()));
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
        return Err(ApiErr(StatusCode::NOT_FOUND, format!("Não encontrado: {}", p.display())));
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
        return Err(bad("Falta o nome do arquivo."));
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
    let s = skills::get(&app, q(&qs, "id")).ok_or_else(|| ApiErr(StatusCode::NOT_FOUND, "Skill não encontrada".into()))?;
    let text = std::fs::read_to_string(s.dir.join("SKILL.md")).unwrap_or_default();
    let (meta, b) = skills::parse_frontmatter(&text);
    let mut v = serde_json::to_value(&s).unwrap();
    v["body"] = json!(b);
    v["meta"] = json!(meta);
    ok(v)
}

async fn skills_save(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    if st(&v, "name").trim().is_empty() {
        return Err(bad("Dê um nome à habilidade."));
    }
    let id = st(&v, "id");
    if !id.is_empty() && !skills::get(&app, id).is_some_and(|s| s.editable) {
        return Err(bad("Essa habilidade fica fora da pasta do studio; importe-a para editar."));
    }
    let id = skills::write(&app, (!id.is_empty()).then_some(id), st(&v, "name").trim(), st(&v, "description").trim(), st(&v, "body")).map_err(bad)?;
    ok(json!({"id": id}))
}

async fn skills_delete(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let s = skills::get(&app, st(&v, "id")).ok_or_else(|| bad("Habilidade não encontrada"))?;
    if !s.editable {
        return Err(bad("Essa habilidade fica numa pasta externa; remova a pasta nas configurações."));
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
    ok(json!({"servers": app.mcp.status_json(), "file": app.mcp_file()}))
}

async fn mcp_config_get(State(app): S) -> Res {
    ok(json!({"text": std::fs::read_to_string(app.mcp_file()).unwrap_or_else(|_| "{\"mcpServers\":{}}".into())}))
}

async fn mcp_config_set(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let mut cfg: Value = serde_json::from_str(st(&v, "text")).map_err(|e| bad(format!("JSON inválido: {e}")))?;
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
        return Err(bad("Dê um nome ao servidor."));
    }
    let c = v.get("config").filter(|c| c.is_object()).cloned().ok_or_else(|| bad("Configuração ausente."))?;
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
    let obj: Value = serde_json::from_str(st(&v, "text")).map_err(|e| bad(format!("JSON inválido: {e}")))?;
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
        return Err(bad("Nenhum servidor encontrado no JSON (espera \"command\" ou \"url\")."));
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
    let s = cfg["mcpServers"].get_mut(st(&v, "name")).filter(|s| s.is_object()).ok_or_else(|| bad("Servidor não encontrado"))?;
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
    let s = cfg["mcpServers"].get_mut(st(&v, "name")).filter(|s| s.is_object()).ok_or_else(|| bad("Servidor não encontrado"))?;
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
    ok(tools::build_tools(&app, &groups_of(&v), &strs(&v, "mcp"), !strs(&v, "skills").is_empty(), &strs(&v, "extra"), only.as_deref(), lazy))
}

async fn tools_search(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    ok(tools::search_tools(&app, st(&v, "query"), &strs(&v, "names")))
}

async fn context(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    ok(json!({"text": tools::build_context(&app, &ws_of(&app, st(&v, "ws")), &strs(&v, "skills"), &groups_of(&v), &strs(&v, "refs"), st(&v, "now"), v.get("lazy").and_then(Value::as_bool).unwrap_or(false), v.get("map").and_then(Value::as_bool).unwrap_or(false))}))
}

async fn tools_call(State(app): S, b: Bytes) -> Res {
    let v = body(&b);
    let args = match v.get("arguments") {
        Some(Value::String(s)) if s.trim().is_empty() => json!({}),
        Some(Value::String(s)) => match serde_json::from_str::<Value>(s) {
            Ok(a) => a,
            Err(_) => return ok(json!({"content": format!("Erro: os argumentos não são um JSON válido: {}", s.chars().take(300).collect::<String>()), "isError": true})),
        },
        Some(a) => a.clone(),
        None => json!({}),
    };
    let ws = ws_of(&app, st(&v, "ws"));
    let name = st(&v, "name");
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
    let c: crate::llama::LlamaCfg = serde_json::from_value(merged).map_err(|e| bad(format!("Configuração inválida: {e}")))?;
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
    let list: Vec<crate::models::Profile> = serde_json::from_value(v.get("models").cloned().unwrap_or(json!([]))).map_err(|e| bad(format!("Lista inválida: {e}")))?;
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
        _ => return Err(bad("Não é uma imagem.".to_string())),
    };
    let md = std::fs::metadata(&file).map_err(|e| bad(e.to_string()))?;
    if md.len() > 15 * 1024 * 1024 {
        return Err(bad("Imagem grande demais (mais de 15 MB).".to_string()));
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
