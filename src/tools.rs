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
    d("read_file", "read", false, false, "Lê um arquivo de texto. Arquivo grande sem offset/limit volta como sumário (seções, títulos, funções) com números de linha: depois leia só os trechos que precisar com offset/limit.",
      r#"{"type":"object","properties":{"path":{"type":"string"},"offset":{"type":"integer","description":"Linha inicial (1 = primeira)"},"limit":{"type":"integer","description":"Quantidade máxima de linhas"}},"required":["path"]}"#),
    d("search_files", "read", false, false, "Procura arquivos pelo nome (aceita * como curinga) e, opcionalmente, por conteúdo (expressão regular). Devolve caminhos relativos e, na busca por conteúdo, as linhas encontradas com o número. path pode ser um arquivo: procura só nele.",
      r#"{"type":"object","properties":{"name":{"type":"string","description":"Parte do nome ou padrão, ex.: *.py"},"content":{"type":"string","description":"Regex para procurar dentro dos arquivos"},"path":{"type":"string","description":"Pasta (ou arquivo) onde procurar (padrão: raiz)"}}}"#),
    d("write_file", "write", true, false, "Cria ou substitui um arquivo dentro da pasta de trabalho com o conteúdo informado. Cria as pastas que faltarem. Para mudar parte de um arquivo que já existe, use edit_file (gasta bem menos).",
      r#"{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}"#),
    d("create_directory", "write", true, false, "Cria uma pasta (e as intermediárias) dentro da pasta de trabalho.",
      r#"{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}"#),
    d("edit_file", "edit", true, false, "Altera parte de um arquivo. Três formas: old_text + new_text (old_text exato, aparece uma vez, ou replace_all); start_line + end_line + new_text (troca essas linhas, sem repetir o texto antigo; end_line = start_line - 1 insere antes; mande expect com o começo da linha start_line); ou edits = lista de {old_text, new_text} aplicadas juntas.",
      r#"{"type":"object","properties":{"path":{"type":"string"},"old_text":{"type":"string"},"new_text":{"type":"string"},"replace_all":{"type":"boolean"},"start_line":{"type":"integer"},"end_line":{"type":"integer"},"expect":{"type":"string","description":"Com start_line: o começo da linha start_line como está agora (confere que o número não mudou)"},"edits":{"type":"array","items":{"type":"object","properties":{"old_text":{"type":"string"},"new_text":{"type":"string"}},"required":["old_text","new_text"]}}},"required":["path"]}"#),
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
    d("notebook", "notebook", false, true, "Caderno do projeto com achados duradouros. list (query opcional), get (id), add (title), update (id + campos), remove (id).",
      r#"{"type":"object","properties":{"action":{"type":"string","enum":["list","get","add","update","remove"]},"query":{"type":"string"},"id":{"type":"integer"},"title":{"type":"string"},"kind":{"type":"string","description":"função, endereço, string, hipótese..."},"addr":{"type":"string","description":"ex.: 0x401000"},"status":{"type":"string","enum":["hipótese","confirmado","descartado"]},"text":{"type":"string"}},"required":["action"]}"#),
    d("update_todos", "todo", false, true, "Mantém a lista de tarefas desta conversa, visível para o usuário. Use em tarefas com 3 ou mais passos: crie a lista no começo e atualize ao começar (in_progress) e terminar (done) cada item. Mande sempre a lista inteira; só um item in_progress por vez.",
      r#"{"type":"object","properties":{"todos":{"type":"array","items":{"type":"object","properties":{"text":{"type":"string","description":"O que fazer, curto e no imperativo"},"status":{"type":"string","enum":["pending","in_progress","done"]}},"required":["text","status"]}}},"required":["todos"]}"#),
    d("search_tools", "toolsearch", false, true, "Ferramentas dos conectores MCP. query: procura por palavras-chave e mostra nome e descrição (não carrega). names: carrega essas (nomes exatos) para os próximos passos.",
      r#"{"type":"object","properties":{"names":{"type":"array","items":{"type":"string"},"description":"Nomes exatos do catálogo"},"query":{"type":"string","description":"Palavras-chave"}}}"#),
    // ---------------- subagentes
    d("explore", "explore", false, true, "Inicia um subagente explorador: ele investiga sozinho (só leitura: arquivos, busca e, se ativo, navegador) com contexto próprio e devolve um relatório. Use para pesquisas amplas sem encher o seu contexto. Chame várias vezes na mesma resposta para explorar em paralelo.",
      r#"{"type":"object","properties":{"task":{"type":"string","description":"O que investigar e o que deve constar no relatório"},"where":{"type":"string","description":"Pasta, arquivos ou site para começar (opcional)"}},"required":["task"]}"#),
];

const SKILL_TOOL: Def = d("read_skill_file", "", false, false, "Lê um arquivo auxiliar de uma skill ativa (scripts, modelos, referências citadas no SKILL.md). Arquivo grande vem como sumário; leia trechos com offset/limit.",
    r#"{"type":"object","properties":{"skill":{"type":"string","description":"id da skill"},"path":{"type":"string"},"offset":{"type":"integer"},"limit":{"type":"integer"}},"required":["skill","path"]}"#);


/// Descrição e esquema no idioma do studio.
fn text_of(d: &Def) -> (&'static str, &'static str) {
    if crate::i18n::en() {
        if let Some(t) = crate::tools_en::def_en(d.name) {
            return t;
        }
    }
    (d.desc, d.params)
}

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
pub fn build_tools(app: &App, groups: &[String], servers: &[String], with_skills: bool, extra: &[String], only: Option<&[String]>, lazy: bool, eager: &[String], full: &[String]) -> Value {
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
            let (desc, params) = text_of(dd);
            add(dd.name.into(), desc.into(), serde_json::from_str(params).unwrap(), json!({"source": if dd.client { "client" } else { "builtin" }, "group": dd.group, "label": dd.name, "mutating": dd.mutating}));
        }
    }
    if with_skills && allowed(SKILL_TOOL.name) {
        let (desc, params) = text_of(&SKILL_TOOL);
        add(SKILL_TOOL.name.into(), desc.into(), serde_json::from_str(params).unwrap(), json!({"source":"builtin","group":"read","label":SKILL_TOOL.name,"mutating":false}));
    }
    let mut index = HashMap::new();
    let mut catalog: Vec<(String, Vec<String>)> = vec![];
    // "eager" = conector citado no pedido, que iria com as ferramentas completas. Mas um conector
    // grande (REA/Ghidra tem dezenas de ferramentas) estoura o contexto, então só é completo se
    // couber num orçamento; acima disso volta a ser catálogo (o modelo usa search_tools).
    const EAGER_BUDGET: usize = 24_000; // ~6000 tokens por conector
    let entries = if only.is_none() { mcp_entries(app, None) } else { vec![] };
    let mut eager_fits: std::collections::HashSet<String> = std::collections::HashSet::new();
    for sname in eager.iter().chain(full) {
        if !servers.contains(sname) {
            continue;
        }
        let size: usize = entries.iter().filter(|(_, s, _)| s == sname)
            .map(|(name, _, t)| name.len() + t.get("description").and_then(Value::as_str).map(|d| d.len().min(700)).unwrap_or(0) + t.get("inputSchema").map(|x| x.to_string().len()).unwrap_or(0) + 40)
            .sum();
        if size <= EAGER_BUDGET || full.contains(sname) {
            eager_fits.insert(sname.clone());
        }
    }
    // conector grande (mais de 25 ferramentas): o catálogo vai só com os nomes; a descrição vem pela busca
    let mut per_server: HashMap<&str, usize> = HashMap::new();
    for (_, s, _) in &entries {
        *per_server.entry(s.as_str()).or_default() += 1;
    }
    let big_servers: Vec<String> = per_server.into_iter().filter(|(_, n)| *n > 25).map(|(s, _)| s.to_string()).collect();
    if only.is_none() {
        for (name, sname, t) in entries {
            let selected = servers.contains(&sname);
            if !selected && !extra.contains(&name) {
                continue;
            }
            let tname = t.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            let desc = t.get("description").and_then(Value::as_str).unwrap_or("").to_string();
            index.insert(name.clone(), (sname.clone(), tname.clone()));
            // conector que o usuário citou no pedido: vai com as ferramentas completas, sem catálogo
            if lazy_on && selected && !eager_fits.contains(&sname) {
                // o catálogo lista tudo (carregadas ou não) para o prompt não mudar entre passos
                let line = if big_servers.contains(&sname) { name.clone() } else { format!("{name}: {}", first_sentence(&desc, 90)) };
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
            let read_only = t.pointer("/annotations/readOnlyHint").and_then(Value::as_bool);
            let destructive = t.pointer("/annotations/destructiveHint").and_then(Value::as_bool);
            // sem anotação, o nome da ferramenta decide (get_/list_/read_... só leem)
            let mutating = match read_only {
                Some(ro) => !ro,
                None => !mcp_reads(&tname),
            } || destructive == Some(true);
            add(name, cut(&desc, 700), schema, json!({"source":"mcp","server":sname,"label":format!("{sname} › {tname}"),"mutating":mutating,"readOnly":read_only,"destructive":destructive}));
        }
    }
    app.mcp.set_index(index);
    let big: Vec<&String> = eager.iter().filter(|n| servers.contains(*n) && !eager_fits.contains(*n)).collect();
    let catalog_text = if catalog.is_empty() {
        String::new()
    } else {
        let body: Vec<String> = catalog.iter().map(|(s, v)| if big_servers.contains(s) { LF!("## {s} (só nomes; search_tools com query mostra o que cada uma faz)\n{}", "## {s} (names only; search_tools with query shows what each one does)\n{}", v.join(", ")) } else { format!("## {s}\n{}", v.join("\n")) }).collect();
        let hint = if big.is_empty() {
            String::new()
        } else {
            LF!("\n\nO conector {} tem ferramentas demais para carregar todas; escolha no catálogo as que precisa com search_tools.", "\n\nThe connector {} has too many tools to load them all; pick the ones you need from the catalog with search_tools.", big.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "))
        };
        LF!("Catálogo de ferramentas dos conectores ativos (ainda não carregadas). Para usar uma, chame antes search_tools com names=[...] e ela fica disponível no passo seguinte. Para descobrir qual usar, search_tools com query (só mostra, não carrega). Carregue só as que for usar.\n\n{}{hint}", "Catalog of the active connectors' tools (not loaded yet). To use one, first call search_tools with names=[...] and it becomes available in the next step. To find out which one to use, search_tools with query (only shows, does not load). Load only the ones you will use.

{}{hint}", body.join("\n\n"))
    };
    json!({"tools": tools, "meta": meta, "catalog": catalog_text})
}

/// Ferramenta de conector que, pelo nome, só lê (sem anotação readOnlyHint do servidor).
/// Na dúvida, conta como alteração: o studio pede confirmação.
pub fn mcp_reads(tool: &str) -> bool {
    let n = tool.to_lowercase().replace(['-', ' '], "_");
    // camelCase também: GetRegisters -> get_registers
    let mut snake = String::new();
    for (i, ch) in tool.chars().enumerate() {
        if ch.is_uppercase() && i > 0 && !tool.chars().nth(i - 1).is_some_and(|p| p.is_uppercase() || p == '_') {
            snake.push('_');
        }
        snake.push(ch.to_ascii_lowercase());
    }
    let first = snake.split('_').find(|w| !w.is_empty()).unwrap_or("").to_string();
    const READ: &[&str] = &["get", "list", "read", "search", "find", "query", "describe", "show", "view", "info", "status", "inspect", "lookup", "fetch", "dump", "disasm", "disassemble", "decompile", "resolve", "count", "check", "is", "has", "stat", "enumerate", "browse", "preview", "explain", "analyze", "analyse", "summarize", "print", "peek", "scan", "grep", "locate", "trace", "eval", "evaluate", "load", "open", "hex", "xrefs", "xref", "strings", "symbols", "imports", "exports", "modules", "threads", "registers", "memory", "stack", "callstack", "breakpoints"];
    const WRITE: &[&str] = &["delete", "remove", "drop", "write", "set", "patch", "send", "post", "upload", "create", "update", "kill", "terminate", "exec", "execute", "run", "apply", "move", "rename", "install", "push", "commit", "publish", "restore", "force", "replace", "insert", "modify", "edit", "save", "format", "wipe", "clear", "reset", "assemble", "inject", "attach", "detach", "step", "continue", "pause", "start", "stop"];
    let words: Vec<&str> = snake.split('_').filter(|w| !w.is_empty()).collect();
    if words.iter().any(|w| WRITE.contains(w)) || n.contains("delete") || n.contains("remove") {
        return false;
    }
    READ.contains(&first.as_str())
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

pub fn build_context(app: &App, ws: &Path, skill_ids: &[String], groups: &[String], refs: &[String], now: &str, lazy: bool, map: bool) -> String {
    let has = |g: &str| groups.iter().any(|x| x == g);
    let mut parts = vec![];
    if !now.is_empty() {
        parts.push(LF!("Data de hoje: {now}.", "Today's date: {now}."));
    }
    parts.push(LF!("Sistema do usuário: {}.", "User's system: {}.", if app::IS_WIN { "Windows" } else { std::env::consts::OS }));
    if has("read") || has("write") || has("edit") || has("shell") {
        parts.push(LF!(
            "Pasta de trabalho: {}\nAs ferramentas de arquivo usam caminhos relativos a essa pasta e só escrevem dentro dela. Leia um arquivo antes de editá-lo.\nEconomize contexto: arquivo grande vem como sumário; leia só os trechos (offset/limit) e procure dentro dele com search_files. Para mudar, use edit_file (start_line/end_line ou edits), nunca reescreva o arquivo inteiro. Não leia arquivos pelo terminal (Get-Content, cat, type).", "Workspace: {}\nThe file tools use paths relative to this folder and only write inside it. Read a file before editing it.\nSave context: a large file comes as an outline; read only the parts you need (offset/limit) and search inside it with search_files. To change it, use edit_file (start_line/end_line or edits), never rewrite the whole file. Do not read files through the terminal (Get-Content, cat, type).",
            ws.display()
        ));
        if !refs.is_empty() {
            let list: Vec<String> = refs.iter().map(|r| format!("- {r}")).collect();
            parts.push(LF!("O usuário referenciou estes caminhos (você pode lê-los usando o caminho absoluto):\n{}", "The user referenced these paths (you can read them using the absolute path):\n{}", list.join("\n")));
        }
    }
    if has("shell") {
        // o terminal é o PowerShell; os extras só para o que eles fazem melhor (antes o modelo
        // via "uv/uvx" na lista e tentava rodar tudo com uvx)
        let mut tips: Vec<&str> = vec![];
        if crate::bins::which("rg").is_some() {
            tips.push(L!("buscar texto em arquivos: rg", "search text in files: rg"));
        }
        if crate::bins::which("fd").is_some() {
            tips.push("achar arquivos pelo nome: fd");
        }
        if crate::bins::which("uv").is_some() {
            tips.push(L!("rodar um script Python: uv run script.py (não use uvx)", "run a Python script: uv run script.py (do not use uvx)"));
        }
        if !tips.is_empty() {
            parts.push(LF!("Terminal: PowerShell; use comandos dele para o resto. Atalhos instalados: {}.", "Terminal: PowerShell; use its commands for everything else. Installed shortcuts: {}.", tips.join("; ")));
        }
        if !app.mcp.status_json().is_empty() {
            parts.push(L!("Quando o pedido indicar um conector ou habilidade (Conector:nome, Habilidade:nome), use exatamente esse; não tente outros caminhos antes dele.", "When the request points to a connector or skill (Connector:name, Skill:name), use exactly that one; do not try other paths before it.").into());
            parts.push(L!("Conectores MCP já estão rodando no studio: para o que um conector faz, chame as ferramentas dele (nome_do_conector__ferramenta, ou ache com search_tools). Nunca inicie o servidor de um conector pelo terminal (uvx, npx, python, node).", "MCP connectors are already running in the studio: for what a connector does, call its tools (connector_name__tool, or find them with search_tools). Never start a connector's server from the terminal (uvx, npx, python, node).").into());
        }
    }
    if has("browser") {
        parts.push(L!("Navegador: as ferramentas browser_* controlam uma janela própria do Edge que o usuário vê. Leia a página (browser_read) e use os números dos elementos para clicar e digitar.", "Browser: the browser_* tools control a separate Edge window the user sees. Read the page (browser_read) and use the element numbers to click and type.").into());
    }
    if has("computer") {
        parts.push(L!("Computador: as ferramentas computer_* controlam a área de trabalho do usuário. Prefira computer_elements (lista numerada) a coordenadas. Confirme o resultado depois de cada ação. Se o programa tem conector MCP (x64dbg, dnspy, Unity...), use as ferramentas do conector em vez de controlar a janela dele.", "Computer: the computer_* tools control the user's desktop. Prefer computer_elements (numbered list) over coordinates. Check the result after each action. If the program has an MCP connector (x64dbg, dnspy, Unity...), use the connector's tools instead of controlling its window.").into());
    }
    if has("todo") {
        parts.push(L!("Tarefas com vários passos: comece criando a lista com update_todos e mantenha-a atualizada; ela mostra ao usuário o que já foi feito e o que falta. Não termine com itens pendentes sem explicar por quê.", "Tasks with several steps: start by creating the list with update_todos and keep it updated; it shows the user what is done and what is left. Do not finish with pending items without explaining why.").into());
    }
    if has("notebook") {
        parts.push(L!("Caderno de investigação: registre com notebook o que descobrir de duradouro (endereços, funções, hipóteses e se foram confirmadas) e consulte com notebook list antes de refazer uma investigação.", "Investigation notebook: record with notebook what you find that lasts (addresses, functions, hypotheses and whether they were confirmed) and check notebook list before redoing an investigation.").into());
    }
    if map && (has("read") || has("shell")) {
        let m = crate::projmap::context_text(app, ws);
        if !m.is_empty() {
            parts.push(m);
        }
    }
    if has("explore") {
        parts.push(L!("Para investigações longas, delegue a subagentes com a ferramenta explore (vários em paralelo, se fizer sentido) e trabalhe com os relatórios.", "For long investigations, delegate to subagents with the explore tool (several in parallel, if it makes sense) and work with the reports.").into());
    }
    if has("toolsearch") {
        let hidden: Vec<String> = app.mcp.status_json().iter().filter(|s| s["status"] == "connected").map(|s| format!("{} ({} ferramentas)", s["name"].as_str().unwrap_or(""), s["tools"].as_array().map(|a| a.len()).unwrap_or(0))).collect();
        if !hidden.is_empty() {
            parts.push(LF!("Conectores MCP disponíveis: {}. Se precisar de uma ferramenta que não está na sua lista, use search_tools.", "Available MCP connectors: {}. If you need a tool that is not in your list, use search_tools.", hidden.join(", ")));
        }
    }
    let mut active = vec![];
    for id in skill_ids {
        if let Some(s) = skills::get(app, id) {
            let text = std::fs::read_to_string(s.dir.join("SKILL.md")).unwrap_or_default();
            let (_, body) = skills::parse_frontmatter(&text);
            let files = if s.files.is_empty() { String::new() } else { LF!("Arquivos auxiliares (leia com read_skill_file): {}\n", "Helper files (read with read_skill_file): {}\n", s.files.join(", ")) };
            if lazy && body.len() > 1500 {
                // só o resumo; o corpo é lido quando a tarefa pedir
                active.push(LF!(
                    "<skill id=\"{}\" name=\"{}\">\n{}\nAntes de seguir esta skill, leia as instruções completas com read_skill_file(skill=\"{}\", path=\"SKILL.md\").\n{files}</skill>", "<skill id=\"{}\" name=\"{}\">\n{}\nBefore following this skill, read the full instructions with read_skill_file(skill=\"{}\", path=\"SKILL.md\").\n{files}</skill>",
                    s.id, s.name, cut(s.description.trim(), 400), s.id
                ));
            } else {
                active.push(format!("<skill id=\"{}\" name=\"{}\">\nPasta da skill: {}\n{files}\n{}\n</skill>", s.id, s.name, s.dir.display(), body.trim()));
            }
        }
    }
    if !active.is_empty() {
        parts.push(LF!("O usuário ativou as skills abaixo. Siga as instruções de cada uma sempre que a tarefa se encaixar nela.\n\n{}", "The user turned on the skills below. Follow each one's instructions whenever the task fits it.

{}", active.join("\n\n")));
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
        Err(e) => ToolOut { content: LF!("Erro: {e}", "Error: {e}"), is_error: true, images: vec![] },
    }
}

/// Executa uma ferramenta do servidor (arquivos, shell, navegador, computador ou MCP).
pub async fn call(app: &Arc<App>, ws: PathBuf, name: &str, args: Value, allow: &[String]) -> ToolOut {
    if name.starts_with("browser_") && def(name).is_some() {
        return out(app.browser.tool(&app.http, &ws, name, &args).await);
    }
    if name.starts_with("computer_") && def(name).is_some() {
        if let Some(msg) = app_has_connector(app, &args) {
            return out(Err(msg));
        }
        return out(crate::computer::tool(&ws, name, &args).await);
    }
    let (compact_on, rtk_on) = {
        let c = app.config.read().unwrap();
        (c.compact_output, c.use_rtk)
    };
    if name == "run_command" {
        let timeout = args.get("timeout").and_then(Value::as_u64).unwrap_or(120);
        if let Some(msg) = connector_launch(app, s(&args, "command")) {
            return out(Err(msg));
        }
        if let Some(msg) = whole_read(&ws, s(&args, "cwd"), s(&args, "command")) {
            return out(Err(msg));
        }
        let fixed = fix_command(s(&args, "command"));
        let command = fixed.as_str();
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
        let res = res.map(|t| {
            let note = if fixed != s(&args, "command") { format!("[executado como: {fixed}]\n") } else { String::new() };
            let hint = if command.trim_start().starts_with("uvx") && looks_failed(&t) {
                L!("\n[dica: uvx baixa e roda um pacote Python pelo nome; se o pacote não existir ou não for preciso, use comandos do PowerShell]", "\n[tip: uvx downloads and runs a Python package by name; if the package does not exist or is not needed, use PowerShell commands]")
            } else {
                ""
            };
            format!("{note}{t}{hint}")
        });
        return out(res.map(|t| (t, vec![])));
    }
    if def(name).is_some_and(|d| d.client) {
        return out(Err(LF!("{name} é executada pela interface, não pelo servidor.", "{name} is run by the interface, not by the server.")));
    }
    if def(name).is_some() {
        let allow: Vec<PathBuf> = allow.iter().map(PathBuf::from).collect();
        let app2 = app.clone();
        let name = name.to_string();
        let r = tokio::task::spawn_blocking(move || run_builtin(&app2, &ws, &name, &args, &allow)).await;
        return out(r.map_err(|e| e.to_string()).and_then(|x| x).map(|t| (t, vec![])));
    }
    // confere os argumentos com o esquema do conector antes de chamar: com o catálogo sob demanda,
    // o modelo às vezes chama a ferramenta sem ter visto os parâmetros e inventa os nomes,
    // e o servidor recebe os campos certos vazios
    let mut args = args;
    if let Some(schema) = mcp_schema(app, name) {
        match fit_args(&schema, &mut args) {
            Ok(()) => {}
            Err(msg) => return ToolOut { content: LF!("Erro: argumentos inválidos para {name}. {msg}\n{}", "Error: invalid arguments for {name}. {msg}\n{}", describe_params(&schema)), is_error: true, images: vec![] },
        }
    }
    match app.mcp.call_by_tool(name, args).await {
        Ok((text, is_err, images)) => {
            let content = if compact_on { crate::compact::compact(&text, &crate::compact::saidas_dir(app), name, 12000).text } else { app::truncate(text, 24000) };
            ToolOut { content, is_error: is_err, images }
        }
        Err(e) => ToolOut { content: LF!("Erro: {e}", "Error: {e}"), is_error: true, images: vec![] },
    }
}

/// Esquema de entrada de uma ferramenta MCP (pelo nome exposto ou pelo nome original).
fn mcp_schema(app: &App, name: &str) -> Option<Value> {
    mcp_entries(app, None).into_iter().find(|(n, _, t)| n == name || t["name"] == name).and_then(|(_, _, t)| t.get("inputSchema").cloned()).filter(Value::is_object)
}

/// Lista legível dos parâmetros, para o modelo corrigir a chamada.
fn describe_params(schema: &Value) -> String {
    let req: Vec<&str> = schema["required"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    let Some(props) = schema["properties"].as_object() else { return L!("Esta ferramenta não recebe parâmetros.", "This tool takes no parameters.").into() };
    if props.is_empty() {
        return L!("Esta ferramenta não recebe parâmetros.", "This tool takes no parameters.").into();
    }
    let lines: Vec<String> = props
        .iter()
        .map(|(k, p)| {
            let ty = p["type"].as_str().unwrap_or("valor");
            let d = p["description"].as_str().map(|d| format!(": {}", cut(d, 160))).unwrap_or_default();
            format!("- {k} ({ty}{}){d}", if req.contains(&k.as_str()) { L!(", obrigatório", ", required") } else { "" })
        })
        .collect();
    LF!("Parâmetros esperados:\n{}", "Expected parameters:\n{}", lines.join("\n"))
}

/// Ajusta tipos simples (número em texto e vice-versa) e recusa nomes desconhecidos ou obrigatórios faltando.
fn fit_args(schema: &Value, args: &mut Value) -> Result<(), String> {
    if !args.is_object() {
        *args = json!({});
    }
    let props = schema["properties"].as_object().cloned().unwrap_or_default();
    let open = schema.get("additionalProperties").map(|v| v != &json!(false)).unwrap_or(true) && props.is_empty();
    let obj = args.as_object_mut().unwrap();
    // um nome só diferente na grafia (Address x address, file_path x filepath) é aceito
    let norm = |s: &str| s.to_lowercase().replace(['_', '-'], "");
    let keys: Vec<String> = obj.keys().cloned().collect();
    let mut unknown = vec![];
    for k in keys {
        if props.contains_key(&k) {
            continue;
        }
        if let Some(real) = props.keys().find(|p| norm(p) == norm(&k)) {
            let v = obj.remove(&k).unwrap();
            obj.insert(real.clone(), v);
        } else if !open {
            unknown.push(k);
        }
    }
    for (k, p) in &props {
        let Some(v) = obj.get_mut(k) else { continue };
        match (p["type"].as_str(), &*v) {
            (Some("string"), Value::Number(n)) => *v = json!(n.to_string()),
            (Some("string"), Value::Bool(b)) => *v = json!(b.to_string()),
            (Some("integer"), Value::String(t)) => {
                let t = t.trim();
                if let Ok(n) = t.parse::<i64>() {
                    *v = json!(n);
                } else if let Some(h) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
                    if let Ok(n) = i64::from_str_radix(h, 16) {
                        *v = json!(n);
                    }
                }
            }
            (Some("number"), Value::String(t)) => {
                if let Ok(n) = t.trim().parse::<i64>() {
                    *v = json!(n);
                } else if let Ok(n) = t.trim().parse::<f64>() {
                    *v = json!(n);
                }
            }
            (Some("boolean"), Value::String(t)) => *v = json!(matches!(t.trim().to_lowercase().as_str(), "true" | "1" | "sim" | "yes")),
            _ => {}
        }
    }
    let missing: Vec<&str> = schema["required"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_str).filter(|r| obj.get(*r).is_none_or(|v| v.is_null() || v.as_str() == Some(""))).collect())
        .unwrap_or_default();
    match (unknown.is_empty(), missing.is_empty()) {
        (true, true) => Ok(()),
        _ => {
            let mut m = vec![];
            if !missing.is_empty() {
                m.push(format!("Faltou: {}.", missing.join(", ")));
            }
            if !unknown.is_empty() {
                m.push(LF!("Não existem: {}.", "Do not exist: {}.", unknown.join(", ")));
            }
            Err(m.join(" "))
        }
    }
}

/// Busca por conteúdo com o ripgrep (respeita .gitignore e é bem mais rápida). None = usar a busca própria.

/// Lê um arquivo de texto do jeito econômico: sumário se for grande e sem trecho; trechos com limite de linhas e bytes.
fn read_text(file: &Path, size: u64, a: &Value) -> Result<String, String> {
    let buf = std::fs::read(file).map_err(|x| x.to_string())?;
    if looks_binary(&buf) {
        return Ok(LF!("Arquivo binário ({}): {}. Não dá para ler como texto.", "Binary file ({}): {}. It cannot be read as text.", fmt_size(size), file.display()));
    }
    let text = String::from_utf8_lossy(&buf);
    let text = text.trim_start_matches('\u{feff}');
    let lines: Vec<&str> = text.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect();
    let total = lines.len();
    let ranged = a.get("offset").and_then(Value::as_u64).is_some() || a.get("limit").and_then(Value::as_u64).is_some();
    // arquivo grande lido inteiro gasta muito contexto: devolve o sumário e o modelo lê só o que precisar
    if !ranged && (total > BIG_LINES || text.len() > BIG_BYTES) {
        let ext = file.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
        let marks = outline(&ext, &lines);
        if marks.len() >= 3 {
            let body: Vec<String> = marks.iter().map(|(n, l)| format!("{n}: {l}")).collect();
            return Ok(LF!("[{} linhas, {}. Sumário com o número da linha; leia os trechos com offset/limit ou procure com search_files (path = este arquivo)]\n{}", "[{} lines, {}. Outline with line numbers; read the parts with offset/limit or search with search_files (path = this file)]\n{}", total, fmt_size(size), body.join("\n")));
        }
        let a2 = json!({"offset": 1, "limit": BIG_LINES});
        return read_text(file, size, &a2);
    }
    let off = a.get("offset").and_then(Value::as_u64).unwrap_or(1).max(1) as usize;
    // trecho enorme é o mesmo que ler tudo: corta e diz como continuar
    let lim = (a.get("limit").and_then(Value::as_u64).unwrap_or(2000).max(1) as usize).min(if total > BIG_LINES { MAX_SLICE } else { usize::MAX });
    // também por bytes: poucas linhas enormes (minificado, CSV largo) enchem o contexto do mesmo jeito
    let mut bytes = 0;
    let mut slice: Vec<&str> = vec![];
    for l in lines.iter().skip(off - 1).take(lim) {
        bytes += l.len() + 1;
        if bytes > MAX_SLICE_BYTES && !slice.is_empty() {
            break;
        }
        slice.push(if l.len() > MAX_SLICE_BYTES { &l[..l.floor_char_boundary(MAX_SLICE_BYTES)] } else { l });
    }
    let mut out = slice.join("\n");
    let end = off - 1 + slice.len();
    if off > 1 || end < total {
        let more = if end < total { LF!("; continue com offset={}", "; continue with offset={}", end + 1) } else { String::new() };
        out = LF!("[linhas {off}-{end} de {total}{more}]\n{out}", "[lines {off}-{end} of {total}{more}]\n{out}");
    }
    Ok(out)
}

/// Espaços repetidos viram um só (o modelo nem sempre copia a indentação certinha).
fn norm_ws(t: &str) -> String {
    t.split_whitespace().collect::<Vec<_>>().join(" ")
}

const BIG_LINES: usize = 400;
const SEARCH_MAX: usize = 120;
const MAX_SLICE: usize = 600;
const MAX_SLICE_BYTES: usize = 24 * 1024;

/// Reescreveu um arquivo grande para mudar pouco: diz quanto mudou e como gastar menos.
fn rewrite_hint(before: &str, after: &str) -> String {
    let a: Vec<&str> = before.lines().collect();
    let b: Vec<&str> = after.lines().collect();
    if a.len() < 150 {
        return String::new();
    }
    let pre = a.iter().zip(&b).take_while(|(x, y)| x.trim_end() == y.trim_end()).count();
    let suf = a[pre..].iter().rev().zip(b[pre..].iter().rev()).take_while(|(x, y)| x.trim_end() == y.trim_end()).count();
    let changed = a.len().saturating_sub(pre + suf).max(b.len().saturating_sub(pre + suf));
    if changed * 3 > a.len() {
        return String::new();
    }
    LF!("\n[dica: o arquivo tem {} linhas e só ~{changed} mudaram (a partir da linha {}). Da próxima vez use edit_file com start_line/end_line ou edits: gasta bem menos que reescrever tudo]", "\n[tip: the file has {} lines and only ~{changed} changed (from line {}). Next time use edit_file with start_line/end_line or edits: much cheaper than rewriting everything]", a.len(), pre + 1)
}

/// Comando que só despeja um arquivo grande inteiro (Get-Content x, cat x, type x): manda para read_file.
fn whole_read(ws: &Path, cwd: &str, cmd: &str) -> Option<String> {
    let c = cmd.trim();
    if c.contains('|') || c.contains(';') || c.contains("&&") || c.contains('>') || c.contains('(') {
        return None;
    }
    let toks: Vec<String> = c.split_whitespace().map(|t| t.trim_matches(|ch| ch == '"' || ch == '\'').to_string()).collect();
    let verb = toks.first()?.to_lowercase();
    if !matches!(verb.as_str(), "get-content" | "gc" | "cat" | "type" | "more" | "less" | "head" | "tail") {
        return None;
    }
    if verb == "head" || verb == "tail" || toks.iter().any(|t| matches!(t.to_lowercase().as_str(), "-totalcount" | "-head" | "-tail" | "-first" | "-last" | "-n")) {
        return None;
    }
    let mut i = 1;
    let mut path = None;
    while i < toks.len() {
        let t = &toks[i];
        if t.eq_ignore_ascii_case("-path") || t.eq_ignore_ascii_case("-literalpath") {
            path = toks.get(i + 1).cloned();
            break;
        }
        if t.eq_ignore_ascii_case("-encoding") {
            i += 2;
            continue;
        }
        if !t.starts_with('-') {
            path = Some(t.clone());
            break;
        }
        i += 1;
    }
    let p = path?;
    let base = if cwd.is_empty() { ws.to_path_buf() } else { ws.join(cwd) };
    let f = if Path::new(&p).is_absolute() { PathBuf::from(&p) } else { base.join(&p) };
    let md = std::fs::metadata(&f).ok()?;
    if !md.is_file() || md.len() as usize <= BIG_BYTES / 2 {
        return None;
    }
    let lines = std::fs::read(&f).ok().filter(|b| !looks_binary(b)).map(|b| b.iter().filter(|&&x| x == b'\n').count())?;
    if lines <= BIG_LINES && md.len() as usize <= BIG_BYTES {
        return None;
    }
    Some(LF!("{p} tem {lines} linhas ({}): ler inteiro pelo terminal enche o contexto. Use read_file com path=\"{p}\" (devolve um sumário com números de linha) e depois offset/limit no trecho, ou search_files com path=\"{p}\" e content=... para achar as linhas. Se precisar mesmo de uma parte pelo terminal: Get-Content {p} -TotalCount 100.", "{p} has {lines} lines ({}): reading it whole through the terminal fills the context. Use read_file with path=\"{p}\" (returns an outline with line numbers) and then offset/limit on the part, or search_files with path=\"{p}\" and content=... to find the lines. If you really need a part through the terminal: Get-Content {p} -TotalCount 100.", fmt_size(md.len())))
}
const BIG_BYTES: usize = 40 * 1024;

/// Sumário de um arquivo grande: as linhas que marcam a estrutura, com o número.
fn outline(ext: &str, lines: &[&str]) -> Vec<(usize, String)> {
    let re = match ext {
        "tex" | "sty" | "cls" | "ltx" => r"^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|begin\{document\}|end\{document\}|appendix|input|include|bibliography|printbibliography|maketitle|tableofcontents)\b|^\s*\\begin\{(abstract|figure|table|algorithm|thebibliography)\*?\}",
        "md" | "markdown" | "rst" | "txt" => r"^#{1,4} \S|^[=-]{3,}\s*$",
        "rs" => r"^\s*(pub(\([^)]*\))? )?(async )?(fn|struct|enum|trait|impl|mod|macro_rules!) ",
        "py" => r"^\s*(async )?(def|class) \w",
        "js" | "mjs" | "cjs" | "ts" | "tsx" | "jsx" => r"^\s*(export )?(default )?(async )?(function\*? \w|class \w)|^\s*(export )?(const|let) \w+ = (async )?(\([^)]*\)|\w+) =>",
        "cs" | "java" | "kt" => r"^\s*(public|private|protected|internal|static|override|async|sealed|abstract| )+[\w<>\[\], ]+ \w+\s*\(|^\s*(public |internal |private )?(sealed |static |abstract )*(class|interface|struct|enum|record) \w",
        "c" | "h" | "cpp" | "hpp" | "cc" => r"^[A-Za-z_][\w\s\*&:<>,]*\s[\*&]?\w[\w:]*\s*\([^;]*$|^(struct|class|enum|namespace) \w",
        "go" => r"^(func|type) ",
        "ps1" | "psm1" => r"^\s*function \w",
        "lua" => r"^\s*(local )?function ",
        "html" | "htm" | "xml" => r"^\s*<(h[1-3]|section|head|body|script|style|template)\b",
        "css" | "scss" => r"^\S[^{]*\{\s*$|^@media",
        _ => return vec![],
    };
    let Ok(re) = regex_lite::Regex::new(re) else { return vec![] };
    let mut out = vec![];
    for (i, l) in lines.iter().enumerate() {
        // em LaTeX, linha comentada não conta
        if ext == "tex" && l.trim_start().starts_with('%') {
            continue;
        }
        if re.is_match(l) {
            out.push((i + 1, cut(l.trim_end(), 110)));
            if out.len() >= 300 {
                out.push((0, L!("... (sumário cortado; procure com search_files)", "... (outline cut; search with search_files)").into()));
                break;
            }
        }
    }
    out
}

fn search_rg(ws: &Path, start: &Path, name: &str, pattern: &str) -> Option<String> {
    let rg = crate::bins::which("rg")?;
    let mut c = std::process::Command::new(rg);
    c.args(["-n", "-i", "--no-heading", "--color", "never", "--max-count", "20", "--max-columns", "180", "--max-columns-preview", "--max-filesize", "2M"]);
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
    for l in text.lines().take(SEARCH_MAX) {
        let l = l.strip_prefix("./").or_else(|| l.strip_prefix(".\\")).unwrap_or(l);
        let (file, rest) = l.split_once(':').unwrap_or((l, ""));
        lines.push(format!("{}:{}", rel_to(ws, &start.join(file)), rest));
    }
    let n = text.lines().count();
    Some(lines.join("\n") + &if n > SEARCH_MAX { LF!("\n[mostrando {SEARCH_MAX} de {n}; refine a busca (name, path ou regex mais específica)]", "\n[showing {SEARCH_MAX} of {n}; narrow the search (name, path or a more specific regex)]") } else { String::new() })
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
    Err(LF!("Acesso negado: \"{p}\" está fora da pasta de trabalho ({}).", "Access denied: \"{p}\" is outside the workspace ({}).", ws.display()))
}

/// Controlar pela tela um programa que tem conector (ex.: a janela do x64dbg) é lento e erra muito:
/// recusa e aponta as ferramentas do conector.
fn app_has_connector(app: &App, args: &Value) -> Option<String> {
    let low = args.to_string().to_lowercase();
    for sv in app.mcp.status_json() {
        let name = sv["name"].as_str().unwrap_or("");
        let key: String = name.to_lowercase().replace("mcp", "").chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        if key.len() < 4 || !low.contains(&key) || sv["status"] != "connected" {
            continue;
        }
        let tools: Vec<String> = sv["tools"].as_array().into_iter().flatten().filter_map(|t| t["name"].as_str()).take(8).map(|t| format!("{}__{}", safe_name(name), safe_name(t))).collect();
        return Some(LF!(
            "Não controlei a tela: o programa \"{name}\" tem conector conectado no studio. Use as ferramentas dele ({}{}); são mais rápidas e precisas que clicar na janela. Se precisar de uma que não está carregada, use search_tools.", "I did not control the screen: the program \"{name}\" has a connector connected in the studio. Use its tools ({}{}); they are faster and more precise than clicking the window. If you need one that is not loaded, use search_tools.",
            tools.join(", "),
            if tools.len() == 8 { ", ..." } else { "" }
        ));
    }
    None
}

/// O modelo às vezes tenta rodar pelo terminal o servidor de um conector (ex.: `uvx mcp-server-fetch`),
/// que já está rodando no studio. Em vez de executar, aponta as ferramentas do conector.
fn connector_launch(app: &App, cmd: &str) -> Option<String> {
    let low = cmd.to_lowercase().replace('\\', "/");
    // algum lançador em qualquer parte do comando (cd ...; uv run x.py / & "C:/.../python.exe" x.py)
    let launcher = regex_lite::Regex::new(r#"(^|[\s;&|("'/])(uvx|uv|npx|bunx|pnpx|python3?|py|pythonw|node|docker|pipx)(\.exe)?($|[\s"'])"#).unwrap().is_match(&low)
        || low.trim_start().starts_with('&');
    if !launcher {
        return None;
    }
    let servers = app.mcp.status_json();
    for sv in &servers {
        let cfg = &sv["config"];
        // pedaços que identificam o servidor: o pacote ou o script nos argumentos
        let toks: Vec<String> = cfg["args"].as_array().into_iter().flatten().filter_map(|a| a.as_str()).map(|a| a.to_lowercase().replace('\\', "/"))
            .filter(|a| !a.starts_with('-') && a.len() >= 5 && !matches!(a.as_str(), "--yes" | "run" | "tool" | "--from"))
            .collect();
        let hit = toks.iter().any(|t| low.contains(t.rsplit('/').next().unwrap_or(t)));
        if hit {
            let name = sv["name"].as_str().unwrap_or("");
            let tools: Vec<String> = sv["tools"].as_array().into_iter().flatten().filter_map(|t| t["name"].as_str()).take(6).map(|t| format!("{}__{}", safe_name(name), safe_name(t))).collect();
            return Some(match sv["status"].as_str().unwrap_or("") {
                "connected" => LF!("Não executei: esse comando inicia o conector \"{name}\", que já está rodando no studio. Chame as ferramentas dele diretamente ({}{}), ou use search_tools.", "Not run: this command starts the connector \"{name}\", which is already running in the studio. Call its tools directly ({}{}), or use search_tools.", tools.join(", "), if tools.len() == 6 { ", ..." } else { "" }),
                "disabled" => LF!("Não executei: esse comando inicia o conector \"{name}\", que está desligado. Peça ao usuário para ligá-lo em Conectores e então use as ferramentas dele.", "Not run: this command starts the connector \"{name}\", which is turned off. Ask the user to turn it on in Connectors and then use its tools."),
                "connecting" => LF!("Não executei: esse comando inicia o conector \"{name}\", que está conectando agora. Espere um pouco e use as ferramentas dele (search_tools mostra quais são).", "Not run: this command starts the connector \"{name}\", which is connecting right now. Wait a moment and use its tools (search_tools shows which they are)."),
                st => LF!("Não executei: esse comando inicia o conector \"{name}\", que está com problema ({st}{}). Rodar pelo terminal não resolve: avise o usuário para abrir Conectores, ver o registro do \"{name}\" e reconectar.", "Not run: this command starts the connector \"{name}\", which has a problem ({st}{}). Running it from the terminal does not help: tell the user to open Connectors, check the \"{name}\" log and reconnect.",
                    sv["error"].as_str().filter(|e| !e.is_empty()).map(|e| format!(": {}", e.chars().take(200).collect::<String>())).unwrap_or_default()),
            });
        }
    }
    // servidor MCP genérico que nem está cadastrado
    if low.contains("modelcontextprotocol") || low.contains("mcp") && (low.contains("server") || low.contains("-mcp") || low.contains("mcp-")) {
        return Some(L!("Não executei: isso parece iniciar um servidor MCP, que fica esperando conexão e não responde pelo terminal. Use as ferramentas dos conectores que já estão no studio (search_tools ajuda a achar), ou peça ao usuário para cadastrar esse conector em Conectores.", "Not run: this looks like it starts an MCP server, which waits for a connection and does not answer through the terminal. Use the tools of the connectors already in the studio (search_tools helps find them), or ask the user to add this connector in Connectors.").into());
    }
    None
}

/// Ajusta comandos que costumam falhar no Windows: `python`/`pip` sem Python instalado
/// (o "python" do Windows abre a Microsoft Store) passam a usar o uv, se ele estiver instalado.
fn fix_command(cmd: &str) -> String {
    let t = cmd.trim_start();
    let first = t.split_whitespace().next().unwrap_or("").to_lowercase();
    if !matches!(first.as_str(), "python" | "python3" | "py" | "pip" | "pip3") || crate::bins::which("uv").is_none() {
        return cmd.to_string();
    }
    let real_python = ["python", "python3", "py"].iter().filter_map(|c| crate::bins::which(c)).any(|p| !p.to_string_lossy().to_lowercase().contains("windowsapps"));
    if real_python {
        return cmd.to_string();
    }
    let rest = t[first.len()..].trim_start();
    match first.as_str() {
        "pip" | "pip3" => format!("uv pip {rest}{}", if rest.starts_with("install") && !rest.contains("--system") { " --system" } else { "" }),
        _ => format!("uv run python {rest}"),
    }
}

fn looks_failed(t: &str) -> bool {
    let l = t.to_lowercase();
    ["error", "erro", "not found", "não encontrado", "no solution", "failed", "código de saída: 1", "exit code: 1"].iter().any(|w| l.contains(w))
}

pub(crate) fn resolve_write(ws: &Path, p: &str) -> Result<PathBuf, String> {
    let full = resolve(ws, p);
    if !is_inside(ws, &full) || app::normalize(&full) == app::normalize(ws) {
        return Err(LF!("Só posso escrever dentro da pasta de trabalho ({}).", "I can only write inside the workspace ({}).", ws.display()));
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
            const SHOW: usize = 300;
            for it in items.iter().take(SHOW) {
                let n = it.file_name().to_string_lossy().into_owned();
                if it.path().is_dir() {
                    lines.push(LF!("[pasta] {n}/", "[folder] {n}/"));
                } else {
                    let size = it.metadata().map(|m| fmt_size(m.len())).unwrap_or_default();
                    lines.push(format!("{n}  ({size})"));
                }
            }
            if items.len() > SHOW {
                // o resto vira contagem por tipo; para achar algo, search_files
                let mut by: std::collections::BTreeMap<String, usize> = Default::default();
                for it in &items[SHOW..] {
                    let k = if it.path().is_dir() { L!("pastas", "folders").to_string() } else { it.path().extension().map(|x| format!(".{}", x.to_string_lossy().to_lowercase())).unwrap_or_else(|| L!("sem extensão", "no extension").into()) };
                    *by.entry(k).or_default() += 1;
                }
                let mut v: Vec<_> = by.into_iter().collect();
                v.sort_by(|a, b| b.1.cmp(&a.1));
                let parts: Vec<String> = v.iter().take(8).map(|(k, n)| format!("{n} {k}")).collect();
                lines.push(LF!("... e mais {} itens ({}). Para achar algo aqui, use search_files com name.", "... and {} more items ({}). To find something here, use search_files with name.", items.len() - SHOW, parts.join(", ")));
            }
            Ok(format!("{}\n{}", dir.display(), if lines.is_empty() { L!("(vazia)", "(empty)").into() } else { lines.join("\n") }))
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
                return Err(LF!("Arquivo grande demais ({}).", "File too large ({}).", fmt_size(md.len())));
            }
            read_text(&file, md.len(), a)
        }
        "write_file" => {
            let file = resolve_write(ws, s(a, "path"))?;
            if let Some(p) = file.parent() {
                std::fs::create_dir_all(p).map_err(e)?;
            }
            let existed = file.exists();
            let content = s(a, "content");
            let before = if existed { std::fs::read_to_string(&file).ok() } else { None };
            // arquivo do Windows (CRLF) continua CRLF mesmo que o modelo mande só \n
            let crlf_content;
            let content = if before.as_deref().is_some_and(|b| b.contains("\r\n")) && !content.contains('\r') { crlf_content = content.replace('\n', "\r\n"); crlf_content.as_str() } else { content };
            std::fs::write(&file, content).map_err(e)?;
            let hint = before.map(|b| rewrite_hint(&b, content)).unwrap_or_default();
            Ok(format!("{}: {} ({}){hint}", if existed { L!("Substituído", "Replaced") } else { L!("Criado", "Created") }, rel_to(ws, &file), fmt_size(content.len() as u64)))
        }
        "edit_file" => {
            let file = resolve_write(ws, s(a, "path"))?;
            let text = std::fs::read_to_string(&file).map_err(e)?;
            let crlf = text.contains("\r\n");
            let new = s(a, "new_text");
            // por linhas: não precisa repetir o texto antigo
            if let Some(start) = a.get("start_line").and_then(Value::as_u64).filter(|_| s(a, "old_text").is_empty()) {
                let start = start.max(1) as usize;
                let end = a.get("end_line").and_then(Value::as_u64).map(|x| x as usize).unwrap_or(start);
                let mut lines: Vec<&str> = text.split('\n').collect();
                let total = lines.len();
                if start > total + 1 || end + 1 < start || end > total {
                    return Err(LF!("Linhas fora do arquivo ({total} linhas).", "Lines outside the file ({total} lines)."));
                }
                // confere o lugar: números de uma leitura antiga erram depois de inserir linhas acima
                let want = norm_ws(s(a, "expect"));
                if !want.is_empty() {
                    let at = |i: usize| lines.get(i).map(|l| norm_ws(l.trim_end_matches('\r'))).unwrap_or_default();
                    if !at(start - 1).starts_with(&want) {
                        let moved = (0..total).filter(|&i| at(i).starts_with(&want)).min_by_key(|&i| (i as i64 - (start as i64 - 1)).abs());
                        let near: Vec<String> = (start.saturating_sub(1)..(start + 2).min(total)).map(|i| format!("{}: {}", i + 1, cut(lines[i].trim_end_matches('\r'), 100))).collect();
                        return Err(LF!("A linha {start} não começa com \"{}\". Nada foi alterado.{}\nO que está lá agora:\n{}", "Line {start} does not start with \"{}\". Nothing was changed.{}\nWhat is there now:\n{}", cut(&want, 60), moved.map(|i| LF!(" Esse texto está agora na linha {} (diferença de {}).", " That text is now on line {} (off by {}).", i + 1, i as i64 + 1 - start as i64)).unwrap_or_default(), near.join("\n")));
                    }
                }
                let before = lines[start - 1..end].iter().map(|l| l.trim_end_matches('\r')).collect::<Vec<_>>();
                let nl: Vec<String> = if new.is_empty() { vec![] } else { new.split('\n').map(|l| if crlf { format!("{}\r", l.trim_end_matches('\r')) } else { l.to_string() }).collect() };
                let added = nl.len();
                let tail_cr = end == total && !text.ends_with('\n');
                let mut nl = nl;
                if tail_cr { if let Some(last) = nl.last_mut() { *last = last.trim_end_matches('\r').to_string(); } }
                let refs: Vec<&str> = nl.iter().map(|x| x.as_str()).collect();
                lines.splice(start - 1..end, refs);
                std::fs::write(&file, lines.join("\n")).map_err(e)?;
                let what = if end < start { LF!("{added} linha(s) inserida(s) antes da {start}", "{added} line(s) inserted before line {start}") } else { LF!("linhas {start}-{end} trocadas por {added}", "lines {start}-{end} replaced by {added}") };
                let first = before.first().map(|l| cut(l.trim(), 70)).unwrap_or_default();
                return Ok(LF!("Editado: {} ({what}{})", "Edited: {} ({what}{})", rel_to(ws, &file), if first.is_empty() { String::new() } else { LF!("; antes começava com: {first}", "; it used to start with: {first}") }));
            }
            // várias trocas de uma vez (tudo ou nada)
            let pairs: Vec<(String, String)> = match a.get("edits").and_then(Value::as_array) {
                Some(list) if !list.is_empty() => list.iter().map(|x| (s(x, "old_text").to_string(), s(x, "new_text").to_string())).collect(),
                _ => vec![(s(a, "old_text").to_string(), new.to_string())],
            };
            let all = a.get("replace_all").and_then(Value::as_bool).unwrap_or(false);
            let mut out = text.clone();
            let mut n = 0;
            for (i, (old, new)) in pairs.iter().enumerate() {
                let tag = if pairs.len() > 1 { format!("Troca {}: ", i + 1) } else { String::new() };
                if old.is_empty() {
                    return Err(LF!("{tag}old_text vazio. Para trocar por número de linha, use start_line/end_line.", "{tag}empty old_text. To replace by line number, use start_line/end_line."));
                }
                // o modelo costuma mandar \n onde o arquivo tem \r\n
                let old_f = if crlf && !old.contains('\r') && !out.contains(old.as_str()) { old.replace('\n', "\r\n") } else { old.clone() };
                let new_f = if old_f != *old { new.replace('\n', "\r\n") } else { new.clone() };
                let count = out.matches(old_f.as_str()).count();
                if count == 0 {
                    return Err(LF!("{tag}old_text não encontrado no arquivo. Leia o trecho de novo (offset/limit) e copie exato.{}", "{tag}old_text not found in the file. Read the part again (offset/limit) and copy it exactly.{}", if pairs.len() > 1 { L!(" Nada foi alterado.", " Nothing was changed.") } else { "" }));
                }
                if count > 1 && !all {
                    return Err(LF!("{tag}old_text aparece {count} vezes. Inclua mais contexto ou use replace_all.{}", "{tag}old_text appears {count} times. Include more context or use replace_all.{}", if pairs.len() > 1 { L!(" Nada foi alterado.", " Nothing was changed.") } else { "" }));
                }
                out = if all { n += count; out.replace(old_f.as_str(), &new_f) } else { n += 1; out.replacen(old_f.as_str(), &new_f, 1) };
            }
            std::fs::write(&file, &out).map_err(e)?;
            let big_old = pairs.iter().map(|(o, _)| o.lines().count()).max().unwrap_or(0) > 25;
            Ok(LF!("Editado: {} ({n} substituição(ões)){}", "Edited: {} ({n} replacement(s)){}", rel_to(ws, &file), if big_old { L!("\n[dica: para trocar um bloco grande, use start_line/end_line com só o texto novo; não precisa repetir o antigo]", "\n[tip: to replace a large block, use start_line/end_line with only the new text; no need to repeat the old one]") } else { "" }))
        }
        "create_directory" => {
            let dir = resolve_write(ws, s(a, "path"))?;
            std::fs::create_dir_all(&dir).map_err(e)?;
            Ok(LF!("Pasta criada: {}", "Folder created: {}", rel_to(ws, &dir)))
        }
        "search_files" => {
            let p = s(a, "path");
            let start = resolve_read(app, ws, if p.is_empty() { "." } else { p }, allow)?;
            let name_re = (!s(a, "name").is_empty()).then(|| wildcard(s(a, "name")));
            let content_re = if s(a, "content").is_empty() {
                None
            } else {
                Some(regex_lite::Regex::new(&format!("(?i){}", s(a, "content"))).map_err(|x| LF!("Regex inválida: {x}", "Invalid regex: {x}"))?)
            };
            if let (Some(re), true) = (&content_re, start.is_file()) {
                let text = std::fs::read(&start).map_err(e)?;
                let text = String::from_utf8_lossy(&text);
                let all: Vec<(usize, &str)> = text.split('\n').enumerate().filter(|(_, l)| re.is_match(l)).collect();
                let hits: Vec<String> = all.iter().take(SEARCH_MAX).map(|(i, l)| format!("{}: {}", i + 1, cut(l.trim_end_matches('\r'), 180))).collect();
                let more = if all.len() > SEARCH_MAX { LF!("\n[mostrando {SEARCH_MAX} de {}; refine a regex]", "\n[showing {SEARCH_MAX} of {}; narrow the regex]", all.len()) } else { String::new() };
                return Ok(if hits.is_empty() { "Nada encontrado.".into() } else { format!("{}\n{}{more}", rel_to(ws, &start), hits.join("\n")) });
            }
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
                if results.len() >= SEARCH_MAX || i > 50000 || Instant::now() > deadline {
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
                    if results.len() >= SEARCH_MAX {
                        break;
                    }
                    if cre.is_match(line) {
                        let t: String = line.trim().chars().take(180).collect();
                        results.push(format!("{shown}:{}: {t}", ln + 1));
                    }
                }
            }
            if results.is_empty() {
                Ok("Nada encontrado.".into())
            } else {
                let full = results.len() >= SEARCH_MAX;
                Ok(results.join("\n") + &if full { LF!("\n[limite de {SEARCH_MAX} resultados; refine a busca]", "\n[limit of {SEARCH_MAX} results; narrow the search]") } else { String::new() })
            }
        }
        "read_skill_file" => {
            let sk = skills::get(app, s(a, "skill")).ok_or_else(|| {
                let ids: Vec<String> = skills::list(app).iter().map(|k| format!("{} ({})", k.id, k.name)).collect();
                LF!("Skill não encontrada: \"{}\". Use um destes ids: {}", "Skill not found: \"{}\". Use one of these ids: {}", s(a, "skill"), ids.join(", "))
            })?;
            let p = s(a, "path");
            let file = resolve(&sk.dir, if p.is_empty() { "SKILL.md" } else { p });
            if !is_inside(&sk.dir, &file) {
                return Err(L!("Caminho fora da pasta da skill.", "Path outside the skill folder.").into());
            }
            if file.is_dir() {
                let names: Vec<String> = std::fs::read_dir(&file).map_err(e)?.flatten().map(|x| file_name(&x.path())).collect();
                return Ok(names.join("\n"));
            }
            let size = std::fs::metadata(&file).map_err(e)?.len();
            read_text(&file, size, a)
        }
        _ => Err(format!("Ferramenta desconhecida: {name}")),
    }
}

#[cfg(test)]
mod mcp_le {
    use super::mcp_reads;
    #[test]
    fn leitura_pelo_nome() {
        for n in ["read_memory", "GetRegisters", "list_modules", "decompile_type", "search", "get_il", "DisasmAt", "ListClasses"] {
            assert!(mcp_reads(n), "{n} devia ser leitura");
        }
        for n in ["ExecuteDebuggerCommand", "write_memory", "patch_il_instructions", "delete_file", "SetBreakpoint", "send_message", "force_return", "get_and_delete", "generate_model", "assembly_info"] {
            assert!(!mcp_reads(n), "{n} devia pedir confirmação");
        }
    }
}
