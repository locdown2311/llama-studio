//! Plugins no formato do Claude Code (o mesmo que Codex, Cursor e cia. passaram a ler): uma pasta com
//! `.claude-plugin/plugin.json` (opcional) e os componentes nas pastas padrão:
//!
//! - `skills/<nome>/SKILL.md`  → skills do studio (id `plugin:skill`)
//! - `commands/*.md`           → comandos de barra (`/plugin:comando`), com `$ARGUMENTS`, `$1`, `` !`cmd` ``
//! - `agents/*.md`             → personalidades (só leitura)
//! - `hooks/hooks.json`        → ganchos nos eventos do agente (PreToolUse, PostToolUse, Stop...)
//! - `.mcp.json`               → conectores MCP (entram junto com os do mcp.json)
//! - `bin/`                    → entra no PATH dos comandos
//!
//! Plugins vêm de "lojas" (`.claude-plugin/marketplace.json` num repositório do GitHub, URL git ou pasta) ou
//! direto de um repositório/pasta. Ficam copiados em `dados/plugins/instalados`, com uma pasta de dados própria
//! (`CLAUDE_PLUGIN_DATA`) que sobrevive às atualizações.
//!
//! Segurança: ganchos, conectores locais e `bin/` executam código do plugin. Plugin que traz algum deles entra
//! desligado e a interface mostra os comandos antes de ligar.

use crate::app::{is_inside, normalize, now_ms, read_json, slug, App};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};
use std::time::Duration;

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Market {
    pub name: String,
    /// O que o usuário digitou (owner/repo, URL, pasta).
    pub source: String,
    pub path: PathBuf,
    #[serde(default)]
    pub updated: u64,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub owner: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Installed {
    /// nome@loja
    pub id: String,
    pub name: String,
    pub market: String,
    #[serde(default)]
    pub version: String,
    pub path: PathBuf,
    pub enabled: bool,
    #[serde(default)]
    pub installed: u64,
    #[serde(default)]
    pub description: String,
    /// Entrada da loja (com `strict: false` os componentes vêm daqui).
    #[serde(default)]
    pub entry: Value,
    /// De onde veio (para atualizar).
    #[serde(default)]
    pub source: Value,
}

#[derive(Serialize, Deserialize, Default)]
pub struct State {
    #[serde(default)]
    pub markets: Vec<Market>,
    #[serde(default)]
    pub plugins: Vec<Installed>,
}

fn base(root: &Path) -> PathBuf {
    root.join("plugins")
}
fn state_file(root: &Path) -> PathBuf {
    base(root).join("state.json")
}
pub fn load(root: &Path) -> State {
    read_json(&state_file(root)).unwrap_or_default()
}
fn save(root: &Path, s: &State) -> Result<(), String> {
    let f = state_file(root);
    std::fs::create_dir_all(f.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = f.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(s).unwrap()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &f).map_err(|e| e.to_string())
}

/// Uma operação de cada vez (instalar, remover, atualizar).
fn lock() -> &'static tokio::sync::Mutex<()> {
    static M: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    M.get_or_init(Default::default)
}

fn data_dir(root: &Path, id: &str) -> PathBuf {
    base(root).join("data").join(safe_id(id))
}
fn safe_id(id: &str) -> String {
    id.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '@') { c } else { '-' }).collect()
}

// ---------------------------------------------------------------- PATH (bin/ dos plugins ligados)

fn bins() -> &'static RwLock<Vec<PathBuf>> {
    static B: OnceLock<RwLock<Vec<PathBuf>>> = OnceLock::new();
    B.get_or_init(Default::default)
}
pub fn bin_dirs() -> Vec<PathBuf> {
    bins().read().unwrap().clone()
}
/// Relê as pastas bin/ dos plugins ligados (no início e depois de cada mudança).
pub fn refresh(root: &Path) {
    let v = load(root).plugins.iter().filter(|p| p.enabled).map(|p| p.path.join("bin")).filter(|d| d.is_dir()).collect();
    *bins().write().unwrap() = v;
}

// ---------------------------------------------------------------- componentes

fn manifest(dir: &Path) -> Value {
    read_json(&dir.join(".claude-plugin").join("plugin.json")).or_else(|| read_json(&dir.join("plugin.json"))).unwrap_or_else(|| json!({}))
}

/// Campo do manifesto que aceita texto ou lista de textos (caminhos `./...`).
fn paths_of(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect(),
        _ => vec![],
    }
}

/// Caminho relativo à pasta do plugin, sem sair dela.
fn inside(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel = rel.replace("${CLAUDE_PLUGIN_ROOT}", ".");
    let p = normalize(&root.join(rel.trim_start_matches("./")));
    is_inside(root, &p).then_some(p)
}

/// Troca ${CLAUDE_PLUGIN_ROOT}, ${CLAUDE_PLUGIN_DATA} (e ${CLAUDE_PROJECT_DIR}, se dado) em todos os textos.
fn subst(v: &mut Value, vars: &[(&str, String)]) {
    match v {
        Value::String(s) => {
            for (k, val) in vars {
                if s.contains(k) {
                    *s = s.replace(&format!("${{{k}}}"), val).replace(&format!("${k}"), val);
                }
            }
        }
        Value::Array(a) => a.iter_mut().for_each(|x| subst(x, vars)),
        Value::Object(o) => o.values_mut().for_each(|x| subst(x, vars)),
        _ => {}
    }
}

#[derive(Default)]
pub struct Comps {
    pub skills: Vec<PathBuf>,
    pub commands: Vec<PathBuf>,
    pub agents: Vec<PathBuf>,
    /// {Evento: [grupos]} já com as variáveis trocadas
    pub hooks: Map<String, Value>,
    pub mcp: Map<String, Value>,
    pub bin: bool,
    pub errors: Vec<String>,
}

fn md_files(p: &Path, acc: &mut Vec<PathBuf>) {
    if p.is_file() {
        if p.extension().is_some_and(|e| e.eq_ignore_ascii_case("md")) {
            acc.push(p.to_path_buf());
        }
        return;
    }
    for e in walkdir::WalkDir::new(p).max_depth(3).into_iter().flatten() {
        let n = e.file_name().to_string_lossy();
        if e.file_type().is_file() && n.to_lowercase().ends_with(".md") && !n.eq_ignore_ascii_case("README.md") && !acc.contains(&e.path().to_path_buf()) {
            acc.push(e.path().to_path_buf());
        }
    }
}

fn merge_hooks(into: &mut Map<String, Value>, v: &Value) {
    // hooks.json: {"description":..., "hooks": {Evento: [...]}}; no plugin.json pode vir direto {Evento: [...]}
    let h = v.get("hooks").filter(|h| h.is_object()).unwrap_or(v);
    for (ev, groups) in h.as_object().into_iter().flatten() {
        if let Some(a) = groups.as_array() {
            let e = into.entry(ev.clone()).or_insert_with(|| json!([]));
            e.as_array_mut().unwrap().extend(a.iter().cloned());
        }
    }
}

fn merge_mcp(into: &mut Map<String, Value>, v: &Value) {
    let m = v.get("mcpServers").filter(|h| h.is_object()).unwrap_or(v);
    for (k, c) in m.as_object().into_iter().flatten() {
        if c.get("command").is_some() || c.get("url").is_some() {
            into.insert(k.clone(), c.clone());
        }
    }
}

