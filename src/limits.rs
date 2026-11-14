//! Limites das APIs externas: uma fila por conta (mesmo endereço e mesma chave = mesma conta, como os vários
//! perfis do NIM), com o limite por minuto da fila (nim.rs) e um contador diário. O NIM vem com 40 por minuto
//! sem configurar nada; nas outras APIs o limite é o que a pessoa puser na API (pedidos por minuto e/ou por dia).

use crate::app::{ApiProvider, App, Config};
use crate::nim::Nim;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};

pub struct Rule {
    pub key: String,
    pub rpm: usize,
    pub rpd: u32,
    pub nim: bool,
}

#[derive(Default)]
struct Days {
    date: String,
    counts: HashMap<String, u32>,
    loaded: bool,
}

/// Um 429 do provedor para um modelo: até quando esperar e o que ele disse.
struct Refusal {
    until: std::time::Instant,
    at: std::time::Instant,
    why: String,
    used: usize,
}

#[derive(Default)]
pub struct Limits {
    queues: Mutex<HashMap<String, Arc<Nim>>>,
    days: Mutex<Days>,
    /// conta|modelo -> último 429
    refusals: Mutex<HashMap<String, Refusal>>,
}

pub enum Deny {
    /// fila do minuto cheia: segundos que faltariam
    Wait(u64),
    /// o limite do dia acabou
    Daily(u32),
}

fn host(base: &str) -> String {
    let b = base.trim().trim_end_matches('/').to_lowercase();
    let b = b.split("://").nth(1).unwrap_or(&b).to_string();
    b.split('/').next().unwrap_or("").to_string()
}

/// A conta: endereço + chave (a chave vira um número, nunca o texto).
fn account(c: &ApiProvider) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    c.key.trim().hash(&mut h);
    format!("{}#{:x}", host(&c.base), h.finish())
}

fn own(c: &ApiProvider) -> (usize, u32) {
    let rpm = if c.rpm > 0 { c.rpm as usize } else if crate::remote::is_nim(c) { crate::nim::MAX } else { 0 };
    (rpm, c.rpd)
}

/// A regra da API: o menor limite entre as APIs da mesma conta (o limite é da conta, não do perfil).
pub fn rule(cfg: &Config, c: &ApiProvider) -> Option<Rule> {
    let key = account(c);
    let (mut rpm, mut rpd) = own(c);
    for o in cfg.api_providers.iter().filter(|o| o.id != c.id && account(o) == key) {
        let (r, d) = own(o);
        if r > 0 && (rpm == 0 || r < rpm) {
            rpm = r;
        }
        if d > 0 && (rpd == 0 || d < rpd) {
            rpd = d;
        }
    }
    (rpm > 0 || rpd > 0).then(|| Rule { key, rpm, rpd, nim: crate::remote::is_nim(c) })
}

fn today() -> String {
    // o dia dos provedores costuma virar à meia-noite UTC
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    (secs / 86_400).to_string()
}

impl Limits {
    fn queue(&self, r: &Rule) -> Arc<Nim> {
        let mut q = self.queues.lock().unwrap_or_else(|e| e.into_inner());
        let n = q.entry(r.key.clone()).or_insert_with(|| Arc::new(Nim::with_rpm(r.rpm))).clone();
        n.set_rpm(r.rpm);
        n
    }

    fn days(&self, app: &App) -> std::sync::MutexGuard<'_, Days> {
        let mut d = self.days.lock().unwrap_or_else(|e| e.into_inner());
        if !d.loaded {
            d.loaded = true;
            if let Some(v) = std::fs::read_to_string(app.root.join("limites.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
                d.date = v["date"].as_str().unwrap_or("").to_string();
                d.counts = serde_json::from_value(v["counts"].clone()).unwrap_or_default();
            }
        }
        let t = today();
        if d.date != t {
            d.date = t;
            d.counts.clear();
        }
        d
    }

    fn day_used(&self, app: &App, key: &str) -> u32 {
        self.days(app).counts.get(key).copied().unwrap_or(0)
    }

    fn count_day(&self, app: &App, key: &str) {
        let mut d = self.days(app);
        *d.counts.entry(key.to_string()).or_default() += 1;
        let v = json!({ "date": d.date, "counts": d.counts });
        let _ = std::fs::write(app.root.join("limites.json"), v.to_string());
    }

    /// Espera a vaga do minuto e confere o dia. `side`: explorador, auditor, tarefa de fundo.
    pub async fn acquire(&self, app: &App, c: &ApiProvider, side: bool) -> Result<(), Deny> {
        let Some(r) = rule(&app.cfg(), c) else { return Ok(()) };
        if r.rpd > 0 && self.day_used(app, &r.key) >= r.rpd {
            return Err(Deny::Daily(r.rpd));
        }
        if r.rpm > 0 {
            self.queue(&r).acquire(side).await.map_err(Deny::Wait)?;
        }
        if r.rpd > 0 || r.rpm > 0 {
            self.count_day(app, &r.key);
        }
        Ok(())
    }

