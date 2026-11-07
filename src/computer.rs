//! Controle da área de trabalho: janelas, elementos de tela (UI Automation), mouse, teclado e captura.
//! Pensado para modelos só de texto: os elementos vêm numerados, e o clique usa o número.

use serde_json::Value;
use std::path::Path;

pub type Out = Result<(String, Vec<String>), String>;

pub async fn tool(ws_dir: &Path, name: &str, a: &Value) -> Out {
    let (name, a, ws) = (name.to_string(), a.clone(), ws_dir.to_path_buf());
    tokio::task::spawn_blocking(move || imp::run(&ws, &name, &a)).await.map_err(|e| e.to_string())?
}

#[cfg(not(windows))]
mod imp {
    pub fn run(_: &std::path::Path, _: &str, _: &serde_json::Value) -> super::Out {
        Err(L!("O controle do computador só funciona no Windows.", "Computer control only works on Windows.").into())
    }
}

#[cfg(windows)]
mod imp {
    use super::Out;
    use serde_json::Value;
    use std::path::Path;
    use std::sync::Mutex;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::System::Com::*;
    use windows::Win32::UI::Accessibility::*;
    use windows::Win32::UI::Input::KeyboardAndMouse::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    /// Centros dos elementos da última listagem (id -> x, y em pixels da tela).
    static ELEMENTS: Mutex<Vec<(i32, i32)>> = Mutex::new(Vec::new());
    /// Última captura: origem e escala (pixels da tela por pixel da imagem).
    static SHOT: Mutex<(i32, i32, f64)> = Mutex::new((0, 0, 1.0));