pub fn comps(root: &Path, p: &Installed) -> Comps {
    let dir = &p.path;
    let man = manifest(dir);
    let mut c = Comps::default();
    // strict (padrão): o plugin.json manda e a entrada da loja soma; strict:false: só a entrada da loja
    let strict = p.entry.get("strict").and_then(Value::as_bool).unwrap_or(true);
    let srcs: Vec<&Value> = if strict { vec![&man, &p.entry] } else { vec![&p.entry] };
    let field = |k: &str| -> Vec<String> { srcs.iter().flat_map(|m| paths_of(m.get(k))).collect() };

    // skills: pastas com SKILL.md (a padrão e as do manifesto, que somam)
    let mut sk = vec![dir.join("skills")];
    sk.extend(field("skills").iter().filter_map(|r| inside(dir, r)));
    for s in sk {
        if s.join("SKILL.md").is_file() {
            if !c.skills.contains(&s) {
                c.skills.push(s);
            }
        } else if let Ok(rd) = std::fs::read_dir(&s) {
            let mut v: Vec<_> = rd.flatten().map(|e| e.path()).filter(|x| x.join("SKILL.md").is_file()).collect();
            v.sort();
            for x in v {
                if !c.skills.contains(&x) {
                    c.skills.push(x);
                }
            }
        }
    }
    let mut cm = vec![dir.join("commands")];
    cm.extend(field("commands").iter().filter_map(|r| inside(dir, r)));
    for x in cm.iter().filter(|x| x.exists()) {
        md_files(x, &mut c.commands);
    }
    let mut ag = vec![dir.join("agents")];
    ag.extend(field("agents").iter().filter_map(|r| inside(dir, r)));
    for x in ag.iter().filter(|x| x.exists()) {
        md_files(x, &mut c.agents);
    }

    // ganchos: hooks/hooks.json + o que o manifesto apontar (caminho, lista ou objeto)
    let mut hk = vec![dir.join("hooks").join("hooks.json")];
    for m in &srcs {
        match m.get("hooks") {
            Some(v @ Value::Object(_)) => merge_hooks(&mut c.hooks, v),
            v => hk.extend(paths_of(v).iter().filter_map(|r| inside(dir, r))),
        }
    }
    hk.dedup();
    for f in hk.iter().filter(|f| f.is_file()) {
        match std::fs::read_to_string(f).ok().and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok()) {
            Some(v) => merge_hooks(&mut c.hooks, &v),
            None => c.errors.push(LF!("{} não é um JSON válido", "{} is not valid JSON", f.display())),
        }
    }
    // conectores: .mcp.json + mcpServers do manifesto
    let mut mf = vec![dir.join(".mcp.json")];
    for m in &srcs {
        match m.get("mcpServers") {
            Some(v @ Value::Object(_)) => merge_mcp(&mut c.mcp, v),
            v => mf.extend(paths_of(v).iter().filter_map(|r| inside(dir, r))),
        }
    }
    mf.dedup();
    for f in mf.iter().filter(|f| f.is_file()) {
        match std::fs::read_to_string(f).ok().and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok()) {
            Some(v) => merge_mcp(&mut c.mcp, &v),
            None => c.errors.push(LF!("{} não é um JSON válido", "{} is not valid JSON", f.display())),
        }
    }
    let vars = vars_of(root, p, None);
    let mut h = Value::Object(std::mem::take(&mut c.hooks));
    subst(&mut h, &vars);
    c.hooks = h.as_object().cloned().unwrap_or_default();
    let mut m = Value::Object(std::mem::take(&mut c.mcp));
    subst(&mut m, &vars);
    c.mcp = m.as_object().cloned().unwrap_or_default();
    c.bin = dir.join("bin").is_dir();
    c
}

/// Caminho com barras normais: os comandos dos ganchos rodam no bash (Git Bash no Windows), onde `\` escapa.
fn fwd(p: &Path) -> String {
    let s = p.to_string_lossy().into_owned();
    if cfg!(windows) {
        s.replace('\\', "/")
    } else {
        s
    }
}

fn vars_of(root: &Path, p: &Installed, project: Option<&Path>) -> Vec<(&'static str, String)> {
    let mut v = vec![("CLAUDE_PLUGIN_ROOT", fwd(&p.path)), ("CLAUDE_PLUGIN_DATA", fwd(&data_dir(root, &p.id)))];
    if let Some(d) = project {
        v.push(("CLAUDE_PROJECT_DIR", fwd(d)));
    }
    v
}

/// Nome do conector MCP de um plugin dentro do studio.
fn mcp_name(plugin: &str, server: &str) -> String {
    let (p, s) = (slug(plugin), slug(server));
    if p == s {
        s
    } else {
        format!("{p}-{s}")
    }
}

/// Conectores dos plugins ligados (o mcp.json do usuário vence se tiver o mesmo nome). `root` = pasta de dados.
pub fn mcp_servers(root: &Path) -> Map<String, Value> {
    let mut out = Map::new();
    for p in load(root).plugins.iter().filter(|p| p.enabled) {
        for (k, mut c) in comps(root, p).mcp {
            if let Some(o) = c.as_object_mut() {
                o.insert("_plugin".into(), json!(p.name));
                let env = o.entry("env").or_insert_with(|| json!({}));
                if let Some(e) = env.as_object_mut() {
                    e.insert("CLAUDE_PLUGIN_ROOT".into(), json!(p.path.to_string_lossy()));
                    e.insert("CLAUDE_PLUGIN_DATA".into(), json!(data_dir(root, &p.id).to_string_lossy()));
                }
            }
            out.insert(mcp_name(&p.name, &k), c);
        }
    }
    out
}

/// `${VAR}` e `${VAR:-padrão}` com as variáveis de ambiente (como o Claude Code faz no .mcp.json dos plugins).
pub fn expand_env(s: &str) -> String {
    let re = regex_lite::Regex::new(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}").unwrap();
    re.replace_all(s, |c: &regex_lite::Captures| std::env::var(&c[1]).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| c.get(2).map(|m| m.as_str().to_string()).unwrap_or_default())).into_owned()
}

/// Pastas de skills dos plugins ligados: (pasta da skill, nome do plugin).
pub fn skill_dirs(root: &Path) -> Vec<(PathBuf, String)> {
    let mut out = vec![];
    for p in load(root).plugins.iter().filter(|p| p.enabled) {
        for s in comps(root, p).skills {
            out.push((s, p.name.clone()));
        }
    }
    out
}

// ---------------------------------------------------------------- comandos e agentes

