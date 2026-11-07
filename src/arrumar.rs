//! Pastas que se arrumam: regras simples (padrões de nome, idade, destino com {ano}/{mes})
//! aplicadas sem o modelo. Cada execução fica registrada e pode ser desfeita.
//! Regras marcadas como automáticas rodam a cada 5 minutos, só lendo a pasta de origem.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::app::App;

fn file(app: &App) -> PathBuf {
    app.root.join("arrumar.json")
}

pub fn load(app: &App) -> Value {
    let mut v: Value = std::fs::read(file(app)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_else(|| json!({}));
    if !v["rules"].is_array() {
        v["rules"] = json!([]);
    }
    if !v["runs"].is_array() {
        v["runs"] = json!([]);
    }
    v
}

fn save(app: &App, v: &Value) -> Result<(), String> {
    let f = file(app);
    let tmp = f.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(v).unwrap_or_default()).map_err(|e| e.to_string())?;
    std::fs::rename(tmp, f).map_err(|e| e.to_string())
}

pub fn save_rules(app: &App, rules: &Value) -> Result<(), String> {
    let mut v = load(app);
    v["rules"] = rules.clone();
    save(app, &v)
}

/// Curinga simples (* e ?), sem diferenciar maiúsculas.
fn glob(pat: &str, name: &str) -> bool {
    let p: Vec<char> = pat.to_lowercase().chars().collect();
    let n: Vec<char> = name.to_lowercase().chars().collect();
    let (mut i, mut j, mut star, mut mark) = (0, 0, None, 0);
    while j < n.len() {
        if i < p.len() && (p[i] == '?' || p[i] == n[j]) {
            i += 1;
            j += 1;
        } else if i < p.len() && p[i] == '*' {
            star = Some(i);
            mark = j;
            i += 1;
        } else if let Some(s) = star {
            i = s + 1;
            mark += 1;
            j = mark;
        } else {
            return false;
        }
    }
    while i < p.len() && p[i] == '*' {
        i += 1;
    }
    i == p.len()
}

/// Data (ano, mês, dia) de um instante, sem dependências (algoritmo de Howard Hinnant).
fn ymd(t: SystemTime) -> (i64, u32, u32) {
    let days = t.duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0).div_euclid(86400);
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + if m <= 2 { 1 } else { 0 }, m, d)
}

const MESES: [&str; 12] = ["01-janeiro", "02-fevereiro", "03-marco", "04-abril", "05-maio", "06-junho", "07-julho", "08-agosto", "09-setembro", "10-outubro", "11-novembro", "12-dezembro"];

fn dest_dir(rule: &Value, src: &Path, f: &Path, mtime: SystemTime) -> PathBuf {
    let (y, m, d) = ymd(mtime);
    let ext = f.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "sem-extensao".into());
    let t = rule["dest"].as_str().unwrap_or("").replace("{ano}", &y.to_string()).replace("{mes}", &format!("{m:02}")).replace("{mesnome}", MESES[(m as usize).saturating_sub(1).min(11)]).replace("{dia}", &format!("{d:02}")).replace("{ext}", &ext);
    let p = PathBuf::from(t.trim());
    if p.is_absolute() {
        p
    } else {
        src.join(p)
    }
}

fn skip_name(n: &str) -> bool {
    let l = n.to_lowercase();
    l.ends_with(".part") || l.ends_with(".crdownload") || l.ends_with(".tmp") || l.ends_with(".download") || l.starts_with("~$") || l == "desktop.ini" || l == "thumbs.db"
}

/// Movimentos que a regra faria agora (sem mexer em nada).
pub fn plan(rule: &Value) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    let src = PathBuf::from(rule["src"].as_str().unwrap_or("").trim());
    if !src.is_dir() {
        return Err(LF!("A pasta de origem não existe: {}", "The source folder does not exist: {}", src.display()));
    }
    if rule["dest"].as_str().unwrap_or("").trim().is_empty() {
        return Err("Defina o destino.".into());
    }
    let pats: Vec<String> = rule["patterns"].as_str().unwrap_or("*").split([';', ',']).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    let contains = rule["contains"].as_str().unwrap_or("").trim().to_lowercase();
    let min_age = rule["minAgeDays"].as_f64().unwrap_or(0.0);
    let now = SystemTime::now();
    let mut out = vec![];
    for e in std::fs::read_dir(&src).map_err(|e| e.to_string())?.flatten() {
        let Ok(md) = e.metadata() else { continue };
        if !md.is_file() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if skip_name(&name) {
            continue;
        }
        if !pats.is_empty() && !pats.iter().any(|p| glob(p, &name)) {
            continue;
        }
        if !contains.is_empty() && !name.to_lowercase().contains(&contains) {
            continue;
        }
        let mtime = md.modified().unwrap_or(now);
        let age = now.duration_since(mtime).unwrap_or_default();
        // arquivo sendo escrito agora (download, captura): espera
        if age < Duration::from_secs(60) || age.as_secs_f64() < min_age * 86400.0 {
            continue;
        }
        let dir = dest_dir(rule, &src, &e.path(), mtime);
        if dir == src {
            continue;
        }
        out.push((e.path(), dir.join(&name)));
        if out.len() >= 5000 {
            break;
        }
    }
    Ok(out)
}

