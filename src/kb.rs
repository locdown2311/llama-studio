//! Base de conhecimento dos projetos: os documentos das pastas e arquivos escolhidos viram trechos
//! pesquisáveis (BM25 com radicais curtos e sem acentos), sem modelo de embeddings: roda em qualquer PC,
//! em milissegundos, e funciona com modelo local ou API. Lê texto, código, Markdown, HTML, .docx e .pdf.
//!
//! O índice fica em dados/conhecimento/<projeto>.json (texto já extraído, para não reler PDFs) e em memória.
//! A cada busca, as fontes são varridas só pela data e tamanho: o que mudou é relido, o que sumiu sai.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, UNIX_EPOCH};

use crate::app::App;

const SKIP: &[&str] = &[".git", "node_modules", "target", "dist", "build", "__pycache__", ".venv", "venv", ".idea", ".vs", ".vscode", "obj", ".next", ".cache", "coverage", "vendor", ".gradle", "$RECYCLE.BIN", "System Volume Information"];
const TEXT_EXT: &[&str] = &[
    "md", "markdown", "txt", "text", "rst", "adoc", "org", "tex", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "ini", "cfg", "conf", "xml", "html", "htm",
    "rs", "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "c", "h", "cpp", "hpp", "cc", "cs", "java", "kt", "go", "php", "rb", "lua", "sh", "ps1", "bat", "sql", "vue", "svelte", "css", "scss", "swift", "dart", "r", "m", "pl", "asm", "srt", "vtt", "log",
];
const MAX_FILES: usize = 6000;
const MAX_TEXT: u64 = 3 * 1024 * 1024;
const MAX_DOC: u64 = 40 * 1024 * 1024;
const CHUNK: usize = 1100;
const OVERLAP: usize = 160;

#[derive(Serialize, Deserialize, Clone, Default)]
struct Chunk {
    /// linha onde o trecho começa (1 = primeira; 0 para PDF/docx, que não têm linhas)
    l: u32,
    t: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct FileEntry {
    mtime: u64,
    size: u64,
    #[serde(default)]
    err: String,
    chunks: Vec<Chunk>,
}

#[derive(Serialize, Deserialize, Default)]
struct Index {
    files: BTreeMap<String, FileEntry>,
    #[serde(skip)]
    terms: Vec<(String, u32, HashMap<String, u16>)>, // (arquivo, nº do trecho, termos) montado na hora da busca
    #[serde(skip)]
    dirty_terms: bool,
}

fn store() -> &'static Mutex<HashMap<String, Index>> {
    static S: OnceLock<Mutex<HashMap<String, Index>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

fn safe_id(id: &str) -> Option<String> {
    let ok = !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    ok.then(|| id.to_string())
}

fn index_file(app: &App, id: &str) -> PathBuf {
    app.root.join("conhecimento").join(format!("{id}.json"))
}

/* ---------------------------------------------------------------- extração de texto */

fn ext_of(p: &Path) -> String {
    p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase()
}

const MEDIA_EXT: &[&str] = &["mp3", "wav", "m4a", "ogg", "opus", "flac", "aac", "wma", "mp4", "mkv", "webm", "mov", "avi", "m4v"];
const MAX_MEDIA: u64 = 4 * 1024 * 1024 * 1024;

fn is_media(p: &Path) -> bool {
    MEDIA_EXT.contains(&ext_of(p).as_str())
}

/// Documento que a base lê direto (texto, código, PDF, Word): usado também nos repositórios do GitHub.
pub fn wanted_doc(p: &Path) -> bool {
    let e = ext_of(p);
    e == "pdf" || e == "docx" || TEXT_EXT.contains(&e.as_str())
}

fn wanted(p: &Path) -> bool {
    wanted_doc(p) || is_media(p)
}

pub fn skip_dir(n: &str) -> bool {
    SKIP.iter().any(|s| n.eq_ignore_ascii_case(s)) || n.starts_with('.')
}

/* ---------------------------------------------------------------- áudio e vídeo: transcrição com o Whisper
   A transcrição roda numa fila, uma de cada vez, numa thread própria (pode levar minutos). O texto fica em
   dados/conhecimento/<projeto>/transcricoes/<hash>.txt; a próxima busca ou "Indexar agora" já o encontra. */

const PENDING: &str = "\u{23f3}";

struct MediaJob {
    src: PathBuf,
    out: PathBuf,
}

struct MediaQueue {
    jobs: std::collections::VecDeque<MediaJob>,
    running: bool,
    current: String,
}

fn media_q() -> &'static Mutex<MediaQueue> {
    static Q: OnceLock<Mutex<MediaQueue>> = OnceLock::new();
    Q.get_or_init(|| Mutex::new(MediaQueue { jobs: Default::default(), running: false, current: String::new() }))
}

