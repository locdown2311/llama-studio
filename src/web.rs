//! Pesquisa na web sem abrir navegador: `web_search` devolve resultados (título, link, trecho) e `web_fetch` lê o
//! texto de uma página. Tudo pelo servidor, como as outras IAs fazem: nada de janela abrindo, e os links aparecem
//! no chat para quem quiser conferir.
//!
//! Buscador: DuckDuckGo (sem chave) e, se ele recusar, o Bing. Com chave do Brave Search ou um SearXNG próprio
//! (Configurações › Ferramentas), usa esses.

use crate::app::App;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

pub struct Hit {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Páginas lidas recentemente (url -> texto), para a verificação das afirmações conferir sem baixar de novo.
static PAGES: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

pub fn remember(url: &str, text: &str) {
    let mut v = PAGES.lock().unwrap();
    v.retain(|(u, _)| u != url);
    v.push((url.to_string(), text.chars().take(200_000).collect()));
    if v.len() > 60 {
        v.remove(0);
    }
}

pub fn cached(url: &str) -> Option<String> {
    PAGES.lock().unwrap().iter().find(|(u, _)| u == url).map(|(_, t)| t.clone())
}

pub fn enc(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => o.push(b as char),
            b' ' => o.push('+'),
            _ => o.push_str(&format!("%{b:02X}")),
        }
    }
    o
}

