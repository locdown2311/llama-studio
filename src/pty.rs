//! Terminais persistentes (PTY): um shell vivo entre chamadas de ferramenta.
//! Cada sessão tem dono (a conversa), nome e as últimas linhas da saída; o modelo escreve com
//! terminal_send e lê com terminal_read. Ao fechar (ou no Parar da conversa) o processo é encerrado.

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

const LINES: usize = 2000;

struct Session {
    id: String,
    owner: String,
    name: String,
    dir: PathBuf,
    started: Instant,
    writer: Mutex<Box<dyn Write + Send>>,
    /// O master fica guardado para o PTY continuar aberto enquanto a sessão existir.
    _master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
    out: Mutex<VecDeque<String>>,
    alive: AtomicBool,
}

static PTYS: Mutex<Vec<Arc<Session>>> = Mutex::new(Vec::new());

fn clean(id: &str) -> String {
    id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(40).collect()
}

fn find(id: &str) -> Result<Arc<Session>, String> {
    let id = clean(id);
    PTYS.lock().unwrap().iter().find(|s| s.id == id).cloned().ok_or_else(|| L!("Terminal não encontrado (a lista mostra os que estão abertos).", "Terminal not found (the list shows the open ones).").to_string())
}

fn view(s: &Session) -> Value {
    let lines = s.out.lock().unwrap().len();
    json!({
        "id": s.id,
        "name": s.name,
        "dir": s.dir.to_string_lossy(),
        "alive": s.alive.load(Ordering::SeqCst),
        "ms": s.started.elapsed().as_millis() as u64,
        "lines": lines,
    })
}

/// Abre um terminal (shell do sistema, ou o comando pedido) na pasta de trabalho.
/// Com o Linux isolado ligado, o terminal abre dentro da distro da pasta (monta /workspace e entra nela).
pub async fn start(app: &crate::app::App, ws: &Path, cwd: &str, name: &str, command: Option<&str>) -> Result<Value, String> {
    let dir = crate::app::resolve(ws, if cwd.is_empty() { "." } else { cwd });
    if !dir.is_dir() {
        return Err(LF!("Pasta não encontrada: {}", "Folder not found: {}", dir.display()));
    }
    let pty = native_pty_system();
    let pair = pty.openpty(PtySize { rows: 30, cols: 120, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())?;
    let sandboxed = app.cfg().sandbox.on_for(ws);
    let mut cmd = if sandboxed {
        // Linux isolado: o mesmo mount do run_command, e o shell fica vivo lá dentro
        let distro = crate::sandbox::ensure(app, ws).await?;
        let body = crate::sandbox::pty_script(&ws.to_string_lossy(), cwd, command);
        let mut c = CommandBuilder::new("wsl.exe");
        c.args(["-d", &distro, "-u", "root", "-e", "sh", "-c", &body]);
        c
    } else {
        #[cfg(windows)]
        let mut c = {
            let mut c = CommandBuilder::new("powershell.exe");
            c.args(["-NoLogo", "-NoProfile"]);
            c
        };
        #[cfg(not(windows))]
        let mut c = {
            let sh = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
            CommandBuilder::new(sh)
        };
        if let Some(cc) = command.filter(|c| !c.trim().is_empty()) {
            // comando próprio (ex.: um REPL): roda no shell do sistema
            #[cfg(windows)]
            {
                c = CommandBuilder::new("powershell.exe");
                c.args(["-NoLogo", "-NoProfile", "-Command", cc]);
            }
            #[cfg(not(windows))]
            {
                c = CommandBuilder::new("sh");
                c.args(["-c", cc]);
            }
        }
        c
    };
    if !sandboxed {
        cmd.cwd(&dir);
        cmd.env("PATH", crate::bins::path_env());
    }
    cmd.env("TERM", "dumb");
    let child = pair.slave.spawn_command(cmd).map_err(|e| LF!("Não consegui abrir o terminal: {e}", "Could not open the terminal: {e}"))?;
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = format!("t{}", crate::app::now_ms());
    let s = Arc::new(Session {
        id: id.clone(),
        owner: crate::shell::OWNER.try_with(|o| o.clone()).unwrap_or_default(),
        name: if name.trim().is_empty() { "terminal".into() } else { name.chars().take(40).collect() },
        dir,
        started: Instant::now(),
        writer: Mutex::new(writer),
        _master: Mutex::new(pair.master),
        child: Mutex::new(child),
        out: Mutex::new(VecDeque::new()),
        alive: AtomicBool::new(true),
    });
    {
        let mut v = PTYS.lock().unwrap();
        v.push(s.clone());
        let keep = v.len().saturating_sub(12);
        v.drain(..keep);
    }
    // leitor: acumula bytes e guarda linhas inteiras (uma quebra nunca parte um caractere UTF-8)
    let rd = s.clone();
    std::thread::spawn(move || {
        let mut r = reader;
        let mut buf = [0u8; 4096];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match r.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    while let Some(p) = pending.iter().position(|b| *b == b'\n') {
                        let line: Vec<u8> = pending.drain(..=p).collect();
                        let text = String::from_utf8_lossy(&line).trim_end_matches(['\r', '\n']).to_string();
                        let mut q = rd.out.lock().unwrap();
                        q.push_back(text);
                        while q.len() > LINES {
                            q.pop_front();
                        }
                    }
                }
            }
        }
        rd.alive.store(false, Ordering::SeqCst);
    });
    Ok(view(&s))
}