fn fnv(s: &str) -> String {
    let mut h: u64 = 1469598103934665603;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    format!("{h:016x}")
}

fn media_text(app: &App, id: &str, p: &Path, mt: u64, size: u64) -> Result<String, String> {
    let out = app.root.join("conhecimento").join(id).join("transcricoes").join(format!("{}.txt", fnv(&format!("{}|{mt}|{size}", p.display()))));
    if let Ok(t) = std::fs::read_to_string(&out) {
        return Ok(t);
    }
    if let Ok(e) = std::fs::read_to_string(out.with_extension("err")) {
        return Err(e);
    }
    let mut q = media_q().lock().unwrap_or_else(|e| e.into_inner());
    let queued = q.jobs.iter().any(|j| j.out == out) || q.current == p.to_string_lossy();
    if !queued {
        q.jobs.push_back(MediaJob { src: p.to_path_buf(), out });
    }
    if !q.running {
        q.running = true;
        let root = app.root.clone();
        std::thread::spawn(move || media_worker(root));
    }
    Err(PENDING.into())
}

fn media_worker(root: PathBuf) {
    loop {
        let job = {
            let mut q = media_q().lock().unwrap_or_else(|e| e.into_inner());
            match q.jobs.pop_front() {
                Some(j) => {
                    q.current = j.src.to_string_lossy().to_string();
                    j
                }
                None => {
                    q.running = false;
                    q.current.clear();
                    return;
                }
            }
        };
        let _ = std::fs::create_dir_all(job.out.parent().unwrap_or(&root));
        match transcribe_file(&root, &job.src) {
            Ok(t) => {
                let _ = std::fs::write(&job.out, t);
            }
            Err(e) => {
                let _ = std::fs::write(job.out.with_extension("err"), e);
            }
        }
    }
}

fn hide_window(_c: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        _c.creation_flags(crate::CREATE_NO_WINDOW);
    }
}

