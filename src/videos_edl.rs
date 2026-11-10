//! Edição de vídeos de verdade (cortes, layouts, transições, efeitos) por uma lista de edição: o modelo manda
//! JSON, o studio confere (arquivos, tempos), corta silêncios pela legenda se pedido, grava
//! src/edit/<Nome>.ts e registra a composição no Root.tsx. Quem desenha é o src/edit/EditVideo.tsx, um modelo
//! fixo do studio (src/videos_edit.tsx), então o modelo não escreve React para editar.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;

pub const TEMPLATE: &str = include_str!("videos_edit.tsx");

#[derive(Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Cam {
    pub src: String,
    #[serde(default)]
    pub from: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volume: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_y: Option<f64>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct Text {
    pub text: String,
    #[serde(default)]
    pub at: f64,
    #[serde(default = "two")]
    pub dur: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pos: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
}
fn two() -> f64 {
    2.0
}

#[derive(Deserialize, Serialize, Clone)]
pub struct Punch {
    pub at: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dur: Option<f64>,
}

#[derive(Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub src: String,
    #[serde(default)]
    pub from: f64,
    #[serde(default)]
    pub to: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cam: Option<Cam>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub split: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub corner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volume: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mute: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub punch: Option<Vec<Punch>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transition: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transition_dur: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub texts: Option<Vec<Text>>,
    /// só na entrada: corta os silêncios deste trecho pela legenda (não vai para o arquivo)
    #[serde(default, skip_serializing)]
    pub cut_silences: bool,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct Music {
    pub src: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volume: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<f64>,
}

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct Captions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pos: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub highlight: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Edl {
    #[serde(default = "fps30")]
    pub fps: u32,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    /// só na entrada: "9:16", "16:9", "1:1" ou "4:5" (vira width/height)
    #[serde(default, skip_serializing)]
    pub format: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    pub clips: Vec<Clip>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub music: Option<Music>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captions: Option<Captions>,
    /// só na entrada: corta os silêncios de todos os trechos
    #[serde(default, skip_serializing)]
    pub cut_silences: bool,
    /// só na entrada: menor pausa que conta como silêncio (s)
    #[serde(default, skip_serializing)]
    pub min_silence: f64,
}
fn fps30() -> u32 {
    30
}

/// Palavra da legenda (Caption do @remotion/captions).
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub text: String,
    pub start_ms: f64,
    pub end_ms: f64,
}

/// Caminho relativo a public/ ("public/x.mp4" e "x.mp4" viram "x.mp4").
pub fn norm_src(s: &str) -> String {
    s.trim().replace('\\', "/").trim_start_matches("./").trim_start_matches("public/").trim_start_matches('/').to_string()
}

pub fn safe_rel(s: &str) -> bool {
    !s.is_empty() && !s.contains(':') && s.split('/').all(|p| !p.is_empty() && p != "..")
}

pub fn words_of(dir: &Path, src: &str) -> Option<Vec<Word>> {
    let stem = Path::new(src).file_stem()?.to_str()?;
    let t = std::fs::read_to_string(dir.join("public").join("captions").join(format!("{stem}.json"))).ok()?;
    serde_json::from_str(&t).ok()
}

/// Trechos falados (pausas menores que `gap` juntam) entre `from` e `to`, em segundos do arquivo.
pub fn speech(words: &[Word], from: f64, to: f64, gap: f64) -> Vec<(f64, f64, String)> {
    let mut out: Vec<(f64, f64, String)> = vec![];
    for w in words.iter().filter(|w| w.end_ms / 1000.0 > from && w.start_ms / 1000.0 < to && !w.text.trim().is_empty()) {
        let (a, b) = ((w.start_ms / 1000.0).max(from), (w.end_ms / 1000.0).min(to));
        match out.last_mut() {
            Some(last) if a - last.1 < gap => {
                last.1 = last.1.max(b);
                last.2.push_str(&w.text);
            }
            _ => out.push((a, b, w.text.trim_start().to_string())),
        }
    }
    out
}

