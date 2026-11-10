//! Vídeos (opcional): projetos do Remotion (github.com/remotion-dev/remotion) dentro de dados\videos.
//! O studio cria os projetos (create-video), sobe o Remotion Studio para a prévia, renderiza para MP4 e
//! instala as habilidades oficiais (remotion-dev/skills) para as conversas de vídeo. Tudo roda por npx,
//! então precisa do Node.js (e do Git, que o create-video usa) no PC.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::app::App;

const SKILLS_REPO: &str = "remotion-dev/skills";

#[derive(Default)]
pub struct Videos {
    jobs: Mutex<HashMap<String, Job>>,
    studio: Mutex<Option<Studio>>,
}

#[derive(Clone)]
struct Job {
    kind: &'static str,
    project: String,
    log: String,
    done: bool,
    ok: bool,
    /// 0..1 (render)
    progress: f64,
    out: String,
    started: u64,
}

struct Studio {
    project: String,
    port: u16,
    pid: u32,
    _child: tokio::process::Child,
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn root(app: &App) -> PathBuf {
    app.root.join("videos")
}

fn project_dir(app: &App, id: &str) -> Option<PathBuf> {
    if id.is_empty() || id.contains(['/', '\\', ':']) || id.starts_with('.') {
        return None;
    }
    let d = root(app).join(id);
    d.is_dir().then_some(d)
}

/// Nome de pasta seguro a partir do que o usuário digitou.
fn slug(name: &str) -> String {
    let mut s = String::new();
    for ch in name.trim().to_lowercase().chars() {
        let c = match ch {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'ê' | 'è' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ô' | 'õ' | 'ò' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            c if c.is_ascii_alphanumeric() => c,
            _ => '-',
        };
        if c == '-' && (s.is_empty() || s.ends_with('-')) {
            continue;
        }
        s.push(c);
    }
    s.trim_end_matches('-').chars().take(40).collect()
}

fn npx() -> PathBuf {
    crate::bins::which("npx").unwrap_or_else(|| PathBuf::from("npx"))
}

fn command(program: &Path, args: &[&str], cwd: &Path) -> tokio::process::Command {
    let mut c = tokio::process::Command::new(program);
    c.args(args).current_dir(cwd).env("PATH", crate::bins::path_env()).env("CI", "1").env("FORCE_COLOR", "0").env("NO_COLOR", "1");
    c.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)]
    c.creation_flags(crate::CREATE_NO_WINDOW);
    #[cfg(unix)]
    c.process_group(0);
    c
}

/// Mata o processo e os filhos (npx abre node, que abre o navegador do render...).
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        let mut c = std::process::Command::new("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null());
        std::os::windows::process::CommandExt::creation_flags(&mut c, crate::CREATE_NO_WINDOW);
        let _ = c.status();
    }
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill").args(["-TERM", &format!("-{pid}")]).status();
    }
}

/// Versão do Node (None = não instalado).
async fn node_version() -> Option<String> {
    let node = crate::bins::which("node")?;
    let mut c = tokio::process::Command::new(node);
    c.arg("--version").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    c.creation_flags(crate::CREATE_NO_WINDOW);
    let out = tokio::time::timeout(Duration::from_secs(10), c.output()).await.ok()?.ok()?;
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string()).filter(|s| !s.is_empty())
}

fn skills_installed(app: &App) -> Vec<String> {
    std::fs::read_dir(app.skills_dir())
        .map(|rd| rd.flatten().filter_map(|e| e.file_name().to_str().map(str::to_string)).filter(|n| n.starts_with("remotion-")).collect())
        .unwrap_or_default()
}

fn renders(dir: &Path) -> Vec<Value> {
    let mut v: Vec<(u64, Value)> = std::fs::read_dir(dir.join("out"))
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_str()?.to_string();
                    let ext = name.rsplit('.').next()?.to_lowercase();
                    if !["mp4", "webm", "mov", "gif", "png", "mkv"].contains(&ext.as_str()) {
                        return None;
                    }
                    let md = e.metadata().ok()?;
                    let t = md.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
                    Some((t, json!({ "file": name, "size": md.len(), "mtime": t, "path": e.path() })))
                })
                .collect()
        })
        .unwrap_or_default();
    v.sort_by(|a, b| b.0.cmp(&a.0));
    v.into_iter().map(|x| x.1).collect()
}