fn transcribe_file(root: &Path, src: &Path) -> Result<String, String> {
    let wd = crate::dictate::whisper_dir(root);
    let bin = crate::dictate::whisper_exe(&wd).ok_or(L!("Para transcrever áudio e vídeo, instale o Whisper: toque uma vez no microfone da caixa de mensagem.", "To transcribe audio and video, install Whisper: tap the microphone in the message box once."))?;
    let model = crate::dictate::whisper_model(&wd, "").ok_or(L!("Falta o modelo do Whisper: toque uma vez no microfone da caixa de mensagem.", "The Whisper model is missing: tap the microphone in the message box once."))?;
    let ff = crate::bins::which("ffmpeg").ok_or(L!("Para transcrever, instale o FFmpeg em Utilitários.", "To transcribe, install FFmpeg in Utilities."))?;
    let tmp = std::env::temp_dir().join(format!("llama-studio-kb-{}-{}.wav", std::process::id(), crate::app::now_ms()));
    let mut c = std::process::Command::new(ff);
    c.args(["-v", "error", "-y", "-i"]).arg(src).args(["-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"]).arg(&tmp).stdin(std::process::Stdio::null());
    hide_window(&mut c);
    let o = c.output().map_err(|e| e.to_string())?;
    if !o.status.success() || !tmp.is_file() {
        let _ = std::fs::remove_file(&tmp);
        return Err(L!("Não consegui extrair o áudio (o arquivo tem som?).", "Could not extract the audio (does the file have sound?).").into());
    }
    let threads = std::thread::available_parallelism().map(|n| (n.get() / 2).clamp(2, 8)).unwrap_or(4).to_string();
    let mut c = std::process::Command::new(&bin);
    c.arg("-m").arg(wd.join(format!("ggml-{model}.bin"))).arg("-f").arg(&tmp).args(["-l", "auto", "-np", "-t", &threads]).current_dir(&wd).stdin(std::process::Stdio::null());
    hide_window(&mut c);
    let o = c.output();
    let _ = std::fs::remove_file(&tmp);
    let o = o.map_err(|e| e.to_string())?;
    if !o.status.success() {
        return Err(LF!("O Whisper falhou: {}", "Whisper failed: {}", String::from_utf8_lossy(&o.stderr).lines().last().unwrap_or("").trim()));
    }
    // "[00:01:02.000 --> 00:01:05.000]  texto" -> "[01:02] texto"
    let mut lines = vec![];
    for l in String::from_utf8_lossy(&o.stdout).lines() {
        let l = l.trim();
        let (ts, text) = match l.strip_prefix('[').and_then(|r| r.split_once(']')) {
            Some((ts, t)) => (ts.split(" --> ").next().unwrap_or(""), t.trim()),
            None => ("", l),
        };
        if text.is_empty() || text.starts_with('[') || text.starts_with('(') {
            continue;
        }
        let p: Vec<&str> = ts.split([':', '.']).collect();
        let stamp = match p.as_slice() {
            [h, m, s, _] if *h != "00" => format!("[{h}:{m}:{s}] "),
            [_, m, s, _] => format!("[{m}:{s}] "),
            _ => String::new(),
        };
        lines.push(format!("{stamp}{text}"));
    }
    if lines.is_empty() {
        return Err(L!("O Whisper não achou fala nesse arquivo.", "Whisper found no speech in this file.").into());
    }
    let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    Ok(format!("{}

{}", LF!("Transcrição de {name}", "Transcript of {name}"), lines.join("\n")))
}

fn media_status() -> Value {
    let q = media_q().lock().unwrap_or_else(|e| e.into_inner());
    json!({ "queued": q.jobs.len(), "current": Path::new(&q.current).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default() })
}

fn strip_tags(s: &str) -> String {
    // HTML: tira scripts, estilos e marcas; quebra linha nos blocos
    let mut out = String::with_capacity(s.len() / 2);
    let lower = s.to_ascii_lowercase(); // mesmo tamanho em bytes que s (os índices valem nos dois)
    let mut i = 0;
    let b = s.as_bytes();
    'outer: while i < b.len() {
        if b[i] == b'<' {
            for tag in ["script", "style"] {
                if lower[i..].starts_with(&format!("<{tag}")) {
                    if let Some(end) = lower[i..].find(&format!("</{tag}>")) {
                        i += end + tag.len() + 3;
                        continue 'outer;
                    }
                }
            }
            let close = s[i..].find('>').map(|x| i + x + 1).unwrap_or(b.len());
            let t = &lower[i..close.min(lower.len())];
            if t.starts_with("<br") || t.starts_with("</p") || t.starts_with("</div") || t.starts_with("</li") || t.starts_with("</h") || t.starts_with("</tr") {
                out.push('\n');
            }
            i = close;
        } else {
            let next = s[i..].find('<').map(|x| i + x).unwrap_or(b.len());
            out.push_str(&s[i..next]);
            i = next;
        }
    }
    out.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'")
}

fn docx_text(p: &Path) -> Result<String, String> {
    let f = std::fs::File::open(p).map_err(|e| e.to_string())?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    let mut x = String::new();
    {
        use std::io::Read;
        let mut e = z.by_name("word/document.xml").map_err(|_| "docx sem word/document.xml".to_string())?;
        if e.size() > 64 * 1024 * 1024 {
            return Err("docx grande demais".into());
        }
        e.read_to_string(&mut x).map_err(|e| e.to_string())?;
    }
    let x = x.replace("</w:p>", "\n").replace("<w:tab/>", "\t").replace("<w:br/>", "\n");
    Ok(strip_tags(&x))
}

fn pdf_text(p: &Path) -> Result<String, String> {
    let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
    // a biblioteca entra em pânico com alguns PDFs: o pânico vira erro e o arquivo fica de fora
    let r = std::panic::catch_unwind(move || pdf_extract::extract_text_from_mem(&bytes));
    match r {
        Ok(Ok(t)) => Ok(t),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("PDF ilegível".into()),
    }
}

fn extract(p: &Path) -> Result<String, String> {
    match ext_of(p).as_str() {
        "pdf" => pdf_text(p),
        "docx" => docx_text(p),
        e => {
            let b = std::fs::read(p).map_err(|e| e.to_string())?;
            if crate::app::looks_binary(&b[..b.len().min(8192)]) {
                return Err("binário".into());
            }
            let s = String::from_utf8_lossy(&b).to_string();
            Ok(if e == "html" || e == "htm" || e == "xml" { strip_tags(&s) } else { s })
        }
    }
}

fn chunks_of(text: &str, lines: bool) -> Vec<Chunk> {
    let text = text.replace("\r\n", "\n").replace('\u{0}', "");
    let mut out = vec![];
    let mut cur = String::new();
    let mut start = 1u32;
    let mut line = 1u32;
    for para in text.split_inclusive('\n') {
        if cur.len() + para.len() > CHUNK && !cur.trim().is_empty() {
            out.push(Chunk { l: if lines { start } else { 0 }, t: cur.trim().to_string() });
            // sobreposição: o fim do trecho anterior abre o próximo (uma frase cortada aparece inteira em um deles)
            let mut cut = cur.len().saturating_sub(OVERLAP);
            while !cur.is_char_boundary(cut) {
                cut += 1;
            }
            let tail = cur[cut..].to_string();
            start = line.saturating_sub(tail.matches('\n').count() as u32);
            cur = tail;
        }
        // parágrafo maior que o trecho (PDF sem quebras): corta por tamanho
        if para.len() > CHUNK * 2 {
            let mut rest = para;
            while rest.len() > CHUNK {
                let mut cut = CHUNK;
                while !rest.is_char_boundary(cut) {
                    cut += 1;
                }
                let cut = rest[..cut].rfind(' ').filter(|&x| x > CHUNK / 2).unwrap_or(cut);
                cur.push_str(&rest[..cut]);
                out.push(Chunk { l: if lines { start } else { 0 }, t: cur.trim().to_string() });
                cur.clear();
                rest = &rest[cut..];
            }
            cur.push_str(rest);
        } else {
            cur.push_str(para);
        }
        line += para.matches('\n').count() as u32;
    }
    if !cur.trim().is_empty() {
        out.push(Chunk { l: if lines { start } else { 0 }, t: cur.trim().to_string() });
    }
    out
}

/* ---------------------------------------------------------------- termos */

fn fold(c: char) -> Option<char> {
    let c = c.to_lowercase().next().unwrap_or(c);
    Some(match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' => 'i',
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
        'ú' | 'ù' | 'û' | 'ü' => 'u',
        'ç' => 'c',
        'ñ' => 'n',
        c if c.is_alphanumeric() => c,
        _ => return None,
    })
}