/// Troca um trecho com cutSilences pelos pedaços falados dele (com uma folga), levando textos e ênfases
/// para o pedaço em que caem. Devolve os segundos tirados.
fn cut_clip(c: &Clip, words: &[Word], gap: f64) -> (Vec<Clip>, f64) {
    const PAD: f64 = 0.12;
    let speed = c.speed.unwrap_or(1.0).max(0.1);
    let segs = speech(words, c.from, c.to, gap);
    if segs.is_empty() {
        return (vec![c.clone()], 0.0);
    }
    let mut parts: Vec<Clip> = vec![];
    for (i, (a, b, _)) in segs.iter().enumerate() {
        let mut p = c.clone();
        p.from = (a - PAD).max(c.from);
        p.to = (b + PAD).min(c.to);
        if let Some(prev) = parts.last() {
            if p.from < prev.to {
                p.from = prev.to;
            }
        }
        if p.to - p.from < 0.15 {
            continue;
        }
        // a câmera anda junto: mesmo deslocamento desde o começo do trecho
        if let (Some(cam), Some(orig)) = (p.cam.as_mut(), c.cam.as_ref()) {
            cam.from = orig.from + (p.from - c.from);
        }
        if i > 0 {
            p.transition = None;
            p.transition_dur = None;
        }
        p.texts = None;
        p.punch = None;
        parts.push(p);
    }
    // textos e ênfases: o instante no arquivo decide o pedaço
    let spans: Vec<(f64, f64)> = parts.iter().map(|p| (p.from, p.to)).collect();
    let place = |at: f64| -> Option<(usize, f64)> {
        let src_t = c.from + at * speed;
        spans.iter().position(|(a, b)| src_t >= *a && src_t < *b).map(|i| (i, (src_t - spans[i].0) / speed))
    };
    for t in c.texts.iter().flatten() {
        if let Some((i, at)) = place(t.at) {
            parts[i].texts.get_or_insert_with(Vec::new).push(Text { at, ..t.clone() });
        }
    }
    for p in c.punch.iter().flatten() {
        if let Some((i, at)) = place(p.at) {
            parts[i].punch.get_or_insert_with(Vec::new).push(Punch { at, ..p.clone() });
        }
    }
    let kept: f64 = parts.iter().map(|p| p.to - p.from).sum();
    (parts, (c.to - c.from) - kept)
}

const LAYOUTS: &[&str] = &["full", "fit", "react", "pip", "side"];
const TRANSITIONS: &[&str] = &["cut", "fade", "slide", "wipe", "zoom"];
const FILTERS: &[&str] = &["none", "bw", "warm", "cold", "vivid", "dark"];

/// Confere e completa a lista. `dur(src)` = duração do arquivo em public/ (None = não existe).
/// Devolve a lista pronta e os segundos de silêncio cortados, ou os problemas encontrados.
pub fn prepare(mut e: Edl, dir: &Path, dur: &dyn Fn(&str) -> Option<Option<f64>>) -> Result<(Edl, f64), Vec<String>> {
    let mut errs = vec![];
    match e.format.trim() {
        "9:16" => (e.width, e.height) = (1080, 1920),
        "16:9" => (e.width, e.height) = (1920, 1080),
        "1:1" => (e.width, e.height) = (1080, 1080),
        "4:5" => (e.width, e.height) = (1080, 1350),
        "" => {}
        f => errs.push(format!("format \"{f}\": use 9:16, 16:9, 1:1 ou 4:5")),
    }
    if e.width == 0 || e.height == 0 {
        (e.width, e.height) = (1080, 1920);
    }
    e.width = e.width.clamp(64, 3840) & !1;
    e.height = e.height.clamp(64, 3840) & !1;
    e.fps = e.fps.clamp(1, 120);
    if e.clips.is_empty() {
        errs.push("clips está vazio".into());
    }
    let gap = if e.min_silence > 0.05 { e.min_silence.min(5.0) } else { 0.6 };
    let check_file = |src: &str, what: &str, errs: &mut Vec<String>| -> Option<f64> {
        if !safe_rel(src) {
            errs.push(format!("{what}: caminho inválido \"{src}\""));
            return None;
        }
        match dur(src) {
            None => {
                errs.push(format!("{what}: public/{src} não existe"));
                None
            }
            Some(d) => d,
        }
    };
    let mut cut = 0.0;
    let mut clips = vec![];
    for (i, mut c) in std::mem::take(&mut e.clips).into_iter().enumerate() {
        let n = i + 1;
        c.src = norm_src(&c.src);
        let d = check_file(&c.src, &format!("trecho {n}"), &mut errs);
        if c.to <= 0.0 {
            c.to = d.unwrap_or(0.0);
        }
        if c.from < 0.0 || c.to <= c.from {
            errs.push(format!("trecho {n}: from {} e to {} (to precisa ser maior)", c.from, c.to));
        }
        if let Some(d) = d {
            if c.from >= d {
                errs.push(format!("trecho {n}: from {} passa da duração de {} ({d:.2}s)", c.from, c.src));
            }
            if c.to > d + 0.05 {
                c.to = d; // um pouco além do fim: corta no fim do arquivo
            }
        }
        if let Some(l) = &c.layout {
            if !LAYOUTS.contains(&l.as_str()) {
                errs.push(format!("trecho {n}: layout \"{l}\" (use {})", LAYOUTS.join(", ")));
            }
            if matches!(l.as_str(), "react" | "pip" | "side") && c.cam.is_none() {
                errs.push(format!("trecho {n}: layout {l} precisa de cam (o segundo vídeo)"));
            }
        }
        if let Some(cam) = c.cam.as_mut() {
            cam.src = norm_src(&cam.src);
            if let Some(cd) = check_file(&cam.src, &format!("trecho {n} (cam)"), &mut errs) {
                let need = cam.from + (c.to - c.from);
                if need > cd + 0.05 {
                    errs.push(format!("trecho {n}: a cam (public/{}) termina em {cd:.2}s, mas o trecho pede até {need:.2}s; ajuste cam.from ou o trecho", cam.src));
                }
            }
        }
        if let Some(t) = &c.transition {
            if !TRANSITIONS.contains(&t.as_str()) {
                errs.push(format!("trecho {n}: transition \"{t}\" (use {})", TRANSITIONS.join(", ")));
            }
        }
        if let Some(f) = &c.filter {
            if !FILTERS.contains(&f.as_str()) {
                errs.push(format!("trecho {n}: filter \"{f}\" (use {})", FILTERS.join(", ")));
            }
        }
        if let Some(s) = c.speed {
            c.speed = Some(s.clamp(0.25, 4.0));
        }
        if c.cut_silences || e.cut_silences {
            match words_of(dir, &c.src) {
                Some(w) => {
                    let (parts, removed) = cut_clip(&c, &w, gap);
                    cut += removed;
                    clips.extend(parts);
                    continue;
                }
                None => errs.push(format!("trecho {n}: cutSilences precisa da legenda de public/{} (gere com video_captions)", c.src)),
            }
        }
        clips.push(c);
    }
    e.clips = clips;
    if let Some(m) = e.music.as_mut() {
        m.src = norm_src(&m.src);
        check_file(&m.src, "music", &mut errs);
    }
    if errs.is_empty() {
        Ok((e, cut))
    } else {
        Err(errs)
    }
}

