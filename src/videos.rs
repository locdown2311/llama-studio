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
    /// Um empacotamento por projeto de cada vez: listar composições e renderizar usam o mesmo cache do
    /// rspack/webpack em node_modules/.cache, e dois processos ao mesmo tempo dão "State lock mismatch".
    bundling: Mutex<HashMap<String, std::sync::Arc<tokio::sync::Mutex<()>>>>,
}

/// Os ids da saída de "remotion compositions --quiet": a última linha com texto (antes dela pode vir um aviso,
/// como "Cached bundle. Subsequent renders will be faster." na primeira vez).
fn comp_ids(text: &str) -> Vec<String> {
    let line = text.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("");
    line.split_whitespace().filter(|w| w.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).map(str::to_string).collect()
}

/// O erro do teste em execução: quadro, mensagem e o primeiro arquivo do projeto na pilha (src/...:linha).
fn smoke_error(text: &str) -> Value {
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let frame = lines.iter().find_map(|l| l.split("rendering frame ").nth(1).and_then(|r| r.trim_end_matches(':').trim().parse::<u64>().ok()));
    let message = lines
        .iter()
        .find(|l| l.starts_with("Error") || l.contains(" Error ") || l.starts_with("TypeError") || l.starts_with("ReferenceError"))
        .map(|l| l.trim_start_matches("Error").trim().to_string())
        .unwrap_or_else(|| short_err(text));
    // "at src/scenes/Amigos.tsx:78" (o primeiro que não é do node_modules)
    let at = lines.iter().find_map(|l| {
        let i = l.find("src/")?;
        let rest = &l[i..];
        let end = rest.find(|c: char| c.is_whitespace() || c == ')').unwrap_or(rest.len());
        Some(rest[..end].to_string())
    });
    let scene = at.as_deref().and_then(|a| a.strip_prefix("src/scenes/")).and_then(|r| r.split(".tsx").next()).map(str::to_string);
    json!({ "ok": false, "frame": frame, "message": message.chars().take(400).collect::<String>(), "at": at, "scene": scene })
}

