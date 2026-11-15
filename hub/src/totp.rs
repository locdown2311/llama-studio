//! Duas etapas: código de 6 dígitos que muda a cada 30 s (TOTP, RFC 6238 — Google Authenticator, Authy,
//! 1Password, Aegis...) e 10 códigos de recuperação de uso único.

use crate::{db, err, now, H};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use hmac::{Hmac, Mac};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;

const B32: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

pub fn b32_encode(data: &[u8]) -> String {
    let mut out = String::new();
    let (mut buf, mut bits) = (0u32, 0);
    for &b in data {
        buf = (buf << 8) | b as u32;
        bits += 8;
        while bits >= 5 {
            out.push(B32[((buf >> (bits - 5)) & 31) as usize] as char);
            bits -= 5;
        }
    }
    if bits > 0 {
        out.push(B32[((buf << (5 - bits)) & 31) as usize] as char);
    }
    out
}

pub fn b32_decode(s: &str) -> Option<Vec<u8>> {
    let mut out = vec![];
    let (mut buf, mut bits) = (0u32, 0);
    for c in s.chars().filter(|c| !c.is_whitespace() && *c != '=') {
        let v = B32.iter().position(|&x| x as char == c.to_ascii_uppercase())? as u32;
        buf = (buf << 5) | v;
        bits += 5;
        if bits >= 8 {
            out.push((buf >> (bits - 8)) as u8);
            bits -= 8;
        }
    }
    Some(out)
}

pub fn code_at(secret: &[u8], step: u64) -> u32 {
    let mut mac = Hmac::<sha1::Sha1>::new_from_slice(secret).expect("hmac");
    mac.update(&step.to_be_bytes());
    let h = mac.finalize().into_bytes();
    let o = (h[19] & 0xf) as usize;
    let n = u32::from_be_bytes([h[o] & 0x7f, h[o + 1], h[o + 2], h[o + 3]]);
    n % 1_000_000
}

/// Último passo aceito por conta: o mesmo código não vale duas vezes.
fn used() -> &'static Mutex<HashMap<i64, u64>> {
    static U: std::sync::OnceLock<Mutex<HashMap<i64, u64>>> = std::sync::OnceLock::new();
    U.get_or_init(Default::default)
}

/// Confere o código (aceita 30 s antes e depois, pelo relógio do celular).
pub fn check_code(uid: i64, secret_b32: &str, code: &str) -> bool {
    let code: String = code.chars().filter(|c| c.is_ascii_digit()).collect();
    let (Ok(n), Some(secret)) = (code.parse::<u32>(), b32_decode(secret_b32)) else { return false };
    if code.len() != 6 {
        return false;
    }
    let step = now() as u64 / 30;
    let mut u = used().lock().unwrap();
    for s in [step, step - 1, step + 1] {
        if code_at(&secret, s) == n && u.get(&uid).is_none_or(|&last| s > last) {
            u.insert(uid, s);
            return true;
        }
    }
    false
}

pub struct Twofa {
    pub on: bool,
    pub secret: String,
    pub recovery: Vec<String>,
}

pub fn get(c: &rusqlite::Connection, uid: i64) -> Twofa {
    c.query_row("SELECT totp_on, IFNULL(totp_secret, ''), IFNULL(recovery, '[]') FROM users WHERE id = ?1", params![uid], |r| {
        Ok(Twofa { on: r.get::<_, i64>(0)? != 0, secret: r.get(1)?, recovery: serde_json::from_str(&r.get::<_, String>(2)?).unwrap_or_default() })
    })
    .optional()
    .ok()
    .flatten()
    .unwrap_or(Twofa { on: false, secret: String::new(), recovery: vec![] })
}

/// Segundo passo: o código do app ou um código de recuperação (que é gasto).
pub fn verify(h: &crate::Hub, uid: i64, code: &str) -> bool {
    let db = h.db.lock().unwrap();
    let t = get(&db, uid);
    if !t.on {
        return true;
    }
    if check_code(uid, &t.secret, code) {
        return true;
    }
    let norm: String = code.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase();
    if norm.len() == 10 {
        let hsh = db::sha(&norm);
        if let Some(i) = t.recovery.iter().position(|x| *x == hsh) {
            let mut rest = t.recovery.clone();
            rest.remove(i);
            let _ = db.execute("UPDATE users SET recovery = ?1 WHERE id = ?2", params![serde_json::to_string(&rest).unwrap_or_default(), uid]);
            return true;
        }
    }
    false
}

fn qr_svg(text: &str) -> String {
    qrcode::QrCode::new(text.as_bytes())
        .map(|q| q.render::<qrcode::render::svg::Color>().min_dimensions(200, 200).quiet_zone(true).dark_color(qrcode::render::svg::Color("#000")).light_color(qrcode::render::svg::Color("#fff")).build())
        .unwrap_or_default()
}

fn recovery_codes() -> (Vec<String>, Vec<String>) {
    use rand::Rng;
    const A: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
    let mut r = rand::rng();
    let plain: Vec<String> = (0..10).map(|_| (0..10).map(|_| A[r.random_range(0..A.len())] as char).collect()).collect();
    let hashed = plain.iter().map(|p| db::sha(p)).collect();
    let shown = plain.iter().map(|p| format!("{}-{}", &p[..5], &p[5..])).collect();
    (shown, hashed)
}

