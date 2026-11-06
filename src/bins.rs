//! Ferramentas de linha de comando baixadas pelo studio (uv, Bun, fd, ripgrep, RTK).
//! Ficam em dados\bin, que entra na frente do PATH dos comandos e dos conectores.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::app::App;

pub struct Bin {
    pub id: &'static str,
    pub name: &'static str,
    pub desc: &'static str,
    pub repo: &'static str,
    pub site: &'static str,
    /// nome do arquivo da release para Windows x64
    asset: &'static str,
    /// executáveis tirados do zip
    pub exes: &'static [&'static str],
    /// cópias com outro nome (bun -> bunx)
    copies: &'static [(&'static str, &'static str)],
    pub tag: &'static str,
    /// outros arquivos que fazem parte da instalação (DLLs)
    files: &'static [&'static str],
}

pub const CATALOG: &[Bin] = &[
    Bin {
        id: "7zip",
        name: "7-Zip",
        desc: "Extrai e cria arquivos 7z, zip, rar, tar, gz, iso, cab, msi e instaladores. Útil para abrir instaladores e pacotes antes de analisar.",
        repo: "ip7z/7zip",
        site: "https://www.7-zip.org/",
        asset: r"^7zr\.exe$",
        exes: &["7z", "7zr", "7za"],
        copies: &[],
        tag: "arquivos",
        files: &["7z.dll"],
    },
    Bin {
        id: "rtk",
        name: "RTK",
        desc: "Enxuga a saída de comandos (git, cargo, pytest, docker...) antes de ela chegar ao modelo. Economiza boa parte do contexto.",
        repo: "rtk-ai/rtk",
        site: "https://www.rtk-ai.app/",
        asset: r"^rtk-x86_64-pc-windows-msvc\.zip$",
        exes: &["rtk"],
        copies: &[],
        tag: "contexto",
        files: &[],
    },
    Bin {
        id: "ripgrep",
        name: "ripgrep",
        desc: "Busca de texto muito rápida que respeita o .gitignore. A busca por conteúdo do studio passa a usá-lo.",
        repo: "BurntSushi/ripgrep",
        site: "",
        asset: r"^ripgrep-[\d.]+-x86_64-pc-windows-msvc\.zip$",
        exes: &["rg"],
        copies: &[],
        tag: "busca",
        files: &[],
    },
    Bin {
        id: "fd",
        name: "fd",
        desc: "Localiza arquivos pelo nome, mais rápido que o find e ignorando pastas de build.",
        repo: "sharkdp/fd",
        site: "",
        asset: r"^fd-v[\d.]+-x86_64-pc-windows-msvc\.zip$",
        exes: &["fd"],
        copies: &[],
        tag: "busca",
        files: &[],
    },
    Bin {
        id: "uv",
        name: "uv",
        desc: "Gerenciador de Python. Traz o uvx, usado por muitos conectores MCP em Python.",
        repo: "astral-sh/uv",
        site: "https://docs.astral.sh/uv/",
        asset: r"^uv-x86_64-pc-windows-msvc\.zip$",
        exes: &["uv", "uvx", "uvw"],
        copies: &[],
        tag: "runtime",
        files: &[],
    },
    Bin {
        id: "bun",
        name: "Bun",
        desc: "Runtime JavaScript. Traz o bunx, alternativa rápida ao npx para conectores MCP em Node.",
        repo: "oven-sh/bun",
        site: "https://bun.sh",
        asset: r"^bun-windows-x64\.zip$",
        exes: &["bun"],
        copies: &[("bun", "bunx")],
        tag: "runtime",
        files: &[],
    },
];

static DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init(app: &App) {
    let _ = DIR.set(app.root.join("bin"));
}

pub fn dir() -> PathBuf {
    DIR.get().cloned().unwrap_or_else(|| PathBuf::from("bin"))
}

fn exe_name(n: &str) -> String {
    format!("{n}{}", std::env::consts::EXE_SUFFIX)
}

/// PATH com a pasta das ferramentas na frente.
pub fn path_env() -> OsString {
    let mut v = vec![dir()];
    if let Some(p) = std::env::var_os("PATH") {
        v.extend(std::env::split_paths(&p));
    }
    std::env::join_paths(v).unwrap_or_default()
}

