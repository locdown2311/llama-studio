//! Isolamento dos comandos (opcional, desligado por padrão): cada pasta de trabalho ganha um Linux próprio no
//! WSL2 (uma distro Alpine importada pelo studio). Lá dentro o C: não é montado e programas do Windows não
//! rodam; só a pasta de trabalho aparece, em /workspace. Os comandos dos agentes (run_command) rodam ali, com
//! as ferramentas instaladas na preparação e o `apk add` para baixar o que faltar.
//!
//! Preparar (uma vez): baixa o Alpine mínimo, importa como distro base, instala os pacotes, exporta para
//! dados/sandbox/base.tar e apaga a base. Cada pasta de trabalho importa uma cópia desse base.tar na
//! primeira vez que roda um comando (alguns segundos).

use crate::app::App;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const PREFIX: &str = "llama-studio-";
const BASE: &str = "llama-studio-base";
pub const DEFAULT_PACKAGES: &str = "bash coreutils findutils grep sed gawk diffutils git python3 py3-pip nodejs npm ripgrep jq curl wget tar unzip zip xz file util-linux util-linux-misc ca-certificates";

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SandboxCfg {
    /// Rodar os comandos dos agentes no Linux isolado.
    pub enabled: bool,
    /// Comandos sem internet (o apk add também para).
    pub no_net: bool,
    /// Pacotes do Alpine a mais na preparação (separados por espaço).
    pub packages: String,
    /// Pastas de trabalho em que o isolamento fica desligado (os comandos rodam no PowerShell, como antes).
    pub off: Vec<String>,
}

fn ws_key(ws: &str) -> String {
    ws.trim().trim_end_matches(['\\', '/']).to_lowercase()
}

impl SandboxCfg {
    /// O isolamento vale para esta pasta?
    pub fn on_for(&self, ws: &Path) -> bool {
        self.enabled && !self.off.iter().any(|o| ws_key(o) == ws_key(&ws.to_string_lossy()))
    }
    pub fn set_off(&mut self, ws: &str, off: bool) {
        let k = ws_key(ws);
        self.off.retain(|o| ws_key(o) != k);
        if off && !k.is_empty() {
            self.off.push(ws.trim().to_string());
        }
    }
}

/// Andamento da preparação (a interface consulta).
#[derive(Default)]
pub struct Job {
    st: Mutex<(bool, String, String)>, // (rodando, passo, erro)
}

