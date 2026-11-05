//! Habilidades: pastas com SKILL.md.

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::app::{copy_dir, is_inside, resolve, slug, App};

#[derive(Serialize, Clone)]
pub struct Skill {
    pub id: String,
    pub dir: PathBuf,
    pub source: String,
    pub editable: bool,
    pub name: String,
    pub description: String,
    pub size: usize,
    pub files: Vec<String>,
}

pub fn parse_frontmatter(text: &str) -> (HashMap<String, String>, String) {
    let t = text.trim_start_matches('\u{feff}');
    let mut meta = HashMap::new();
    let norm = t.replace("\r\n", "\n");
    let Some(rest) = norm.strip_prefix("---\n") else { return (meta, t.to_string()) };
    let Some(end) = rest.find("\n---") else { return (meta, t.to_string()) };
    let head = &rest[..end];
    let mut body = &rest[end + 4..];
    body = body.strip_prefix('\n').unwrap_or(body);
    let mut key: Option<String> = None;
    for line in head.lines() {
        let is_kv = line.split_once(':').filter(|(k, _)| !k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'));
        if let Some((k, v)) = is_kv {
            let mut v = v.trim().to_string();
            if matches!(v.as_str(), ">" | "|" | ">-" | "|-") {
                v.clear();
            }
            let v = v.trim_matches(|c| c == '"' || c == '\'').to_string();
            meta.insert(k.to_string(), v);
            key = Some(k.to_string());
        } else if let (Some(k), true) = (&key, line.starts_with(char::is_whitespace)) {
            let e = meta.entry(k.clone()).or_default();
            if !e.is_empty() {
                e.push(' ');
            }
            e.push_str(line.trim());
        }
    }
    (meta, body.to_string())
}

pub fn roots(app: &App) -> Vec<(PathBuf, String)> {
    let mut r = vec![(app.skills_dir(), "studio".to_string())];
    for d in app.cfg().extra_skills_dirs {
        let full = resolve(&app.root, &d);
        if full.is_dir() {
            r.push((full.clone(), full.to_string_lossy().into_owned()));
        }
    }
    r
}

pub fn list(app: &App) -> Vec<Skill> {
    let mut out: Vec<Skill> = vec![];
    for (dir, source) in roots(app) {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let sdir = e.path();
            if !sdir.is_dir() {
                continue;
            }
            let file = sdir.join("SKILL.md");
            let Ok(text) = std::fs::read_to_string(&file) else { continue };
            let fname = e.file_name().to_string_lossy().into_owned();
            let id = if source == "studio" { fname.clone() } else { format!("{}:{}", slug(&crate::app::file_name(&dir)), fname) };
            if out.iter().any(|s| s.id == id) {
                continue;
            }
            let (meta, body) = parse_frontmatter(&text);
            let files = std::fs::read_dir(&sdir)
                .map(|rd| rd.flatten().map(|x| x.file_name().to_string_lossy().into_owned()).filter(|n| n != "SKILL.md").collect())
                .unwrap_or_default();
            let description = meta.get("description").cloned().filter(|s| !s.is_empty()).unwrap_or_else(|| {
                body.lines().find(|l| !l.trim().is_empty() && !l.starts_with('#')).unwrap_or("").to_string()
            });
            out.push(Skill {
                id,
                editable: source == "studio",
                name: meta.get("name").cloned().filter(|s| !s.is_empty()).unwrap_or(fname),
                description,
                size: body.len(),
                files,
                dir: sdir,
                source: source.clone(),
            });
        }
    }
    out.sort_by_key(|s| s.name.to_lowercase());
    out
}

pub fn get(app: &App, id: &str) -> Option<Skill> {
    list(app).into_iter().find(|s| s.id == id)
}

