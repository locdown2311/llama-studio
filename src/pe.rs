//! Assinaturas de funções em binários PE (exe/dll), sem o modelo.
//! Uma assinatura são os primeiros bytes da função com curingas onde o código muda
//! entre versões (endereços absolutos, chamadas e saltos relativos, acessos RIP-relativos).
//! Depois dá para procurar as assinaturas nas seções executáveis de outro binário.

use serde_json::{json, Value};
use std::path::Path;

use crate::app::App;

pub struct Pe {
    pub data: Vec<u8>,
    pub is64: bool,
    pub image_base: u64,
    pub size_of_image: u64,
    pub sections: Vec<Section>,
}

pub struct Section {
    pub name: String,
    pub va: u64,
    pub vsize: u64,
    pub raw: u64,
    pub raw_size: u64,
    pub exec: bool,
}

fn u16_at(d: &[u8], o: usize) -> Option<u16> {
    d.get(o..o + 2).map(|b| u16::from_le_bytes([b[0], b[1]]))
}
fn u32_at(d: &[u8], o: usize) -> Option<u32> {
    d.get(o..o + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}
fn u64_at(d: &[u8], o: usize) -> Option<u64> {
    d.get(o..o + 8).map(|b| u64::from_le_bytes(b.try_into().unwrap()))
}

impl Pe {
    pub fn open(path: &Path) -> Result<Pe, String> {
        let md = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
        if md.len() > 512 * 1024 * 1024 {
            return Err(L!("Binário grande demais (mais de 512 MB).", "Binary too large (over 512 MB).").into());
        }
        let data = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
        Self::parse(data)
    }

    pub fn parse(data: Vec<u8>) -> Result<Pe, String> {
        let bad = || L!("Não é um executável do Windows (PE) válido.", "Not a valid Windows executable (PE).").to_string();
        if data.get(0..2) != Some(b"MZ") {
            return Err(bad());
        }
        let pe = u32_at(&data, 0x3c).ok_or_else(bad)? as usize;
        if data.get(pe..pe + 4) != Some(b"PE\0\0") {
            return Err(bad());
        }
        let coff = pe + 4;
        let nsec = u16_at(&data, coff + 2).ok_or_else(bad)? as usize;
        let opt_size = u16_at(&data, coff + 16).ok_or_else(bad)? as usize;
        let opt = coff + 20;
        let magic = u16_at(&data, opt).ok_or_else(bad)?;
        let is64 = match magic {
            0x10b => false,
            0x20b => true,
            _ => return Err(bad()),
        };
        let image_base = if is64 { u64_at(&data, opt + 24).ok_or_else(bad)? } else { u32_at(&data, opt + 28).ok_or_else(bad)? as u64 };
        let size_of_image = u32_at(&data, opt + 56).ok_or_else(bad)? as u64;
        let mut sections = vec![];
        let st = opt + opt_size;
        for i in 0..nsec.min(96) {
            let o = st + i * 40;
            let Some(name) = data.get(o..o + 8) else { break };
            let name = String::from_utf8_lossy(name).trim_end_matches('\0').to_string();
            let c = u32_at(&data, o + 36).unwrap_or(0);
            sections.push(Section {
                name,
                vsize: u32_at(&data, o + 8).unwrap_or(0) as u64,
                va: u32_at(&data, o + 12).unwrap_or(0) as u64,
                raw_size: u32_at(&data, o + 16).unwrap_or(0) as u64,
                raw: u32_at(&data, o + 20).unwrap_or(0) as u64,
                exec: c & 0x2000_0000 != 0 || c & 0x20 != 0,
            });
        }
        Ok(Pe { data, is64, image_base, size_of_image, sections })
    }

    pub fn rva_to_off(&self, rva: u64) -> Option<(usize, &Section)> {
        self.sections.iter().find(|s| rva >= s.va && rva < s.va + s.vsize.max(s.raw_size)).and_then(|s| {
            let off = s.raw + (rva - s.va);
            (off < s.raw + s.raw_size && (off as usize) < self.data.len()).then_some((off as usize, s))
        })
    }
}

/// Bytes da função com curingas (None) nos operandos que mudam entre versões.
pub fn make_pattern(pe: &Pe, rva: u64, len: usize) -> Result<Vec<Option<u8>>, String> {
    let (off, sec) = pe.rva_to_off(rva).ok_or(L!("Esse endereço não cai em nenhuma seção do binário.", "That address does not fall in any section of the binary."))?;
    if !sec.exec {
        return Err(LF!("O endereço cai na seção {}, que não é de código.", "The address falls in section {}, which is not code.", sec.name));
    }
    let end = (off + len).min(pe.data.len()).min((sec.raw + sec.raw_size) as usize);
    let bytes = &pe.data[off..end];
    let mut pat: Vec<Option<u8>> = bytes.iter().map(|b| Some(*b)).collect();
    let wild = |from: usize, n: usize, pat: &mut Vec<Option<u8>>| {
        for p in pat.iter_mut().skip(from).take(n) {
            *p = None;
        }
    };
    let lo = pe.image_base;
    let hi = pe.image_base + pe.size_of_image;
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        // call/jmp rel32
        if (b == 0xE8 || b == 0xE9) && i + 5 <= bytes.len() {
            wild(i + 1, 4, &mut pat);
            i += 5;
            continue;
        }
        // jcc rel32
        if b == 0x0F && i + 6 <= bytes.len() && (0x80..=0x8F).contains(&bytes[i + 1]) {
            wild(i + 2, 4, &mut pat);
            i += 6;
            continue;
        }
        // x64: [REX] opcode modrm com mod=00 rm=101 (RIP + disp32)
        if pe.is64 && (0x40..=0x4F).contains(&b) && i + 7 <= bytes.len() {
            let op = bytes[i + 1];
            let modrm = bytes[i + 2];
            if matches!(op, 0x8B | 0x8D | 0x89 | 0x3B | 0x39 | 0x03 | 0x2B | 0x33 | 0x63 | 0x85 | 0x87 | 0xFF) && modrm & 0xC7 == 0x05 {
                wild(i + 3, 4, &mut pat);
                i += 7;
                continue;
            }
        }
        if pe.is64 && matches!(b, 0x8B | 0x8D | 0x89 | 0xFF) && i + 6 <= bytes.len() && bytes[i + 1] & 0xC7 == 0x05 {
            wild(i + 2, 4, &mut pat);
            i += 6;
            continue;
        }
        // x86: endereço absoluto dentro da imagem (realocável)
        if !pe.is64 && i + 4 <= bytes.len() {
            let v = u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]) as u64;
            if v >= lo && v < hi {
                wild(i, 4, &mut pat);
                i += 4;
                continue;
            }
        }
        i += 1;
    }
    // tira o preenchimento depois da função e os curingas do fim (não ajudam a achar)
    while pat.last().is_some_and(|p| matches!(p, None | Some(0x00) | Some(0xCC))) {
        pat.pop();
    }
    if pat.iter().filter(|p| p.is_some()).count() < 8 {
        return Err(L!("Sobraram poucos bytes fixos para uma assinatura confiável; aumente o tamanho.", "Too few fixed bytes left for a reliable signature; increase the size.").into());
    }
    Ok(pat)
}