impl Videos {
    pub async fn list(&self, app: &App) -> Value {
        let r = root(app);
        let studio = self.studio.lock().unwrap().as_ref().map(|s| json!({ "project": s.project, "port": s.port }));
        let mut projects: Vec<(u64, Value)> = std::fs::read_dir(&r)
            .map(|rd| {
                rd.flatten()
                    .filter(|e| e.path().join("package.json").is_file())
                    .map(|e| {
                        let p = e.path();
                        let id = e.file_name().to_string_lossy().to_string();
                        let t = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
                        (t, json!({ "id": id, "path": p, "ready": p.join("node_modules").is_dir(), "renders": renders(&p), "mtime": t }))
                    })
                    .collect()
            })
            .unwrap_or_default();
        projects.sort_by(|a, b| b.0.cmp(&a.0));
        let jobs: Vec<Value> = self
            .jobs
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, j)| !j.done || now() - j.started < 600)
            .map(|(id, j)| json!({ "id": id, "kind": j.kind, "project": j.project, "done": j.done, "ok": j.ok, "progress": j.progress, "out": j.out, "tail": tail(&j.log, 6) }))
            .collect();
        json!({
            "root": r, "node": node_version().await, "skills": skills_installed(app),
            "projects": projects.into_iter().map(|x| x.1).collect::<Vec<_>>(), "jobs": jobs, "studio": studio,
        })
    }

    pub fn job(&self, id: &str) -> Value {
        match self.jobs.lock().unwrap().get(id) {
            Some(j) => json!({ "kind": j.kind, "project": j.project, "done": j.done, "ok": j.ok, "progress": j.progress, "out": j.out, "log": tail(&j.log, 80) }),
            None => json!({ "missing": true }),
        }
    }

    fn start_job(&self, kind: &'static str, project: &str) -> String {
        let id = format!("{kind}-{}-{}", project, now());
        self.jobs.lock().unwrap().insert(id.clone(), Job { kind, project: project.into(), log: String::new(), done: false, ok: false, progress: 0.0, out: String::new(), started: now() });
        id
    }

    fn with_job(&self, id: &str, f: impl FnOnce(&mut Job)) {
        if let Some(j) = self.jobs.lock().unwrap().get_mut(id) {
            f(j);
        }
    }

    /// Roda um processo guardando a saída no trabalho; `on_line` vê cada linha (para o progresso).
    async fn run(&self, job: &str, mut cmd: tokio::process::Command, on_line: impl Fn(&str) -> Option<f64>) -> bool {
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                self.with_job(job, |j| j.log.push_str(&LF!("Não consegui iniciar: {e}\n", "Could not start: {e}\n")));
                return false;
            }
        };
        let out = child.stdout.take().unwrap();
        let err = child.stderr.take().unwrap();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        let tx2 = tx.clone();
        tokio::spawn(async move {
            let mut l = BufReader::new(out).lines();
            while let Ok(Some(x)) = l.next_line().await {
                let _ = tx.send(x);
            }
        });
        tokio::spawn(async move {
            let mut l = BufReader::new(err).lines();
            while let Ok(Some(x)) = l.next_line().await {
                let _ = tx2.send(x);
            }
        });
        while let Some(line) = rx.recv().await {
            // barras de progresso reescrevem a linha com \r: fica só o último pedaço
            let line = line.rsplit('\r').next().unwrap_or("").to_string();
            let p = on_line(&line);
            self.with_job(job, |j| {
                if let Some(p) = p {
                    j.progress = p;
                }
                j.log.push_str(&line);
                j.log.push('\n');
                if j.log.len() > 200_000 {
                    let cut = j.log.len() - 150_000;
                    j.log.drain(..j.log.char_indices().find(|(i, _)| *i >= cut).map(|x| x.0).unwrap_or(cut));
                }
            });
        }
        child.wait().await.map(|s| s.success()).unwrap_or(false)
    }

    pub fn create(self: &std::sync::Arc<Self>, app: std::sync::Arc<App>, name: &str) -> Result<Value, String> {
        let id = slug(name);
        if id.is_empty() {
            return Err(L!("Dê um nome ao projeto.", "Give the project a name.").into());
        }
        let r = root(&app);
        std::fs::create_dir_all(&r).map_err(|e| e.to_string())?;
        if r.join(&id).exists() {
            return Err(LF!("Já existe um projeto \"{id}\".", "A project \"{id}\" already exists."));
        }
        let job = self.start_job("create", &id);
        let me = self.clone();
        let (job2, id2) = (job.clone(), id.clone());
        tokio::spawn(async move {
            // o create-video baixa o modelo em branco, instala as dependências (npm) e não pergunta nada com --yes
            let ok = me.run(&job2, command(&npx(), &["--yes", "create-video@latest", "--yes", "--blank", &id2], &r), |_| None).await;
            let ok = ok && r.join(&id2).join("package.json").is_file();
            if ok {
                // o Remotion usa um Chromium próprio (~100 MB) para listar e renderizar: baixa já, em vez de
                // travar a primeira listagem de composições ou o primeiro render
                me.with_job(&job2, |j| j.log.push_str(&L!("Baixando o navegador do Remotion (só na primeira vez)...\n", "Downloading the Remotion browser (first time only)...\n")));
                let dir = r.join(&id2);
                if !me.run(&job2, command(&npx(), &["--yes", "remotion", "browser", "ensure"], &dir), |_| None).await {
                    me.with_job(&job2, |j| j.log.push_str(&L!("Não consegui baixar o navegador agora; o Remotion tenta de novo no primeiro render.\n", "Could not download the browser now; Remotion tries again on the first render.\n")));
                }
            }
            me.with_job(&job2, |j| {
                j.done = true;
                j.ok = ok;
                j.progress = 1.0;
            });
        });
        Ok(json!({ "job": job, "id": id }))
    }

    pub fn render(self: &std::sync::Arc<Self>, app: &App, id: &str, comp: &str) -> Result<Value, String> {
        let dir = project_dir(app, id).ok_or_else(|| L!("Projeto não encontrado.", "Project not found.").to_string())?;
        if comp.trim().is_empty() || comp.contains(['"', '\'', '&', '|', '>', '<']) {
            return Err(L!("Escolha a composição.", "Choose the composition.").into());
        }
        let file = format!("out/{}-{}.mp4", comp.trim(), chrono_stamp());
        let job = self.start_job("render", id);
        self.with_job(&job, |j| j.out = file.trim_start_matches("out/").to_string());
        let me = self.clone();
        let (job2, comp2) = (job.clone(), comp.trim().to_string());
        tokio::spawn(async move {
            let ok = me
                .run(&job2, command(&npx(), &["--yes", "remotion", "render", &comp2, &file], &dir), |line| {
                    // "Rendering frames ━━━━ 34/300" e "Encoding ... 34/300": a última fração da linha
                    let frac = line.split_whitespace().rev().find_map(|w| {
                        let (a, b) = w.split_once('/')?;
                        let (a, b) = (a.parse::<f64>().ok()?, b.parse::<f64>().ok()?);
                        (b > 0.0 && a <= b).then_some(a / b)
                    })?;
                    let stage = if line.contains("ncod") || line.contains("titch") { 0.85 + frac * 0.15 } else { frac * 0.85 };
                    Some(stage.min(1.0))
                })
                .await;
            me.with_job(&job2, |j| {
                j.done = true;
                j.ok = ok;
                if ok {
                    j.progress = 1.0;
                }
            });
        });
        Ok(json!({ "job": job }))
    }

    /// Lista as composições do projeto (ids), pelo CLI do Remotion.
    pub async fn compositions(&self, app: &App, id: &str) -> Result<Vec<String>, String> {
        let dir = project_dir(app, id).ok_or_else(|| L!("Projeto não encontrado.", "Project not found.").to_string())?;
        let mut c = command(&npx(), &["--yes", "remotion", "compositions", "--quiet"], &dir);
        c.stdout(Stdio::piped());
        let out = tokio::time::timeout(Duration::from_secs(180), c.output())
            .await
            .map_err(|_| L!("O Remotion demorou demais para listar as composições.", "Remotion took too long to list the compositions.").to_string())?
            .map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&out.stdout).to_string();
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(short_err(&format!("{text}\n{err}")));
        }
        // com --quiet sai só os ids, separados por espaço
        Ok(text.split_whitespace().filter(|w| w.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).map(str::to_string).collect())
    }

    /// Confere os tipos do projeto (tsc --noEmit). Devolve se passou e a saída (erros no formato arquivo(l,c)).
    pub async fn check(&self, app: &App, id: &str) -> Result<Value, String> {
        let dir = project_dir(app, id).ok_or_else(|| L!("Projeto não encontrado.", "Project not found.").to_string())?;
        // o tsc do projeto (node_modules/.bin); sem ele, pelo npx
        let local = dir.join("node_modules").join(".bin").join(if cfg!(windows) { "tsc.cmd" } else { "tsc" });
        let mut c = if local.is_file() { command(&local, &["--noEmit", "--pretty", "false"], &dir) } else { command(&npx(), &["--yes", "tsc", "--noEmit", "--pretty", "false"], &dir) };
        c.stdout(Stdio::piped());
        let out = tokio::time::timeout(Duration::from_secs(150), c.output())
            .await
            .map_err(|_| L!("A conferência de tipos demorou demais.", "The type check took too long.").to_string())?
            .map_err(|e| e.to_string())?;
        let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        Ok(json!({ "ok": out.status.success(), "out": text.chars().take(20000).collect::<String>() }))
    }

    /// Registra a composição "Video" (src/scenes/Video.tsx) no src/Root.tsx, uma vez. As medidas vêm do
    /// VIDEO exportado pela sequência, então refazer as cenas não precisa mexer no Root de novo.
    pub fn wire(&self, app: &App, id: &str) -> Result<Value, String> {
        let dir = project_dir(app, id).ok_or_else(|| L!("Projeto não encontrado.", "Project not found.").to_string())?;
        let path = dir.join("src").join("Root.tsx");
        let text = std::fs::read_to_string(&path).map_err(|e| LF!("Não consegui ler src/Root.tsx: {e}", "Could not read src/Root.tsx: {e}"))?;
        match wire_root(&text) {
            Some(new) if new != text => {
                std::fs::write(&path, new).map_err(|e| e.to_string())?;
                Ok(json!({ "changed": true }))
            }
            Some(_) => Ok(json!({ "changed": false })),
            None => Err(L!("Não achei onde registrar a composição em src/Root.tsx (falta o fragmento <>...</>).", "Could not find where to register the composition in src/Root.tsx (the <>...</> fragment is missing).").into()),
        }
    }

    pub async fn studio_start(&self, app: &App, id: &str) -> Result<Value, String> {
        let dir = project_dir(app, id).ok_or_else(|| L!("Projeto não encontrado.", "Project not found.").to_string())?;
        if let Some(s) = self.studio.lock().unwrap().as_ref() {
            if s.project == id {
                return Ok(json!({ "port": s.port, "project": id }));
            }
        }
        self.studio_stop();
        let port = (3100..3200).find(|p| std::net::TcpListener::bind(("127.0.0.1", *p)).is_ok()).ok_or_else(|| L!("Nenhuma porta livre entre 3100 e 3200.", "No free port between 3100 and 3200.").to_string())?;
        let mut c = command(&npx(), &["--yes", "remotion", "studio", "--port", &port.to_string(), "--no-open"], &dir);
        c.stdout(Stdio::null()).stderr(Stdio::null());
        let child = c.spawn().map_err(|e| LF!("Não consegui abrir o Remotion Studio: {e}", "Could not open Remotion Studio: {e}"))?;
        let pid = child.id().unwrap_or(0);
        *self.studio.lock().unwrap() = Some(Studio { project: id.to_string(), port, pid, _child: child });
        // espera ele responder (a primeira vez empacota o projeto e pode levar um tempo)
        let url = format!("http://127.0.0.1:{port}/");
        for _ in 0..120 {
            if app.http.get(&url).timeout(Duration::from_secs(2)).send().await.is_ok() {
                return Ok(json!({ "port": port, "project": id }));
            }
            if self.studio.lock().unwrap().as_ref().map(|s| s.pid) != Some(pid) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        self.studio_stop();
        Err(L!("O Remotion Studio não respondeu em 60 s. Rode \"npm run dev\" na pasta do projeto para ver o erro.", "Remotion Studio did not answer within 60 s. Run \"npm run dev\" in the project folder to see the error.").into())
    }

    pub fn studio_stop(&self) {
        if let Some(s) = self.studio.lock().unwrap().take() {
            kill_tree(s.pid);
        }
    }

    pub fn delete(&self, app: &App, id: &str) -> Result<(), String> {
        let dir = project_dir(app, id).ok_or_else(|| L!("Projeto não encontrado.", "Project not found.").to_string())?;
        if self.studio.lock().unwrap().as_ref().is_some_and(|s| s.project == id) {
            self.studio_stop();
        }
        std::fs::remove_dir_all(&dir).map_err(|e| LF!("Não consegui apagar (algum arquivo em uso?): {e}", "Could not delete (a file in use?): {e}"))
    }

    /// Baixa as habilidades oficiais (remotion-dev/skills) para dados\skills\remotion-*.
    pub async fn install_skills(&self, app: &App) -> Result<usize, String> {
        let api = std::env::var("STUDIO_GITHUB_API").unwrap_or_else(|_| "https://api.github.com".into());
        let (status, bytes) = crate::update::fetch(app, &format!("{api}/repos/{SKILLS_REPO}/zipball"), false, Duration::from_secs(300)).await?;
        if status != 200 {
            return Err(LF!("Download falhou ({status}).", "Download failed ({status})."));
        }
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| LF!("Pacote inválido: {e}", "Invalid package: {e}"))?;
        let dest = app.skills_dir();
        let mut skills = std::collections::BTreeSet::new();
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
            if f.is_dir() {
                continue;
            }
            let name = f.name().map(|n| n.to_string()).unwrap_or_default();
            // dono-repo-sha/skills/<habilidade>/...
            let Some((_, rel)) = name.split_once('/') else { continue };
            let Some(rel) = rel.strip_prefix("skills/") else { continue };
            let Some((skill, rest)) = rel.split_once('/') else { continue };
            if !skill.starts_with("remotion") || rest.is_empty() || rel.contains("..") || rest.starts_with("agents/") {
                continue;
            }
            let to = dest.join(skill).join(rest);
            if let Some(d) = to.parent() {
                std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
            }
            let mut buf = vec![];
            f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            std::fs::write(&to, buf).map_err(|e| e.to_string())?;
            skills.insert(skill.to_string());
        }
        if skills.is_empty() {
            return Err(L!("O pacote não tinha habilidades.", "The package had no skills.").into());
        }
        Ok(skills.len())
    }
}

