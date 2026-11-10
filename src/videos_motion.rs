//! "Seguir a ação" (focusX = "auto"): onde está o movimento em cada instante de um trecho, para o recorte
//! vertical andar junto. O ffmpeg do Remotion entrega quadros pequenos em cinza (PNG); aqui compara cada um
//! com o anterior e acha a faixa (da largura do recorte) com mais movimento. O resultado é suavizado para
//! a câmera não tremer.

use crate::videos_edl::Crop;

/// Quadros por segundo analisados.
pub const FPS: f64 = 4.0;
/// Largura dos quadros analisados, em pixels.
pub const W: u32 = 96;

/// Separa os PNGs de um image2pipe e decodifica cada um em cinza (largura, altura, pixels).
pub fn decode_pngs(bytes: &[u8]) -> Vec<(usize, usize, Vec<u8>)> {
    const SIG: &[u8] = b"\x89PNG\r\n\x1a\n";
    let mut out = vec![];
    let mut starts: Vec<usize> = bytes.windows(SIG.len()).enumerate().filter(|(_, w)| *w == SIG).map(|(i, _)| i).collect();
    starts.push(bytes.len());
    for w in starts.windows(2) {
        let dec = png::Decoder::new(std::io::Cursor::new(&bytes[w[0]..w[1]]));
        let Ok(mut r) = dec.read_info() else { continue };
        let Some(size) = r.output_buffer_size() else { continue };
        let mut buf = vec![0; size];
        let Ok(info) = r.next_frame(&mut buf) else { continue };
        let (wd, ht) = (info.width as usize, info.height as usize);
        let ch = match info.color_type {
            png::ColorType::Grayscale => 1,
            png::ColorType::GrayscaleAlpha => 2,
            png::ColorType::Rgb => 3,
            png::ColorType::Rgba => 4,
            _ => continue,
        };
        if info.bit_depth != png::BitDepth::Eight {
            continue;
        }
        let gray: Vec<u8> = buf[..wd * ht * ch].chunks(ch).map(|p| if ch >= 3 { ((p[0] as u32 + p[1] as u32 + p[2] as u32) / 3) as u8 } else { p[0] }).collect();
        out.push((wd, ht, gray));
    }
    out
}

