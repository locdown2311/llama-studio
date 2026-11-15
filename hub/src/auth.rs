//! Cadastro, login, sessão e o vínculo do PC.

use crate::db::{self, User};
use crate::{err, now, H};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::{ConnectInfo, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::net::SocketAddr;

const SESSION_DAYS: i64 = 30;

/// Os pedidos que mudam algo trazem `x-hub: 1` (um site de fora não consegue pôr esse cabeçalho).
pub fn csrf_ok(headers: &HeaderMap) -> bool {
    headers.get("x-hub").map(|v| v.as_bytes()) == Some(b"1")
}

pub fn user(h: &crate::Hub, headers: &HeaderMap) -> Option<User> {
    let tok = crate::cookie(headers, "hub_s")?;
    db::user_by_session(&h.db.lock().unwrap(), &tok)
}

fn session_cookie(h: &crate::Hub, tok: &str, max_age: i64) -> HeaderValue {
    HeaderValue::from_str(&format!("hub_s={tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{}", if h.cfg.secure() { "; Secure" } else { "" })).unwrap()
}

fn new_session(h: &crate::Hub, uid: i64) -> Response {
    let tok = db::token();
    {
        let db = h.db.lock().unwrap();
        let _ = db.execute("INSERT INTO sessions(hash, uid, expires) VALUES(?1, ?2, ?3)", params![db::sha(&tok), uid, now() + SESSION_DAYS * 86_400]);
        let _ = db.execute("UPDATE users SET last_login = ?1 WHERE id = ?2", params![now(), uid]);
        let _ = db.execute("DELETE FROM sessions WHERE expires < ?1", params![now()]);
    }
    let mut r = Json(json!({ "ok": true })).into_response();
    r.headers_mut().insert(header::SET_COOKIE, session_cookie(h, &tok, SESSION_DAYS * 86_400));
    r
}

fn valid_email(e: &str) -> bool {
    let Some((a, d)) = e.split_once('@') else { return false };
    !a.is_empty() && d.contains('.') && !d.starts_with('.') && !d.ends_with('.') && e.len() <= 200 && !e.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// Muitas senhas erradas seguidas (por IP e por conta): espera 15 minutos.
fn too_many(h: &crate::Hub, keys: &[String]) -> bool {
    let f = h.fails.lock().unwrap();
    keys.iter().any(|k| f.get(k).is_some_and(|(n, t)| *n >= 10 && t.elapsed().as_secs() < 900))
}

fn failed(h: &crate::Hub, keys: &[String]) {
    let mut f = h.fails.lock().unwrap();
    f.retain(|_, (_, t)| t.elapsed().as_secs() < 900);
    for k in keys {
        let e = f.entry(k.clone()).or_insert((0, std::time::Instant::now()));
        e.0 += 1;
        e.1 = std::time::Instant::now();
    }
}

async fn hash_pass(p: String) -> Option<String> {
    tokio::task::spawn_blocking(move || {
        let salt = SaltString::encode_b64(&{
            use rand::RngCore;
            let mut b = [0u8; 16];
            rand::rng().fill_bytes(&mut b);
            b
        })
        .ok()?;
        Argon2::default().hash_password(p.as_bytes(), &salt).ok().map(|h| h.to_string())
    })
    .await
    .ok()
    .flatten()
}

async fn check_pass(p: String, stored: String) -> bool {
    tokio::task::spawn_blocking(move || {
        if stored.is_empty() {
            let salt = SaltString::encode_b64(b"studio-hub-fixed").ok();
            let _ = salt.map(|s| Argon2::default().hash_password(p.as_bytes(), &s).map(|h| h.to_string()));
            return false;
        }
        PasswordHash::new(&stored).is_ok_and(|ph| Argon2::default().verify_password(p.as_bytes(), &ph).is_ok())
    })
    .await
    .unwrap_or(false)
}

fn creds(v: &Value) -> (String, String) {
    (v["email"].as_str().unwrap_or("").trim().to_lowercase(), v["password"].as_str().unwrap_or("").to_string())
}

pub async fn signup(State(h): State<H>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(v): Json<Value>) -> Response {
    if !csrf_ok(&headers) {
        return err(StatusCode::FORBIDDEN, "x-hub");
    }
    if !h.cfg.signup_open {
        return err(StatusCode::FORBIDDEN, "Cadastro fechado.");
    }
    let (email, pass) = creds(&v);
    if !valid_email(&email) {
        return err(StatusCode::BAD_REQUEST, "E-mail inválido.");
    }
    if pass.chars().count() < 8 || pass.len() > 256 {
        return err(StatusCode::BAD_REQUEST, "A senha precisa de pelo menos 8 caracteres.");
    }
    let ip = crate::client_ip(&h, &headers, Some(peer));
    let day = now() / 86_400;
    {
        let db = h.db.lock().unwrap();
        let n: i64 = db.query_row("SELECT n FROM signups WHERE ip = ?1 AND day = ?2", params![ip, day], |r| r.get(0)).optional().ok().flatten().unwrap_or(0);
        if n >= h.cfg.signups_per_ip as i64 {
            return err(StatusCode::TOO_MANY_REQUESTS, "Muitos cadastros deste endereço hoje.");
        }
        let exists: bool = db.query_row("SELECT 1 FROM users WHERE email = ?1", params![email], |_| Ok(())).optional().ok().flatten().is_some();
        if exists {
            return err(StatusCode::CONFLICT, "Esse e-mail já tem conta.");
        }
    }
    let Some(ph) = hash_pass(pass).await else { return err(StatusCode::INTERNAL_SERVER_ERROR, "hash") };
    let uid = {
        let db = h.db.lock().unwrap();
        if db.execute("INSERT INTO users(email, pass, created, secret) VALUES(?1, ?2, ?3, ?4)", params![email, ph, now(), db::token()]).is_err() {
            return err(StatusCode::CONFLICT, "Esse e-mail já tem conta.");
        }
        let _ = db.execute("INSERT INTO signups(ip, day, n) VALUES(?1, ?2, 1) ON CONFLICT(ip, day) DO UPDATE SET n = n + 1", params![ip, day]);
        db.last_insert_rowid()
    };
    // o número de uma conta apagada pode voltar: nada dela pode sobrar para a nova
    h.boxes.remove(&h, uid).await;
    let d = crate::boxes::dir(&h, uid);
    let _ = tokio::task::spawn_blocking(move || std::fs::remove_dir_all(d)).await;
    new_session(&h, uid)
}

async fn verify(h: &H, ip: &str, v: &Value) -> Result<i64, Response> {
    let (email, pass) = creds(v);
    let keys = [format!("ip:{ip}"), format!("e:{email}")];
    if too_many(h, &keys) {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "Muitas tentativas. Espere 15 minutos."));
    }
    let row: Option<(i64, String, i64)> = h.db.lock().unwrap().query_row("SELECT id, pass, disabled FROM users WHERE email = ?1", params![email], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional().ok().flatten();
    // sem conta também gasta o tempo do hash (não revela quais e-mails existem)
    let stored = row.as_ref().map(|r| r.1.clone()).unwrap_or_default();
    let ok = check_pass(pass, stored).await;
    match row {
        Some((id, _, 0)) if ok => Ok(id),
        Some((_, _, d)) if ok && d != 0 => Err(err(StatusCode::FORBIDDEN, "Conta desativada.")),
        _ => {
            failed(h, &keys);
            Err(err(StatusCode::UNAUTHORIZED, "E-mail ou senha incorretos."))
        }
    }
}

/// Login com duas etapas: a senha certa devolve um bilhete de 5 minutos, trocado pela sessão com o código.
fn tickets() -> &'static std::sync::Mutex<std::collections::HashMap<String, (i64, std::time::Instant, u32)>> {
    static T: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, (i64, std::time::Instant, u32)>>> = std::sync::OnceLock::new();
    T.get_or_init(Default::default)
}