pub fn pattern_str(p: &[Option<u8>]) -> String {
    p.iter().map(|b| b.map(|x| format!("{x:02X}")).unwrap_or_else(|| "??".into())).collect::<Vec<_>>().join(" ")
}

pub fn parse_pattern(s: &str) -> Vec<Option<u8>> {
    s.split_whitespace().map(|t| if t.starts_with('?') { None } else { u8::from_str_radix(t, 16).ok() }).collect()
}

/// Todas as posições (RVA) onde o padrão aparece nas seções de código (até `max`).
pub fn find(pe: &Pe, pat: &[Option<u8>], max: usize) -> Vec<u64> {
    let mut out = vec![];
    // âncora: o primeiro byte fixo
    let Some(a) = pat.iter().position(|p| p.is_some()) else { return out };
    let ab = pat[a].unwrap();
    for s in pe.sections.iter().filter(|s| s.exec) {
        let start = s.raw as usize;
        let end = ((s.raw + s.raw_size) as usize).min(pe.data.len());
        if end <= start || end - start < pat.len() {
            continue;
        }
        let hay = &pe.data[start..end];
        let mut i = 0;
        while i + pat.len() <= hay.len() {
            match hay[i + a..hay.len() - (pat.len() - a - 1)].iter().position(|&x| x == ab) {
                None => break,
                Some(k) => {
                    let j = i + k;
                    if pat.iter().enumerate().all(|(n, p)| p.is_none_or(|v| hay[j + n] == v)) {
                        out.push(s.va + j as u64);
                        if out.len() >= max {
                            return out;
                        }
                    }
                    i = j + 1;
                }
            }
        }
    }
    out
}

pub fn parse_hex(s: &str) -> Option<u64> {
    let t = s.trim().trim_start_matches("0x").trim_start_matches("0X").replace(['`', '_', ' '], "");
    u64::from_str_radix(&t, 16).ok()
}

// ---------------------------------------------------------------- armazenamento

fn file(app: &App) -> std::path::PathBuf {
    app.root.join("assinaturas.json")
}

pub fn load(app: &App) -> Value {
    std::fs::read(file(app)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_else(|| json!({"sigs": []}))
}

pub fn save(app: &App, v: &Value) -> Result<(), String> {
    let f = file(app);
    let tmp = f.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(v).unwrap_or_default()).map_err(|e| e.to_string())?;
    std::fs::rename(tmp, f).map_err(|e| e.to_string())
}

