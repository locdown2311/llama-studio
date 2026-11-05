//! Enxuga saídas de ferramentas antes de irem para o modelo.
//! Tira cores ANSI e barras de progresso, junta linhas repetidas e, se ainda ficar
//! grande, guarda o começo e o fim e salva a saída completa num arquivo que o modelo pode ler.

use std::path::{Path, PathBuf};

pub struct Compacted {
    pub text: String,
}

pub fn saidas_dir(app: &crate::app::App) -> PathBuf {
    app.root.join("saidas")
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c != '\x1b' {
            out.push(c);
            continue;
        }
        match it.peek() {
            Some('[') => {
                it.next();
                // CSI: termina numa letra
                for d in it.by_ref() {
                    if d.is_ascii_alphabetic() || d == '~' {
                        break;
                    }
                }
            }
            Some(']') => {
                it.next();
                // OSC: termina em BEL ou ESC \
                while let Some(d) = it.next() {
                    if d == '\x07' {
                        break;
                    }
                    if d == '\x1b' {
                        it.next();
                        break;
                    }
                }
            }
            _ => {
                it.next();
            }
        }
    }
    out
}

/// Limpeza sem perda de informação útil.
pub fn clean(s: &str) -> String {
    let s = strip_ansi(s);
    let mut lines: Vec<String> = vec![];
    for raw in s.split('\n') {
        // barra de progresso: fica só o último estado da linha
        let line = raw.trim_end_matches('\r').rsplit('\r').find(|p| !p.trim().is_empty()).unwrap_or("").trim_end();
        lines.push(line.to_string());
    }
    let mut out: Vec<String> = vec![];
    let mut i = 0;
    while i < lines.len() {
        let l = &lines[i];
        let mut n = 1;
        while i + n < lines.len() && &lines[i + n] == l {
            n += 1;
        }
        if l.is_empty() {
            if out.last().is_some_and(|x| !x.is_empty()) {
                out.push(String::new());
            }
        } else if n > 2 {
            out.push(format!("{l}    [linha repetida {n}x]"));
        } else {
            for _ in 0..n {
                out.push(l.clone());
            }
        }
        i += n;
    }
    while out.last().is_some_and(|x| x.is_empty()) {
        out.pop();
    }
    out.join("\n")
}

/// Limpa e, se passar de `limit` caracteres, corta o meio e salva a saída inteira.
pub fn compact(text: &str, save_dir: &Path, label: &str, limit: usize) -> Compacted {
    let c = clean(text);
    if c.len() <= limit {
        return Compacted { text: c };
    }
    let lines: Vec<&str> = c.lines().collect();
    let head_budget = limit * 2 / 5;
    let tail_budget = limit / 2;
    let mut head = 0;
    let mut acc = 0;
    while head < lines.len() && acc + lines[head].len() + 1 <= head_budget {
        acc += lines[head].len() + 1;
        head += 1;
    }
    let mut tail = lines.len();
    acc = 0;
    while tail > head && acc + lines[tail - 1].len() + 1 <= tail_budget {
        acc += lines[tail - 1].len() + 1;
        tail -= 1;
    }
    // uma linha gigante sozinha (JSON minificado, por exemplo): corta por caracteres
    if head == 0 && tail == lines.len() {
        let mut a = head_budget.min(c.len());
        while !c.is_char_boundary(a) {
            a -= 1;
        }
        let mut b = c.len() - tail_budget.min(c.len());
        while !c.is_char_boundary(b) {
            b += 1;
        }
        let file = save(save_dir, label, &c);
        let text = format!("{}\n\n[... {} caracteres omitidos{}]\n\n{}", &c[..a], b - a, note(&file), &c[b..]);
        return Compacted { text };
    }
    let file = save(save_dir, label, &c);
    let omitted = tail - head;
    let text = format!(
        "{}\n\n[... {omitted} linhas omitidas (linhas {} a {} de {}){}]\n\n{}",
        lines[..head].join("\n"),
        head + 1,
        tail,
        lines.len(),
        note(&file),
        lines[tail..].join("\n")
    );
    Compacted { text }
}

fn note(file: &Option<PathBuf>) -> String {
    match file {
        Some(f) => format!(". Saída completa em {}: use read_file com offset/limit ou search_files se precisar do trecho", f.display()),
        None => String::new(),
    }
}

fn save(dir: &Path, label: &str, text: &str) -> Option<PathBuf> {
    std::fs::create_dir_all(dir).ok()?;
    let slug: String = label.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).take(40).collect();
    let p = dir.join(format!("{}-{}.txt", crate::app::now_ms(), slug.trim_matches('-')));
    std::fs::write(&p, text).ok()?;
    // guarda só as 60 mais recentes
    if let Ok(rd) = std::fs::read_dir(dir) {
        let mut all: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
        if all.len() > 60 {
            all.sort();
            for old in &all[..all.len() - 60] {
                let _ = std::fs::remove_file(old);
            }
        }
    }
    Some(p)
}

// ---------------------------------------------------------------- RTK

/// Comandos que o RTK sabe resumir (primeira e segunda palavra).
const RTK: &[(&str, &[&str])] = &[
    ("git", &["status", "log", "diff", "add", "commit", "push", "pull", "show"]),
    ("cargo", &["test", "build", "clippy", "check"]),
    ("gh", &["pr", "issue", "run"]),
    ("docker", &["ps", "images", "logs", "compose"]),
    ("go", &["test"]),
    ("pytest", &[]),
    ("tsc", &[]),
    ("jest", &[]),
    ("vitest", &[]),
    ("ruff", &["check"]),
    ("pip", &["list", "outdated"]),
    ("pnpm", &["list"]),
    ("dotnet", &["build", "test"]),
];

/// Devolve o comando reescrito para passar pelo RTK, se fizer sentido.
pub fn rtk_rewrite(cmd: &str) -> Option<String> {
    let t = cmd.trim();
    if t.contains(['|', ';', '&', '>', '<', '`', '\n']) || t.contains("$(") {
        return None; // só comandos simples
    }
    let mut w = t.split_whitespace();
    let first = w.next()?.trim_end_matches(".exe").to_lowercase();
    let second = w.next().unwrap_or("").to_lowercase();
    let (_, subs) = RTK.iter().find(|(c, _)| *c == first)?;
    if !subs.is_empty() && !subs.contains(&second.as_str()) {
        return None;
    }
    crate::bins::which("rtk")?;
    Some(format!("rtk {t}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limpa() {
        let s = "\x1b[32mok\x1b[0m\nbaixando 10%\rbaixando 50%\rbaixando 100%\n\n\n\nx\nx\nx\nx\nfim\n";
        assert_eq!(clean(s), "ok\nbaixando 100%\n\nx    [linha repetida 4x]\nfim");
    }

    #[test]
    fn corta_meio() {
        let dir = std::env::temp_dir().join("studio-compact-test");
        let s: String = (0..2000).map(|i| format!("linha {i}\n")).collect();
        let c = compact(&s, &dir, "teste", 2000);
        assert!(c.text.len() < 2600, "{}", c.text.len());
        assert!(c.text.contains("linha 0\n") && c.text.contains("linha 1999"));
        assert!(c.text.contains("linhas omitidas"));
    }

    #[test]
    fn rtk_so_simples() {
        assert!(rtk_rewrite("git status | head").is_none());
        assert!(rtk_rewrite("ls -la").is_none());
    }
}