impl Job {
    fn set(&self, running: bool, step: &str, err: &str) {
        *self.st.lock().unwrap_or_else(|e| e.into_inner()) = (running, step.to_string(), err.to_string());
    }
    fn get(&self) -> (bool, String, String) {
        self.st.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

fn dir(app: &App) -> PathBuf {
    app.root.join("sandbox")
}
fn base_tar(app: &App) -> PathBuf {
    dir(app).join("base.tar")
}

/// Nome da distro de uma pasta de trabalho (o mesmo caminho dá sempre o mesmo nome).
pub fn distro_of(ws: &Path) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    ws.to_string_lossy().to_lowercase().trim_end_matches(['\\', '/']).hash(&mut h);
    format!("{PREFIX}{:012x}", h.finish() & 0xffff_ffff_ffff)
}

/// Texto entre aspas simples para o sh.
fn q(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// O /etc/wsl.conf das distros: sem C: montado, sem rodar programas do Windows, root como usuário.
pub const WSL_CONF: &str = "[automount]\nenabled = false\nmountFsTab = false\n\n[interop]\nenabled = false\nappendWindowsPath = false\n\n[user]\ndefault = root\n\n[network]\ngenerateResolvConf = true\nhostname = llama-sandbox\n";

/// O script que roda dentro da distro: monta só a pasta de trabalho em /workspace e roda o comando lá.
pub fn script(ws_win: &str, cwd: &str, command: &str, no_net: bool) -> String {
    let sub = cwd.trim().trim_matches(['/', '\\']).replace('\\', "/");
    let to = if sub.is_empty() || sub == "." { "/workspace".to_string() } else { format!("/workspace/{sub}") };
    let run = if no_net { format!("unshare -n sh -c {}", q(command)) } else { format!("sh -c {}", q(command)) };
    format!(
        "mkdir -p /workspace\nmountpoint -q /workspace || mount -t drvfs {} /workspace -o metadata || {{ echo 'llama-studio: não consegui montar a pasta de trabalho no Linux isolado' >&2; exit 97; }}\ncd {} || exit 98\nexport HOME=/root LANG=C.UTF-8 PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n{run}\n",
        q(ws_win),
        q(&to)
    )
}

/// wsl.exe devolve texto em UTF-16 (listas e mensagens).
fn wsl_text(b: &[u8]) -> String {
    if b.len() >= 2 && b.iter().skip(1).step_by(2).take(8).all(|&x| x == 0) {
        let u: Vec<u16> = b.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&u).replace('\0', "")
    } else {
        String::from_utf8_lossy(b).to_string()
    }
}

fn wsl() -> tokio::process::Command {
    let mut c = tokio::process::Command::new("wsl.exe");
    #[cfg(windows)]
    {
        c.creation_flags(crate::CREATE_NO_WINDOW);
    }
    c.kill_on_drop(true).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    c
}

async fn wsl_out(args: &[&str], secs: u64) -> Result<String, String> {
    let out = tokio::time::timeout(Duration::from_secs(secs), wsl().args(args).output())
        .await
        .map_err(|_| L!("O WSL demorou demais para responder.", "WSL took too long to answer.").to_string())?
        .map_err(|e| LF!("Não consegui rodar o wsl.exe: {e}", "Could not run wsl.exe: {e}"))?;
    let text = format!("{}{}", wsl_text(&out.stdout), wsl_text(&out.stderr));
    if out.status.success() {
        Ok(text)
    } else {
        Err(text.trim().lines().filter(|l| !l.trim().is_empty()).last().unwrap_or("wsl.exe falhou").to_string())
    }
}

/// WSL instalado? (`--version` só existe no WSL da Microsoft Store; o antigo responde a `--status`)
async fn wsl_ver() -> Result<String, String> {
    match wsl_out(&["--version"], 15).await {
        Ok(v) => Ok(v),
        Err(_) => wsl_out(&["--status"], 15).await.map(|t| t.lines().find(|l| l.contains('2')).unwrap_or("WSL").trim().to_string()),
    }
}

async fn distros() -> Vec<String> {
    wsl_out(&["--list", "--quiet"], 20).await.map(|t| t.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect()).unwrap_or_default()
}

/// Roda um script de sh dentro de uma distro (pelo stdin: nada de aspas do Windows no meio).
async fn sh_in(name: &str, body: &str, secs: u64) -> Result<(Option<i32>, String, String), String> {
    let mut c = wsl();
    c.args(["-d", name, "-u", "root", "-e", "sh", "-s"]).stdin(std::process::Stdio::piped());
    let mut child = c.spawn().map_err(|e| LF!("Não consegui rodar o wsl.exe: {e}", "Could not run wsl.exe: {e}"))?;
    if let Some(mut si) = child.stdin.take() {
        let _ = si.write_all(body.as_bytes()).await;
        drop(si);
    }
    let mut out = child.stdout.take().unwrap();
    let mut err = child.stderr.take().unwrap();
    let ro = async {
        let mut b = Vec::new();
        let _ = out.read_to_end(&mut b).await;
        b
    };
    let re = async {
        let mut b = Vec::new();
        let _ = err.read_to_end(&mut b).await;
        b
    };
    let res = tokio::time::timeout(Duration::from_secs(secs), async { tokio::join!(ro, re, child.wait()) }).await;
    match res {
        Ok((o, e, st)) => Ok((st.ok().and_then(|s| s.code()), String::from_utf8_lossy(&o).to_string(), wsl_text(&e))),
        Err(_) => Err(LF!("Tempo esgotado ({secs}s). O comando foi encerrado.", "Timed out ({secs}s). The command was stopped.")),
    }
}

pub async fn status(app: &App) -> Value {
    let cfg = app.cfg().sandbox.clone();
    let (running, step, err) = app.sandbox_job.get();
    let ver = if cfg!(windows) { wsl_ver().await } else { Err("".into()) };
    let list = if ver.is_ok() { distros().await } else { vec![] };
    let mine: Vec<&String> = list.iter().filter(|d| d.starts_with(PREFIX) && d.as_str() != BASE).collect();
    json!({
        "enabled": cfg.enabled, "noNet": cfg.no_net, "off": cfg.off, "packages": cfg.packages, "defaultPackages": DEFAULT_PACKAGES,
        "windows": cfg!(windows), "wsl": ver.is_ok(), "wslVersion": ver.unwrap_or_default().lines().next().unwrap_or("").trim(),
        "ready": base_tar(app).is_file(), "distros": mine, "job": { "running": running, "step": step, "error": err },
    })
}

/// Prepara a base (em segundo plano; o andamento fica em status().job).
pub fn prepare(app: std::sync::Arc<App>) {
    if app.sandbox_job.get().0 {
        return;
    }
    app.sandbox_job.set(true, L!("Começando...", "Starting..."), "");
    tokio::spawn(async move {
        let r = prepare_inner(&app).await;
        let _ = wsl_out(&["--unregister", BASE], 60).await;
        match r {
            Ok(()) => app.sandbox_job.set(false, L!("Pronto", "Ready"), ""),
            Err(e) => app.sandbox_job.set(false, "", &e),
        }
    });
}

async fn prepare_inner(app: &App) -> Result<(), String> {
    if !cfg!(windows) {
        return Err(L!("O isolamento por WSL só existe no Windows.", "WSL isolation only exists on Windows.").into());
    }
    let job = &app.sandbox_job;
    wsl_ver().await.map_err(|_| L!("O WSL2 não está instalado. Abra o PowerShell como administrador, rode `wsl --install --no-distribution` e reinicie o PC.", "WSL2 is not installed. Open PowerShell as administrator, run `wsl --install --no-distribution` and restart the PC.").to_string())?;
    let d = dir(app);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    // 1. o Alpine mínimo mais novo
    job.set(true, L!("Baixando o Alpine Linux (3 MB)...", "Downloading Alpine Linux (3 MB)..."), "");
    let idx = "https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/latest-releases.yaml";
    let (st, y) = crate::update::fetch(app, idx, false, Duration::from_secs(60)).await?;
    if st != 200 {
        return Err(LF!("Não consegui ver a versão do Alpine ({st}).", "Could not check the Alpine version ({st})."));
    }
    let y = String::from_utf8_lossy(&y);
    let file = y.lines().filter_map(|l| l.trim().strip_prefix("file:")).map(str::trim).find(|f| f.starts_with("alpine-minirootfs-") && f.ends_with(".tar.gz")).ok_or_else(|| L!("Não achei o Alpine mínimo na lista.", "Could not find the minimal Alpine in the list.").to_string())?.to_string();
    let (st, gz) = crate::update::fetch(app, &format!("https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/{file}"), false, Duration::from_secs(300)).await?;
    if st != 200 || gz.len() < 1_000_000 {
        return Err(LF!("Download do Alpine falhou ({st}).", "Alpine download failed ({st})."));
    }
    let mut tar = Vec::new();
    std::io::Read::read_to_end(&mut flate2::read::GzDecoder::new(&gz[..]), &mut tar).map_err(|e| e.to_string())?;
    let rootfs = d.join("alpine-rootfs.tar");
    std::fs::write(&rootfs, &tar).map_err(|e| e.to_string())?;
    // 2. distro base
    job.set(true, L!("Criando o Linux base no WSL...", "Creating the base Linux in WSL..."), "");
    let _ = wsl_out(&["--unregister", BASE], 60).await;
    let base_dir = d.join("base-distro");
    let _ = std::fs::remove_dir_all(&base_dir);
    std::fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?;
    let (bd, rf) = (base_dir.to_string_lossy().to_string(), rootfs.to_string_lossy().to_string());
    wsl_out(&["--import", BASE, &bd, &rf, "--version", "2"], 300).await.map_err(|e| LF!("wsl --import falhou: {e}", "wsl --import failed: {e}"))?;
    // 3. configuração e pacotes
    let extra = app.cfg().sandbox.packages.split_whitespace().filter(|p| p.chars().all(|c| c.is_ascii_alphanumeric() || "-_.+".contains(c))).collect::<Vec<_>>().join(" ");
    job.set(true, L!("Instalando os comandos (git, python, node, ripgrep...). Pode levar alguns minutos.", "Installing the commands (git, python, node, ripgrep...). This may take a few minutes."), "");
    let body = format!("cat > /etc/wsl.conf <<'EOF'\n{WSL_CONF}EOF\napk update && apk add --no-cache {DEFAULT_PACKAGES} {extra}\n");
    let (code, _o, e) = sh_in(BASE, &body, 1500).await?;
    if code != Some(0) {
        return Err(LF!("A instalação dos pacotes falhou: {}", "Package installation failed: {}", e.trim().lines().last().unwrap_or("?")));
    }
    // confere a montagem de uma pasta do Windows (é o que cada comando faz com a pasta de trabalho)
    job.set(true, L!("Conferindo a montagem da pasta...", "Checking the folder mount..."), "");
    let probe = format!("mkdir -p /tmp/t && mount -t drvfs {} /tmp/t -o metadata && ls /tmp/t >/dev/null && umount /tmp/t", q(&d.to_string_lossy()));
    let (code, _o, e) = sh_in(BASE, &probe, 120).await?;
    if code != Some(0) {
        return Err(LF!("O Linux isolado não conseguiu montar uma pasta do Windows: {}", "The isolated Linux could not mount a Windows folder: {}", e.trim().lines().last().unwrap_or("?")));
    }
    // 4. exporta a base pronta
    job.set(true, L!("Guardando a base pronta...", "Saving the ready base..."), "");
    let _ = wsl_out(&["--terminate", BASE], 60).await;
    let tmp = d.join("base.tar.part");
    let t = tmp.to_string_lossy().to_string();
    wsl_out(&["--export", BASE, &t], 900).await.map_err(|e| LF!("wsl --export falhou: {e}", "wsl --export failed: {e}"))?;
    std::fs::rename(&tmp, base_tar(app)).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&rootfs);
    let _ = std::fs::remove_dir_all(&base_dir);
    Ok(())
}