pub async fn login(State(h): State<H>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(v): Json<Value>) -> Response {
    if !csrf_ok(&headers) {
        return err(StatusCode::FORBIDDEN, "x-hub");
    }
    let ip = crate::client_ip(&h, &headers, Some(peer));
    match verify(&h, &ip, &v).await {
        Ok(uid) => {
            if crate::totp::get(&h.db.lock().unwrap(), uid).on {
                let t = db::token();
                let mut m = tickets().lock().unwrap();
                m.retain(|_, (_, at, _)| at.elapsed().as_secs() < 300);
                m.insert(t.clone(), (uid, std::time::Instant::now(), 0));
                return Json(json!({ "need2fa": true, "ticket": t })).into_response();
            }
            new_session(&h, uid)
        }
        Err(r) => r,
    }
}

pub async fn login_2fa(State(h): State<H>, headers: HeaderMap, Json(v): Json<Value>) -> Response {
    if !csrf_ok(&headers) {
        return err(StatusCode::FORBIDDEN, "x-hub");
    }
    let t = v["ticket"].as_str().unwrap_or("").to_string();
    let uid = {
        let mut m = tickets().lock().unwrap();
        match m.get_mut(&t) {
            Some((uid, at, tries)) if at.elapsed().as_secs() < 300 && *tries < 5 => {
                *tries += 1;
                *uid
            }
            _ => {
                m.remove(&t);
                return err(StatusCode::UNAUTHORIZED, "Tempo esgotado. Entre de novo.");
            }
        }
    };
    if !crate::totp::verify(&h, uid, v["code"].as_str().unwrap_or("")) {
        return err(StatusCode::UNAUTHORIZED, "Código incorreto.");
    }
    tickets().lock().unwrap().remove(&t);
    new_session(&h, uid)
}

