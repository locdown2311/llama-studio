//! Cópia no servidor do que a interface guarda no navegador (personalidades, projetos, configurações,
//! conversas...). O localStorage do WebView2 grava no disco com atraso e some se o app fecha antes, se o
//! cache do WebView é limpo ou se o studio abre por outra porta ou no navegador comum. Cada chave vira
//! dados\ui\<chave>.json com a hora da última mudança; ao abrir, a interface recupera o que for mais novo.

use serde_json::{json, Value};
use std::path::PathBuf;

use crate::app::App;

fn dir(app: &App) -> PathBuf {
    app.root.join("ui")
}

pub fn valid_key(k: &str) -> bool {
    !k.is_empty() && k.len() <= 64 && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Todas as chaves: {"items": {chave: {"t": ms, "v": valor}}}.
pub fn all(app: &App) -> Value {
    let mut items = serde_json::Map::new();
    if let Ok(rd) = std::fs::read_dir(dir(app)) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let Some(key) = name.strip_suffix(".json") else { continue };
            if !valid_key(key) {
                continue;
            }
            if let Some(v) = std::fs::read_to_string(e.path()).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
                items.insert(key.to_string(), v);
            }
        }
    }
    json!({ "items": items })
}

/// Grava uma chave se a cópia que chegou não for mais velha que a guardada (duas janelas abertas: a última
/// mudança vale). Grava num temporário e troca, para não deixar meio arquivo se o app fechar no meio.
pub fn put(app: &App, key: &str, t: u64, v: &Value) -> Result<bool, String> {
    if !valid_key(key) {
        return Err("chave inválida".into());
    }
    let d = dir(app);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let path = d.join(format!("{key}.json"));
    let old_t = std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).and_then(|o| o["t"].as_u64()).unwrap_or(0);
    if t < old_t {
        return Ok(false);
    }
    let tmp = d.join(format!(".{key}.json.tmp"));
    std::fs::write(&tmp, json!({ "t": t, "v": v }).to_string()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod t {
    #[test]
    fn chaves() {
        assert!(super::valid_key("personas") && super::valid_key("model_kits-2"));
        assert!(!super::valid_key("../x") && !super::valid_key("") && !super::valid_key("a.b"));
    }
}
