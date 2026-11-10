//! Backup dos dados do studio numa pasta (a do Google Drive para computador, que sobe sozinha para a nuvem,
//! ou qualquer outra). Um .zip com as conversas, personalidades, projetos, prompts, configurações, skills e
//! conectores; ficam de fora o que é grande e se refaz (vídeos, navegador, Whisper, pontos de restauração).
//! As chaves de API e os segredos dos conectores só entram se a pessoa pedir.

use crate::app::App;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

const PREFIX: &str = "llama-studio-backup-";
/// Pastas de dados/ que não entram (grandes ou refeitas sozinhas).
const SKIP_DIRS: &[&str] = &["webview", "navegador", "whisper", "videos", "pontos", "backups", "cache", "logs", "tmp", "bin", "bins", "engines", "modelos"];
const MAX_FILE: u64 = 50 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub folder: String,
    /// de quantas em quantas horas (0 = só à mão)
    pub every_hours: u32,
    /// quantos backups manter na pasta
    pub keep: u32,
    pub include_keys: bool,
    /// último backup (segundos desde 1970)
    pub last: u64,
    pub last_error: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { folder: String::new(), every_hours: 24, keep: 10, include_keys: false, last: 0, last_error: String::new() }
    }
}

fn file(app: &App) -> PathBuf {
    app.root.join("backup.json")
}

pub fn settings(app: &App) -> Settings {
    std::fs::read_to_string(file(app)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(app: &App, s: &Settings) {
    if let Ok(t) = serde_json::to_string_pretty(s) {
        let _ = std::fs::write(file(app), t);
    }
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Pastas do Google Drive para computador que existem neste PC.
pub fn detect() -> Vec<String> {
    let mut out = vec![];
    let home = crate::app::home_dir();
    let mut cands: Vec<PathBuf> = vec![home.join("Google Drive"), home.join("Google Drive").join("Meu Drive"), home.join("Google Drive").join("My Drive"), home.join("GoogleDrive")];
    if cfg!(windows) {
        for l in b'D'..=b'Z' {
            let root = PathBuf::from(format!("{}:\\", l as char));
            cands.push(root.join("Meu Drive"));
            cands.push(root.join("My Drive"));
        }
    }
    for c in cands {
        if c.is_dir() {
            out.push(c.join("Llama Studio").to_string_lossy().to_string());
        }
    }
    out.dedup();
    out
}

pub fn list(s: &Settings) -> Vec<Value> {
    let mut v: Vec<(u64, Value)> = std::fs::read_dir(&s.folder)
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    if !name.starts_with(PREFIX) || !name.ends_with(".zip") {
                        return None;
                    }
                    let md = e.metadata().ok()?;
                    let t = md.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
                    Some((t, json!({ "file": name, "size": md.len(), "mtime": t })))
                })
                .collect()
        })
        .unwrap_or_default();
    v.sort_by(|a, b| b.0.cmp(&a.0));
    v.into_iter().map(|(_, x)| x).collect()
}

pub fn status(app: &App) -> Value {
    let s = settings(app);
    json!({ "settings": s, "backups": if s.folder.is_empty() { vec![] } else { list(&s) }, "detected": detect() })
}

pub fn set(app: &App, v: &Value) -> Value {
    let mut s = settings(app);
    if let Some(f) = v["folder"].as_str() {
        s.folder = f.trim().to_string();
    }
    if let Some(h) = v["everyHours"].as_u64() {
        s.every_hours = h.min(24 * 30) as u32;
    }
    if let Some(k) = v["keep"].as_u64() {
        s.keep = k.clamp(1, 100) as u32;
    }
    if let Some(b) = v["includeKeys"].as_bool() {
        s.include_keys = b;
    }
    save(app, &s);
    status(app)
}

/// Os arquivos de dados/ que entram (caminho relativo, com "/").
fn files_of(root: &Path) -> Vec<(String, PathBuf)> {
    let mut out = vec![];
    fn walk(root: &Path, dir: &Path, depth: usize, out: &mut Vec<(String, PathBuf)>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() || name.starts_with('.') && name.ends_with(".tmp") {
                continue;
            }
            if ft.is_dir() {
                if depth == 0 && SKIP_DIRS.contains(&name.to_lowercase().as_str()) || name == "node_modules" || name == ".git" {
                    continue;
                }
                if depth < 8 {
                    walk(root, &p, depth + 1, out);
                }
            } else if !name.ends_with(".log") && e.metadata().is_ok_and(|m| m.len() <= MAX_FILE) {
                let rel = p.strip_prefix(root).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
                if !rel.is_empty() {
                    out.push((rel, p));
                }
            }
        }
    }
    walk(root, root, 0, &mut out);
    out.sort();
    out
}