/// Centro da faixa (largura `vw`, fração do quadro) com mais movimento, quadro a quadro, já suavizado.
/// `mask`: região a ignorar (a facecam, que mexe o tempo todo). Devolve [segundos desde o início, x].
pub fn track(frames: &[(usize, usize, Vec<u8>)], vw: f64, mask: Option<Crop>) -> Vec<[f64; 2]> {
    let vw = vw.clamp(0.05, 1.0);
    let lo = vw / 2.0;
    let hi = 1.0 - vw / 2.0;
    let mut raw: Vec<Option<f64>> = vec![];
    for pair in frames.windows(2) {
        let (w, h, a) = (&pair[0].0, &pair[0].1, &pair[0].2);
        let b = &pair[1].2;
        if pair[1].0 != *w || pair[1].1 != *h || a.len() != b.len() {
            raw.push(None);
            continue;
        }
        let (w, h) = (*w, *h);
        let mut col = vec![0f64; w];
        for y in 0..h {
            for x in 0..w {
                if let Some(m) = mask {
                    let (fx, fy) = ((x as f64 + 0.5) / w as f64, (y as f64 + 0.5) / h as f64);
                    if fx >= m.x && fx <= m.x + m.w && fy >= m.y && fy <= m.y + m.h {
                        continue;
                    }
                }
                let d = (a[y * w + x] as f64 - b[y * w + x] as f64).abs();
                if d > 12.0 {
                    col[x] += d;
                }
            }
        }
        let total: f64 = col.iter().sum();
        if total < (w * h) as f64 * 0.4 {
            // quase parado: mantém onde estava
            raw.push(None);
            continue;
        }
        // a janela da largura do recorte com mais movimento
        let win = ((vw * w as f64).round() as usize).clamp(1, w);
        let mut best = (0.0, 0usize);
        let mut sum: f64 = col[..win].iter().sum();
        for start in 0..=(w - win) {
            if start > 0 {
                sum += col[start + win - 1] - col[start - 1];
            }
            if sum > best.0 {
                best = (sum, start);
            }
        }
        // movimento espalhado pelo quadro todo (câmera andando): fica no meio
        if best.0 < total * (vw + (1.0 - vw) * 0.35) {
            raw.push(Some(0.5));
            continue;
        }
        // várias janelas empatam quando o que mexe é menor que a janela: o centro vai para o meio do movimento
        let inside = &col[best.1..best.1 + win];
        let e: f64 = inside.iter().sum();
        let cx = best.1 as f64 + inside.iter().enumerate().map(|(i, v)| (i as f64 + 0.5) * v).sum::<f64>() / e.max(1e-9);
        raw.push(Some((cx / w as f64).clamp(lo, hi)));
    }
    if raw.iter().all(Option::is_none) {
        return vec![];
    }
    // buracos: o último valor conhecido (no começo, o primeiro)
    let first = raw.iter().flatten().next().copied().unwrap_or(0.5);
    let mut last = first;
    let filled: Vec<f64> = raw
        .iter()
        .map(|v| {
            if let Some(v) = v {
                last = *v;
            }
            last
        })
        .collect();
    // mediana de 5 (tira saltos de um quadro) e depois velocidade máxima de 0,3 da largura por segundo
    let med: Vec<f64> = (0..filled.len())
        .map(|i| {
            let a = i.saturating_sub(2);
            let b = (i + 3).min(filled.len());
            let mut v = filled[a..b].to_vec();
            v.sort_by(|x, y| x.partial_cmp(y).unwrap());
            v[v.len() / 2]
        })
        .collect();
    let step = 0.3 / FPS;
    let mut x = med[0];
    let mut out = vec![];
    for (i, &m) in med.iter().enumerate() {
        x += (m - x).clamp(-step, step);
        // um ponto a cada 0,5 s basta (o modelo interpola entre eles)
        if i % 2 == 0 || i + 1 == med.len() {
            let t = (i as f64 + 1.0) / FPS;
            out.push([(t * 100.0).round() / 100.0, (x * 1000.0).round() / 1000.0]);
        }
    }
    out.insert(0, [0.0, out[0][1]]);
    out
}

#[cfg(test)]
mod t {
    use super::*;

    /// Quadros 96x54 com um quadrado que anda da esquerda para a direita.
    fn moving(n: usize) -> Vec<(usize, usize, Vec<u8>)> {
        (0..n)
            .map(|k| {
                let (w, h) = (96usize, 54usize);
                let cx = 10 + k * 3;
                let mut p = vec![20u8; w * h];
                for y in 20..34 {
                    for x in cx..(cx + 8).min(w) {
                        p[y * w + x] = 230;
                    }
                }
                (w, h, p)
            })
            .collect()
    }

    #[test]
    fn segue_o_movimento() {
        let t = track(&moving(24), 0.316, None);
        assert!(t.len() > 5);
        let (a, b) = (t[1][1], t[t.len() - 1][1]);
        assert!(b > a + 0.2, "{t:?}");
        // nunca sai do quadro
        assert!(t.iter().all(|p| p[1] >= 0.158 - 1e-9 && p[1] <= 0.842 + 1e-9));
    }

    #[test]
    fn mascara_ignora_a_facecam() {
        // só a facecam mexe (canto direito, mascarado): sem movimento útil
        let mut f = moving(1);
        f.push(f[0].clone());
        let m = Crop { x: 0.0, y: 0.0, w: 0.3, h: 1.0 };
        assert!(track(&f, 0.316, Some(m)).is_empty());
    }

    #[test]
    fn le_pngs_emendados() {
        let mut bytes = vec![];
        for v in [10u8, 200] {
            let mut e = png::Encoder::new(&mut bytes, 4, 2);
            e.set_color(png::ColorType::Grayscale);
            e.set_depth(png::BitDepth::Eight);
            e.write_header().unwrap().write_image_data(&[v; 8]).unwrap();
        }
        let f = decode_pngs(&bytes);
        assert_eq!(f.len(), 2);
        assert_eq!((f[1].0, f[1].1, f[1].2[0]), (4, 2, 200));
    }
}
