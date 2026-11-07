//! Memória em uso (working set) de um processo somada com a dos filhos dele. Serve para mostrar quanto
//! cada conector MCP local ocupa: `npx`/`uvx` sobem um processo que abre outros (cmd -> node, uv -> python).

use std::collections::{HashMap, HashSet};

/// Para cada pid raiz, a soma da memória da árvore de processos dele, em bytes.
pub fn trees(roots: &[u32]) -> HashMap<u32, u64> {
    if roots.is_empty() {
        return HashMap::new();
    }
    let mut kids: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, ppid) in list() {
        if pid != ppid {
            kids.entry(ppid).or_default().push(pid);
        }
    }
    roots
        .iter()
        .map(|&r| {
            let mut seen = HashSet::new();
            let mut stack = vec![r];
            let mut total = 0u64;
            while let Some(p) = stack.pop() {
                if !seen.insert(p) {
                    continue;
                }
                total += mem(p);
                if let Some(k) = kids.get(&p) {
                    stack.extend(k);
                }
            }
            (r, total)
        })
        .collect()
}

/// (pid, pid do pai) de todos os processos.
#[cfg(windows)]
fn list() -> Vec<(u32, u32)> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    let mut out = vec![];
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE || snap.is_null() {
            return out;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut e) != 0 {
            loop {
                out.push((e.th32ProcessID, e.th32ParentProcessID));
                if Process32NextW(snap, &mut e) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
    }
    out
}

#[cfg(windows)]
fn mem(pid: u32) -> u64 {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ};
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid);
        if h.is_null() {
            return 0;
        }
        let mut c: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
        c.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        let ok = K32GetProcessMemoryInfo(h, &mut c, c.cb) != 0;
        CloseHandle(h);
        if ok {
            c.WorkingSetSize as u64
        } else {
            0
        }
    }
}

#[cfg(target_os = "linux")]
fn list() -> Vec<(u32, u32)> {
    let Ok(rd) = std::fs::read_dir("/proc") else { return vec![] };
    rd.flatten()
        .filter_map(|e| {
            let pid: u32 = e.file_name().to_str()?.parse().ok()?;
            let stat = std::fs::read_to_string(e.path().join("stat")).ok()?;
            // "pid (nome) estado ppid ...": o nome pode ter espaços e parênteses
            let ppid = stat.rsplit_once(')')?.1.split_whitespace().nth(1)?.parse().ok()?;
            Some((pid, ppid))
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn mem(pid: u32) -> u64 {
    std::fs::read_to_string(format!("/proc/{pid}/status"))
        .ok()
        .and_then(|s| s.lines().find_map(|l| l.strip_prefix("VmRSS:").and_then(|v| v.trim().trim_end_matches("kB").trim().parse::<u64>().ok())))
        .map(|kb| kb * 1024)
        .unwrap_or(0)
}

#[cfg(not(any(windows, target_os = "linux")))]
fn list() -> Vec<(u32, u32)> {
    vec![]
}

#[cfg(not(any(windows, target_os = "linux")))]
fn mem(_pid: u32) -> u64 {
    0
}

#[cfg(test)]
mod t {
    #[test]
    fn mede_a_arvore() {
        // um filho que fica parado: a árvore deste processo tem que somar mais que ele sozinho
        let mut ch = std::process::Command::new(if cfg!(windows) { "cmd" } else { "sleep" }).args(if cfg!(windows) { vec!["/c", "ping -n 3 127.0.0.1 >nul"] } else { vec!["3"] }).spawn().unwrap();
        let me = std::process::id();
        let alone = super::mem(me);
        let tree = super::trees(&[me])[&me];
        let _ = ch.kill();
        if cfg!(any(windows, target_os = "linux")) {
            assert!(alone > 0 && tree > alone, "sozinho {alone}, árvore {tree}");
        }
    }
}