/// Duração em quadros (a mesma conta do EditVideo.tsx).
pub fn frames(e: &Edl) -> u64 {
    let mut at: i64 = 0;
    let mut prev_len: i64 = 0;
    for (i, c) in e.clips.iter().enumerate() {
        let len = (((c.to - c.from) / c.speed.unwrap_or(1.0)) * e.fps as f64).round().max(1.0) as i64;
        if i > 0 && c.transition.as_deref().is_some_and(|t| t != "cut") {
            let enter = ((c.transition_dur.unwrap_or(0.5) * e.fps as f64).round() as i64).min(len / 2).min(prev_len / 2).max(1);
            at -= enter;
        }
        at += len;
        prev_len = len;
    }
    at.max(1) as u64
}

/// O arquivo src/edit/<Nome>.ts com a lista.
pub fn edl_file(e: &Edl) -> String {
    let body = serde_json::to_string_pretty(e).unwrap_or_else(|_| "{}".into());
    format!("// Lista de edição (llama studio, video_edit). Pode mudar à mão: tempos em segundos do arquivo em public/.\nimport type {{ Edl }} from \"./EditVideo\";\n\nexport const EDL: Edl = {body};\n")
}

/// Registra a composição da lista no Root.tsx, uma vez por nome.
pub fn wire_root(text: &str, name: &str) -> Option<String> {
    if text.contains(&format!("\"./edit/{name}\"")) {
        return Some(text.to_string());
    }
    let close = text.rfind("</>")?;
    let var = format!("EDL_{name}");
    let comp = format!(
        "      <Composition\n        id=\"{name}\"\n        component={{EditVideo}}\n        defaultProps={{{{ edl: {var} }}}}\n        durationInFrames={{edlFrames({var})}}\n        fps={{{var}.fps}}\n        width={{{var}.width}}\n        height={{{var}.height}}\n      />\n"
    );
    let line = text[..close].rfind('\n').map(|i| i + 1).unwrap_or(close);
    let body = format!("{}{}{}", &text[..line], comp, &text[line..]);
    let mut imports = String::new();
    let has_comp = body.lines().any(|l| l.trim_start().starts_with("import") && l.contains("Composition") && l.contains("\"remotion\""));
    if !has_comp {
        imports.push_str("import { Composition } from \"remotion\";\n");
    }
    if !body.contains("\"./edit/EditVideo\"") {
        imports.push_str("import { EditVideo, edlFrames } from \"./edit/EditVideo\";\n");
    }
    imports.push_str(&format!("import {{ EDL as {var} }} from \"./edit/{name}\";\n"));
    Some(format!("{imports}{body}"))
}