/// A distro da pasta de trabalho, criada da base na primeira vez.
async fn ensure(app: &App, ws: &Path) -> Result<String, String> {
    let name = distro_of(ws);
    if distros().await.iter().any(|d| d == &name) {
        return Ok(name);
    }
    if !base_tar(app).is_file() {
        return Err(L!("O Linux isolado ainda não foi preparado: Configurações › Isolamento › Preparar.", "The isolated Linux is not prepared yet: Settings › Isolation › Prepare.").into());
    }
    let to = dir(app).join("ws").join(name.trim_start_matches(PREFIX));
    std::fs::create_dir_all(&to).map_err(|e| e.to_string())?;
    let (t, b) = (to.to_string_lossy().to_string(), base_tar(app).to_string_lossy().to_string());
    wsl_out(&["--import", &name, &t, &b, "--version", "2"], 300).await.map_err(|e| LF!("Não consegui criar o Linux desta pasta: {e}", "Could not create this folder's Linux: {e}"))?;
    let _ = std::fs::write(to.join("pasta.txt"), ws.to_string_lossy().as_bytes());
    Ok(name)
}

/// run_command dentro do Linux isolado da pasta de trabalho.
pub async fn run(app: &App, ws: &Path, command: &str, cwd: &str, timeout_s: u64) -> Result<String, String> {
    if command.trim().is_empty() {
        return Err("Comando vazio.".into());
    }
    let name = ensure(app, ws).await?;
    let no_net = app.cfg().sandbox.no_net;
    let body = script(&ws.to_string_lossy(), cwd, command, no_net);
    let t0 = Instant::now();
    let limit = timeout_s.clamp(1, 1800);
    let (code, o, e) = sh_in(&name, &body, limit).await?;
    let mut text = o.trim_end().to_string();
    let e = e.trim_end();
    if !e.is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str("[stderr]\n");
        text.push_str(e);
    }
    if text.is_empty() {
        text = L!("(sem saída)", "(no output)").into();
    }
    let sub = cwd.trim().trim_matches(['/', '\\']).replace('\\', "/");
    let shown = if sub.is_empty() || sub == "." { "/workspace".to_string() } else { format!("/workspace/{sub}") };
    Ok(LF!("[Linux isolado · código de saída {} em {:.1}s, pasta {}]\n{}", "[isolated Linux · exit code {} in {:.1}s, folder {}]\n{}", code.map(|c| c.to_string()).unwrap_or("?".into()), t0.elapsed().as_secs_f32(), shown, text))
}

