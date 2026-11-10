//! Janela própria (WebView2 via wry) e ícone na bandeja.
//! A janela só existe enquanto está aberta: ao fechar, a WebView é destruída e a memória volta.

use std::sync::Arc;
use tao::dpi::LogicalSize;
use tao::event::{Event, StartCause, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopWindowTarget};
use tao::window::{Window, WindowBuilder};
use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use wry::{DragDropEvent, NewWindowResponse, WebContext, WebView, WebViewBuilder};

use crate::app::{open_url, App, UiMsg};

/// Ícone do programa (assets/icon.svg em 32x32) com um ponto de status no canto.
fn icon_rgba(status: Option<[u8; 3]>) -> Vec<u8> {
    const N: i32 = 32;
    let mut px = include_bytes!("../assets/icon-32.rgba").to_vec();
    if let Some(col) = status {
        let (ox, oy) = (25, 25);
        for y in 0..N {
            for x in 0..N {
                let d = (x - ox) * (x - ox) + (y - oy) * (y - oy);
                let i = ((y * N + x) * 4) as usize;
                if d <= 36 {
                    px[i..i + 4].copy_from_slice(&[col[0], col[1], col[2], 255]);
                } else if d <= 56 {
                    px[i..i + 4].copy_from_slice(&[255, 255, 255, 255]);
                }
            }
        }
    }
    px
}

fn state_color(s: &str) -> Option<[u8; 3]> {
    match s {
        "ready" | "external" => Some([0x2f, 0x9e, 0x58]),
        "loading" | "external-loading" => Some([0xe0, 0x9a, 0x1a]),
        _ => Some([0x8a, 0x8f, 0x9c]),
    }
}

fn state_label(s: &str) -> &'static str {
    match s {
        "ready" => L!("llama-server pronto", "llama-server ready"),
        "external" => L!("llama-server pronto (iniciado fora do studio)", "llama-server ready (started outside the studio)"),
        "loading" | "external-loading" => L!("llama-server carregando o modelo...", "llama-server loading the model..."),
        _ => L!("llama-server parado", "llama-server stopped"),
    }
}

struct Ui {
    window: Window,
    webview: WebView,
}