fn free_name(p: &Path) -> PathBuf {
    if !p.exists() {
        return p.to_path_buf();
    }
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..10000).map(|i| p.with_file_name(format!("{stem} ({i}){ext}"))).find(|q| !q.exists()).unwrap_or_else(|| p.to_path_buf())
}

fn mv(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(d) = to.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    // outro disco: copia e apaga
    std::fs::copy(from, to).map_err(|e| e.to_string())?;
    std::fs::remove_file(from).map_err(|e| e.to_string())
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Aplica a regra e registra a execução (para desfazer).
pub fn apply(app: &App, rule: &Value, auto: bool) -> Result<Value, String> {
    let moves = plan(rule)?;
    let mut done = vec![];
    let mut errors = vec![];
    for (from, to) in moves {
        let to = free_name(&to);
        match mv(&from, &to) {
            Ok(()) => done.push(json!([from, to])),
            Err(e) => errors.push(json!({"file": from, "error": e})),
        }
    }
    let mut v = load(app);
    let run = json!({"id": format!("r{}", now_ms()), "rule": rule["id"], "name": rule["name"], "at": now_ms(), "auto": auto, "moves": done, "errors": errors});
    if !done.is_empty() || !errors.is_empty() {
        let runs = v["runs"].as_array_mut().unwrap();
        runs.insert(0, run.clone());
        runs.truncate(30);
        save(app, &v)?;
    }
    Ok(run)
}

/// Desfaz uma execução: devolve cada arquivo ao lugar de origem e remove as pastas que ficarem vazias.
pub fn undo(app: &App, run_id: &str) -> Result<Value, String> {
    let mut v = load(app);
    let runs = v["runs"].as_array_mut().unwrap();
    let i = runs.iter().position(|r| r["id"] == run_id).ok_or(L!("Execução não encontrada.", "Run not found."))?;
    let run = runs.remove(i);
    let mut back = 0;
    let mut errors = vec![];
    let mut dirs = vec![];
    for m in run["moves"].as_array().into_iter().flatten().rev() {
        let (Some(from), Some(to)) = (m[0].as_str(), m[1].as_str()) else { continue };
        let (from, to) = (PathBuf::from(from), PathBuf::from(to));
        if !to.exists() {
            errors.push(json!({"file": to, "error": L!("não está mais no destino", "is no longer at the destination")}));
            continue;
        }
        match mv(&to, &free_name(&from)) {
            Ok(()) => {
                back += 1;
                if let Some(d) = to.parent() {
                    dirs.push(d.to_path_buf());
                }
            }
            Err(e) => errors.push(json!({"file": to, "error": e})),
        }
    }
    dirs.sort();
    dirs.dedup();
    for d in dirs.iter().rev() {
        let mut cur = Some(d.as_path());
        while let Some(c) = cur {
            if std::fs::remove_dir(c).is_err() {
                break;
            }
            cur = c.parent();
        }
    }
    save(app, &v)?;
    Ok(json!({"back": back, "errors": errors}))
}

/// Laço em segundo plano das regras automáticas.
pub async fn watch(app: std::sync::Arc<App>) {
    loop {
        tokio::time::sleep(Duration::from_secs(300)).await;
        let rules = load(&app)["rules"].clone();
        for r in rules.as_array().into_iter().flatten().filter(|r| r["enabled"] != false && r["auto"] == true) {
            let (app2, r2) = (app.clone(), r.clone());
            let _ = tokio::task::spawn_blocking(move || apply(&app2, &r2, true)).await;
        }
    }
}

#[cfg(test)]
mod t {
    use super::*;
    #[test]
    fn curinga() {
        assert!(glob("*.png", "Captura.PNG"));
        assert!(glob("Screenshot*.jp?g", "screenshot 2026.jpeg"));
        assert!(!glob("*.png", "a.png.txt"));
    }
    #[test]
    fn data() {
        let t = UNIX_EPOCH + Duration::from_secs(1_793_950_000); // 2026-11-06
        assert_eq!(ymd(t), (2026, 11, 6));
    }
}