/// Procura um comando primeiro em dados\bin, depois no PATH do sistema.
pub fn which(cmd: &str) -> Option<PathBuf> {
    let cwd = std::env::current_dir().unwrap_or_default();
    which::which_in(cmd, Some(path_env()), cwd).ok()
}

fn studio_has(exe: &str) -> bool {
    dir().join(exe_name(exe)).is_file()
}

fn find(id: &str) -> Option<&'static Bin> {
    CATALOG.iter().find(|b| b.id == id)
}

fn versions_file() -> PathBuf {
    dir().join("versoes.json")
}

fn read_versions() -> HashMap<String, String> {
    std::fs::read(versions_file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn write_versions(v: &HashMap<String, String>) {
    let _ = std::fs::create_dir_all(dir());
    let _ = std::fs::write(versions_file(), serde_json::to_vec_pretty(v).unwrap_or_default());
}

/// Versão de um executável do sistema (`--version`), guardada para não rodar toda hora.
static SYS_VER: Mutex<Option<HashMap<PathBuf, String>>> = Mutex::new(None);

async fn system_version(p: &Path) -> String {
    if let Some(v) = SYS_VER.lock().unwrap().as_ref().and_then(|m| m.get(p).cloned()) {
        return v;
    }
    let mut c = tokio::process::Command::new(p);
    c.arg("--version").stdin(std::process::Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    c.creation_flags(crate::CREATE_NO_WINDOW);
    let out = tokio::time::timeout(Duration::from_secs(5), c.output()).await.ok().and_then(Result::ok);
    let text = out.map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
    let v = regex_lite::Regex::new(r"\d+\.\d+(\.\d+)?").unwrap().find(&text).map(|m| m.as_str().to_string()).unwrap_or_default();
    SYS_VER.lock().unwrap().get_or_insert_with(HashMap::new).insert(p.to_path_buf(), v.clone());
    v
}

static LATEST: Mutex<Option<(Instant, HashMap<String, Value>)>> = Mutex::new(None);

fn api_base() -> String {
    std::env::var("STUDIO_GITHUB_API").unwrap_or_else(|_| "https://api.github.com".into())
}

async fn latest_release(app: &App, b: &Bin) -> Result<Value, String> {
    if let Some((t, m)) = LATEST.lock().unwrap().as_ref() {
        if t.elapsed() < Duration::from_secs(1800) {
            if let Some(v) = m.get(b.id) {
                return Ok(v.clone());
            }
        }
    }
    let (status, body) = crate::update::fetch(app, &format!("{}/repos/{}/releases/latest", api_base(), b.repo), true, Duration::from_secs(20)).await?;
    if status != 200 {
        return Err(format!("GitHub respondeu {status} para {}", b.repo));
    }
    let v: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
    let mut g = LATEST.lock().unwrap();
    let entry = g.get_or_insert_with(|| (Instant::now(), HashMap::new()));
    if entry.0.elapsed() > Duration::from_secs(1800) {
        *entry = (Instant::now(), HashMap::new());
    }
    entry.1.insert(b.id.to_string(), v.clone());
    Ok(v)
}

fn tag_version(rel: &Value) -> String {
    rel["tag_name"].as_str().unwrap_or("").trim_start_matches(|c: char| !c.is_ascii_digit()).to_string()
}

pub async fn list(app: &App, with_latest: bool) -> Value {
    let vers = read_versions();
    let mut out = vec![];
    for b in CATALOG {
        let main = b.exes[0];
        let (source, version, size) = if studio_has(main) {
            let size: u64 = b.exes.iter().chain(b.copies.iter().map(|c| &c.1)).filter_map(|e| std::fs::metadata(dir().join(exe_name(e))).ok()).map(|m| m.len()).sum::<u64>()
                + b.files.iter().filter_map(|f| std::fs::metadata(dir().join(f)).ok()).map(|m| m.len()).sum::<u64>();
            ("studio", vers.get(b.id).cloned().unwrap_or_default(), size)
        } else if let Ok(p) = which::which(main) {
            let v = system_version(&p).await;
            ("system", v, std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0))
        } else {
            ("", String::new(), 0)
        };
        let mut v = json!({
            "id": b.id, "name": b.name, "cmd": main, "desc": b.desc, "repo": b.repo, "site": b.site, "tag": b.tag,
            "source": source, "version": version, "size": size,
        });
        if with_latest {
            match latest_release(app, b).await {
                Ok(rel) => {
                    let lv = tag_version(&rel);
                    v["latest"] = json!(lv);
                    v["update"] = json!(source == "studio" && crate::update::newer(&lv, &version));
                }
                Err(e) => v["latestError"] = json!(e),
            }
        }
        out.push(v);
    }
    json!({"dir": dir(), "items": out})
}

pub async fn install(app: &App, id: &str) -> Result<String, String> {
    let b = find(id).ok_or("Ferramenta desconhecida.")?;
    let rel = latest_release(app, b).await?;
    if b.id == "7zip" {
        return install_7zip(app, b, &rel).await;
    }
    let re = regex_lite::Regex::new(b.asset).unwrap();
    let url = rel["assets"]
        .as_array()
        .and_then(|a| a.iter().find(|x| x["name"].as_str().is_some_and(|n| re.is_match(n))))
        .and_then(|x| x["browser_download_url"].as_str())
        .ok_or_else(|| format!("A versão mais nova de {} não tem um pacote para Windows x64.", b.name))?
        .to_string();
    let (status, bytes) = crate::update::fetch(app, &url, false, Duration::from_secs(900)).await?;
    if status != 200 {
        return Err(format!("Download falhou ({status})."));
    }
    let d = dir();
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| format!("Pacote inválido: {e}"))?;
    let mut got = vec![];
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        if f.is_dir() {
            continue;
        }
        let full = f.name().map(|n| n.to_string()).unwrap_or_default();
        let base = full.rsplit(['/', '\\']).next().unwrap_or("").to_lowercase();
        let Some(exe) = b.exes.iter().find(|e| exe_name(e).to_lowercase() == base) else { continue };
        let mut buf = vec![];
        std::io::copy(&mut f, &mut buf).map_err(|e| e.to_string())?;
        put(&d.join(exe_name(exe)), &buf)?;
        got.push(*exe);
    }
    if !got.contains(&b.exes[0]) {
        return Err(format!("Não achei {} dentro do pacote.", exe_name(b.exes[0])));
    }
    for (from, to) in b.copies {
        let buf = std::fs::read(d.join(exe_name(from))).map_err(|e| e.to_string())?;
        put(&d.join(exe_name(to)), &buf)?;
    }
    let ver = tag_version(&rel);
    let mut vers = read_versions();
    vers.insert(b.id.to_string(), ver.clone());
    write_versions(&vers);
    Ok(ver)
}