pub fn run(app: Arc<App>, url: String, start_hidden: bool) {
    let event_loop = EventLoopBuilder::<UiMsg>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    {
        let p = proxy.clone();
        app.set_ui(Box::new(move |m| {
            let _ = p.send_event(m);
        }));
    }
    app.native_window.store(true, std::sync::atomic::Ordering::SeqCst);

    let mut web_context = WebContext::new(Some(app.root.join("webview")));
    let mut ui: Option<Ui> = None;
    let mut tray: Option<TrayIcon> = None;

    let m_open = MenuItem::new(L!("Abrir llama studio", "Open llama studio"), true, None);
    let m_start = MenuItem::new(L!("Iniciar servidor", "Start server"), true, None);
    let m_stop = MenuItem::new(L!("Parar servidor", "Stop server"), false, None);
    let m_quit = MenuItem::new(L!("Sair", "Quit"), true, None);
    let (id_open, id_start, id_stop, id_quit) = (m_open.id().clone(), m_start.id().clone(), m_stop.id().clone(), m_quit.id().clone());

    {
        let p = proxy.clone();
        MenuEvent::set_event_handler(Some(move |e: MenuEvent| {
            let _ = p.send_event(UiMsg::Js(format!("__menu:{}", e.id.0)));
        }));
        let p = proxy.clone();
        TrayIconEvent::set_event_handler(Some(move |e: TrayIconEvent| {
            let show = match e {
                TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } => true,
                TrayIconEvent::DoubleClick { .. } => true,
                _ => false,
            };
            if show {
                let _ = p.send_event(UiMsg::Show);
            }
        }));
    }

    let (proxy_w, url_w, app_w) = (proxy.clone(), url.clone(), app.clone());
    let open_window = move |target: &EventLoopWindowTarget<UiMsg>, ui: &mut Option<Ui>, ctx: &mut WebContext| {
        let (proxy, url, app) = (&proxy_w, &url_w, &app_w);
        if let Some(u) = ui.as_ref() {
            u.window.set_visible(true);
            u.window.set_minimized(false);
            u.window.set_focus();
            return;
        }
        let icon = tao::window::Icon::from_rgba(include_bytes!("../assets/icon-64.rgba").to_vec(), 64, 64).ok();
        let window = match WindowBuilder::new()
            .with_title("llama studio")
            .with_inner_size(LogicalSize::new(1400.0, 900.0))
            .with_min_inner_size(LogicalSize::new(720.0, 520.0))
            .with_window_icon(icon)
            .build(target)
        {
            Ok(w) => w,
            Err(_) => {
                open_url(url);
                return;
            }
        };
        let p_drop = proxy.clone();
        let origin = url.trim_end_matches('/').to_string();
        let origin2 = origin.clone();
        let mut b = WebViewBuilder::new_with_web_context(ctx)
            .with_url(url.as_str())
            .with_background_color((248, 248, 250, 255))
            .with_devtools(cfg!(debug_assertions))
            .with_drag_drop_handler(move |e| {
                let js = match e {
                    DragDropEvent::Enter { paths, .. } if !paths.is_empty() => "window.studioNativeDrag&&studioNativeDrag(true)".to_string(),
                    DragDropEvent::Leave => "window.studioNativeDrag&&studioNativeDrag(false)".to_string(),
                    DragDropEvent::Drop { paths, position } if !paths.is_empty() => {
                        let list: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                        format!("window.studioNativeDrop&&studioNativeDrop({},{},{})", serde_json::to_string(&list).unwrap(), position.0, position.1)
                    }
                    DragDropEvent::Drop { .. } => "window.studioNativeDrag&&studioNativeDrag(false)".to_string(),
                    _ => return true,
                };
                let _ = p_drop.send_event(UiMsg::Js(js));
                true
            })
            .with_navigation_handler(move |u: String| {
                if u.starts_with(&origin) || u.starts_with("about:") || u.starts_with("blob:") || u.starts_with("data:") {
                    true
                } else {
                    open_url(&u);
                    false
                }
            })
            .with_new_window_req_handler(move |u: String, _| {
                if !u.starts_with(&origin2) {
                    open_url(&u);
                }
                NewWindowResponse::Deny
            });
        #[cfg(windows)]
        {
            use wry::WebViewBuilderExtWindows;
            let mut args = String::from("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-background-networking --disable-extensions --disable-component-update --no-first-run");
            if !app.cfg().window_gpu {
                args.push_str(" --disable-gpu --disable-gpu-compositing");
            }
            b = b.with_additional_browser_args(args).with_browser_accelerator_keys(true);
        }
        match b.build(&window) {
            Ok(webview) => *ui = Some(Ui { window, webview }),
            Err(_) => {
                // sem WebView2: usa o navegador
                drop(window);
                open_url(url);
            }
        }
    };

    event_loop.run(move |event, target, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::NewEvents(StartCause::Init) => {
                let menu = Menu::new();
                let _ = menu.append_items(&[&m_open, &PredefinedMenuItem::separator(), &m_start, &m_stop, &PredefinedMenuItem::separator(), &m_quit]);
                tray = TrayIconBuilder::new()
                    .with_menu(Box::new(menu))
                    .with_menu_on_left_click(false)
                    .with_tooltip("llama studio")
                    .with_icon(tray_icon::Icon::from_rgba(icon_rgba(state_color("stopped")), 32, 32).unwrap())
                    .build()
                    .ok();
                if !start_hidden || tray.is_none() {
                    open_window(target, &mut ui, &mut web_context);
                }
            }
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
                if app.cfg().close_to_tray && tray.is_some() {
                    // destrói a WebView: libera memória enquanto o studio fica na bandeja
                    if let Some(u) = ui.take() {
                        drop(u.webview);
                        drop(u.window);
                    }
                } else if let Some(u) = &ui {
                    // a página manda para o servidor o que ainda não salvou; fecha um instante depois
                    let _ = u.webview.evaluate_script("window.uiFlush && uiFlush()");
                    let _ = u.window.set_visible(false);
                    let a2 = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(900));
                        a2.ui(UiMsg::Quit);
                    });
                } else {
                    app.shutdown();
                    *control_flow = ControlFlow::Exit;
                }
            }
            Event::UserEvent(UiMsg::Show) => open_window(target, &mut ui, &mut web_context),
            Event::UserEvent(UiMsg::Js(js)) => {
                if let Some(id) = js.strip_prefix("__menu:") {
                    if id == id_open.0 {
                        open_window(target, &mut ui, &mut web_context);
                    } else if id == id_start.0 {
                        app.spawn_start_llama();
                    } else if id == id_stop.0 {
                        app.llama.stop();
                    } else if id == id_quit.0 {
                        if let Some(u) = &ui {
                            let _ = u.webview.evaluate_script("window.uiFlush && uiFlush()");
                            let _ = u.window.set_visible(false);
                            let a2 = app.clone();
                            std::thread::spawn(move || {
                                std::thread::sleep(std::time::Duration::from_millis(900));
                                a2.ui(UiMsg::Quit);
                            });
                        } else {
                            app.shutdown();
                            *control_flow = ControlFlow::Exit;
                        }
                    }
                } else if let Some(u) = &ui {
                    let _ = u.webview.evaluate_script(&js);
                }
            }
            Event::UserEvent(UiMsg::LlamaState(s)) => {
                let running = app.llama.is_running();
                m_start.set_enabled(!running && s == "stopped");
                m_stop.set_enabled(running);
                if let Some(t) = &tray {
                    let _ = t.set_icon(tray_icon::Icon::from_rgba(icon_rgba(state_color(&s)), 32, 32).ok());
                    let _ = t.set_tooltip(Some(format!("llama studio\n{}", state_label(&s))));
                }
            }
            Event::UserEvent(UiMsg::Quit) => {
                ui = None;
                app.shutdown();
                *control_flow = ControlFlow::Exit;
            }
            _ => {}
        }
    });
}
