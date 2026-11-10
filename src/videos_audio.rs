//! Análise do áudio de um vídeo: picos de volume (tiros, explosões, gritos, risadas) que a legenda não pega.
//! O ffmpeg do Remotion entrega o áudio cru (mono, 16 bits); aqui ele vira volume a cada 0,1 s, comparado
//! com o volume normal dos 30 s em volta. Picos próximos viram um trecho (uma troca de tiros = vários picos).

use serde_json::{json, Value};

/// Janela de medida, em s.
const WIN: f64 = 0.1;
/// Janela do volume de referência, em s (para cada lado: 15 s).
const BASE: f64 = 30.0;

fn db(rms: f64) -> f64 {
    if rms <= 0.0 { -90.0 } else { (20.0 * (rms / 32768.0).log10()).max(-90.0) }
}

/// Volume (dB) a cada WIN segundos.
pub fn levels(samples: &[i16], rate: u32) -> Vec<f64> {
    let n = ((rate as f64 * WIN) as usize).max(1);
    samples
        .chunks(n)
        .map(|c| {
            let s: f64 = c.iter().map(|&x| (x as f64) * (x as f64)).sum();
            db((s / c.len() as f64).sqrt())
        })
        .collect()
}

fn median(v: &mut [f64]) -> f64 {
    if v.is_empty() {
        return -90.0;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[v.len() / 2]
}

/// Volume de referência por janela: a mediana dos 30 s em volta (calculada a cada 1 s).
fn baseline(lv: &[f64]) -> Vec<f64> {
    let half = (BASE / 2.0 / WIN) as usize;
    let step = (1.0 / WIN) as usize;
    let mut marks = vec![];
    let mut i = 0;
    while i < lv.len() {
        let a = i.saturating_sub(half);
        let b = (i + half).min(lv.len());
        marks.push(median(&mut lv[a..b].to_vec()));
        i += step;
    }
    (0..lv.len()).map(|i| marks[(i / step).min(marks.len() - 1)]).collect()
}

#[derive(Debug, Clone)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    pub peak: f64,
    pub hits: usize,
    /// dB acima do normal no pico
    pub over: f64,
    /// dB absoluto no pico
    pub level: f64,
}

impl Segment {
    fn score(&self) -> f64 {
        self.over + 3.0 * ((self.hits as f64) + 1.0).ln()
    }
}

/// Picos `min_db` acima do normal, agrupados em trechos (picos a menos de 4 s um do outro), do mais forte ao mais fraco.
/// `offset` = segundo do arquivo em que o áudio começa.
pub fn segments(lv: &[f64], offset: f64, min_db: f64) -> Vec<Segment> {
    let base = baseline(lv);
    // estouros: janelas acima do limite, juntando as que estão a até 0,3 s
    let mut events: Vec<(f64, f64, f64, f64, f64)> = vec![]; // início, fim, t do pico, acima, nível
    for (i, (&l, &b)) in lv.iter().zip(&base).enumerate() {
        let over = l - b;
        if over < min_db || l < -60.0 {
            continue;
        }
        let t = offset + i as f64 * WIN;
        match events.last_mut() {
            Some(e) if t - e.1 <= 0.3 => {
                e.1 = t + WIN;
                if over > e.3 {
                    (e.2, e.3, e.4) = (t, over, l);
                }
            }
            _ => events.push((t, t + WIN, t, over, l)),
        }
    }
    let mut segs: Vec<Segment> = vec![];
    for (a, b, p, over, level) in events {
        match segs.last_mut() {
            Some(s) if a - s.end <= 4.0 => {
                s.end = b;
                s.hits += 1;
                if over > s.over {
                    (s.peak, s.over, s.level) = (p, over, level);
                }
            }
            _ => segs.push(Segment { start: a, end: b, peak: p, hits: 1, over, level }),
        }
    }
    segs.sort_by(|a, b| b.score().partial_cmp(&a.score()).unwrap());
    segs
}

/// Volume médio por minuto, relativo à mediana do arquivo (as partes mais agitadas aparecem com +dB).
pub fn by_minute(lv: &[f64], offset: f64) -> Vec<(f64, f64)> {
    let all = median(&mut lv.iter().copied().filter(|&l| l > -80.0).collect::<Vec<_>>());
    let per = (60.0 / WIN) as usize;
    lv.chunks(per)
        .enumerate()
        .map(|(i, c)| {
            // média de energia, em dB (gritos e tiros pesam mais que o silêncio)
            let e: f64 = c.iter().map(|l| 10f64.powf(l / 10.0)).sum::<f64>() / c.len() as f64;
            (offset + i as f64 * 60.0, 10.0 * e.log10() - all)
        })
        .collect()
}

pub fn report(samples: &[i16], rate: u32, offset: f64, min_db: f64, top: usize) -> Value {
    let lv = levels(samples, rate);
    let segs = segments(&lv, offset, min_db);
    let total = segs.len();
    let r1 = |x: f64| (x * 10.0).round() / 10.0;
    let list: Vec<Value> = segs
        .iter()
        .take(top)
        .map(|s| json!({ "start": r1(s.start), "end": r1(s.end), "peak": r1(s.peak), "hits": s.hits, "over": r1(s.over), "level": r1(s.level) }))
        .collect();
    let minutes: Vec<Value> = by_minute(&lv, offset).into_iter().map(|(t, d)| json!({ "t": r1(t), "db": r1(d) })).collect();
    json!({ "segments": list, "total": total, "minutes": minutes, "seconds": r1(lv.len() as f64 * WIN) })
}

#[cfg(test)]
mod t {
    use super::*;

    /// Ruído baixo com rajadas fortes nos segundos dados.
    fn fake(secs: f64, bursts: &[f64], rate: u32) -> Vec<i16> {
        let n = (secs * rate as f64) as usize;
        (0..n)
            .map(|i| {
                let t = i as f64 / rate as f64;
                let loud = bursts.iter().any(|&b| t >= b && t < b + 0.15);
                let x = ((i * 7919) % 200) as f64 - 100.0;
                (if loud { x * 150.0 } else { x * 5.0 }) as i16
            })
            .collect()
    }

    #[test]
    fn acha_rajadas_e_agrupa() {
        let rate = 4000;
        // uma troca de tiros (4 picos seguidos em 30 s) e um grito isolado em 80 s
        let s = fake(120.0, &[30.0, 31.0, 32.5, 34.0, 80.0], rate);
        let r = report(&s, rate, 100.0, 8.0, 10);
        let segs = r["segments"].as_array().unwrap();
        assert_eq!(segs.len(), 2, "{r}");
        // a troca de tiros vem primeiro (mais picos), com o tempo já somado ao início (100 s)
        assert_eq!(segs[0]["hits"], 4);
        assert!((segs[0]["start"].as_f64().unwrap() - 130.0).abs() < 0.2);
        assert!((segs[1]["peak"].as_f64().unwrap() - 180.0).abs() < 0.2);
        assert_eq!(r["minutes"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn silencio_nao_tem_picos() {
        let r = report(&vec![0i16; 4000 * 20], 4000, 0.0, 8.0, 10);
        assert_eq!(r["total"], 0);
    }
}
