//! Fontes da internet para a base de conhecimento: um link vira arquivos numa pasta do studio
//! (dados/conhecimento/<projeto>/fontes/<hash>/), que a base indexa como qualquer pasta.
//!
//! - YouTube: a transcrição do vídeo (yt-dlp, se instalado em Utilitários; senão, a legenda pela página).
//! - GitHub: os arquivos de texto, código e documentos do repositório (ou de uma subpasta: /tree/<ramo>/<pasta>).
//! - Site: a página e as páginas ligadas a ela no mesmo endereço (até 40), mais os PDFs que elas apontam.
//!
//! O que foi baixado vale por 7 dias; "Indexar agora" baixa de novo. meta.json guarda o link de cada arquivo,
//! para a busca mostrar o endereço em vez do caminho no disco.

use serde_json::{json, Map, Value};
use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::app::App;

const MAX_PAGES: usize = 40;
const STALE_MS: u64 = 7 * 86_400_000;
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

pub fn is_url(s: &str) -> bool {
    let s = s.trim().to_lowercase();
    s.starts_with("http://") || s.starts_with("https://")
}

fn hash(s: &str) -> String {
    let mut h: u64 = 1469598103934665603;
    for b in s.trim().bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    format!("{h:016x}")
}

pub fn root(app: &App, id: &str) -> PathBuf {
    app.root.join("conhecimento").join(id).join("fontes")
}

pub fn dir_for(app: &App, id: &str, url: &str) -> PathBuf {
    root(app, id).join(hash(url))
}

