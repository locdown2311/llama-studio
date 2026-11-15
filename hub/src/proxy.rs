//! A saída para a internet dos contêineres: um proxy HTTPS (CONNECT) na rede interna.
//! - Cada contêiner se identifica com o próprio segredo (Proxy-Authorization), então dá para saber de quem é.
//! - Só portas 443/80 e só endereços públicos: nada da rede local, do Docker, da própria central ou do
//!   endereço de metadados da nuvem (o nome é resolvido aqui e a conexão vai ao IP já conferido).
//! - `HUB_ALLOW` (lista de domínios) restringe ainda mais, se você quiser.

use crate::H;
use base64::Engine;
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const MAX_CONNS: usize = 64;

pub async fn serve(h: H) {
    let l = match TcpListener::bind(&h.cfg.proxy_bind).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("proxy: {e}");
            return;
        }
    };
    let conns: &'static Mutex<HashMap<i64, usize>> = Box::leak(Box::new(Mutex::new(HashMap::new())));
    loop {
        let Ok((s, _)) = l.accept().await else { continue };
        let h = h.clone();
        tokio::spawn(async move {
            let _ = handle(h, s, conns).await;
        });
    }
}

pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            !(v.is_private() || v.is_loopback() || v.is_link_local() || v.is_unspecified() || v.is_broadcast() || v.is_multicast() || v.is_documentation()
                || o[0] == 0
                || (o[0] == 100 && (64..128).contains(&o[1]))
                || (o[0] == 192 && o[1] == 0 && o[2] == 0)
                || (o[0] == 198 && (18..20).contains(&o[1]))
                || o[0] >= 240)
        }
        IpAddr::V6(v) => {
            if let Some(m) = v.to_ipv4_mapped() {
                return public_ip(IpAddr::V4(m));
            }
            let s = v.segments();
            !(v.is_loopback() || v.is_unspecified() || v.is_multicast() || (s[0] & 0xfe00) == 0xfc00 || (s[0] & 0xffc0) == 0xfe80 || s[0] == 0x2001 && s[1] == 0x0db8)
        }
    }
}

fn allowed_host(allow: &[String], host: &str) -> bool {
    allow.is_empty() || allow.iter().any(|a| host == a || host.ends_with(&format!(".{a}")))
}

async fn reply(s: &mut TcpStream, code: &str) -> std::io::Result<()> {
    s.write_all(format!("HTTP/1.1 {code}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await
}

struct Count(&'static Mutex<HashMap<i64, usize>>, i64);
impl Drop for Count {
    fn drop(&mut self) {
        if let Some(n) = self.0.lock().unwrap().get_mut(&self.1) {
            *n = n.saturating_sub(1);
        }
    }
}

async fn handle(h: H, mut s: TcpStream, conns: &'static Mutex<HashMap<i64, usize>>) -> std::io::Result<()> {
    let mut buf = Vec::with_capacity(1024);
    let mut tmp = [0u8; 1024];
    let head_end = loop {
        let n = tokio::time::timeout(std::time::Duration::from_secs(10), s.read(&mut tmp)).await.map_err(|_| std::io::Error::other("timeout"))??;
        if n == 0 {
            return Ok(());
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
        if buf.len() > 8192 {
            return reply(&mut s, "431 Request Header Fields Too Large").await;
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let first: Vec<&str> = lines.next().unwrap_or("").split_whitespace().collect();
    if first.len() < 2 || first[0] != "CONNECT" {
        return reply(&mut s, "405 Method Not Allowed").await;
    }
    // quem é
    let auth = lines.find_map(|l| l.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case("proxy-authorization")).map(|(_, v)| v.trim().to_string()));
    let who = auth
        .and_then(|a| a.strip_prefix("Basic ").map(str::to_string))
        .and_then(|b| base64::engine::general_purpose::STANDARD.decode(b).ok())
        .and_then(|b| String::from_utf8(b).ok())
        .and_then(|c| {
            let (u, p) = c.split_once(':')?;
            let id: i64 = u.strip_prefix('u')?.parse().ok()?;
            crate::db::user_by_secret(&h.db.lock().unwrap(), id, p).then_some(id)
        });
    let Some(uid) = who else { return reply(&mut s, "407 Proxy Authentication Required").await };
    let full = {
        let mut c = conns.lock().unwrap();
        let n = c.entry(uid).or_default();
        let full = *n >= MAX_CONNS;
        if !full {
            *n += 1;
        }
        full
    };
    if full {
        return reply(&mut s, "429 Too Many Requests").await;
    }
    let _count = Count(conns, uid);
    let target = first[1];
    let (host, port) = match target.rsplit_once(':') {
        Some((h, p)) => (h.trim_matches(|c| c == '[' || c == ']').to_lowercase(), p.parse::<u16>().unwrap_or(0)),
        None => (target.to_lowercase(), 443),
    };
    if !matches!(port, 443 | 80) || !allowed_host(&h.cfg.allow, &host) {
        return reply(&mut s, "403 Forbidden").await;
    }
    let addrs: Vec<SocketAddr> = match tokio::net::lookup_host((host.as_str(), port)).await {
        Ok(a) => a.collect(),
        Err(_) => return reply(&mut s, "502 Bad Gateway").await,
    };
    // todos os endereços do nome precisam ser públicos (um nome que aponta para dentro é recusado)
    if addrs.is_empty() || addrs.iter().any(|a| !public_ip(a.ip())) {
        return reply(&mut s, "403 Forbidden").await;
    }
    let mut up = None;
    for a in &addrs {
        if let Ok(Ok(c)) = tokio::time::timeout(std::time::Duration::from_secs(10), TcpStream::connect(a)).await {
            up = Some(c);
            break;
        }
    }
    let Some(mut up) = up else { return reply(&mut s, "502 Bad Gateway").await };
    s.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await?;
    if buf.len() > head_end {
        up.write_all(&buf[head_end..]).await?;
    }
    let _ = tokio::io::copy_bidirectional(&mut s, &mut up).await;
    Ok(())
}

#[cfg(test)]
mod t {
    use super::*;
    #[test]
    fn enderecos() {
        for ip in ["10.0.0.1", "172.18.0.2", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"] {
            assert!(!public_ip(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "1.1.1.1", "2606:4700::1111"] {
            assert!(public_ip(ip.parse().unwrap()), "{ip}");
        }
        assert!(allowed_host(&[], "x.com"));
        assert!(allowed_host(&["github.com".into()], "api.github.com"));
        assert!(!allowed_host(&["github.com".into()], "evilgithub.com"));
    }
}