/// Tira as chaves das APIs (config.json) e os segredos dos conectores (env e headers do mcp.json).
fn strip_secrets(rel: &str, bytes: Vec<u8>) -> Vec<u8> {
    let Ok(mut v) = serde_json::from_slice::<Value>(&bytes) else { return bytes };
    match rel {
        "config.json" => {
            for p in v["apiProviders"].as_array_mut().into_iter().flatten() {
                p["key"] = json!("");
            }
            for k in ["apiKey", "hfToken"] {
                if v.get(k).is_some() {
                    v[k] = json!("");
                }
            }
        }
        "mcp.json" => {
            for (_, srv) in v["mcpServers"].as_object_mut().into_iter().flatten() {
                for k in ["env", "headers"] {
                    if let Some(o) = srv[k].as_object_mut() {
                        for (_, x) in o.iter_mut() {
                            *x = json!("");
                        }
                    }
                }
            }
        }
        _ => return bytes,
    }
    serde_json::to_vec_pretty(&v).unwrap_or(bytes)
}

fn stamp() -> String {
    crate::videos::chrono_stamp()
}

/// Faz um backup agora. Devolve o arquivo criado.
pub fn run(app: &App) -> Result<Value, String> {
    let mut s = settings(app);
    if s.folder.is_empty() {
        return Err(L!("Escolha a pasta do backup.", "Choose the backup folder.").into());
    }
    let r = (|| -> Result<Value, String> {
        let dir = PathBuf::from(&s.folder);
        std::fs::create_dir_all(&dir).map_err(|e| LF!("Não consegui criar a pasta {}: {e}", "Could not create the folder {}: {e}", dir.display()))?;
        let name = format!("{PREFIX}{}.zip", stamp());
        let tmp = dir.join(format!(".{name}.part"));
        let f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(f);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let files = files_of(&app.root);
        for (rel, p) in &files {
            let Ok(mut bytes) = std::fs::read(p) else { continue };
            if !s.include_keys {
                bytes = strip_secrets(rel, bytes);
            }
            zip.start_file(rel.as_str(), opts).map_err(|e| e.to_string())?;
            zip.write_all(&bytes).map_err(|e| e.to_string())?;
        }
        let meta = json!({ "app": "llama-studio", "version": env!("CARGO_PKG_VERSION"), "created": now(), "keys": s.include_keys, "files": files.len() });
        zip.start_file("backup-info.json", opts).map_err(|e| e.to_string())?;
        zip.write_all(meta.to_string().as_bytes()).map_err(|e| e.to_string())?;
        zip.finish().map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, dir.join(&name)).map_err(|e| e.to_string())?;
        // só os mais novos ficam
        for old in list(&s).iter().skip(s.keep.max(1) as usize) {
            if let Some(n) = old["file"].as_str() {
                let _ = std::fs::remove_file(dir.join(n));
            }
        }
        Ok(json!({ "file": name, "files": files.len() }))
    })();
    match &r {
        Ok(_) => {
            s.last = now();
            s.last_error.clear();
        }
        Err(e) => s.last_error = e.clone(),
    }
    save(app, &s);
    r
}

