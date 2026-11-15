//! Notificações no celular (Web Push, RFC 8030/8291/8292): a central assina com a própria chave VAPID e
//! cifra a mensagem para cada aparelho inscrito. Quem pede para notificar: o PC (pelo túnel) e o studio da
//! nuvem (pela rede interna, com o segredo dele).

use crate::{err, now, H};
use aes_gcm::aead::{Aead, KeyInit};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use hkdf::Hkdf;
use p256::ecdsa::signature::Signer;
use p256::elliptic_curve::sec1::ToEncodedPoint;
use rand_core::{OsRng, RngCore};
use rusqlite::params;
use serde_json::{json, Value};
use sha2::Sha256;

pub fn init(c: &rusqlite::Connection) {
    let _ = c.execute_batch("CREATE TABLE IF NOT EXISTS push(uid INTEGER NOT NULL, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created INTEGER NOT NULL);");
}

/// A chave VAPID da central (gerada na primeira vez, em HUB_DATA/vapid.key).
fn vapid(h: &crate::Hub) -> p256::SecretKey {
    static K: std::sync::OnceLock<p256::SecretKey> = std::sync::OnceLock::new();
    K.get_or_init(|| {
        let path = h.cfg.data.join("vapid.key");
        if let Some(k) = std::fs::read_to_string(&path).ok().and_then(|t| B64.decode(t.trim()).ok()).and_then(|b| p256::SecretKey::from_slice(&b).ok()) {
            return k;
        }
        let k = p256::SecretKey::random(&mut OsRng);
        let _ = std::fs::write(&path, B64.encode(k.to_bytes()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        k
    })
    .clone()
}

fn public_b64(h: &crate::Hub) -> String {
    B64.encode(vapid(h).public_key().to_encoded_point(false).as_bytes())
}

pub async fn key(State(h): State<H>) -> Response {
    Json(json!({ "key": public_b64(&h) })).into_response()
}

/// Só os serviços de push dos navegadores (a central não posta em endereço qualquer).
fn endpoint_ok(e: &str) -> bool {
    let Some(rest) = e.strip_prefix("https://") else { return false };
    let host = rest.split('/').next().unwrap_or("").split(':').next().unwrap_or("").to_lowercase();
    ["fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com", "push.services.mozilla.com", "web.push.apple.com", "notify.windows.com", "push.apple.com"]
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{d}")))
}

pub async fn subscribe(State(h): State<H>, headers: HeaderMap, Json(v): Json<Value>) -> Response {
    let Some(u) = crate::auth::user(&h, &headers) else { return err(StatusCode::UNAUTHORIZED, "login") };
    if !crate::auth::csrf_ok(&headers) {
        return err(StatusCode::FORBIDDEN, "x-hub");
    }
    let e = v["endpoint"].as_str().unwrap_or("");
    let (p, a) = (v["keys"]["p256dh"].as_str().unwrap_or(""), v["keys"]["auth"].as_str().unwrap_or(""));
    if !endpoint_ok(e) || B64.decode(p).map(|b| b.len()).unwrap_or(0) != 65 || B64.decode(a).map(|b| b.len()).unwrap_or(0) != 16 {
        return err(StatusCode::BAD_REQUEST, "inscrição inválida");
    }
    let db = h.db.lock().unwrap();
    let _ = db.execute("INSERT INTO push(uid, endpoint, p256dh, auth, created) VALUES(?1, ?2, ?3, ?4, ?5) ON CONFLICT(endpoint) DO UPDATE SET uid = ?1, p256dh = ?3, auth = ?4", params![u.id, e, p, a, now()]);
    // no máximo 10 aparelhos por conta
    let _ = db.execute("DELETE FROM push WHERE uid = ?1 AND endpoint NOT IN (SELECT endpoint FROM push WHERE uid = ?1 ORDER BY created DESC LIMIT 10)", params![u.id]);
    Json(json!({ "ok": true })).into_response()
}

pub async fn unsubscribe(State(h): State<H>, headers: HeaderMap, Json(v): Json<Value>) -> Response {
    let Some(u) = crate::auth::user(&h, &headers) else { return err(StatusCode::UNAUTHORIZED, "login") };
    let _ = h.db.lock().unwrap().execute("DELETE FROM push WHERE uid = ?1 AND endpoint = ?2", params![u.id, v["endpoint"].as_str().unwrap_or("")]);
    Json(json!({ "ok": true })).into_response()
}

/// Cifra a mensagem para um aparelho (aes128gcm, RFC 8291).
fn encrypt(p256dh: &[u8], auth: &[u8], payload: &[u8]) -> Option<Vec<u8>> {
    let ua = p256::PublicKey::from_sec1_bytes(p256dh).ok()?;
    let eph = p256::ecdh::EphemeralSecret::random(&mut OsRng);
    let as_pub = eph.public_key().to_encoded_point(false);
    let shared = eph.diffie_hellman(&ua);
    let mut info = b"WebPush: info\0".to_vec();
    info.extend_from_slice(p256dh);
    info.extend_from_slice(as_pub.as_bytes());
    let mut ikm = [0u8; 32];
    Hkdf::<Sha256>::new(Some(auth), shared.raw_secret_bytes()).expand(&info, &mut ikm).ok()?;
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let hk = Hkdf::<Sha256>::new(Some(&salt), &ikm);
    let (mut cek, mut nonce) = ([0u8; 16], [0u8; 12]);
    hk.expand(b"Content-Encoding: aes128gcm\0", &mut cek).ok()?;
    hk.expand(b"Content-Encoding: nonce\0", &mut nonce).ok()?;
    let mut plain = payload.to_vec();
    plain.push(2); // último registro
    let ct = aes_gcm::Aes128Gcm::new_from_slice(&cek).ok()?.encrypt(aes_gcm::Nonce::from_slice(&nonce), plain.as_slice()).ok()?;
    let mut out = salt.to_vec();
    out.extend_from_slice(&4096u32.to_be_bytes());
    out.push(65);
    out.extend_from_slice(as_pub.as_bytes());
    out.extend_from_slice(&ct);
    Some(out)
}

fn jwt(h: &crate::Hub, endpoint: &str) -> String {
    let aud = endpoint.splitn(4, '/').take(3).collect::<Vec<_>>().join("/");
    let sub = if h.cfg.public_url.is_empty() { "mailto:admin@localhost".to_string() } else { h.cfg.public_url.clone() };
    let head = B64.encode(br#"{"typ":"JWT","alg":"ES256"}"#);
    let claims = B64.encode(json!({ "aud": aud, "exp": now() + 12 * 3600, "sub": sub }).to_string());
    let msg = format!("{head}.{claims}");
    let sk = p256::ecdsa::SigningKey::from(vapid(h));
    let sig: p256::ecdsa::Signature = sk.sign(msg.as_bytes());
    format!("{msg}.{}", B64.encode(sig.to_bytes()))
}

/// Manda para todos os aparelhos inscritos da conta. Inscrição vencida (404/410) é apagada.
pub async fn send(h: &crate::Hub, uid: i64, msg: &Value) {
    let subs: Vec<(String, String, String)> = {
        let db = h.db.lock().unwrap();
        let mut st = db.prepare("SELECT endpoint, p256dh, auth FROM push WHERE uid = ?1").unwrap();
        st.query_map(params![uid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().flatten().collect()
    };
    let payload = msg.to_string();
    for (e, p, a) in subs {
        let (Ok(p), Ok(a)) = (B64.decode(&p), B64.decode(&a)) else { continue };
        let Some(body) = encrypt(&p, &a, payload.as_bytes()) else { continue };
        let r = h
            .http
            .post(&e)
            .header("content-encoding", "aes128gcm")
            .header("content-type", "application/octet-stream")
            .header("ttl", "86400")
            .header("urgency", "normal")
            .header("authorization", format!("vapid t={}, k={}", jwt(h, &e), public_b64(h)))
            .body(body)
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await;
        match r {
            Ok(r) if matches!(r.status().as_u16(), 404 | 410) => {
                let _ = h.db.lock().unwrap().execute("DELETE FROM push WHERE endpoint = ?1", params![e]);
            }
            Ok(r) if !r.status().is_success() => eprintln!("push {}: {}", r.status(), e.split('/').nth(2).unwrap_or("")),
            Err(x) => eprintln!("push: {x}"),
            _ => {}
        }
    }
}

/// O studio da nuvem de um usuário pede uma notificação (identificado pelo segredo dele).
pub async fn internal(State(h): State<H>, headers: HeaderMap, Json(v): Json<Value>) -> Response {
    let secret = headers.get("x-hub-secret").and_then(|x| x.to_str().ok()).unwrap_or("");
    let uid: Option<i64> = if secret.len() >= 32 { h.db.lock().unwrap().query_row("SELECT id FROM users WHERE secret = ?1 AND disabled = 0", params![secret], |r| r.get(0)).ok() } else { None };
    let Some(uid) = uid else { return err(StatusCode::UNAUTHORIZED, "segredo") };
    send(&h, uid, &clean(&v)).await;
    Json(json!({ "ok": true })).into_response()
}

/// Só título, texto e um caminho do próprio studio.
pub fn clean(v: &Value) -> Value {
    let t = |k: &str, n: usize| v[k].as_str().unwrap_or("").chars().take(n).collect::<String>();
    let url = t("url", 200);
    json!({ "title": t("title", 120), "body": t("body", 300), "url": if url.starts_with('/') && !url.starts_with("//") { url } else { "/".into() } })
}

#[cfg(test)]
mod t {
    #[test]
    fn so_servicos_de_push() {
        assert!(super::endpoint_ok("https://fcm.googleapis.com/fcm/send/abc"));
        assert!(super::endpoint_ok("https://web.push.apple.com/QAbc"));
        assert!(!super::endpoint_ok("http://fcm.googleapis.com/x"));
        assert!(!super::endpoint_ok("https://169.254.169.254/latest"));
        assert!(!super::endpoint_ok("https://evilgoogleapis.com/x"));
    }

    #[test]
    fn cifra_e_decifra() {
        use super::*;
        // o lado do navegador: chave e segredo de autenticação
        let ua = p256::SecretKey::random(&mut OsRng);
        let ua_pub = ua.public_key().to_encoded_point(false);
        let mut auth = [0u8; 16];
        OsRng.fill_bytes(&mut auth);
        let body = encrypt(ua_pub.as_bytes(), &auth, b"{\"title\":\"oi\"}").unwrap();
        let (salt, rs, idlen) = (&body[..16], u32::from_be_bytes(body[16..20].try_into().unwrap()), body[20] as usize);
        assert_eq!((rs, idlen), (4096, 65));
        let as_pub = p256::PublicKey::from_sec1_bytes(&body[21..21 + idlen]).unwrap();
        let shared = p256::ecdh::diffie_hellman(ua.to_nonzero_scalar(), as_pub.as_affine());
        let mut info = b"WebPush: info\0".to_vec();
        info.extend_from_slice(ua_pub.as_bytes());
        info.extend_from_slice(&body[21..21 + idlen]);
        let mut ikm = [0u8; 32];
        Hkdf::<Sha256>::new(Some(&auth), shared.raw_secret_bytes()).expand(&info, &mut ikm).unwrap();
        let hk = Hkdf::<Sha256>::new(Some(salt), &ikm);
        let (mut cek, mut nonce) = ([0u8; 16], [0u8; 12]);
        hk.expand(b"Content-Encoding: aes128gcm\0", &mut cek).unwrap();
        hk.expand(b"Content-Encoding: nonce\0", &mut nonce).unwrap();
        let plain = aes_gcm::Aes128Gcm::new_from_slice(&cek).unwrap().decrypt(aes_gcm::Nonce::from_slice(&nonce), &body[21 + idlen..]).unwrap();
        assert_eq!(&plain, b"{\"title\":\"oi\"}\x02");
    }
}