fn stem(p: &Path) -> String {
    p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

fn command_json(p: &Installed, f: &Path) -> Value {
    let text = std::fs::read_to_string(f).unwrap_or_default();
    let (meta, body) = crate::skills::parse_frontmatter(&text);
    let name = format!("{}:{}", p.name, stem(f));
    json!({
        "id": format!("plugin:{name}"),
        "name": name,
        "plugin": p.name,
        "description": meta.get("description").cloned().unwrap_or_else(|| body.lines().find(|l| !l.trim().is_empty() && !l.starts_with('#')).unwrap_or("").chars().take(120).collect()),
        "hint": meta.get("argument-hint").cloned().unwrap_or_default(),
        "args": body.contains("$ARGUMENTS") || regex_lite::Regex::new(r"\$[1-9]").unwrap().is_match(&body),
        "file": f,
    })
}

fn agent_json(p: &Installed, f: &Path) -> Value {
    let text = std::fs::read_to_string(f).unwrap_or_default();
    let (meta, body) = crate::skills::parse_frontmatter(&text);
    let name = meta.get("name").cloned().filter(|s| !s.is_empty()).unwrap_or_else(|| stem(f));
    let vars = vars_of(&PathBuf::new(), p, None);
    let mut b = Value::String(body.trim().to_string());
    subst(&mut b, &vars[..1]);
    json!({
        "id": format!("plugin:{}:{}", p.name, slug(&name)),
        "name": name,
        "plugin": p.name,
        "description": meta.get("description").cloned().unwrap_or_default(),
        "model": meta.get("model").cloned().unwrap_or_default(),
        "tools": meta.get("tools").cloned().unwrap_or_default(),
        "prompt": b,
    })
}

/// Tudo que a interface precisa: plugins, lojas, comandos, agentes e quais eventos têm ganchos.
pub fn summary(root: &Path) -> Value {
    let s = load(root);
    let mut plugins = vec![];
    let mut commands = vec![];
    let mut agents = vec![];
    let mut events: Map<String, Value> = Map::new();
    for p in &s.plugins {
        let c = comps(root, p);
        let hooks: Vec<Value> = c
            .hooks
            .iter()
            .flat_map(|(ev, groups)| {
                groups.as_array().into_iter().flatten().flat_map(move |g| {
                    let m = g.get("matcher").and_then(Value::as_str).unwrap_or("").to_string();
                    g.get("hooks").and_then(Value::as_array).into_iter().flatten().map(move |h| {
                        json!({"event": ev, "matcher": m, "type": h.get("type").and_then(Value::as_str).unwrap_or("command"),
                               "command": h.get("command").or_else(|| h.get("url")).or_else(|| h.get("prompt")).and_then(Value::as_str).unwrap_or(""),
                               "async": h.get("async").and_then(Value::as_bool).unwrap_or(false) || h.get("asyncRewake").and_then(Value::as_bool).unwrap_or(false)})
                    })
                })
            })
            .collect();
        if p.enabled {
            for h in &hooks {
                let ev = h["event"].as_str().unwrap_or("").to_string();
                let e = events.entry(ev).or_insert_with(|| json!({"count": 0, "async": false}));
                e["count"] = json!(e["count"].as_u64().unwrap_or(0) + 1);
                if h["async"].as_bool() == Some(true) {
                    e["async"] = json!(true);
                }
            }
            commands.extend(c.commands.iter().map(|f| command_json(p, f)));
            agents.extend(c.agents.iter().map(|f| agent_json(p, f)));
        }
        let mcp: Vec<Value> = c.mcp.iter().map(|(k, v)| json!({"name": mcp_name(&p.name, k), "command": v.get("command"), "args": v.get("args"), "url": v.get("url")})).collect();
        let man = manifest(&p.path);
        plugins.push(json!({
            "id": p.id, "name": p.name, "market": p.market, "version": p.version, "enabled": p.enabled,
            "description": if p.description.is_empty() { man["description"].as_str().unwrap_or("").to_string() } else { p.description.clone() },
            "author": man["author"]["name"].as_str().or(p.entry["author"]["name"].as_str()).unwrap_or(""),
            "homepage": man["homepage"].as_str().or(man["repository"].as_str()).or(p.entry["homepage"].as_str()).unwrap_or(""),
            "installed": p.installed, "path": p.path,
            "skills": c.skills.iter().map(|d| crate::app::file_name(d)).collect::<Vec<_>>(),
            "commands": c.commands.iter().map(|f| format!("{}:{}", p.name, stem(f))).collect::<Vec<_>>(),
            "agents": c.agents.iter().map(|f| stem(f)).collect::<Vec<_>>(),
            "hooks": hooks, "mcp": mcp, "bin": c.bin, "errors": c.errors,
        }));
    }
    json!({"plugins": plugins, "markets": s.markets, "commands": commands, "agents": agents, "events": events})
}

/// O que vai na tela de confiança: tudo que executa código.
pub fn runs_code(root: &Path, p: &Installed) -> bool {
    let c = comps(root, p);
    !c.hooks.is_empty() || c.mcp.values().any(|m| m.get("command").is_some()) || c.bin
}

// ---------------------------------------------------------------- baixar

const MAX_DL: usize = 300 * 1024 * 1024;

enum Src {
    Local(PathBuf),
    /// owner/repo, ref, subpasta
    Github(String, String, String),
    /// URL git, ref, subpasta
    Git(String, String, String),
    Archive(String, String),
    /// URL direto de um marketplace.json
    MarketJson(String),
}

fn gh_repo(s: &str) -> Option<String> {
    let re = regex_lite::Regex::new(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$").unwrap();
    re.is_match(s).then(|| s.trim_end_matches(".git").to_string())
}

/// O que o usuário digitou: owner/repo[@ref], URL do GitHub (com /tree/ref/pasta), URL git, .zip/.tar.gz, pasta.
fn parse_input(s: &str) -> Result<Src, String> {
    let s = s.trim().trim_end_matches('/');
    if s.is_empty() {
        return Err(L!("Informe um repositório, URL ou pasta.", "Enter a repository, URL or folder.").into());
    }
    let p = match s.strip_prefix("~/").or_else(|| s.strip_prefix("~\\")) {
        Some(rest) => crate::app::home_dir().join(rest),
        None => PathBuf::from(s),
    };
    if p.is_absolute() && p.exists() {
        return Ok(Src::Local(p));
    }
    let (main, rref) = match s.rsplit_once(['@', '#']) {
        Some((a, b)) if !s.starts_with("git@") && !a.contains("://") || (a.contains("://") && s.contains('#')) => (a, b.to_string()),
        _ => (s, String::new()),
    };
    if let Some(r) = gh_repo(main) {
        return Ok(Src::Github(r, rref, String::new()));
    }
    let lower = main.to_lowercase();
    if lower.ends_with(".zip") || lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        return Ok(Src::Archive(main.to_string(), String::new()));
    }
    if lower.ends_with(".json") && lower.starts_with("http") {
        return Ok(Src::MarketJson(main.to_string()));
    }
    let gh = regex_lite::Regex::new(r"^https?://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?(?:/tree/([^/]+)(?:/(.+))?)?$").unwrap();
    if let Some(c) = gh.captures(main) {
        let r = c.get(2).map(|m| m.as_str().to_string()).unwrap_or(rref);
        return Ok(Src::Github(c[1].to_string(), r, c.get(3).map(|m| m.as_str().to_string()).unwrap_or_default()));
    }
    if main.starts_with("https://") || main.starts_with("http://") || main.starts_with("git@") || main.starts_with("ssh://") {
        return Ok(Src::Git(main.to_string(), rref, String::new()));
    }
    Err(LF!("Não entendi \"{s}\". Use owner/repo, uma URL git ou uma pasta.", "Couldn't parse \"{s}\". Use owner/repo, a git URL or a folder."))
}

/// A `source` de uma entrada do marketplace.json.
fn parse_entry_source(v: &Value, market_dir: &Path, plugin_root: &str) -> Result<Src, String> {
    if let Some(s) = v.as_str() {
        if s.starts_with("http") || s.starts_with("git@") {
            return parse_input(s);
        }
        let rel = if !plugin_root.is_empty() && !s.starts_with("./") && !s.starts_with("../") { format!("{}/{}", plugin_root.trim_end_matches('/'), s) } else { s.to_string() };
        let p = normalize(&market_dir.join(rel.trim_start_matches("./")));
        if !is_inside(market_dir, &p) {
            return Err(L!("O caminho do plugin sai da pasta da loja.", "The plugin path leaves the marketplace folder.").into());
        }
        return Ok(Src::Local(p));
    }
    let kind = v["source"].as_str().unwrap_or("");
    let rref = v["sha"].as_str().or(v["ref"].as_str()).unwrap_or("").to_string();
    let sub = v["path"].as_str().unwrap_or("").to_string();
    match kind {
        "github" => {
            let r = gh_repo(v["repo"].as_str().unwrap_or("")).ok_or(L!("Repositório inválido na loja.", "Invalid repository in the marketplace."))?;
            Ok(Src::Github(r, rref, sub))
        }
        "url" | "git" | "git-subdir" => {
            let u = v["url"].as_str().unwrap_or("");
            match parse_input(u)? {
                Src::Github(r, _, _) => Ok(Src::Github(r, rref, sub)),
                Src::Git(u, _, _) => Ok(Src::Git(u, rref, sub)),
                other => Ok(other),
            }
        }
        "archive" => Ok(Src::Archive(v["url"].as_str().unwrap_or("").to_string(), v["sha256"].as_str().unwrap_or("").to_string())),
        "npm" | "pip" => Err(LF!("Plugins via {kind} ainda não são suportados aqui.", "Plugins from {kind} aren't supported here yet.")),
        other => Err(LF!("Origem de plugin desconhecida: {other}", "Unknown plugin source: {other}")),
    }
}

async fn download(app: &App, url: &str) -> Result<Vec<u8>, String> {
    let r = app.web.get(url).header("User-Agent", "llama-studio").send().await.map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(LF!("{url}: HTTP {}", "{url}: HTTP {}", r.status().as_u16()));
    }
    if r.content_length().is_some_and(|n| n as usize > MAX_DL) {
        return Err(L!("Arquivo grande demais.", "File too large.").into());
    }
    let mut out = vec![];
    let mut st = r.bytes_stream();
    use futures_util::StreamExt;
    while let Some(c) = st.next().await {
        out.extend_from_slice(&c.map_err(|e| e.to_string())?);
        if out.len() > MAX_DL {
            return Err(L!("Arquivo grande demais.", "File too large.").into());
        }
    }
    Ok(out)
}

