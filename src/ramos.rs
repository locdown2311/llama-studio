//! Pasta própria para cada ramo de conversa ("Ramificar"), com o git:
//! - pasta dentro de um repositório: `git worktree` (instantâneo, divide os objetos com o repositório) num
//!   ramo `studio/ramo-<id>`, a partir de um commit com o estado atual da pasta (inclusive o que não foi
//!   commitado; o índice e o ramo da pessoa não são tocados);
//! - pasta sem git: cópia (sem node_modules, target...) com um repositório novo dentro, para saber o que mudou.
//! O ramo volta os arquivos ao ponto da conversa em que foi criado (pelos pontos de restauração), mostra o que
//! mudou e leva as mudanças para a pasta original com `git apply`. Fica em dados/ramos/<id>.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::app::App;

const SKIP: &[&str] = &[".git", "node_modules", "target", "dist", "build", "__pycache__", ".venv", "venv", ".next", ".cache", "obj", ".vs", ".gradle", "coverage"];
const MAX_COPY: u64 = 1024 * 1024 * 1024;
const MAX_FILE: u64 = 100 * 1024 * 1024;

fn clean(id: &str) -> String {
    id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(40).collect()
}

fn root(app: &App) -> PathBuf {
    app.root.join("ramos")
}

fn git_bin() -> Result<PathBuf, String> {
    crate::bins::which("git").ok_or_else(|| L!("O ramo com pasta própria usa o Git, que não está instalado (git-scm.com). Sem ele, o ramo usa a mesma pasta da conversa original.", "A branch with its own folder uses Git, which is not installed (git-scm.com). Without it, the branch uses the same folder as the original chat.").to_string())
}

fn git(dir: &Path, args: &[&str], env: &[(&str, &str)], input: Option<&[u8]>) -> Result<String, String> {
    let mut c = Command::new(git_bin()?);
    c.arg("-C").arg(dir).args(args).envs(env.iter().copied());
    // identidade só para os commits internos do studio (não mexe na configuração da pessoa)
    c.envs([("GIT_AUTHOR_NAME", "Llama Studio"), ("GIT_AUTHOR_EMAIL", "studio@localhost"), ("GIT_COMMITTER_NAME", "Llama Studio"), ("GIT_COMMITTER_EMAIL", "studio@localhost"), ("GIT_TERMINAL_PROMPT", "0")]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(crate::CREATE_NO_WINDOW);
    }
    c.stdin(if input.is_some() { std::process::Stdio::piped() } else { std::process::Stdio::null() }).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    let mut ch = c.spawn().map_err(|e| e.to_string())?;
    if let Some(i) = input {
        use std::io::Write;
        if let Some(mut s) = ch.stdin.take() {
            let _ = s.write_all(i);
        }
    }
    let o = ch.wait_with_output().map_err(|e| e.to_string())?;
    if o.status.success() {
        Ok(String::from_utf8_lossy(&o.stdout).trim_end().to_string())
    } else {
        Err(format!("git {}: {}", args.first().unwrap_or(&""), String::from_utf8_lossy(&o.stderr).trim().lines().last().unwrap_or("")))
    }
}

/// Um commit com tudo o que está na pasta agora (sem tocar no índice nem no ramo da pessoa).
fn snapshot_commit(top: &Path, idx: &Path, parent: Option<&str>, msg: &str) -> Result<String, String> {
    let idx_s = idx.to_string_lossy().to_string();
    let env = [("GIT_INDEX_FILE", idx_s.as_str())];
    if let Some(p) = parent {
        git(top, &["read-tree", p], &env, None)?;
    }
    git(top, &["add", "-A"], &env, None)?;
    let tree = git(top, &["write-tree"], &env, None)?;
    let _ = std::fs::remove_file(idx);
    let mut args = vec!["commit-tree", tree.as_str(), "-m", msg];
    if let Some(p) = parent {
        args.extend(["-p", p]);
    }
    git(top, &args, &[], None)
}

fn copy_tree(from: &Path, to: &Path) -> Result<u64, String> {
    let mut total = 0u64;
    let walker = walkdir::WalkDir::new(from).into_iter().filter_entry(|e| !(e.depth() > 0 && e.file_type().is_dir() && SKIP.iter().any(|s| e.file_name().to_string_lossy().eq_ignore_ascii_case(s))));
    for e in walker.flatten() {
        let rel = e.path().strip_prefix(from).unwrap_or(e.path());
        let dst = to.join(rel);
        if e.file_type().is_dir() {
            std::fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
        } else if e.file_type().is_file() {
            let n = e.metadata().map(|m| m.len()).unwrap_or(0);
            if n > MAX_FILE {
                continue;
            }
            total += n;
            if total > MAX_COPY {
                return Err(L!("A pasta passa de 1 GB (fora node_modules e afins): grande demais para copiar. Use um repositório git, que o ramo fica instantâneo.", "The folder is over 1 GB (excluding node_modules and the like): too large to copy. Use a git repository and the branch becomes instant.").into());
            }
            std::fs::copy(e.path(), &dst).map_err(|er| format!("{}: {er}", rel.display()))?;
        }
    }
    Ok(total)
}