fn issuer(h: &crate::Hub) -> String {
    let host = h.cfg.public_url.split("://").nth(1).unwrap_or("Llama Studio").to_string();
    format!("Llama Studio ({host})")
}

/// Começa a ativação: um segredo novo (ainda desligado até confirmar com um código).
pub async fn setup(State(h): State<H>, headers: HeaderMap) -> Response {
    let Some(u) = crate::auth::user(&h, &headers) else { return err(StatusCode::UNAUTHORIZED, "login") };
    if !crate::auth::csrf_ok(&headers) {
        return err(StatusCode::FORBIDDEN, "x-hub");
    }
    let db = h.db.lock().unwrap();
    if get(&db, u.id).on {
        return err(StatusCode::CONFLICT, "As duas etapas já estão ligadas.");
    }
    let secret = {
        use rand::RngCore;
        let mut b = [0u8; 20];
        rand::rng().fill_bytes(&mut b);
        b32_encode(&b)
    };
    let _ = db.execute("UPDATE users SET totp_secret = ?1 WHERE id = ?2", params![secret, u.id]);
    let iss = issuer(&h);
    let enc = |s: &str| s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect::<String>();
    let uri = format!("otpauth://totp/{}:{}?secret={secret}&issuer={}&algorithm=SHA1&digits=6&period=30", enc(&iss), enc(&u.email), enc(&iss));
    Json(json!({ "secret": secret, "uri": uri, "qr": qr_svg(&uri) })).into_response()
}

pub async fn enable(State(h): State<H>, headers: HeaderMap, Json(v): Json<Value>) -> Response {
    let Some(u) = crate::auth::user(&h, &headers) else { return err(StatusCode::UNAUTHORIZED, "login") };
    if !crate::auth::csrf_ok(&headers) {
        return err(StatusCode::FORBIDDEN, "x-hub");
    }
    let db = h.db.lock().unwrap();
    let t = get(&db, u.id);
    if t.on || t.secret.is_empty() {
        return err(StatusCode::CONFLICT, "Comece a ativação de novo.");
    }
    if !check_code(u.id, &t.secret, v["code"].as_str().unwrap_or("")) {
        return err(StatusCode::BAD_REQUEST, "Código incorreto. Confira o relógio do celular e tente o código atual.");
    }
    let (shown, hashed) = recovery_codes();
    let _ = db.execute("UPDATE users SET totp_on = 1, recovery = ?1 WHERE id = ?2", params![serde_json::to_string(&hashed).unwrap_or_default(), u.id]);
    // as outras sessões abertas saem (entram de novo já com as duas etapas)
    if let Some(tok) = crate::cookie(&headers, "hub_s") {
        let _ = db.execute("DELETE FROM sessions WHERE uid = ?1 AND hash != ?2", params![u.id, db::sha(&tok)]);
    }
    Json(json!({ "ok": true, "recovery": shown })).into_response()
}

/// Desligar pede a senha e um código (ou um de recuperação).
pub async fn disable(State(h): State<H>, headers: HeaderMap, Json(v): Json<Value>) -> Response {
    let Some(u) = crate::auth::user(&h, &headers) else { return err(StatusCode::UNAUTHORIZED, "login") };
    if !crate::auth::csrf_ok(&headers) {
        return err(StatusCode::FORBIDDEN, "x-hub");
    }
    if !crate::auth::password_ok(&h, u.id, v["password"].as_str().unwrap_or("")).await {
        return err(StatusCode::UNAUTHORIZED, "Senha incorreta.");
    }
    if !verify(&h, u.id, v["code"].as_str().unwrap_or("")) {
        return err(StatusCode::UNAUTHORIZED, "Código incorreto.");
    }
    let _ = h.db.lock().unwrap().execute("UPDATE users SET totp_on = 0, totp_secret = NULL, recovery = NULL WHERE id = ?1", params![u.id]);
    Json(json!({ "ok": true })).into_response()
}

/// Novos códigos de recuperação (os antigos deixam de valer).
pub async fn new_recovery(State(h): State<H>, headers: HeaderMap, Json(v): Json<Value>) -> Response {
    let Some(u) = crate::auth::user(&h, &headers) else { return err(StatusCode::UNAUTHORIZED, "login") };
    if !crate::auth::csrf_ok(&headers) {
        return err(StatusCode::FORBIDDEN, "x-hub");
    }
    if !get(&h.db.lock().unwrap(), u.id).on || !verify(&h, u.id, v["code"].as_str().unwrap_or("")) {
        return err(StatusCode::UNAUTHORIZED, "Código incorreto.");
    }
    let (shown, hashed) = recovery_codes();
    let _ = h.db.lock().unwrap().execute("UPDATE users SET recovery = ?1 WHERE id = ?2", params![serde_json::to_string(&hashed).unwrap_or_default(), u.id]);
    Json(json!({ "recovery": shown })).into_response()
}

#[cfg(test)]
mod t {
    use super::*;
    #[test]
    fn rfc6238() {
        // vetor do RFC 6238 (SHA1, segredo "12345678901234567890"), 8 dígitos -> os 6 finais
        let s = b"12345678901234567890";
        assert_eq!(code_at(s, 59 / 30), 287082);
        assert_eq!(code_at(s, 1111111109 / 30), 81804);
        assert_eq!(code_at(s, 1234567890 / 30), 5924);
        let e = b32_encode(s);
        assert_eq!(e, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
        assert_eq!(b32_decode(&e).unwrap(), s);
    }
}