/// O cache do empacotador ficou preso por outro processo (ou por um que morreu no meio).
fn cache_race(s: &str) -> bool {
    s.contains("State lock mismatch") || s.contains("This indicates a race condition")
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
    /// o motivo da falha, em uma linha (o log fica para quem quiser os detalhes)
    err: String,
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
            .map(|(id, j)| json!({ "id": id, "kind": j.kind, "project": j.project, "done": j.done, "ok": j.ok, "progress": j.progress, "out": j.out, "err": j.err, "tail": tail(&j.log, 6) }))
            .collect();
        json!({
            "root": r, "node": node_version().await, "skills": skills_installed(app),
            "projects": projects.into_iter().map(|x| x.1).collect::<Vec<_>>(), "jobs": jobs, "studio": studio,
        })
    }

    pub fn job(&self, id: &str) -> Value {
        match self.jobs.lock().unwrap().get(id) {
            Some(j) => json!({ "kind": j.kind, "project": j.project, "done": j.done, "ok": j.ok, "progress": j.progress, "out": j.out, "err": j.err, "log": tail(&j.log, 80) }),
            None => json!({ "missing": true }),
        }
    }

    fn start_job(&self, kind: &'static str, project: &str) -> String {
        let id = format!("{kind}-{}-{}", project, now());
        self.jobs.lock().unwrap().insert(id.clone(), Job { kind, project: project.into(), log: String::new(), done: false, ok: false, progress: 0.0, out: String::new(), err: String::new(), started: now() });
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
        let lock = self.bundle_lock(id);
        tokio::spawn(async move {
            // espera a listagem de composições (ou outro render) do mesmo projeto terminar
            let _g = lock.lock().await;
            let progress = |line: &str| {
                // "Rendering frames ━━━━ 34/300" e "Encoding ... 34/300": a última fração da linha
                let frac = line.split_whitespace().rev().find_map(|w| {
                    let (a, b) = w.split_once('/')?;
                    let (a, b) = (a.parse::<f64>().ok()?, b.parse::<f64>().ok()?);
                    (b > 0.0 && a <= b).then_some(a / b)
                })?;
                let stage = if line.contains("ncod") || line.contains("titch") { 0.85 + frac * 0.15 } else { frac * 0.85 };
                Some(stage.min(1.0))
            };
            let mut ok = me.run(&job2, command(&npx(), &["--yes", "remotion", "render", &comp2, &file], &dir), progress).await;
            let raced = !ok && me.jobs.lock().unwrap().get(&job2).is_some_and(|j| cache_race(&j.log));
            if raced {
                me.with_job(&job2, |j| j.log.push_str(&L!("O cache do empacotador estava preso; renderizando de novo sem ele...\n", "The bundler cache was locked; rendering again without it...\n")));
                ok = me.run(&job2, command(&npx(), &["--yes", "remotion", "render", &comp2, &file, "--bundle-cache=false"], &dir), progress).await;
            }
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

    fn bundle_lock(&self, id: &str) -> std::sync::Arc<tokio::sync::Mutex<()>> {
        self.bundling.lock().unwrap().entry(id.to_string()).or_default().clone()
    }

    /// Lista as composições do projeto (ids), pelo CLI do Remotion.
    pub async fn compositions(&self, app: &App, id: &str) -> Result<Vec<String>, String> {
        let dir = project_dir(app, id).ok_or_else(|| L!("Projeto não encontrado.", "Project not found.").to_string())?;
        let lock = self.bundle_lock(id);
        let _g = lock.lock().await;
        let list = |no_cache: bool| {
            let mut args = vec!["--yes", "remotion", "compositions", "--quiet"];
            if no_cache {
                args.push("--bundle-cache=false");
            }
            let mut c = command(&npx(), &args, &dir);
            c.stdout(Stdio::piped());
            async move {
                tokio::time::timeout(Duration::from_secs(180), c.output())
                    .await
                    .map_err(|_| L!("O Remotion demorou demais para listar as composições.", "Remotion took too long to list the compositions.").to_string())?
                    .map_err(|e| e.to_string())
            }
        };
        let mut out = list(false).await?;
        let mut text = String::from_utf8_lossy(&out.stdout).to_string();
        // cache preso (um processo que morreu no meio deixa o lock): de novo, sem o cache
        if !out.status.success() && cache_race(&format!("{text}{}", String::from_utf8_lossy(&out.stderr))) {
            out = list(true).await?;
            text = String::from_utf8_lossy(&out.stdout).to_string();
        }
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(short_err(&format!("{text}\n{err}")));
        }
        Ok(comp_ids(&text))
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

    /// Teste em execução: renderiza cerca de um quadro por segundo da composição, em 10% do tamanho (um GIF
    /// descartável). Pega o que o tsc não vê: interpolate com faixa fora de ordem, undefined no meio do
    /// desenho, staticFile de arquivo que não existe... Devolve o quadro, a mensagem e o arquivo:linha.
    pub async fn smoke(&self, app: &App, id: &str, comp: &str) -> Result<Value, String> {
        let dir = project_dir(app, id).ok_or_else(|| L!("Projeto não encontrado.", "Project not found.").to_string())?;
        let comp = if comp.trim().is_empty() { "Video" } else { comp.trim() };
        if !comp.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err(L!("Composição inválida.", "Invalid composition.").into());
        }
        let work = dir.join(".studio");
        let _ = std::fs::create_dir_all(&work);
        let gif = work.join("smoke.gif");
        let g = gif.to_string_lossy().to_string();
        // um quadro por segundo (30 fps é o comum); vídeos longos: no máximo uns 150 quadros
        let nth = self.frames_hint(&dir).map(|(fps, total)| fps.max(total / 150).max(1)).unwrap_or(30).to_string();
        let lock = self.bundle_lock(id);
        let _g = lock.lock().await;
        let run = |no_cache: bool| {
            let mut args = vec!["--yes", "remotion", "render", comp, &g, "--codec=gif", "--every-nth-frame", &nth, "--scale=0.1", "--overwrite"];
            if no_cache {
                args.push("--bundle-cache=false");
            }
            let c = command(&npx(), &args, &dir);
            async move {
                tokio::time::timeout(Duration::from_secs(300), { let mut c = c; c.stdout(Stdio::piped()); c.output() })
                    .await
                    .map_err(|_| L!("O teste do vídeo demorou demais.", "The video test took too long.").to_string())?
                    .map_err(|e| e.to_string())
            }
        };
        let mut out = run(false).await?;
        let mut text = format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        if !out.status.success() && cache_race(&text) {
            out = run(true).await?;
            text = format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        }
        let _ = std::fs::remove_file(&gif);
        if out.status.success() {
            return Ok(json!({ "ok": true }));
        }
        Ok(smoke_error(&text))
    }

    /// Lista de edição (video_edit): confere, corta silêncios se pedido, grava src/edit/<Nome>.ts e o modelo de
    /// montagem, e registra a composição <Nome> no Root.tsx. Problemas na lista voltam em "errors".
    pub async fn edit(&self, app: &App, id: &str, name: &str, edl: Value) -> Result<Value, String> {
        use crate::videos_edl as ed;
        let dir = project_dir(app, id).ok_or_else(|| L!("Projeto não encontrado.", "Project not found.").to_string())?;
        let name = name.trim();
        let ok_name = name.chars().next().is_some_and(|c| c.is_ascii_uppercase()) && name.len() <= 40 && name.chars().all(|c| c.is_ascii_alphanumeric()) && name != "Video" && name != "EditVideo";
        if !ok_name {
            return Ok(json!({ "ok": false, "errors": [L!("name: use PascalCase só com letras e números (ex.: Corte1, ReactShorts), sem \"Video\".", "name: use PascalCase with letters and digits only (e.g. Cut1, ReactShorts), not \"Video\".")] }));
        }
        let e: ed::Edl = match serde_json::from_value(edl) {
            Ok(e) => e,
            Err(err) => return Ok(json!({ "ok": false, "errors": [format!("edl: {err}")] })),
        };
        // durações dos arquivos usados (ffprobe do Remotion)
        let comp = compositor(&dir);
        let mut srcs: Vec<String> = vec![];
        for c in &e.clips {
            srcs.push(ed::norm_src(&c.src));
            if let Some(cam) = &c.cam {
                srcs.push(ed::norm_src(&cam.src));
            }
        }
        if let Some(m) = &e.music {
            srcs.push(ed::norm_src(&m.src));
        }
        srcs.sort();
        srcs.dedup();
        let mut durs: HashMap<String, Option<f64>> = HashMap::new();
        for s in srcs {
            let p = dir.join("public").join(&s);
            if ed::safe_rel(&s) && p.is_file() {
                let d = match &comp {
                    Some(c) => duration_of(c, &p, &dir).await,
                    None => None,
                };
                durs.insert(s, d);
            }
        }
        let (e, cut) = match ed::prepare(e, &dir, &|s: &str| durs.get(s).copied()) {
            Ok(x) => x,
            Err(errors) => return Ok(json!({ "ok": false, "errors": errors })),
        };
        let edit_dir = dir.join("src").join("edit");
        std::fs::create_dir_all(&edit_dir).map_err(|e| e.to_string())?;
        std::fs::write(edit_dir.join("EditVideo.tsx"), ed::TEMPLATE).map_err(|e| e.to_string())?;
        std::fs::write(edit_dir.join(format!("{name}.ts")), ed::edl_file(&e)).map_err(|e| e.to_string())?;
        let root = dir.join("src").join("Root.tsx");
        let text = std::fs::read_to_string(&root).map_err(|e| LF!("Não consegui ler src/Root.tsx: {e}", "Could not read src/Root.tsx: {e}"))?;
        let wired = match ed::wire_root(&text, name) {
            Some(new) => {
                if new != text {
                    std::fs::write(&root, new).map_err(|e| e.to_string())?;
                }
                true
            }
            None => false,
        };
        let mut v = ed::summary(&e, cut);
        v["ok"] = json!(true);
        v["file"] = json!(format!("src/edit/{name}.ts"));
        v["wired"] = json!(wired);
        v["edl"] = serde_json::to_value(&e).unwrap_or_default();
        Ok(v)
    }

    /// Trechos falados e silêncios de um arquivo, pela legenda (public/captions/<nome>.json).
    pub fn speech(&self, app: &App, id: &str, file: &str, gap: f64, from: f64, to: f64, query: &str) -> Result<Value, String> {
        use crate::videos_edl as ed;
        let dir = project_dir(app, id).ok_or_else(|| L!("Projeto não encontrado.", "Project not found.").to_string())?;
        let src = match find_media(&dir, file) {
            Ok((_, rel)) => ed::norm_src(&rel),
            Err(_) => ed::norm_src(file),
        };
        let words = ed::words_of(&dir, &src).ok_or_else(|| LF!("public/{} ainda não tem legenda: gere com video_captions.", "public/{} has no captions yet: generate them with video_captions.", src))?;
        let end = if to > 0.0 { to } else { words.last().map(|w| w.end_ms / 1000.0 + 1.0).unwrap_or(0.0) };
        let gap = if gap > 0.05 { gap } else { 0.6 };
        // frase por frase (pausa, ~80 caracteres ou 6 s): dá para achar onde cada coisa é dita
        let lines = ed::phrases(&words, from.max(0.0), end, gap);
        let mut silences = vec![];
        let mut at = from.max(0.0);
        for (a, b, _) in &lines {
            if a - at >= gap {
                silences.push(json!({ "from": at, "to": a }));
            }
            at = *b;
        }
        if end - at >= gap {
            silences.push(json!({ "from": at, "to": end }));
        }
        let terms: Vec<String> = query.split(['|', ',']).map(|t| ed::fold(t.trim())).filter(|t| !t.is_empty()).collect();
        let hit = |t: &str| { let f = ed::fold(t); terms.iter().any(|q| f.contains(q.as_str())) };
        let segs: Vec<Value> = lines
            .iter()
            .filter(|(_, _, t)| terms.is_empty() || hit(t))
            .map(|(a, b, t)| json!({ "from": a, "to": b, "text": t.trim() }))
            .collect();
        Ok(json!({ "file": src, "duration": end, "query": query, "total": lines.len(), "segments": segs, "silences": silences }))
    }

    /// fps e duração (em quadros) da sequência gerada pelo video_scenes, se houver.
    fn frames_hint(&self, dir: &Path) -> Option<(u64, u64)> {
        let t = std::fs::read_to_string(dir.join("src").join("scenes").join("Video.tsx")).ok()?;
        let num = |k: &str| -> Option<u64> { let i = t.find(k)? + k.len(); t[i..].trim_start_matches([' ', ':']).split(|c: char| !c.is_ascii_digit()).next()?.parse().ok() };
        Some((num("fps")?, num("durationInFrames")?))
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
    fn nome_de_midia_seguro() {
        let d = std::env::temp_dir().join("ls-free-name-test");
        let _ = std::fs::create_dir_all(&d);
        assert_eq!(super::free_name(&d, "Minha gravação (final).mp4"), "Minha-gravacao-final.mp4");
        assert_eq!(super::free_name(&d, "../../fora.mp4"), "fora.mp4");
        std::fs::write(d.join("x.mp4"), b"").unwrap();
        assert_eq!(super::free_name(&d, "x.mp4"), "x-2.mp4");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn erro_das_legendas_resumido() {
        let log = "PROGRESS install 1\nFAIL model ENOTFOUND huggingface.co fetch failed\n";
        let e = super::captions_err(log, "small");
        assert!(e.contains("small") && e.contains("huggingface.co"), "{e}");
    }

    #[test]
    fn cache_preso() {
        assert!(super::cache_race("State lock mismatch in 'C:\\x\\.temp': expected current process (pid=28984), found 12468:node.exe. This indicates a race condition."));
        assert!(!super::cache_race("Error: Composition MyComp not found"));
    }

    #[test]
    fn ids_das_composicoes() {
        assert_eq!(super::comp_ids("⚡️ Cached bundle. Subsequent renders will be faster.\nMyComp Video\n"), ["MyComp", "Video"]);
        assert_eq!(super::comp_ids("MyComp Video\n\n"), ["MyComp", "Video"]);
    }

    #[test]
    fn erro_do_teste_em_execucao() {
        let out = "Rendered 6/35\nAn error occurred while rendering frame 180:\n Error  inputRange must be strictly monotonically increasing but got [1110,756,0]\nat ../x/node_modules/remotion/dist/esm/index.mjs:5051\nat interpolate (../x/node_modules/remotion/dist/esm/index.mjs:5119)\nat src/scenes/Amigos.tsx:78\n";
        let v = super::smoke_error(out);
        assert_eq!(v["frame"], 180);
        assert_eq!(v["scene"], "Amigos");
        assert_eq!(v["at"], "src/scenes/Amigos.tsx:78");
        assert!(v["message"].as_str().unwrap().starts_with("inputRange must be"), "{v}");
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

/* ------------------------------------------------------------ mídia do projeto (public/) */
// Vídeos, áudios e imagens que o usuário põe em public/ para o vídeo usar (staticFile). O studio tira quadros
// para o modelo ver (video_look) e gera legendas a partir do áudio com o Whisper (video_captions).

const MEDIA_VIDEO: &[&str] = &["mp4", "mov", "webm", "mkv", "m4v", "avi"];
const MEDIA_AUDIO: &[&str] = &["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"];
const MEDIA_IMAGE: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "svg"];
/// Versão do whisper.cpp que o Remotion baixa pronta no Windows.
const WHISPER_VERSION: &str = "1.5.5";
pub const WHISPER_MODELS: &[&str] = &["base", "small", "medium", "large-v3-turbo"];

fn media_kind(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    if MEDIA_VIDEO.contains(&ext.as_str()) {
        "video"
    } else if MEDIA_AUDIO.contains(&ext.as_str()) {
        "audio"
    } else if MEDIA_IMAGE.contains(&ext.as_str()) {
        "image"
    } else {
        "other"
    }
}

/// Caminho relativo ao projeto, sem sair dele (public/x.mp4, out/y.mp4).
fn inside(dir: &Path, rel: &str) -> Option<PathBuf> {
    let rel = rel.trim().replace('\\', "/");
    if rel.is_empty() || rel.starts_with('/') || rel.contains(':') || rel.split('/').any(|p| p == ".." || p.is_empty()) {
        return None;
    }
    let p = dir.join(&rel);
    p.is_file().then_some(p)
}

/// Acha o arquivo que o modelo quis dizer: o caminho exato; sem pasta, em public/ ou out/; e, para renders,
/// o mais recente que começa com o nome ("out/CorteDoVideo.mp4" ou "CorteDoVideo" = out/CorteDoVideo-<data>.mp4).
/// Devolve o caminho e o nome relativo ao projeto, ou um erro com os arquivos que existem.
fn find_media(dir: &Path, rel: &str) -> Result<(PathBuf, String), String> {
    let rel = rel.trim().replace('\\', "/").trim_start_matches("./").to_string();
    let rel_of = |p: &Path| p.strip_prefix(dir).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
    if let Some(p) = inside(dir, &rel) {
        return Ok((p, rel));
    }
    let name = rel.rsplit('/').next().unwrap_or(&rel).to_string();
    let stem = name.rsplit_once('.').map(|(a, _)| a.to_string()).unwrap_or(name.clone()).to_lowercase();
    let mut cands: Vec<(u64, PathBuf)> = vec![];
    for sub in ["public", "out"] {
        if let Some(p) = inside(dir, &format!("{sub}/{name}")) {
            return Ok((p.clone(), rel_of(&p)));
        }
        if stem.is_empty() || !crate::videos_edl::safe_rel(&name) {
            continue;
        }
        for e in std::fs::read_dir(dir.join(sub)).into_iter().flatten().flatten() {
            let n = e.file_name().to_string_lossy().to_lowercase();
            if n.starts_with(&stem) && !matches!(media_kind(&n), "other" | "image") {
                let t = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
                cands.push((t, e.path()));
            }
        }
    }
    cands.sort_by(|a, b| b.0.cmp(&a.0));
    if let Some((_, p)) = cands.into_iter().next() {
        return Ok((p.clone(), rel_of(&p)));
    }
    let mut have: Vec<String> = vec![];
    for sub in ["public", "out"] {
        for e in std::fs::read_dir(dir.join(sub)).into_iter().flatten().flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if !n.starts_with('.') && matches!(media_kind(&n), "video" | "audio") {
                have.push(format!("{sub}/{n}"));
            }
        }
    }
    have.sort();
    Err(LF!("Arquivo não encontrado no projeto: {}. Existem: {}", "File not found in the project: {}. Available: {}", rel, if have.is_empty() { "-".into() } else { have.into_iter().take(15).collect::<Vec<_>>().join(", ") }))
}

/// Pasta do ffmpeg que vem com o Remotion (node_modules/@remotion/compositor-<plataforma>). Pode haver mais de
/// uma (no Linux, gnu e musl): fica a deste sistema e arquitetura, e no Linux a gnu.
fn compositor(dir: &Path) -> Option<PathBuf> {
    let exe = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let os = match std::env::consts::OS { "windows" => "win32", "macos" => "darwin", o => o };
    let arch = match std::env::consts::ARCH { "x86_64" => "x64", "aarch64" => "arm64", a => a };
    let want = format!("compositor-{os}-{arch}");
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir.join("node_modules").join("@remotion"))
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(&want)) && p.join(exe).is_file())
        .collect();
    found.sort_by_key(|p| !p.to_string_lossy().ends_with("-gnu") as u8);
    found.into_iter().next()
}

