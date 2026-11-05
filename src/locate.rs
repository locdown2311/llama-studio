//! Acha no disco um arquivo que foi solto no navegador (só temos nome, tamanho e data).
//! Na janela própria isso não é necessário: o caminho vem direto do sistema.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, UNIX_EPOCH};

use crate::app::{home_dir, App};

fn roots(app: &App) -> Vec<PathBuf> {
    let h = home_dir();
    let cfg = app.cfg();
    let mut c: Vec<PathBuf> = vec![app.workspace()];
    for s in ["Desktop", "Downloads", "Documents", "Pictures", "Videos", "Music", "OneDrive", "OneDrive/Desktop", "OneDrive/Documents", "OneDrive/Área de Trabalho", "OneDrive/Documentos"] {
        c.push(h.join(s));
    }
    c.extend(cfg.recent_dirs.iter().map(PathBuf::from));
    c.push(h);
    let mut seen = std::collections::HashSet::new();
    c.into_iter().filter(|p| p.is_dir() && seen.insert(p.to_string_lossy().to_lowercase())).collect()
}

#[cfg(windows)]
async fn windows_search(name: &str) -> Vec<String> {
    let q = name.replace('\'', "''").replace('\'', "''");
    let ps = format!(
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; try {{ $c=New-Object -ComObject ADODB.Connection; $c.Open(\"Provider=Search.CollatorDSO;Extended Properties='Application=Windows';\"); $rs=$c.Execute(\"SELECT TOP 50 System.ItemPathDisplay FROM SYSTEMINDEX WHERE System.FileName = '{q}'\"); while(-not $rs.EOF){{ $rs.Fields.Item('System.ItemPathDisplay').Value; $rs.MoveNext() }}; $rs.Close(); $c.Close() }} catch {{}}"
    );
    let mut cmd = tokio::process::Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &ps]).creation_flags(crate::CREATE_NO_WINDOW).kill_on_drop(true);
    match tokio::time::timeout(Duration::from_secs(8), cmd.output()).await {
        Ok(Ok(o)) => String::from_utf8_lossy(&o.stdout).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect(),
        _ => vec![],
    }
}

#[cfg(not(windows))]
async fn windows_search(_: &str) -> Vec<String> {
    vec![]
}

fn scan(roots: Vec<PathBuf>, name: String, is_dir: bool, home: PathBuf) -> Vec<String> {
    let deadline = Instant::now() + Duration::from_secs(6);
    let lname = name.to_lowercase();
    let mut found = vec![];
    let mut count = 0usize;
    for root in roots {
        if Instant::now() > deadline {
            break;
        }
        let depth = if root == home { 3 } else { 6 };
        let walker = walkdir::WalkDir::new(&root).min_depth(1).max_depth(depth).into_iter().filter_entry(|e| {
            let n = e.file_name().to_string_lossy();
            !(e.file_type().is_dir() && (n.starts_with('.') || n == "node_modules" || n == "AppData" || n == ".git" || n.starts_with('$')))
        });
        for e in walker.flatten() {
            count += 1;
            if count > 120_000 || Instant::now() > deadline || found.len() >= 30 {
                break;
            }
            if e.file_type().is_dir() == is_dir && e.file_name().to_string_lossy().to_lowercase() == lname {
                found.push(e.path().to_string_lossy().into_owned());
            }
        }
    }
    found
}

pub async fn locate(app: &App, name: &str, size: Option<u64>, last_modified: Option<f64>, is_dir: bool) -> Value {
    let t0 = Instant::now();
    let roots = roots(app);
    let (n2, home) = (name.to_string(), home_dir());
    let scan_task = tokio::task::spawn_blocking(move || scan(roots, n2, is_dir, home));
    let indexed = windows_search(name).await;
    let scanned = scan_task.await.unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    let mut matches = vec![];
    for p in indexed.into_iter().chain(scanned) {
        if !seen.insert(p.to_lowercase()) {
            continue;
        }
        let Ok(md) = std::fs::metadata(&p) else { continue };
        if md.is_dir() != is_dir {
            continue;
        }
        let mtime = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as f64).unwrap_or(0.0);
        let mut score: i32 = 1;
        if !is_dir {
            match size {
                Some(s) if s == md.len() => score += 2,
                Some(_) => score -= 1,
                None => {}
            }
            if let Some(lm) = last_modified {
                if (mtime - lm).abs() < 2500.0 {
                    score += 2;
                }
            }
        }
        if score > 0 {
            matches.push(json!({"path": p, "size": md.len(), "mtime": mtime, "exact": is_dir || score >= 5, "score": score}));
        }
    }
    matches.sort_by_key(|m| -m["score"].as_i64().unwrap_or(0));
    matches.truncate(20);
    json!({"matches": matches, "ms": t0.elapsed().as_millis() as u64})
}

pub fn remember_dir(app: &App, p: &Path) {
    let dir = if p.is_dir() { p.parent().unwrap_or(p) } else { p.parent().unwrap_or(p) }.to_string_lossy().into_owned();
    {
        let mut c = app.config.write().unwrap();
        c.recent_dirs.retain(|d| !d.eq_ignore_ascii_case(&dir));
        c.recent_dirs.insert(0, dir);
        c.recent_dirs.truncate(15);
    }
    app.save_config();
}
