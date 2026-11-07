//! Pacotes de instruções (não são programas): regras que entram no prompt de sistema no nível escolhido,
//! mais algumas habilidades extras. O studio baixa o repositório do GitHub, guarda o SKILL.md de cada nível
//! em dados\pacotes\<id> e instala as habilidades extras como habilidades comuns.
//! - Ponytail (DietrichGebert/ponytail, MIT): a menor mudança que resolve.
//! - Caveman (JuliusBrussee/caveman, Apache-2.0): respostas telegráficas, sem perder fato técnico.

use serde_json::{json, Value};
use std::io::Read;
use std::path::PathBuf;
use std::time::Duration;

use crate::app::App;

pub struct Pack {
    pub id: &'static str,
    name: &'static str,
    repo: &'static str,
    site: &'static str,
    desc: (&'static str, &'static str),
    /// nível -> pasta da skill no repositório (skills/<pasta>/SKILL.md)
    levels: &'static [(&'static str, &'static str)],
    /// o mesmo SKILL.md serve vários níveis: linhas de tabela e exemplos rotulados com o nível são filtrados
    filter_rows: bool,
    /// habilidades extras instaladas como habilidades comuns
    skills: &'static [&'static str],
    /// seções (## título) que falam de comandos e ganchos do plugin original, que o studio não tem
    drop_sections: &'static [&'static str],
    drop_lines: &'static [&'static str],
    title: (&'static str, &'static str),
}

pub const PACKS: &[Pack] = &[
    Pack {
        id: "ponytail",
        name: "Ponytail",
        repo: "DietrichGebert/ponytail",
        site: "https://ponytail.dev",
        desc: ("Faz o modelo escrever a menor mudança que resolve: reaproveita o que já existe, evita abstrações e dependências desnecessárias e termina dizendo o que pulou. Também traz as habilidades ponytail-review, -audit e -debt.",
               "Makes the model write the smallest change that solves the task: reuses what already exists, avoids needless abstractions and dependencies, and ends by saying what it skipped. Also brings the ponytail-review, -audit and -debt skills."),
        levels: &[("lite", "ponytail"), ("full", "ponytail"), ("ultra", "ponytail")],
        filter_rows: true,
        skills: &["ponytail-review", "ponytail-audit", "ponytail-debt"],
        drop_sections: &[],
        drop_lines: &["Active for the whole session", "# Ponytail"],
        title: ("# Modo Ponytail (nível {level})", "# Ponytail mode (level {level})"),
    },
    Pack {
        id: "caveman",
        name: "Caveman",
        repo: "JuliusBrussee/caveman",
        site: "",
        desc: ("Respostas telegráficas: a resposta primeiro, sem saudação, rodeio nem resumo no fim, mantendo código, caminhos, números e erros exatos. Saída é a parte lenta de um modelo local. Também traz caveman-review e caveman-commit.",
               "Telegraphic answers: the answer first, no greeting, hedging or recap at the end, keeping code, paths, numbers and errors exact. Output is the slow part of a local model. Also brings caveman-review and caveman-commit."),
        levels: &[("on", "caveman"), ("ultra", "ultracave")],
        filter_rows: false,
        skills: &["caveman-review", "caveman-commit"],
        drop_sections: &["Persistence"],
        drop_lines: &["# caveman", "# ultracave"],
        title: ("# Modo Caveman (nível {level})", "# Caveman mode (level {level})"),
    },
];

pub fn find(id: &str) -> Option<&'static Pack> {
    PACKS.iter().find(|p| p.id == id)
}

fn dir(app: &App, p: &Pack) -> PathBuf {
    app.root.join("pacotes").join(p.id)
}

fn level_file(app: &App, p: &Pack, folder: &str) -> PathBuf {
    dir(app, p).join(format!("{folder}.md"))
}

/// v2.40.0 guardava o Ponytail em dados\ponytail\SKILL.md.
fn migrate(app: &App) {
    let old = app.root.join("ponytail");
    if old.join("SKILL.md").is_file() {
        let p = &PACKS[0];
        let d = dir(app, p);
        if std::fs::create_dir_all(&d).is_ok() {
            let _ = std::fs::rename(old.join("SKILL.md"), level_file(app, p, "ponytail"));
            let _ = std::fs::rename(old.join("versao.txt"), d.join("versao.txt"));
            let _ = std::fs::rename(old.join("LICENSE"), d.join("LICENSE"));
            let _ = std::fs::remove_dir_all(&old);
        }
    }
}