    fn s<'a>(a: &'a Value, k: &str) -> &'a str {
        a.get(k).and_then(Value::as_str).unwrap_or("")
    }
    fn n(a: &Value, k: &str) -> Option<i64> {
        a.get(k).and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)).or_else(|| v.as_str().and_then(|s| s.parse().ok())))
    }

    pub fn run(ws: &Path, name: &str, a: &Value) -> Out {
        match name {
            "computer_windows" => Ok((list_windows(), vec![])),
            "computer_focus" => focus(a),
            "computer_elements" => elements(a),
            "computer_screenshot" => screenshot(ws),
            "computer_click" => click(a),
            "computer_type" => {
                type_text(s(a, "text"));
                Ok(("Texto digitado.".into(), vec![]))
            }
            "computer_key" => key_combo(s(a, "keys")).map(|_| (format!("Teclas enviadas: {}", s(a, "keys")), vec![])),
            "computer_scroll" => {
                let amount = n(a, "amount").unwrap_or(-3) as i32;
                if let (Some(x), Some(y)) = (n(a, "x"), n(a, "y")) {
                    let (px, py) = from_shot(x as i32, y as i32);
                    unsafe { let _ = SetCursorPos(px, py); }
                }
                mouse(MOUSEEVENTF_WHEEL, amount * 120);
                Ok((LF!("Rolagem de {amount}.", "Scrolled by {amount}."), vec![]))
            }
            _ => Err(format!("Ferramenta desconhecida: {name}")),
        }
    }

    fn window_title(h: HWND) -> String {
        unsafe {
            let len = GetWindowTextLengthW(h);
            if len <= 0 {
                return String::new();
            }
            let mut buf = vec![0u16; len as usize + 1];
            let n = GetWindowTextW(h, &mut buf);
            String::from_utf16_lossy(&buf[..n.max(0) as usize])
        }
    }

    unsafe extern "system" fn enum_cb(h: HWND, l: LPARAM) -> BOOL {
        let v = unsafe { &mut *(l.0 as *mut Vec<(isize, String)>) };
        unsafe {
            if IsWindowVisible(h).as_bool() && GetWindow(h, GW_OWNER).map(|o| o.0.is_null()).unwrap_or(true) {
                let t = window_title(h);
                if !t.trim().is_empty() && t != "Program Manager" {
                    v.push((h.0 as isize, t));
                }
            }
        }
        true.into()
    }

    fn windows_list() -> Vec<(isize, String)> {
        let mut v: Vec<(isize, String)> = vec![];
        unsafe {
            let _ = EnumWindows(Some(enum_cb), LPARAM(&mut v as *mut _ as isize));
        }
        v
    }

    fn list_windows() -> String {
        let fg = unsafe { GetForegroundWindow().0 as isize };
        let lines: Vec<String> = windows_list().iter().map(|(h, t)| format!("{}{h}  {t}", if *h == fg { "* " } else { "  " })).collect();
        LF!("Janelas abertas (id e título; * = em primeiro plano):\n{}", "Open windows (id and title; * = foreground):\n{}", lines.join("\n"))
    }

    fn find_window(a: &Value) -> Option<HWND> {
        if let Some(id) = n(a, "window") {
            return Some(HWND(id as isize as *mut _));
        }
        let q = s(a, "window").to_lowercase();
        if q.is_empty() {
            return None;
        }
        windows_list().into_iter().find(|(_, t)| t.to_lowercase().contains(&q)).map(|(h, _)| HWND(h as *mut _))
    }

    fn focus(a: &Value) -> Out {
        let h = find_window(a).ok_or(L!("Janela não encontrada. Use computer_windows para ver os títulos.", "Window not found. Use computer_windows to see the titles."))?;
        unsafe {
            if IsIconic(h).as_bool() {
                let _ = ShowWindow(h, SW_RESTORE);
            }
            // um Alt "solto" libera a troca de janela em primeiro plano
            key_event(VK_MENU, false);
            key_event(VK_MENU, true);
            let _ = SetForegroundWindow(h);
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
        Ok((LF!("Janela em primeiro plano: {}", "Window in the foreground: {}", window_title(h)), vec![]))
    }

    fn elements(a: &Value) -> Out {
        let h = find_window(a).unwrap_or_else(|| unsafe { GetForegroundWindow() });
        let filter = s(a, "filter").to_lowercase();
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).map_err(|e| LF!("UI Automation indisponível: {e}", "UI Automation unavailable: {e}"))?;
            let root = uia.ElementFromHandle(h).map_err(|e| e.to_string())?;
            let cond = uia.CreateTrueCondition().map_err(|e| e.to_string())?;
            let arr = root.FindAll(TreeScope_Descendants, &cond).map_err(|e| e.to_string())?;
            let len = arr.Length().unwrap_or(0);
            let mut out = vec![];
            let mut centers = vec![];
            for i in 0..len {
                if out.len() >= 300 {
                    break;
                }
                let Ok(el) = arr.GetElement(i) else { continue };
                if el.CurrentIsOffscreen().map(|b| b.as_bool()).unwrap_or(false) {
                    continue;
                }
                let r: RECT = el.CurrentBoundingRectangle().unwrap_or_default();
                if r.right - r.left < 2 || r.bottom - r.top < 2 {
                    continue;
                }
                let name = el.CurrentName().map(|b| b.to_string()).unwrap_or_default();
                let kind = el.CurrentLocalizedControlType().map(|b| b.to_string()).unwrap_or_default();
                let ct = el.CurrentControlType().map(|c| c.0).unwrap_or(0);
                // ignora contêineres sem nome
                let interactive = matches!(ct, 50000 | 50002 | 50003 | 50004 | 50005 | 50007 | 50011 | 50013 | 50015 | 50016 | 50019 | 50020 | 50024 | 50031 | 50034);
                if name.trim().is_empty() && !interactive {
                    continue;
                }
                let line = format!("{} \"{}\"", kind, name.trim().chars().take(80).collect::<String>().replace('\n', " "));
                if !filter.is_empty() && !line.to_lowercase().contains(&filter) {
                    continue;
                }
                let enabled = el.CurrentIsEnabled().map(|b| b.as_bool()).unwrap_or(true);
                centers.push(((r.left + r.right) / 2, (r.top + r.bottom) / 2));
                out.push(format!("[{}] {}{}", centers.len(), line, if enabled { "" } else { " (desativado)" }));
            }
            *ELEMENTS.lock().unwrap() = centers;
            Ok((LF!("Elementos de \"{}\" (use o número em computer_click):\n{}", "Elements of \"{}\" (use the number in computer_click):\n{}", window_title(h), if out.is_empty() { L!("(nenhum)", "(none)").into() } else { out.join("\n") }), vec![]))
        }
    }

    fn from_shot(x: i32, y: i32) -> (i32, i32) {
        let (ox, oy, sc) = *SHOT.lock().unwrap();
        (ox + (x as f64 * sc).round() as i32, oy + (y as f64 * sc).round() as i32)
    }

    fn click(a: &Value) -> Out {
        let (x, y, how) = if let Some(id) = n(a, "id") {
            let list = ELEMENTS.lock().unwrap();
            let p = list.get((id - 1).max(0) as usize).copied().ok_or(L!("Elemento não encontrado. Chame computer_elements de novo.", "Element not found. Call computer_elements again."))?;
            (p.0, p.1, LF!("elemento [{id}]", "element [{id}]"))
        } else if let (Some(x), Some(y)) = (n(a, "x"), n(a, "y")) {
            let (px, py) = from_shot(x as i32, y as i32);
            (px, py, LF!("ponto ({x}, {y}) da captura", "point ({x}, {y}) of the screenshot"))
        } else {
            return Err(L!("Informe id (de computer_elements) ou x e y (da última captura).", "Pass id (from computer_elements) or x and y (from the last screenshot).").into());
        };
        let right = s(a, "button") == "right";
        let times = if a.get("double").and_then(Value::as_bool).unwrap_or(false) { 2 } else { 1 };
        unsafe {
            let _ = SetCursorPos(x, y);
        }
        std::thread::sleep(std::time::Duration::from_millis(40));
        for _ in 0..times {
            if right {
                mouse(MOUSEEVENTF_RIGHTDOWN, 0);
                mouse(MOUSEEVENTF_RIGHTUP, 0);
            } else {
                mouse(MOUSEEVENTF_LEFTDOWN, 0);
                mouse(MOUSEEVENTF_LEFTUP, 0);
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
        Ok((LF!("Clique {}no {how}.", "{}lick on {how}.", if right { L!("direito ", "Right-c") } else { L!("", "C") }), vec![]))
    }

    fn mouse(flags: MOUSE_EVENT_FLAGS, data: i32) {
        let inp = INPUT { r#type: INPUT_MOUSE, Anonymous: INPUT_0 { mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: data as _, dwFlags: flags, time: 0, dwExtraInfo: 0 } } };
        unsafe {
            SendInput(&[inp], std::mem::size_of::<INPUT>() as i32);
        }
    }

    fn key_event(vk: VIRTUAL_KEY, up: bool) {
        let inp = INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) }, time: 0, dwExtraInfo: 0 } } };
        unsafe {
            SendInput(&[inp], std::mem::size_of::<INPUT>() as i32);
        }
    }

    fn type_text(t: &str) {
        for ch in t.chars() {
            if ch == '\n' {
                key_event(VK_RETURN, false);
                key_event(VK_RETURN, true);
                continue;
            }
            let mut buf = [0u16; 2];
            for unit in ch.encode_utf16(&mut buf) {
                let mk = |up: bool| INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(0), wScan: *unit, dwFlags: if up { KEYEVENTF_UNICODE | KEYEVENTF_KEYUP } else { KEYEVENTF_UNICODE }, time: 0, dwExtraInfo: 0 } },
                };
                unsafe {
                    SendInput(&[mk(false), mk(true)], std::mem::size_of::<INPUT>() as i32);
                }
            }
        }
    }

    fn vk_of(name: &str) -> Option<VIRTUAL_KEY> {
        let n = name.trim().to_lowercase();
        Some(match n.as_str() {
            "ctrl" | "control" => VK_CONTROL,
            "shift" => VK_SHIFT,
            "alt" => VK_MENU,
            "win" | "windows" | "meta" => VK_LWIN,
            "enter" | "return" => VK_RETURN,
            "tab" => VK_TAB,
            "esc" | "escape" => VK_ESCAPE,
            "backspace" => VK_BACK,
            "delete" | "del" => VK_DELETE,
            "space" | "espaço" => VK_SPACE,
            "up" | "cima" => VK_UP,
            "down" | "baixo" => VK_DOWN,
            "left" | "esquerda" => VK_LEFT,
            "right" | "direita" => VK_RIGHT,
            "home" => VK_HOME,
            "end" => VK_END,
            "pageup" => VK_PRIOR,
            "pagedown" => VK_NEXT,
            f if f.len() >= 2 && f.starts_with('f') && f[1..].parse::<u16>().is_ok_and(|x| (1..=24).contains(&x)) => VIRTUAL_KEY(VK_F1.0 + f[1..].parse::<u16>().unwrap() - 1),
            c if c.chars().count() == 1 => {
                let ch = c.chars().next().unwrap().to_ascii_uppercase();
                if ch.is_ascii_alphanumeric() {
                    VIRTUAL_KEY(ch as u16)
                } else {
                    return None;
                }
            }
            _ => return None,
        })
    }

    fn key_combo(keys: &str) -> Result<(), String> {
        let parts: Vec<VIRTUAL_KEY> = keys.split('+').map(|k| vk_of(k).ok_or(format!("Tecla desconhecida: {k}"))).collect::<Result<_, _>>()?;
        if parts.is_empty() {
            return Err("Informe as teclas, ex.: ctrl+s".into());
        }
        for k in &parts {
            key_event(*k, false);
        }
        for k in parts.iter().rev() {
            key_event(*k, true);
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
        Ok(())
    }

    fn screenshot(ws: &Path) -> Out {
        unsafe {
            let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
            let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
            let w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            let h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
            if w <= 0 || h <= 0 {
                return Err(L!("Não consegui medir a tela.", "Could not measure the screen.").into());
            }
            let screen = GetDC(None);
            let mem = CreateCompatibleDC(Some(screen));
            let bmp = CreateCompatibleBitmap(screen, w, h);
            let old = SelectObject(mem, bmp.into());
            let _ = BitBlt(mem, 0, 0, w, h, Some(screen), x, y, SRCCOPY | CAPTUREBLT);
            let mut info = BITMAPINFO::default();
            info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            info.bmiHeader.biWidth = w;
            info.bmiHeader.biHeight = -h;
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 32;
            info.bmiHeader.biCompression = BI_RGB.0;
            let mut px = vec![0u8; (w * h * 4) as usize];
            GetDIBits(mem, bmp, 0, h as u32, Some(px.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS);
            SelectObject(mem, old);
            let _ = DeleteObject(bmp.into());
            let _ = DeleteDC(mem);
            ReleaseDC(None, screen);

            // reduz para no máximo 1366 de largura (menos tokens para o modelo)
            let scale = (w as f64 / 1366.0).max(1.0);
            let (ow, oh) = ((w as f64 / scale) as usize, (h as f64 / scale) as usize);
            let mut rgb = Vec::with_capacity(ow * oh * 3);
            for oy in 0..oh {
                let sy = ((oy as f64 * scale) as usize).min(h as usize - 1);
                for ox in 0..ow {
                    let sx = ((ox as f64 * scale) as usize).min(w as usize - 1);
                    let i = (sy * w as usize + sx) * 4;
                    rgb.extend_from_slice(&[px[i + 2], px[i + 1], px[i]]);
                }
            }
            let mut jpg = Vec::new();
            jpeg_encoder::Encoder::new(&mut jpg, 72).encode(&rgb, ow as u16, oh as u16, jpeg_encoder::ColorType::Rgb).map_err(|e| e.to_string())?;
            *SHOT.lock().unwrap() = (x, y, scale);
            let path = crate::browser::save_capture(ws, "tela", &jpg)?;
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&jpg);
            Ok((LF!("Captura da tela ({ow}x{oh}) salva em {}. Para clicar num ponto da imagem use computer_click com x e y da imagem.", "Screenshot ({ow}x{oh}) saved to {}. To click a point in the image use computer_click with the image's x and y.", path.display()), vec![format!("data:image/jpeg;base64,{b64}")]))
        }
    }
}
