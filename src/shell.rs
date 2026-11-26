//! Executa comandos (PowerShell no Windows, sh no resto) dentro da pasta de trabalho.

use serde_json::{json, Value};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

/* ---- processos em andamento ----
   Cada comando das ferramentas fica registrado com o dono (a conversa que pediu). O Parar do studio encerra a
   árvore inteira desses processos: só matar o shell deixava o python/cargo/ffmpeg que ele abriu rodando. A árvore
   também é encerrada quando o comando estoura o tempo ou quando a resposta é abandonada (o pedido HTTP cai). */

tokio::task_local! {
    /// Quem pediu o comando (id da conversa); vem do /api/tools/call.
    pub static OWNER: String;
}

struct Proc {
    pid: u32,
    owner: String,
    /// Linux isolado: o nome da distro (para encerrar lá dentro também).
    distro: Option<String>,
}
static PROCS: Mutex<Vec<Proc>> = Mutex::new(Vec::new());

/// Registra um processo; ao sair de escopo sem `done()`, encerra a árvore dele.
pub struct Guard {
    pid: u32,
    done: bool,
}
impl Guard {
    pub fn new(pid: Option<u32>, distro: Option<&str>) -> Guard {
        let pid = pid.unwrap_or(0);
        if pid != 0 {
            let owner = OWNER.try_with(|o| o.clone()).unwrap_or_default();
            PROCS.lock().unwrap().push(Proc { pid, owner, distro: distro.map(str::to_string) });
        }
        Guard { pid, done: false }
    }
    pub fn done(&mut self) {
        self.done = true;
    }
}
impl Drop for Guard {
    fn drop(&mut self) {
        if self.pid == 0 {
            return;
        }
        let me = {
            let mut v = PROCS.lock().unwrap();
            let i = v.iter().position(|p| p.pid == self.pid);
            i.map(|i| v.remove(i))
        };
        if !self.done {
            if let Some(p) = me {
                kill(&p);
            }
        }
    }
}

/// Encerra o processo e tudo que ele abriu.
fn kill(p: &Proc) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill").args(["/PID", &p.pid.to_string(), "/T", "/F"]).creation_flags(crate::CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn();
    }
    #[cfg(not(windows))]
    {
        // o comando roda num grupo próprio: -pid acerta o grupo inteiro
        let _ = std::process::Command::new("kill").args(["-9", "--", &format!("-{}", p.pid)]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status();
        let _ = std::process::Command::new("kill").args(["-9", &p.pid.to_string()]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status();
    }
    if let Some(d) = &p.distro {
        // no Linux isolado o processo de verdade está lá dentro: encerra tudo que roda na distro da pasta
        let mut c = std::process::Command::new("wsl.exe");
        c.args(["-d", d, "-u", "root", "-e", "sh", "-c", "kill -9 -1 2>/dev/null; true"]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(crate::CREATE_NO_WINDOW);
        }
        let _ = c.spawn();
    }
}

/// O Parar: encerra os comandos de um dono (ou todos, com owner vazio). Devolve quantos.
pub fn stop(owner: &str) -> usize {
    let list: Vec<Proc> = {
        let mut v = PROCS.lock().unwrap();
        let (mine, rest): (Vec<Proc>, Vec<Proc>) = v.drain(..).partition(|p| owner.is_empty() || p.owner == owner);
        *v = rest;
        mine
    };
    for p in &list {
        kill(p);
    }
    list.len()
}

/// A pasta onde o comando roda (relativa à pasta de trabalho).
fn work_dir(ws: &Path, cwd: &str) -> Result<PathBuf, String> {
    let dir = crate::app::resolve(ws, if cwd.is_empty() { "." } else { cwd });
    if !dir.is_dir() {
        return Err(LF!("Pasta não encontrada: {}", "Folder not found: {}", dir.display()));
    }
    Ok(dir)
}

/// Monta o comando do shell já com a pasta, o ambiente e os tubos.
fn command_for(dir: &Path, command: &str) -> tokio::process::Command {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = tokio::process::Command::new("powershell.exe");
        let script = format!(
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; {command}"
        );
        c.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script]);
        c.creation_flags(crate::CREATE_NO_WINDOW);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = tokio::process::Command::new("sh");
        c.args(["-c", command]);
        c
    };
    cmd.env("PATH", crate::bins::path_env());
    cmd.current_dir(dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    cmd
}