/// O Root.tsx com o import da sequência e a <Composition id="Video">; None se não houver onde pôr.
fn wire_root(text: &str) -> Option<String> {
    if text.contains("./scenes/Video") {
        return Some(text.to_string());
    }
    let close = text.rfind("</>")?;
    let comp = "      <Composition\n        id=\"Video\"\n        component={Video}\n        durationInFrames={VIDEO.durationInFrames}\n        fps={VIDEO.fps}\n        width={VIDEO.width}\n        height={VIDEO.height}\n      />\n";
    // recua até o começo da linha do </> para a composição entrar com a indentação certa
    let line = text[..close].rfind('\n').map(|i| i + 1).unwrap_or(close);
    let body = format!("{}{}{}", &text[..line], comp, &text[line..]);
    let mut imports = String::new();
    let has_comp = body.lines().any(|l| l.trim_start().starts_with("import") && l.contains("Composition") && l.contains("\"remotion\""));
    if !has_comp {
        imports.push_str("import { Composition } from \"remotion\";\n");
    }
    imports.push_str("import { Video, VIDEO } from \"./scenes/Video\";\n");
    Some(format!("{imports}{body}"))
}

/// Erro do CLI do Remotion em uma ou duas linhas (sem a pilha do Node).
pub fn short_err(s: &str) -> String {
    if s.contains("chromium-headless-shell") || s.contains("remotion.media") {
        let why = s.lines().find(|l| l.trim_start().starts_with("Error:")).map(|l| l.trim().trim_start_matches("Error:").trim()).unwrap_or("");
        return LF!("O Remotion precisa baixar o navegador dele (~100 MB, só na primeira vez) e não conseguiu: {}. Confira a internet e tente de novo.", "Remotion needs to download its browser (~100 MB, first time only) and could not: {}. Check the internet connection and try again.", why);
    }
    let lines: Vec<&str> = s
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("at ") && !l.starts_with("node:") && !l.starts_with('^') && !l.starts_with("Node.js v") && !l.contains("triggerUncaughtException") && !matches!(*l, "{" | "}"))
        .collect();
    let pick: Vec<&str> = lines.iter().filter(|l| l.contains("Error") || l.contains("error")).take(2).copied().collect();
    let pick = if pick.is_empty() { lines.iter().rev().take(2).rev().copied().collect() } else { pick };
    pick.join(" · ").chars().take(400).collect()
}