/// ffmpeg/ffprobe do Remotion, com as bibliotecas dele no caminho.
fn ff(comp: &Path, bin: &str, args: &[&str], cwd: &Path) -> tokio::process::Command {
    let exe = comp.join(if cfg!(windows) { format!("{bin}.exe") } else { bin.to_string() });
    let mut c = command(&exe, args, cwd);
    let lib = comp.to_string_lossy().to_string();
    c.env("LD_LIBRARY_PATH", &lib).env("DYLD_LIBRARY_PATH", &lib);
    c
}

/// Duração em segundos (ffprobe).
async fn duration_of(comp: &Path, file: &Path, cwd: &Path) -> Option<f64> {
    let f = file.to_string_lossy().to_string();
    let mut c = ff(comp, "ffprobe", &["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", &f], cwd);
    let out = tokio::time::timeout(Duration::from_secs(20), c.output()).await.ok()?.ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse::<f64>().ok().filter(|d| d.is_finite() && *d > 0.0)
}

fn captions_path(dir: &Path, rel: &str) -> PathBuf {
    let stem = Path::new(rel).file_stem().and_then(|s| s.to_str()).unwrap_or("audio");
    dir.join("public").join("captions").join(format!("{stem}.json"))
}

/// Nome de arquivo seguro, sem sobrescrever o que já existe (nome-2.mp4...).
fn free_name(dir: &Path, name: &str) -> String {
    // sem acentos nem espaços: o caminho vai para staticFile() e para o modelo digitar
    let fold = |c: char| match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
        'Á' | 'À' | 'Â' | 'Ã' | 'Ä' => 'A',
        'é' | 'ê' | 'è' | 'ë' => 'e',
        'É' | 'Ê' | 'È' | 'Ë' => 'E',
        'í' | 'ì' | 'î' | 'ï' => 'i',
        'Í' | 'Ì' | 'Î' | 'Ï' => 'I',
        'ó' | 'ô' | 'õ' | 'ò' | 'ö' => 'o',
        'Ó' | 'Ô' | 'Õ' | 'Ò' | 'Ö' => 'O',
        'ú' | 'ù' | 'û' | 'ü' => 'u',
        'Ú' | 'Ù' | 'Û' | 'Ü' => 'U',
        'ç' => 'c',
        'Ç' => 'C',
        c if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') => c,
        _ => '-',
    };
    let mut base = String::new();
    for c in name.rsplit(['/', '\\']).next().unwrap_or(name).chars().map(fold) {
        if !(c == '-' && base.ends_with('-')) {
            base.push(c);
        }
    }
    let base = base.replace("-.", ".").trim_matches(['.', '-']).to_string();
    let base = if base.is_empty() { "arquivo".to_string() } else { base };
    if !dir.join(&base).exists() {
        return base;
    }
    let (stem, ext) = base.rsplit_once('.').map(|(a, b)| (a.to_string(), format!(".{b}"))).unwrap_or((base.clone(), String::new()));
    (2..1000).map(|i| format!("{stem}-{i}{ext}")).find(|n| !dir.join(n).exists()).unwrap_or(base)
}

