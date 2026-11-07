//! Pontos de restauração: antes de cada escrita/edição de arquivo, guarda o estado anterior
//! do arquivo. Dá para desfazer uma ação ou voltar a conversa até um ponto.
//! Fica em dados/pontos/<conversa>/<id da chamada>.{json,bin}.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use crate::app::App;

/// Arquivos maiores que isso não são copiados (o ponto avisa que não dá para desfazer).
const MAX: u64 = 50 * 1024 * 1024;

fn clean(id: &str) -> String {
    id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(80).collect()
}

fn dir(app: &App, conv: &str) -> PathBuf {
    app.root.join("pontos").join(clean(conv))
}

/// Guarda o estado de `file` antes da ação `id`. Só a primeira foto vale (repetir não sobrescreve).
pub fn snapshot(app: &App, conv: &str, id: &str, file: &Path) -> Result<(), String> {
    let (conv, id) = (clean(conv), clean(id));
    if conv.is_empty() || id.is_empty() {
        return Ok(());
    }
    let d = dir(app, &conv);
    let meta = d.join(format!("{id}.json"));
    if meta.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let md = std::fs::metadata(file).ok();
    let existed = md.as_ref().is_some_and(|m| m.is_file());
    let is_dir = md.as_ref().is_some_and(|m| m.is_dir());
    let size = md.as_ref().map(|m| m.len()).unwrap_or(0);
    let mut too_big = false;
    if existed {
        if size > MAX {
            too_big = true;
        } else {
            std::fs::copy(file, d.join(format!("{id}.bin"))).map_err(|e| e.to_string())?;
        }
    }
    // pastas que a ação vai criar (para sumirem no desfazer, se ficarem vazias)
    let mut made = vec![];
    let mut up = file.parent();
    while let Some(d) = up {
        if d.exists() {
            break;
        }
        made.push(d.to_path_buf());
        up = d.parent();
    }
    let v = json!({"path": file, "existed": existed, "dir": is_dir, "size": size, "tooBig": too_big, "made": made, "at": chrono_now()});
    std::fs::write(meta, serde_json::to_vec_pretty(&v).unwrap()).map_err(|e| e.to_string())
}

fn chrono_now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Quais ações da conversa têm ponto de restauração.
pub fn list(app: &App, conv: &str) -> Value {
    let mut out = serde_json::Map::new();
    if let Ok(rd) = std::fs::read_dir(dir(app, conv)) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            if let Some(v) = std::fs::read(&p).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) {
                let id = p.file_stem().and_then(|x| x.to_str()).unwrap_or("").to_string();
                out.insert(id, json!({"path": v["path"], "existed": v["existed"], "tooBig": v["tooBig"], "at": v["at"]}));
            }
        }
    }
    Value::Object(out)
}

/// Desfaz as ações `ids`, na ordem dada (passe da mais nova para a mais antiga).
pub fn undo(app: &App, conv: &str, ids: &[String]) -> Value {
    let d = dir(app, conv);
    let mut done = vec![];
    let mut errors = vec![];
    for id in ids {
        let id = clean(id);
        let meta = d.join(format!("{id}.json"));
        let Some(v) = std::fs::read(&meta).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else {
            continue;
        };
        let path = PathBuf::from(v["path"].as_str().unwrap_or(""));
        let r: Result<(), String> = if v["tooBig"] == true {
            Err(L!("arquivo grande demais, não foi guardado", "file too large, it was not saved").into())
        } else if v["existed"] == true {
            let bin = d.join(format!("{id}.bin"));
            path.parent().map(std::fs::create_dir_all);
            std::fs::copy(&bin, &path).map(|_| ()).map_err(|e| e.to_string())
        } else if v["dir"] == true {
            Ok(())
        } else if path.is_dir() {
            // pasta criada pela ação: só some se estiver vazia
            let _ = std::fs::remove_dir(&path);
            Ok(())
        } else if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())
        } else {
            Ok(())
        };
        match r {
            Ok(()) => {
                for d in v["made"].as_array().into_iter().flatten().filter_map(Value::as_str) {
                    let _ = std::fs::remove_dir(d); // só sai se estiver vazia
                }
                let _ = std::fs::remove_file(&meta);
                let _ = std::fs::remove_file(d.join(format!("{id}.bin")));
                done.push(json!({"id": id, "path": path, "removed": v["existed"] != true}));
            }
            Err(e) => errors.push(json!({"id": id, "path": path, "error": e})),
        }
    }
    json!({"done": done, "errors": errors})
}

/// Apaga os pontos de uma conversa (ao apagar a conversa).
pub fn forget(app: &App, conv: &str) {
    let c = clean(conv);
    if !c.is_empty() {
        let _ = std::fs::remove_dir_all(dir(app, &c));
    }
}

/// Remove pontos de conversas que não existem mais.
pub fn prune(app: &App, keep: &[String]) {
    let keep: Vec<String> = keep.iter().map(|k| clean(k)).collect();
    if let Ok(rd) = std::fs::read_dir(app.root.join("pontos")) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if !keep.contains(&n) {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
}

fn text_of(p: &Path) -> Value {
    match std::fs::metadata(p) {
        Err(_) => Value::Null,
        Ok(m) if m.is_dir() => json!({"dir": true}),
        Ok(m) if m.len() > 1024 * 1024 => json!({"tooBig": true, "size": m.len()}),
        Ok(m) => match std::fs::read(p) {
            Ok(b) if b.iter().take(8000).any(|&c| c == 0) => json!({"binary": true, "size": m.len()}),
            Ok(b) => json!({"text": String::from_utf8_lossy(&b), "size": m.len()}),
            Err(_) => Value::Null,
        },
    }
}

/// O arquivo antes da ação `id` e como ele está agora.
pub fn diff(app: &App, conv: &str, id: &str) -> Value {
    let d = dir(app, conv);
    let id = clean(id);
    let Some(v) = std::fs::read(d.join(format!("{id}.json"))).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else {
        return json!({"error": L!("ponto não encontrado", "restore point not found")});
    };
    let path = PathBuf::from(v["path"].as_str().unwrap_or(""));
    let before = if v["existed"] == true {
        if v["tooBig"] == true { json!({"tooBig": true}) } else { text_of(&d.join(format!("{id}.bin"))) }
    } else {
        Value::Null
    };
    json!({"path": path, "before": before, "after": text_of(&path)})
}
