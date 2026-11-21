//! Painel de administração (/hub/admin): contas, disco, studios ligados e as ações sobre cada conta.
//! Quem é administrador: a primeira conta criada, as marcadas como admin e os e-mails em HUB_ADMINS.

use crate::{err, now, H};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

pub fn is_admin(c: &Connection, uid: i64) -> bool {
    let row: Option<(String, i64)> = c.query_row("SELECT email, is_admin FROM users WHERE id = ?1", params![uid], |r| Ok((r.get(0)?, r.get(1)?))).optional().ok().flatten();
    let Some((email, flag)) = row else { return false };
    let first: i64 = c.query_row("SELECT MIN(id) FROM users", [], |r| r.get(0)).unwrap_or(0);
    let env = std::env::var("HUB_ADMINS").unwrap_or_default();
    flag != 0 || uid == first || env.split(',').any(|e| e.trim().eq_ignore_ascii_case(&email))
}

/// Cota de disco da conta (0 = a padrão do servidor).
pub fn quota_mb(h: &crate::Hub, uid: i64) -> u64 {
    let q: i64 = h.db.lock().unwrap().query_row("SELECT quota_mb FROM users WHERE id = ?1", params![uid], |r| r.get(0)).unwrap_or(0);
    if q > 0 { q as u64 } else { h.cfg.disk_mb }
}

fn admin(h: &crate::Hub, headers: &HeaderMap) -> Result<crate::db::User, Response> {
    let Some(u) = crate::auth::user(h, headers) else { return Err(err(StatusCode::UNAUTHORIZED, "login")) };
    if !is_admin(&h.db.lock().unwrap(), u.id) {
        return Err(err(StatusCode::FORBIDDEN, "Só para administradores."));
    }
    Ok(u)
}

pub async fn page(State(h): State<H>, headers: HeaderMap) -> Response {
    if let Err(r) = admin(&h, &headers) {
        return if r.status() == StatusCode::UNAUTHORIZED { axum::response::Redirect::to("/hub/login").into_response() } else { r };
    }
    crate::pages::admin_html()
}

pub async fn users(State(h): State<H>, headers: HeaderMap) -> Response {
    let me = match admin(&h, &headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let rows: Vec<(i64, String, i64, i64, i64, i64, i64, i64)> = {
        let db = h.db.lock().unwrap();
        let mut st = db.prepare("SELECT id, email, created, last_login, disabled, totp_on, is_admin, quota_mb FROM users ORDER BY id").unwrap();
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?))).unwrap().flatten().collect()
    };
    let online: std::collections::HashMap<i64, String> = h.links.lock().unwrap().iter().map(|(k, l)| (*k, l.name.clone())).collect();
    let mut out = vec![];
    let mut total = 0u64;
    for (id, email, created, last, disabled, twofa, _flag, quota) in rows {
        let disk = h.boxes.disk_now(&h, id).await;
        total += disk;
        let (devices, admin_flag) = {
            let db = h.db.lock().unwrap();
            (db.query_row("SELECT COUNT(*) FROM devices WHERE uid = ?1", params![id], |r| r.get::<_, i64>(0)).unwrap_or(0), is_admin(&db, id))
        };
        out.push(json!({
            "id": id, "email": email, "created": created, "lastLogin": last, "disabled": disabled != 0, "twofa": twofa != 0,
            "admin": admin_flag, "quotaMb": if quota > 0 { quota as u64 } else { h.cfg.disk_mb }, "customQuota": quota > 0,
            "diskMb": disk, "running": h.boxes.running(id), "pc": online.get(&id), "devices": devices,
            "api": std::fs::read(crate::boxes::dir(&h, id).join("admin-api-info.json")).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()),
        }));
    }
    let running = out.iter().filter(|u| u["running"] == json!(true)).count();
    Json(json!({
        "me": me.id,
        "users": out,
        "stats": { "users": out.len(), "running": running, "maxRunning": h.cfg.max_running, "diskMb": total, "pcs": online.len(),
                   "signupOpen": h.cfg.signup_open, "image": h.cfg.image, "mem": h.cfg.mem, "cpus": h.cfg.cpus, "idleMin": h.cfg.idle_min, "defaultQuotaMb": h.cfg.disk_mb },
    }))
    .into_response()
}

