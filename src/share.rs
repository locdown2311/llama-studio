//! Exportar e importar configurações para compartilhar com outras pessoas.
//! O arquivo é um JSON só (`.studio.json`). A parte do navegador (configurações, personalidades,
//! projetos, etiquetas) vem pronta da interface; aqui entram habilidades (com os arquivos),
//! conectores (sem segredos), assinaturas, regras de pastas e perfis de modelo.
//! Segredos (tokens, chaves, senhas) nunca saem: viram marcadores que quem importa preenche.

use base64::Engine;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

use crate::app::{slug, App};

pub const FORMAT: &str = "llama-studio/compartilhar";
const MAX_SKILL_BYTES: u64 = 2 * 1024 * 1024;

fn is_secret_name(k: &str) -> bool {
    let k = k.to_lowercase();
    ["authorization", "token", "secret", "password", "passwd", "senha", "cookie", "bearer", "credential", "apikey", "api_key", "api-key", "private", "auth"]
        .iter()
        .any(|w| k.contains(w))
        || k.ends_with("_key")
        || k.ends_with("-key")
        || k == "key"
}

fn mark(server: &str, wher: &str, key: &str) -> String {
    format!("{{{{SEGREDO:{server}:{wher}:{key}}}}}")
}

/// Tira os segredos de uma configuração de conector, devolvendo a lista do que foi tirado.
pub fn sanitize(server: &str, cfg: &Value) -> (Value, Vec<Value>) {
    let mut c = cfg.clone();
    let mut found = vec![];
    for wher in ["headers", "env"] {
        if let Some(obj) = c.get_mut(wher).and_then(Value::as_object_mut) {
            for (k, v) in obj.iter_mut() {
                if v.as_str().is_some_and(|s| !s.is_empty()) && (is_secret_name(k) || wher == "headers" && v.as_str().is_some_and(|s| s.to_lowercase().starts_with("bearer "))) {
                    // "Bearer xxx": guarda o prefixo, só o token vira segredo
                    let prefix = v.as_str().filter(|s| s.to_lowercase().starts_with("bearer ")).map(|s| s[..7].to_string()).unwrap_or_default();
                    *v = json!(format!("{prefix}{}", mark(server, wher, k)));
                    found.push(json!({"server": server, "where": wher, "key": k}));
                }
            }
        }
    }
    if let Some(args) = c.get_mut("args").and_then(Value::as_array_mut) {
        let mut next_secret: Option<String> = None;
        for (i, a) in args.iter_mut().enumerate() {
            let Some(s) = a.as_str().map(str::to_string) else { continue };
            if let Some(name) = next_secret.take() {
                *a = json!(mark(server, "args", &format!("{i}:{name}")));
                found.push(json!({"server": server, "where": "args", "key": format!("{i}:{name}")}));
                continue;
            }
            if s.starts_with('-') {
                let (flag, val) = s.split_once('=').map(|(f, v)| (f.to_string(), Some(v.to_string()))).unwrap_or((s.clone(), None));
                if is_secret_name(flag.trim_start_matches('-')) {
                    match val {
                        Some(_) => {
                            *a = json!(format!("{flag}={}", mark(server, "args", &format!("{i}:{flag}"))));
                            found.push(json!({"server": server, "where": "args", "key": format!("{i}:{flag}")}));
                        }
                        None => next_secret = Some(flag),
                    }
                }
            }
        }
    }
    if let Some(u) = c.get("url").and_then(Value::as_str).map(str::to_string) {
        if let Ok(mut url) = reqwest::Url::parse(&u) {
            let pairs: Vec<(String, String)> = url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
            if pairs.iter().any(|(k, _)| is_secret_name(k)) {
                let mut q = url.query_pairs_mut();
                q.clear();
                for (k, v) in &pairs {
                    if is_secret_name(k) {
                        q.append_pair(k, &mark(server, "url", k));
                        found.push(json!({"server": server, "where": "url", "key": k}));
                    } else {
                        q.append_pair(k, v);
                    }
                }
                drop(q);
                c["url"] = json!(url.to_string());
            }
        }
    }
    (c, found)
}

