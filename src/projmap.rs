//! Pré-leitura da pasta de trabalho: um mapa curto (pastas, tipos de arquivo, arquivos-chave
//! e o começo do README) montado sem o modelo, em milissegundos. Fica em cache em
//! dados/mapas/<hash>.json e entra no contexto das conversas daquela pasta.
//! O resumo opcional escrito pelo modelo é guardado junto e só muda quando o usuário pede.

use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::app::App;

const SKIP: &[&str] = &[".git", "node_modules", "target", "dist", "build", "out", "__pycache__", ".venv", "venv", "env", ".idea", ".vs", ".vscode", "bin", "obj", ".next", ".cache", "coverage", "vendor", ".gradle", "pkg"];
const KEY_FILES: &[&str] = &["readme.md", "readme.txt", "readme", "package.json", "cargo.toml", "pyproject.toml", "requirements.txt", "go.mod", "cmakelists.txt", "makefile", "pom.xml", "build.gradle", "composer.json", "gemfile", "dockerfile", "docker-compose.yml"];
const MAX_FILES: usize = 20000;
const MAX_CHARS: usize = 3200;

fn hash(s: &str) -> String {
    let mut h: u64 = 1469598103934665603;
    for b in s.to_lowercase().bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    format!("{h:016x}")
}

fn file(app: &App, ws: &Path) -> PathBuf {
    app.root.join("mapas").join(format!("{}.json", hash(&ws.to_string_lossy())))
}

