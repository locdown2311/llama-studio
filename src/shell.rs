//! Executa comandos (PowerShell no Windows, sh no resto) dentro da pasta de trabalho.

use std::path::Path;
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;

pub async fn run(ws: &Path, command: &str, cwd: &str, timeout_s: u64) -> Result<String, String> {
    if command.trim().is_empty() {
        return Err("Comando vazio.".into());
    }
    let dir = crate::app::resolve(ws, if cwd.is_empty() { "." } else { cwd });
    if !dir.is_dir() {
        return Err(format!("Pasta não encontrada: {}", dir.display()));
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
    cmd.current_dir(&dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let t0 = Instant::now();
    let mut child = cmd.spawn().map_err(|e| format!("Não consegui iniciar o shell: {e}"))?;
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
                text = "(sem saída)".into();
            }
            Ok(format!("[código de saída {} em {:.1}s, pasta {}]\n{}", code.map(|c| c.to_string()).unwrap_or("?".into()), t0.elapsed().as_secs_f32(), dir.display(), text))
        }
        Err(_) => Err(format!("Tempo esgotado ({}s). O comando foi encerrado.", limit.as_secs())),
    }
}