impl Videos {
    /// Arquivos de public/ (até 2 níveis), com duração dos vídeos e áudios e se já há legenda.
    pub async fn media(&self, app: &App, id: &str) -> Result<Value, String> {
        let dir = project_dir(app, id).ok_or_else(|| L!("Projeto não encontrado.", "Project not found.").to_string())?;
        let comp = compositor(&dir);
        let mut files = vec![];
        let mut stack = vec![(dir.join("public"), 0)];
        while let Some((d, depth)) = stack.pop() {
            let Ok(rd) = std::fs::read_dir(&d) else { continue };
            for e in rd.flatten() {
                let p = e.path();
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                if p.is_dir() {
                    if depth < 1 && name != "captions" {
                        stack.push((p, depth + 1));
                    }
                    continue;
                }
                let rel = p.strip_prefix(&dir).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
                files.push((rel, p));
            }
        }
        files.sort();
        let mut out = vec![];
        for (rel, p) in files.into_iter().take(60) {
            let kind = media_kind(&rel);
            let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            let dur = match (&comp, kind) {
                (Some(c), "video" | "audio") => duration_of(c, &p, &dir).await,
                _ => None,
            };
            let cap = captions_path(&dir, &rel);
            out.push(json!({ "file": rel, "kind": kind, "size": size, "duration": dur,
                "captions": cap.is_file().then(|| cap.strip_prefix(&dir).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default()) }));
        }
        let whisper = app.root.join("whisper").join("whisper.cpp");
        Ok(json!({ "files": out, "ffmpeg": comp.is_some(), "whisperModels": WHISPER_MODELS, "whisperInstalled": whisper.is_dir(),
            "models": WHISPER_MODELS.iter().filter(|m| std::fs::metadata(whisper.join(format!("ggml-{m}.bin"))).is_ok_and(|md| md.len() > 10 * 1024 * 1024)).collect::<Vec<_>>() }))
    }