pub async fn action(State(h): State<H>, headers: HeaderMap, Json(v): Json<Value>) -> Response {
    let me = match admin(&h, &headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    if !crate::auth::csrf_ok(&headers) {
        return err(StatusCode::FORBIDDEN, "x-hub");
    }
    let id = v["id"].as_i64().unwrap_or(0);
    let act = v["action"].as_str().unwrap_or("");
    // conta nova criada pelo administrador (vale mesmo com o cadastro fechado)
    if act == "create" {
        return create(&h, &me, &v).await;
    }
    if id == me.id && matches!(act, "disable" | "delete" | "removeAdmin") {
        return err(StatusCode::BAD_REQUEST, "Não dá para fazer isso com a sua própria conta.");
    }
    let exists = h.db.lock().unwrap().query_row("SELECT 1 FROM users WHERE id = ?1", params![id], |_| Ok(())).optional().ok().flatten().is_some();
    if !exists {
        return err(StatusCode::NOT_FOUND, "Conta não encontrada.");
    }
    let drop_link = |h: &crate::Hub| {
        if let Some(l) = h.links.lock().unwrap().remove(&id) {
            l.close();
        }
    };
    match act {
        "disable" | "enable" => {
            let off = act == "disable";
            {
                let db = h.db.lock().unwrap();
                let _ = db.execute("UPDATE users SET disabled = ?1 WHERE id = ?2", params![off as i64, id]);
                if off {
                    let _ = db.execute("DELETE FROM sessions WHERE uid = ?1", params![id]);
                }
            }
            if off {
                drop_link(&h);
                h.boxes.stop(&h, id).await;
            }
        }
        "stop" => h.boxes.stop(&h, id).await,
        "logout" => {
            let _ = h.db.lock().unwrap().execute("DELETE FROM sessions WHERE uid = ?1", params![id]);
        }
        "reset2fa" => {
            let _ = h.db.lock().unwrap().execute("UPDATE users SET totp_on = 0, totp_secret = NULL, recovery = NULL WHERE id = ?1", params![id]);
        }
        "makeAdmin" | "removeAdmin" => {
            let _ = h.db.lock().unwrap().execute("UPDATE users SET is_admin = ?1 WHERE id = ?2", params![(act == "makeAdmin") as i64, id]);
        }
        "setQuota" => {
            let mb = v["quotaMb"].as_i64().unwrap_or(0).clamp(0, 1_000_000);
            let _ = h.db.lock().unwrap().execute("UPDATE users SET quota_mb = ?1 WHERE id = ?2", params![mb, id]);
        }
        "setPassword" => {
            let p = v["password"].as_str().unwrap_or("").to_string();
            if p.chars().count() < 8 {
                return err(StatusCode::BAD_REQUEST, "A senha precisa de pelo menos 8 caracteres.");
            }
            let Some(ph) = crate::auth::set_password_hash(p).await else { return err(StatusCode::INTERNAL_SERVER_ERROR, "hash") };
            let db = h.db.lock().unwrap();
            let _ = db.execute("UPDATE users SET pass = ?1 WHERE id = ?2", params![ph, id]);
            let _ = db.execute("DELETE FROM sessions WHERE uid = ?1", params![id]);
        }
        "setApi" => {
            if let Err(e) = set_api(&h, id, &v) {
                return err(StatusCode::BAD_REQUEST, &e);
            }
        }
        "delete" => {
            if v["confirm"].as_str() != Some("APAGAR") {
                return err(StatusCode::BAD_REQUEST, "Confirme digitando APAGAR.");
            }
            drop_link(&h);
            h.boxes.remove(&h, id).await;
            {
                let db = h.db.lock().unwrap();
                for t in ["sessions", "devices"] {
                    let _ = db.execute(&format!("DELETE FROM {t} WHERE uid = ?1"), params![id]);
                }
                let _ = db.execute("DELETE FROM users WHERE id = ?1", params![id]);
            }
            let d = crate::boxes::dir(&h, id);
            let _ = tokio::task::spawn_blocking(move || std::fs::remove_dir_all(d)).await;
        }
        _ => return err(StatusCode::BAD_REQUEST, "ação"),
    }
    eprintln!("admin {} -> {act} em {id} ({})", me.email, now());
    Json(json!({ "ok": true })).into_response()
}

/// Senha de 14 letras e números, para quando o administrador não escolhe uma.
fn gen_password() -> String {
    const A: &[u8] = b"abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    // o token é hexadecimal: cada par vira um byte aleatório
    let t = crate::db::token() + &crate::db::token();
    let bytes: Vec<u8> = (0..t.len() / 2).filter_map(|i| u8::from_str_radix(&t[i * 2..i * 2 + 2], 16).ok()).collect();
    bytes.iter().take(14).map(|b| A[*b as usize % A.len()] as char).collect()
}

async fn create(h: &crate::Hub, me: &crate::db::User, v: &Value) -> Response {
    let email = v["email"].as_str().unwrap_or("").trim().to_lowercase();
    if !crate::auth::valid_email(&email) {
        return err(StatusCode::BAD_REQUEST, "E-mail inválido.");
    }
    let mut pass = v["password"].as_str().unwrap_or("").to_string();
    let generated = pass.is_empty();
    if generated {
        pass = gen_password();
    }
    if pass.chars().count() < 8 || pass.len() > 256 {
        return err(StatusCode::BAD_REQUEST, "A senha precisa de pelo menos 8 caracteres.");
    }
    let Some(ph) = crate::auth::hash_pass(pass.clone()).await else { return err(StatusCode::INTERNAL_SERVER_ERROR, "hash") };
    let uid = {
        let db = h.db.lock().unwrap();
        if db.execute("INSERT INTO users(email, pass, created, secret) VALUES(?1, ?2, ?3, ?4)", params![email, ph, now(), crate::db::token()]).is_err() {
            return err(StatusCode::CONFLICT, "Esse e-mail já tem conta.");
        }
        db.last_insert_rowid()
    };
    let mut api_err = None;
    if v["api"].is_object() {
        if let Err(e) = set_api(h, uid, &v["api"]) {
            api_err = Some(e);
        }
    }
    eprintln!("admin {} -> create {email} ({uid})", me.email);
    Json(json!({ "ok": true, "id": uid, "password": if generated { Some(pass) } else { None }, "apiError": api_err })).into_response()
}

/// A API padrão do cliente: vai para a pasta dele e o studio da nuvem dele junta às APIs e a deixa ativa
/// (na hora, se estiver ligado; senão, quando ligar). A chave não fica guardada na central.
fn set_api(h: &crate::Hub, uid: i64, v: &Value) -> Result<(), String> {
    let s = |k: &str| v[k].as_str().unwrap_or("").trim().to_string();
    let (name, base, key, model) = (s("name"), s("base"), s("key"), s("model"));
    if !(base.starts_with("https://") || base.starts_with("http://")) {
        return Err("Endereço da API inválido (comece com https://).".into());
    }
    if model.is_empty() {
        return Err("Informe o modelo.".into());
    }
    let d = crate::boxes::dir(h, uid);
    crate::boxes::mkdir_owned(&d);
    let p = json!({ "id": "adm", "name": if name.is_empty() { "API padrão".to_string() } else { name.clone() }, "base": base.trim_end_matches('/'), "key": key, "model": model });
    let write = |path: &std::path::Path, body: String| -> Result<(), String> {
        std::fs::write(path, body).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            let _ = std::os::unix::fs::chown(path, Some(crate::boxes::UID), Some(crate::boxes::UID));
        }
        Ok(())
    };
    write(&d.join("admin-apis.json"), json!({ "providers": [p], "default": "adm" }).to_string())?;
    // o que o painel mostra depois (sem a chave)
    write(&d.join("admin-api-info.json"), json!({ "name": name, "base": base, "model": model, "at": now() }).to_string())?;
    Ok(())
}

/// Busca a versão nova do studio da nuvem; os studios parados trocam no próximo acesso e os ligados sem
/// tarefa, quando a página abrir.
pub async fn pull(State(h): State<H>, headers: HeaderMap) -> Response {
    if let Err(r) = admin(&h, &headers) {
        return r;
    }
    if !crate::auth::csrf_ok(&headers) {
        return err(StatusCode::FORBIDDEN, "x-hub");
    }
    match crate::boxes::pull_now(&h).await {
        Ok(changed) => Json(json!({ "changed": changed })).into_response(),
        Err(e) => err(StatusCode::BAD_GATEWAY, &e),
    }
}
