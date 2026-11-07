//! Idioma do studio (português ou inglês). Vale para a interface e para tudo o que o modelo recebe:
//! instruções, descrições e respostas das ferramentas.
//!
//! Uso: `L!("texto", "text")` escolhe o texto; `LF!("{n} arquivos", "{n} files")` formata no idioma.

use std::sync::atomic::{AtomicBool, Ordering};

static EN: AtomicBool = AtomicBool::new(false);

pub fn en() -> bool {
    EN.load(Ordering::Relaxed)
}

/// "en" (ou qualquer coisa começando com "en") liga o inglês; o resto é português.
pub fn set(lang: &str) {
    EN.store(lang.to_ascii_lowercase().starts_with("en"), Ordering::Relaxed);
}

pub fn code() -> &'static str {
    if en() {
        "en"
    } else {
        "pt"
    }
}

/// Idioma escolhido no instalador (idioma.ini ao lado do executável), para a primeira vez.
pub fn from_installer(app_dir: &std::path::Path) -> Option<String> {
    let t = std::fs::read_to_string(app_dir.join("idioma.ini")).ok()?;
    let v = t.lines().find_map(|l| l.trim().strip_prefix("lang="))?.trim().to_ascii_lowercase();
    Some(if v.starts_with("en") { "en".into() } else { "pt".into() })
}

#[macro_export]
macro_rules! L {
    ($pt:expr, $en:expr) => {
        if $crate::i18n::en() {
            $en
        } else {
            $pt
        }
    };
}

#[macro_export]
macro_rules! LF {
    ($pt:literal, $en:literal $(, $a:expr)* $(,)?) => {
        if $crate::i18n::en() {
            format!($en $(, $a)*)
        } else {
            format!($pt $(, $a)*)
        }
    };
}

#[cfg(test)]
mod t {
    #[test]
    fn escolhe() {
        let n = 3;
        super::set("pt");
        assert_eq!(LF!("{n} arquivos", "{n} files"), "3 arquivos");
        assert_eq!(L!("sim", "yes"), "sim");
        super::set("en-US");
        assert_eq!(LF!("{n} arquivos", "{n} files"), "3 files");
        assert_eq!(L!("sim", "yes"), "yes");
        super::set("pt");
    }
}