fn asset(rel: &Value, pat: &str) -> Option<String> {
    let re = regex_lite::Regex::new(pat).unwrap();
    rel["assets"].as_array()?.iter().find(|x| x["name"].as_str().is_some_and(|n| re.is_match(n)))?["browser_download_url"].as_str().map(str::to_string)
}

async fn download(app: &App, url: &str) -> Result<Vec<u8>, String> {
    let (status, bytes) = crate::update::fetch(app, url, false, Duration::from_secs(900)).await?;
    if status != 200 {
        return Err(format!("Download falhou ({status})."));
    }
    Ok(bytes)
}

/// 7-Zip: o 7zr.exe (só .7z) abre o instalador oficial, de onde saem o 7z.exe e o 7z.dll
/// com todos os formatos. Se não der, usa o 7za.exe do pacote "extra".
async fn install_7zip(app: &App, b: &Bin, rel: &Value) -> Result<String, String> {
    let d = dir();
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let url = asset(rel, b.asset).ok_or("A versão mais nova do 7-Zip não tem o 7zr.exe.")?;
    let zr = d.join(exe_name("7zr"));
    put(&zr, &download(app, &url).await?)?;
    let tmp = d.join(format!("7zip-tmp-{}", crate::app::now_ms()));
    let _ = std::fs::create_dir_all(&tmp);
    let extract = |arc: &Path, out: &Path| -> Result<(), String> {
        let mut c = std::process::Command::new(&zr);
        c.arg("x").arg("-y").arg(format!("-o{}", out.display())).arg(arc).stdin(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(crate::CREATE_NO_WINDOW);
        }
        let o = c.output().map_err(|e| e.to_string())?;
        if o.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&o.stdout).lines().last().unwrap_or("falhou").to_string()) }
    };
    let mut ok = false;
    let mut why = String::new();
    if let Some(u) = asset(rel, r"^7z\d+-x64\.exe$") {
        let inst = tmp.join("instalador.exe");
        match download(app, &u).await.and_then(|bytes| std::fs::write(&inst, bytes).map_err(|e| e.to_string())) {
            Ok(()) => {
                let out = tmp.join("inst");
                match extract(&inst, &out) {
                    Ok(()) if out.join(exe_name("7z")).is_file() && out.join("7z.dll").is_file() => {
                        put(&d.join(exe_name("7z")), &std::fs::read(out.join(exe_name("7z"))).map_err(|e| e.to_string())?)?;
                        put(&d.join("7z.dll"), &std::fs::read(out.join("7z.dll")).map_err(|e| e.to_string())?)?;
                        ok = true;
                    }
                    Ok(()) => why = "o instalador não tinha 7z.exe".into(),
                    Err(e) => why = e,
                }
            }
            Err(e) => why = e,
        }
    }
    if !ok {
        if let Some(u) = asset(rel, r"^7z\d+-extra\.7z$") {
            let arc = tmp.join("extra.7z");
            std::fs::write(&arc, download(app, &u).await?).map_err(|e| e.to_string())?;
            let out = tmp.join("extra");
            extract(&arc, &out)?;
            let za = [out.join("x64").join(exe_name("7za")), out.join(exe_name("7za"))].into_iter().find(|p| p.is_file()).ok_or("O pacote extra não tem o 7za.exe.")?;
            let bytes = std::fs::read(&za).map_err(|e| e.to_string())?;
            put(&d.join(exe_name("7za")), &bytes)?;
            put(&d.join(exe_name("7z")), &bytes)?;
            ok = true;
        }
    }
    let _ = std::fs::remove_dir_all(&tmp);
    if !ok {
        return Err(format!("Não consegui montar o 7-Zip completo ({why}). O 7zr.exe (só .7z) ficou instalado."));
    }
    let ver = tag_version(rel);
    let mut vers = read_versions();
    vers.insert(b.id.to_string(), ver.clone());
    write_versions(&vers);
    Ok(ver)
}