/// Troca os marcadores pelos valores preenchidos; devolve quantos ficaram sem valor.
fn fill(v: &mut Value, values: &Map<String, Value>) -> usize {
    let mut left = 0;
    match v {
        Value::String(s) => {
            // na URL o marcador vai codificado
            if s.contains("%7B%7BSEGREDO") {
                *s = s.replace("%7B", "{").replace("%7D", "}").replace("%3A", ":");
            }
            let mut from = 0;
            while let Some(a) = s[from..].find("{{SEGREDO:").map(|x| x + from) {
                let Some(b) = s[a..].find("}}") else { break };
                let key = s[a + 10..a + b].to_string();
                match values.get(&key).and_then(Value::as_str).filter(|x| !x.is_empty()) {
                    Some(val) => {
                        s.replace_range(a..a + b + 2, val);
                        from = a + val.len();
                    }
                    None => {
                        left += 1;
                        from = a + b + 2;
                    }
                }
            }
        }
        Value::Array(a) => a.iter_mut().for_each(|x| left += fill(x, values)),
        Value::Object(o) => o.values_mut().for_each(|x| left += fill(x, values)),
        _ => {}
    }
    left
}

fn skill_files(dir: &Path) -> Result<Map<String, Value>, String> {
    let mut out = Map::new();
    let mut total = 0u64;
    for e in walkdir::WalkDir::new(dir).max_depth(4).into_iter().flatten() {
        if !e.file_type().is_file() {
            continue;
        }
        let rel = e.path().strip_prefix(dir).unwrap_or(e.path()).to_string_lossy().replace('\\', "/");
        if rel.split('/').any(|p| p.starts_with('.') || p == "node_modules" || p == "__pycache__") {
            continue;
        }
        let len = e.metadata().map(|m| m.len()).unwrap_or(0);
        total += len;
        if total > MAX_SKILL_BYTES {
            return Err(L!("passa de 2 MB", "over 2 MB").into());
        }
        let bytes = std::fs::read(e.path()).map_err(|e| e.to_string())?;
        let v = match String::from_utf8(bytes) {
            Ok(t) => json!({"text": t}),
            Err(e) => json!({"b64": base64::engine::general_purpose::STANDARD.encode(e.into_bytes())}),
        };
        out.insert(rel, v);
    }
    Ok(out)
}

/// Junta as partes que ficam no servidor.
pub fn collect(app: &App, parts: &[String], skill_ids: &[String]) -> Value {
    let has = |p: &str| parts.iter().any(|x| x == p);
    let mut out = Map::new();
    let mut notes: Vec<String> = vec![];
    if has("skills") {
        let mut list = vec![];
        for s in crate::skills::list(app).into_iter().filter(|s| skill_ids.is_empty() || skill_ids.contains(&s.id)) {
            match skill_files(&s.dir) {
                Ok(files) => list.push(json!({"id": s.id, "name": s.name, "description": s.description, "files": files})),
                Err(e) => notes.push(LF!("Habilidade {} ficou de fora: {e}.", "Skill {} was left out: {e}.", s.name)),
            }
        }
        out.insert("skills".into(), json!(list));
    }
    if has("mcp") {
        let cfg = crate::mcp::Mcp::read_config(&app.mcp_file());
        let mut servers = Map::new();
        let mut secrets = vec![];
        for (k, v) in cfg["mcpServers"].as_object().cloned().unwrap_or_default() {
            let (c, s) = sanitize(&k, &v);
            servers.insert(k, c);
            secrets.extend(s);
        }
        out.insert("mcp".into(), json!({"servers": servers, "secrets": secrets}));
    }
    if has("signatures") {
        out.insert("signatures".into(), crate::pe::load(app)["sigs"].clone());
    }
    if has("arrumar") {
        out.insert("arrumar".into(), crate::arrumar::load(app)["rules"].clone());
    }
    if has("models") {
        let list: Vec<Value> = crate::models::load(app)
            .into_iter()
            .map(|p| {
                let file = p.model.rsplit(['/', '\\']).next().unwrap_or("").to_string();
                json!({"name": p.name, "file": file, "context": p.context, "cpuMoe": p.cpu_moe, "threads": p.threads, "extraArgs": p.extra_args})
            })
            .collect();
        out.insert("models".into(), json!(list));
    }
    out.insert("notes".into(), json!(notes));
    Value::Object(out)
}