fn installed(app: &App, p: &Pack) -> bool {
    p.levels.iter().any(|(_, f)| level_file(app, p, f).is_file())
}

fn version(app: &App, p: &Pack) -> String {
    std::fs::read_to_string(dir(app, p).join("versao.txt")).unwrap_or_default().trim().to_string()
}

fn api_base() -> String {
    std::env::var("STUDIO_GITHUB_API").unwrap_or_else(|_| "https://api.github.com".into())
}

/// Último commit do ramo principal (sha curto).
async fn latest(app: &App, p: &Pack) -> Result<String, String> {
    let (status, body) = crate::update::fetch(app, &format!("{}/repos/{}/commits/HEAD", api_base(), p.repo), true, Duration::from_secs(20)).await?;
    if status != 200 {
        return Err(LF!("GitHub respondeu {status} para {}", "GitHub answered {status} for {}", p.repo));
    }
    let v: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
    let sha = v["sha"].as_str().unwrap_or("").chars().take(7).collect::<String>();
    if sha.is_empty() {
        return Err(L!("Resposta do GitHub sem commit.", "GitHub answer without a commit.").into());
    }
    Ok(sha)
}

/// Itens para a lista de utilitários.
pub async fn items(app: &App, with_latest: bool) -> Vec<Value> {
    migrate(app);
    let mut out = vec![];
    for p in PACKS {
        let on = installed(app, p);
        let ver = version(app, p);
        let size: u64 = if on {
            p.levels
                .iter()
                .map(|(_, f)| level_file(app, p, f))
                .chain(p.skills.iter().map(|s| app.skills_dir().join(s).join("SKILL.md")))
                .filter_map(|f| std::fs::metadata(f).ok())
                .map(|m| m.len())
                .sum()
        } else {
            0
        };
        let mut v = json!({
            "id": p.id, "kind": "pack", "name": p.name, "cmd": L!("instruções", "instructions"),
            "desc": if crate::i18n::en() { p.desc.1 } else { p.desc.0 },
            "repo": p.repo, "site": p.site, "tag": "contexto",
            "source": if on { "studio" } else { "" }, "version": ver, "size": size,
        });
        if with_latest {
            match latest(app, p).await {
                Ok(sha) => {
                    v["latest"] = json!(sha);
                    v["update"] = json!(on && !ver.is_empty() && sha != ver);
                }
                Err(e) => v["latestError"] = json!(e),
            }
        }
        out.push(v);
    }
    out
}

pub async fn install(app: &App, p: &Pack) -> Result<String, String> {
    let sha = latest(app, p).await?;
    let (status, bytes) = crate::update::fetch(app, &format!("{}/repos/{}/zipball/{sha}", api_base(), p.repo), false, Duration::from_secs(300)).await?;
    if status != 200 {
        return Err(LF!("Download falhou ({status}).", "Download failed ({status})."));
    }
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| LF!("Pacote inválido: {e}", "Invalid package: {e}"))?;
    let wanted = |rel: &str| -> Option<PathBuf> {
        if rel == "LICENSE" {
            return Some(dir(app, p).join("LICENSE"));
        }
        let folder = rel.strip_prefix("skills/")?.strip_suffix("/SKILL.md")?;
        if p.levels.iter().any(|(_, f)| *f == folder) {
            return Some(level_file(app, p, folder));
        }
        p.skills.contains(&folder).then(|| app.skills_dir().join(folder).join("SKILL.md"))
    };
    // o zip do GitHub tem uma pasta raiz (dono-repo-sha/); o resto é relativo a ela
    let mut files: Vec<(PathBuf, Vec<u8>)> = vec![];
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        if f.is_dir() {
            continue;
        }
        let name = f.name().map(|n| n.to_string()).unwrap_or_default();
        let Some((_, rel)) = name.split_once('/') else { continue };
        let Some(to) = wanted(rel) else { continue };
        let mut buf = vec![];
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        files.push((to, buf));
    }
    if !p.levels.iter().all(|(_, f)| files.iter().any(|(to, _)| *to == level_file(app, p, f))) {
        return Err(LF!("O pacote de {} não tem as instruções esperadas (skills/…/SKILL.md).", "The {} package does not have the expected instructions (skills/…/SKILL.md).", p.name));
    }
    std::fs::create_dir_all(dir(app, p)).map_err(|e| e.to_string())?;
    for (to, buf) in &files {
        if let Some(d) = to.parent() {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        std::fs::write(to, buf).map_err(|e| e.to_string())?;
    }
    std::fs::write(dir(app, p).join("versao.txt"), &sha).map_err(|e| e.to_string())?;
    Ok(sha)
}