pub fn meta(dir: &Path) -> Option<Value> {
    std::fs::read(dir.join("meta.json")).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

/// O link de um arquivo baixado (para mostrar na busca), se o caminho for de uma fonte da internet.
pub fn url_of(app: &App, id: &str, path: &str) -> Option<String> {
    let r = root(app, id);
    let p = Path::new(path);
    let rel = p.strip_prefix(&r).ok()?;
    let mut comps = rel.components();
    let h = comps.next()?.as_os_str().to_string_lossy().to_string();
    let inner = comps.as_path().to_string_lossy().replace('\\', "/");
    let m = meta(&r.join(&h))?;
    m["map"][&inner].as_str().map(str::to_string).or_else(|| m["url"].as_str().map(str::to_string))
}

fn now() -> u64 {
    crate::app::now_ms() as u64
}

async fn get(app: &App, url: &str, secs: u64, max: usize) -> Result<(u16, String, String, Vec<u8>), String> {
    let r = app.web.get(url).header("User-Agent", UA).header("Accept-Language", "pt-BR,pt;q=0.9,en;q=0.8").timeout(Duration::from_secs(secs)).send().await.map_err(|e| e.to_string())?;
    let st = r.status().as_u16();
    let ct = r.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_lowercase();
    let fin = r.url().to_string();
    let b = r.bytes().await.map_err(|e| e.to_string())?;
    if b.len() > max {
        return Err(LF!("Grande demais ({} MB).", "Too large ({} MB).", b.len() / 1_048_576));
    }
    Ok((st, ct, fin, b.to_vec()))
}

/// Baixa (ou reaproveita) a fonte. `force` baixa de novo mesmo se ainda estiver valendo.
pub async fn materialize(app: &App, id: &str, url: &str, force: bool) -> Value {
    let dir = dir_for(app, id, url);
    if let Some(m) = meta(&dir) {
        let fresh = now().saturating_sub(m["fetched"].as_u64().unwrap_or(0)) < STALE_MS;
        if !force && (fresh || m["error"].as_str().is_some_and(|e| !e.is_empty())) {
            return m;
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::create_dir_all(&dir);
    let u = url.trim();
    let low = u.to_lowercase();
    let mut map = Map::new();
    let r = if low.contains("youtube.com/") || low.contains("youtu.be/") {
        youtube(app, u, &dir, &mut map).await.map(|t| ("youtube", t))
    } else if low.starts_with("https://github.com/") || low.starts_with("http://github.com/") {
        github(app, u, &dir, &mut map).await.map(|t| ("github", t))
    } else {
        site(app, u, &dir, &mut map).await.map(|t| ("site", t))
    };
    let m = match r {
        Ok((kind, title)) => json!({ "url": u, "kind": kind, "title": title, "fetched": now(), "files": map.len(), "map": map, "error": "" }),
        Err(e) => json!({ "url": u, "kind": "", "title": "", "fetched": now(), "files": 0, "map": {}, "error": e }),
    };
    let _ = std::fs::write(dir.join("meta.json"), m.to_string());
    m
}

/* ---------------------------------------------------------------- YouTube */

fn yt_id(u: &str) -> Option<String> {
    let url = reqwest::Url::parse(u).ok()?;
    let host = url.host_str()?.to_lowercase();
    let id = if host.ends_with("youtu.be") {
        url.path_segments()?.next()?.to_string()
    } else if let Some((_, v)) = url.query_pairs().find(|(k, _)| k == "v") {
        v.to_string()
    } else {
        let segs: Vec<&str> = url.path_segments()?.collect();
        match segs.as_slice() {
            ["shorts" | "live" | "embed", id, ..] => id.to_string(),
            _ => return None,
        }
    };
    (id.len() >= 6 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).then_some(id)
}

fn mmss(ms: u64) -> String {
    let s = ms / 1000;
    if s >= 3600 { format!("{}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60) } else { format!("{:02}:{:02}", s / 60, s % 60) }
}

/// VTT (legenda) -> "[mm:ss] texto", sem as repetições da legenda automática (que rola linha por linha).
pub fn vtt_text(v: &str) -> String {
    let tag = regex_lite::Regex::new(r"<[^>]*>").unwrap();
    let mut out = vec![];
    let mut last = String::new();
    let mut at = 0u64;
    let mut seen_recent: VecDeque<String> = VecDeque::new();
    for line in v.lines() {
        let l = line.trim();
        if let Some((a, _)) = l.split_once(" --> ") {
            let p: Vec<u64> = a.trim().replace(',', ".").split([':', '.']).filter_map(|x| x.parse().ok()).collect();
            at = match p.as_slice() {
                [h, m, s, ms] => ((h * 60 + m) * 60 + s) * 1000 + ms,
                [m, s, ms] => (m * 60 + s) * 1000 + ms,
                _ => at,
            };
            continue;
        }
        if l.is_empty() || l == "WEBVTT" || l.starts_with("Kind:") || l.starts_with("Language:") || l.starts_with("NOTE") || l.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let t = crate::web::entities(&tag.replace_all(l, "")).trim().to_string();
        if t.is_empty() || t == last || seen_recent.contains(&t) {
            continue;
        }
        seen_recent.push_back(t.clone());
        if seen_recent.len() > 3 {
            seen_recent.pop_front();
        }
        out.push(format!("[{}] {}", mmss(at), t));
        last = t;
    }
    out.join("\n")
}

async fn youtube(app: &App, u: &str, dir: &Path, map: &mut Map<String, Value>) -> Result<String, String> {
    let id = yt_id(u).ok_or(L!("Não reconheci o vídeo nesse link do YouTube (playlists e canais não entram; use o link de um vídeo).", "Could not recognize the video in this YouTube link (playlists and channels are not supported; use a video link)."))?;
    let watch = format!("https://www.youtube.com/watch?v={id}");
    // 1) yt-dlp, quando instalado (mais confiável)
    if let Some(bin) = crate::bins::which("yt-dlp") {
        let tpl = dir.join("v.%(ext)s").to_string_lossy().to_string();
        let mut c = tokio::process::Command::new(bin);
        c.args(["--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", "pt.*,pt,en.*,en", "--sub-format", "vtt", "--no-warnings", "--print", "title", "--no-simulate", "-o", &tpl, &watch]).kill_on_drop(true);
        #[cfg(windows)]
        {
            c.creation_flags(crate::CREATE_NO_WINDOW);
        }
        if let Ok(Ok(o)) = tokio::time::timeout(Duration::from_secs(120), c.output()).await {
            let title = String::from_utf8_lossy(&o.stdout).lines().next().unwrap_or("").trim().to_string();
            let mut vtts: Vec<PathBuf> = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e == "vtt")).collect();
            // legenda feita por gente antes da automática; português antes de inglês
            vtts.sort_by_key(|p| {
                let n = p.file_name().unwrap().to_string_lossy().to_lowercase();
                (!n.contains(".pt") as u8, n.contains("orig") as u8, n.len())
            });
            if let Some(v) = vtts.first() {
                let text = vtt_text(&std::fs::read_to_string(v).unwrap_or_default());
                for p in &vtts {
                    let _ = std::fs::remove_file(p);
                }
                if !text.is_empty() {
                    std::fs::write(dir.join("transcricao.txt"), format!("{}\n{}\n\n{text}", LF!("Fonte: {watch}", "Source: {watch}"), LF!("Título: {title}", "Title: {title}"))).map_err(|e| e.to_string())?;
                    map.insert("transcricao.txt".into(), json!(watch));
                    return Ok(title);
                }
            }
        }
    }
    // 2) a legenda pela própria página do vídeo
    let (st, _, _, b) = get(app, &watch, 30, 12 * 1024 * 1024).await?;
    if st != 200 {
        return Err(LF!("O YouTube respondeu {st}.", "YouTube answered {st}."));
    }
    let html = String::from_utf8_lossy(&b).to_string();
    let title = regex_lite::Regex::new(r#""title":"((?:[^"\\]|\\.)*)""#).unwrap().captures(&html).and_then(|c| serde_json::from_str::<String>(&format!("\"{}\"", &c[1])).ok()).unwrap_or_default();
    let tracks = html.find("\"captionTracks\":").and_then(|i| {
        let s = &html[i + 16..];
        let mut depth = 0i32;
        let mut in_str = false;
        let mut esc = false;
        for (j, ch) in s.char_indices() {
            if in_str {
                if esc { esc = false } else if ch == '\\' { esc = true } else if ch == '"' { in_str = false }
                continue;
            }
            match ch {
                '"' => in_str = true,
                '[' => depth += 1,
                ']' => {
                    depth -= 1;
                    if depth == 0 {
                        return serde_json::from_str::<Vec<Value>>(&s[..=j]).ok();
                    }
                }
                _ => {}
            }
        }
        None
    });
    let no_subs = || L!("Esse vídeo não tem legenda que o studio consiga ler. Instale o yt-dlp em Utilitários e tente de novo.", "This video has no captions the studio can read. Install yt-dlp in Utilities and try again.").to_string();
    let tracks = tracks.filter(|t| !t.is_empty()).ok_or_else(no_subs)?;
    let score = |t: &Value| {
        let l = t["languageCode"].as_str().unwrap_or("");
        let asr = t["kind"].as_str() == Some("asr");
        (if l.starts_with("pt") { 0 } else if l.starts_with("en") { 2 } else { 4 }) + asr as i32
    };
    let best = tracks.iter().min_by_key(|t| score(t)).ok_or_else(no_subs)?;
    let base = best["baseUrl"].as_str().ok_or_else(no_subs)?;
    let (st, _, _, b) = get(app, &format!("{base}&fmt=json3"), 30, 8 * 1024 * 1024).await?;
    let j: Value = serde_json::from_slice(&b).map_err(|_| no_subs())?;
    if st != 200 {
        return Err(no_subs());
    }
    let mut lines = vec![];
    for e in j["events"].as_array().into_iter().flatten() {
        let t: String = e["segs"].as_array().into_iter().flatten().filter_map(|s| s["utf8"].as_str()).collect::<String>().replace('\n', " ");
        let t = t.trim();
        if !t.is_empty() {
            lines.push(format!("[{}] {}", mmss(e["tStartMs"].as_u64().unwrap_or(0)), t));
        }
    }
    if lines.is_empty() {
        return Err(no_subs());
    }
    std::fs::write(dir.join("transcricao.txt"), format!("{}\n{}\n\n{}", LF!("Fonte: {watch}", "Source: {watch}"), LF!("Título: {title}", "Title: {title}"), lines.join("\n"))).map_err(|e| e.to_string())?;
    map.insert("transcricao.txt".into(), json!(watch));
    Ok(title)
}

/* ---------------------------------------------------------------- GitHub */

async fn github(app: &App, u: &str, dir: &Path, map: &mut Map<String, Value>) -> Result<String, String> {
    let url = reqwest::Url::parse(u).map_err(|e| e.to_string())?;
    let segs: Vec<String> = url.path_segments().map(|s| s.filter(|x| !x.is_empty()).map(str::to_string).collect()).unwrap_or_default();
    let (Some(owner), Some(repo)) = (segs.first(), segs.get(1)) else {
        return Err(L!("Use o link de um repositório (github.com/dono/repositorio).", "Use a repository link (github.com/owner/repo).").into());
    };
    let repo = repo.trim_end_matches(".git");
    let (rref, sub) = if matches!(segs.get(2).map(String::as_str), Some("tree" | "blob")) {
        (segs.get(3).cloned(), segs.get(4..).map(|s| s.join("/")).unwrap_or_default())
    } else {
        (None, String::new())
    };
    let zip_url = match &rref {
        Some(r) => format!("https://codeload.github.com/{owner}/{repo}/zip/{r}"),
        None => format!("https://api.github.com/repos/{owner}/{repo}/zipball"),
    };
    let (st, _, _, bytes) = get(app, &zip_url, 300, 300 * 1024 * 1024).await?;
    if st != 200 {
        return Err(LF!("O GitHub respondeu {st} (repositório privado ou inexistente?).", "GitHub answered {st} (private or missing repository?)."));
    }
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let blob_ref = rref.clone().unwrap_or_else(|| "HEAD".into());
    let mut total = 0u64;
    for i in 0..z.len() {
        let Ok(mut f) = z.by_index(i) else { continue };
        if f.is_dir() || f.size() > 3 * 1024 * 1024 {
            continue;
        }
        let Some(name) = f.enclosed_name() else { continue };
        // o zip tem uma pasta raiz (repo-ramo/): o caminho no repositório vem depois dela
        let rel: PathBuf = name.components().skip(1).collect();
        let rel_s = rel.to_string_lossy().replace('\\', "/");
        if rel_s.is_empty() || (!sub.is_empty() && !rel_s.starts_with(&format!("{sub}/")) && rel_s != sub) {
            continue;
        }
        if rel.components().any(|c| { let n = c.as_os_str().to_string_lossy(); crate::kb::skip_dir(&n) }) || !crate::kb::wanted_doc(&rel) {
            continue;
        }
        total += f.size();
        if total > 60 * 1024 * 1024 {
            break;
        }
        let out = dir.join(&rel);
        let _ = std::fs::create_dir_all(out.parent().unwrap_or(dir));
        let mut buf = vec![];
        if std::io::Read::read_to_end(&mut f, &mut buf).is_ok() && std::fs::write(&out, &buf).is_ok() {
            map.insert(rel_s.clone(), json!(format!("https://github.com/{owner}/{repo}/blob/{blob_ref}/{rel_s}")));
        }
    }
    if map.is_empty() {
        return Err(L!("Nenhum arquivo de texto, código ou documento nesse repositório.", "No text, code or document files in this repository.").into());
    }
    Ok(format!("{owner}/{repo}{}", if sub.is_empty() { String::new() } else { format!("/{sub}") }))
}

/* ---------------------------------------------------------------- site */

fn links(base: &reqwest::Url, html: &str) -> Vec<reqwest::Url> {
    let re = regex_lite::Regex::new(r#"(?i)<a\s[^>]*href\s*=\s*["']([^"'#]+)"#).unwrap();
    re.captures_iter(html).filter_map(|c| base.join(crate::web::entities(&c[1]).trim()).ok()).collect()
}

async fn site(app: &App, u: &str, dir: &Path, map: &mut Map<String, Value>) -> Result<String, String> {
    let start = reqwest::Url::parse(u).map_err(|_| L!("Link inválido.", "Invalid link."))?;
    let host = start.host_str().unwrap_or("").to_string();
    // só o que está "embaixo" do link (a pasta dele), para não sair baixando o site inteiro
    let prefix = {
        let p = start.path();
        if p.ends_with('/') { p.to_string() } else { p.rsplit_once('/').map(|(a, _)| format!("{a}/")).unwrap_or("/".into()) }
    };
    let deadline = std::time::Instant::now() + Duration::from_secs(240);
    let mut queue: VecDeque<(reqwest::Url, u32)> = VecDeque::from([(start.clone(), 0)]);
    let mut seen: HashSet<String> = HashSet::new();
    let mut title0 = String::new();
    let mut n = 0usize;
    let mut first_err = String::new();
    while let Some((url, depth)) = queue.pop_front() {
        if n >= MAX_PAGES || std::time::Instant::now() > deadline {
            break;
        }
        let mut key = url.clone();
        key.set_fragment(None);
        if !seen.insert(key.to_string()) {
            continue;
        }
        let path_l = url.path().to_lowercase();
        if [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".css", ".js", ".zip", ".rar", ".7z", ".exe", ".mp4", ".mp3", ".woff", ".woff2", ".ttf"].iter().any(|e| path_l.ends_with(e)) {
            continue;
        }
        let r = get(app, url.as_str(), 20, 25 * 1024 * 1024).await;
        let (st, ct, fin, body) = match r {
            Ok(x) => x,
            Err(e) => {
                if first_err.is_empty() {
                    first_err = e;
                }
                continue;
            }
        };
        if st != 200 {
            if first_err.is_empty() {
                first_err = LF!("{url} respondeu {st}.", "{url} answered {st}.");
            }
            continue;
        }
        n += 1;
        if ct.contains("pdf") || body.starts_with(b"%PDF") {
            let name = format!("doc-{n:02}.pdf");
            let _ = std::fs::write(dir.join(&name), &body);
            map.insert(name, json!(fin));
            continue;
        }
        if !ct.contains("html") && !ct.contains("text") {
            continue;
        }
        let html = String::from_utf8_lossy(&body).to_string();
        let (title, text) = crate::web::html_text(&html);
        if title0.is_empty() {
            title0 = title.clone();
        }
        if text.trim().len() > 80 {
            let name = format!("pagina-{n:02}.md");
            let _ = std::fs::write(dir.join(&name), format!("{}\n{}\n\n{text}", LF!("Fonte: {fin}", "Source: {fin}"), LF!("Título: {title}", "Title: {title}")));
            map.insert(name, json!(fin));
        }
        if depth >= 3 {
            continue;
        }
        let base = reqwest::Url::parse(&fin).unwrap_or(url.clone());
        for l in links(&base, &html) {
            let pdf = l.path().to_lowercase().ends_with(".pdf");
            if l.host_str() == Some(host.as_str()) && (l.path().starts_with(&prefix) || pdf) && matches!(l.scheme(), "http" | "https") {
                queue.push_back((l, depth + 1));
            }
        }
    }
    if map.is_empty() {
        return Err(if first_err.is_empty() { L!("Não achei texto nessa página.", "Found no text on this page.").into() } else { first_err });
    }
    Ok(if title0.is_empty() { host } else { title0 })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_do_youtube() {
        assert_eq!(yt_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(yt_id("https://youtu.be/dQw4w9WgXcQ?si=x").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(yt_id("https://youtube.com/shorts/abcdefghijk").as_deref(), Some("abcdefghijk"));
        assert_eq!(yt_id("https://www.youtube.com/@canal"), None);
    }

    #[test]
    fn legenda_automatica_sem_repeticao() {
        let v = "WEBVTT\nKind: captions\n\n00:00:01.000 --> 00:00:03.000\nolá pessoal\n\n00:00:03.000 --> 00:00:05.000\nolá pessoal\nhoje vamos <c>falar</c>\n\n00:01:05.500 --> 00:01:07.000\nde Rust\n";
        assert_eq!(vtt_text(v), "[00:01] olá pessoal\n[00:03] hoje vamos falar\n[01:05] de Rust");
    }
}