fn dec(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(if b[i] == b'+' { b' ' } else { b[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// &amp; &lt; &#39; &#x2F; ... -> texto.
pub fn entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let named: HashMap<&str, &str> = [("amp", "&"), ("lt", "<"), ("gt", ">"), ("quot", "\""), ("apos", "'"), ("nbsp", " "), ("ndash", "–"), ("mdash", "—"), ("hellip", "…"), ("laquo", "«"), ("raquo", "»"), ("copy", "©"), ("reg", "®"), ("rsquo", "’"), ("lsquo", "‘"), ("ldquo", "“"), ("rdquo", "”"), ("middot", "·"), ("bull", "•")].into_iter().collect();
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(a) = rest.find('&') {
        out.push_str(&rest[..a]);
        let tail = &rest[a + 1..];
        let end = tail.find(';').filter(|&e| e <= 10);
        let rep = end.and_then(|e| {
            let name = &tail[..e];
            if let Some(n) = name.strip_prefix("#x").or_else(|| name.strip_prefix("#X")) {
                u32::from_str_radix(n, 16).ok().and_then(char::from_u32).map(String::from)
            } else if let Some(n) = name.strip_prefix('#') {
                n.parse::<u32>().ok().and_then(char::from_u32).map(String::from)
            } else {
                named.get(name).map(|v| v.to_string())
            }
            .map(|r| (r, e))
        });
        match rep {
            Some((r, e)) => {
                out.push_str(&r);
                rest = &tail[e + 1..];
            }
            None => {
                out.push('&');
                rest = tail;
            }
        }
    }
    out.push_str(rest);
    out
}

fn strip_tags(s: &str) -> String {
    static RE: std::sync::OnceLock<regex_lite::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex_lite::Regex::new(r"(?s)<[^>]*>").unwrap());
    entities(&re.replace_all(s, "")).split_whitespace().collect::<Vec<_>>().join(" ")
}

/// HTML -> texto legível: tira script/estilo/menus, quebra linhas nos blocos, marca títulos e itens de lista.
pub fn html_text(html: &str) -> (String, String) {
    let title = regex_lite::Regex::new(r"(?is)<title[^>]*>(.*?)</title>").unwrap().captures(html).map(|c| strip_tags(&c[1])).unwrap_or_default();
    let mut h = html.to_string();
    for tag in ["script", "style", "noscript", "svg", "template", "iframe", "nav", "footer", "aside", "form"] {
        let re = regex_lite::Regex::new(&format!(r"(?is)<{tag}\b.*?</{tag}\s*>")).unwrap();
        h = re.replace_all(&h, " ").to_string();
    }
    h = regex_lite::Regex::new(r"(?s)<!--.*?-->").unwrap().replace_all(&h, " ").to_string();
    // o conteúdo principal, se a página marcar (article/main) e ele não for pequeno demais
    for tag in ["article", "main"] {
        let re = regex_lite::Regex::new(&format!(r"(?is)<{tag}\b[^>]*>(.*)</{tag}\s*>")).unwrap();
        if let Some(c) = re.captures(&h) {
            if strip_tags(&c[1]).len() > 600 {
                h = c[1].to_string();
                break;
            }
        }
    }
    let heads = regex_lite::Regex::new(r"(?is)<h([1-6])[^>]*>(.*?)</h[1-6]>").unwrap();
    h = heads.replace_all(&h, |c: &regex_lite::Captures| format!("\n\n{} {}\n", "#".repeat(c[1].parse::<usize>().unwrap_or(2)), strip_tags(&c[2]))).to_string();
    h = regex_lite::Regex::new(r"(?is)<li\b[^>]*>").unwrap().replace_all(&h, "\n- ").to_string();
    h = regex_lite::Regex::new(r"(?is)<pre\b[^>]*>(.*?)</pre>").unwrap().replace_all(&h, |c: &regex_lite::Captures| {
        // código: mantém as quebras de linha
        let inner = regex_lite::Regex::new(r"(?s)<[^>]*>").unwrap().replace_all(&c[1], "").to_string();
        format!("\n```\n{}\n```\n", entities(&inner).trim_end())
    }).to_string();
    h = regex_lite::Regex::new(r"(?is)<(br|/p|/div|/tr|/section|/blockquote|/table|/ul|/ol|p|div|tr|section|blockquote|table)\b[^>]*>").unwrap().replace_all(&h, "\n").to_string();
    h = regex_lite::Regex::new(r"(?is)</t[dh]>").unwrap().replace_all(&h, " | ").to_string();
    // texto: sem tags, espaços colapsados por linha (fora dos blocos de código)
    let mut out = String::new();
    let mut in_code = false;
    for line in h.split('\n') {
        if line.trim() == "```" {
            in_code = !in_code;
            out.push_str("```\n");
            continue;
        }
        if in_code {
            out.push_str(line);
            out.push('\n');
            continue;
        }
        let t = strip_tags(line);
        if t.is_empty() {
            if !out.ends_with("\n\n") {
                out.push('\n');
            }
        } else {
            out.push_str(&t);
            out.push('\n');
        }
    }
    (title, out.trim().to_string())
}

fn client(app: &App) -> &reqwest::Client {
    &app.web
}

async fn get_text(app: &App, url: &str, secs: u64) -> Result<(u16, String, String), String> {
    let r = client(app)
        .get(url)
        .header("User-Agent", UA)
        .header("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5")
        .header("Accept-Language", "pt-BR,pt;q=0.9,en;q=0.8")
        .timeout(Duration::from_secs(secs))
        .send()
        .await
        .map_err(|e| LF!("Não consegui abrir {url}: {e}", "Could not open {url}: {e}"))?;
    let status = r.status().as_u16();
    let ct = r.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_lowercase();
    let final_url = r.url().to_string();
    let bytes = r.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(L!("Página grande demais (mais de 8 MB).", "Page too large (over 8 MB).").into());
    }
    if ct.contains("application/pdf") || bytes.starts_with(b"%PDF") {
        return Err(LF!("{final_url} é um PDF: este leitor não lê PDF. Baixe com run_command (curl/Invoke-WebRequest) e leia com uma ferramenta de PDF, ou abra no navegador.", "{final_url} is a PDF: this reader does not read PDFs. Download it with run_command (curl/Invoke-WebRequest) and read it with a PDF tool, or open it in the browser."));
    }
    Ok((status, ct, String::from_utf8_lossy(&bytes).to_string()))
}

/* ---- buscadores ---- */

async fn ddg(app: &App, q: &str) -> Result<Vec<Hit>, String> {
    let (st, _, html) = get_text(app, &format!("https://html.duckduckgo.com/html/?q={}&kl=br-pt", enc(q)), 20).await?;
    if st != 200 {
        return Err(format!("DuckDuckGo {st}"));
    }
    Ok(parse_ddg(&html))
}

fn parse_ddg(html: &str) -> Vec<Hit> {
    let block = regex_lite::Regex::new(r#"(?is)<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>(.*?)</a>(.*?)(?:<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</a>|</div>\s*</div>)"#).unwrap();
    let mut out = vec![];
    for c in block.captures_iter(html) {
        let mut url = entities(&c[1]);
        if let Some(i) = url.find("uddg=") {
            let v = &url[i + 5..];
            url = dec(v.split('&').next().unwrap_or(v));
        }
        if url.starts_with("//") {
            url = format!("https:{url}");
        }
        // anúncios do próprio DuckDuckGo
        if url.contains("duckduckgo.com/y.js") || !url.starts_with("http") {
            continue;
        }
        out.push(Hit { title: strip_tags(&c[2]), url, snippet: c.get(4).map(|m| strip_tags(m.as_str())).unwrap_or_default() });
    }
    out
}

async fn bing(app: &App, q: &str) -> Result<Vec<Hit>, String> {
    let (st, _, html) = get_text(app, &format!("https://www.bing.com/search?q={}&setlang=pt-BR", enc(q)), 20).await?;
    if st != 200 {
        return Err(format!("Bing {st}"));
    }
    Ok(parse_bing(&html))
}

fn parse_bing(html: &str) -> Vec<Hit> {
    let item = regex_lite::Regex::new(r#"(?is)<li class="b_algo"[^>]*>(.*?)</li>"#).unwrap();
    let link = regex_lite::Regex::new(r#"(?is)<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>"#).unwrap();
    let para = regex_lite::Regex::new(r#"(?is)<p[^>]*>(.*?)</p>"#).unwrap();
    let mut out = vec![];
    for c in item.captures_iter(html) {
        let Some(l) = link.captures(&c[1]) else { continue };
        let mut url = entities(&l[1]);
        // links de rastreio do Bing (bing.com/ck/a?...&u=a1<base64>)
        if url.contains("bing.com/ck/") {
            if let Some(u) = url.split("&u=a1").nth(1).map(|x| x.split('&').next().unwrap_or("")) {
                use base64::Engine;
                let pad = |s: &str| format!("{s}{}", "=".repeat((4 - s.len() % 4) % 4));
                if let Ok(b) = base64::engine::general_purpose::URL_SAFE.decode(pad(u)) {
                    url = String::from_utf8_lossy(&b).to_string();
                }
            }
        }
        if !url.starts_with("http") {
            continue;
        }
        out.push(Hit { title: strip_tags(&l[2]), url, snippet: para.captures(&c[1]).map(|p| strip_tags(&p[1])).unwrap_or_default() });
    }
    out
}

async fn brave(app: &App, key: &str, q: &str, n: usize) -> Result<Vec<Hit>, String> {
    let r = client(app)
        .get(format!("https://api.search.brave.com/res/v1/web/search?q={}&count={n}", enc(q)))
        .header("X-Subscription-Token", key)
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let st = r.status().as_u16();
    let v: Value = serde_json::from_slice(&r.bytes().await.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if st != 200 {
        return Err(format!("Brave {st}: {}", v["error"]["detail"].as_str().unwrap_or("")));
    }
    Ok(v["web"]["results"].as_array().into_iter().flatten().map(|x| Hit {
        title: strip_tags(x["title"].as_str().unwrap_or("")),
        url: x["url"].as_str().unwrap_or("").to_string(),
        snippet: strip_tags(x["description"].as_str().unwrap_or("")),
    }).collect())
}

async fn searxng(app: &App, base: &str, q: &str) -> Result<Vec<Hit>, String> {
    let r = client(app).get(format!("{}/search?q={}&format=json", base.trim_end_matches('/'), enc(q))).timeout(Duration::from_secs(20)).send().await.map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_slice(&r.bytes().await.map_err(|e| e.to_string())?).map_err(|e| LF!("SearXNG não devolveu JSON (ative format=json no settings.yml): {e}", "SearXNG did not return JSON (enable format=json in settings.yml): {e}"))?;
    Ok(v["results"].as_array().into_iter().flatten().map(|x| Hit {
        title: x["title"].as_str().unwrap_or("").to_string(),
        url: x["url"].as_str().unwrap_or("").to_string(),
        snippet: x["content"].as_str().unwrap_or("").to_string(),
    }).collect())
}

/// web_search: a lista de resultados (para o modelo) e os mesmos dados estruturados (para os cartões no chat).
pub async fn search(app: &App, args: &Value) -> Result<(String, Value), String> {
    let q = args.get("query").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if q.is_empty() {
        return Err(L!("Falta o que pesquisar (query).", "Missing what to search for (query).").into());
    }
    let n = args.get("count").and_then(Value::as_u64).unwrap_or(8).clamp(1, 15) as usize;
    let cfg = app.cfg().web_search.clone();
    let mut used = "duckduckgo";
    let mut errs = vec![];
    let mut hits = match cfg.provider.as_str() {
        "brave" if !cfg.key.is_empty() => { used = "brave"; brave(app, &cfg.key, &q, n).await.unwrap_or_else(|e| { errs.push(e); vec![] }) }
        "searxng" if !cfg.url.is_empty() => { used = "searxng"; searxng(app, &cfg.url, &q).await.unwrap_or_else(|e| { errs.push(e); vec![] }) }
        _ => vec![],
    };
    if hits.is_empty() {
        used = "duckduckgo";
        hits = ddg(app, &q).await.unwrap_or_else(|e| { errs.push(e); vec![] });
    }
    if hits.is_empty() {
        used = "bing";
        hits = bing(app, &q).await.unwrap_or_else(|e| { errs.push(e); vec![] });
    }
    // sem repetidos
    let mut seen = std::collections::HashSet::new();
    hits.retain(|h| seen.insert(h.url.trim_end_matches('/').to_string()));
    hits.truncate(n);
    if hits.is_empty() {
        return Err(if errs.is_empty() { LF!("Nada encontrado para \"{q}\".", "Nothing found for \"{q}\".") } else { LF!("A pesquisa falhou: {}", "The search failed: {}", errs.join("; ")) });
    }
    let text = hits.iter().enumerate().map(|(i, h)| format!("[{}] {}\n{}\n{}", i + 1, h.title, h.url, h.snippet)).collect::<Vec<_>>().join("\n\n");
    let text = format!("{}\n\n{}", text, L!("Para ler uma página, use web_fetch com a URL. Ao responder, cite as fontes como [título](url).", "To read a page, use web_fetch with the URL. When answering, cite sources as [title](url)."));
    let data = json!({ "query": q, "engine": used, "results": hits.iter().map(|h| json!({"title": h.title, "url": h.url, "snippet": h.snippet})).collect::<Vec<_>>() });
    Ok((text, data))
}

/// web_fetch: o texto da página, em pedaços (offset em caracteres).
pub async fn fetch(app: &App, args: &Value) -> Result<(String, Value), String> {
    let mut url = args.get("url").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if url.is_empty() {
        return Err(L!("Falta a URL.", "Missing the URL.").into());
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        url = format!("https://{url}");
    }
    let offset = args.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
    let max = args.get("max_chars").and_then(Value::as_u64).unwrap_or(12000).clamp(1000, 40000) as usize;
    let (title, text) = match cached(&url) {
        Some(t) => {
            let (ti, body) = t.split_once('\n').unwrap_or(("", &t));
            (ti.to_string(), body.to_string())
        }
        None => {
            let (st, ct, body) = get_text(app, &url, 30).await?;
            if st >= 400 {
                return Err(LF!("A página respondeu {st}. Se ela exige login ou JavaScript, use o navegador (browser_navigate).", "The page answered {st}. If it needs login or JavaScript, use the browser (browser_navigate)."));
            }
            let (ti, tx) = if ct.contains("html") || body.trim_start().starts_with('<') { html_text(&body) } else { (String::new(), body) };
            remember(&url, &format!("{ti}\n{tx}"));
            (ti, tx)
        }
    };
    let chars: Vec<char> = text.chars().collect();
    if chars.len() < 200 && offset == 0 {
        return Err(LF!("A página veio quase vazia ({} caracteres): ela provavelmente monta o conteúdo com JavaScript. Use o navegador (browser_navigate) para essa.", "The page came almost empty ({} characters): it probably builds the content with JavaScript. Use the browser (browser_navigate) for it.", chars.len()));
    }
    let end = (offset + max).min(chars.len());
    let part: String = chars[offset.min(chars.len())..end].iter().collect();
    let more = if end < chars.len() { LF!("\n\n[caracteres {offset}–{end} de {}; para continuar, web_fetch com offset={end}]", "\n\n[characters {offset}–{end} of {}; to continue, web_fetch with offset={end}]", chars.len()) } else { String::new() };
    let head = if title.is_empty() { format!("{url}\n\n") } else { format!("# {title}\n{url}\n\n") };
    Ok((format!("{head}{part}{more}"), json!({ "url": url, "title": title, "chars": chars.len() })))
}

#[cfg(test)]
mod t {
    #[test]
    fn html_vira_texto() {
        let h = r#"<html><head><title>Teste &amp; cia</title><style>x{}</style></head><body><nav>menu</nav>
            <main><h1>Título</h1><p>Primeiro&nbsp;parágrafo com <a href="x">link</a> e bastante texto para passar do mínimo de conteúdo.</p>
            <ul><li>um</li><li>dois</li></ul><pre><code>fn main() {
    println!("oi");
}</code></pre><script>alert(1)</script>
            <p>Mais texto aqui para que o main tenha conteúdo suficiente e seja escolhido como principal pelo extrator de texto da página. Repetindo para garantir que passe de seiscentos caracteres no total, o que é o limite para usar o main. Mais algumas palavras, e mais algumas, e mais outras ainda, só para completar o tamanho necessário do teste com sobra suficiente.</p></main><footer>rodapé</footer></body></html>"#;
        let (t, x) = super::html_text(h);
        assert_eq!(t, "Teste & cia");
        assert!(x.contains("# Título"), "{x}");
        assert!(x.contains("Primeiro parágrafo com link"), "{x}");
        assert!(x.contains("- um"), "{x}");
        assert!(x.contains("    println!(\"oi\");"), "{x}");
        assert!(!x.contains("menu") && !x.contains("alert") && !x.contains("rodapé"), "{x}");
    }
    #[test]
    fn le_resultados_do_ddg_e_do_bing() {
        let d = r#"<div class="result results_links results_links_deep web-result "><div class="links_main links_deep result__body">
<h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fggml-org%2Fllama.cpp&amp;rut=abc">ggml-org/<b>llama.cpp</b>: LLM inference</a></h2>
<div class="result__extras"><a class="result__url" href="x">github.com</a></div>
<a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">Inference of <b>LLaMA</b> in C/C++</a><div class="clear"></div></div></div>
<div class="result result--ad"><h2 class="result__title"><a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad=1">Anúncio</a></h2></div></div>"#;
        let h = super::parse_ddg(d);
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].url, "https://github.com/ggml-org/llama.cpp");
        assert_eq!(h[0].title, "ggml-org/llama.cpp: LLM inference");
        assert_eq!(h[0].snippet, "Inference of LLaMA in C/C++");
        let b = r#"<ol id="b_results"><li class="b_algo" data-id=""><div class="b_tpcn"></div><h2 class=""><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=1&amp;u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9h&amp;ntb=1">Exemplo <strong>A</strong></a></h2><div class="b_caption"><p class="b_lineclamp2">Trecho do <strong>exemplo</strong>.</p></div></li></ol>"#;
        let h = super::parse_bing(b);
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].url, "https://example.com/a");
        assert_eq!(h[0].title, "Exemplo A");
        assert_eq!(h[0].snippet, "Trecho do exemplo.");
    }
    #[test]
    fn codifica_e_entidades() {
        assert_eq!(super::enc("a b&c"), "a+b%26c");
        assert_eq!(super::dec("https%3A%2F%2Fx.com%2Fa%3Fb%3D1"), "https://x.com/a?b=1");
        assert_eq!(super::entities("&lt;a&gt; &#39;x&#x27; &foo;"), "<a> 'x' &foo;");
    }
}
