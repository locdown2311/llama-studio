//! Ferramentas internas (arquivos da pasta de trabalho) e montagem de ferramentas/contexto.

use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::app::{self, file_name, fmt_size, is_inside, looks_binary, rel_to, resolve, App};
use crate::skills;

const SKIP_DIRS: &[&str] = &["node_modules", ".git", "__pycache__", ".venv", "venv", "$RECYCLE.BIN", "System Volume Information"];

struct Def {
    name: &'static str,
    group: &'static str,
    mutating: bool,
    /// executada pela interface (JavaScript), não pelo servidor
    client: bool,
    desc: &'static str,
    params: &'static str,
}

const fn d(name: &'static str, group: &'static str, mutating: bool, client: bool, desc: &'static str, params: &'static str) -> Def {
    Def { name, group, mutating, client, desc, params }
}

/// Grupos (iguais aos interruptores das configurações):
/// read, write, edit, shell, code, browser, computer, history, toolsearch, explore
const DEFS: &[Def] = &[
    // ---------------- arquivos
    d("list_directory", "read", false, false, "Lista arquivos e pastas. O caminho é relativo à pasta de trabalho (use \".\" para a raiz). Aceita também caminhos absolutos que o usuário referenciou.",
      r#"{"type":"object","properties":{"path":{"type":"string","description":"Caminho da pasta"}},"required":["path"]}"#),
    d("read_file", "read", false, false, "Lê um arquivo de texto. Use offset/limit (em linhas) para arquivos grandes.",
      r#"{"type":"object","properties":{"path":{"type":"string"},"offset":{"type":"integer","description":"Linha inicial (1 = primeira)"},"limit":{"type":"integer","description":"Quantidade máxima de linhas"}},"required":["path"]}"#),
    d("search_files", "read", false, false, "Procura arquivos pelo nome (aceita * como curinga) e, opcionalmente, por conteúdo (expressão regular). Devolve caminhos relativos e, na busca por conteúdo, as linhas encontradas.",
      r#"{"type":"object","properties":{"name":{"type":"string","description":"Parte do nome ou padrão, ex.: *.py"},"content":{"type":"string","description":"Regex para procurar dentro dos arquivos"},"path":{"type":"string","description":"Pasta onde começar (padrão: raiz)"}}}"#),
    d("write_file", "write", true, false, "Cria ou substitui um arquivo dentro da pasta de trabalho com o conteúdo informado. Cria as pastas que faltarem.",
      r#"{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}"#),
    d("create_directory", "write", true, false, "Cria uma pasta (e as intermediárias) dentro da pasta de trabalho.",
      r#"{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}"#),
    d("edit_file", "edit", true, false, "Substitui um trecho exato de texto num arquivo da pasta de trabalho. old_text precisa aparecer exatamente uma vez (ou use replace_all). Leia o arquivo antes.",
      r#"{"type":"object","properties":{"path":{"type":"string"},"old_text":{"type":"string"},"new_text":{"type":"string"},"replace_all":{"type":"boolean"}},"required":["path","old_text","new_text"]}"#),
    // ---------------- shell
    d("run_command", "shell", true, false, "Executa um comando no PowerShell (Windows) dentro da pasta de trabalho e devolve a saída e o código de saída. Use para compilar, rodar scripts, git, instalar pacotes etc. Não use para comandos interativos.",
      r#"{"type":"object","properties":{"command":{"type":"string","description":"Comando ou script do PowerShell"},"cwd":{"type":"string","description":"Subpasta onde rodar (padrão: raiz da pasta de trabalho)"},"timeout":{"type":"integer","description":"Segundos até encerrar (padrão 120, máximo 1800)"}},"required":["command"]}"#),
    d("execute_code", "code", true, true, "Executa JavaScript (assíncrono) para orquestrar várias ferramentas de uma vez, sem encher o contexto com resultados intermediários. Dentro do código: `await tool('nome_da_ferramenta', {argumentos})` devolve o texto do resultado (lança erro se a ferramenta falhar); `console.log(...)` registra; `return valor` devolve o resultado final. Ex.: laços sobre arquivos, filtrar resultados, chamar várias ferramentas e resumir.",
      r#"{"type":"object","properties":{"code":{"type":"string","description":"Corpo de uma função async em JavaScript"}},"required":["code"]}"#),
    // ---------------- navegador
    d("browser_navigate", "browser", false, false, "Abre uma URL na janela de navegador controlada pelo studio e devolve o texto da página e os elementos interativos numerados.",
      r#"{"type":"object","properties":{"url":{"type":"string"}},"required":["url"]}"#),
    d("browser_read", "browser", false, false, "Lê a página atual do navegador: título, URL, texto e elementos interativos numerados.", r#"{"type":"object","properties":{}}"#),
    d("browser_click", "browser", false, false, "Clica num elemento da página pelo número mostrado em browser_read/browser_navigate.",
      r#"{"type":"object","properties":{"id":{"type":"integer"}},"required":["id"]}"#),
    d("browser_type", "browser", false, false, "Digita num campo da página (pelo número). Substitui o conteúdo atual. Use submit=true para apertar Enter depois.",
      r#"{"type":"object","properties":{"id":{"type":"integer"},"text":{"type":"string"},"submit":{"type":"boolean"}},"required":["id","text"]}"#),
    d("browser_press", "browser", false, false, "Aperta uma tecla na página: Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp, PageDown ou PageUp.",
      r#"{"type":"object","properties":{"key":{"type":"string"}},"required":["key"]}"#),
    d("browser_back", "browser", false, false, "Volta para a página anterior.", r#"{"type":"object","properties":{}}"#),
    d("browser_screenshot", "browser", false, false, "Tira uma captura da página atual (salva na pasta capturas). Se o modelo enxerga imagens, a imagem é enviada a ele.", r#"{"type":"object","properties":{}}"#),
    d("browser_eval", "browser", true, false, "Executa JavaScript na página aberta e devolve o resultado (JSON).",
      r#"{"type":"object","properties":{"code":{"type":"string","description":"Expressão ou função imediata"}},"required":["code"]}"#),
    // ---------------- computador
    d("computer_windows", "computer", false, false, "Lista as janelas abertas no computador do usuário (id e título).", r#"{"type":"object","properties":{}}"#),
    d("computer_focus", "computer", true, false, "Traz uma janela para o primeiro plano, pelo id ou por parte do título.",
      r#"{"type":"object","properties":{"window":{"type":"string","description":"id ou parte do título"}},"required":["window"]}"#),
    d("computer_elements", "computer", false, false, "Lista os elementos de tela (botões, campos, menus, textos) de uma janela pela UI Automation do Windows, numerados para usar em computer_click. Sem window, usa a janela em primeiro plano.",
      r#"{"type":"object","properties":{"window":{"type":"string","description":"id ou parte do título (opcional)"},"filter":{"type":"string","description":"Só elementos que contenham este texto (opcional)"}}}"#),
    d("computer_screenshot", "computer", false, false, "Captura a tela inteira (salva na pasta capturas). Se o modelo enxerga imagens, a imagem é enviada a ele.", r#"{"type":"object","properties":{}}"#),
    d("computer_click", "computer", true, false, "Clica num elemento (id de computer_elements) ou num ponto (x, y da última captura). button: left ou right. double: clique duplo.",
      r#"{"type":"object","properties":{"id":{"type":"integer"},"x":{"type":"integer"},"y":{"type":"integer"},"button":{"type":"string","enum":["left","right"]},"double":{"type":"boolean"}}}"#),
    d("computer_type", "computer", true, false, "Digita texto onde o cursor estiver (na janela em primeiro plano).",
      r#"{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}"#),
    d("computer_key", "computer", true, false, "Aperta uma tecla ou combinação, ex.: enter, ctrl+s, alt+f4, ctrl+shift+esc, win+r.",
      r#"{"type":"object","properties":{"keys":{"type":"string"}},"required":["keys"]}"#),
    d("computer_scroll", "computer", true, false, "Rola a roda do mouse. amount negativo desce, positivo sobe. x e y opcionais (da última captura).",
      r#"{"type":"object","properties":{"amount":{"type":"integer"},"x":{"type":"integer"},"y":{"type":"integer"}},"required":["amount"]}"#),
    // ---------------- busca
    d("recall_history", "history", false, true, "Procura nas conversas anteriores (ou só na atual) trechos sobre um assunto. Use quando o usuário se referir a algo já conversado.",
      r#"{"type":"object","properties":{"query":{"type":"string"},"scope":{"type":"string","enum":["todas","atual"]},"limit":{"type":"integer"}},"required":["query"]}"#),
    d("search_tools", "toolsearch", false, true, "Ativa ferramentas de conectores MCP para os próximos passos: passe os nomes exatos do catálogo em names, ou palavras-chave em query.",
      r#"{"type":"object","properties":{"names":{"type":"array","items":{"type":"string"},"description":"Nomes exatos do catálogo"},"query":{"type":"string","description":"Palavras-chave"}}}"#),
    // ---------------- subagentes
    d("explore", "explore", false, true, "Inicia um subagente explorador: ele investiga sozinho (só leitura: arquivos, busca e, se ativo, navegador) com contexto próprio e devolve um relatório. Use para pesquisas amplas sem encher o seu contexto. Chame várias vezes na mesma resposta para explorar em paralelo.",
      r#"{"type":"object","properties":{"task":{"type":"string","description":"O que investigar e o que deve constar no relatório"},"where":{"type":"string","description":"Pasta, arquivos ou site para começar (opcional)"}},"required":["task"]}"#),
];

const SKILL_TOOL: Def = d("read_skill_file", "", false, false, "Lê um arquivo auxiliar de uma skill ativa (scripts, modelos, referências citadas no SKILL.md).",
    r#"{"type":"object","properties":{"skill":{"type":"string","description":"id da skill"},"path":{"type":"string"}},"required":["skill","path"]}"#);


fn def(name: &str) -> Option<&'static Def> {
    DEFS.iter().find(|d| d.name == name).or(if name == SKILL_TOOL.name { Some(&SKILL_TOOL) } else { None })
}

fn safe_name(s: &str) -> String {
    s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect()
}

/// (nome exposto, servidor, ferramenta) de todos os servidores conectados.
fn mcp_entries(app: &App, servers: Option<&[String]>) -> Vec<(String, String, Value)> {
    let mut out = vec![];
    let names: Vec<String> = match servers {
        Some(s) => s.to_vec(),
        None => app.mcp.status_json().iter().filter_map(|s| s["name"].as_str().map(str::to_string)).collect(),
    };
    for sname in names {
        let Some(entry) = app.mcp.get(&sname) else { continue };
        if entry.status() != "connected" {
            continue;
        }
        for t in entry.visible_tools() {
            let tname = t.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            let mut name: String = format!("{}__{}", safe_name(&sname), safe_name(&tname)).chars().take(64).collect();
            if def(&name).is_some() {
                name = format!("mcp_{name}").chars().take(64).collect();
            }
            out.push((name, sname.clone(), t));
        }
    }
    out
}

/// Monta a lista de ferramentas no formato OpenAI e os metadados para a interface.
pub fn build_tools(app: &App, groups: &[String], servers: &[String], with_skills: bool, extra: &[String], only: Option<&[String]>, lazy: bool) -> Value {
    let mut tools = vec![];
    let mut meta = Map::new();
    let mut add = |name: String, desc: String, params: Value, info: Value| {
        if meta.contains_key(&name) {
            return;
        }
        tools.push(json!({"type":"function","function":{"name":name,"description":desc,"parameters":params}}));
        meta.insert(name, info);
    };
    let allowed = |n: &str| only.map(|o| o.iter().any(|x| x == n)).unwrap_or(true);
    // sob demanda: o catálogo vai no prompt e search_tools carrega o que for usado
    let lazy_on = lazy && only.is_none() && !servers.is_empty();
    for dd in DEFS {
        let forced = lazy_on && dd.name == "search_tools";
        if (forced || groups.iter().any(|g| g == dd.group)) && allowed(dd.name) {
            add(dd.name.into(), dd.desc.into(), serde_json::from_str(dd.params).unwrap(), json!({"source": if dd.client { "client" } else { "builtin" }, "group": dd.group, "label": dd.name, "mutating": dd.mutating}));
        }
    }
    if with_skills && allowed(SKILL_TOOL.name) {
        add(SKILL_TOOL.name.into(), SKILL_TOOL.desc.into(), serde_json::from_str(SKILL_TOOL.params).unwrap(), json!({"source":"builtin","group":"read","label":SKILL_TOOL.name,"mutating":false}));
    }
    let mut index = HashMap::new();
    let mut catalog: Vec<(String, Vec<String>)> = vec![];
    if only.is_none() {
        for (name, sname, t) in mcp_entries(app, None) {
            let selected = servers.contains(&sname);
            if !selected && !extra.contains(&name) {
                continue;
            }
            let tname = t.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            let desc = t.get("description").and_then(Value::as_str).unwrap_or("").to_string();
            index.insert(name.clone(), (sname.clone(), tname.clone()));
            if lazy_on && selected {
                // o catálogo lista tudo (carregadas ou não) para o prompt não mudar entre passos
                let line = format!("{name}: {}", first_sentence(&desc, 90));
                match catalog.iter_mut().find(|(s, _)| *s == sname) {
                    Some((_, v)) => v.push(line),
                    None => catalog.push((sname.clone(), vec![line])),
                }
                if !extra.contains(&name) {
                    continue;
                }
            }
            let mut schema = t.get("inputSchema").cloned().filter(Value::is_object).unwrap_or_else(|| json!({"type":"object"}));
            slim_schema(&mut schema, 0);
            if let Some(o) = schema.as_object_mut() {
                o.entry("type").or_insert(json!("object"));
                o.entry("properties").or_insert(json!({}));
            }
            let read_only = t.pointer("/annotations/readOnlyHint").and_then(Value::as_bool).unwrap_or(false);
            add(name, cut(&desc, 700), schema, json!({"source":"mcp","server":sname,"label":format!("{sname} › {tname}"),"mutating":!read_only}));
        }
    }
    app.mcp.set_index(index);
    let catalog_text = if catalog.is_empty() {
        String::new()
    } else {
        let body: Vec<String> = catalog.iter().map(|(s, v)| format!("## {s}\n{}", v.join("\n"))).collect();
        format!("Catálogo de ferramentas dos conectores ativos (ainda não carregadas). Para usar uma, chame antes search_tools com names=[...] e ela fica disponível no passo seguinte. Carregue só as que for usar.\n\n{}", body.join("\n\n"))
    };
    json!({"tools": tools, "meta": meta, "catalog": catalog_text})
}

fn cut(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        return s.to_string();
    }
    let t: String = s.chars().take(n).collect();
    format!("{}...", t.trim_end())
}

/// Primeira frase (ou começo) de uma descrição, para o catálogo.
fn first_sentence(s: &str, n: usize) -> String {
    let s = s.trim();
    let end = s.find(|c| c == '\n').unwrap_or(s.len());
    let line = &s[..end];
    let line = match line.find(". ") {
        Some(i) => &line[..=i],
        None => line,
    };
    cut(line, n)
}

/// Tira do schema o que não ajuda o modelo e encurta descrições longas.
fn slim_schema(v: &mut Value, depth: usize) {
    match v {
        Value::Object(o) => {
            for k in ["$schema", "title", "examples", "$comment", "additionalProperties", "$id", "deprecated"] {
                if k == "additionalProperties" && o.get(k).is_some_and(Value::is_object) {
                    continue; // mapas de verdade
                }
                o.remove(k);
            }
            if let Some(Value::String(d)) = o.get_mut("description") {
                *d = cut(d, if depth == 0 { 300 } else { 160 });
            }
            for (k, x) in o.iter_mut() {
                if k != "description" && k != "enum" && k != "default" && k != "const" {
                    slim_schema(x, depth + 1);
                }
            }
        }
        Value::Array(a) => a.iter_mut().for_each(|x| slim_schema(x, depth + 1)),
        _ => {}
    }
}

/// Busca ferramentas MCP por palavras (para search_tools).
pub fn search_tools(app: &App, q: &str, names: &[String]) -> Value {
    let words: Vec<String> = q.to_lowercase().split_whitespace().map(str::to_string).collect();
    let mut found = vec![];
    let mut index = HashMap::new();
    for (name, sname, t) in mcp_entries(app, None) {
        let desc = t.get("description").and_then(Value::as_str).unwrap_or("");
        let tname = t["name"].as_str().unwrap_or("");
        let exact = names.iter().any(|n| n == &name || n == tname);
        let score = if exact {
            1000
        } else if words.is_empty() {
            if names.is_empty() { 1 } else { 0 }
        } else {
            let hay = format!("{} {} {}", name, sname, desc).to_lowercase();
            words.iter().filter(|w| hay.contains(w.as_str())).count()
        };
        if score > 0 {
            index.insert(name.clone(), (sname.clone(), tname.to_string()));
            found.push((score, json!({"name": name, "server": sname, "description": first_sentence(desc, 160)})));
        }
    }
    app.mcp.set_index(index);
    found.sort_by(|a, b| b.0.cmp(&a.0));
    let max = if names.is_empty() { 10 } else { names.len().max(1) + 5 };
    json!({"tools": found.into_iter().take(max).map(|(_, v)| v).collect::<Vec<_>>()})
}

pub fn build_context(app: &App, ws: &Path, skill_ids: &[String], groups: &[String], refs: &[String], now: &str, lazy: bool) -> String {
    let has = |g: &str| groups.iter().any(|x| x == g);
    let mut parts = vec![];
    if !now.is_empty() {
        parts.push(format!("Data e hora atuais: {now}."));
    }
    parts.push(format!("Sistema do usuário: {}.", if app::IS_WIN { "Windows" } else { std::env::consts::OS }));
    if has("read") || has("write") || has("edit") || has("shell") {
        parts.push(format!(
            "Pasta de trabalho: {}\nAs ferramentas de arquivo usam caminhos relativos a essa pasta e só escrevem dentro dela. Leia um arquivo antes de editá-lo.",
            ws.display()
        ));
        if !refs.is_empty() {
            let list: Vec<String> = refs.iter().map(|r| format!("- {r}")).collect();
            parts.push(format!("O usuário referenciou estes caminhos (você pode lê-los usando o caminho absoluto):\n{}", list.join("\n")));
        }
    }
    if has("shell") {
        let avail: Vec<&str> = [("rg", "rg (ripgrep, busca em texto)"), ("fd", "fd (acha arquivos por nome)"), ("uv", "uv/uvx (Python)"), ("bun", "bun/bunx (JavaScript)")]
            .iter()
            .filter(|(c, _)| crate::bins::which(c).is_some())
            .map(|(_, d)| *d)
            .collect();
        if !avail.is_empty() {
            parts.push(format!("Programas disponíveis no terminal: {}. Prefira-os a Get-ChildItem/Select-String por serem mais rápidos e com saída mais curta.", avail.join(", ")));
        }
    }
    if has("browser") {
        parts.push("Navegador: as ferramentas browser_* controlam uma janela própria do Edge que o usuário vê. Leia a página (browser_read) e use os números dos elementos para clicar e digitar.".into());
    }
    if has("computer") {
        parts.push("Computador: as ferramentas computer_* controlam a área de trabalho do usuário. Prefira computer_elements (lista numerada) a coordenadas. Confirme o resultado depois de cada ação.".into());
    }
    if has("explore") {
        parts.push("Para investigações longas, delegue a subagentes com a ferramenta explore (vários em paralelo, se fizer sentido) e trabalhe com os relatórios.".into());
    }
    if has("toolsearch") {
        let hidden: Vec<String> = app.mcp.status_json().iter().filter(|s| s["status"] == "connected").map(|s| format!("{} ({} ferramentas)", s["name"].as_str().unwrap_or(""), s["tools"].as_array().map(|a| a.len()).unwrap_or(0))).collect();
        if !hidden.is_empty() {
            parts.push(format!("Conectores MCP disponíveis: {}. Se precisar de uma ferramenta que não está na sua lista, use search_tools.", hidden.join(", ")));
        }
    }
    let mut active = vec![];
    for id in skill_ids {
        if let Some(s) = skills::get(app, id) {
            let text = std::fs::read_to_string(s.dir.join("SKILL.md")).unwrap_or_default();
            let (_, body) = skills::parse_frontmatter(&text);
            let files = if s.files.is_empty() { String::new() } else { format!("Arquivos auxiliares (leia com read_skill_file): {}\n", s.files.join(", ")) };
            if lazy && body.len() > 1500 {
                // só o resumo; o corpo é lido quando a tarefa pedir
                active.push(format!(
                    "<skill id=\"{}\" name=\"{}\">\n{}\nAntes de seguir esta skill, leia as instruções completas com read_skill_file(skill=\"{}\", path=\"SKILL.md\").\n{files}</skill>",
                    s.id, s.name, cut(s.description.trim(), 400), s.id
                ));
            } else {
                active.push(format!("<skill id=\"{}\" name=\"{}\">\nPasta da skill: {}\n{files}\n{}\n</skill>", s.id, s.name, s.dir.display(), body.trim()));
            }
        }
    }
    if !active.is_empty() {
        parts.push(format!("O usuário ativou as skills abaixo. Siga as instruções de cada uma sempre que a tarefa se encaixar nela.\n\n{}", active.join("\n\n")));
    }
    parts.join("\n\n")
}

pub struct ToolOut {
    pub content: String,
    pub is_error: bool,
    pub images: Vec<String>,
}

fn out(r: Result<(String, Vec<String>), String>) -> ToolOut {
    match r {
        Ok((c, images)) => ToolOut { content: app::truncate(c, 40000), is_error: false, images },
        Err(e) => ToolOut { content: format!("Erro: {e}"), is_error: true, images: vec![] },
    }
}

/// Executa uma ferramenta do servidor (arquivos, shell, navegador, computador ou MCP).
pub async fn call(app: &Arc<App>, ws: PathBuf, name: &str, args: Value, allow: &[String]) -> ToolOut {
    if name.starts_with("browser_") && def(name).is_some() {
        return out(app.browser.tool(&app.http, &ws, name, &args).await);
    }
    if name.starts_with("computer_") && def(name).is_some() {
        return out(crate::computer::tool(&ws, name, &args).await);
    }
    let (compact_on, rtk_on) = {
        let c = app.config.read().unwrap();
        (c.compact_output, c.use_rtk)
    };
    if name == "run_command" {
        let timeout = args.get("timeout").and_then(Value::as_u64).unwrap_or(120);
        let command = s(&args, "command");
        let rtk = if rtk_on { crate::compact::rtk_rewrite(command) } else { None };
        let mut res = match &rtk {
            Some(rc) => crate::shell::run(&ws, rc, s(&args, "cwd"), timeout).await,
            None => crate::shell::run(&ws, command, s(&args, "cwd"), timeout).await,
        };
        if let (Some(rc), Ok(t)) = (&rtk, &res) {
            // o RTK não conhece esse uso: roda o comando original
            let low = t.to_lowercase();
            if low.contains("unrecognized subcommand") || low.contains("unexpected argument") || low.contains("unknown command") {
                res = crate::shell::run(&ws, command, s(&args, "cwd"), timeout).await;
            } else {
                res = Ok(format!("[resumido pelo RTK: {rc}]\n{t}"));
            }
        }
        let res = res.map(|t| if compact_on { crate::compact::compact(&t, &crate::compact::saidas_dir(app), command, 12000).text } else { t });
        return out(res.map(|t| (t, vec![])));
    }
    if def(name).is_some_and(|d| d.client) {
        return out(Err(format!("{name} é executada pela interface, não pelo servidor.")));
    }
    if def(name).is_some() {
        let allow: Vec<PathBuf> = allow.iter().map(PathBuf::from).collect();
        let app2 = app.clone();
        let name = name.to_string();
        let r = tokio::task::spawn_blocking(move || run_builtin(&app2, &ws, &name, &args, &allow)).await;
        return out(r.map_err(|e| e.to_string()).and_then(|x| x).map(|t| (t, vec![])));
    }
    match app.mcp.call_by_tool(name, args).await {
        Ok((text, is_err, images)) => {
            let content = if compact_on { crate::compact::compact(&text, &crate::compact::saidas_dir(app), name, 20000).text } else { app::truncate(text, 40000) };
            ToolOut { content, is_error: is_err, images }
        }
        Err(e) => ToolOut { content: format!("Erro: {e}"), is_error: true, images: vec![] },
    }
}

/// Busca por conteúdo com o ripgrep (respeita .gitignore e é bem mais rápida). None = usar a busca própria.
fn search_rg(ws: &Path, start: &Path, name: &str, pattern: &str) -> Option<String> {
    let rg = crate::bins::which("rg")?;
    let mut c = std::process::Command::new(rg);
    c.args(["-n", "-i", "--no-heading", "--color", "never", "--max-count", "30", "--max-columns", "220", "--max-columns-preview", "--max-filesize", "2M"]);
    if !name.is_empty() {
        c.args(["--iglob", name]);
    }
    c.args(["-e", pattern, "."]).current_dir(start).stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(crate::CREATE_NO_WINDOW);
    }
    let o = c.output().ok()?;
    let code = o.status.code()?;
    if code == 1 {
        return Some("Nada encontrado.".into());
    }
    if code != 0 {
        return None; // regex que o rg não aceita etc.
    }
    let text = String::from_utf8_lossy(&o.stdout);
    let mut lines: Vec<String> = vec![];
    for l in text.lines().take(200) {
        let l = l.strip_prefix("./").or_else(|| l.strip_prefix(".\\")).unwrap_or(l);
        let (file, rest) = l.split_once(':').unwrap_or((l, ""));
        lines.push(format!("{}:{}", rel_to(ws, &start.join(file)), rest));
    }
    let full = text.lines().count() > 200;
    Some(lines.join("\n") + if full { "\n[limite de 200 resultados]" } else { "" })
}

fn s<'a>(a: &'a Value, k: &str) -> &'a str {
    a.get(k).and_then(Value::as_str).unwrap_or("")
}

fn skill_roots(app: &App) -> Vec<PathBuf> {
    skills::roots(app).into_iter().map(|(d, _)| d).collect()
}

fn resolve_read(app: &App, ws: &Path, p: &str, allow: &[PathBuf]) -> Result<PathBuf, String> {
    let full = resolve(ws, p);
    if is_inside(ws, &full)
        || allow.iter().any(|a| is_inside(a, &full))
        || skill_roots(app).iter().any(|d| is_inside(d, &full))
        || is_inside(&crate::compact::saidas_dir(app), &full)
    {
        return Ok(full);
    }
    Err(format!("Acesso negado: \"{p}\" está fora da pasta de trabalho ({}).", ws.display()))
}

fn resolve_write(ws: &Path, p: &str) -> Result<PathBuf, String> {
    let full = resolve(ws, p);
    if !is_inside(ws, &full) || app::normalize(&full) == app::normalize(ws) {
        return Err(format!("Só posso escrever dentro da pasta de trabalho ({}).", ws.display()));
    }
    Ok(full)
}

fn wildcard(pat: &str) -> regex_lite::Regex {
    let mut r = String::new();
    for ch in pat.chars() {
        match ch {
            '*' => r.push_str(".*"),
            '?' => r.push('.'),
            c if "\\.+^$()|[]{}".contains(c) => {
                r.push('\\');
                r.push(c);
            }
            c => r.push(c),
        }
    }
    let anchored = pat.contains('*') || pat.contains('?');
    regex_lite::Regex::new(&format!("(?i){}{}{}", if anchored { "^" } else { "" }, r, if anchored { "$" } else { "" })).unwrap()
}

fn run_builtin(app: &App, ws: &Path, name: &str, a: &Value, allow: &[PathBuf]) -> Result<String, String> {
    let e = |x: std::io::Error| x.to_string();
    match name {
        "list_directory" => {
            let p = s(a, "path");
            let dir = resolve_read(app, ws, if p.is_empty() { "." } else { p }, allow)?;
            let mut items: Vec<_> = std::fs::read_dir(&dir).map_err(e)?.flatten().collect();
            items.sort_by_key(|x| (!x.path().is_dir(), x.file_name().to_string_lossy().to_lowercase()));
            let mut lines = vec![];
            for it in items.iter().take(1000) {
                let n = it.file_name().to_string_lossy().into_owned();
                if it.path().is_dir() {
                    lines.push(format!("[pasta] {n}/"));
                } else {
                    let size = it.metadata().map(|m| fmt_size(m.len())).unwrap_or_default();
                    lines.push(format!("{n}  ({size})"));
                }
            }
            if items.len() > 1000 {
                lines.push(format!("... e mais {} itens", items.len() - 1000));
            }
            Ok(format!("{}\n{}", dir.display(), if lines.is_empty() { "(vazia)".into() } else { lines.join("\n") }))
        }
        "read_file" => {
            let file = resolve_read(app, ws, s(a, "path"), allow)?;
            let md = std::fs::metadata(&file).map_err(e)?;
            if md.is_dir() {
                let mut al = allow.to_vec();
                al.push(file.clone());
                return run_builtin(app, ws, "list_directory", &json!({"path": file.to_string_lossy()}), &al);
            }
            if md.len() > 20 * 1024 * 1024 {
                return Err(format!("Arquivo grande demais ({}).", fmt_size(md.len())));
            }
            let buf = std::fs::read(&file).map_err(e)?;
            if looks_binary(&buf) {
                return Ok(format!("Arquivo binário ({}): {}. Não dá para ler como texto.", fmt_size(md.len()), file.display()));
            }
            let text = String::from_utf8_lossy(&buf);
            let text = text.trim_start_matches('\u{feff}');
            let lines: Vec<&str> = text.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect();
            let total = lines.len();
            let off = a.get("offset").and_then(Value::as_u64).unwrap_or(1).max(1) as usize;
            let lim = a.get("limit").and_then(Value::as_u64).unwrap_or(2000).max(1) as usize;
            let slice: Vec<&str> = lines.iter().skip(off - 1).take(lim).copied().collect();
            let mut out = slice.join("\n");
            if off > 1 || off - 1 + lim < total {
                out = format!("[linhas {}-{} de {total}]\n{out}", off, off - 1 + slice.len());
            }
            Ok(out)
        }
        "write_file" => {
            let file = resolve_write(ws, s(a, "path"))?;
            if let Some(p) = file.parent() {
                std::fs::create_dir_all(p).map_err(e)?;
            }
            let existed = file.exists();
            let content = s(a, "content");
            std::fs::write(&file, content).map_err(e)?;
            Ok(format!("{}: {} ({})", if existed { "Substituído" } else { "Criado" }, rel_to(ws, &file), fmt_size(content.len() as u64)))
        }
        "edit_file" => {
            let file = resolve_write(ws, s(a, "path"))?;
            let text = std::fs::read_to_string(&file).map_err(e)?;
            let old = s(a, "old_text");
            let new = s(a, "new_text");
            if old.is_empty() {
                return Err("old_text vazio.".into());
            }
            let count = text.matches(old).count();
            let all = a.get("replace_all").and_then(Value::as_bool).unwrap_or(false);
            if count == 0 {
                return Err("old_text não encontrado no arquivo. Leia o arquivo de novo e copie o trecho exato.".into());
            }
            if count > 1 && !all {
                return Err(format!("old_text aparece {count} vezes. Inclua mais contexto ou use replace_all."));
            }
            let out = if all { text.replace(old, new) } else { text.replacen(old, new, 1) };
            std::fs::write(&file, out).map_err(e)?;
            Ok(format!("Editado: {} ({} substituição(ões))", rel_to(ws, &file), if all { count } else { 1 }))
        }
        "create_directory" => {
            let dir = resolve_write(ws, s(a, "path"))?;
            std::fs::create_dir_all(&dir).map_err(e)?;
            Ok(format!("Pasta criada: {}", rel_to(ws, &dir)))
        }
        "search_files" => {
            let p = s(a, "path");
            let start = resolve_read(app, ws, if p.is_empty() { "." } else { p }, allow)?;
            let name_re = (!s(a, "name").is_empty()).then(|| wildcard(s(a, "name")));
            let content_re = if s(a, "content").is_empty() {
                None
            } else {
                Some(regex_lite::Regex::new(&format!("(?i){}", s(a, "content"))).map_err(|x| format!("Regex inválida: {x}"))?)
            };
            if content_re.is_some() {
                if let Some(r) = search_rg(ws, &start, s(a, "name"), s(a, "content")) {
                    return Ok(r);
                }
            }
            let deadline = Instant::now() + Duration::from_secs(15);
            let mut results: Vec<String> = vec![];
            let walker = walkdir::WalkDir::new(&start).min_depth(1).into_iter().filter_entry(|en| {
                !(en.file_type().is_dir() && SKIP_DIRS.contains(&en.file_name().to_string_lossy().as_ref()))
            });
            for (i, en) in walker.flatten().enumerate() {
                if results.len() >= 200 || i > 50000 || Instant::now() > deadline {
                    break;
                }
                let fname = en.file_name().to_string_lossy();
                let shown = rel_to(ws, en.path());
                if en.file_type().is_dir() {
                    if content_re.is_none() && name_re.as_ref().is_some_and(|r| r.is_match(&fname)) {
                        results.push(format!("{shown}/"));
                    }
                    continue;
                }
                if name_re.as_ref().is_some_and(|r| !r.is_match(&fname)) {
                    continue;
                }
                let Some(cre) = &content_re else {
                    results.push(shown);
                    continue;
                };
                let Ok(md) = en.metadata() else { continue };
                if md.len() > 2 * 1024 * 1024 {
                    continue;
                }
                let Ok(buf) = std::fs::read(en.path()) else { continue };
                if looks_binary(&buf) {
                    continue;
                }
                for (ln, line) in String::from_utf8_lossy(&buf).lines().enumerate() {
                    if results.len() >= 200 {
                        break;
                    }
                    if cre.is_match(line) {
                        let t: String = line.trim().chars().take(200).collect();
                        results.push(format!("{shown}:{}: {t}", ln + 1));
                    }
                }
            }
            if results.is_empty() {
                Ok("Nada encontrado.".into())
            } else {
                let full = results.len() >= 200;
                Ok(results.join("\n") + if full { "\n[limite de 200 resultados]" } else { "" })
            }
        }
        "read_skill_file" => {
            let sk = skills::get(app, s(a, "skill")).ok_or_else(|| format!("Skill não encontrada: {}", s(a, "skill")))?;
            let p = s(a, "path");
            let file = resolve(&sk.dir, if p.is_empty() { "SKILL.md" } else { p });
            if !is_inside(&sk.dir, &file) {
                return Err("Caminho fora da pasta da skill.".into());
            }
            if file.is_dir() {
                let names: Vec<String> = std::fs::read_dir(&file).map_err(e)?.flatten().map(|x| file_name(&x.path())).collect();
                return Ok(names.join("\n"));
            }
            let buf = std::fs::read(&file).map_err(e)?;
            Ok(if looks_binary(&buf) { format!("Arquivo binário: {}", file.display()) } else { String::from_utf8_lossy(&buf).into_owned() })
        }
        _ => Err(format!("Ferramenta desconhecida: {name}")),
    }
}
