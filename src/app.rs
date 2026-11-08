//! Estado compartilhado, configuração e utilitários de caminho.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Duration, Instant};

use crate::browser::Browser;
use crate::llama::Llama;
use crate::mcp::Mcp;
use std::collections::HashMap;

pub const IS_WIN: bool = cfg!(windows);
pub const NIM_MAX_REQS: usize = 40;
pub const NIM_WINDOW: Duration = Duration::from_secs(60);

/// Estado compartilhado, configuração e utilitários de caminho.
#[derive(Debug, Clone)]
pub enum UiMsg {
    Show,
    Js(String),
    LlamaState(String),
    Quit,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub port: u16,
    pub llama_url: String,
    pub workspace: String,
    pub recent_workspaces: Vec<String>,
    pub extra_skills_dirs: Vec<String>,
    pub recent_dirs: Vec<String>,
    pub open_browser: bool,
    /// Usa a GPU para desenhar a janela. Desligado = não ocupa VRAM do modelo.
    pub window_gpu: bool,
    /// Fechar a janela mantém o programa na bandeja.
    pub close_to_tray: bool,
    /// Enxuga saídas longas de comandos e conectores antes de irem para o modelo.
    pub compact_output: bool,
    /// Passa comandos conhecidos (git, cargo, pytest...) pelo RTK quando instalado.
    pub use_rtk: bool,
    /// token do Hugging Face para modelos restritos
    pub hf_token: String,
    /// Configurações de personalização da interface
    pub ui_settings: Value,
    /// idioma da interface e do que o modelo recebe: "pt" ou "en" (vazio = ainda não escolhido)
    pub lang: String,
    /// formato antigo (v2.44): um provedor só; migra para api_providers ao abrir
    pub api_base: String,
    pub api_key: String,
    pub api_model: String,
    /// APIs externas compatíveis com OpenAI; cada função (auditor, exploradores...) escolhe uma.
    /// A chave nunca volta para a interface (só "tem chave") nem sai no pacote de compartilhar.
    pub api_providers: Vec<ApiProvider>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ApiProvider {
    pub id: String,
    pub name: String,
    pub base: String,
    pub key: String,
    pub model: String,
    
    // Adicionar estes dois campos:
    #[serde(default)]
    pub fallback_model: String,
    #[serde(default)]
    pub retries: Option<u32>,

    #[serde(default)]
    pub params: HashMap<String, serde_json::Value>,
}

impl Default for Config {
    fn default() -> Self {
        let home = home_dir();
        let docs = home.join("Documents");
        Config {
            port: 1240,
            llama_url: "http://127.0.0.1:1235".into(),
            workspace: if docs.is_dir() { docs } else { home }.to_string_lossy().into_owned(),
            recent_workspaces: vec![],
            extra_skills_dirs: vec![],
            recent_dirs: vec![],
            open_browser: true,
            window_gpu: false,
            close_to_tray: true,
            compact_output: true,
            use_rtk: true,
            hf_token: String::new(),
            api_base: String::new(),
            api_key: String::new(),
            api_model: String::new(),
            api_providers: vec![],
            ui_settings: json!({
                "theme": "dark",
                "colors": {
                    "background": "#1e1e1e",
                    "foreground": "#ffffff",
                    "accent": "#0078d4",
                    "primary": "#0078d4",
                    "secondary": "#6c757d",
                    "warning": "#ffc107",
                    "error": "#dc3545",
                    "success": "#28a745"
                },
                "fonts": {
                    "body": "Segoe UI, sans-serif",
                    "monospace": "Consolas, monospace",
                    "header": "Segoe UI, sans-serif"
                },
                "layout": "compact",
                "widgets": ["statusbar", "toolbar", "sidebar", "panels", "tabs"]
            }),
            lang: String::new(),
        }
    }
}

pub struct App {
    /// Pasta do executável (a pasta do llama).
    #[allow(dead_code)]
    pub app_dir: PathBuf,
    /// Pasta do llama (llama-server.exe, llama-gui.json).
    #[allow(dead_code)]
    pub llama_dir: PathBuf,
    /// Pasta de dados do studio (config.json, mcp.json, skills/).
    pub root: PathBuf,
    pub config: RwLock<Config>,
    pub http: reqwest::Client,
    /// cliente para a internet (atualizações), respeita proxy do sistema
    pub web: reqwest::Client,
    pub mcp: Mcp,
    pub browser: Browser,
    pub llama: Llama,
    /// Contador de requests NIM para rate limiting (40/min).
    pub nim_hits: OnceLock<Mutex<HashMap<String, Vec<std::time::Instant>>>>,