const STOP: &[&str] = &[
    "de", "da", "do", "das", "dos", "e", "o", "a", "os", "as", "um", "uma", "em", "no", "na", "nos", "nas", "por", "para", "com", "que", "se", "ao", "aos", "ou", "como", "mais", "mas", "sao", "foi", "ser", "ter", "the", "of", "and", "to", "in", "is", "it", "for", "on", "with", "as", "by", "an", "be", "this", "that", "are", "or", "at", "from",
];

/// Termos do texto: sem acento, minúsculos e com radical curto (7 letras), para "configuração" achar "configurar".
fn terms(s: &str) -> Vec<String> {
    let mut out = vec![];
    let mut w = String::new();
    let flush = |w: &mut String, out: &mut Vec<String>| {
        if w.chars().count() >= 2 && !STOP.contains(&w.as_str()) {
            out.push(w.chars().take(7).collect());
        }
        w.clear();
    };
    for c in s.chars() {
        match fold(c) {
            Some(c) => w.push(c),
            None => flush(&mut w, &mut out),
        }
    }
    flush(&mut w, &mut out);
    out
}

/* ---------------------------------------------------------------- atualização */

fn mtime(m: &std::fs::Metadata) -> u64 {
    m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
}

/// Lista os arquivos das fontes (pastas e arquivos), com data e tamanho.
fn scan(sources: &[String]) -> (Vec<(PathBuf, u64, u64)>, Vec<String>) {
    let mut out = vec![];
    let mut missing = vec![];
    for s in sources {
        let p = PathBuf::from(s);
        let Ok(md) = std::fs::metadata(&p) else {
            missing.push(s.clone());
            continue;
        };
        if md.is_file() {
            if wanted(&p) {
                out.push((p, mtime(&md), md.len()));
            }
            continue;
        }
        let walker = walkdir::WalkDir::new(&p).max_depth(12).into_iter().filter_entry(|e| {
            let n = e.file_name().to_string_lossy();
            !(e.file_type().is_dir() && e.depth() > 0 && skip_dir(&n))
        });
        for e in walker.flatten() {
            if out.len() >= MAX_FILES {
                break;
            }
            if !e.file_type().is_file() || !wanted(e.path()) {
                continue;
            }
            if let Ok(md) = e.metadata() {
                out.push((e.path().to_path_buf(), mtime(&md), md.len()));
            }
        }
    }
    (out, missing)
}