pub fn summary(e: &Edl, cut: f64) -> Value {
    let f = frames(e);
    json!({ "frames": f, "seconds": f as f64 / e.fps as f64, "clips": e.clips.len(), "width": e.width, "height": e.height, "fps": e.fps, "silenceCut": cut })
}

#[cfg(test)]
mod t {
    use super::*;

    fn w(t: &str, a: f64, b: f64) -> Word {
        Word { text: t.into(), start_ms: a * 1000.0, end_ms: b * 1000.0 }
    }

    #[test]
    fn corta_silencios_e_leva_textos() {
        let words = vec![w(" Oi", 1.0, 1.4), w(" pessoal", 1.5, 2.0), w(" hoje", 4.0, 4.3), w(" vamos", 4.35, 4.8)];
        let c = Clip { src: "a.mp4".into(), from: 0.0, to: 6.0, transition: Some("fade".into()), texts: Some(vec![Text { text: "T".into(), at: 4.1, dur: 1.0, pos: None, style: None }]), ..Default::default() };
        let (parts, cut) = cut_clip(&c, &words, 0.6);
        assert_eq!(parts.len(), 2);
        assert!((parts[0].from - 0.88).abs() < 1e-9 && (parts[0].to - 2.12).abs() < 1e-9);
        assert!((parts[1].from - 3.88).abs() < 1e-9 && (parts[1].to - 4.92).abs() < 1e-9);
        assert_eq!(parts[0].transition.as_deref(), Some("fade"));
        assert!(parts[1].transition.is_none());
        // o texto em 4,1 s do arquivo cai no segundo pedaço, 0,22 s depois do começo dele
        let t = &parts[1].texts.as_ref().unwrap()[0];
        assert!((t.at - 0.22).abs() < 1e-9);
        assert!((cut - (6.0 - 1.24 - 1.04)).abs() < 1e-9);
    }

    #[test]
    fn quadros_com_transicao() {
        let e = Edl { fps: 30, clips: vec![Clip { from: 0.0, to: 2.0, ..Default::default() }, Clip { from: 0.0, to: 2.0, transition: Some("fade".into()), transition_dur: Some(0.5), ..Default::default() }], ..Default::default() };
        assert_eq!(frames(&e), 60 + 60 - 15);
    }

    #[test]
    fn confere_arquivos_e_tempos() {
        let dur = |s: &str| -> Option<Option<f64>> { (s == "a.mp4" || s == "cam.mp4").then_some(Some(10.0)) };
        let e: Edl = serde_json::from_value(json!({ "format": "9:16", "clips": [
            { "src": "public/a.mp4", "from": 2, "to": 12 },
            { "src": "b.mp4", "from": 0, "to": 1 },
            { "src": "a.mp4", "from": 5, "to": 9, "layout": "react", "cam": { "src": "cam.mp4", "from": 8 } },
            { "src": "a.mp4", "from": 1, "to": 2, "layout": "react" }
        ]})).unwrap();
        let errs = prepare(e, Path::new("/nao-existe"), &dur).err().unwrap();
        assert!(errs.iter().any(|x| x.contains("public/b.mp4 não existe")), "{errs:?}");
        assert!(errs.iter().any(|x| x.contains("a cam (public/cam.mp4) termina em 10.00s")), "{errs:?}");
        assert!(errs.iter().any(|x| x.contains("layout react precisa de cam")), "{errs:?}");
        assert!(!errs.iter().any(|x| x.contains("trecho 1")), "o to além do fim só é cortado: {errs:?}");
    }

    #[test]
    fn registra_no_root() {
        let root = "import { Video, VIDEO } from \"./scenes/Video\";\nimport { Composition } from \"remotion\";\n\nexport const RemotionRoot: React.FC = () => {\n  return (\n    <>\n      <Composition id=\"Video\" />\n    </>\n  );\n};\n";
        let a = wire_root(root, "Corte1").unwrap();
        assert!(a.starts_with("import { EditVideo, edlFrames } from \"./edit/EditVideo\";\nimport { EDL as EDL_Corte1 } from \"./edit/Corte1\";\n"), "{a}");
        assert!(a.contains("defaultProps={{ edl: EDL_Corte1 }}"));
        let b = wire_root(&a, "Corte2").unwrap();
        assert_eq!(b.matches("./edit/EditVideo").count(), 1);
        assert!(b.contains("id=\"Corte2\""));
        assert_eq!(wire_root(&b, "Corte2").unwrap(), b);
    }
}