fn tail(s: &str, n: usize) -> String {
    let lines: Vec<&str> = s.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

fn chrono_stamp() -> String {
    // aaaammdd-hhmmss em UTC, sem depender de crate de data
    let s = now();
    let (d, t) = (s / 86400, s % 86400);
    let (mut y, mut days) = (1970u64, d);
    loop {
        let len = if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 { 366 } else { 365 };
        if days < len {
            break;
        }
        days -= len;
        y += 1;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let ml = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0;
    while days >= ml[m] {
        days -= ml[m];
        m += 1;
    }
    format!("{y}{:02}{:02}-{:02}{:02}{:02}", m + 1, days + 1, t / 3600, t % 3600 / 60, t % 60)
}

#[cfg(test)]
mod t {
    #[test]
    fn registra_a_composicao_uma_vez() {
        let root = "import { MyComposition } from \"./Composition\";\n\nexport const RemotionRoot: React.FC = () => {\n  return (\n    <>\n      <MyComposition />\n    </>\n  );\n};\n";
        let a = super::wire_root(root).unwrap();
        assert!(a.starts_with("import { Composition } from \"remotion\";\nimport { Video, VIDEO } from \"./scenes/Video\";\n"));
        assert!(a.contains("      <MyComposition />\n      <Composition\n        id=\"Video\""));
        assert!(a.contains("height={VIDEO.height}\n      />\n    </>"));
        assert_eq!(super::wire_root(&a).unwrap(), a, "segunda vez não muda nada");
        assert!(super::wire_root("export const X = () => null;").is_none());
    }

    #[test]
    fn erro_do_navegador_resumido() {
        let e = "Downloading from: https://remotion.media/chromium-headless-shell-linux-x64.zip\nnode:internal/process/promises:394\n    triggerUncaughtException(err, true);\n    ^\nError: getaddrinfo ENOTFOUND remotion.media\n    at GetAddrInfoReqWrap.onlookupall (node:dns:122:26) {\n  errno: -3008\n}\nNode.js v22.23.4";
        let s = super::short_err(e);
        assert!(s.contains("getaddrinfo ENOTFOUND remotion.media") && !s.contains("node:dns"), "{s}");
        assert_eq!(super::short_err("x\nError: Composition MyComp not found\n    at foo (bar.js:1:1)"), "Error: Composition MyComp not found");
    }

    #[test]
    fn nomes() {
        assert_eq!(super::slug("Meu Vídeo de Ação!"), "meu-video-de-acao");
        assert_eq!(super::slug("  --  "), "");
        assert!(super::project_dir_ok("abc") && !super::project_dir_ok("../x") && !super::project_dir_ok("a\\b"));
        assert_eq!(super::chrono_stamp().len(), 15);
    }
}

#[cfg(test)]
fn project_dir_ok(id: &str) -> bool {
    !(id.is_empty() || id.contains(['/', '\\', ':']) || id.starts_with('.'))
}