fn load(app: &App, id: &str) -> Index {
    std::fs::read(index_file(app, id)).ok().and_then(|b| serde_json::from_slice::<Index>(&b).ok()).map(|mut i| {
        i.dirty_terms = true;
        i
    }).unwrap_or_default()
}

/// Atualiza o índice (relê o que mudou) e devolve um resumo.
fn refresh(app: &App, id: &str, sources: &[String], idx: &mut Index) -> Value {
    let t0 = Instant::now();
    let (files, missing) = scan(sources);
    let mut changed = 0usize;
    let mut keep: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (p, mt, size) in &files {
        let key = p.to_string_lossy().to_string();
        keep.insert(key.clone());
        // transcrição na fila: confere de novo a cada passada (ela termina sozinha)
        if idx.files.get(&key).is_some_and(|f| f.mtime == *mt && f.size == *size && f.err != PENDING) {
            continue;
        }
        let limit = if is_media(p) { MAX_MEDIA } else if matches!(ext_of(p).as_str(), "pdf" | "docx") { MAX_DOC } else { MAX_TEXT };
        let entry = if is_media(p) && *size <= limit {
            match media_text(app, id, p, *mt, *size) {
                Ok(t) => FileEntry { mtime: *mt, size: *size, err: String::new(), chunks: chunks_of(&t, false) },
                Err(e) => {
                    // ainda na fila: não conta como mudança (não regrava o índice a cada busca)
                    let same = idx.files.get(&key).is_some_and(|f| f.err == e);
                    idx.files.insert(key, FileEntry { mtime: *mt, size: *size, err: e, chunks: vec![] });
                    if !same {
                        changed += 1;
                    }
                    continue;
                }
            }
        } else if *size > limit {
            FileEntry { mtime: *mt, size: *size, err: "grande demais".into(), chunks: vec![] }
        } else {
            match extract(p) {
                Ok(t) => FileEntry { mtime: *mt, size: *size, err: String::new(), chunks: chunks_of(&t, !matches!(ext_of(p).as_str(), "pdf" | "docx")) },
                Err(e) => FileEntry { mtime: *mt, size: *size, err: e, chunks: vec![] },
            }
        };
        idx.files.insert(key, entry);
        changed += 1;
    }
    let before = idx.files.len();
    idx.files.retain(|k, _| keep.contains(k));
    let removed = before - idx.files.len();
    if changed > 0 || removed > 0 {
        idx.dirty_terms = true;
        let f = index_file(app, id);
        let _ = std::fs::create_dir_all(f.parent().unwrap());
        if let Ok(b) = serde_json::to_vec(&*idx) {
            let _ = std::fs::write(f, b);
        }
    }
    let chunks: usize = idx.files.values().map(|f| f.chunks.len()).sum();
    let errors: Vec<Value> = idx.files.iter().filter(|(_, f)| !f.err.is_empty() && f.err != PENDING).take(20).map(|(k, f)| json!({"path": k, "error": f.err})).collect();
    let pending = idx.files.values().filter(|f| f.err == PENDING).count();
    json!({
        "files": idx.files.values().filter(|f| f.err.is_empty()).count(),
        "transcribing": pending,
        "media": media_status(),
        "chunks": chunks,
        "chars": idx.files.values().flat_map(|f| f.chunks.iter()).map(|c| c.t.len()).sum::<usize>(),
        "changed": changed,
        "removed": removed,
        "missing": missing,
        "errors": errors,
        "capped": files.len() >= MAX_FILES,
        "ms": t0.elapsed().as_millis() as u64,
    })
}