/// Extrai num diretório vazio e devolve a pasta de cima se o pacote tiver uma só (zip do GitHub).
fn unpack(bytes: &[u8], name: &str, out: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(out).map_err(|e| e.to_string())?;
    let n = name.to_lowercase();
    if n.ends_with(".tar.gz") || n.ends_with(".tgz") {
        let f = out.with_extension("tgz");
        std::fs::write(&f, bytes).map_err(|e| e.to_string())?;
        let st = std::process::Command::new("tar").arg("-xzf").arg(&f).arg("-C").arg(out).status().map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&f);
        if !st.success() {
            return Err(L!("Não consegui extrair o .tar.gz.", "Couldn't extract the .tar.gz.").into());
        }
    } else {
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| LF!("Não consegui abrir o .zip: {e}", "Couldn't open the .zip: {e}"))?;
        z.extract(out).map_err(|e| LF!("Não consegui extrair o .zip: {e}", "Couldn't extract the .zip: {e}"))?;
    }
    let entries: Vec<_> = std::fs::read_dir(out).map_err(|e| e.to_string())?.flatten().filter(|e| e.file_name() != "__MACOSX").collect();
    Ok(if entries.len() == 1 && entries[0].path().is_dir() { entries[0].path() } else { out.to_path_buf() })
}

async fn git(args: &[&str], cwd: Option<&Path>) -> Result<(), String> {
    let exe = crate::bins::which("git").ok_or(L!("Essa origem precisa do git instalado.", "This source needs git installed."))?;
    let mut c = tokio::process::Command::new(exe);
    c.args(args).env("GIT_TERMINAL_PROMPT", "0").stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::piped());
    if let Some(d) = cwd {
        c.current_dir(d);
    }
    #[cfg(windows)]
    c.creation_flags(crate::CREATE_NO_WINDOW);
    let o = tokio::time::timeout(Duration::from_secs(300), c.output()).await.map_err(|_| "git: timeout".to_string())?.map_err(|e| e.to_string())?;
    if !o.status.success() {
        return Err(format!("git {}: {}", args.first().unwrap_or(&""), String::from_utf8_lossy(&o.stderr).trim()));
    }
    Ok(())
}

/// Baixa a origem numa pasta temporária (`tmp`) e devolve a pasta com o conteúdo (já na subpasta pedida).
async fn fetch(app: &App, src: &Src, tmp: &Path) -> Result<PathBuf, String> {
    let sub_of = |d: PathBuf, sub: &str| -> Result<PathBuf, String> {
        if sub.is_empty() {
            return Ok(d);
        }
        let p = normalize(&d.join(sub.trim_start_matches("./")));
        if !is_inside(&d, &p) || !p.is_dir() {
            return Err(LF!("Pasta \"{sub}\" não encontrada no repositório.", "Folder \"{sub}\" not found in the repository."));
        }
        Ok(p)
    };
    match src {
        Src::Local(p) => Ok(p.clone()),
        Src::Github(repo, rref, sub) => {
            let r = if rref.is_empty() { "HEAD" } else { rref };
            let bytes = download(app, &format!("https://github.com/{repo}/archive/{r}.zip")).await?;
            let d = unpack(&bytes, "x.zip", &tmp.join("x"))?;
            sub_of(d, sub)
        }
        Src::Git(url, rref, sub) => {
            let d = tmp.join("x");
            let ds = d.to_string_lossy().into_owned();
            let is_sha = rref.len() >= 7 && rref.chars().all(|c| c.is_ascii_hexdigit());
            if rref.is_empty() || is_sha {
                git(&["clone", "--depth", "1", "--", url, &ds], None).await?;
                if is_sha {
                    git(&["fetch", "--depth", "1", "origin", rref], Some(&d)).await?;
                    git(&["checkout", "-q", rref], Some(&d)).await?;
                }
            } else {
                git(&["clone", "--depth", "1", "--branch", rref, "--", url, &ds], None).await?;
            }
            let _ = std::fs::remove_dir_all(d.join(".git"));
            sub_of(d, sub)
        }
        Src::Archive(url, sha) => {
            let bytes = download(app, url).await?;
            if !sha.is_empty() {
                use sha2::Digest;
                let got = format!("{:x}", sha2::Sha256::digest(&bytes));
                if !got.eq_ignore_ascii_case(sha) {
                    return Err(L!("O sha256 do pacote não confere.", "The package sha256 doesn't match.").into());
                }
            }
            unpack(&bytes, url.split('?').next().unwrap_or(url), &tmp.join("x"))
        }
        Src::MarketJson(url) => {
            let bytes = download(app, url).await?;
            let _: Value = serde_json::from_slice(&bytes).map_err(|e| LF!("marketplace.json inválido: {e}", "invalid marketplace.json: {e}"))?;
            let d = tmp.join("x").join(".claude-plugin");
            std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
            std::fs::write(d.join("marketplace.json"), bytes).map_err(|e| e.to_string())?;
            Ok(tmp.join("x"))
        }
    }
}

fn tmp_dir(root: &Path) -> PathBuf {
    let d = base(root).join("tmp").join(format!("{:x}", now_ms()));
    let _ = std::fs::create_dir_all(&d);
    d
}

fn market_json(dir: &Path) -> Option<Value> {
    read_json(&dir.join(".claude-plugin").join("marketplace.json")).or_else(|| read_json(&dir.join("marketplace.json")))
}

fn is_plugin_dir(d: &Path) -> bool {
    d.join(".claude-plugin").join("plugin.json").is_file() || ["skills", "commands", "agents", "hooks"].iter().any(|x| d.join(x).is_dir()) || d.join(".mcp.json").is_file()
}

/// Copia (substituindo) para `dst`.
fn put(src: &Path, dst: &Path) -> Result<(), String> {
    let _ = std::fs::remove_dir_all(dst);
    std::fs::create_dir_all(dst.parent().unwrap()).map_err(|e| e.to_string())?;
    crate::app::copy_dir(src, dst).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(dst.join(".git"));
    Ok(())
}

// ---------------------------------------------------------------- lojas

/// Adiciona (ou atualiza) uma loja. Se a origem for um plugin só (sem marketplace.json), instala direto.
pub async fn add(app: &App, input: &str) -> Result<Value, String> {
    let _g = lock().lock().await;
    let src = parse_input(input)?;
    let tmp = tmp_dir(&app.root);
    let r = add_inner(app, input, &src, &tmp).await;
    let _ = std::fs::remove_dir_all(&tmp);
    refresh(&app.root);
    r
}

async fn add_inner(app: &App, input: &str, src: &Src, tmp: &Path) -> Result<Value, String> {
    let dir = fetch(app, src, tmp).await?;
    if let Some(m) = market_json(&dir) {
        let name = m["name"].as_str().map(slug).filter(|s| !s.is_empty()).unwrap_or_else(|| slug(input));
        let dst = base(&app.root).join("markets").join(&name);
        // pasta local: a loja aponta para ela (o usuário edita no lugar)
        let path = if let Src::Local(p) = src { p.clone() } else { put(&dir, &dst).map(|_| dst)? };
        let mut s = load(&app.root);
        s.markets.retain(|x| x.name != name);
        s.markets.push(Market {
            name: name.clone(),
            source: input.trim().to_string(),
            path,
            updated: now_ms() as u64,
            description: m["description"].as_str().or(m["metadata"]["description"].as_str()).unwrap_or("").to_string(),
            owner: m["owner"]["name"].as_str().unwrap_or("").to_string(),
        });
        save(&app.root, &s)?;
        return Ok(json!({"market": name, "plugins": m["plugins"].as_array().map(|a| a.len()).unwrap_or(0)}));
    }
    if is_plugin_dir(&dir) {
        let man = manifest(&dir);
        let name = man["name"].as_str().map(slug).filter(|s| !s.is_empty()).unwrap_or_else(|| slug(&crate::app::file_name(&dir)));
        let source = json!({"input": input.trim()});
        let p = place(app, &dir, &name, "local", json!({}), source)?;
        return Ok(json!({"installed": p}));
    }
    Err(L!(
        "Não achei .claude-plugin/marketplace.json nem um plugin (plugin.json, skills/, commands/, agents/, hooks/) nessa origem.",
        "No .claude-plugin/marketplace.json or plugin (plugin.json, skills/, commands/, agents/, hooks/) found at that source."
    )
    .into())
}

