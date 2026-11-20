//! Tarefas agendadas: um pedido que roda sozinho num horário (todo dia, em dias da semana, a cada N horas ou
//! uma vez), com o agente completo. A lista é editada na interface (chave "schedules" do estado da interface);
//! aqui, a cada 30 s, o studio vê o que venceu, cria a conversa (ou acrescenta o pedido na mesma de sempre) e
//! entrega para o executor em segundo plano, que notifica quando termina.
//!
//! O horário é o local de quem criou: cada tarefa guarda o fuso (minutos, como o getTimezoneOffset do
//! navegador). A última e a próxima execução ficam em dados/agenda.json, separadas da lista, para editar a
//! tarefa não fazer ela rodar de novo.

use serde_json::{json, Map, Value};
use std::sync::Arc;
use std::time::Duration;

use crate::app::App;

const DAY: u64 = 86_400_000;

fn now() -> u64 {
    crate::app::now_ms() as u64
}

fn state_file(app: &App) -> std::path::PathBuf {
    app.root.join("agenda.json")
}

fn load_state(app: &App) -> Map<String, Value> {
    std::fs::read(state_file(app)).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).and_then(|v| v.as_object().cloned()).unwrap_or_default()
}

fn save_state(app: &App, st: &Map<String, Value>) {
    let _ = std::fs::write(state_file(app), Value::Object(st.clone()).to_string());
}

/// O valor de uma chave do estado da interface (o arquivo guarda {"t", "v"}).
fn ui_get(app: &App, key: &str) -> Option<Value> {
    crate::uistate::get(app, key).map(|w| w["v"].clone()).filter(|v| !v.is_null())
}

pub fn schedules(app: &App) -> Vec<Value> {
    ui_get(app, "schedules").and_then(|v| v.as_array().cloned()).unwrap_or_default()
}

/// O que define quando roda: se mudar, a próxima execução é recalculada.
fn when_key(s: &Value) -> String {
    s["when"].to_string()
}