pub fn remove(app: &App, p: &Pack) -> Result<(), String> {
    let _ = std::fs::remove_dir_all(dir(app, p));
    for s in p.skills {
        let _ = std::fs::remove_dir_all(app.skills_dir().join(s));
    }
    Ok(())
}

/// Blocos para o prompt de sistema, na ordem de PACKS ("" para desligado ou não instalado).
pub fn sections(app: &App, levels: &Value) -> String {
    migrate(app);
    let mut out = vec![];
    for p in PACKS {
        let level = levels.get(p.id).and_then(Value::as_str).unwrap_or("").to_ascii_lowercase();
        let Some((_, folder)) = p.levels.iter().find(|(l, _)| *l == level) else { continue };
        let Ok(body) = std::fs::read_to_string(level_file(app, p, folder)) else { continue };
        let text = filter(&body, p, &level);
        if text.trim().is_empty() {
            continue;
        }
        let title = if crate::i18n::en() { p.title.1 } else { p.title.0 }.replace("{level}", if level == "on" { "normal" } else { &level });
        out.push(format!("{title}\n\n{}", text.trim()));
    }
    out.join("\n\n")
}

/// Tira o cabeçalho YAML, as linhas e seções sobre comandos do plugin original e, quando o mesmo
/// arquivo serve vários níveis, as linhas da tabela e dos exemplos de outros níveis.
fn filter(body: &str, p: &Pack, level: &str) -> String {
    let body = body.replace("\r\n", "\n");
    let body = match body.strip_prefix("---\n").and_then(|r| r.split_once("\n---")) {
        Some((_, rest)) => rest.trim_start_matches('-').to_string(),
        None => body,
    };
    let is_level = |s: &str| {
        let s = s.trim().to_ascii_lowercase();
        p.levels.iter().any(|(l, _)| *l == s).then_some(s)
    };
    let mut skip = false;
    let mut lines = vec![];
    for l in body.lines() {
        if let Some(h) = l.strip_prefix("## ") {
            skip = p.drop_sections.iter().any(|d| h.trim() == *d);
        }
        if skip || p.drop_lines.iter().any(|d| l.trim() == *d || (d.len() > 12 && l.starts_with(d))) {
            continue;
        }
        if p.filter_rows {
            if let Some((label, _)) = l.strip_prefix("| **").and_then(|r| r.split_once("**")) {
                if let Some(m) = is_level(label) {
                    if m != level {
                        continue;
                    }
                }
            }
            if let Some((label, after)) = l.strip_prefix("- ").and_then(|r| r.split_once(':')) {
                if after.trim_start().starts_with('"') {
                    if let Some(m) = is_level(label) {
                        if m != level {
                            continue;
                        }
                    }
                }
            }
        }
        lines.push(l);
    }
    let mut out = lines.join("\n");
    while out.contains("\n\n\n") {
        out = out.replace("\n\n\n", "\n\n");
    }
    out
}

#[cfg(test)]
mod t {
    #[test]
    fn filtra_nivel() {
        let p = super::find("ponytail").unwrap();
        let b = "---\nname: ponytail\ndescription: >\n  x\n---\n\n# Ponytail\n\nYou are lazy.\n\nActive for the whole session until stop.\n\n| Level | B |\n|---|---|\n| **lite** | a |\n| **full** | b |\n| **ultra** | c |\n\n- lite: \"x\"\n- Full rule: keep\n- ultra: \"y\"\n";
        let f = super::filter(b, p, "ultra");
        assert!(!f.contains("name: ponytail") && !f.contains("Active for") && !f.contains("# Ponytail"));
        assert!(f.contains("| **ultra** | c |") && !f.contains("| **lite**") && !f.contains("| **full**"));
        assert!(f.contains("- ultra: \"y\"") && !f.contains("- lite:") && f.contains("- Full rule: keep"));
    }
    #[test]
    fn tira_secao() {
        let p = super::find("caveman").unwrap();
        let b = "---\nname: caveman\n---\n\n# caveman\n\nBe terse.\n\n## Persistence\n\nUse /caveman.\n\n## Rules\n\nKeep facts.\n";
        let f = super::filter(b, p, "on");
        assert!(f.contains("Be terse.") && f.contains("## Rules") && !f.contains("Persistence") && !f.contains("/caveman") && !f.contains("# caveman"));
    }
}
