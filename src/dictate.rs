//! Ditado por voz no campo de mensagem: a interface grava o microfone e manda um WAV (16 kHz, mono); aqui o
//! whisper.cpp transcreve no próprio PC. Usa a mesma instalação do Whisper das legendas de vídeo
//! (dados/whisper/whisper.cpp); se ainda não houver, `setup` baixa o programa (Windows) e o modelo.

use crate::app::App;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// A mesma versão que as legendas de vídeo instalam.
const WHISPER_VERSION: &str = "1.5.5";
const MODELS: &[&str] = &["large-v3-turbo", "medium", "small", "base"];

fn dir(app: &App) -> PathBuf {
    app.root.join("whisper").join("whisper.cpp")
}

fn exe(d: &Path) -> Option<PathBuf> {
    ["main.exe", "main", "whisper-cli.exe", "whisper-cli"].iter().map(|n| d.join(n)).find(|p| p.is_file())
}

fn model_ok(d: &Path, m: &str) -> bool {
    std::fs::metadata(d.join(format!("ggml-{m}.bin"))).is_ok_and(|md| md.len() > 10 * 1024 * 1024)
}

/// O modelo pedido se estiver baixado; senão o melhor que houver (para ditado, rapidez conta: small antes de medium).
fn pick_model(d: &Path, want: &str) -> Option<String> {
    if !want.is_empty() && model_ok(d, want) {
        return Some(want.to_string());
    }
    ["small", "base", "large-v3-turbo", "medium"].iter().find(|m| model_ok(d, m)).map(|m| m.to_string())
}

pub fn status(app: &App) -> Value {
    let d = dir(app);
    let models: Vec<&str> = MODELS.iter().copied().filter(|m| model_ok(&d, m)).collect();
    json!({ "installed": exe(&d).is_some(), "models": models, "canSetup": cfg!(windows) })
}

/// Baixa o whisper.cpp (Windows: o pacote pronto do GitHub) e um modelo.
pub async fn setup(app: &App, model: &str) -> Result<Value, String> {
    let d = dir(app);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    if exe(&d).is_none() {
        if !cfg!(windows) {
            return Err(L!("Neste sistema o Whisper é instalado pelas legendas de vídeo: gere uma legenda uma vez na página Vídeos.", "On this system Whisper is installed by the video captions: generate captions once on the Videos page.").into());
        }
        let url = format!("https://github.com/ggerganov/whisper.cpp/releases/download/v{WHISPER_VERSION}/whisper-bin-x64.zip");
        let (status, bytes) = crate::update::fetch(app, &url, false, Duration::from_secs(600)).await?;
        if status != 200 {
            return Err(LF!("Download do Whisper falhou ({status}).", "Whisper download failed ({status})."));
        }
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
            if f.is_dir() {
                continue;
            }
            // os arquivos ficam soltos na pasta (main.exe, whisper.dll...)
            let Some(name) = f.enclosed_name().and_then(|p| p.file_name().map(|n| n.to_owned())) else { continue };
            let mut buf = vec![];
            std::io::Read::read_to_end(&mut f, &mut buf).map_err(|e| e.to_string())?;
            std::fs::write(d.join(name), buf).map_err(|e| e.to_string())?;
        }
    }
    let model = if MODELS.contains(&model) { model } else { "base" };
    if !model_ok(&d, model) {
        let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model}.bin");
        let (status, bytes) = crate::update::fetch(app, &url, false, Duration::from_secs(1800)).await?;
        if status != 200 || bytes.len() < 10 * 1024 * 1024 {
            return Err(LF!("Download do modelo {model} falhou ({status}).", "Download of the {model} model failed ({status})."));
        }
        let tmp = d.join(format!("ggml-{model}.bin.part"));
        std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, d.join(format!("ggml-{model}.bin"))).map_err(|e| e.to_string())?;
    }
    Ok(status(app))
}

/// Transcreve um WAV.
pub async fn transcribe(app: &App, wav: &[u8], lang: &str, model: &str) -> Result<Value, String> {
    let d = dir(app);
    let Some(bin) = exe(&d) else { return Ok(json!({ "needSetup": true })) };
    let Some(model) = pick_model(&d, model) else { return Ok(json!({ "needSetup": true })) };
    if wav.len() < 44 || &wav[..4] != b"RIFF" {
        return Err(L!("Áudio inválido.", "Invalid audio.").into());
    }
    let tmp = std::env::temp_dir().join(format!("llama-studio-ditado-{}.wav", std::process::id()));
    std::fs::write(&tmp, wav).map_err(|e| e.to_string())?;
    let lang: String = lang.chars().filter(|c| c.is_ascii_alphabetic()).take(5).collect::<String>().to_lowercase();
    let threads = std::thread::available_parallelism().map(|n| (n.get() / 2).clamp(2, 8)).unwrap_or(4).to_string();
    let m = d.join(format!("ggml-{model}.bin")).to_string_lossy().to_string();
    let f = tmp.to_string_lossy().to_string();
    let lang_arg = if lang.is_empty() { "auto".to_string() } else { lang };
    let mut c = tokio::process::Command::new(&bin);
    c.args(["-m", &m, "-f", &f, "-l", &lang_arg, "-nt", "-np", "-t", &threads]).current_dir(&d).kill_on_drop(true);
    #[cfg(windows)]
    {
        c.creation_flags(crate::CREATE_NO_WINDOW);
    }
    let out = tokio::time::timeout(Duration::from_secs(300), c.output()).await;
    let _ = std::fs::remove_file(&tmp);
    let out = out.map_err(|_| L!("O Whisper demorou demais.", "Whisper took too long.").to_string())?.map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(LF!("O Whisper falhou: {}", "Whisper failed: {}", err.lines().last().unwrap_or("").trim()));
    }
    let text = clean(&String::from_utf8_lossy(&out.stdout));
    Ok(json!({ "text": text, "model": model }))
}

/// Junta as linhas e tira as marcas que o Whisper põe no silêncio ([BLANK_AUDIO], (música)...).
fn clean(s: &str) -> String {
    let mut out = String::new();
    for line in s.lines() {
        let mut l = line.trim().to_string();
        while let Some(a) = l.find(['[', '(']) {
            let close = if l[a..].starts_with('[') { ']' } else { ')' };
            match l[a..].find(close) {
                Some(b) => l.replace_range(a..a + b + 1, ""),
                None => break,
            }
        }
        let l = l.trim();
        if !l.is_empty() {
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str(l);
        }
    }
    out
}

#[cfg(test)]
mod t {
    #[test]
    fn limpa_marcas() {
        assert_eq!(super::clean(" [BLANK_AUDIO]\n Olá, tudo bem?\n (música) e você?\n"), "Olá, tudo bem? e você?");
    }
}
