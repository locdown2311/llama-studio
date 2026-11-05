//! llama studio: interface local para o llama-server.
//! Um executável só: servidor HTTP + interface embutida + janela própria + bandeja.

#![cfg_attr(all(windows, feature = "desktop", not(debug_assertions)), windows_subsystem = "windows")]

mod app;
mod bins;
mod compact;
mod browser;
mod computer;
mod shell;
#[cfg(feature = "desktop")]
mod desktop;
mod llama;
mod locate;
mod mcp;
mod server;
mod skills;
mod tools;
mod update;

use std::io::{Read, Write};
use std::time::Duration;

use app::{open_url, App};

/// Processo sem janela de console.
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// Processos que não devem morrer junto com o studio nem herdar a prioridade baixa
/// (navegador, Explorer): fora do job object e com prioridade normal.
pub const DETACHED_FLAGS: u32 = 0x0100_0000 /* CREATE_BREAKAWAY_FROM_JOB */ | 0x0000_0020 /* NORMAL_PRIORITY_CLASS */;

/// Deixa o studio leve para o sistema: prioridade abaixo do normal, modo de eficiência e
/// um job object que encerra os processos filhos (llama-server, MCPs) se o studio fechar.
#[cfg(windows)]
fn be_gentle() {
    use windows_sys::Win32::System::JobObjects::*;
    use windows_sys::Win32::System::Threading::*;
    unsafe {
        // coordenadas em pixels reais (capturas, cliques e UI Automation batem entre si)
        let _ = windows::Win32::UI::HiDpi::SetProcessDpiAwarenessContext(windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let me = GetCurrentProcess();
        SetPriorityClass(me, BELOW_NORMAL_PRIORITY_CLASS);
        let mut throttle: PROCESS_POWER_THROTTLING_STATE = std::mem::zeroed();
        throttle.Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION;
        throttle.ControlMask = PROCESS_POWER_THROTTLING_EXECUTION_SPEED;
        throttle.StateMask = PROCESS_POWER_THROTTLING_EXECUTION_SPEED;
        SetProcessInformation(
            me,
            ProcessPowerThrottling,
            &throttle as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        );
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if !job.is_null() {
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            AssignProcessToJobObject(job, me);
            // o handle fica aberto até o processo terminar
        }
    }
}

#[cfg(not(windows))]
fn be_gentle() {}

/// Se já houver um studio rodando, pede para ele mostrar a janela.
fn wake_existing(port: u16, start: bool) -> bool {
    let Ok(mut s) = std::net::TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(2)) else { return false };
    let _ = s.set_read_timeout(Some(Duration::from_secs(3)));
    let req = format!("POST /api/app/show{} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Studio: 1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", if start { "?start=1" } else { "" });
    if s.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 64];
    let n = s.read(&mut buf).unwrap_or(0);
    String::from_utf8_lossy(&buf[..n]).contains(" 200 ")
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let has = |f: &str| args.iter().any(|a| a == f);
    let browser_mode = has("--navegador") || !cfg!(feature = "desktop");
    let hidden = has("--bandeja");
    let start_server = has("--iniciar-servidor");

    be_gentle();
    let app = App::load();
    {
        // o endereço do llama-server segue a configuração do servidor gerenciado
        let url = app.llama.cfg().base_url();
        if std::env::var("STUDIO_LLAMA_URL").is_err() && app.llama.cfg().model.len() > 0 {
            app.config.write().unwrap().llama_url = url;
            app.save_config();
        }
    }
    let port: u16 = std::env::var("STUDIO_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(app.cfg().port);
    let url = format!("http://127.0.0.1:{port}/");

    update::cleanup();
    bins::init(&app);
    bins::cleanup();
    // depois de uma atualização, espera a versão antiga liberar a porta
    let mut bound = std::net::TcpListener::bind(("127.0.0.1", port));
    if has("--apos-atualizar") {
        for _ in 0..60 {
            if bound.is_ok() {
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
            bound = std::net::TcpListener::bind(("127.0.0.1", port));
        }
    }
    let listener = match bound {
        Ok(l) => l,
        Err(_) => {
            if !wake_existing(port, start_server) || browser_mode {
                open_url(&url);
            }
            return;
        }
    };
    listener.set_nonblocking(true).expect("socket");

    let app2 = app.clone();
    let backend = std::thread::Builder::new()
        .name("studio-servidor".into())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                // No Windows cada pipe de processo filho (llama-server, conectores MCP) ocupa uma
                // thread de bloqueio enquanto lê; com poucas, a escrita para o conector nunca saía.
                .max_blocking_threads(128)
                .thread_stack_size(1024 * 1024)
                .thread_keep_alive(Duration::from_secs(10))
                .build()
                .expect("runtime");
            let _ = app2.rt.set(rt.handle().clone());
            rt.block_on(async move {
                let l = tokio::net::TcpListener::from_std(listener).expect("listener");
                tokio::spawn(llama::Llama::monitor(app2.clone()));
                let a = app2.clone();
                tokio::spawn(async move { a.mcp.sync(&a.http, &a.mcp_file()).await });
                if start_server || app2.llama.cfg().auto_start {
                    if let Err(e) = app2.llama.start(&app2) {
                        app2.llama.push_log(e);
                    }
                }
                let _ = axum::serve(l, server::router(app2)).await;
            });
        })
        .expect("thread");

    if browser_mode {
        if app.cfg().open_browser && !hidden && std::env::var_os("STUDIO_NO_OPEN").is_none() {
            open_url(&url);
        }
        let _ = backend.join();
        return;
    }
    #[cfg(feature = "desktop")]
    {
        // espera o runtime ficar pronto antes de abrir a janela
        for _ in 0..100 {
            if app.rt.get().is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        desktop::run(std::sync::Arc::clone(&app), url, hidden);
    }
}