pub fn remove_market(app: &App, name: &str) -> Result<(), String> {
    let mut s = load(&app.root);
    let Some(m) = s.markets.iter().find(|m| m.name == name).cloned() else { return Ok(()) };
    if is_inside(&base(&app.root), &m.path) {
        let _ = std::fs::remove_dir_all(&m.path);
    }
    s.markets.retain(|x| x.name != name);
    save(&app.root, &s)
}

/// Os plugins de uma loja (com a marca de instalado).
pub fn catalog(app: &App, name: &str) -> Result<Value, String> {
    let s = load(&app.root);
    let m = s.markets.iter().find(|m| m.name == name).ok_or(L!("Loja não encontrada.", "Marketplace not found."))?;
    let j = market_json(&m.path).ok_or(L!("A loja não tem mais o marketplace.json.", "The marketplace no longer has marketplace.json."))?;
    let items: Vec<Value> = j["plugins"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|e| {
            let n = e["name"].as_str().unwrap_or("");
            let id = format!("{}@{}", slug(n), m.name);
            let inst = s.plugins.iter().find(|p| p.id == id);
            json!({
                "name": n, "description": e["description"], "version": e["version"], "category": e["category"],
                "author": e["author"]["name"], "homepage": e["homepage"], "keywords": e["keywords"],
                "remote": !e["source"].is_string(),
                "installed": inst.is_some(), "installedVersion": inst.map(|p| p.version.clone()),
            })
        })
        .collect();
    Ok(json!({"market": m, "plugins": items}))
}

// ---------------------------------------------------------------- instalar

/// Copia a pasta do plugin para dentro do studio e registra (desligado se executa código).
fn place(app: &App, dir: &Path, name: &str, market: &str, entry: Value, source: Value) -> Result<Value, String> {
    let id = format!("{name}@{market}");
    let dst = base(&app.root).join("installed").join(safe_id(&id));
    put(dir, &dst)?;
    let man = manifest(&dst);
    let mut s = load(&app.root);
    let was = s.plugins.iter().find(|p| p.id == id).map(|p| p.enabled);
    let mut p = Installed {
        id: id.clone(),
        name: name.into(),
        market: market.into(),
        version: man["version"].as_str().or(entry["version"].as_str()).unwrap_or("").to_string(),
        path: dst,
        enabled: false,
        installed: now_ms() as u64,
        description: entry["description"].as_str().or(man["description"].as_str()).unwrap_or("").to_string(),
        entry,
        source,
    };
    let code = runs_code(&app.root, &p);
    // atualização mantém o estado; novo: liga direto se não roda nada
    p.enabled = was.unwrap_or(!code);
    let _ = std::fs::create_dir_all(data_dir(&app.root, &id));
    s.plugins.retain(|x| x.id != id);
    s.plugins.push(p);
    save(&app.root, &s)?;
    Ok(json!({"id": id, "enabled": was.unwrap_or(!code), "needsTrust": code && was.is_none()}))
}

pub async fn install(app: &App, market: &str, name: &str) -> Result<Value, String> {
    let _g = lock().lock().await;
    let s = load(&app.root);
    let m = s.markets.iter().find(|m| m.name == market).cloned().ok_or(L!("Loja não encontrada.", "Marketplace not found."))?;
    let j = market_json(&m.path).ok_or(L!("A loja não tem marketplace.json.", "The marketplace has no marketplace.json."))?;
    let entry = j["plugins"].as_array().into_iter().flatten().find(|e| e["name"].as_str() == Some(name)).cloned().ok_or(L!("Plugin não encontrado na loja.", "Plugin not found in the marketplace."))?;
    let root = j["metadata"]["pluginRoot"].as_str().unwrap_or("");
    let src = parse_entry_source(&entry["source"], &m.path, root)?;
    let tmp = tmp_dir(&app.root);
    let r = async {
        let dir = fetch(app, &src, &tmp).await?;
        if !dir.is_dir() {
            return Err(L!("A pasta do plugin não existe na loja.", "The plugin folder doesn't exist in the marketplace.").into());
        }
        place(app, &dir, &slug(name), market, entry.clone(), json!({"market": market}))
    }
    .await;
    let _ = std::fs::remove_dir_all(&tmp);
    refresh(&app.root);
    r
}

/// Baixa de novo: da loja (que também é atualizada) ou da origem direta.
pub async fn update(app: &App, id: &str) -> Result<Value, String> {
    let p = load(&app.root).plugins.into_iter().find(|p| p.id == id).ok_or(L!("Plugin não instalado.", "Plugin not installed."))?;
    if p.market == "local" {
        let input = p.source["input"].as_str().unwrap_or("").to_string();
        return add(app, &input).await;
    }
    let m = load(&app.root).markets.into_iter().find(|m| m.name == p.market);
    if let Some(m) = m {
        if !matches!(parse_input(&m.source), Ok(Src::Local(_))) {
            add(app, &m.source).await?;
        }
    }
    let name = p.entry["name"].as_str().unwrap_or(&p.name).to_string();
    install(app, &p.market, &name).await
}

pub fn set_enabled(app: &App, id: &str, on: bool) -> Result<(), String> {
    let mut s = load(&app.root);
    let p = s.plugins.iter_mut().find(|p| p.id == id).ok_or(L!("Plugin não instalado.", "Plugin not installed."))?;
    p.enabled = on;
    save(&app.root, &s)?;
    refresh(&app.root);
    Ok(())
}

pub fn uninstall(app: &App, id: &str, keep_data: bool) -> Result<(), String> {
    let mut s = load(&app.root);
    if let Some(p) = s.plugins.iter().find(|p| p.id == id) {
        if is_inside(&base(&app.root), &p.path) {
            let _ = std::fs::remove_dir_all(&p.path);
        }
        if !keep_data {
            let _ = std::fs::remove_dir_all(data_dir(&app.root, id));
        }
    }
    s.plugins.retain(|p| p.id != id);
    save(&app.root, &s)?;
    refresh(&app.root);
    Ok(())
}

// ---------------------------------------------------------------- execução (ganchos e comandos)

/// O shell dos ganchos: bash (Git Bash no Windows, que é o que os plugins esperam), senão sh / cmd.
fn shell() -> (PathBuf, Vec<&'static str>) {
    #[cfg(windows)]
    {
        let mut cands = vec![PathBuf::from(r"C:\Program Files\Git\bin\bash.exe"), PathBuf::from(r"C:\Program Files (x86)\Git\bin\bash.exe")];
        if let Some(g) = crate::bins::which("git") {
            // ...\Git\cmd\git.exe → ...\Git\bin\bash.exe
            if let Some(root) = g.parent().and_then(|p| p.parent()) {
                cands.insert(0, root.join("bin").join("bash.exe"));
            }
        }
        if let Some(b) = cands.into_iter().find(|p| p.is_file()) {
            return (b, vec!["-c"]);
        }
        (PathBuf::from("cmd"), vec!["/C"])
    }
    #[cfg(not(windows))]
    {
        match crate::bins::which("bash") {
            Some(b) => (b, vec!["-c"]),
            None => (PathBuf::from("sh"), vec!["-c"]),
        }
    }
}

pub struct Out {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timeout: bool,
}

async fn run_cmd(cmd: &str, stdin: &[u8], cwd: &Path, env: &[(&str, String)], secs: u64) -> Result<Out, String> {
    let (sh, pre) = shell();
    let mut c = tokio::process::Command::new(&sh);
    c.args(&pre).arg(cmd).current_dir(cwd).env("PATH", crate::bins::path_env());
    for (k, v) in env {
        c.env(k, v);
    }
    c.stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)]
    c.creation_flags(crate::CREATE_NO_WINDOW);
    let mut child = c.spawn().map_err(|e| LF!("Não consegui rodar o gancho ({}): {e}", "Couldn't run the hook ({}): {e}", sh.display()))?;
    if let Some(mut si) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        let data = stdin.to_vec();
        tokio::spawn(async move {
            let _ = si.write_all(&data).await;
            let _ = si.shutdown().await;
        });
    }
    match tokio::time::timeout(Duration::from_secs(secs.max(1)), child.wait_with_output()).await {
        Ok(Ok(o)) => {
            let cut = |b: &[u8]| crate::app::truncate(String::from_utf8_lossy(b).into_owned(), 200_000);
            Ok(Out { code: o.status.code(), stdout: cut(&o.stdout), stderr: cut(&o.stderr), timeout: false })
        }
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Ok(Out { code: None, stdout: String::new(), stderr: String::new(), timeout: true }),
    }
}