/// Restaura um backup da pasta: antes guarda o estado atual (dados/backups/), depois põe os arquivos no
/// lugar. Chaves que o backup não tem (salvo sem chaves) continuam as atuais. As chaves da interface ganham a
/// hora de agora, para valerem sobre o que o navegador guardou.
pub async fn restore(app: &App, name: &str) -> Result<Value, String> {
    let s = settings(app);
    if !name.starts_with(PREFIX) || !name.ends_with(".zip") || name.contains(['/', '\\']) {
        return Err(L!("Arquivo de backup inválido.", "Invalid backup file.").into());
    }
    let bytes = std::fs::read(PathBuf::from(&s.folder).join(name)).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| LF!("Backup corrompido: {e}", "Corrupted backup: {e}"))?;
    // cópia de segurança do estado atual (fora da pasta do Drive)
    let safety = app.root.join("backups");
    let _ = std::fs::create_dir_all(&safety);
    {
        let f = std::fs::File::create(safety.join(format!("antes-de-restaurar-{}.zip", stamp()))).map_err(|e| e.to_string())?;
        let mut z = zip::ZipWriter::new(f);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (rel, p) in files_of(&app.root) {
            if let Ok(b) = std::fs::read(&p) {
                let _ = z.start_file(rel.as_str(), opts);
                let _ = z.write_all(&b);
            }
        }
        let _ = z.finish();
    }
    let t_now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) + 5000;
    let mut n = 0;
    let mut cfg_text: Option<Vec<u8>> = None;
    let mut mcp_text: Option<Vec<u8>> = None;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        if f.is_dir() {
            continue;
        }
        let Some(rel) = f.enclosed_name() else { continue };
        let rel_s = rel.to_string_lossy().replace('\\', "/");
        if rel_s == "backup-info.json" || SKIP_DIRS.iter().any(|d| rel_s.to_lowercase().starts_with(&format!("{d}/"))) {
            continue;
        }
        let mut buf = vec![];
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        match rel_s.as_str() {
            "config.json" => cfg_text = Some(buf),
            "mcp.json" => mcp_text = Some(buf),
            "backup.json" => {}
            _ => {
                if rel_s.starts_with("ui/") && rel_s.ends_with(".json") {
                    if let Ok(mut v) = serde_json::from_slice::<Value>(&buf) {
                        v["t"] = json!(t_now);
                        buf = v.to_string().into_bytes();
                    }
                }
                let to = app.root.join(&rel);
                if let Some(d) = to.parent() {
                    std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
                }
                std::fs::write(&to, buf).map_err(|e| e.to_string())?;
                n += 1;
            }
        }
    }
    if let Some(b) = cfg_text {
        if let Ok(mut c) = serde_json::from_slice::<crate::app::Config>(&b) {
            let cur = app.cfg();
            for p in c.api_providers.iter_mut() {
                if p.key.is_empty() {
                    if let Some(old) = cur.api_providers.iter().find(|o| o.id == p.id) {
                        p.key = old.key.clone();
                    }
                }
            }
            if c.hf_token.is_empty() {
                c.hf_token = cur.hf_token.clone();
            }
            *app.config.write().unwrap() = c;
            app.save_config();
            n += 1;
        }
    }
    if let Some(b) = mcp_text {
        if let Ok(mut v) = serde_json::from_slice::<Value>(&b) {
            let cur: Value = std::fs::read_to_string(app.mcp_file()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(json!({}));
            for (name, srv) in v["mcpServers"].as_object_mut().into_iter().flatten() {
                for k in ["env", "headers"] {
                    if let Some(o) = srv[k].as_object_mut() {
                        for (key, x) in o.iter_mut() {
                            if x.as_str() == Some("") {
                                if let Some(old) = cur["mcpServers"][name.as_str()][k][key.as_str()].as_str() {
                                    *x = json!(old);
                                }
                            }
                        }
                    }
                }
            }
            if let Ok(t) = serde_json::to_string_pretty(&v) {
                let _ = std::fs::write(app.mcp_file(), t);
                app.mcp.sync(&app.http, &app.mcp_file()).await;
                n += 1;
            }
        }
    }
    Ok(json!({ "restored": n }))
}

/// Backup automático: confere a cada 10 minutos se já passou o intervalo.
pub async fn scheduler(app: std::sync::Arc<App>) {
    tokio::time::sleep(Duration::from_secs(90)).await;
    loop {
        let s = settings(&app);
        if !s.folder.is_empty() && s.every_hours > 0 && now().saturating_sub(s.last) >= s.every_hours as u64 * 3600 {
            let a = app.clone();
            let _ = tokio::task::spawn_blocking(move || run(&a)).await;
        }
        tokio::time::sleep(Duration::from_secs(600)).await;
    }
}

#[cfg(test)]
mod t {
    use super::*;

    #[test]
    fn tira_segredos() {
        let c = br#"{"apiProviders":[{"id":"a","key":"sk-123","model":"m"}],"hfToken":"hf_x","port":8080}"#.to_vec();
        let v: Value = serde_json::from_slice(&strip_secrets("config.json", c)).unwrap();
        assert_eq!(v["apiProviders"][0]["key"], "");
        assert_eq!(v["apiProviders"][0]["model"], "m");
        assert_eq!(v["hfToken"], "");
        assert_eq!(v["port"], 8080);
        let m = br#"{"mcpServers":{"x":{"command":"npx","env":{"TOKEN":"abc"},"headers":{"Authorization":"Bearer y"}}}}"#.to_vec();
        let v: Value = serde_json::from_slice(&strip_secrets("mcp.json", m)).unwrap();
        assert_eq!(v["mcpServers"]["x"]["env"]["TOKEN"], "");
        assert_eq!(v["mcpServers"]["x"]["headers"]["Authorization"], "");
        assert_eq!(v["mcpServers"]["x"]["command"], "npx");
    }

    #[test]
    fn pula_pastas_grandes() {
        let d = std::env::temp_dir().join(format!("bk-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        for p in ["ui/convs.json", "skills/a/SKILL.md", "videos/p/x.mp4", "webview/x", "config.json", "app.log"] {
            let f = d.join(p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, "x").unwrap();
        }
        let got: Vec<String> = files_of(&d).into_iter().map(|(r, _)| r).collect();
        assert_eq!(got, vec!["config.json", "skills/a/SKILL.md", "ui/convs.json"]);
        let _ = std::fs::remove_dir_all(&d);
    }
}
