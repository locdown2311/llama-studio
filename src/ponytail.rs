//! Ponytail (github.com/DietrichGebert/ponytail, MIT): regras de "dev sênior preguiçoso" que fazem o
//! modelo escrever a menor mudança completa. Não é um programa: são instruções. O studio baixa o
//! repositório, guarda o SKILL.md principal em dados\ponytail (vai no prompt de sistema quando ligado,
//! no nível escolhido) e instala review, audit e debt como habilidades comuns.

use serde_json::{json, Value};
use std::io::Read;
use std::path::PathBuf;
use std::time::Duration;

use crate::app::App;

pub const REPO: &str = "DietrichGebert/ponytail";
/// Habilidades extras que fazem sentido no studio (help e gain falam de comandos e números do plugin original).
const SKILLS: &[&str] = &["ponytail-review", "ponytail-audit", "ponytail-debt"];

fn dir(app: &App) -> PathBuf {
    app.root.join("ponytail")
}

fn main_file(app: &App) -> PathBuf {
    dir(app).join("SKILL.md")
}

fn version(app: &App) -> String {
    std::fs::read_to_string(dir(app).join("versao.txt")).unwrap_or_default().trim().to_string()
}

fn api_base() -> String {
    std::env::var("STUDIO_GITHUB_API").unwrap_or_else(|_| "https://api.github.com".into())
}

/// Último commit do main: (sha curto, data).
async fn latest(app: &App) -> Result<(String, String), String> {
    let (status, body) = crate::update::fetch(app, &format!("{}/repos/{REPO}/commits/main", api_base()), true, Duration::from_secs(20)).await?;
    if status != 200 {
        return Err(LF!("GitHub respondeu {status} para {}", "GitHub answered {status} for {}", REPO));
    }
    let v: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
    let sha = v["sha"].as_str().unwrap_or("").chars().take(7).collect::<String>();
    let date = v["commit"]["committer"]["date"].as_str().unwrap_or("").chars().take(10).collect();
    if sha.is_empty() {
        return Err(L!("Resposta do GitHub sem commit.", "GitHub answer without a commit.").into());
    }
    Ok((sha, date))
}

/// Item para a lista de utilitários.
pub async fn item(app: &App, with_latest: bool) -> Value {
    let on = main_file(app).is_file();
    let ver = version(app);
    let size: u64 = if on {
        std::iter::once(main_file(app))
            .chain(SKILLS.iter().map(|s| app.skills_dir().join(s).join("SKILL.md")))
            .filter_map(|p| std::fs::metadata(p).ok())
            .map(|m| m.len())
            .sum()
    } else {
        0
    };
    let mut v = json!({
        "id": "ponytail", "kind": "pack", "name": "Ponytail", "cmd": L!("instruções", "instructions"),
        "desc": L!("Faz o modelo escrever a menor mudança que resolve: reaproveita o que já existe, evita abstrações e dependências desnecessárias e termina dizendo o que pulou. Também traz as habilidades ponytail-review, -audit e -debt.",
                   "Makes the model write the smallest change that solves the task: reuses what already exists, avoids needless abstractions and dependencies, and ends by saying what it skipped. Also brings the ponytail-review, -audit and -debt skills."),
        "repo": REPO, "site": "https://ponytail.dev", "tag": "contexto",
        "source": if on { "studio" } else { "" }, "version": ver, "size": size,
    });
    if with_latest {
        match latest(app).await {
            Ok((sha, _)) => {
                v["latest"] = json!(sha);
                v["update"] = json!(on && !ver.is_empty() && sha != ver);
            }
            Err(e) => v["latestError"] = json!(e),
        }
    }
    v
}

