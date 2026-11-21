//! Workflows salvos: scripts JS com nome em `dados/workflows/<nome>.mjs` (frontmatter + corpo).
//! O corpo roda no mesmo worker do `execute_code` (ui/js/08-ferramentas.js), com `params` já definido.

use crate::app::App;
use serde_json::{json, Value};
use std::path::PathBuf;

fn dir(app: &App) -> PathBuf {
    app.root.join("workflows")
}

/// Nome seguro (vira nome de arquivo).
pub fn clean(name: &str) -> String {
    name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(60).collect()
}

/// Separa o frontmatter do corpo. Aceita `params:` em bloco (`  nome: descrição`) ou em lista (`a, b`).
pub fn parse(text: &str) -> (Value, String) {
    let t = text.strip_prefix('\u{feff}').unwrap_or(text).trim_start();
    let Some(rest) = t.strip_prefix("---") else { return (json!({}), t.to_string()) };
    let Some(end) = rest.find("\n---") else { return (json!({}), t.to_string()) };
    let body = rest[end + 4..].trim_start_matches(['\r', '\n']).to_string();
    let (mut name, mut desc) = (String::new(), String::new());
    let mut params: Vec<Value> = Vec::new();
    let mut in_params = false;
    for line in rest[..end].lines() {
        let line = line.trim_end();
        if line.trim().is_empty() {
            continue;
        }
        if let Some(v) = line.strip_prefix("params:") {
            in_params = true;
            for p in v.split(',').map(str::trim).filter(|p| !p.is_empty()) {
                params.push(json!({ "name": p, "desc": "" }));
            }
            continue;
        }
        let indented = line.starts_with([' ', '\t']);
        if in_params && indented {
            let l = line.trim();
            if let Some((k, v)) = l.split_once(':') {
                params.push(json!({ "name": k.trim(), "desc": v.trim() }));
            }
            continue;
        }
        in_params = false;
        if let Some(v) = line.strip_prefix("name:") {
            name = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("description:") {
            desc = v.trim().to_string();
        }
    }
    (json!({ "name": name, "description": desc, "params": params }), body)
}

/// Um workflow do disco: metadados do frontmatter + texto inteiro (para editar).
fn read_one(app: &App, name: &str) -> Option<Value> {
    let n = clean(name);
    if n.is_empty() {
        return None;
    }
    let text = std::fs::read_to_string(dir(app).join(format!("{n}.mjs"))).ok()?;
    let (mut meta, body) = parse(&text);
    if meta["name"].as_str().is_none_or(str::is_empty) {
        meta["name"] = json!(n);
    }
    meta["text"] = json!(text);
    meta["body"] = json!(body);
    meta["lines"] = json!(body.lines().count());
    Some(meta)
}

/// Lista os workflows (sem o corpo: só nome, descrição e parâmetros).
pub fn list(app: &App) -> Vec<Value> {
    let mut out: Vec<Value> = std::fs::read_dir(dir(app))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("mjs") {
                return None;
            }
            let mut v = read_one(app, p.file_stem()?.to_str()?)?;
            v.as_object_mut()?.remove("text");
            Some(v)
        })
        .collect();
    out.sort_by_key(|v| v["name"].as_str().unwrap_or("").to_lowercase());
    out
}

pub fn get(app: &App, name: &str) -> Result<Value, String> {
    read_one(app, name).ok_or_else(|| LF!("Workflow {} não encontrado.", "Workflow {} not found.", name).to_string())
}

pub fn save(app: &App, name: &str, text: &str) -> Result<Value, String> {
    let n = clean(name);
    if n.is_empty() {
        return Err(L!("Nome do workflow vazio.", "Empty workflow name.").into());
    }
    let d = dir(app);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let f = d.join(format!("{n}.mjs"));
    // grava em temporário e troca: um erro no meio não deixa o workflow pela metade
    let tmp = f.with_extension("tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &f).map_err(|e| e.to_string())?;
    read_one(app, &n).ok_or_else(|| L!("Não consegui ler o workflow gravado.", "Could not read the saved workflow.").to_string())
}

pub fn remove(app: &App, name: &str) -> Result<Value, String> {
    let n = clean(name);
    if n.is_empty() {
        return Err(L!("Nome do workflow vazio.", "Empty workflow name.").into());
    }
    std::fs::remove_file(dir(app).join(format!("{n}.mjs"))).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_com_params() {
        let (m, b) = parse("---\nname: auditar\ndescription: Lista por tamanho\nparams:\n  pasta: Pasta dos assets\n  n: Quantas (padrão 3)\n---\nreturn params.pasta;");
        assert_eq!(m["name"], "auditar");
        assert_eq!(m["description"], "Lista por tamanho");
        assert_eq!(m["params"][0]["name"], "pasta");
        assert_eq!(m["params"][1]["desc"], "Quantas (padrão 3)");
        assert_eq!(b, "return params.pasta;");
    }

    #[test]
    fn sem_frontmatter_roda_o_texto() {
        let (m, b) = parse("return 1;");
        assert!(m.as_object().unwrap().is_empty());
        assert_eq!(b, "return 1;");
    }

    #[test]
    fn params_em_linha() {
        let (m, _) = parse("---\nname: x\nparams: a, b\n---\n");
        assert_eq!(m["params"][0]["name"], "a");
        assert_eq!(m["params"][1]["name"], "b");
    }

    #[test]
    fn nome_seguro() {
        assert_eq!(clean("../../etc/passwd"), "etcpasswd");
        assert_eq!(clean("meu-fluxo_1"), "meu-fluxo_1");
    }
}