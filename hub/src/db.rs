//! Banco da central (SQLite): contas, sessões, PCs vinculados e o controle de cadastros por IP.
//! Senhas com argon2; sessões e tokens de PC guardados só como hash.

use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let c = Connection::open(path)?;
    c.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, pass TEXT NOT NULL,
            created INTEGER NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, secret TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, uid INTEGER NOT NULL, expires INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS devices(id INTEGER PRIMARY KEY, uid INTEGER NOT NULL, name TEXT NOT NULL,
            hash TEXT UNIQUE NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL DEFAULT 0);
         CREATE TABLE IF NOT EXISTS signups(ip TEXT NOT NULL, day INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY(ip, day));",
    )?;
    // colunas novas (bancos de versões anteriores)
    for col in [
        "totp_secret TEXT",
        "totp_on INTEGER NOT NULL DEFAULT 0",
        "recovery TEXT",
        "is_admin INTEGER NOT NULL DEFAULT 0",
        "quota_mb INTEGER NOT NULL DEFAULT 0",
        "last_login INTEGER NOT NULL DEFAULT 0",
    ] {
        let _ = c.execute(&format!("ALTER TABLE users ADD COLUMN {col}"), []);
    }
    Ok(c)
}

pub fn sha(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

pub fn token() -> String {
    use rand::RngCore;
    let mut b = [0u8; 32];
    rand::rng().fill_bytes(&mut b);
    hex::encode(b)
}

#[derive(Clone)]
pub struct User {
    pub id: i64,
    pub email: String,
    pub secret: String,
}

pub fn user_by_session(c: &Connection, tok: &str) -> Option<User> {
    c.query_row(
        "SELECT u.id, u.email, u.secret FROM sessions s JOIN users u ON u.id = s.uid WHERE s.hash = ?1 AND s.expires > ?2 AND u.disabled = 0",
        params![sha(tok), crate::now()],
        |r| Ok(User { id: r.get(0)?, email: r.get(1)?, secret: r.get(2)? }),
    )
    .optional()
    .ok()
    .flatten()
}

pub fn user_by_device(c: &Connection, tok: &str) -> Option<(User, i64, String)> {
    let r = c
        .query_row(
            "SELECT u.id, u.email, u.secret, d.id, d.name FROM devices d JOIN users u ON u.id = d.uid WHERE d.hash = ?1 AND u.disabled = 0",
            params![sha(tok)],
            |r| Ok((User { id: r.get(0)?, email: r.get(1)?, secret: r.get(2)? }, r.get::<_, i64>(3)?, r.get::<_, String>(4)?)),
        )
        .optional()
        .ok()
        .flatten()?;
    let _ = c.execute("UPDATE devices SET last_seen = ?1 WHERE id = ?2", params![crate::now(), r.1]);
    Some(r)
}

pub fn user_by_secret(c: &Connection, uid: i64, secret: &str) -> bool {
    c.query_row("SELECT secret FROM users WHERE id = ?1 AND disabled = 0", params![uid], |r| r.get::<_, String>(0))
        .optional()
        .ok()
        .flatten()
        .is_some_and(|s| s.len() == secret.len() && s.bytes().zip(secret.bytes()).fold(0u8, |a, (x, y)| a | (x ^ y)) == 0)
}

/// Linha de comando para quem administra: `studio-hub users`, `disable <email>`, `enable <email>`.
pub fn cli(c: &Connection, args: &[String]) -> i32 {
    match args[0].as_str() {
        "users" => {
            let mut st = c.prepare("SELECT id, email, created, disabled FROM users ORDER BY id").unwrap();
            let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?))).unwrap();
            for r in rows.flatten() {
                println!("{}\t{}\t{}{}", r.0, r.1, r.2, if r.3 != 0 { "\tdesativada" } else { "" });
            }
            0
        }
        "disable" | "enable" if args.len() > 1 => {
            let n = c.execute("UPDATE users SET disabled = ?1 WHERE email = ?2", params![(args[0] == "disable") as i64, args[1].to_lowercase()]).unwrap_or(0);
            if args[0] == "disable" {
                let _ = c.execute("DELETE FROM sessions WHERE uid IN (SELECT id FROM users WHERE email = ?1)", params![args[1].to_lowercase()]);
            }
            println!("{n}");
            (n == 0) as i32
        }
        "admin" if args.len() > 1 => {
            let n = c.execute("UPDATE users SET is_admin = 1 WHERE email = ?1", params![args[1].to_lowercase()]).unwrap_or(0);
            println!("{n}");
            (n == 0) as i32
        }
        "reset2fa" if args.len() > 1 => {
            let n = c.execute("UPDATE users SET totp_on = 0, totp_secret = NULL, recovery = NULL WHERE email = ?1", params![args[1].to_lowercase()]).unwrap_or(0);
            println!("{n}");
            (n == 0) as i32
        }
        "passwd" if args.len() > 2 => {
            use argon2::password_hash::{PasswordHasher, SaltString};
            let salt = SaltString::encode_b64(token().as_bytes().get(..16).unwrap_or(b"0123456789abcdef")).expect("salt");
            let Ok(ph) = argon2::Argon2::default().hash_password(args[2].as_bytes(), &salt) else { return 1 };
            let n = c.execute("UPDATE users SET pass = ?1 WHERE email = ?2", params![ph.to_string(), args[1].to_lowercase()]).unwrap_or(0);
            let _ = c.execute("DELETE FROM sessions WHERE uid IN (SELECT id FROM users WHERE email = ?1)", params![args[1].to_lowercase()]);
            println!("{n}");
            (n == 0) as i32
        }
        _ => {
            eprintln!("uso: studio-hub [users | disable <email> | enable <email> | admin <email> | reset2fa <email> | passwd <email> <senha nova>]");
            2
        }
    }
}