fn build_terms(idx: &mut Index) {
    if !idx.dirty_terms {
        return;
    }
    idx.terms.clear();
    for (path, f) in &idx.files {
        let name = Path::new(path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        for (i, c) in f.chunks.iter().enumerate() {
            let mut m: HashMap<String, u16> = HashMap::new();
            // o nome do arquivo conta como parte de cada trecho dele
            for t in terms(&name).into_iter().chain(terms(&c.t)) {
                *m.entry(t).or_default() += 1;
            }
            idx.terms.push((path.clone(), i as u32, m));
        }
    }
    idx.dirty_terms = false;
}

/* ---------------------------------------------------------------- API */

fn with_index<T>(app: &App, id: &str, f: impl FnOnce(&mut Index) -> T) -> T {
    let mut all = store().lock().unwrap_or_else(|e| e.into_inner());
    if !all.contains_key(id) {
        let i = load(app, id);
        all.insert(id.to_string(), i);
    }
    f(all.get_mut(id).unwrap())
}

fn sources_of(v: &Value) -> Vec<String> {
    v.get("sources").and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).take(50).collect()).unwrap_or_default()
}

/// Links viram pastas baixadas (kbfontes); devolve as fontes locais e o resumo de cada link.
async fn resolve_sources(app: &App, id: &str, sources: Vec<String>, force: bool) -> (Vec<String>, Vec<Value>) {
    let mut local = vec![];
    let mut web = vec![];
    for s in sources {
        if crate::kbfontes::is_url(&s) {
            let m = crate::kbfontes::materialize(app, id, &s, force).await;
            local.push(crate::kbfontes::dir_for(app, id, &s).to_string_lossy().to_string());
            web.push(json!({ "url": s, "kind": m["kind"], "title": m["title"], "files": m["files"], "error": m["error"], "fetched": m["fetched"] }));
        } else {
            local.push(s);
        }
    }
    (local, web)
}

pub async fn status(app: std::sync::Arc<App>, v: Value) -> Result<Value, String> {
    let id = safe_id(v.get("id").and_then(Value::as_str).unwrap_or("")).ok_or("id inválido")?;
    let force = v.get("force").and_then(Value::as_bool).unwrap_or(false);
    let (sources, web) = resolve_sources(&app, &id, sources_of(&v), force).await;
    let mut r = tokio::task::spawn_blocking(move || with_index(&app, &id, |idx| refresh(&app, &id, &sources, idx))).await.map_err(|e| e.to_string())?;
    r["web"] = json!(web);
    Ok(r)
}

pub async fn clear(app: std::sync::Arc<App>, v: Value) -> Result<Value, String> {
    let id = safe_id(v.get("id").and_then(Value::as_str).unwrap_or("")).ok_or("id inválido")?;
    store().lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    let _ = std::fs::remove_file(index_file(&app, &id));
    let _ = std::fs::remove_dir_all(app.root.join("conhecimento").join(&id));
    Ok(json!({"ok": true}))
}

