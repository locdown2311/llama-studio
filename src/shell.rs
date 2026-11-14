//! Executa comandos (PowerShell no Windows, sh no resto) dentro da pasta de trabalho.

use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;

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

/// Comandos rodando agora (para mostrar no Parar).
pub fn running(owner: &str) -> usize {
    PROCS.lock().unwrap().iter().filter(|p| owner.is_empty() || p.owner == owner).count()
}

pub async fn run(ws: &Path, command: &str, cwd: &str, timeout_s: u64) -> Result<String, String> {
    if command.trim().is_empty() {
        return Err("Comando vazio.".into());
    }
    let dir = crate::app::resolve(ws, if cwd.is_empty() { "." } else { cwd });
    if !dir.is_dir() {
        return Err(LF!("Pasta não encontrada: {}", "Folder not found: {}", dir.display()));
    }
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
    cmd.current_dir(&dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
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