fn write_skill(dir: &Path, files: &Map<String, Value>) -> Result<(), String> {
    let _ = std::fs::remove_dir_all(dir);
    for (rel, v) in files {
        let rel = rel.replace('\\', "/");
        if rel.split('/').any(|p| p == ".." || p.is_empty()) || rel.contains(':') {
            return Err(LF!("caminho inválido: {rel}", "invalid path: {rel}"));
        }
        let p = dir.join(&rel);
        if let Some(d) = p.parent() {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        let bytes = if let Some(t) = v["text"].as_str() {
            t.as_bytes().to_vec()
        } else {
            base64::engine::general_purpose::STANDARD.decode(v["b64"].as_str().unwrap_or("")).map_err(|e| e.to_string())?
        };
        std::fs::write(&p, bytes).map_err(|e| e.to_string())?;
    }
    if !dir.join("SKILL.md").is_file() {
        return Err(L!("sem SKILL.md", "no SKILL.md").into());
    }
    Ok(())
}

/// Aplica as partes do servidor. `overwrite`: substitui o que já existe com o mesmo nome.
pub fn apply(app: &App, data: &Value, parts: &[String], overwrite: bool, secrets: &Map<String, Value>) -> Value {
    let has = |p: &str| parts.iter().any(|x| x == p);
    let mut rep = Map::new();
    let mut notes: Vec<String> = vec![];
    if has("skills") {
        let (mut added, mut skipped) = (0, 0);
        for s in data["skills"].as_array().into_iter().flatten() {
            let name = s["id"].as_str().unwrap_or("").rsplit(':').next().unwrap_or("");
            let id = slug(if name.is_empty() { s["name"].as_str().unwrap_or("habilidade") } else { name });
            let dir: PathBuf = app.skills_dir().join(&id);
            if dir.exists() && !overwrite {
                skipped += 1;
                continue;
            }
            match s["files"].as_object().ok_or(L!("sem arquivos", "no files").to_string()).and_then(|f| write_skill(&dir, f)) {
                Ok(()) => added += 1,
                Err(e) => notes.push(format!("Habilidade {id}: {e}.")),
            }
        }
        rep.insert("skills".into(), json!({"added": added, "skipped": skipped}));
    }
    if has("mcp") {
        let mut cfg = crate::mcp::Mcp::read_config(&app.mcp_file());
        let (mut added, mut skipped, mut pending) = (0, 0, vec![]);
        for (k, v) in data["mcp"]["servers"].as_object().cloned().unwrap_or_default() {
            if cfg["mcpServers"].get(&k).is_some() && !overwrite {
                skipped += 1;
                continue;
            }
            let mut c = v.clone();
            if fill(&mut c, secrets) > 0 {
                // falta segredo: entra desligado, para não ficar tentando conectar
                c["disabled"] = json!(true);
                pending.push(k.clone());
            }
            cfg["mcpServers"][&k] = c;
            added += 1;
        }
        if let Err(e) = std::fs::write(app.mcp_file(), serde_json::to_string_pretty(&cfg).unwrap()) {
            notes.push(format!("Conectores: {e}"));
        }
        rep.insert("mcp".into(), json!({"added": added, "skipped": skipped, "pending": pending}));
    }
    if has("signatures") {
        let mut cur = crate::pe::load(app);
        let list = cur["sigs"].as_array_mut().unwrap();
        let mut added = 0;
        for s in data["signatures"].as_array().into_iter().flatten() {
            if !list.iter().any(|x| x["pattern"] == s["pattern"]) {
                list.push(s.clone());
                added += 1;
            }
        }
        let _ = crate::pe::save(app, &cur);
        rep.insert("signatures".into(), json!({"added": added}));
    }
    if has("arrumar") {
        let mut rules = crate::arrumar::load(app)["rules"].as_array().cloned().unwrap_or_default();
        let mut added = 0;
        for r in data["arrumar"].as_array().into_iter().flatten() {
            if rules.iter().any(|x| x["id"] == r["id"]) {
                continue;
            }
            // pastas de outro computador: entra desligada até a pessoa conferir
            let mut r = r.clone();
            r["enabled"] = json!(false);
            r["auto"] = json!(false);
            rules.push(r);
            added += 1;
        }
        let _ = crate::arrumar::save_rules(app, &json!(rules));
        rep.insert("arrumar".into(), json!({"added": added}));
    }
    if has("models") {
        let mut list = crate::models::load(app);
        let found = crate::models::list_json(app);
        let mut paths: Vec<String> = found["found"].as_array().into_iter().flatten().filter_map(|f| f["path"].as_str().map(String::from)).collect();
        paths.extend(list.iter().map(|p| p.model.clone()));
        let (mut added, mut missing) = (0, vec![]);
        for m in data["models"].as_array().into_iter().flatten() {
            let name = m["name"].as_str().unwrap_or("").to_string();
            let file = m["file"].as_str().unwrap_or("").to_lowercase();
            let local = paths.iter().find(|p| p.rsplit(['/', '\\']).next().unwrap_or("").to_lowercase() == file).cloned();
            if let Some(p) = list.iter_mut().find(|p| p.name == name || (local.is_some() && Some(&p.model) == local.as_ref())) {
                if overwrite {
                    p.context = m["context"].as_u64().unwrap_or(p.context as u64) as u32;
                    p.cpu_moe = m["cpuMoe"].as_u64().unwrap_or(0) as u32;
                    p.threads = m["threads"].as_u64().unwrap_or(0) as u32;
                    p.extra_args = m["extraArgs"].as_str().unwrap_or("").into();
                }
                continue;
            }
            let Some(path) = local else {
                missing.push(format!("{name} ({})", m["file"].as_str().unwrap_or("")));
                continue;
            };
            list.push(crate::models::Profile {
                id: format!("m{}", crate::app::now_ms() + added as u128),
                name,
                model: path,
                context: m["context"].as_u64().unwrap_or(32768) as u32,
                cpu_moe: m["cpuMoe"].as_u64().unwrap_or(0) as u32,
                threads: m["threads"].as_u64().unwrap_or(0) as u32,
                extra_args: m["extraArgs"].as_str().unwrap_or("").into(),
            });
            added += 1;
        }
        crate::models::save(app, &list);
        rep.insert("models".into(), json!({"added": added, "missing": missing}));
    }
    rep.insert("notes".into(), json!(notes));
    Value::Object(rep)
}

#[cfg(test)]
mod t {
    use super::*;
    #[test]
    fn segredos_saem_e_voltam() {
        let cfg = json!({"type": "http", "url": "http://127.0.0.1:9094/sse?token=abc&x=1", "headers": {"Authorization": "Bearer s3cr3t", "Accept": "json"},
            "env": {"MESHY_API_KEY": "msy_123", "PATH": "C:\\x"}, "args": ["--api-key", "k1", "--port=3", "--token=t2"]});
        let (c, found) = sanitize("x64dbg", &cfg);
        let txt = c.to_string();
        for s in ["s3cr3t", "msy_123", "k1", "t2", "abc"] {
            assert!(!txt.contains(s), "vazou {s}: {txt}");
        }
        assert_eq!(found.len(), 5);
        assert_eq!(c["headers"]["Accept"], "json");
        assert_eq!(c["env"]["PATH"], "C:\\x");
        let mut vals = Map::new();
        for f in &found {
            vals.insert(format!("{}:{}:{}", f["server"].as_str().unwrap(), f["where"].as_str().unwrap(), f["key"].as_str().unwrap()), json!("OK"));
        }
        let mut back = c.clone();
        assert_eq!(fill(&mut back, &vals), 0);
        assert_eq!(back["headers"]["Authorization"], "Bearer OK");
        assert_eq!(back["env"]["MESHY_API_KEY"], "OK");
        assert_eq!(back["args"][1], "OK");
        assert_eq!(back["args"][3], "--token=OK");
        assert!(back["url"].as_str().unwrap().contains("token=OK"));
    }
}