/// Nome e argumentos das ferramentas do studio no formato do Claude Code (os ganchos esperam Bash, Edit, file_path...).
fn to_cc(name: &str, a: &Value, ws: &Path) -> (String, Value) {
    let s = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let abs = |k: &str| -> String {
        let p = s(k);
        if p.is_empty() {
            return fwd(ws);
        }
        fwd(&crate::app::resolve(ws, &p))
    };
    let mut v = match name {
        "run_command" => ("Bash", json!({"command": s("command"), "description": s("description")})),
        "read_file" => ("Read", json!({"file_path": abs("path"), "offset": a.get("offset"), "limit": a.get("limit")})),
        "write_file" => ("Write", json!({"file_path": abs("path"), "content": s("content")})),
        "edit_file" | "apply_edit" => {
            if let Some(es) = a.get("edits").and_then(Value::as_array) {
                let e: Vec<Value> = es.iter().map(|e| json!({"old_string": e["old_text"].as_str().unwrap_or(""), "new_string": e["new_text"].as_str().unwrap_or("")})).collect();
                ("MultiEdit", json!({"file_path": abs("path"), "edits": e}))
            } else {
                ("Edit", json!({"file_path": abs("path"), "old_string": s("old_text"), "new_string": if a.get("new_text").is_some() { s("new_text") } else { s("patch") }, "replace_all": a.get("replace_all").and_then(Value::as_bool).unwrap_or(false)}))
            }
        }
        "search_files" if a.get("content").and_then(Value::as_str).is_some_and(|c| !c.is_empty()) => ("Grep", json!({"pattern": s("content"), "path": abs("path"), "glob": a.get("name")})),
        "search_files" => ("Glob", json!({"pattern": s("name"), "path": abs("path")})),
        "list_directory" => ("LS", json!({"path": abs("path")})),
        "create_directory" => ("Bash", json!({"command": format!("mkdir -p \"{}\"", abs("path"))})),
        "web_fetch" => ("WebFetch", json!({"url": s("url"), "prompt": s("prompt")})),
        "web_search" => ("WebSearch", json!({"query": s("query")})),
        "update_todos" => ("TodoWrite", json!({"todos": a.get("todos")})),
        "explore" => ("Task", json!({"description": s("task").chars().take(60).collect::<String>(), "prompt": s("task"), "subagent_type": "Explore"})),
        "multi_explore" => ("Task", json!({"description": "multi_explore", "prompt": a.get("subtasks").map(|x| x.to_string()).unwrap_or_default(), "subagent_type": "Explore"})),
        n if n.contains("__") => {
            return (format!("mcp__{n}"), a.clone());
        }
        n => return (n.to_string(), a.clone()),
    };
    // o que não tem equivalente segue com o nome do studio
    if let (Some(o), Some(src)) = (v.1.as_object_mut(), a.as_object()) {
        o.retain(|_, x| !x.is_null());
        for (k, x) in src {
            if !matches!(k.as_str(), "path" | "old_text" | "new_text" | "edits" | "task" | "subtasks" | "content" | "name") && !o.contains_key(k) {
                o.insert(k.clone(), x.clone());
            }
        }
    }
    (v.0.to_string(), v.1)
}

/// `updatedInput` de um gancho (no formato do Claude Code) de volta para os argumentos do studio.
fn from_cc(name: &str, orig: &Value, upd: &Value) -> Value {
    let mut out = orig.clone();
    if !out.is_object() {
        out = json!({});
    }
    let Some(u) = upd.as_object() else { return out };
    let o = out.as_object_mut().unwrap();
    for (k, v) in u {
        let key = match (name, k.as_str()) {
            (_, "file_path") => "path",
            (_, "old_string") => "old_text",
            (_, "new_string") => "new_text",
            ("search_files", "pattern") if orig.get("content").is_some() => "content",
            ("search_files", "pattern") => "name",
            ("explore", "prompt") => "task",
            (_, "edits") => {
                let e: Vec<Value> = v.as_array().into_iter().flatten().map(|e| json!({"old_text": e["old_string"], "new_text": e["new_string"]})).collect();
                o.insert("edits".into(), json!(e));
                continue;
            }
            (_, "description" | "subagent_type") => continue,
            (_, k) => k,
        };
        o.insert(key.into(), v.clone());
    }
    out
}

/// Casa o `matcher` de um grupo: vazio/`*` = tudo; só letras, números, `_ - | ,` e espaço = lista exata; senão regex.
fn matches(matcher: &str, value: &str) -> bool {
    let m = matcher.trim();
    if m.is_empty() || m == "*" {
        return true;
    }
    if m.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '|' | ',' | ' ')) {
        return m.split(['|', ',']).map(str::trim).any(|x| x == value);
    }
    regex_lite::Regex::new(m).map(|r| r.is_match(value)).unwrap_or(false)
}

/// `"if": "Bash(git*commit*)"` (sintaxe das regras de permissão): ferramenta e um padrão com `*` no argumento principal.
fn if_matches(rule: &str, tool: &str, input: &Value) -> bool {
    let rule = rule.trim();
    if rule.is_empty() {
        return true;
    }
    let (t, pat) = match rule.split_once('(') {
        Some((t, rest)) => (t.trim(), Some(rest.trim_end_matches(')'))),
        None => (rule, None),
    };
    if t != tool {
        return false;
    }
    let Some(pat) = pat else { return true };
    let pat = pat.strip_suffix(":*").map(|p| format!("{p}*")).unwrap_or_else(|| pat.to_string());
    let arg = ["command", "file_path", "url", "pattern", "query", "path"].iter().find_map(|k| input.get(*k).and_then(Value::as_str)).unwrap_or("");
    let re = format!("^{}$", regex_lite::escape(&pat).replace(r"\*", ".*"));
    regex_lite::Regex::new(&re).map(|r| r.is_match(arg)).unwrap_or(false)
}

/// Notas de ganchos assíncronos (asyncRewake) que terminaram depois: entram no próximo passo da conversa.
fn pending() -> &'static std::sync::Mutex<Vec<(String, String)>> {
    static P: OnceLock<std::sync::Mutex<Vec<(String, String)>>> = OnceLock::new();
    P.get_or_init(Default::default)
}
pub fn take_pending(session: &str) -> Vec<String> {
    let mut p = pending().lock().unwrap();
    let (mine, rest): (Vec<_>, Vec<_>) = std::mem::take(&mut *p).into_iter().partition(|(s, _)| s == session);
    *p = rest;
    mine.into_iter().map(|x| x.1).collect()
}

/// Grava a conversa no formato JSONL do Claude Code (os ganchos de Stop costumam ler a última resposta dali).
fn write_transcript(root: &Path, session: &str, msgs: &Value) -> Option<PathBuf> {
    let a = msgs.as_array()?;
    let dir = base(root).join("transcripts");
    let _ = std::fs::create_dir_all(&dir);
    let f = dir.join(format!("{}.jsonl", safe_id(session)));
    let mut out = String::new();
    for m in a {
        let role = m["role"].as_str().unwrap_or("");
        if !matches!(role, "user" | "assistant") {
            continue;
        }
        let mut content = vec![];
        if let Some(t) = m["content"].as_str().filter(|t| !t.is_empty()) {
            content.push(json!({"type": "text", "text": t}));
        }
        for tc in m["tool_calls"].as_array().into_iter().flatten() {
            content.push(json!({"type": "tool_use", "id": tc["id"], "name": tc["name"], "input": tc["input"]}));
        }
        let line = json!({"type": role, "sessionId": session, "message": {"role": role, "content": content}});
        out.push_str(&line.to_string());
        out.push('\n');
    }
    std::fs::write(&f, out).ok()?;
    Some(f)
}
fn transcript_of(root: &Path, session: &str) -> PathBuf {
    base(root).join("transcripts").join(format!("{}.jsonl", safe_id(session)))
}

struct One {
    plugin: Installed,
    hook: Value,
}