pub async fn install(app: &App) -> Result<String, String> {
    let (sha, _) = latest(app).await?;
    let (status, bytes) = crate::update::fetch(app, &format!("{}/repos/{REPO}/zipball/{sha}", api_base()), false, Duration::from_secs(300)).await?;
    if status != 200 {
        return Err(LF!("Download falhou ({status}).", "Download failed ({status})."));
    }
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| LF!("Pacote inválido: {e}", "Invalid package: {e}"))?;
    // o zip do GitHub tem uma pasta raiz (dono-repo-sha/); o resto é relativo a ela
    let mut files: Vec<(String, Vec<u8>)> = vec![];
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = f.name().map(|n| n.to_string()).unwrap_or_default();
        let Some((_, rel)) = name.split_once('/') else { continue };
        let keep = rel == "LICENSE" || rel == "skills/ponytail/SKILL.md" || SKILLS.iter().any(|s| rel == format!("skills/{s}/SKILL.md"));
        if !keep || f.is_dir() {
            continue;
        }
        let mut buf = vec![];
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        files.push((rel.to_string(), buf));
    }
    if !files.iter().any(|(r, _)| r == "skills/ponytail/SKILL.md") {
        return Err(L!("O pacote não tem skills/ponytail/SKILL.md.", "The package has no skills/ponytail/SKILL.md.").into());
    }
    let d = dir(app);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    for (rel, buf) in &files {
        let to = match rel.as_str() {
            "LICENSE" => d.join("LICENSE"),
            "skills/ponytail/SKILL.md" => main_file(app),
            r => {
                let name = r.trim_start_matches("skills/").trim_end_matches("/SKILL.md");
                let sd = app.skills_dir().join(name);
                std::fs::create_dir_all(&sd).map_err(|e| e.to_string())?;
                sd.join("SKILL.md")
            }
        };
        std::fs::write(&to, buf).map_err(|e| e.to_string())?;
    }
    std::fs::write(d.join("versao.txt"), &sha).map_err(|e| e.to_string())?;
    Ok(sha)
}

pub fn remove(app: &App) -> Result<(), String> {
    let _ = std::fs::remove_dir_all(dir(app));
    for s in SKILLS {
        let _ = std::fs::remove_dir_all(app.skills_dir().join(s));
    }
    Ok(())
}

/// Bloco para o prompt de sistema no nível pedido ("" se desligado ou não instalado).
pub fn section(app: &App, level: &str) -> String {
    let level = level.to_ascii_lowercase();
    if !matches!(level.as_str(), "lite" | "full" | "ultra") {
        return String::new();
    }
    let Ok(body) = std::fs::read_to_string(main_file(app)) else { return String::new() };
    let text = filter(&body, &level);
    if text.trim().is_empty() {
        return String::new();
    }
    format!("{}\n\n{}", LF!("# Modo Ponytail (nível {level})", "# Ponytail mode (level {level})"), text.trim())
}

/// Tira o cabeçalho YAML, a linha sobre comandos do plugin original e as linhas da tabela e dos exemplos
/// de outros níveis (as que começam pelo nome de um nível).
fn filter(body: &str, level: &str) -> String {
    let body = body.replace("\r\n", "\n");
    let body = match body.strip_prefix("---\n").and_then(|r| r.split_once("\n---")) {
        Some((_, rest)) => rest.trim_start_matches('-').to_string(),
        None => body,
    };
    let mode_of = |s: &str| {
        let s = s.trim().to_ascii_lowercase();
        matches!(s.as_str(), "lite" | "full" | "ultra").then_some(s)
    };
    let mut out = body
        .lines()
        .filter(|l| {
            // no studio não há /ponytail nem "stop ponytail": o nível fica em Utilitários
            if l.starts_with("Active for the whole session") || l.trim() == "# Ponytail" {
                return false;
            }
            if let Some(rest) = l.strip_prefix("| **") {
                if let Some((label, _)) = rest.split_once("**") {
                    if let Some(m) = mode_of(label) {
                        return m == level;
                    }
                }
            }
            if let Some(rest) = l.strip_prefix("- ") {
                if let Some((label, after)) = rest.split_once(':') {
                    if after.trim_start().starts_with('"') {
                        if let Some(m) = mode_of(label) {
                            return m == level;
                        }
                    }
                }
            }
            true
        })
        .collect::<Vec<_>>()
        .join("\n");
    while out.contains("\n\n\n") {
        out = out.replace("\n\n\n", "\n\n");
    }
    out
}

#[cfg(test)]
mod t {
    #[test]
    fn filtra_nivel() {
        let b = "---\nname: ponytail\ndescription: >\n  x\n---\n\n# Ponytail\n\nYou are lazy.\n\nActive for the whole session until stop.\n\n| Level | B |\n|---|---|\n| **lite** | a |\n| **full** | b |\n| **ultra** | c |\n\n- lite: \"x\"\n- Full rule: keep\n- ultra: \"y\"\n";
        let f = super::filter(b, "ultra");
        assert!(!f.contains("name: ponytail") && !f.contains("Active for"));
        assert!(f.contains("| **ultra** | c |") && !f.contains("| **lite**") && !f.contains("| **full**"));
        assert!(f.contains("- ultra: \"y\"") && !f.contains("- lite:") && f.contains("- Full rule: keep"));
    }
}
