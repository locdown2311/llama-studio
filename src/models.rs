//! VÃ¡rios modelos cadastrados, um carregado por vez.
//! Cada perfil guarda o arquivo .gguf e os parÃ¢metros que mudam de modelo para modelo
//! (contexto, camadas MoE na CPU, threads, argumentos extras). Ativar um perfil copia
//! esses campos para o llama-gui.json e reinicia o llama-server.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use crate::app::App;
use crate::llama::LlamaCfg;

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub model: String,
    pub context: u32,
    pub cpu_moe: u32,
    pub threads: u32,
    pub extra_args: String,
}

fn file(app: &App) -> PathBuf {
    app.root.join("modelos.json")
}

fn from_cfg(c: &LlamaCfg, id: &str) -> Profile {
    Profile {
        id: id.into(),
        name: name_of(&c.model),
        model: c.model.clone(),
        context: c.context,
        cpu_moe: c.cpu_moe,
        threads: c.threads,
        extra_args: c.extra_args.clone(),
    }
}

/// Nome legÃ­vel a partir do arquivo (sem pasta, extensÃ£o e partes "-00001-of-00003").
pub fn name_of(path: &str) -> String {
    let base = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let base = base.strip_suffix(".gguf").unwrap_or(base);
    let re = regex_lite::Regex::new(r"-\d{5}-of-\d{5}$").unwrap();
    re.replace(base, "").to_string()
}

fn same_path(a: &str, b: &str) -> bool {
    let n = |s: &str| s.trim().replace('/', "\\").to_lowercase();
    !a.trim().is_empty() && n(a) == n(b)
}

pub fn load(app: &App) -> Vec<Profile> {
    if let Some(v) = crate::app::read_json::<Vec<Profile>>(&file(app)) {
        return v;
    }
    // primeira vez: o modelo atual vira o primeiro perfil
    let c = app.llama.cfg();
    if c.model.trim().is_empty() {
        return vec![];
    }
    let v = vec![from_cfg(&c, "m1")];
    save(app, &v);
    v
}

/// Perfis remotos da API externa.
pub fn remote_profiles(app: &App) -> Vec<Profile> {
    app.cfg().api_providers.iter()
        .filter(|p| crate::remote::ready(p))
        .map(|p| Profile {
            id: format!("api_{}", p.id),
            name: format!("☁️ {} ({})", p.name, p.model),
            model: format!("remote:{}", p.id),
            context: 32768,
            ..Default::default()
        })
        .collect()
}

/// Combina perfis locais com os remotos (descarta remotos antigos do arquivo).
fn merge_remotes(mut local: Vec<Profile>, remotes: Vec<Profile>) -> Vec<Profile> {
    local.retain(|p| !p.model.starts_with("remote:"));
    local.extend(remotes);
    local
}

/// Lista todos os perfis (locais + da API externa).
pub fn full_list(app: &App) -> Vec<Profile> {
    merge_remotes(load(app), remote_profiles(app))
}

/// Grava os perfis locais em `modelos.json` (exclui remotos).
pub fn save(app: &App, list: &[Profile]) {
    let mut local = list.iter()
        .filter(|p| !p.model.starts_with("remote:"))
        .cloned()
        .collect::<Vec<_>>();
    // ordena por nome (caso) para ser previsÃ­vel
    local.sort_by(|a, b| a.name.cmp(&b.name));
    let json = serde_json::to_vec_pretty(&local).unwrap_or_else(|_| vec![]);
    std::fs::write(file(app), json).ok();
}

/// Perfil cujo modelo estÃ¡ configurado no llama-server agora.
pub fn active_id(app: &App, list: &[Profile]) -> Option<String> {
    let c = app.llama.cfg();
    list.iter().find(|p| same_path(&p.model, &c.model)).map(|p| p.id.clone())
}