    /// O provedor recusou (429) um modelo: só ele espera `secs` (outro modelo da mesma conta pode estar livre;
    /// no NVIDIA o 429 com a fila folgada costuma ser o modelo sobrecarregado, não a sua cota).
    pub fn refused(&self, app: &App, c: &ApiProvider, model: &str, secs: u64, why: &str) {
        let Some(r) = rule(&app.cfg(), c) else { return };
        let used = if r.rpm > 0 { self.queue(&r).status().used as usize } else { 0 };
        let now = std::time::Instant::now();
        let until = now + std::time::Duration::from_secs(secs.clamp(2, 120));
        self.refusals.lock().unwrap_or_else(|e| e.into_inner()).insert(format!("{}|{}", r.key, model), Refusal { until, at: now, why: why.to_string(), used });
        // muitos modelos recusados juntos = é a conta: segura a fila inteira também
        let now2 = std::time::Instant::now();
        let recent = self.refusals.lock().unwrap_or_else(|e| e.into_inner()).iter().filter(|(k, v)| k.starts_with(&format!("{}|", r.key)) && now2.saturating_duration_since(v.at).as_secs() < 30).count();
        if recent >= 3 && r.rpm > 0 {
            self.queue(&r).block(secs);
        }
    }

    /// Quanto este modelo ainda tem de esperar por causa de um 429.
    pub fn model_wait(&self, app: &App, c: &ApiProvider, model: &str) -> std::time::Duration {
        let Some(r) = rule(&app.cfg(), c) else { return Default::default() };
        let now = std::time::Instant::now();
        self.refusals.lock().unwrap_or_else(|e| e.into_inner()).get(&format!("{}|{}", r.key, model)).map(|x| x.until.saturating_duration_since(now)).unwrap_or_default()
    }

    /// Para o medidor da conversa.
    pub fn status(&self, app: &App, c: &ApiProvider) -> Value {
        let Some(r) = rule(&app.cfg(), c) else { return json!({ "limited": false }) };
        let day = self.day_used(app, &r.key);
        let mut v = json!({ "limited": true, "nim": r.nim, "max": r.rpm, "rpd": r.rpd, "day": day, "window_secs": crate::nim::WINDOW.as_secs() });
        if r.rpm > 0 {
            let s = self.queue(&r).status();
            let budget = crate::nim::budget_of(r.rpm);
            v["used"] = json!(s.used);
            v["wait_secs"] = json!(s.wait_secs);
            v["waiting"] = json!(s.waiting);
            v["free"] = json!(s.free);
            v["next_secs"] = json!(s.next_secs);
            v["budget"] = json!(budget);
            v["reserve"] = json!(crate::nim::reserve_of(budget));
        }
        // o último 429 deste modelo (nos últimos 5 minutos): o medidor diz que foi o provedor, não a fila
        let now = std::time::Instant::now();
        if let Some(x) = self.refusals.lock().unwrap_or_else(|e| e.into_inner()).get(&format!("{}|{}", r.key, c.model.trim())) {
            let ago = now.saturating_duration_since(x.at).as_secs();
            if ago < 300 {
                let wait = x.until.saturating_duration_since(now);
                v["refused"] = json!({ "model": c.model.trim(), "why": x.why, "ago": ago, "wait": if wait.is_zero() { 0 } else { wait.as_secs() + 1 }, "used": x.used });
            }
        }
        v
    }
}

#[cfg(test)]
mod t {
    use super::*;

    fn p(id: &str, base: &str, key: &str, rpm: u32, rpd: u32) -> ApiProvider {
        ApiProvider { id: id.into(), base: base.into(), key: key.into(), rpm, rpd, ..Default::default() }
    }

    #[test]
    fn mesma_conta_divide_o_limite() {
        let cfg = Config {
            api_providers: vec![
                p("a", "https://integrate.api.nvidia.com/v1", "k1", 0, 0),
                p("b", "https://integrate.api.nvidia.com/v1/", "k1", 0, 0),
                p("c", "https://openrouter.ai/api/v1", "k2", 20, 50),
                p("d", "https://openrouter.ai/api/v1", "k2", 0, 0),
                p("e", "https://api.groq.com/openai/v1", "k3", 0, 0),
            ],
            ..Default::default()
        };
        let ra = rule(&cfg, &cfg.api_providers[0]).unwrap();
        let rb = rule(&cfg, &cfg.api_providers[1]).unwrap();
        assert_eq!((ra.key == rb.key, ra.rpm, ra.nim), (true, 40, true));
        // o limite posto num perfil vale para os outros perfis da mesma conta
        let rd = rule(&cfg, &cfg.api_providers[3]).unwrap();
        assert_eq!((rd.rpm, rd.rpd), (20, 50));
        assert!(rule(&cfg, &cfg.api_providers[4]).is_none());
        assert!(!ra.key.contains("k1"));
    }
}