    /// Grava um arquivo enviado em public/ (sem sobrescrever). Devolve o caminho relativo.
    pub async fn upload(&self, app: &App, id: &str, name: &str, body: axum::body::Body) -> Result<Value, String> {
        use futures_util::StreamExt;
        use tokio::io::AsyncWriteExt;
        let dir = project_dir(app, id).ok_or_else(|| L!("Projeto não encontrado.", "Project not found.").to_string())?;
        let public = dir.join("public");
        std::fs::create_dir_all(&public).map_err(|e| e.to_string())?;
        let fname = free_name(&public, name);
        let path = public.join(&fname);
        let tmp = public.join(format!(".{fname}.part"));
        let mut f = tokio::fs::File::create(&tmp).await.map_err(|e| e.to_string())?;
        let mut stream = body.into_data_stream();
        let mut total = 0u64;
        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(c) => c,
                Err(e) => {
                    let _ = tokio::fs::remove_file(&tmp).await;
                    return Err(e.to_string());
                }
            };
            total += chunk.len() as u64;
            if let Err(e) = f.write_all(&chunk).await {
                let _ = tokio::fs::remove_file(&tmp).await;
                return Err(e.to_string());
            }
        }
        f.flush().await.map_err(|e| e.to_string())?;
        drop(f);
        tokio::fs::rename(&tmp, &path).await.map_err(|e| e.to_string())?;
        Ok(json!({ "file": format!("public/{fname}"), "size": total }))
    }

    /// Quadros de um vídeo nos instantes pedidos (JPEG 480px, em data URL), para o modelo ver.
    /// Sem `times`: `count` quadros espaçados entre `from` e `to` (segundos; `to` 0 = fim do vídeo).
    pub async fn frames(&self, app: &App, id: &str, file: &str, times: &[f64], count: usize, from: f64, to: f64, width: u32) -> Result<Value, String> {
        let dir = project_dir(app, id).ok_or_else(|| L!("Projeto não encontrado.", "Project not found.").to_string())?;
        let (path, file) = find_media(&dir, file)?;
        let file = file.as_str();
        let comp = compositor(&dir).ok_or_else(|| L!("O ffmpeg do Remotion não está no projeto (rode npm install na pasta dele).", "Remotion's ffmpeg is not in the project (run npm install in its folder).").to_string())?;
        let dur = duration_of(&comp, &path, &dir).await;
        let spaced;
        let times = if times.is_empty() {
            let end = if to > 0.0 { to } else { dur.unwrap_or(10.0) };
            let start = from.clamp(0.0, end);
            let n = count.clamp(1, 36);
            // o meio de cada fatia: não pega o quadro preto do começo nem o último
            spaced = (0..n).map(|i| start + (end - start) * (i as f64 + 0.5) / n as f64).collect::<Vec<_>>();
            &spaced[..]
        } else {
            times
        };
        let p = path.to_string_lossy().to_string();
        let scale = format!("scale={}:-2", width.clamp(160, 1280));
        let mut frames = vec![];
        // 4 de cada vez: cada um é um ffmpeg curto (busca direto no instante, decodifica um quadro)
        for chunk in times.chunks(4) {
            let jobs = chunk.iter().map(|&t| {
                let t = dur.map(|d| t.min((d - 0.05).max(0.0))).unwrap_or(t).max(0.0);
                let ts = format!("{t:.3}");
                let mut c = ff(&comp, "ffmpeg", &["-v", "error", "-ss", &ts, "-i", &p, "-frames:v", "1", "-vf", &scale, "-c:v", "mjpeg", "-q:v", "6", "-f", "image2pipe", "-"], &dir);
                c.stdout(Stdio::piped());
                async move { (t, tokio::time::timeout(Duration::from_secs(30), c.output()).await) }
            });
            for (t, r) in futures_util::future::join_all(jobs).await {
                if let Ok(Ok(out)) = r {
                    if out.status.success() && !out.stdout.is_empty() {
                        use base64::Engine;
                        frames.push(json!({ "t": t, "data": format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(&out.stdout)) }));
                    }
                }
            }
        }
        if frames.is_empty() {
            return Err(L!("Não consegui tirar quadros desse arquivo (é um vídeo?).", "Could not grab frames from that file (is it a video?).").into());
        }
        Ok(json!({ "file": file, "duration": dur, "frames": frames }))
    }

    /// Legendas do áudio de um vídeo ou áudio do projeto, com o Whisper (whisper.cpp pelo Remotion). Gera
    /// public/captions/<nome>.json (Caption[] do @remotion/captions) e .srt. Trabalho em segundo plano.
    pub fn captions(self: &std::sync::Arc<Self>, app: std::sync::Arc<App>, id: &str, file: &str, model: &str, lang: &str) -> Result<Value, String> {
        let dir = project_dir(&app, id).ok_or_else(|| L!("Projeto não encontrado.", "Project not found.").to_string())?;
        let (src, file) = find_media(&dir, file)?;
        let file = file.as_str();
        if !matches!(media_kind(file), "video" | "audio") {
            return Err(L!("Escolha um vídeo ou áudio.", "Choose a video or audio file.").into());
        }
        let comp = compositor(&dir).ok_or_else(|| L!("O ffmpeg do Remotion não está no projeto (rode npm install na pasta dele).", "Remotion's ffmpeg is not in the project (run npm install in its folder).").to_string())?;
        let model = if WHISPER_MODELS.contains(&model) { model.to_string() } else { "small".to_string() };
        let lang: String = lang.chars().filter(|c| c.is_ascii_alphabetic()).take(5).collect::<String>().to_lowercase();
        if self.jobs.lock().unwrap().values().any(|j| j.kind == "captions" && !j.done) {
            return Err(L!("Já há uma legenda sendo gerada; espere terminar.", "Captions are already being generated; wait for them to finish.").into());
        }
        let out_json = captions_path(&dir, file);
        let rel_out = out_json.strip_prefix(&dir).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        let job = self.start_job("captions", id);
        self.with_job(&job, |j| j.out = rel_out.clone());
        let me = self.clone();
        let job2 = job.clone();
        tokio::spawn(async move {
            let ok = me.captions_run(&app, &job2, &dir, &comp, &src, &out_json, &model, &lang).await;
            me.with_job(&job2, |j| {
                j.done = true;
                j.ok = ok;
                if !ok && j.err.is_empty() {
                    j.err = captions_err(&j.log, &model);
                }
                if ok {
                    j.progress = 1.0;
                }
            });
        });
        Ok(json!({ "job": job, "out": rel_out }))
    }

    #[allow(clippy::too_many_arguments)]
    async fn captions_run(&self, app: &App, job: &str, dir: &Path, comp: &Path, src: &Path, out_json: &Path, model: &str, lang: &str) -> bool {
        let say = |m: String| self.with_job(job, |j| j.log.push_str(&(m + "\n")));
        // 1) o pacote do Remotion para o Whisper, na mesma versão do projeto
        if !dir.join("node_modules").join("@remotion").join("install-whisper-cpp").is_dir() {
            let ver = std::fs::read_to_string(dir.join("package.json"))
                .ok()
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                .and_then(|v| v["dependencies"]["remotion"].as_str().map(|s| s.trim_start_matches(['^', '~']).to_string()))
                .unwrap_or_else(|| "latest".into());
            say(LF!("Instalando @remotion/install-whisper-cpp@{}...", "Installing @remotion/install-whisper-cpp@{}...", ver));
            let npm = crate::bins::which("npm").unwrap_or_else(|| PathBuf::from("npm"));
            let pkg = format!("@remotion/install-whisper-cpp@{ver}");
            let cap = format!("@remotion/captions@{ver}");
            if !self.run(job, command(&npm, &["install", "--no-audit", "--no-fund", &pkg, &cap], dir), |_| None).await {
                say(L!("Não consegui instalar o pacote do Whisper.", "Could not install the Whisper package.").into());
                return false;
            }
        }
        // 2) o áudio em WAV 16 kHz mono (o que o whisper.cpp lê)
        let work = dir.join(".studio");
        let _ = std::fs::create_dir_all(&work);
        let wav = work.join("audio-16k.wav");
        say(L!("Extraindo o áudio...", "Extracting the audio...").into());
        self.with_job(job, |j| j.progress = 0.03);
        let (s, w) = (src.to_string_lossy().to_string(), wav.to_string_lossy().to_string());
        if !self.run(job, ff(comp, "ffmpeg", &["-v", "error", "-y", "-i", &s, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", &w], dir), |_| None).await {
            say(L!("Não consegui extrair o áudio (o arquivo tem som?).", "Could not extract the audio (does the file have sound?).").into());
            return false;
        }
        // 3) whisper.cpp + modelo (compartilhados entre os projetos) e a transcrição, por um script no projeto
        let wdir = app.root.join("whisper");
        let _ = std::fs::create_dir_all(&wdir);
        let script = work.join("legendas.mjs");
        if std::fs::write(&script, CAPTIONS_SCRIPT).is_err() {
            return false;
        }
        let node = crate::bins::which("node").unwrap_or_else(|| PathBuf::from("node"));
        let srt = out_json.with_extension("srt");
        let args = [script.to_string_lossy().to_string(), w, wdir.join("whisper.cpp").to_string_lossy().to_string(), model.to_string(), lang.to_string(), out_json.to_string_lossy().to_string(), srt.to_string_lossy().to_string(), WHISPER_VERSION.to_string()];
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        // etapas: instalar (até 10%), baixar o modelo (até 40%), transcrever (até 100%)
        let ok = self
            .run(job, command(&node, &args, dir), |l| {
                let rest = l.strip_prefix("PROGRESS ")?;
                let (stage, v) = rest.split_once(' ')?;
                let v: f64 = v.trim().parse().ok()?;
                Some(match stage {
                    "model" => 0.1 + 0.3 * v.clamp(0.0, 1.0),
                    "transcribe" => 0.4 + 0.6 * v.clamp(0.0, 1.0),
                    _ => 0.05 + 0.05 * v.clamp(0.0, 1.0),
                })
            })
            .await;
        let _ = std::fs::remove_file(&wav);
        ok && out_json.is_file()
    }
}

/// Por que as legendas falharam, em uma linha.
fn captions_err(log: &str, model: &str) -> String {
    if let Some(l) = log.lines().rev().find(|l| l.starts_with("FAIL model")) {
        let host = if l.contains("huggingface") { "huggingface.co" } else { "a internet" };
        return LF!("Não consegui baixar o modelo de fala {} de {}: confira a internet (ou se a rede bloqueia o site) e tente de novo.", "Could not download the {} speech model from {}: check the internet connection (or whether the network blocks the site) and try again.", model, host);
    }
    if log.contains("remotion-ffmpeg-binaries") || log.contains("whisper-bin-x64") || log.contains("git clone") && log.contains("fatal") {
        return L!("Não consegui baixar o Whisper: confira a internet e tente de novo.", "Could not download Whisper: check the internet connection and try again.").into();
    }
    if log.contains("Error while executing make") {
        return L!("A compilação do Whisper falhou (precisa de make e de um compilador C++).", "Building Whisper failed (it needs make and a C++ compiler).").into();
    }
    short_err(log)
}

/// Roda dentro do projeto (o import acha o pacote no node_modules dele).
/// Argumentos: wav, pasta do whisper.cpp, modelo, idioma (vazio = detectar), saída .json, saída .srt, versão.
const CAPTIONS_SCRIPT: &str = r#"import { installWhisperCpp, downloadWhisperModel, transcribe, toCaptions } from '@remotion/install-whisper-cpp';
import fs from 'node:fs';
import path from 'node:path';

const [wav, to, model, lang, outJson, outSrt, version] = process.argv.slice(2);
console.log('PROGRESS install 0');
try { await installWhisperCpp({ to, version, printOutput: true }); }
catch (e) {
  // instalação anterior pela metade (pasta sem o executável): apaga e instala de novo
  if (!/exists but the executable/.test(String(e.message))) throw e;
  fs.rmSync(to, { recursive: true, force: true });
  await installWhisperCpp({ to, version, printOutput: true });
}
console.log('PROGRESS install 1');
// modelo de um download interrompido: o pacote acharia que já está baixado
const modelFile = path.join(to, `ggml-${model}.bin`);
try { if (fs.statSync(modelFile).size < 10 * 1024 * 1024) fs.rmSync(modelFile); } catch { /* não existe */ }
try {
  await downloadWhisperModel({ model, folder: to, printOutput: false, onProgress: (d, t) => { if (t) console.log('PROGRESS model ' + (d / t).toFixed(3)); } });
} catch (e) {
  fs.rmSync(modelFile, { force: true });
  console.log('FAIL model ' + (e.cause?.code || '') + ' ' + (e.cause?.hostname || '') + ' ' + e.message);
  process.exit(3);
}
console.log('PROGRESS model 1');
const out = await transcribe({ inputPath: wav, whisperPath: to, whisperCppVersion: version, model, tokenLevelTimestamps: true, language: lang || null, printOutput: false, splitOnWord: true, onProgress: (p) => console.log('PROGRESS transcribe ' + Number(p).toFixed(3)) });
const { captions } = toCaptions({ whisperCppOutput: out });
fs.mkdirSync(path.dirname(outJson), { recursive: true });
fs.writeFileSync(outJson, JSON.stringify(captions, null, 1));
// SRT: junta as palavras em linhas de até ~42 caracteres ou 3,5 s
const ts = (ms) => { const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, r = Math.floor(ms % 1000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`; };
const lines = []; let cur = null;
for (const c of captions) {
  const text = c.text;
  if (!cur || (cur.text + text).trim().length > 42 || c.endMs - cur.startMs > 3500) { if (cur) lines.push(cur); cur = { startMs: c.startMs, endMs: c.endMs, text: text.trimStart() }; }
  else { cur.text += text; cur.endMs = c.endMs; }
}
if (cur) lines.push(cur);
fs.writeFileSync(outSrt, lines.map((l, i) => `${i + 1}\n${ts(l.startMs)} --> ${ts(l.endMs)}\n${l.text.trim()}\n`).join('\n'));
console.log('DONE ' + captions.length + ' ' + (out.result?.language || ''));
"#;