/// Cria a assinatura de `addr` (VA do debugger, VA preferida ou RVA) em `path`.
pub fn make(path: &Path, addr: &str, base: &str, len: usize) -> Result<Value, String> {
    let pe = Pe::open(path)?;
    let a = parse_hex(addr).ok_or(L!("Endereço inválido (use hexadecimal, ex.: 0x401000).", "Invalid address (use hexadecimal, e.g.: 0x401000)."))?;
    let rva = if let Some(b) = parse_hex(base).filter(|b| *b > 0) {
        a.checked_sub(b).ok_or(L!("O endereço é menor que a base do módulo.", "The address is lower than the module base."))?
    } else if a >= pe.image_base && a < pe.image_base + pe.size_of_image {
        a - pe.image_base
    } else if a < pe.size_of_image {
        a
    } else {
        return Err(LF!(
            "O endereço {a:#x} não está na imagem (base preferida {:#x}). Se o x64dbg carregou o módulo em outra base (ASLR), informe a base do módulo.", "The address {a:#x} is not in the image (preferred base {:#x}). If x64dbg loaded the module at another base (ASLR), enter the module base.",
            pe.image_base
        ));
    };
    let pat = make_pattern(&pe, rva, len.clamp(16, 128))?;
    let hits = find(&pe, &pat, 3);
    Ok(json!({
        "pattern": pattern_str(&pat), "rva": format!("{rva:#x}"), "imageBase": format!("{:#x}", pe.image_base),
        "is64": pe.is64, "unique": hits.len() == 1, "hits": hits.len(),
    }))
}

/// Procura todas as assinaturas salvas em `path`.
pub fn scan(app: &App, path: &Path) -> Result<Value, String> {
    let pe = Pe::open(path)?;
    let sigs = load(app);
    let mut out = vec![];
    for s in sigs["sigs"].as_array().into_iter().flatten() {
        if s["is64"].as_bool().is_some_and(|x| x != pe.is64) {
            continue;
        }
        let pat = parse_pattern(s["pattern"].as_str().unwrap_or(""));
        if pat.iter().filter(|p| p.is_some()).count() < 8 {
            continue;
        }
        let hits = find(&pe, &pat, 4);
        if !hits.is_empty() {
            out.push(json!({
                "id": s["id"], "name": s["name"], "kind": s["kind"], "note": s["note"], "from": s["from"],
                "hits": hits.iter().map(|r| json!({"rva": format!("{r:#x}"), "va": format!("{:#x}", pe.image_base + r)})).collect::<Vec<_>>(),
            }));
        }
    }
    Ok(json!({"matches": out, "imageBase": format!("{:#x}", pe.image_base), "is64": pe.is64, "total": sigs["sigs"].as_array().map(|a| a.len()).unwrap_or(0)}))
}

#[cfg(test)]
mod t {
    use super::*;

    /// PE32 mínimo com uma seção .text executável.
    fn fake(code: &[u8]) -> Vec<u8> {
        let mut d = vec![0u8; 0x400];
        d[0] = b'M';
        d[1] = b'Z';
        d[0x3c] = 0x80;
        d[0x80..0x84].copy_from_slice(b"PE\0\0");
        let coff = 0x84;
        d[coff + 2] = 1; // 1 seção
        d[coff + 16] = 0xE0; // opt header
        let opt = coff + 20;
        d[opt] = 0x0b;
        d[opt + 1] = 0x01;
        d[opt + 28..opt + 32].copy_from_slice(&0x400000u32.to_le_bytes());
        d[opt + 56..opt + 60].copy_from_slice(&0x3000u32.to_le_bytes());
        let s = opt + 0xE0;
        d[s..s + 5].copy_from_slice(b".text");
        d[s + 8..s + 12].copy_from_slice(&0x1000u32.to_le_bytes());
        d[s + 12..s + 16].copy_from_slice(&0x1000u32.to_le_bytes());
        d[s + 16..s + 20].copy_from_slice(&0x200u32.to_le_bytes());
        d[s + 20..s + 24].copy_from_slice(&0x200u32.to_le_bytes());
        d[s + 36..s + 40].copy_from_slice(&0x6000_0020u32.to_le_bytes());
        d[0x200..0x200 + code.len()].copy_from_slice(code);
        d
    }

    #[test]
    fn assinatura_acha_em_outra_versao() {
        // push ebp; mov ebp,esp; push 0x401234 (absoluto); call rel32; xor eax,eax; ...
        let a = [0x55, 0x8B, 0xEC, 0x68, 0x34, 0x12, 0x40, 0x00, 0xE8, 0x10, 0x00, 0x00, 0x00, 0x33, 0xC0, 0x83, 0xC4, 0x04, 0x5D, 0xC3, 0x90, 0x90, 0x6A, 0x01];
        let mut b = a;
        b[4] = 0x99; // endereço absoluto mudou
        b[9] = 0x77; // destino da chamada mudou
        let pe = Pe::parse(fake(&a)).unwrap();
        let pat = make_pattern(&pe, 0x1000, 24).unwrap();
        assert!(pattern_str(&pat).starts_with("55 8B EC 68 ?? ?? ?? ?? E8 ?? ?? ?? ?? 33 C0"));
        let pe2 = Pe::parse(fake(&b)).unwrap();
        assert_eq!(find(&pe2, &pat, 4), vec![0x1000]);
    }
}
