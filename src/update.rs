//! Atualizações pelas releases do GitHub.
//! - Interface: ui.zip é extraído em dados\ui e passa a ser servido no lugar da embutida (sem reiniciar).
//! - Executável: llama-studio.exe novo substitui o atual e o programa reinicia.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::app::App;

pub const REPO: &str = "locdown2311/llama-studio";

/// Versão do executável (o CI grava a do tag em STUDIO_VERSION).
pub fn exe_version() -> &'static str {
    option_env!("STUDIO_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"))
}

fn parse(v: &str) -> (u64, u64, u64) {
    let mut it = v.trim().trim_start_matches('v').split(|c: char| c == '.' || c == '-').map(|x| x.parse::<u64>().unwrap_or(0));
    (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}

pub fn newer(a: &str, b: &str) -> bool {
    parse(a) > parse(b)
}

pub fn ui_dir(app: &App) -> PathBuf {
    app.root.join("ui")
}

/// Versão da interface baixada (se houver e for compatível com este executável).
pub fn ui_override_version(app: &App) -> Option<String> {
    let v: Value = crate::app::read_json(&ui_dir(app).join("version.json"))?;
    let ver = v["version"].as_str()?.to_string();
    let min = v["minExe"].as_str().unwrap_or("0.0.0");
    if newer(min, exe_version()) {
        return None; // precisa de um executável mais novo
    }
    if !newer(&ver, exe_version()) && ver != exe_version() {
        return None; // mais velha que a embutida
    }
    Some(ver)
}

pub fn ui_version(app: &App) -> String {
    ui_override_version(app).unwrap_or_else(|| exe_version().to_string())
}

static CACHE: Mutex<Option<(Instant, Value)>> = Mutex::new(None);

async fn latest_release(app: &App) -> Result<Value, String> {
    if let Some((t, v)) = CACHE.lock().unwrap().as_ref() {
        if t.elapsed() < Duration::from_secs(1800) {
            return Ok(v.clone());
        }
    }
    let resp = app
        .web
        .get(format!("https://api.github.com/repos/{REPO}/releases/latest"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "llama-studio")
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("Sem conexão com o GitHub: {e}"))?;
    if resp.status().as_u16() == 404 {
        return Err("Ainda não há nenhuma versão publicada.".into());
    }
    if !resp.status().is_success() {
        return Err(format!("GitHub respondeu {}", resp.status()));
    }
    let v: Value = serde_json::from_slice(&resp.bytes().await.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    *CACHE.lock().unwrap() = Some((Instant::now(), v.clone()));
    Ok(v)
}

fn asset_url(rel: &Value, name: &str) -> Option<String> {
    rel["assets"].as_array()?.iter().find(|a| a["name"] == name).and_then(|a| a["browser_download_url"].as_str()).map(str::to_string)
}

pub async fn check(app: &App, force: bool) -> Value {
    if force {
        *CACHE.lock().unwrap() = None;
    }
    let base = json!({"exe": exe_version(), "ui": ui_version(app), "repo": REPO});
    match latest_release(app).await {
        Ok(rel) => {
            let latest = rel["tag_name"].as_str().unwrap_or("").trim_start_matches('v').to_string();
            let mut v = base;
            v["latest"] = json!(latest);
            v["notes"] = rel["body"].clone();
            v["url"] = rel["html_url"].clone();
            v["published"] = rel["published_at"].clone();
            v["exeUpdate"] = json!(newer(&latest, exe_version()) && asset_url(&rel, "llama-studio.exe").is_some());
            v["uiUpdate"] = json!(newer(&latest, &ui_version(app)) && asset_url(&rel, "ui.zip").is_some());
            v
        }
        Err(e) => {
            let mut v = base;
            v["error"] = json!(e);
            v
        }
    }
}

async fn download(app: &App, url: &str) -> Result<Vec<u8>, String> {
    let r = app.web.get(url).header("User-Agent", "llama-studio").timeout(Duration::from_secs(600)).send().await.map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("Download falhou: {}", r.status()));
    }
    Ok(r.bytes().await.map_err(|e| e.to_string())?.to_vec())
}