/// Apaga o Linux de uma pasta (ou de todas, com `all`).
pub async fn remove(app: &App, name: &str, all: bool) -> Result<Value, String> {
    let mut n = 0;
    for d in distros().await {
        if d.starts_with(PREFIX) && (all || d == name) {
            wsl_out(&["--unregister", &d], 120).await?;
            let _ = std::fs::remove_dir_all(dir(app).join("ws").join(d.trim_start_matches(PREFIX)));
            n += 1;
        }
    }
    Ok(json!({ "removed": n }))
}

fn pkg_ok(p: &str) -> bool {
    !p.is_empty() && p.len() <= 80 && p.chars().all(|c| c.is_ascii_alphanumeric() || "-_.+".contains(c))
}

async fn mine(name: &str) -> Result<(), String> {
    if !name.starts_with(PREFIX) || name == BASE || !distros().await.iter().any(|d| d == name) {
        return Err(L!("Esse Linux não existe (apagado?).", "That Linux does not exist (deleted?).").into());
    }
    Ok(())
}

/// Pacotes que a pessoa (ou a preparação) pediu na distro: o /etc/apk/world.
pub async fn packages(name: &str) -> Result<Value, String> {
    mine(name).await?;
    let (_, o, e) = sh_in(name, "cat /etc/apk/world; echo ---; apk info 2>/dev/null | wc -l\n", 60).await?;
    let (world, count) = o.split_once("---").unwrap_or((&o, "0"));
    if world.trim().is_empty() && !e.trim().is_empty() {
        return Err(e.trim().to_string());
    }
    let mut list: Vec<&str> = world.split_whitespace().collect();
    list.sort();
    Ok(json!({ "world": list, "installed": count.trim().parse::<u32>().unwrap_or(0) }))
}