    ui: OnceLock<Box<dyn Fn(UiMsg) + Send + Sync>>,
    pub rt: OnceLock<tokio::runtime::Handle>,
    pub native_window: std::sync::atomic::AtomicBool,
}

impl App {
    pub fn load() -> Arc<App> {
        let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
        // pasta do programa (llama\llama-studio)
        let app_dir = std::env::var_os("STUDIO_APP_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| exe.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from(".")));
        // pasta do llama: onde está o llama-server (a própria pasta ou a de cima)
        let server_name = if IS_WIN { "llama-server.exe" } else { "llama-server" };
        let llama_dir = [Some(app_dir.clone()), app_dir.parent().map(Path::to_path_buf)]
            .into_iter()
            .flatten()
            .find(|d| d.join(server_name).is_file() || d.join("llama-gui.json").is_file())
            .unwrap_or_else(|| app_dir.clone());
        // dados do studio (config.json, mcp.json, skills\, webview\, navegador\)
        let root = std::env::var_os("STUDIO_DIR").map(PathBuf::from).unwrap_or_else(|| app_dir.join("dados"));
        migrate_from_node(&llama_dir.join("studio"), &root);
        let _ = std::fs::create_dir_all(root.join("skills"));

        let cfg_file = root.join("config.json");
        let mut config: Config = read_json(&cfg_file).unwrap_or_default();
        if !Path::new(&config.workspace).is_dir() {
            config.workspace = home_dir().to_string_lossy().into_owned();
        }
        // primeira vez: o idioma escolhido no instalador
        if config.lang.is_empty() {
            if let Some(l) = crate::i18n::from_installer(&app_dir) {
                config.lang = l;
            }
        }
        if !config.api_base.trim().is_empty() && config.api_providers.is_empty() {
            config.api_providers.push(ApiProvider { id: "p1".into(), name: String::new(), base: config.api_base.clone(), key: config.api_key.clone(), model: config.api_model.clone(), ..Default::default() });
        }
        config.api_base.clear();
        config.api_key.clear();
        config.api_model.clear();
        crate::i18n::set(&config.lang);
        if let Ok(u) = std::env::var("STUDIO_LLAMA_URL") {
            config.llama_url = u.trim_end_matches('/').to_string();
        }
        let mcp_file = root.join("mcp.json");
        if !mcp_file.exists() {
            let _ = std::fs::write(&mcp_file, "{\n  \"mcpServers\": {}\n}\n");
        }

        let http = reqwest::Client::builder()
            .no_proxy()
            .pool_idle_timeout(std::time::Duration::from_secs(30))
            .pool_max_idle_per_host(2)
            .build()
            .expect("cliente http");

        let app = Arc::new(App {
            llama: Llama::new(&llama_dir, &app_dir, &root),
            app_dir,
            llama_dir,
            browser: Browser::new(&root),
            root,
            config: RwLock::new(config),
            http,
            web: reqwest::Client::builder().pool_max_idle_per_host(1).build().expect("cliente web"),
            mcp: Mcp::default(),
            ui: OnceLock::new(),
            rt: OnceLock::new(),
            native_window: std::sync::atomic::AtomicBool::new(false),
            nim_hits: OnceLock::new(),
        });
        app.save_config();
        app
    }

    pub fn cfg(&self) -> Config {
        self.config.read().unwrap().clone()
    }

    /// Retorna o contador de requests NIM (usado + tempo restante).
    pub fn nim_status(&self) -> (u32, u32) {
        let mut m = self.nim_hits.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        let mut used: u32 = 0;
        let mut earliest_expiry: Option<Instant> = None;
        for (_, hits) in m.iter_mut() {
            // Remove hits fora da janela de 60s
            hits.retain(|t| now.saturating_duration_since(*t) < NIM_WINDOW);
            used += hits.len() as u32;
            for t in hits {
                let age = now.saturating_duration_since(*t);
                // Manter o tempo restante até expirar (menor = mais urgente)
                if earliest_expiry.is_none() || age > earliest_expiry.unwrap().saturating_duration_since(now) {
                    earliest_expiry = Some(*t);
                }
            }
        }
        let wait_secs = if used >= NIM_MAX_REQS as u32 {
            // Todos os slots estão ocupados; wait até o mais velho expirar
            earliest_expiry.map_or(NIM_WINDOW.as_secs() as u32, |e| {
                let age = now.saturating_duration_since(e).as_secs();
                NIM_WINDOW.as_secs().saturating_sub(age).max(1) as u32
            })
        } else {
            0
        };
        (used, wait_secs)
    }

    pub fn workspace(&self) -> PathBuf {
        PathBuf::from(&self.config.read().unwrap().workspace)
    }

    pub fn save_config(&self) {
        let c = self.config.read().unwrap();
        if let Ok(s) = serde_json::to_string_pretty(&*c) {
            let _ = std::fs::write(self.root.join("config.json"), s);
        }
    }

    pub fn set_ui(&self, f: Box<dyn Fn(UiMsg) + Send + Sync>) {
        let _ = self.ui.set(f);
    }

    pub fn ui(&self, m: UiMsg) {
        if let Some(f) = self.ui.get() {
            f(m);
        }
    }

    /// Inicia o llama-server a partir de qualquer thread.
    pub fn spawn_start_llama(self: &Arc<Self>) {
        if let Some(h) = self.rt.get() {
            let a = self.clone();
            h.spawn(async move {
                if let Err(e) = a.llama.start(&a) {
                    a.llama.push_log(e);
                }
            });
        }
    }

    /// Para o llama-server antes de sair (os MCPs morrem junto pelo job object).
    pub fn shutdown(&self) {
        self.llama.stop();
        for _ in 0..30 {
            if !self.llama.is_running() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }

    pub fn skills_dir(&self) -> PathBuf {
        self.root.join("skills")
    }

    pub fn mcp_file(&self) -> PathBuf {
        self.root.join("mcp.json")
    }
}

// ---------------------------------------------------------------- utilitários

/// Na primeira execução, traz a configuração da versão Node (pasta studio).
fn migrate_from_node(old: &Path, root: &Path) {
    if root.join("config.json").exists() || !old.join("config.json").is_file() {
        return;
    }
    let _ = std::fs::create_dir_all(root);
    for f in ["config.json", "mcp.json"] {
        let _ = std::fs::copy(old.join(f), root.join(f));
    }
    if old.join("skills").is_dir() {
        let _ = copy_dir(&old.join("skills"), &root.join("skills"));
    }
}

pub fn read_json<T: for<'de> Deserialize<'de>>(p: &Path) -> Option<T> {
    let s = std::fs::read_to_string(p).ok()?;
    serde_json::from_str(s.trim_start_matches('\u{feff}')).ok()
}

pub fn home_dir() -> PathBuf {
    std::env::var_os(if IS_WIN { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Resolve `.` e `..` sem tocar no disco.
pub fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => {
                // não sobe acima da raiz
                let is_root_only = out.components().all(|c| matches!(c, Component::Prefix(_) | Component::RootDir));
                if !is_root_only {
                    out.pop();
                }
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

pub fn resolve(base: &Path, p: &str) -> PathBuf {
    let p = p.trim().trim_matches('"');
    let pp = Path::new(if p.is_empty() { "." } else { p });
    normalize(&if pp.is_absolute() { pp.to_path_buf() } else { base.join(pp) })
}

fn key(p: &Path) -> String {
    let mut s = normalize(p).to_string_lossy().into_owned();
    if IS_WIN {
        s = s.replace('/', "\\").to_lowercase();
    }
    while s.len() > 1 && (s.ends_with('\\') || s.ends_with('/')) {
        s.pop();
    }
    if s == "/" {
        s.clear();
    }
    s
}

pub fn is_inside(base: &Path, target: &Path) -> bool {
    let b = key(base);
    let t = key(target);
    let sep = if IS_WIN { '\\' } else { '/' };
    t == b || t.starts_with(&format!("{b}{sep}"))
}

pub fn rel_to(base: &Path, full: &Path) -> String {
    if is_inside(base, full) {
        if let Ok(r) = normalize(full).strip_prefix(normalize(base)) {
            let s = r.to_string_lossy().replace('\\', "/");
            return if s.is_empty() { ".".into() } else { s };
        }
        // diferença de maiúsculas no Windows
        let b = normalize(base).to_string_lossy().len();
        let f = normalize(full).to_string_lossy().into_owned();
        return f.get(b..).unwrap_or("").trim_start_matches(['\\', '/']).replace('\\', "/");
    }
    full.to_string_lossy().into_owned()
}

pub fn file_name(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| p.to_string_lossy().into_owned())
}

pub fn fmt_size(n: u64) -> String {
    let f = n as f64;
    if n < 1024 {
        format!("{n} B")
    } else if n < 1024 * 1024 {
        format!("{:.1} KB", f / 1024.0)
    } else if n < 1024 * 1024 * 1024 {
        format!("{:.1} MB", f / 1048576.0)
    } else {
        format!("{:.2} GB", f / 1073741824.0)
    }
}

pub fn looks_binary(buf: &[u8]) -> bool {
    buf.iter().take(8000).any(|&b| b == 0)
}

pub fn truncate(text: String, max: usize) -> String {
    if text.len() <= max {
        return text;
    }
    let mut cut = max;
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    let rest = text.len() - cut;
    format!("{}\n\n[... resultado cortado: {rest} bytes omitidos]", &text[..cut])
}

pub fn slug(s: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in s.chars() {
        let c = fold_accent(ch).to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    let out = out.trim_end_matches('-');
    let out: String = out.chars().take(60).collect();
    if out.is_empty() { "skill".into() } else { out }
}

fn fold_accent(c: char) -> char {
    match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' | 'Á' | 'À' | 'Â' | 'Ã' | 'Ä' => 'a',
        'é' | 'è' | 'ê' | 'ë' | 'É' | 'È' | 'Ê' | 'Ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' | 'Í' | 'Ì' | 'Î' | 'Ï' => 'i',
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' | 'Ó' | 'Ò' | 'Ô' | 'Õ' | 'Ö' => 'o',
        'ú' | 'ù' | 'û' | 'ü' | 'Ú' | 'Ù' | 'Û' | 'Ü' => 'u',
        'ç' | 'Ç' => 'c',
        'ñ' | 'Ñ' => 'n',
        other => other,
    }
}

/// Abre uma pasta/arquivo no gerenciador de arquivos.
pub fn reveal(target: &Path, select: bool) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("explorer.exe");
        c.creation_flags(crate::DETACHED_FLAGS);
        if select {
            c.raw_arg(format!("/select,\"{}\"", target.display()));
        } else {
            c.arg(target);
        }
        let _ = c.spawn();
    }
    #[cfg(not(windows))]
    {
        let t = if select { target.parent().unwrap_or(target) } else { target };
        let _ = std::process::Command::new("xdg-open").arg(t).spawn();
    }
}

pub fn open_url(url: &str) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // url.dll abre no navegador padrão sem passar pelo cmd (que quebra URLs com &)
        let _ = std::process::Command::new("rundll32.exe")
            .arg("url.dll,FileProtocolHandler")
            .arg(url)
            .creation_flags(crate::DETACHED_FLAGS)
            .spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}

/// Copia uma pasta recursivamente.
pub fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for e in walkdir::WalkDir::new(src).min_depth(1) {
        let e = e.map_err(std::io::Error::other)?;
        let rel = e.path().strip_prefix(src).unwrap();
        let to = dst.join(rel);
        if e.file_type().is_dir() {
            std::fs::create_dir_all(&to)?;
        } else if e.file_type().is_file() {
            if let Some(p) = to.parent() {
                std::fs::create_dir_all(p)?;
            }
            std::fs::copy(e.path(), &to)?;
        }
    }
    Ok(())
}

pub fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}