/// Baixa e aplica a interface nova (não precisa reiniciar).
pub async fn apply_ui(app: &App) -> Result<String, String> {
    let rel = latest_release(app).await?;
    let url = asset_url(&rel, "ui.zip").ok_or("Esta versão não tem ui.zip.")?;
    let bytes = download(app, &url).await?;
    let dir = ui_dir(app);
    let tmp = app.root.join("ui.novo");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    zip::ZipArchive::new(std::io::Cursor::new(bytes)).and_then(|mut z| z.extract(&tmp)).map_err(|e| format!("ui.zip inválido: {e}"))?;
    // aceita o zip com ou sem uma pasta "ui" dentro
    let src = if tmp.join("index.html").is_file() { tmp.clone() } else { tmp.join("ui") };
    if !src.join("index.html").is_file() {
        return Err("ui.zip não tem index.html.".into());
    }
    let v: Value = crate::app::read_json(&src.join("version.json")).unwrap_or(json!({}));
    if let Some(min) = v["minExe"].as_str() {
        if newer(min, exe_version()) {
            let _ = std::fs::remove_dir_all(&tmp);
            return Err(format!("Esta interface precisa do executável {min} ou mais novo. Atualize o programa inteiro."));
        }
    }
    let old = app.root.join("ui.antigo");
    let _ = std::fs::remove_dir_all(&old);
    if dir.exists() {
        std::fs::rename(&dir, &old).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&src, &dir).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&tmp);
    let _ = std::fs::remove_dir_all(&old);
    Ok(v["version"].as_str().unwrap_or("").to_string())
}

/// Volta para a interface embutida no executável.
pub fn reset_ui(app: &App) {
    let _ = std::fs::remove_dir_all(ui_dir(app));
}

/// Baixa o executável novo, troca pelo atual e reinicia.
pub async fn apply_exe(app: &App) -> Result<(), String> {
    let rel = latest_release(app).await?;
    let url = asset_url(&rel, "llama-studio.exe").ok_or("Esta versão não tem llama-studio.exe.")?;
    let bytes = download(app, &url).await?;
    if bytes.len() < 1_000_000 || &bytes[..2] != b"MZ" {
        return Err("O arquivo baixado não parece um executável válido.".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().unwrap_or(Path::new("."));
    let new = dir.join("llama-studio.novo.exe");
    let old = dir.join("llama-studio.antigo.exe");
    std::fs::write(&new, &bytes).map_err(|e| format!("Não consegui gravar o novo executável: {e}"))?;
    let _ = std::fs::remove_file(&old);
    // o Windows deixa renomear um programa em execução, mas não apagar
    std::fs::rename(&exe, &old).map_err(|e| format!("Não consegui trocar o executável: {e}"))?;
    if let Err(e) = std::fs::rename(&new, &exe) {
        let _ = std::fs::rename(&old, &exe);
        return Err(format!("Não consegui trocar o executável: {e}"));
    }
    // a interface baixada antes pode ser mais velha que a do novo executável
    if ui_override_version(app).is_some_and(|v| !newer(&v, rel["tag_name"].as_str().unwrap_or("").trim_start_matches('v'))) {
        reset_ui(app);
    }
    let mut c = std::process::Command::new(&exe);
    c.arg("--apos-atualizar");
    if app.llama.is_running() {
        c.arg("--iniciar-servidor");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // fora do job object deste processo, senão morreria junto
        c.creation_flags(crate::DETACHED_FLAGS);
    }
    c.spawn().map_err(|e| format!("Não consegui abrir a versão nova: {e}"))?;
    Ok(())
}

/// Remove sobras de uma atualização anterior.
pub fn cleanup() {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let _ = std::fs::remove_file(dir.join("llama-studio.antigo.exe"));
            let _ = std::fs::remove_file(dir.join("llama-studio.novo.exe"));
        }
    }
}
