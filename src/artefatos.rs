//! Artefatos: entregas que o modelo cria fora do texto da resposta (página HTML, documento Markdown, SVG,
//! diagrama Mermaid, código), com versões. Ficam em dados/artefatos/<id>/ (meta.json + v1.ext, v2.ext...),
//! aparecem num painel ao lado da conversa e numa página própria, e sobrevivem à conversa.

use serde_json::{json, Value};
use std::path::PathBuf;

use crate::app::App;

const KINDS: &[&str] = &["html", "markdown", "svg", "mermaid", "code"];
const MAX: usize = 4 * 1024 * 1024;
const MAX_VERSIONS: usize = 60;

fn root(app: &App) -> PathBuf {
    app.root.join("artefatos")
}

fn clean_id(id: &str) -> Option<String> {
    let id: String = id.trim().chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(40).collect();
    (!id.is_empty()).then_some(id)
}

fn ext(kind: &str, lang: &str) -> String {
    match kind {
        "html" => "html".into(),
        "markdown" => "md".into(),
        "svg" => "svg".into(),
        "mermaid" => "mmd".into(),
        _ => {
            let l: String = lang.chars().filter(|c| c.is_ascii_alphanumeric()).take(10).collect();
            if l.is_empty() { "txt".into() } else { l.to_lowercase() }
        }
    }
}

fn meta_of(app: &App, id: &str) -> Option<Value> {
    std::fs::read(root(app).join(id).join("meta.json")).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

fn save_meta(app: &App, m: &Value) -> Result<(), String> {
    let id = m["id"].as_str().unwrap_or("");
    std::fs::write(root(app).join(id).join("meta.json"), serde_json::to_vec_pretty(m).unwrap()).map_err(|e| e.to_string())
}

fn file_of(app: &App, m: &Value, v: u64) -> PathBuf {
    root(app).join(m["id"].as_str().unwrap_or("")).join(format!("v{v}.{}", ext(m["kind"].as_str().unwrap_or("code"), m["lang"].as_str().unwrap_or(""))))
}

pub fn list(app: &App) -> Value {
    let mut out: Vec<Value> = std::fs::read_dir(root(app))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| meta_of(app, &e.file_name().to_string_lossy()))
        .collect();
    out.sort_by_key(|m| std::cmp::Reverse(m["updated"].as_u64().unwrap_or(0)));
    json!({ "artifacts": out })
}

pub fn get(app: &App, id: &str, v: Option<u64>) -> Result<Value, String> {
    let id = clean_id(id).ok_or("id inválido")?;
    let m = meta_of(app, &id).ok_or_else(|| L!("Artefato não encontrado.", "Artifact not found.").to_string())?;
    let last = m["v"].as_u64().unwrap_or(1);
    let v = v.filter(|x| *x >= 1 && *x <= last).unwrap_or(last);
    let content = std::fs::read_to_string(file_of(app, &m, v)).map_err(|_| L!("Essa versão não existe mais.", "That version no longer exists.").to_string())?;
    Ok(json!({ "meta": m, "v": v, "content": content }))
}