/// Confere a senha da conta (desligar as duas etapas, trocar a senha).
pub async fn password_ok(h: &H, uid: i64, pass: &str) -> bool {
    let stored: Option<String> = h.db.lock().unwrap().query_row("SELECT pass FROM users WHERE id = ?1", params![uid], |r| r.get(0)).optional().ok().flatten();
    match stored {
        Some(s) => check_pass(pass.to_string(), s).await,
        None => false,
    }
}

/// Trocar a senha: pede a atual e derruba as outras sessões.
pub async fn change_password(State(h): State<H>, headers: HeaderMap, Json(v): Json<Value>) -> Response {
    let Some(u) = user(&h, &headers) else { return err(StatusCode::UNAUTHORIZED, "login") };
    if !csrf_ok(&headers) {
        return err(StatusCode::FORBIDDEN, "x-hub");
    }
    if !password_ok(&h, u.id, v["current"].as_str().unwrap_or("")).await {
        return err(StatusCode::UNAUTHORIZED, "Senha atual incorreta.");
    }
    let new = v["password"].as_str().unwrap_or("").to_string();
    if new.chars().count() < 8 || new.len() > 256 {
        return err(StatusCode::BAD_REQUEST, "A senha precisa de pelo menos 8 caracteres.");
    }
    let Some(ph) = hash_pass(new).await else { return err(StatusCode::INTERNAL_SERVER_ERROR, "hash") };
    let db = h.db.lock().unwrap();
    let _ = db.execute("UPDATE users SET pass = ?1 WHERE id = ?2", params![ph, u.id]);
    if let Some(tok) = crate::cookie(&headers, "hub_s") {
        let _ = db.execute("DELETE FROM sessions WHERE uid = ?1 AND hash != ?2", params![u.id, db::sha(&tok)]);
    }
    Json(json!({ "ok": true })).into_response()
}

pub async fn set_password_hash(p: String) -> Option<String> {
    hash_pass(p).await
}

pub async fn logout(State(h): State<H>, headers: HeaderMap) -> Response {
    if !csrf_ok(&headers) {
        return err(StatusCode::FORBIDDEN, "x-hub");
    }
    if let Some(tok) = crate::cookie(&headers, "hub_s") {
        let _ = h.db.lock().unwrap().execute("DELETE FROM sessions WHERE hash = ?1", params![db::sha(&tok)]);
    }
    let mut r = Json(json!({ "ok": true })).into_response();
    r.headers_mut().insert(header::SET_COOKIE, session_cookie(&h, "", 0));
    r
}