pub async fn run(ws: &Path, command: &str, cwd: &str, timeout_s: u64) -> Result<String, String> {
    if command.trim().is_empty() {
        return Err("Comando vazio.".into());
    }
    let dir = work_dir(ws, cwd)?;
    let mut cmd = command_for(&dir, command);
    let t0 = Instant::now();
    let mut child = cmd.spawn().map_err(|e| LF!("Não consegui iniciar o shell: {e}", "Could not start the shell: {e}"))?;
    let mut guard = Guard::new(child.id(), None);
    let mut out = child.stdout.take().unwrap();
    let mut err = child.stderr.take().unwrap();
    let read_out = async {
        let mut b = Vec::new();
        let _ = out.read_to_end(&mut b).await;
        b
    };
    let read_err = async {
        let mut b = Vec::new();
        let _ = err.read_to_end(&mut b).await;
        b
    };
    let limit = Duration::from_secs(timeout_s.clamp(1, 1800));
    let res = tokio::time::timeout(limit, async {
        let (o, e, st) = tokio::join!(read_out, read_err, child.wait());
        (o, e, st)
    })
    .await;
    match res {
        Ok((o, e, st)) => {
            guard.done();
            let code = st.ok().and_then(|s| s.code());
            let mut text = String::from_utf8_lossy(&o).trim_end().to_string();
            let e = String::from_utf8_lossy(&e).trim_end().to_string();
            if !e.is_empty() {
                if !text.is_empty() {
                    text.push_str("\n");
                }
                text.push_str("[stderr]\n");
                text.push_str(&e);
            }
            if text.is_empty() {
                text = L!("(sem saída)", "(no output)").into();
            }
            Ok(LF!("[código de saída {} em {:.1}s, pasta {}]\n{}", "[exit code {} in {:.1}s, folder {}]\n{}", code.map(|c| c.to_string()).unwrap_or("?".into()), t0.elapsed().as_secs_f32(), dir.display(), text))
        }
        Err(_) => Err(format!("Tempo esgotado ({}s). O comando foi encerrado.", limit.as_secs())),
    }
}
/* ---- jobs de shell ----
   Um comando pode rodar em segundo plano: fica registrado com id, estado e as últimas linhas da saída, e o
   modelo acompanha com job_output/job_kill. A saída é limitada (o job não cresce sem fim) e o Parar da
   conversa continua encerrando tudo (o processo está em PROCS como os demais). */

const JOB_LINES: usize = 600;

struct Job {
    id: String,
    pid: u32,
    owner: String,
    cmd: String,
    dir: PathBuf,
    started: Instant,
    /// 0 rodando, 1 terminou, 2 erro, 3 encerrado
    state: AtomicU8,
    code: Mutex<Option<i32>>,
    out: Mutex<VecDeque<String>>,
}
static JOBS: Mutex<Vec<Arc<Job>>> = Mutex::new(Vec::new());

fn job_state(j: &Job) -> &'static str {
    match j.state.load(Ordering::SeqCst) {
        0 => "running",
        1 => "done",
        2 => "error",
        _ => "killed",
    }
}

fn job_json(j: &Job) -> Value {
    let lines = j.out.lock().unwrap().len();
    json!({
        "id": j.id,
        "owner": j.owner,
        "cmd": j.cmd.chars().take(200).collect::<String>(),
        "dir": j.dir.to_string_lossy(),
        "state": job_state(j),
        "code": *j.code.lock().unwrap(),
        "ms": j.started.elapsed().as_millis() as u64,
        "lines": lines,
    })
}

fn job_find(id: &str) -> Option<Arc<Job>> {
    JOBS.lock().unwrap().iter().find(|j| j.id == id).cloned()
}

fn push_line(out: &Mutex<VecDeque<String>>, line: String) {
    let mut q = out.lock().unwrap();
    q.push_back(line);
    while q.len() > JOB_LINES {
        q.pop_front();
    }
}

/// As últimas `tail` linhas da saída de um job.
pub fn job_output(id: &str, tail: usize) -> Result<Value, String> {
    let j = job_find(id).ok_or_else(|| L!("Job não encontrado (já saiu da lista).", "Job not found (it left the list).").to_string())?;
    // o lock de `out` fica só aqui: job_json também o pega (Mutex não é reentrante)
    let (text, start, total) = {
        let out = j.out.lock().unwrap();
        let n = tail.clamp(1, JOB_LINES);
        let start = out.len().saturating_sub(n);
        (out.iter().skip(start).cloned().collect::<Vec<_>>().join("\n"), start, out.len())
    };
    let mut v = job_json(&j);
    v["out"] = json!(text);
    v["from"] = json!(start);
    v["total"] = json!(total);
    Ok(v)
}

/// Jobs de uma conversa (ou todos, com owner vazio), do mais novo para o mais antigo.
pub fn job_list(owner: &str) -> Vec<Value> {
    let v = JOBS.lock().unwrap();
    v.iter().rev().filter(|j| owner.is_empty() || j.owner == owner).map(|j| job_json(j)).collect()
}