/// Grava um executável. Se o antigo estiver em uso (um conector rodando uvx, por exemplo),
/// ele é renomeado antes: o Windows deixa renomear, mas não sobrescrever.
fn put(path: &Path, buf: &[u8]) -> Result<(), String> {
    if path.exists() && std::fs::write(path, buf).is_ok() {
        return set_exec(path);
    }
    if path.exists() {
        let old = path.with_extension(format!("antigo-{}", crate::app::now_ms()));
        std::fs::rename(path, &old).map_err(|e| format!("{} está em uso: {e}", path.display()))?;
    }
    std::fs::write(path, buf).map_err(|e| e.to_string())?;
    set_exec(path)
}

fn set_exec(_p: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(_p, std::fs::Permissions::from_mode(0o755));
    }
    Ok(())
}

pub fn remove(_app: &App, id: &str) -> Result<(), String> {
    let b = find(id).ok_or("Ferramenta desconhecida.")?;
    let d = dir();
    let paths: Vec<PathBuf> = b.exes.iter().chain(b.copies.iter().map(|c| &c.1)).map(|e| d.join(exe_name(e))).chain(b.files.iter().map(|f| d.join(f))).collect();
    for p in paths {
        if p.exists() && std::fs::remove_file(&p).is_err() {
            // em uso: tira do caminho e apaga na próxima abertura
            let _ = std::fs::rename(&p, p.with_extension(format!("antigo-{}", crate::app::now_ms())));
        }
    }
    let mut vers = read_versions();
    vers.remove(b.id);
    write_versions(&vers);
    Ok(())
}

/// Apaga sobras de trocas anteriores.
pub fn cleanup() {
    if let Ok(rd) = std::fs::read_dir(dir()) {
        for e in rd.flatten() {
            if e.file_name().to_string_lossy().contains(".antigo-") {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}