pub async fn me(State(h): State<H>, headers: HeaderMap) -> Response {
    let Some(u) = user(&h, &headers) else { return Json(json!({ "user": null, "signupOpen": h.cfg.signup_open })).into_response() };
    let pc = h.links.lock().unwrap().get(&u.id).map(|l| json!({ "name": l.name, "secs": l.since.elapsed().as_secs() }));
    let cloud = h.boxes.info(u.id);
    let (twofa, admin, left) = {
        let db = h.db.lock().unwrap();
        let t = crate::totp::get(&db, u.id);
        (t.on, crate::admin::is_admin(&db, u.id), t.recovery.len())
    };
    Json(json!({ "user": { "email": u.email, "twofa": twofa, "recoveryLeft": left, "admin": admin }, "pc": pc, "cloud": cloud, "target": crate::cookie(&headers, "hub_t") })).into_response()
}

/// O studio do PC troca e-mail e senha por um token próprio (a senha não fica guardada no PC).
pub async fn pair(State(h): State<H>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(v): Json<Value>) -> Response {
    let ip = crate::client_ip(&h, &headers, Some(peer));
    let uid = match verify(&h, &ip, &v).await {
        Ok(uid) => uid,
        Err(r) => return r,
    };
    if crate::totp::get(&h.db.lock().unwrap(), uid).on {
        let code = v["code"].as_str().unwrap_or("");
        if code.trim().is_empty() {
            return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Digite o código das duas etapas.", "need2fa": true }))).into_response();
        }
        if !crate::totp::verify(&h, uid, code) {
            return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Código das duas etapas incorreto.", "need2fa": true }))).into_response();
        }
    }
    let name: String = v["name"].as_str().unwrap_or("PC").chars().filter(|c| !c.is_control()).take(60).collect();
    let tok = db::token();
    let _ = h.db.lock().unwrap().execute("INSERT INTO devices(uid, name, hash, created) VALUES(?1, ?2, ?3, ?4)", params![uid, if name.trim().is_empty() { "PC".into() } else { name }, db::sha(&tok), now()]);
    Json(json!({ "token": tok })).into_response()
}

pub async fn devices(State(h): State<H>, headers: HeaderMap) -> Response {
    let Some(u) = user(&h, &headers) else { return err(StatusCode::UNAUTHORIZED, "login") };
    let online = h.links.lock().unwrap().get(&u.id).map(|l| l.device);
    let db = h.db.lock().unwrap();
    let mut st = db.prepare("SELECT id, name, created, last_seen FROM devices WHERE uid = ?1 ORDER BY id").unwrap();
    let list: Vec<Value> = st
        .query_map(params![u.id], |r| Ok(json!({ "id": r.get::<_, i64>(0)?, "name": r.get::<_, String>(1)?, "created": r.get::<_, i64>(2)?, "lastSeen": r.get::<_, i64>(3)? })))
        .unwrap()
        .flatten()
        .map(|mut d| {
            d["online"] = json!(Some(d["id"].as_i64().unwrap_or(0)) == online);
            d
        })
        .collect();
    Json(json!({ "devices": list })).into_response()
}

pub async fn device_remove(State(h): State<H>, headers: HeaderMap, Json(v): Json<Value>) -> Response {
    let Some(u) = user(&h, &headers) else { return err(StatusCode::UNAUTHORIZED, "login") };
    if !csrf_ok(&headers) {
        return err(StatusCode::FORBIDDEN, "x-hub");
    }
    let id = v["id"].as_i64().unwrap_or(0);
    let n = h.db.lock().unwrap().execute("DELETE FROM devices WHERE id = ?1 AND uid = ?2", params![id, u.id]).unwrap_or(0);
    let mut links = h.links.lock().unwrap();
    if links.get(&u.id).is_some_and(|l| l.device == id) {
        if let Some(l) = links.remove(&u.id) {
            l.close();
        }
    }
    Json(json!({ "ok": n > 0 })).into_response()
}