fn hhmm(t: &str) -> Option<u64> {
    let (h, m) = t.split_once(':')?;
    let (h, m) = (h.trim().parse::<u64>().ok()?, m.trim().parse::<u64>().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

/// Próxima execução depois de `after` (ms UTC), ou None quando não roda mais.
pub fn next_after(s: &Value, after: u64) -> Option<u64> {
    let w = &s["when"];
    let kind = w["kind"].as_str().unwrap_or("daily");
    // fuso: getTimezoneOffset (UTC - local, em minutos; Brasília = 180)
    let tz = w["tz"].as_i64().unwrap_or(0).clamp(-14 * 60, 14 * 60);
    let to_local = |utc: u64| (utc as i64 - tz * 60_000).max(0) as u64;
    let to_utc = |local: u64| (local as i64 + tz * 60_000).max(0) as u64;
    match kind {
        "once" => {
            let at = w["at"].as_u64()?;
            (at > after).then_some(at)
        }
        "hours" => {
            let every = w["every"].as_u64().unwrap_or(1).clamp(1, 24 * 30) * 3_600_000;
            let base = w["from"].as_u64().or_else(|| s["created"].as_u64()).unwrap_or(after);
            if base > after {
                return Some(base);
            }
            Some(base + ((after - base) / every + 1) * every)
        }
        _ => {
            let mins = hhmm(w["time"].as_str().unwrap_or("08:00"))?;
            let days: Vec<u64> = if kind == "weekly" {
                w["days"].as_array().map(|a| a.iter().filter_map(Value::as_u64).filter(|d| *d < 7).collect()).unwrap_or_default()
            } else {
                (0..7).collect()
            };
            if days.is_empty() {
                return None;
            }
            let local = to_local(after);
            let start = local / DAY * DAY;
            for d in 0..9 {
                let c = start + d * DAY + mins * 60_000;
                // 1/1/1970 foi quinta-feira (domingo = 0)
                let wd = (c / DAY + 4) % 7;
                if c > local && days.contains(&wd) {
                    return Some(to_utc(c));
                }
            }
            None
        }
    }
}

/// Cria a conversa (ou acrescenta o pedido na mesma) e põe na fila do executor.
pub fn fire(app: &App, s: &Value) -> Result<String, String> {
    let id = s["id"].as_str().ok_or("tarefa sem id")?;
    let name = s["name"].as_str().filter(|n| !n.trim().is_empty()).unwrap_or(L!("Tarefa agendada", "Scheduled task"));
    let prompt = s["prompt"].as_str().unwrap_or("").trim();
    if prompt.is_empty() {
        return Err(L!("A tarefa não tem pedido.", "The task has no request.").into());
    }
    let t = now();
    let note = LF!(
        "\n\n(Tarefa agendada \"{name}\", rodando sozinha: ninguém está olhando agora. Não pergunte; decida o que for preciso e diga no fim o que decidiu.)",
        "\n\n(Scheduled task \"{name}\", running on its own: nobody is watching right now. Do not ask; decide what you need and say at the end what you decided.)"
    );
    let content = format!("{prompt}{note}");
    let msg = json!({ "role": "user", "content": content, "parts": [{ "t": "text", "v": content }], "refs": [], "ts": t, "sched": id });
    // mesma conversa de sempre: acrescenta o pedido nela, se ainda existir
    if s["reuse"].as_bool() == Some(true) {
        if let Some(cid) = s["convId"].as_str().filter(|c| crate::uistate::valid_key(&format!("c-{c}"))) {
            if let Some(mut c) = ui_get(app, &format!("c-{cid}")).filter(|c| c["messages"].is_array()) {
                if let Some(a) = c["messages"].as_array_mut() {
                    a.push(msg.clone());
                }
                c["updatedAt"] = json!(t);
                crate::uistate::put(app, &format!("c-{cid}"), t, &c)?;
                crate::jobs::start(app, cid, name, "agenda")?;
                return Ok(cid.to_string());
            }
        }
    }
    let cid = format!("s{:x}{}", t, &id.chars().filter(|c| c.is_ascii_alphanumeric()).take(4).collect::<String>());
    let conv = json!({
        "id": cid, "title": name, "messages": [msg], "createdAt": t, "updatedAt": t, "autoApprove": false,
        "projectId": s["projectId"].as_str(), "personaId": Value::Null, "modelId": s["modelId"].as_str(),
        "think": s["think"].as_str(), "schedId": id,
    });
    crate::uistate::put(app, &format!("c-{cid}"), t, &conv)?;
    // "sempre na mesma conversa": a primeira execução cria e a tarefa passa a apontar para ela
    if s["reuse"].as_bool() == Some(true) {
        let mut list = schedules(app);
        if let Some(x) = list.iter_mut().find(|x| x["id"].as_str() == Some(id)) {
            x["convId"] = json!(cid);
            let _ = crate::uistate::put(app, "schedules", t, &Value::Array(list));
        }
    }
    crate::jobs::start(app, &cid, name, "agenda")?;
    Ok(cid)
}

/// Estado para a interface: última e próxima execução de cada tarefa.
pub fn state(app: &App) -> Value {
    let st = load_state(app);
    let mut out = Map::new();
    for s in schedules(app) {
        let Some(id) = s["id"].as_str() else { continue };
        let e = st.get(id).cloned().unwrap_or(json!({}));
        let next = if s["on"].as_bool() == Some(false) { None } else if e["key"].as_str() == Some(&when_key(&s)) { e["next"].as_u64() } else { next_after(&s, now()) };
        out.insert(id.into(), json!({ "last": e["last"], "lastConv": e["lastConv"], "lastError": e["lastError"], "next": next }));
    }
    Value::Object(out)
}

pub fn run_now(app: &App, id: &str) -> Result<Value, String> {
    let s = schedules(app).into_iter().find(|s| s["id"].as_str() == Some(id)).ok_or(L!("Tarefa não encontrada.", "Task not found."))?;
    let cid = fire(app, &s)?;
    let mut st = load_state(app);
    let e = st.entry(id.to_string()).or_insert(json!({}));
    e["last"] = json!(now());
    e["lastConv"] = json!(cid);
    e["lastError"] = Value::Null;
    save_state(app, &st);
    Ok(json!({ "conv": cid }))
}

/// Uma passada: roda o que venceu e recalcula as próximas.
fn tick(app: &App) -> Vec<(String, String)> {
    let mut st = load_state(app);
    let list = schedules(app);
    let t = now();
    let mut changed = false;
    let mut errors = vec![];
    for s in &list {
        let Some(id) = s["id"].as_str() else { continue };
        if s["on"].as_bool() == Some(false) {
            continue;
        }
        let key = when_key(s);
        let e = st.entry(id.to_string()).or_insert(json!({}));
        // nova ou com o horário mudado: só marca a próxima (não roda na hora de salvar)
        if e["key"].as_str() != Some(&key) {
            e["key"] = json!(key);
            e["next"] = json!(next_after(s, t));
            changed = true;
            continue;
        }
        let Some(next) = e["next"].as_u64() else { continue };
        if t < next {
            continue;
        }
        // venceu (ou venceu enquanto o PC estava desligado): roda uma vez e marca a próxima a partir de agora
        match fire(app, s) {
            Ok(cid) => {
                e["lastConv"] = json!(cid);
                e["lastError"] = Value::Null;
            }
            Err(err) => {
                e["lastError"] = json!(err);
                errors.push((s["name"].as_str().unwrap_or("").to_string(), err));
            }
        }
        e["last"] = json!(t);
        e["next"] = json!(next_after(s, t));
        changed = true;
    }
    // tarefas apagadas saem do estado
    let ids: std::collections::HashSet<&str> = list.iter().filter_map(|s| s["id"].as_str()).collect();
    let before = st.len();
    st.retain(|k, _| ids.contains(k.as_str()));
    if changed || st.len() != before {
        save_state(app, &st);
    }
    errors
}

pub async fn run(app: Arc<App>) {
    // espera o studio subir (o executor precisa da porta)
    tokio::time::sleep(Duration::from_secs(20)).await;
    loop {
        let a = app.clone();
        let errors = tokio::task::spawn_blocking(move || tick(&a)).await.unwrap_or_default();
        for (name, err) in errors {
            crate::cloud::notify(&app, &LF!("A tarefa agendada não rodou: {name}", "The scheduled task didn't run: {name}"), &err, "/").await;
        }
        tokio::time::sleep(Duration::from_secs(30)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 20/11/2026 03:00 em Brasília = 06:00 UTC (sexta-feira)
    const T: u64 = 1_795_154_400_000;

    #[test]
    fn todo_dia_no_horario_local() {
        let s = json!({"when": {"kind": "daily", "time": "08:00", "tz": 180}});
        // 08:00 em Brasília = 11:00 UTC do mesmo dia
        assert_eq!(next_after(&s, T), Some(T + 5 * 3_600_000));
        // depois das 8h: amanhã
        assert_eq!(next_after(&s, T + 6 * 3_600_000), Some(T + 5 * 3_600_000 + DAY));
    }

    #[test]
    fn dias_da_semana() {
        // só segunda (1): sexta 03:00 → segunda 08:00 = 3 dias depois
        let s = json!({"when": {"kind": "weekly", "time": "08:00", "days": [1], "tz": 180}});
        assert_eq!(next_after(&s, T), Some(T + 5 * 3_600_000 + 3 * DAY));
        let vazio = json!({"when": {"kind": "weekly", "time": "08:00", "days": [], "tz": 180}});
        assert_eq!(next_after(&vazio, T), None);
    }

    #[test]
    fn a_cada_horas_e_uma_vez() {
        let s = json!({"when": {"kind": "hours", "every": 6, "from": T}});
        assert_eq!(next_after(&s, T + 1), Some(T + 6 * 3_600_000));
        let o = json!({"when": {"kind": "once", "at": T + 100}});
        assert_eq!(next_after(&o, T), Some(T + 100));
        assert_eq!(next_after(&o, T + 200), None);
    }
}
