//! Terminais persistentes (PTY): um shell vivo entre chamadas de ferramenta.
//! Cada sessão tem dono (a conversa), nome e as últimas linhas da saída; o modelo escreve com
//! terminal_send e lê com terminal_read. Ao fechar (ou no Parar da conversa) o processo é encerrado.
//!
//! A saída passa por um emulador de terminal (vt100): no Windows o ConPTY redesenha a tela com movimentos de
//! cursor em vez de quebras de linha, e o prompt não termina em quebra. O texto lido é a tela + o histórico,
//! como uma pessoa veria. terminal_send espera a saída assentar e já devolve o que apareceu.

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

const LINES: usize = 2000;
const ROWS: u16 = 40;
const COLS: u16 = 160;

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
    term: Mutex<vt100::Parser>,
    /// Quando chegou saída pela última vez (para esperar assentar).
    last_out: Mutex<Instant>,
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

/// Tela + histórico do terminal, sem as linhas vazias do fim.
fn screen_text(s: &Session) -> Vec<String> {
    parser_lines(&mut s.term.lock().unwrap())
}

fn parser_lines(p: &mut vt100::Parser) -> Vec<String> {
    // histórico (B linhas acima da tela): com a vista deslocada `o`, a tela mostra as linhas B-o .. B-o+ROWS
    p.set_scrollback(usize::MAX);
    let back = p.screen().scrollback();
    let mut lines: Vec<String> = Vec::new();
    let mut off = back;
    loop {
        p.set_scrollback(off);
        let start = back - off;
        for (i, row) in p.screen().rows(0, COLS).enumerate() {
            if start + i == lines.len() {
                lines.push(row);
            }
        }
        if off == 0 {
            break;
        }
        off = off.saturating_sub(ROWS as usize);
    }
    p.set_scrollback(0);
    let mut out: Vec<String> = lines.iter().map(|l| l.trim_end().to_string()).collect();
    while out.last().is_some_and(|l| l.is_empty()) {
        out.pop();
    }
    out
}

fn view(s: &Session) -> Value {
    json!({
        "id": s.id,
        "name": s.name,
        "dir": s.dir.to_string_lossy(),
        "alive": s.alive.load(Ordering::SeqCst),
        "ms": s.started.elapsed().as_millis() as u64,
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
    let pair = pty.openpty(PtySize { rows: ROWS, cols: COLS, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())?;
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
    // o emulador entende cores e cursor: os programas podem usar o terminal completo (REPLs com edição de linha)
    cmd.env("TERM", "xterm-256color");
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
        term: Mutex::new(vt100::Parser::new(ROWS, COLS, LINES)),
        last_out: Mutex::new(Instant::now()),
        alive: AtomicBool::new(true),
    });
    {
        let mut v = PTYS.lock().unwrap();
        v.push(s.clone());
        let keep = v.len().saturating_sub(12);
        v.drain(..keep);
    }
    // leitor: tudo passa pelo emulador (cores, cursor e redesenhos viram a tela que uma pessoa veria)
    let rd = s.clone();
    std::thread::spawn(move || {
        let mut r = reader;
        let mut buf = [0u8; 8192];
        loop {
            match r.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    rd.term.lock().unwrap().process(&buf[..n]);
                    *rd.last_out.lock().unwrap() = Instant::now();
                }
            }
        }
        rd.alive.store(false, Ordering::SeqCst);
    });
    settle(&s, 4000).await;
    let mut v = view(&s);
    v["out"] = json!(tail_text(&s, 30));
    Ok(v)
}

/// Espera a saída parar de chegar (400 ms quieto) ou o prazo acabar.
async fn settle(s: &Session, max_ms: u64) {
    let t0 = Instant::now();
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    while t0.elapsed().as_millis() < max_ms as u128 && s.alive.load(Ordering::SeqCst) {
        if s.last_out.lock().unwrap().elapsed().as_millis() >= 400 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

fn tail_text(s: &Session, n: usize) -> String {
    let lines = screen_text(s);
    let start = lines.len().saturating_sub(n);
    crate::compact::clean(&lines[start..].join("\n"))
}

/// Escreve no terminal. Por padrão manda Enter junto (como digitar e apertar Enter), espera a saída assentar
/// (até `wait_ms`) e devolve o fim da tela, para o modelo ver o resultado sem outra chamada.
pub async fn send(id: &str, text: &str, enter: bool, wait_ms: u64) -> Result<Value, String> {
    let s = find(id)?;
    if !s.alive.load(Ordering::SeqCst) {
        return Err(L!("O terminal já terminou.", "The terminal already ended.").to_string());
    }
    // o que já estava na tela não volta: só a linha do prompt (onde o texto foi digitado) e o que veio depois
    let before = screen_text(&s).len();
    {
        let mut w = s.writer.lock().unwrap();
        let data = if enter { format!("{text}\r") } else { text.to_string() };
        w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())?;
        *s.last_out.lock().unwrap() = Instant::now();
    }
    settle(&s, wait_ms.clamp(200, 120_000)).await;
    let lines = screen_text(&s);
    let from = before.saturating_sub(1).min(lines.len()).max(lines.len().saturating_sub(200));
    let mut v = view(&s);
    v["out"] = json!(crate::compact::clean(&lines[from..].join("\n")));
    Ok(v)
}

/// As últimas linhas da tela (sem cores e sem barras de progresso).
pub fn read(id: &str, tail: usize) -> Result<Value, String> {
    let s = find(id)?;
    let lines = screen_text(&s);
    let n = tail.clamp(1, LINES);
    let start = lines.len().saturating_sub(n);
    let mut v = view(&s);
    v["out"] = json!(crate::compact::clean(&lines[start..].join("\n")));
    v["from"] = json!(start);
    v["total"] = json!(lines.len());
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

    fn tokio_test_send() -> bool {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(send("nao-existe", "x", true, 200)).is_err()
    }

    #[test]
    fn tela_como_uma_pessoa_ve() {
        // ConPTY: redesenha com cursor, sem quebra de linha no prompt, com cores
        let mut p = vt100::Parser::new(ROWS, COLS, LINES);
        p.process(b"\x1b[2J\x1b[HPS C:\\w> \x1b[32mecho\x1b[0m oi\r\n");
        p.process(b"oi\r\n\x1b[3;1HPS C:\\w> ");
        let l = parser_lines(&mut p);
        assert_eq!(l, vec!["PS C:\\w> echo oi", "oi", "PS C:\\w>"]);
        // mais linhas que a tela: o histórico vem junto, na ordem
        let mut p = vt100::Parser::new(ROWS, COLS, LINES);
        for i in 0..100 {
            p.process(format!("linha {i}\r\n").as_bytes());
        }
        let l = parser_lines(&mut p);
        assert_eq!(l.len(), 100);
        assert_eq!(l[0], "linha 0");
        assert_eq!(l[99], "linha 99");
    }

    #[test]
    fn id_desconhecido() {
        assert!(read("nao-existe", 10).is_err());
        assert!(tokio_test_send());
        assert!(close("nao-existe").is_err());
    }
}