/// Escreve no terminal. Por padrão manda Enter junto (como digitar e apertar Enter).
pub fn send(id: &str, text: &str, enter: bool) -> Result<Value, String> {
    let s = find(id)?;
    if !s.alive.load(Ordering::SeqCst) {
        return Err(L!("O terminal já terminou.", "The terminal already ended.").to_string());
    }
    let mut w = s.writer.lock().unwrap();
    let data = if enter { format!("{text}\r") } else { text.to_string() };
    w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())?;
    Ok(view(&s))
}

/// As últimas linhas da saída (sem cores e sem barras de progresso).
pub fn read(id: &str, tail: usize) -> Result<Value, String> {
    let s = find(id)?;
    // o lock de `out` fica só aqui: view também o pega (Mutex não é reentrante)
    let (raw, start, total) = {
        let out = s.out.lock().unwrap();
        let n = tail.clamp(1, LINES);
        let start = out.len().saturating_sub(n);
        (out.iter().skip(start).cloned().collect::<Vec<_>>().join("\n"), start, out.len())
    };
    let mut v = view(&s);
    v["out"] = json!(crate::compact::clean(&raw));
    v["from"] = json!(start);
    v["total"] = json!(total);
    Ok(v)
}

fn kill_tree(pid: Option<u32>) {
    let Some(pid) = pid else { return };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).creation_flags(crate::CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill").args(["-9", &pid.to_string()]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status();
    }
}

/// Encerra o terminal e o que ele abriu.
pub fn close(id: &str) -> Result<Value, String> {
    let s = find(id)?;
    if s.alive.swap(false, Ordering::SeqCst) {
        let pid = s.child.lock().unwrap().process_id();
        kill_tree(pid);
    }
    Ok(view(&s))
}

/// Terminais de uma conversa (ou todos, com owner vazio).
pub fn list(owner: &str) -> Vec<Value> {
    let v = PTYS.lock().unwrap();
    v.iter().rev().filter(|s| owner.is_empty() || s.owner == owner).map(|s| view(s)).collect()
}

/// O Parar da conversa: encerra os terminais dela. Devolve quantos.
pub fn stop(owner: &str) -> usize {
    let list: Vec<Arc<Session>> = PTYS.lock().unwrap().iter().filter(|s| owner.is_empty() || s.owner == owner).cloned().collect();
    let mut n = 0;
    for s in list {
        if s.alive.swap(false, Ordering::SeqCst) {
            let pid = s.child.lock().unwrap().process_id();
            kill_tree(pid);
            n += 1;
        }
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_desconhecido() {
        assert!(read("nao-existe", 10).is_err());
        assert!(send("nao-existe", "x", true).is_err());
        assert!(close("nao-existe").is_err());
    }
}