/// Roda os ganchos de um evento e junta as respostas.
///
/// Entrada (da interface): `{event, session, ws, plan, tool, args, result, isError, prompt, source, transcript,
/// stopActive, last, message}`. Saída: `{ran, block, reason, context[], permission, permissionReason, args,
/// stop, stopReason, messages[], errors[]}`.
pub async fn hook(app: &App, v: &Value) -> Value {
    let event = v["event"].as_str().unwrap_or("");
    let session = v["session"].as_str().unwrap_or("studio").to_string();
    let ws = PathBuf::from(v["ws"].as_str().filter(|s| !s.is_empty()).map(str::to_string).unwrap_or_else(|| app.workspace().to_string_lossy().into_owned()));
    let ws = if ws.is_dir() { ws } else { app.workspace() };
    let root = app.root.clone();
    let tool = v["tool"].as_str().unwrap_or("");
    let args = v.get("args").cloned().unwrap_or(json!({}));
    let (cc_tool, cc_input) = if tool.is_empty() { (String::new(), json!({})) } else { to_cc(tool, &args, &ws) };

    let transcript = if v.get("transcript").is_some_and(Value::is_array) { write_transcript(&root, &session, &v["transcript"]) } else { None }.unwrap_or_else(|| transcript_of(&root, &session));
    let mut input = json!({
        "session_id": session,
        "transcript_path": fwd(&transcript),
        "cwd": fwd(&ws),
        "permission_mode": if v["plan"].as_bool() == Some(true) { "plan" } else { "default" },
        "hook_event_name": event,
    });
    let query: String = match event {
        "PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "PermissionRequest" => {
            input["tool_name"] = json!(cc_tool);
            input["tool_input"] = cc_input.clone();
            input["tool_use_id"] = v["toolUseId"].clone();
            if event == "PostToolUse" {
                let out = v["result"].as_str().unwrap_or("");
                input["tool_response"] = if cc_tool == "Bash" { json!({"stdout": out, "stderr": "", "interrupted": false}) } else { json!({"output": out, "filePath": cc_input.get("file_path"), "success": true}) };
            }
            if event == "PostToolUseFailure" {
                input["error"] = v["result"].clone();
            }
            cc_tool.clone()
        }
        "UserPromptSubmit" => {
            input["prompt"] = v["prompt"].clone();
            String::new()
        }
        "SessionStart" => {
            let s = v["source"].as_str().unwrap_or("startup");
            input["source"] = json!(s);
            s.to_string()
        }
        "Stop" | "SubagentStop" => {
            input["stop_hook_active"] = json!(v["stopActive"].as_bool().unwrap_or(false));
            input["last_assistant_message"] = v["last"].clone();
            String::new()
        }
        "PreCompact" => {
            let t = v["source"].as_str().unwrap_or("auto");
            input["trigger"] = json!(t);
            input["custom_instructions"] = json!("");
            t.to_string()
        }
        "Notification" => {
            input["message"] = v["message"].clone();
            input["notification_type"] = json!("permission_prompt");
            "permission_prompt".into()
        }
        _ => String::new(),
    };

    let mut todo: Vec<One> = vec![];
    for p in load(&root).plugins.into_iter().filter(|p| p.enabled) {
        let c = comps(&root, &p);
        for g in c.hooks.get(event).and_then(Value::as_array).into_iter().flatten() {
            if !matches(g["matcher"].as_str().unwrap_or(""), &query) {
                continue;
            }
            for h in g["hooks"].as_array().into_iter().flatten() {
                if !if_matches(h["if"].as_str().unwrap_or(""), &cc_tool, &cc_input) {
                    continue;
                }
                todo.push(One { plugin: p.clone(), hook: h.clone() });
            }
        }
    }
    let mut res = json!({"ran": 0, "block": false, "reason": "", "context": [], "messages": [], "errors": [], "stop": false, "stopReason": ""});
    if todo.is_empty() {
        return res;
    }
    let stdin = input.to_string().into_bytes();
    let default_t = if event == "UserPromptSubmit" { 30 } else { 600 };
    let mut sync = vec![];
    for o in todo {
        let secs = o.hook["timeout"].as_u64().unwrap_or(default_t);
        let mut env: Vec<(&'static str, String)> = vars_of(&root, &o.plugin, Some(&ws));
        env.push(("CLAUDE_CODE_ENTRYPOINT", "llama-studio".into()));
        env.push(("CLAUDE_CODE_SESSION_ID", session.clone()));
        let _ = std::fs::create_dir_all(data_dir(&root, &o.plugin.id));
        let job = exec(o.hook.clone(), stdin.clone(), ws.clone(), env, secs, app.web.clone());
        let name = o.plugin.name.clone();
        if o.hook["async"].as_bool() == Some(true) || o.hook["asyncRewake"].as_bool() == Some(true) {
            // assíncrono: não segura o agente; o asyncRewake que sair com código 2 vira nota no próximo passo
            let rewake = o.hook["asyncRewake"].as_bool() == Some(true);
            let msg = o.hook["rewakeMessage"].as_str().unwrap_or("").to_string();
            let session = session.clone();
            tokio::spawn(async move {
                if let (true, Ok(out)) = (rewake, job.await) {
                    let text = if out.stderr.trim().is_empty() { out.stdout.trim().to_string() } else { out.stderr.trim().to_string() };
                    if out.code == Some(2) && !text.is_empty() {
                        let note = if msg.is_empty() { format!("[{name}] {text}") } else { format!("[{name}] {msg}\n\n{text}") };
                        pending().lock().unwrap().push((session, note));
                    }
                }
            });
            continue;
        }
        sync.push(async move { (name, job.await) });
    }
    let outs = futures_util::future::join_all(sync).await;
    res["ran"] = json!(outs.len());
    let mut perm = "";
    for (name, r) in outs {
        let out = match r {
            Ok(o) => o,
            Err(e) => {
                push(&mut res, "errors", format!("{name}: {e}"));
                continue;
            }
        };
        if out.timeout {
            push(&mut res, "errors", LF!("{name}: o gancho passou do tempo", "{name}: the hook timed out"));
            continue;
        }
        match out.code {
            Some(2) => {
                res["block"] = json!(true);
                let why = if out.stderr.trim().is_empty() { out.stdout.trim() } else { out.stderr.trim() };
                add_reason(&mut res, why);
            }
            Some(0) => {
                let t = out.stdout.trim();
                let j = t.starts_with('{').then(|| serde_json::from_str::<Value>(t).ok()).flatten();
                let Some(j) = j else {
                    if matches!(event, "SessionStart" | "UserPromptSubmit") && !t.is_empty() {
                        push(&mut res, "context", t.to_string());
                    }
                    continue;
                };
                if j["continue"].as_bool() == Some(false) {
                    res["stop"] = json!(true);
                    if let Some(r) = j["stopReason"].as_str() {
                        res["stopReason"] = json!(r);
                    }
                }
                if let Some(m) = j["systemMessage"].as_str().filter(|m| !m.is_empty()) {
                    push(&mut res, "messages", format!("{name}: {m}"));
                }
                match j["decision"].as_str() {
                    Some("block") => {
                        res["block"] = json!(true);
                        add_reason(&mut res, j["reason"].as_str().unwrap_or(""));
                    }
                    Some("approve") if perm.is_empty() => perm = "allow",
                    _ => {}
                }
                let hs = &j["hookSpecificOutput"];
                if let Some(c) = hs["additionalContext"].as_str().filter(|c| !c.is_empty()) {
                    push(&mut res, "context", c.to_string());
                }
                let d = hs["permissionDecision"].as_str().unwrap_or("");
                let rank = |x: &str| match x {
                    "deny" => 3,
                    "ask" => 2,
                    "allow" => 1,
                    _ => 0,
                };
                if rank(d) > rank(perm) {
                    perm = match d {
                        "deny" => "deny",
                        "ask" => "ask",
                        _ => "allow",
                    };
                    res["permissionReason"] = hs["permissionDecisionReason"].clone();
                }
                if hs["updatedInput"].is_object() && !tool.is_empty() {
                    res["args"] = from_cc(tool, &args, &hs["updatedInput"]);
                }
            }
            c => {
                let e = out.stderr.trim().lines().last().unwrap_or("").to_string();
                push(&mut res, "errors", format!("{name}: {} {e}", c.map(|c| format!("(exit {c})")).unwrap_or_default()));
            }
        }
    }
    if !perm.is_empty() {
        res["permission"] = json!(perm);
    }
    res
}