pub fn load(app: &App, ws: &Path) -> Option<Value> {
    std::fs::read(file(app, ws)).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

fn save(app: &App, ws: &Path, v: &Value) {
    let f = file(app, ws);
    if let Some(d) = f.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    let _ = std::fs::write(f, serde_json::to_vec_pretty(v).unwrap_or_default());
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Monta o mapa (sem o modelo). `keep_summary` preserva o resumo anterior.
pub fn build(app: &App, ws: &Path) -> Value {
    let t0 = std::time::Instant::now();
    let mut total = 0usize;
    let mut bytes = 0u64;
    let mut exts: BTreeMap<String, usize> = BTreeMap::new();
    // pasta de primeiro nível -> (arquivos, extensões)
    let mut tops: BTreeMap<String, (usize, BTreeMap<String, usize>)> = BTreeMap::new();
    let mut root_files: Vec<String> = vec![];
    let mut keys: Vec<PathBuf> = vec![];
    let mut cut = false;
    let walker = walkdir::WalkDir::new(ws).max_depth(6).into_iter().filter_entry(|e| {
        let n = e.file_name().to_string_lossy();
        e.depth() == 0 || !(e.file_type().is_dir() && (SKIP.contains(&n.to_lowercase().as_str()) || n.starts_with('.')))
    });
    for e in walker.flatten() {
        if !e.file_type().is_file() {
            continue;
        }
        total += 1;
        if total > MAX_FILES {
            cut = true;
            break;
        }
        bytes += e.metadata().map(|m| m.len()).unwrap_or(0);
        let name = e.file_name().to_string_lossy().to_string();
        let ext = Path::new(&name).extension().map(|x| format!(".{}", x.to_string_lossy().to_lowercase())).unwrap_or_else(|| "(sem extensão)".into());
        *exts.entry(ext.clone()).or_default() += 1;
        let rel = e.path().strip_prefix(ws).unwrap_or(e.path());
        let mut comps = rel.components();
        let first = comps.next().map(|c| c.as_os_str().to_string_lossy().to_string()).unwrap_or_default();
        if e.depth() == 1 {
            root_files.push(name.clone());
        } else {
            let t = tops.entry(first).or_default();
            t.0 += 1;
            *t.1.entry(ext).or_default() += 1;
        }
        if e.depth() <= 2 && KEY_FILES.contains(&name.to_lowercase().as_str()) && keys.len() < 8 {
            keys.push(e.path().to_path_buf());
        }
    }
    let top_ext = |m: &BTreeMap<String, usize>, n: usize| {
        let mut v: Vec<(&String, &usize)> = m.iter().collect();
        v.sort_by(|a, b| b.1.cmp(a.1));
        v.into_iter().take(n).map(|(e, c)| format!("{e} {c}")).collect::<Vec<_>>().join(", ")
    };
    let mut out = String::new();
    out.push_str(&format!("{}{} arquivos ({}). Tipos: {}.\n", if cut { "mais de " } else { "" }, total.min(MAX_FILES), fmt_size(bytes), top_ext(&exts, 8)));
    let mut dirs: Vec<(&String, &(usize, BTreeMap<String, usize>))> = tops.iter().collect();
    dirs.sort_by(|a, b| b.1 .0.cmp(&a.1 .0));
    if !dirs.is_empty() {
        out.push_str("Pastas:\n");
        for (d, (n, e)) in dirs.iter().take(14) {
            out.push_str(&format!("- {d}/ ({n}: {})\n", top_ext(e, 3)));
        }
        if dirs.len() > 14 {
            out.push_str(&format!("- ... e mais {} pastas\n", dirs.len() - 14));
        }
    }
    if !root_files.is_empty() {
        root_files.sort();
        let shown: Vec<&String> = root_files.iter().take(20).collect();
        out.push_str(&format!("Na raiz: {}{}\n", shown.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "), if root_files.len() > 20 { ", ..." } else { "" }));
    }
    for k in &keys {
        let rel = k.strip_prefix(ws).unwrap_or(k).to_string_lossy().replace('\\', "/");
        let Ok(text) = std::fs::read_to_string(k) else { continue };
        let lim = if rel.to_lowercase().starts_with("readme") { 700 } else { 300 };
        let lines: Vec<&str> = text.lines().map(str::trim_end).filter(|l| !l.trim().is_empty() && !l.trim_start().starts_with("<img") && !l.contains("](http")).take(14).collect();
        let mut s: String = lines.join("\n");
        if s.chars().count() > lim {
            s = s.chars().take(lim).collect::<String>() + " [...]";
        }
        out.push_str(&format!("\n{rel}:\n{s}\n"));
        if out.chars().count() > MAX_CHARS {
            break;
        }
    }
    if out.chars().count() > MAX_CHARS {
        out = out.chars().take(MAX_CHARS).collect::<String>() + "\n[...]";
    }
    let prev = load(app, ws);
    let v = json!({
        "ws": ws, "built": now(), "ms": t0.elapsed().as_millis() as u64, "files": total, "text": out,
        "summary": prev.as_ref().and_then(|p| p.get("summary").cloned()).unwrap_or(Value::Null),
        "summaryAt": prev.as_ref().and_then(|p| p.get("summaryAt").cloned()).unwrap_or(Value::Null),
    });
    save(app, ws, &v);
    v
}

pub fn set_summary(app: &App, ws: &Path, summary: &str) -> Value {
    let mut v = load(app, ws).unwrap_or_else(|| build(app, ws));
    v["summary"] = if summary.trim().is_empty() { Value::Null } else { json!(summary.trim()) };
    v["summaryAt"] = json!(now());
    save(app, ws, &v);
    v
}

/// Mapa pronto para uso: monta na primeira vez; depois só com `refresh` ou se tiver mais de 7 dias.
pub fn get(app: &App, ws: &Path, refresh: bool) -> Value {
    match load(app, ws) {
        Some(v) if !refresh && now().saturating_sub(v["built"].as_u64().unwrap_or(0)) < 7 * 86_400_000 => v,
        _ => build(app, ws),
    }
}

/// Texto para o contexto do modelo (vazio se não houver mapa ainda).
pub fn context_text(app: &App, ws: &Path) -> String {
    let Some(v) = load(app, ws) else { return String::new() };
    let mut s = String::from("Mapa da pasta de trabalho (pré-leitura automática; pode estar um pouco desatualizado):\n");
    if let Some(sum) = v["summary"].as_str() {
        s.push_str(sum);
        s.push_str("\n\n");
    }
    s.push_str(v["text"].as_str().unwrap_or(""));
    s
}

fn fmt_size(n: u64) -> String {
    let n = n as f64;
    if n >= 1e9 {
        format!("{:.1} GB", n / 1e9)
    } else if n >= 1e6 {
        format!("{:.1} MB", n / 1e6)
    } else {
        format!("{:.0} KB", n / 1e3)
    }
}

// ---------------------------------------------------------------- caderno de investigação

fn nb_file(app: &App, key: &str) -> PathBuf {
    let k: String = key.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(80).collect();
    app.root.join("cadernos").join(format!("{}.json", if k.is_empty() { "geral".into() } else { k }))
}

pub fn nb_load(app: &App, key: &str) -> Value {
    std::fs::read(nb_file(app, key)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_else(|| json!({"cards": []}))
}

pub fn nb_save(app: &App, key: &str, v: &Value) -> Result<(), String> {
    let f = nb_file(app, key);
    if let Some(d) = f.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    // grava num temporário e troca: nunca deixa o caderno pela metade
    let tmp = f.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(v).unwrap_or_default()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &f).map_err(|e| e.to_string())
}