/// Arquivos .gguf perto do llama-server (para cadastrar com um clique).
fn scan(app: &App, known: &[Profile]) -> Vec<Value> {
    let mut out = vec![];
    let mut roots = vec![app.llama_dir.clone()];
    let c = app.llama.cfg();
    if let Some(d) = Path::new(&c.model).parent() {
        if !d.as_os_str().is_empty() {
            roots.insert(0, d.to_path_buf());
            if let Some(dd) = d.parent() {
                roots.push(dd.to_path_buf());
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    for r in roots {
        for e in walkdir::WalkDir::new(&r).max_depth(3).into_iter().filter_map(Result::ok) {
            let p = e.path();
            let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            if !name.ends_with(".gguf") || name.contains("mmproj") {
                continue;
            }
            // de modelos divididos, sÃ³ a primeira parte
            if regex_lite::Regex::new(r"-\d{5}-of-\d{5}\.gguf$").unwrap().is_match(&name) && !name.contains("-00001-of-") {
                continue;
            }
            let s = p.to_string_lossy().to_string();
            if !seen.insert(s.to_lowercase()) || known.iter().any(|k| same_path(&k.model, &s)) {
                continue;
            }
            let size = e.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(json!({"path": s, "name": name_of(&s), "size": size}));
            if out.len() >= 40 {
                return out;
            }
        }
    }
    out
}

pub fn list_json(app: &App) -> Value {
    let list = full_list(app);
    let active = active_id(app, &list);
    let found = scan(app, &list);
    json!({"models": list, "active": active, "found": found, "defaults": from_cfg(&app.llama.cfg(), "")})
}

/// Carrega o perfil: grava os parÃ¢metros e (re)inicia o llama-server.
pub async fn activate(app: &Arc<App>, id: &str) -> Result<Value, String> {
    let list = full_list(app); 
    
    let p = list.iter().find(|p| p.id == id).ok_or(L!("Modelo nÃ£o encontrado.", "Model not found."))?.clone();
    let is_remote = p.model.starts_with("remote:");
    
    // Modelos remotos nÃ£o usam o llama-server local
    if is_remote {
        let mut c = app.llama.cfg();
        c.model = p.model.clone();
        c.context = p.context;
        c.cpu_moe = p.cpu_moe;
        c.threads = p.threads;
        c.extra_args = p.extra_args.clone();
        app.llama.save(c);
        return Ok(app.llama.to_json());
    }
    
    // Verifica se o arquivo do modelo existe
    if !Path::new(&p.model).is_file() {
        return Err(LF!("O arquivo do modelo nÃ£o existe: {}", "The model file does not exist: {}", p.model));
    }
    
    let state = app.llama.state();
    if state.starts_with("external") {
        return Err(L!("O llama-server foi aberto por fora do studio (start.bat antigo ou outro programa). Feche-o para o studio poder trocar de modelo.", "The llama-server was opened outside the studio (old start.bat or another program). Close it so the studio can switch models.").into());
    }
    
    let mut c = app.llama.cfg();
    let changed = !same_path(&c.model, &p.model) || c.context != p.context || c.cpu_moe != p.cpu_moe || c.threads != p.threads || c.extra_args != p.extra_args;
    c.model = p.model.clone();
    c.context = p.context;
    c.cpu_moe = p.cpu_moe;
    c.threads = p.threads;
    c.extra_args = p.extra_args.clone();
    app.llama.save(c);
    
    if app.llama.is_running() {
        if !changed {
            return Ok(app.llama.to_json());
        }
        app.llama.stop();
        for _ in 0..100 {
            if !app.llama.is_running() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        // o Windows demora um pouco para liberar a porta
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
    
    let mut last = String::new();
    for _ in 0..10 {
        match app.llama.start(app) {
            Ok(()) => return Ok(app.llama.to_json()),
            Err(e) => last = e,
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Err(last)
}

/// O formulÃ¡rio do servidor editou a configuraÃ§Ã£o direta: leva as mudanÃ§as para o perfil
/// do modelo que estava ativo (ou cria um perfil se o modelo for novo).
pub fn sync_from_cfg(app: &App, old_model: &str) {
    let c = app.llama.cfg();
    if c.model.trim().is_empty() || c.model.starts_with("remote:") {
        return;
    }
    let mut list = full_list(app);
    if let Some(p) = list.iter_mut().find(|p| same_path(&p.model, old_model) || same_path(&p.model, &c.model)) {
        let renamed = p.name == name_of(&p.model);
        p.model = c.model.clone();
        p.context = c.context;
        p.cpu_moe = c.cpu_moe;
        p.threads = c.threads;
        p.extra_args = c.extra_args.clone();
        if renamed {
            p.name = name_of(&c.model);
        }
    } else {
        let id = format!("m{}", crate::app::now_ms());
        list.push(from_cfg(&c, &id));
    }
    save(app, &list);
}

#[cfg(test)]
mod t {
    use super::*;
    #[test]
    fn merge_remotes_tira_antigos_do_arquivo() {
        let local = vec![
            Profile { id: "m1".into(), model: "llama.gguf".into(), ..Default::default() },
            // entrada remota antiga persistida em modelos.json
            Profile { id: "api_antigo".into(), model: "remote:antigo".into(), ..Default::default() },
        ];
        let remotos = vec![Profile { id: "api_novo".into(), model: "remote:novo".into(), ..Default::default() }];
        let list = merge_remotes(local, remotos);
        let ids: Vec<_> = list.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["m1", "api_novo"]);
    }
}