/// Procura pacotes do Alpine pelo nome ou descrição (precisa de internet para o índice estar em dia).
pub async fn search(name: &str, query: &str) -> Result<Value, String> {
    mine(name).await?;
    let term: String = query.chars().filter(|c| c.is_ascii_alphanumeric() || "-_.+".contains(*c)).take(60).collect();
    if term.len() < 2 {
        return Ok(json!({ "items": [] }));
    }
    let body = format!("apk search -d {} 2>/dev/null | head -n 400\n", q(&format!("*{term}*")));
    let (_, o, _) = sh_in(name, &body, 60).await?;
    let items = parse_search(&o, &term);
    Ok(json!({ "items": items }))
}

/// Linhas do `apk search -d` ("nome-versão - descrição") em itens, o nome exato primeiro.
fn parse_search(o: &str, term: &str) -> Vec<Value> {
    // linhas "nome-versão - descrição"; o nome vai até o último "-" antes de um dígito
    let mut items: Vec<Value> = o
        .lines()
        .filter_map(|l| {
            let (pv, desc) = l.split_once(" - ").unwrap_or((l, ""));
            let cut = pv.char_indices().filter(|(i, c)| *c == '-' && pv[i + 1..].starts_with(|d: char| d.is_ascii_digit())).map(|(i, _)| i).next()?;
            Some(json!({ "name": &pv[..cut], "version": &pv[cut + 1..], "desc": desc.trim() }))
        })
        .collect();
    // o nome exato primeiro, depois os que começam com o termo
    let ql = term.to_lowercase();
    items.sort_by_key(|v| {
        let n = v["name"].as_str().unwrap_or("").to_lowercase();
        (n != ql, !n.starts_with(&ql), n.len())
    });
    items.truncate(60);
    items
}