/// Encerra um job em segundo plano pelo id (a árvore inteira, como o Parar).
pub fn job_kill(id: &str) -> Result<Value, String> {
    let j = job_find(id).ok_or_else(|| L!("Job não encontrado.", "Job not found.").to_string())?;
    if j.state.load(Ordering::SeqCst) == 0 {
        kill(&Proc { pid: j.pid, owner: j.owner.clone(), distro: None });
        j.state.store(3, Ordering::SeqCst);
    }
    Ok(job_json(&j))
}

/// Roda o comando em segundo plano e devolve o id do job na hora.
pub fn start(ws: &Path, command: &str, cwd: &str) -> Result<String, String> {
    if command.trim().is_empty() {
        return Err("Comando vazio.".into());
    }
    let dir = work_dir(ws, cwd)?;
    let mut cmd = command_for(&dir, command);
    cmd.kill_on_drop(false);
    let mut child = cmd.spawn().map_err(|e| LF!("Não consegui iniciar o shell: {e}", "Could not start the shell: {e}"))?;
    let pid = child.id().unwrap_or(0);
    let job = Arc::new(Job {
        id: format!("j{}", crate::app::now_ms()),
        pid,
        owner: OWNER.try_with(|o| o.clone()).unwrap_or_default(),
        cmd: command.to_string(),
        dir,
        started: Instant::now(),
        state: AtomicU8::new(0),
        code: Mutex::new(None),
        out: Mutex::new(VecDeque::new()),
    });
    {
        let mut v = JOBS.lock().unwrap();
        v.push(job.clone());
        // o histórico não cresce sem fim: os 40 mais recentes bastam
        let keep = v.len().saturating_sub(40);
        v.drain(..keep);
    }
    // o job segura o próprio processo até terminar; o Parar da conversa continua valendo (está em PROCS)
    let job_task = job.clone();
    let spawned = tokio::runtime::Handle::try_current().map(|h| h.spawn(async move {
        let mut guard = Guard::new(Some(pid), None);
        let mut o = BufReader::new(child.stdout.take().unwrap()).lines();
        let mut e = BufReader::new(child.stderr.take().unwrap()).lines();
        let read_out = async {
            while let Ok(Some(l)) = o.next_line().await {
                push_line(&job_task.out, l);
            }
        };
        let read_err = async {
            while let Ok(Some(l)) = e.next_line().await {
                push_line(&job_task.out, format!("[stderr] {l}"));
            }
        };
        let (_, _, st) = tokio::join!(read_out, read_err, child.wait());
        guard.done();
        *job_task.code.lock().unwrap() = st.ok().and_then(|s| s.code());
        // encerrado pelo job_kill: o estado já é 3, não sobrescreve
        if job_task.state.load(Ordering::SeqCst) == 0 {
            let ok = job_task.code.lock().unwrap().map(|c| c == 0).unwrap_or(true);
            job_task.state.store(if ok { 1 } else { 2 }, Ordering::SeqCst);
        }
    }));
    match spawned {
        Ok(_) => {}
        // sem runtime (teste síncrono): o processo não pode ficar órfão nem travar o chamador
        Err(_) => {
            kill(&Proc { pid, owner: job.owner.clone(), distro: None });
            job.state.store(3, Ordering::SeqCst);
        }
    }
    Ok(job.id.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    // runtime próprio e desligamento com prazo: o job que não terminou não pendura o teste
    fn rt() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap()
    }

    #[test]
    fn job_roda_e_mostra_a_saida() {
        let rt = rt();
        rt.block_on(async {
            let ws = std::env::temp_dir();
            let id = start(&ws, "echo ola-mundo", "").unwrap();
            for _ in 0..100 {
                let v = job_output(&id, 50).unwrap();
                if v["state"] != "running" {
                    assert_eq!(v["state"], "done");
                    assert!(v["out"].as_str().unwrap().contains("ola-mundo"), "saída: {}", v["out"]);
                    return;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            panic!("job não terminou");
        });
        rt.shutdown_timeout(Duration::from_secs(2));
    }

    #[test]
    fn job_kill_encerra() {
        let rt = rt();
        rt.block_on(async {
            let ws = std::env::temp_dir();
            #[cfg(windows)]
            let cmd = "Start-Sleep -Seconds 30";
            #[cfg(not(windows))]
            let cmd = "sleep 30";
            let id = start(&ws, cmd, "").unwrap();
            tokio::time::sleep(Duration::from_millis(400)).await;
            let v = job_kill(&id).unwrap();
            assert_eq!(v["state"], "killed");
        });
        rt.shutdown_timeout(Duration::from_secs(2));
    }

    #[test]
    fn job_desconhecido() {
        assert!(job_output("nao-existe", 10).is_err());
        assert!(job_kill("nao-existe").is_err());
    }
}