/// Volta, na pasta do ramo, os arquivos que a conversa mudou depois do ponto do ramo (pontos de restauração
/// da conversa original, da ação mais nova para a mais antiga). A conversa original não perde os pontos.
fn rewind(app: &App, conv: &str, ids: &[String], orig: &Path, fork: &Path) -> usize {
    let d = app.root.join("pontos").join(conv.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(80).collect::<String>());
    let mut n = 0;
    for id in ids {
        let id: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(80).collect();
        let Some(v) = std::fs::read(d.join(format!("{id}.json"))).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else { continue };
        let path = PathBuf::from(v["path"].as_str().unwrap_or(""));
        let Ok(rel) = path.strip_prefix(orig) else { continue };
        let target = fork.join(rel);
        if v["tooBig"] == true || v["dir"] == true {
            continue;
        }
        if v["existed"] == true {
            if let Some(p) = target.parent() {
                let _ = std::fs::create_dir_all(p);
            }
            if std::fs::copy(d.join(format!("{id}.bin")), &target).is_ok() {
                n += 1;
            }
        } else if target.is_file() && std::fs::remove_file(&target).is_ok() {
            n += 1;
        }
    }
    n
}

pub fn create(app: &App, v: &Value) -> Result<Value, String> {
    let id = clean(v["id"].as_str().unwrap_or(""));
    let orig = PathBuf::from(v["orig"].as_str().unwrap_or(""));
    if id.is_empty() || !orig.is_dir() {
        return Err(L!("Pasta da conversa não encontrada.", "Chat folder not found.").into());
    }
    git_bin()?;
    let base_dir = root(app);
    std::fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?;
    let dest = base_dir.join(&id);
    if dest.exists() {
        return Err(L!("Esse ramo já tem pasta.", "This branch already has a folder.").into());
    }
    let msg = format!("studio: ramo {id}");
    let top = git(&orig, &["rev-parse", "--show-toplevel"], &[], None).ok().map(PathBuf::from);
    let head = top.as_ref().and_then(|t| git(t, &["rev-parse", "--verify", "HEAD"], &[], None).ok());
    let (kind, dir, base, top_s) = if let (Some(top), Some(head)) = (top, head) {
        // repositório: commit com o estado atual e worktree nele, num ramo próprio
        let commit = snapshot_commit(&top, &base_dir.join(format!("{id}.idx")), Some(&head), &msg)?;
        let branch = format!("studio/ramo-{id}");
        git(&top, &["worktree", "add", "-b", &branch, &dest.to_string_lossy(), &commit], &[], None)?;
        // a conversa estava numa subpasta do repositório: o ramo usa a mesma subpasta
        let sub = dunce_rel(&orig, &top);
        ("worktree", dest.join(&sub), commit, top.to_string_lossy().to_string())
    } else {
        // sem git: cópia com um repositório novo dentro
        copy_tree(&orig, &dest).inspect_err(|_| {
            let _ = std::fs::remove_dir_all(&dest);
        })?;
        git(&dest, &["init", "-q"], &[], None)?;
        git(&dest, &["add", "-A"], &[], None)?;
        git(&dest, &["commit", "-q", "--allow-empty", "--no-verify", "-m", &msg], &[], None)?;
        let c = git(&dest, &["rev-parse", "HEAD"], &[], None)?;
        ("copy", dest.clone(), c, String::new())
    };
    // ramo de um ponto antigo da conversa: volta o que ela mudou depois disso
    let ids: Vec<String> = v["rewind"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect();
    let rewound = if ids.is_empty() { 0 } else { rewind(app, v["conv"].as_str().unwrap_or(""), &ids, &orig, &dir) };
    Ok(json!({ "kind": kind, "dir": dir, "root": dest, "base": base, "orig": orig, "top": top_s, "rewound": rewound }))
}

/// Caminho de `p` relativo a `top` (os dois podem vir com grafias diferentes no Windows).
fn dunce_rel(p: &Path, top: &Path) -> PathBuf {
    let norm = |x: &Path| x.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_lowercase();
    let (pn, tn) = (norm(p), norm(top));
    if pn.len() > tn.len() && pn.starts_with(&format!("{tn}/")) {
        let raw = p.to_string_lossy().replace('\\', "/");
        PathBuf::from(&raw[raw.len() - (pn.len() - tn.len() - 1)..])
    } else {
        PathBuf::new()
    }
}

fn inside_root(app: &App, p: &Path) -> bool {
    let r = root(app).to_string_lossy().replace('\\', "/").to_lowercase();
    p.to_string_lossy().replace('\\', "/").to_lowercase().starts_with(&format!("{r}/"))
}

fn fork_root(app: &App, v: &Value) -> Result<PathBuf, String> {
    let r = PathBuf::from(v["root"].as_str().unwrap_or(""));
    if !inside_root(app, &r) || !r.is_dir() {
        return Err(L!("A pasta do ramo não existe mais.", "The branch folder no longer exists.").into());
    }
    Ok(r)
}

/// Patch do que mudou no ramo desde a base (inclusive arquivos novos).
fn patch_of(froot: &Path, base: &str, stat: bool) -> Result<String, String> {
    // índice à parte, para não mexer no do ramo
    let idx_s = std::env::temp_dir().join(format!("studio-ramo-{}.idx", crate::app::now_ms())).to_string_lossy().to_string();
    let env = [("GIT_INDEX_FILE", idx_s.as_str())];
    git(froot, &["read-tree", base], &env, None)?;
    git(froot, &["add", "-A"], &env, None)?;
    let r = if stat { git(froot, &["diff", "--cached", "--numstat", base], &env, None) } else { git(froot, &["diff", "--cached", "--binary", base], &env, None) };
    let _ = std::fs::remove_file(&idx_s);
    // o patch precisa terminar em quebra de linha (a saída vem aparada)
    r.map(|p| if p.is_empty() { p } else { p + "\n" })
}

pub fn diff(app: &App, v: &Value) -> Result<Value, String> {
    let froot = fork_root(app, v)?;
    let base = v["base"].as_str().unwrap_or("");
    let stat = patch_of(&froot, base, true)?;
    let files: Vec<Value> = stat
        .lines()
        .filter_map(|l| {
            let mut it = l.splitn(3, '\t');
            let (a, d, p) = (it.next()?, it.next()?, it.next()?);
            Some(json!({ "path": p, "add": a.parse::<u64>().ok(), "del": d.parse::<u64>().ok() }))
        })
        .collect();
    let mut patch = patch_of(&froot, base, false)?;
    if patch.len() > 200_000 {
        patch.truncate(200_000);
        patch.push_str("\n…");
    }
    Ok(json!({ "files": files, "patch": patch }))
}

/// Leva as mudanças do ramo para a pasta original e marca o ponto como a nova base.
pub fn apply(app: &App, v: &Value) -> Result<Value, String> {
    let froot = fork_root(app, v)?;
    let base = v["base"].as_str().unwrap_or("").to_string();
    let patch = patch_of(&froot, &base, false)?;
    if patch.trim().is_empty() {
        return Err(L!("Nada mudou no ramo desde a última vez.", "Nothing changed in the branch since last time.").into());
    }
    let top = v["top"].as_str().unwrap_or("");
    let orig = PathBuf::from(v["orig"].as_str().unwrap_or(""));
    if v["kind"] == "worktree" && !top.is_empty() {
        // mesmo repositório: direto (a pasta está como no ramo começou); se a original também mudou nos
        // mesmos arquivos, tenta juntar com 3 vias
        let t = Path::new(top);
        if git(t, &["apply", "--whitespace=nowarn", "-"], &[], Some(patch.as_bytes())).is_err() {
            git(t, &["apply", "--3way", "--whitespace=nowarn", "-"], &[], Some(patch.as_bytes())).map_err(|e| LF!("Não deu para aplicar: a pasta original mudou nos mesmos trechos ({e}).", "Could not apply: the original folder changed in the same places ({e})."))?;
        }
    } else {
        if !orig.is_dir() {
            return Err(L!("A pasta original não existe mais.", "The original folder no longer exists.").into());
        }
        git(&orig, &["apply", "--whitespace=nowarn", "-"], &[], Some(patch.as_bytes())).map_err(|e| LF!("Não deu para aplicar: a pasta original mudou nos mesmos trechos ({e}).", "Could not apply: the original folder changed in the same places ({e})."))?;
    }
    // nova base: o estado do ramo agora (a próxima vez leva só o que mudar depois)
    let idx = std::env::temp_dir().join(format!("studio-ramo-b{}.idx", crate::app::now_ms()));
    let nb = snapshot_commit(&froot, &idx, Some(&base), "studio: levado para a original")?;
    if v["kind"] == "worktree" {
        let _ = git(&froot, &["reset", "-q", "--soft", &nb], &[], None);
    }
    Ok(json!({ "base": nb }))
}

pub fn remove(app: &App, v: &Value) -> Result<Value, String> {
    let froot = fork_root(app, v)?;
    let top = v["top"].as_str().unwrap_or("");
    if v["kind"] == "worktree" && !top.is_empty() {
        let _ = git(Path::new(top), &["worktree", "remove", "--force", &froot.to_string_lossy()], &[], None);
        if let Some(name) = froot.file_name().and_then(|n| n.to_str()) {
            let _ = git(Path::new(top), &["branch", "-D", &format!("studio/ramo-{name}")], &[], None);
        }
    }
    if froot.exists() {
        std::fs::remove_dir_all(&froot).map_err(|e| e.to_string())?;
    }
    if !top.is_empty() {
        let _ = git(Path::new(top), &["worktree", "prune"], &[], None);
    }
    Ok(json!({ "ok": true }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subpasta_relativa() {
        assert_eq!(dunce_rel(Path::new("C:\\Repo\\app\\web"), Path::new("c:/repo")), PathBuf::from("app/web"));
        assert_eq!(dunce_rel(Path::new("/r"), Path::new("/r")), PathBuf::new());
    }
}