/// apk add / apk del na distro. Devolve a saída para mostrar.
pub async fn change(name: &str, add: &[String], del: &[String]) -> Result<Value, String> {
    mine(name).await?;
    let add: Vec<&str> = add.iter().map(String::as_str).filter(|p| pkg_ok(p)).collect();
    let del: Vec<&str> = del.iter().map(String::as_str).filter(|p| pkg_ok(p)).collect();
    if add.is_empty() && del.is_empty() {
        return Err(L!("Nenhum pacote.", "No package.").into());
    }
    let mut body = String::new();
    if !add.is_empty() {
        body.push_str(&format!("apk add {} 2>&1 || exit $?\n", add.join(" ")));
    }
    if !del.is_empty() {
        body.push_str(&format!("apk del {} 2>&1 || exit $?\n", del.join(" ")));
    }
    let (code, o, e) = sh_in(name, &body, 1200).await?;
    let text = format!("{}{}", o.trim_end(), if e.trim().is_empty() { String::new() } else { format!("\n{}", e.trim()) });
    if code != Some(0) {
        return Err(text.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("apk falhou").to_string());
    }
    Ok(json!({ "ok": true, "log": text }))
}

/// Pasta de trabalho de cada distro (para a lista nas configurações).
pub fn folder_of(app: &App, name: &str) -> String {
    std::fs::read_to_string(dir(app).join("ws").join(name.trim_start_matches(PREFIX)).join("pasta.txt")).unwrap_or_default()
}

#[cfg(test)]
mod t {
    use super::*;

    #[test]
    fn script_monta_so_a_pasta() {
        let s = script(r"C:\Users\igor\proj's", "src\\app", "echo 'oi' && ls", false);
        assert!(s.contains(r"mount -t drvfs 'C:\Users\igor\proj'\''s' /workspace"));
        assert!(s.contains("cd '/workspace/src/app'"));
        assert!(s.contains(r"sh -c 'echo '\''oi'\'' && ls'"));
        let s = script(r"D:\x", "", "curl x", true);
        assert!(s.contains("cd '/workspace'") && s.contains("unshare -n sh -c 'curl x'"));
        assert!(WSL_CONF.contains("enabled = false") && WSL_CONF.contains("appendWindowsPath = false"));
    }

    #[test]
    fn le_a_busca_do_apk() {
        let o = "gcc-doc-14.2.0-r6 - GNU docs\nlibgcc-14.2.0-r6 - runtime\ngcc-14.2.0-r6 - The GNU Compiler Collection\npython3-3.12.11-r0 - A high-level language\n";
        let it = parse_search(o, "gcc");
        assert_eq!(it[0]["name"], "gcc");
        assert_eq!(it[0]["version"], "14.2.0-r6");
        assert_eq!(it[1]["name"], "gcc-doc");
        assert!(it.iter().any(|v| v["name"] == "python3" && v["version"] == "3.12.11-r0"));
    }

    #[test]
    fn desligado_por_pasta() {
        let mut c = SandboxCfg { enabled: true, ..Default::default() };
        c.set_off(r"C:\Proj\A\", true);
        assert!(!c.on_for(Path::new(r"c:\proj\a")));
        assert!(c.on_for(Path::new(r"C:\Proj\B")));
        c.set_off(r"C:\proj\a", false);
        assert!(c.on_for(Path::new(r"C:\Proj\A")) && c.off.is_empty());
    }

    #[test]
    fn nomes_e_texto_do_wsl() {
        assert_eq!(distro_of(Path::new(r"C:\A\B")), distro_of(Path::new(r"c:\a\b\")));
        assert_ne!(distro_of(Path::new(r"C:\A\B")), distro_of(Path::new(r"C:\A\C")));
        assert!(distro_of(Path::new("x")).starts_with(PREFIX));
        let u16: Vec<u8> = "Ubuntu\r\nllama-studio-x\r\n".encode_utf16().flat_map(|c| c.to_le_bytes()).collect();
        assert_eq!(wsl_text(&u16), "Ubuntu\r\nllama-studio-x\r\n");
        assert_eq!(wsl_text(b"ok"), "ok");
    }
}