pub fn write(app: &App, id: Option<&str>, name: &str, description: &str, body: &str) -> Result<String, String> {
    let folder = id.map(str::to_string).filter(|s| !s.is_empty()).unwrap_or_else(|| slug(name));
    let dir = app.skills_dir().join(&folder);
    if !is_inside(&app.skills_dir(), &dir) {
        return Err("Nome inválido".into());
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let n = if name.is_empty() { folder.clone() } else { name.replace('\n', " ") };
    let text = format!("---\nname: {n}\ndescription: {}\n---\n\n{}", description.replace('\n', " "), body.trim_start());
    std::fs::write(dir.join("SKILL.md"), text).map_err(|e| e.to_string())?;
    Ok(folder)
}

fn find_skill_dirs(dir: &Path, depth: usize, acc: &mut Vec<PathBuf>) {
    if dir.join("SKILL.md").is_file() {
        acc.push(dir.to_path_buf());
        return;
    }
    if depth >= 3 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let n = e.file_name().to_string_lossy().into_owned();
        if e.path().is_dir() && !n.starts_with('.') && n != "node_modules" && n != "__MACOSX" {
            find_skill_dirs(&e.path(), depth + 1, acc);
        }
    }
}

pub fn import_dir(app: &App, dir: &Path, fallback_name: Option<&str>) -> Result<Vec<String>, String> {
    let mut found = vec![];
    find_skill_dirs(dir, 0, &mut found);
    if found.is_empty() {
        return Err("Nenhum SKILL.md encontrado nessa pasta.".into());
    }
    let mut imported = vec![];
    for src in found {
        let mut base = slug(&crate::app::file_name(&src));
        if let (Some(f), true) = (fallback_name, src == dir) {
            base = slug(f);
        }
        if base == "skill" || base == "x" {
            let (meta, _) = parse_frontmatter(&std::fs::read_to_string(src.join("SKILL.md")).unwrap_or_default());
            base = slug(meta.get("name").map(String::as_str).unwrap_or("skill"));
        }
        let mut name = base.clone();
        let mut i = 2;
        while app.skills_dir().join(&name).exists() {
            name = format!("{base}-{i}");
            i += 1;
        }
        copy_dir(&src, &app.skills_dir().join(&name)).map_err(|e| e.to_string())?;
        imported.push(name);
    }
    Ok(imported)
}

pub fn import_zip(app: &App, bytes: &[u8], filename: &str) -> Result<Vec<String>, String> {
    let tmp = std::env::temp_dir().join(format!("studio-skill-{}", crate::app::now_ms()));
    let out = tmp.join("x");
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let result = (|| {
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| format!("Não consegui abrir o .zip: {e}"))?;
        zip.extract(&out).map_err(|e| format!("Não consegui extrair o .zip: {e}"))?;
        let mut dir = out.clone();
        let entries: Vec<_> = std::fs::read_dir(&out).map_err(|e| e.to_string())?.flatten().filter(|e| e.file_name() != "__MACOSX").collect();
        if entries.len() == 1 && entries[0].path().is_dir() {
            dir = entries[0].path();
        }
        let stem = Path::new(filename).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "skill".into());
        import_dir(app, &dir, Some(&stem))
    })();
    let _ = std::fs::remove_dir_all(&tmp);
    result
}

pub fn import_md(app: &App, text: &str, filename: &str) -> Result<Vec<String>, String> {
    let (meta, body) = parse_frontmatter(text);
    let stem = Path::new(filename).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let name = meta.get("name").cloned().filter(|s| !s.is_empty()).unwrap_or(if stem.eq_ignore_ascii_case("skill") { "skill".into() } else { stem });
    let id = write(app, None, &name, meta.get("description").map(String::as_str).unwrap_or(""), &body)?;
    Ok(vec![id])
}

pub fn import_path(app: &App, p: &Path) -> Result<Vec<String>, String> {
    if !p.exists() {
        return Err(format!("Caminho não encontrado: {}", p.display()));
    }
    if p.is_file() {
        let n = crate::app::file_name(p).to_lowercase();
        if n.ends_with(".zip") || n.ends_with(".skill") {
            let b = std::fs::read(p).map_err(|e| e.to_string())?;
            return import_zip(app, &b, &n);
        }
        if n.ends_with(".md") {
            let t = std::fs::read_to_string(p).map_err(|e| e.to_string())?;
            return import_md(app, &t, &n);
        }
        return Err("Use uma pasta com SKILL.md, um .zip/.skill ou um arquivo .md.".into());
    }
    import_dir(app, p, None)
}