pub async fn search(app: std::sync::Arc<App>, v: Value) -> Result<Value, String> {
    let id = safe_id(v.get("id").and_then(Value::as_str).unwrap_or("")).ok_or("id inválido")?;
    let query = v.get("query").and_then(Value::as_str).unwrap_or("").to_string();
    let k = v.get("k").and_then(Value::as_u64).unwrap_or(6).clamp(1, 15) as usize;
    let only = v.get("path").and_then(Value::as_str).unwrap_or("").to_lowercase();
    let (sources, _) = resolve_sources(&app, &id, sources_of(&v), false).await;
    tokio::task::spawn_blocking(move || {
        with_index(&app, &id, |idx| {
            let stats = refresh(&app, &id, &sources, idx);
            build_terms(idx);
            let q: Vec<String> = {
                let mut t = terms(&query);
                t.dedup();
                t
            };
            if q.is_empty() {
                return json!({"hits": [], "stats": stats});
            }
            let n = idx.terms.len().max(1) as f64;
            let avg = idx.terms.iter().map(|(_, _, m)| m.values().map(|&x| x as f64).sum::<f64>()).sum::<f64>() / n;
            let df: HashMap<&String, f64> = q.iter().map(|t| (t, idx.terms.iter().filter(|(_, _, m)| m.contains_key(t)).count() as f64)).collect();
            let phrase = query.trim().to_lowercase();
            let mut scored: Vec<(f64, usize)> = idx
                .terms
                .iter()
                .enumerate()
                .filter(|(_, (p, _, _))| only.is_empty() || p.to_lowercase().contains(&only))
                .filter_map(|(i, (_, _, m))| {
                    let len: f64 = m.values().map(|&x| x as f64).sum();
                    let mut s = 0.0;
                    let mut hit = 0;
                    for t in &q {
                        let tf = *m.get(t).unwrap_or(&0) as f64;
                        if tf == 0.0 {
                            continue;
                        }
                        hit += 1;
                        let d = df[t];
                        let idf = ((n - d + 0.5) / (d + 0.5) + 1.0).ln();
                        s += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * len / avg.max(1.0)));
                    }
                    (s > 0.0).then_some((s * (0.6 + 0.4 * hit as f64 / q.len() as f64), i))
                })
                .collect();
            // a frase inteira aparecendo no trecho vale mais
            if phrase.len() >= 6 && phrase.contains(' ') {
                for (s, i) in scored.iter_mut() {
                    let (p, ci, _) = &idx.terms[*i];
                    if idx.files[p].chunks[*ci as usize].t.to_lowercase().contains(&phrase) {
                        *s *= 1.5;
                    }
                }
            }
            scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
            // no máximo 3 trechos do mesmo arquivo, para a resposta não ficar presa num documento só
            let mut per: HashMap<&String, usize> = HashMap::new();
            let mut hits = vec![];
            for (s, i) in scored {
                let (p, ci, _) = &idx.terms[i];
                let c = per.entry(p).or_default();
                if *c >= 3 {
                    continue;
                }
                *c += 1;
                let ch = &idx.files[p].chunks[*ci as usize];
                hits.push(json!({"path": p, "url": crate::kbfontes::url_of(&app, &id, p), "line": ch.l, "part": ci + 1, "of": idx.files[p].chunks.len(), "score": (s * 100.0).round() / 100.0, "text": ch.t}));
                if hits.len() >= k {
                    break;
                }
            }
            json!({"hits": hits, "stats": stats})
        })
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn termos_sem_acento_e_com_radical() {
        assert_eq!(terms("Configuração das Configurações"), vec!["configu", "configu"]);
        assert_eq!(terms("o PDF é ótimo"), vec!["pdf", "otimo"]);
    }

    #[test]
    fn trechos_com_linhas_e_sobreposicao() {
        let t = (1..=200).map(|i| format!("linha {i} com algum texto para encher o trecho")).collect::<Vec<_>>().join("\n");
        let c = chunks_of(&t, true);
        assert!(c.len() > 3);
        assert_eq!(c[0].l, 1);
        assert!(c[1].l > 1);
        assert!(c.iter().all(|x| x.t.len() <= CHUNK + OVERLAP + 100));
    }

    #[test]
    fn html_sem_marcas() {
        assert_eq!(strip_tags("<p>Olá <b>mundo</b></p><script>x()</script>fim").trim(), "Olá mundo\nfim");
    }
}
