//! Sincronização da conta com o PC: o que a interface guarda (conversas, projetos, personalidades...) fica em
//! `users/<id>/ui/<chave>.json` ({"t": ms, "v": ...}), o mesmo formato do studio. A cópia mais nova vence; o
//! que foi apagado vira uma lápide em `ui/.tombs.json` para não voltar do outro lado.

use crate::{err, H};
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

fn device_user(h: &crate::Hub, headers: &HeaderMap) -> Option<i64> {
    let tok = headers.get("authorization")?.to_str().ok()?.strip_prefix("Bearer ")?.trim().to_string();
    crate::db::user_by_device(&h.db.lock().unwrap(), &tok).map(|(u, _, _)| u.id)
}

fn ui_dir(h: &crate::Hub, uid: i64) -> PathBuf {
    crate::boxes::dir(h, uid).join("ui")
}

pub fn valid_key(k: &str) -> bool {
    !k.is_empty() && k.len() <= 64 && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn read(p: &Path) -> Option<Value> {
    std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str(&t).ok())
}

fn write_owned(p: &Path, s: &str) -> bool {
    let tmp = p.with_extension("json.tmp");
    let ok = std::fs::write(&tmp, s).is_ok() && std::fs::rename(&tmp, p).is_ok();
    #[cfg(unix)]
    {
        let _ = std::os::unix::fs::chown(p, Some(crate::boxes::UID), Some(crate::boxes::UID));
    }
    ok
}

fn tombs(d: &Path) -> Map<String, Value> {
    read(&d.join(".tombs.json")).and_then(|v| v.as_object().cloned()).unwrap_or_default()
}

pub async fn index(State(h): State<H>, headers: HeaderMap) -> Response {
    let Some(uid) = device_user(&h, &headers) else { return err(StatusCode::UNAUTHORIZED, "token") };
    let d = ui_dir(&h, uid);
    let mut items = Map::new();
    if let Ok(rd) = std::fs::read_dir(&d) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            let Some(k) = n.strip_suffix(".json") else { continue };
            if !valid_key(k) {
                continue;
            }
            if let Some(t) = read(&e.path()).and_then(|v| v["t"].as_u64()) {
                items.insert(k.to_string(), json!(t));
            }
        }
    }
    Json(json!({ "items": items, "tombs": tombs(&d) })).into_response()
}

pub async fn get_item(State(h): State<H>, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    let Some(uid) = device_user(&h, &headers) else { return err(StatusCode::UNAUTHORIZED, "token") };
    let k = q.get("k").cloned().unwrap_or_default();
    if !valid_key(&k) {
        return err(StatusCode::BAD_REQUEST, "chave");
    }
    match read(&ui_dir(&h, uid).join(format!("{k}.json"))) {
        Some(v) => Json(v).into_response(),
        None => err(StatusCode::NOT_FOUND, "sem"),
    }
}

pub async fn put_item(State(h): State<H>, headers: HeaderMap, Json(v): Json<Value>) -> Response {
    let Some(uid) = device_user(&h, &headers) else { return err(StatusCode::UNAUTHORIZED, "token") };
    let k = v["k"].as_str().unwrap_or("").to_string();
    let t = v["t"].as_u64().unwrap_or(0);
    if !valid_key(&k) || t == 0 {
        return err(StatusCode::BAD_REQUEST, "chave");
    }
    let d = ui_dir(&h, uid);
    crate::boxes::mkdir_owned(&crate::boxes::dir(&h, uid));
    crate::boxes::mkdir_owned(&d);
    let path = d.join(format!("{k}.json"));
    let cur = read(&path).and_then(|o| o["t"].as_u64()).unwrap_or(0);
    let mut tb = tombs(&d);
    let tomb = tb.get(&k).and_then(Value::as_u64).unwrap_or(0);
    let applied = if v["del"].as_bool() == Some(true) {
        if t >= cur && t > tomb {
            let _ = std::fs::remove_file(&path);
            tb.insert(k, json!(t));
            write_owned(&d.join(".tombs.json"), &Value::Object(tb).to_string())
        } else {
            false
        }
    } else if t > cur && t > tomb {
        let ok = write_owned(&path, &json!({ "t": t, "v": v["v"] }).to_string());
        if tomb > 0 {
            tb.remove(&k);
            write_owned(&d.join(".tombs.json"), &Value::Object(tb).to_string());
        }
        ok
    } else {
        false
    };
    Json(json!({ "ok": applied })).into_response()
}

/// O PC manda as APIs dele (com as chaves) para o studio da nuvem desta conta. As de mesmo id são trocadas,
/// as outras da nuvem ficam. O studio da nuvem guarda a configuração na memória: se estiver ligado, desliga
/// (volta no próximo acesso já com elas).
pub async fn push_apis(State(h): State<H>, headers: HeaderMap, Json(v): Json<Value>) -> Response {
    let Some(uid) = device_user(&h, &headers) else { return err(StatusCode::UNAUTHORIZED, "token") };
    let Some(list) = v["apiProviders"].as_array().cloned() else { return err(StatusCode::BAD_REQUEST, "apiProviders") };
    if list.len() > 100 {
        return err(StatusCode::BAD_REQUEST, "muitas");
    }
    let restarted = h.boxes.running(uid);
    if restarted {
        h.boxes.stop(&h, uid).await;
    }
    let d = crate::boxes::dir(&h, uid);
    crate::boxes::mkdir_owned(&d);
    let path = d.join("config.json");
    let mut cfg = read(&path).filter(Value::is_object).unwrap_or_else(|| json!({}));
    let mut cur: Vec<Value> = cfg["apiProviders"].as_array().cloned().unwrap_or_default();
    let mut n = 0;
    for p in list {
        let Some(id) = p["id"].as_str().map(str::to_string) else { continue };
        if !p.is_object() || id.is_empty() || id.len() > 64 {
            continue;
        }
        match cur.iter_mut().find(|x| x["id"].as_str() == Some(id.as_str())) {
            Some(x) => *x = p,
            None => cur.push(p),
        }
        n += 1;
    }
    cfg["apiProviders"] = Value::Array(cur);
    if !write_owned(&path, &serde_json::to_string_pretty(&cfg).unwrap_or_default()) {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "gravar");
    }
    Json(json!({ "count": n, "restarted": restarted })).into_response()
}