fn push(res: &mut Value, k: &str, s: String) {
    if let Some(a) = res[k].as_array_mut() {
        a.push(json!(s));
    }
}
fn add_reason(res: &mut Value, why: &str) {
    if why.is_empty() {
        return;
    }
    let cur = res["reason"].as_str().unwrap_or("").to_string();
    res["reason"] = json!(if cur.is_empty() { why.to_string() } else { format!("{cur}\n{why}") });
}

/// Um gancho (command ou http), com tudo o que precisa por valor (pode seguir sozinho em segundo plano).
async fn exec(hook: Value, stdin: Vec<u8>, ws: PathBuf, env: Vec<(&'static str, String)>, secs: u64, http: reqwest::Client) -> Result<Out, String> {
    match hook["type"].as_str().unwrap_or("command") {
        "command" => run_cmd(hook["command"].as_str().unwrap_or(""), &stdin, &ws, &env, secs).await,
        "http" => {
            let url = hook["url"].as_str().unwrap_or("");
            let mut rq = http.post(url).header("content-type", "application/json").timeout(Duration::from_secs(secs)).body(stdin);
            for (k, val) in hook["headers"].as_object().into_iter().flatten() {
                rq = rq.header(k.as_str(), expand_env(val.as_str().unwrap_or("")));
            }
            match rq.send().await {
                Ok(r) if r.status().is_success() => Ok(Out { code: Some(0), stdout: r.text().await.unwrap_or_default(), stderr: String::new(), timeout: false }),
                Ok(r) => Ok(Out { code: Some(1), stdout: String::new(), stderr: format!("HTTP {}", r.status().as_u16()), timeout: false }),
                Err(e) => Err(e.to_string()),
            }
        }
        other => Err(LF!("tipo de gancho \"{other}\" não é suportado no studio", "hook type \"{other}\" isn't supported in the studio")),
    }
}

// ---------------------------------------------------------------- comandos de barra

/// Monta o texto de um comando: argumentos, variáveis e os trechos `` !`cmd` `` / ```` ```! ```` executados.
pub async fn render_command(app: &App, id: &str, arguments: &str, ws: &str, session: &str) -> Result<String, String> {
    let root = app.root.clone();
    let name = id.strip_prefix("plugin:").unwrap_or(id);
    let (plugin, cmd) = name.split_once(':').ok_or(L!("Comando inválido.", "Invalid command."))?;
    let p = load(&root).plugins.into_iter().find(|p| p.enabled && p.name == plugin).ok_or(L!("Plugin desligado ou removido.", "Plugin disabled or removed."))?;
    let f = comps(&root, &p).commands.into_iter().find(|f| stem(f) == cmd).ok_or(L!("Comando não encontrado.", "Command not found."))?;
    let text = std::fs::read_to_string(&f).map_err(|e| e.to_string())?;
    let (_, body) = crate::skills::parse_frontmatter(&text);
    let ws = PathBuf::from(ws);
    let ws = if ws.is_dir() { ws } else { app.workspace() };
    let words = split_args(arguments);
    let mut b = body.replace("$ARGUMENTS", arguments.trim());
    let re = regex_lite::Regex::new(r"\$([1-9])").unwrap();
    b = re.replace_all(&b, |c: &regex_lite::Captures| words.get(c[1].parse::<usize>().unwrap() - 1).cloned().unwrap_or_default()).into_owned();
    let vars = vars_of(&root, &p, Some(&ws));
    let mut v = Value::String(b);
    subst(&mut v, &vars);
    let mut b = v.as_str().unwrap_or("").to_string();
    let env = {
        let mut e = vars.clone();
        e.push(("CLAUDE_CODE_ENTRYPOINT", "llama-studio".into()));
        e.push(("CLAUDE_CODE_SESSION_ID", session.to_string()));
        e
    };
    // blocos ```! ... ``` e trechos !`...`: rodam e a saída entra no lugar
    let block = regex_lite::Regex::new(r"(?s)```!\s*\n(.*?)```").unwrap();
    let inline = regex_lite::Regex::new(r"!`([^`\n]+)`").unwrap();
    let mut runs: Vec<(String, String, bool)> = vec![];
    for c in block.captures_iter(&b) {
        runs.push((c[0].to_string(), c[1].trim().to_string(), true));
    }
    for c in inline.captures_iter(&b) {
        runs.push((c[0].to_string(), c[1].trim().to_string(), false));
    }
    for (whole, cmd, fenced) in runs {
        let o = run_cmd(&cmd, b"", &ws, &env, 120).await?;
        let mut out = format!("{}{}", o.stdout.trim_end(), if o.stderr.trim().is_empty() { String::new() } else { format!("\n{}", o.stderr.trim_end()) });
        if o.timeout {
            out = L!("(o comando passou do tempo)", "(the command timed out)").into();
        }
        let rep = if fenced || out.contains('\n') { format!("```\n$ {cmd}\n{out}\n```") } else { out };
        b = b.replacen(&whole, &rep, 1);
    }
    Ok(b.trim().to_string())
}

fn split_args(s: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let mut q: Option<char> = None;
    for ch in s.chars() {
        match (q, ch) {
            (None, '"' | '\'') => q = Some(ch),
            (Some(c), x) if c == x => q = None,
            (None, c) if c.is_whitespace() => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            (_, c) => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matcher_rules() {
        assert!(matches("", "Bash"));
        assert!(matches("*", "Bash"));
        assert!(matches("Edit|Write|MultiEdit", "Write"));
        assert!(!matches("Edit|Write", "WriteX"));
        assert!(matches("mcp__.*", "mcp__gh__issue"));
        assert!(matches("Notebook.*", "NotebookEdit"));
    }

    #[test]
    fn if_rules() {
        let i = json!({"command": "git commit -m x"});
        assert!(if_matches("Bash(git*commit*)", "Bash", &i));
        assert!(!if_matches("Bash(git*push*)", "Bash", &i));
        assert!(if_matches("Bash(git:*)", "Bash", &i));
        assert!(!if_matches("PowerShell(git*)", "Bash", &i));
        assert!(if_matches("", "Bash", &i));
    }

    #[test]
    fn tool_mapping() {
        let ws = PathBuf::from("/w");
        let (n, a) = to_cc("edit_file", &json!({"path": "a.rs", "old_text": "x", "new_text": "y"}), &ws);
        assert_eq!(n, "Edit");
        assert_eq!(a["file_path"], "/w/a.rs");
        assert_eq!(a["old_string"], "x");
        let back = from_cc("edit_file", &json!({"path": "a.rs", "old_text": "x", "new_text": "y"}), &json!({"file_path": "/w/b.rs", "new_string": "z"}));
        assert_eq!(back["path"], "/w/b.rs");
        assert_eq!(back["new_text"], "z");
        assert_eq!(back["old_text"], "x");
        let (n, a) = to_cc("run_command", &json!({"command": "ls", "timeout": 5}), &ws);
        assert_eq!((n.as_str(), a["command"].as_str(), a["timeout"].as_i64()), ("Bash", Some("ls"), Some(5)));
        assert_eq!(to_cc("gh__issue", &json!({}), &ws).0, "mcp__gh__issue");
    }

    #[test]
    fn inputs() {
        assert!(matches!(parse_input("anthropics/claude-code").unwrap(), Src::Github(r, rf, _) if r == "anthropics/claude-code" && rf.is_empty()));
        assert!(matches!(parse_input("anthropics/claude-code@v2").unwrap(), Src::Github(_, rf, _) if rf == "v2"));
        assert!(matches!(parse_input("https://github.com/a/b/tree/main/plugins/x").unwrap(), Src::Github(r, rf, p) if r == "a/b" && rf == "main" && p == "plugins/x"));
        assert!(matches!(parse_input("https://github.com/a/b.git").unwrap(), Src::Github(r, _, _) if r == "a/b"));
        assert!(matches!(parse_input("https://gitlab.com/a/b.git").unwrap(), Src::Git(..)));
        assert!(matches!(parse_input("https://x.com/p.zip").unwrap(), Src::Archive(..)));
        assert_eq!(split_args("a \"b c\" d"), vec!["a", "b c", "d"]);
    }
}