pub fn delete(app: &App, id: &str) -> Result<Value, String> {
    let id = clean_id(id).ok_or("id inválido")?;
    std::fs::remove_dir_all(root(app).join(&id)).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

pub fn rename(app: &App, id: &str, title: &str) -> Result<Value, String> {
    let id = clean_id(id).ok_or("id inválido")?;
    let mut m = meta_of(app, &id).ok_or_else(|| L!("Artefato não encontrado.", "Artifact not found.").to_string())?;
    m["title"] = json!(title.trim().chars().take(120).collect::<String>());
    save_meta(app, &m)?;
    Ok(m)
}

fn write_version(app: &App, m: &mut Value, content: &str, note: &str) -> Result<u64, String> {
    if content.len() > MAX {
        return Err(L!("Grande demais para um artefato (máximo de 4 MB).", "Too large for an artifact (4 MB at most).").into());
    }
    let v = m["v"].as_u64().unwrap_or(0) + 1;
    m["v"] = json!(v);
    m["updated"] = json!(crate::app::now_ms());
    std::fs::write(file_of(app, m, v), content).map_err(|e| e.to_string())?;
    let mut vers = m["versions"].as_array().cloned().unwrap_or_default();
    vers.push(json!({ "v": v, "ts": crate::app::now_ms(), "note": note.chars().take(160).collect::<String>(), "size": content.len() }));
    // as mais antigas saem (a primeira fica)
    while vers.len() > MAX_VERSIONS {
        let old = vers.remove(1);
        let _ = std::fs::remove_file(file_of(app, m, old["v"].as_u64().unwrap_or(0)));
    }
    m["versions"] = json!(vers);
    save_meta(app, m)?;
    Ok(v)
}

/// A ferramenta `artifact` (o dono é a conversa que chamou).
pub fn tool(app: &App, args: &Value, conv: &str) -> Result<(String, Value), String> {
    let s = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let action = s("action");
    match action.as_str() {
        "create" => {
            let kind = s("kind").to_lowercase();
            let kind = if KINDS.contains(&kind.as_str()) { kind } else { "code".into() };
            let title = s("title");
            if title.trim().is_empty() {
                return Err(L!("Dê um título ao artefato.", "Give the artifact a title.").into());
            }
            let content = s("content");
            if content.trim().is_empty() {
                return Err(L!("O artefato está vazio.", "The artifact is empty.").into());
            }
            let id = format!("a{:x}", crate::app::now_ms());
            std::fs::create_dir_all(root(app).join(&id)).map_err(|e| e.to_string())?;
            let mut m = json!({ "id": id, "title": title.trim().chars().take(120).collect::<String>(), "kind": kind, "lang": s("lang"), "conv": conv, "created": crate::app::now_ms(), "updated": 0, "v": 0, "versions": [] });
            let v = write_version(app, &mut m, &content, &s("note"))?;
            Ok((LF!("Artefato \"{}\" criado (id {}, versão {}). Ele aparece no painel ao lado da conversa; para mudar, use action \"update\" (trechos) ou \"rewrite\" (tudo) com este id.", "Artifact \"{}\" created (id {}, version {}). It shows in the panel next to the chat; to change it, use action \"update\" (snippets) or \"rewrite\" (everything) with this id.", m["title"].as_str().unwrap_or(""), id, v), json!({ "artifact": { "id": id, "v": v, "title": m["title"], "kind": m["kind"] } })))
        }
        "update" | "rewrite" => {
            let id = clean_id(&s("id")).ok_or_else(|| L!("Passe o id do artefato.", "Pass the artifact id.").to_string())?;
            let mut m = meta_of(app, &id).ok_or_else(|| L!("Artefato não encontrado: use action \"list\".", "Artifact not found: use action \"list\".").to_string())?;
            let cur = std::fs::read_to_string(file_of(app, &m, m["v"].as_u64().unwrap_or(1))).unwrap_or_default();
            let content = if action == "rewrite" {
                s("content")
            } else {
                let edits = args.get("edits").and_then(Value::as_array).cloned().unwrap_or_default();
                if edits.is_empty() {
                    return Err(L!("Passe edits=[{old, new}] (ou use rewrite com o conteúdo inteiro).", "Pass edits=[{old, new}] (or use rewrite with the whole content).").into());
                }
                let mut t = cur.clone();
                for (i, e) in edits.iter().enumerate() {
                    let old = e["old"].as_str().unwrap_or("");
                    let new = e["new"].as_str().unwrap_or("");
                    let n = if old.is_empty() { 0 } else { t.matches(old).count() };
                    if n != 1 {
                        return Err(LF!("Edição {}: o trecho old aparece {} vezes (precisa aparecer exatamente 1). Nada foi mudado.", "Edit {}: the old snippet appears {} times (it must appear exactly once). Nothing was changed.", i + 1, n));
                    }
                    t = t.replacen(old, new, 1);
                }
                t
            };
            if content.trim().is_empty() {
                return Err(L!("O artefato ficaria vazio.", "The artifact would be empty.").into());
            }
            if content == cur {
                return Err(L!("Nada mudou.", "Nothing changed.").into());
            }
            if let Some(t) = args.get("title").and_then(Value::as_str).filter(|t| !t.trim().is_empty()) {
                m["title"] = json!(t.trim().chars().take(120).collect::<String>());
            }
            let v = write_version(app, &mut m, &content, &s("note"))?;
            Ok((LF!("Artefato \"{}\" atualizado para a versão {}.", "Artifact \"{}\" updated to version {}.", m["title"].as_str().unwrap_or(""), v), json!({ "artifact": { "id": id, "v": v, "title": m["title"], "kind": m["kind"] } })))
        }
        "get" => {
            let r = get(app, &s("id"), args.get("version").and_then(Value::as_u64))?;
            Ok((format!("{} (v{}, {}):\n\n{}", r["meta"]["title"].as_str().unwrap_or(""), r["v"], r["meta"]["kind"].as_str().unwrap_or(""), r["content"].as_str().unwrap_or("")), json!({})))
        }
        "list" => {
            let all = list(app)["artifacts"].as_array().cloned().unwrap_or_default();
            let mine: Vec<&Value> = all.iter().filter(|m| m["conv"].as_str() == Some(conv)).collect();
            let show = if mine.is_empty() { all.iter().take(20).collect::<Vec<_>>() } else { mine };
            if show.is_empty() {
                return Ok((L!("Nenhum artefato ainda.", "No artifacts yet.").into(), json!({})));
            }
            Ok((show.iter().map(|m| format!("- {} · \"{}\" · {} · v{}", m["id"].as_str().unwrap_or(""), m["title"].as_str().unwrap_or(""), m["kind"].as_str().unwrap_or(""), m["v"])).collect::<Vec<_>>().join("\n"), json!({})))
        }
        _ => Err(L!("action deve ser create, update, rewrite, get ou list.", "action must be create, update, rewrite, get or list.").into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extensoes() {
        assert_eq!(ext("html", ""), "html");
        assert_eq!(ext("code", "Python"), "python");
        assert_eq!(ext("code", "../x"), "x");
        assert_eq!(clean_id("a12/../b").as_deref(), Some("a12b"));
    }
}
