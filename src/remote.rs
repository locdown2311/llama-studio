//! APIs externas compatíveis com OpenAI (Groq, Gemini, Cerebras, OpenRouter, outro llama-server...).
//! A interface manda o pedido para /remote/v1/chat/completions?p=<provedor>; aqui entram o endereço, a chave
//! e o modelo daquele provedor (config.json), e saem os campos que só o llama.cpp entende. A chave nunca vai
//! para a página.

use axum::body::{Body, Bytes};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use std::time::Duration;

use crate::app::{ApiProvider, App};

/// Campos do llama.cpp que outros servidores recusam.
const LLAMA_ONLY: &[&str] = &["id_slot", "cache_prompt", "return_progress", "chat_template_kwargs", "reasoning_budget", "n_probs", "samplers", "timings_per_token", "_fixed", "_remote"];

fn err(status: StatusCode, msg: String) -> Response {
    (status, Json(json!({ "error": { "message": msg } }))).into_response()
}

/// Só o NVIDIA NIM (id "nvidia") tem limite de plano.
pub(crate) fn is_nim(c: &ApiProvider) -> bool {
    c.id.trim().eq_ignore_ascii_case("nvidia") || c.base.to_ascii_lowercase().contains("integrate.api.nvidia.com")
}

/// Falha no envio: limite de plano (por minuto ou por dia) ou erro de rede.
enum SendErr {
    /// Segundos para esperar antes de tentar de novo.
    Limit(u64, String),
    /// O provedor recusou com 429 (segundos, quem, o que ele disse).
    Refused(u64, String, String),
    /// Acabou o limite do dia (o número é o limite).
    Daily(u32, String),
    Net(reqwest::Error),
}

impl SendErr {
    fn msg(self) -> String {
        match self {
            SendErr::Limit(s, n) => LF!("Limite de pedidos por minuto de {n}: fila cheia. Tente de novo em {s}s.", "{n} requests-per-minute limit: queue full. Retry in {s}s."),
            SendErr::Daily(d, n) => LF!("{n} já fez os {d} pedidos do dia (o limite renova à meia-noite UTC).", "{n} already made its {d} requests for today (the limit resets at midnight UTC)."),
            SendErr::Refused(s, n, why) => LF!("{n} recusou o pedido (429{}). Tente de novo em {s}s.", "{n} refused the request (429{}). Retry in {s}s.", if why.is_empty() { String::new() } else { format!(": {why}") }),
            SendErr::Net(e) => chain(e),
        }
    }
    fn wait(&self) -> Option<u64> {
        match self {
            SendErr::Limit(s, _) | SendErr::Refused(s, _, _) => Some(*s),
            SendErr::Daily(..) => Some(3600),
            SendErr::Net(_) => None,
        }
    }
}

/// O corpo da resposta repassado à interface. Se a conexão com a API cai no meio, em vez de cortar (o
/// navegador mostra só "network error"), manda um último evento com o erro explicado e fecha direito; a
/// interface tenta de novo sozinha.
pub(crate) fn safe_stream(resp: reqwest::Response, who: String) -> impl futures_util::Stream<Item = Result<bytes::Bytes, std::convert::Infallible>> {
    use futures_util::StreamExt;
    let mut failed = false;
    resp.bytes_stream().filter_map(move |r| {
        let out = match r {
            _ if failed => None,
            Ok(b) => Some(Ok(b)),
            Err(e) => {
                failed = true;
                let why = if e.is_timeout() { L!("ficou 3 minutos sem mandar nada", "sent nothing for 3 minutes").to_string() } else { chain(e) };
                let msg = LF!("A conexão com {who} caiu no meio da resposta ({why}).", "The connection to {who} dropped mid-answer ({why}).");
                Some(Ok(bytes::Bytes::from(format!("\n\ndata: {}\n\n", json!({ "error": { "message": msg, "type": "stream_cut" } })))))
            }
        };
        std::future::ready(out)
    })
}

fn label(c: &ApiProvider) -> String {
    if is_nim(c) { "NVIDIA NIM".into() } else if !c.name.trim().is_empty() { c.name.trim().to_string() } else { c.id.clone() }
}

/// Contexto usado quando o provedor não informa o dele (a maioria dos modelos de API tem 128k ou mais).
pub const DEFAULT_CONTEXT: u32 = 131_072;

pub fn context_of(p: &ApiProvider) -> u32 {
    if p.context >= 1024 { p.context } else { DEFAULT_CONTEXT }
}

pub fn ready(p: &ApiProvider) -> bool {
    // a Cloudflare vem com "ID_DA_CONTA" no endereço até o usuário pôr o ID da conta
    !p.base.trim().is_empty() && !p.model.trim().is_empty() && !p.base.contains("ID_DA_CONTA")
}

/// O provedor pedido (ou o primeiro, se não vier id).
fn provider(app: &App, id: &str) -> Option<ApiProvider> {
    let c = app.cfg();
    c.api_providers.iter().find(|p| id.is_empty() || p.id == id).cloned()
}

/// Lista para a interface, sem as chaves.
pub fn public(app: &App) -> Value {
    json!(app.cfg().api_providers.iter().map(|p| json!({

        "id": p.id,
        "name": p.name,
        "base": p.base,

        "model": p.model,

        "fallbackModel": p.fallback_model,
        "retries": p.retries,
        "context": context_of(p),
        "contextSet": p.context >= 1024,
        "vision": p.vision,
        "nim": is_nim(p),
        "rpm": p.rpm,
        "rpd": p.rpd,
        "preserveThinking": p.preserve_thinking,
        "limited": crate::limits::rule(&app.cfg(), p).is_some(),

        "params": p.params,
        "thinkParams": p.think_params,
        "hasKey": !p.key.trim().is_empty() || !pool(p).is_empty(),
        "rotate": p.rotate,
        "keys": rot_public(p),
        "ready": ready(p)
    })).collect::<Vec<_>>())
}

/// Cliente próprio para a internet: respeita proxy do sistema (o
/// de app.http é só para o llama-server
/// local, sem proxy) e larga conexões paradas antes que o provedor
/// as feche.
fn client() -> &'static reqwest::Client {
    static C: std::sync::OnceLock<reqwest::Client> =
    std::sync::OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()

            .pool_idle_timeout(Duration::from_secs(8))
            .pool_max_idle_per_host(2)
            .tcp_keepalive(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(15))
            // tempo sem chegar nada (não o total): modelos que pensam muito ou respostas longas passavam dos
            // 5 minutos e a conexão era cortada no meio ("network error")
            .read_timeout(Duration::from_secs(180))
            .build()
            .expect("cliente das APIs externas")
    })
}
/// A API está neste computador (127.0.0.1, localhost)? Ex.: o Strata, um LM Studio, um vLLM local.
pub fn is_loopback(base: &str) -> bool {
    let host = base.split("://").nth(1).unwrap_or(base).split(['/', '?']).next().unwrap_or("");
    let host = host.rsplit_once('@').map(|x| x.1).unwrap_or(host);
    let host = if host.starts_with('[') { host.split(']').next().unwrap_or("").trim_start_matches('[') } else { host.split(':').next().unwrap_or("") };
    host.eq_ignore_ascii_case("localhost") || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// Cliente para uma API neste computador: nunca passa pelo proxy do sistema (um proxy do Windows, de VPN ou de
/// antivírus podia receber o 127.0.0.1 e a conexão falhava) e espera mais sem dados (modelos grandes divididos
/// entre placa, RAM e SSD podem levar minutos lendo o prompt antes da primeira palavra).
fn client_local() -> &'static reqwest::Client {
    static C: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .no_proxy()
            .pool_idle_timeout(Duration::from_secs(8))
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_secs(30 * 60))
            .build()
            .expect("cliente das APIs locais")
    })
}

fn client_for(base: &str) -> &'static reqwest::Client {
    if is_loopback(base) {
        client_local()
    } else {
        client()
    }
}

/// `side`: pedido que não é a conversa (explorador, auditor, tarefa de fundo); na fila do NIM ele cede a vez.
async fn send_with_retries(app: &App, c: &ApiProvider, model: &str, body_str: &str, max_retries: u32, side: bool, rotating: bool) -> Result<reqwest::Response, SendErr> {
    let mut attempt = 0u32;
    let limited = crate::limits::rule(&app.cfg(), c).is_some();

    loop {
        // este modelo levou 429 há pouco: espera ele (os outros modelos da mesma conta seguem normais)
        if limited {
            let w = app.limits.model_wait(app, c, model);
            if !w.is_zero() {
                // com rotação, outra chave pode estar livre: não espera esta
                if rotating || (side && w.as_secs() > 20) {
                    return Err(SendErr::Limit(w.as_secs() + 1, label(c)));
                }
                tokio::time::sleep(w).await;
            }
        }
        // API com limite (NIM ou configurado): espera uma vaga na janela de 60 s em vez de bater no limite
        // (as novas tentativas também contam); o limite do dia recusa na hora
        if limited {
            match app.limits.acquire(app, c, side, !rotating).await {
                Ok(()) => {}
                Err(crate::limits::Deny::Wait(w)) => return Err(SendErr::Limit(w, label(c))),
                Err(crate::limits::Deny::Daily(d)) => return Err(SendErr::Daily(d, label(c))),
            }
        }
        let mut rb = client_for(&c.base)
            .post(endpoint(&c.base, "chat/completions"))
            .timeout(Duration::from_secs(45 * 60))
            .header("Content-Type", "application/json")
            .header("User-Agent", "Llama-Studio");
        if !c.key.trim().is_empty() {
            rb = rb.bearer_auth(c.key.trim());
        }

        if c.base.contains("openrouter.ai") {
            rb = rb.header("X-Title", "Llama Studio");
        }

        let res = rb.body(body_str.to_string()).send().await;
        match res {

            Err(e) if (e.is_connect() || e.is_request() || e.is_timeout()) && attempt < max_retries => {
                attempt += 1;
                let delay = std::cmp::min(400 * attempt as u64, 2000);
                tokio::time::sleep(Duration::from_millis(delay)).await;
            }

            // a API recusou mesmo com a fila (outro programa na mesma chave): fecha a porta pelo tempo que ela
            // pedir; a próxima tentativa espera na fila em vez de insistir e gastar mais pedidos
            // a API recusou com 429 mesmo com a fila: é o modelo (sobrecarregado no provedor, cota própria) ou a conta
            // (outro programa na mesma chave). Bloqueia só esse modelo pelo tempo pedido e guarda o motivo para o
            // medidor mostrar; a próxima tentativa espera em vez de insistir e gastar mais pedidos
            Ok(r) if limited && r.status().as_u16() == 429 => {
                let secs = r.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<u64>().ok()).unwrap_or(15);
                let body = r.text().await.unwrap_or_default();
                let why = serde_json::from_str::<Value>(&body).ok()
                    .and_then(|v| v["error"]["message"].as_str().or(v["detail"].as_str()).or(v["message"].as_str()).or(v["title"].as_str()).map(str::to_string))
                    .unwrap_or_else(|| body.chars().take(200).collect());
                let why: String = why.trim().chars().take(200).collect();
                app.limits.refused(app, c, model, secs, &why);
                if rotating || attempt >= max_retries.max(1) {
                    return Err(SendErr::Refused(secs, format!("{} ({model})", label(c)), why));
                }
                attempt += 1;
            }

            // com rotação, 429 é com a próxima chave (não insiste nesta)
            Ok(r) if rotating && r.status().as_u16() == 429 => return Ok(r),
            Ok(r) if matches!(r.status().as_u16(), 429 | 500 | 502 | 503 | 529) && attempt < max_retries => {
                attempt += 1;
                let delay = std::cmp::min(1000 * attempt as u64, 3000);
                tokio::time::sleep(Duration::from_millis(delay)).await;
            }

            other => return other.map_err(SendErr::Net),
        }
    }
}
/// Envia um prompt em texto para a API configurada e retorna a string de resposta
pub async fn call_provider_direct(app: &App, provider_id: &str, prompt: &str) -> Result<String, String> {
    let Some(c) = provider(app, provider_id).filter(ready) else {
        return Err("API externa não configurada.".into());
    };

    let body = json!({
        "model": c.model.trim(),
        "messages": [{ "role": "user", "content": prompt }]
    });

    let max_retries = c.retries.unwrap_or(1).min(10);
    let sent = send_with_retries(app, &c, c.model.trim(), &body.to_string(), max_retries, true, false).await;

    match sent {
        Ok(resp) => {
            let bytes = resp.bytes().await.map_err(|e| chain(e))?;
            let json_resp: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            if let Some(content) = json_resp["choices"][0]["message"]["content"].as_str() {
                Ok(content.to_string())
            } else {
                Err(format!("Resposta inesperada: {}", json_resp))
            }
        }
        Err(e) => Err(e.msg()),
    }
}
/// O erro com as causas (o "error sending request" sozinho não diz se foi DNS, TLS, conexão recusada...).
pub fn chain(e: reqwest::Error) -> String {
    let e = e.without_url();
    let mut out = e.to_string();
    let mut src = std::error::Error::source(&e);
    while let Some(s) = src {
        let t = s.to_string();
        if !out.contains(&t) {
            out.push_str(": ");
            out.push_str(&t);
        }
        src = s.source();
    }
    out
}

fn endpoint(base: &str, path: &str) -> String {
    format!("{}/{}", base.trim().trim_end_matches('/'), path)
}

fn apply_think(o: &mut serde_json::Map<String, Value>, c: &ApiProvider, mode: Option<&str>) {
    let Some(mode) = mode.filter(|m| matches!(*m, "on" | "off" | "eco")) else { return };
    // O botão da conversa tem prioridade sobre o esforço fixo do provedor.
    o.remove("reasoning_effort");
    if let Some(fields) = c.think_params.get(mode) {
        for (k, val) in fields {
            if !matches!(k.as_str(), "model" | "messages" | "tools" | "stream" | "stream_options") {
                o.insert(k.clone(), val.clone());
            }
        }
    } else {
        o.insert("reasoning_effort".into(), json!(match mode { "on" => "high", "eco" => "low", _ => "none" }));
    }
}

pub async fn chat(app: &App, id: &str, body: Bytes, side: bool) -> Response {

    let Some(c) = provider(app, id).filter(ready) else {
        return err(StatusCode::BAD_REQUEST, L!("Essa API externa não está configurada.", "That external API is not configured.").into());
    };

    let Ok(mut v) = serde_json::from_slice::<Value>(&body) else {
        return err(StatusCode::BAD_REQUEST, L!("Pedido inválido.", "Invalid request.").into());
    };

    if let Some(o) = v.as_object_mut() {
        let think = o.remove("_think").and_then(|v| v.as_str().map(str::to_string));
        for k in LLAMA_ONLY {
            o.remove(*k);
        }

        // parâmetros escolhidos para este provedor: valem por cima dos do studio (menos os que definem o pedido)
        // se o botão da conversa já mandou reasoning_effort/reasoning_tokens, respeita (override por conversa)
        for (k, val) in &c.params {
            if !matches!(k.as_str(), "model" | "messages" | "tools" | "stream" | "stream_options")
                && !(matches!(k.as_str(), "reasoning_effort" | "reasoning_tokens") && o.contains_key(k))
            {
                o.insert(k.clone(), val.clone());
            }
        }
        apply_think(o, &c, think.as_deref());

        if o.get("stream").and_then(Value::as_bool).unwrap_or(false) {
            // o uso de tokens chega no último pedaço

            o.insert("stream_options".into(), json!({ "include_usage": true }));
        }
    }

    let prep_body = |m_name: &str| -> String {
        let mut v_clone = v.clone();

        if let Some(o) = v_clone.as_object_mut() {
            o.insert("model".into(), json!(m_name.trim()));
        }
        v_clone.to_string()
    };

    let max_retries = c.retries.unwrap_or(1).min(10);
    // rotação de chaves: tenta a chave da vez; se ela acabou, marca e passa na hora para a próxima
    let keys = pool(&c);
    if keys.len() > 1 {
        let order = rot_order(&c, &keys);
        let n = keys.len();
        let mut last_err: Option<Response> = None;
        for (pos, (i, key)) in order.iter().enumerate() {
            let ck = ApiProvider { key: key.clone(), ..c.clone() };
            let last = pos + 1 == order.len();
            let (sent, used_fb) = attempt(app, &ck, &prep_body, max_retries, side, !last).await;
            match exhausted(sent).await {
                Outcome::Ok(resp) => {
                    rot_ok(&c, *i);
                    return respond(resp, &c, used_fb, Some((*i + 1, n)));
                }
                Outcome::Spent(secs, why, fallback) => {
                    rot_block(&c, key, secs, &why);
                    last_err = Some(fallback);
                }
                Outcome::Fail(resp) => return resp,
            }
        }
        return last_err.unwrap_or_else(|| err(StatusCode::TOO_MANY_REQUESTS, LF!("Todas as {n} chaves de {} estão esgotadas.", "All {n} keys of {} are exhausted.", label(&c))));
    }
    let (sent, used_fallback) = attempt(app, &c, &prep_body, max_retries, side, false).await;
    match sent {
        Ok(resp) => respond(resp, &c, used_fallback, None),
        Err(e) => send_err(e),
    }
}

/// Um envio completo numa chave: o modelo principal e, se ele falhar, o reserva.
async fn attempt(app: &App, c: &ApiProvider, prep_body: &(dyn Fn(&str) -> String + Sync), max_retries: u32, side: bool, rotating: bool) -> (Result<reqwest::Response, SendErr>, bool) {
    let mut sent = send_with_retries(app, c, c.model.trim(), &prep_body(&c.model), max_retries, side, rotating).await;
    let mut used_fallback = false;

    let has_fallback = !c.fallback_model.trim().is_empty() && c.fallback_model.trim() != c.model.trim();
    if has_fallback {
        let needs_fallback = match &sent {
            Err(SendErr::Limit(..) | SendErr::Daily(..)) => false,
            // o modelo principal foi recusado (429): o reserva é outro modelo, pode estar livre
            Err(SendErr::Refused(..)) => true,
            Err(_) => true,
            Ok(r) => !r.status().is_success(),
        };
        if needs_fallback {
            let fb_res = send_with_retries(app, c, c.fallback_model.trim(), &prep_body(&c.fallback_model), max_retries, side, rotating).await;
            match fb_res {
                // Usa 'ref r2' para apenas referenciar a resposta ao checar o status, sem movê-la
                Ok(ref r2) if r2.status().is_success() => {
                    sent = fb_res;
                    used_fallback = true;
                }
                _ if sent.is_err() => {
                    sent = fb_res;
                    used_fallback = true;
                }
                _ => {}
            }
        }
    }

    (sent, used_fallback)
}

/// A resposta do provedor repassada para a interface (em fluxo).
fn respond(resp: reqwest::Response, c: &ApiProvider, used_fallback: bool, key: Option<(usize, usize)>) -> Response {
    let status = resp.status().as_u16();
    let mut out = Response::builder().status(status);
    for (k, val) in resp.headers() {
        if matches!(k.as_str(), "content-type" | "retry-after" | "x-ratelimit-remaining-requests" | "x-ratelimit-remaining-tokens") {
            out = out.header(k, val);
        }
    }
    if used_fallback {
        out = out.header("x-studio-fallback-model", c.fallback_model.trim());
    }
    if let Some((i, n)) = key {
        out = out.header("x-studio-key", format!("{i}/{n}"));
    }
    out.body(Body::from_stream(safe_stream(resp, label(c)))).unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

fn send_err(e: SendErr) -> Response {
    match e {
        e @ (SendErr::Limit(..) | SendErr::Daily(..) | SendErr::Refused(..)) => {
            let mut h = axum::http::HeaderMap::new();
            if let Ok(v) = e.wait().unwrap_or(30).to_string().parse::<axum::http::HeaderValue>() {
                h.insert(axum::http::header::RETRY_AFTER, v);
            }
            (StatusCode::TOO_MANY_REQUESTS, h, Json(json!({ "error": { "message": e.msg() } }))).into_response()
        }

        e => err(StatusCode::BAD_GATEWAY, LF!("API externa indisponível ({}).", "External API unavailable ({}).", e.msg())),
    }
}

/* ---- rotação de chaves ----
   A chave da vez fica fixa enquanto funciona (o cache do provedor é por chave). Quando ela acaba, fica de lado
   pelo tempo que o provedor pediu (429), até a meia-noite UTC (limite do dia, cota, crédito) ou uma hora (chave
   recusada), e a próxima entra na hora. Cada chave tem a própria fila e o próprio contador do dia. */

use std::collections::HashMap;

struct Rot {
    cur: usize,
    /// hash da chave -> (até quando, por quê)
    blocked: HashMap<u64, (std::time::Instant, String)>,
}
static ROT: std::sync::Mutex<Option<HashMap<String, Rot>>> = std::sync::Mutex::new(None);

fn khash(k: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    k.trim().hash(&mut h);
    h.finish()
}

/// As chaves da API: a lista da rotação (sem vazias e repetidas) ou só a chave única.
pub fn pool(c: &ApiProvider) -> Vec<String> {
    let mut v: Vec<String> = vec![];
    for k in c.keys.iter().chain(std::iter::once(&c.key)) {
        let k = k.trim();
        if !k.is_empty() && !v.iter().any(|x| x == k) {
            v.push(k.to_string());
        }
    }
    if !c.keys.is_empty() {
        // com rotação, a ordem é a da lista; a chave única antiga só entra se não estiver nela
        v.sort_by_key(|k| c.keys.iter().position(|x| x.trim() == k).unwrap_or(usize::MAX));
    }
    v
}

/// A ordem de tentativa: a da vez primeiro, depois as seguintes; as que estão de lado só no fim (a que volta antes primeiro).
fn rot_order(c: &ApiProvider, keys: &[String]) -> Vec<(usize, String)> {
    let mut g = ROT.lock().unwrap_or_else(|e| e.into_inner());
    let r = g.get_or_insert_with(HashMap::new).entry(c.id.clone()).or_insert(Rot { cur: 0, blocked: HashMap::new() });
    let now = std::time::Instant::now();
    r.blocked.retain(|_, (t, _)| *t > now);
    let n = keys.len();
    let start = r.cur % n;
    let (mut free, mut out): (Vec<(usize, String)>, Vec<(usize, String)>) = (vec![], vec![]);
    for j in 0..n {
        let i = (start + j) % n;
        if r.blocked.contains_key(&khash(&keys[i])) { out.push((i, keys[i].clone())) } else { free.push((i, keys[i].clone())) }
    }
    out.sort_by_key(|(_, k)| r.blocked.get(&khash(k)).map(|x| x.0));
    // todas de lado: tenta só a que volta antes (as outras acabariam do mesmo jeito)
    if free.is_empty() {
        out.truncate(1);
    }
    free.extend(out);
    free
}

fn rot_ok(c: &ApiProvider, i: usize) {
    let mut g = ROT.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(r) = g.get_or_insert_with(HashMap::new).get_mut(&c.id) {
        r.cur = i;
    }
}

fn rot_block(c: &ApiProvider, key: &str, secs: u64, why: &str) {
    let mut g = ROT.lock().unwrap_or_else(|e| e.into_inner());
    let r = g.get_or_insert_with(HashMap::new).entry(c.id.clone()).or_insert(Rot { cur: 0, blocked: HashMap::new() });
    r.blocked.insert(khash(key), (std::time::Instant::now() + Duration::from_secs(secs.max(5)), why.chars().take(200).collect()));
    let keys = pool(c);
    if let Some(i) = keys.iter().position(|k| k == key) {
        r.cur = (i + 1) % keys.len().max(1);
    }
}

fn until_midnight_utc() -> u64 {
    let s = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    86_400 - s % 86_400 + 30
}

enum Outcome {
    Ok(reqwest::Response),
    /// a chave acabou: segundos de lado, motivo, a resposta de erro (se for a última)
    Spent(u64, String, Response),
    /// erro que não é da chave (pedido inválido, servidor fora): volta como veio, sem trocar de chave
    Fail(Response),
}

/// A chave acabou, deu certo ou é outro erro?
async fn exhausted(sent: Result<reqwest::Response, SendErr>) -> Outcome {
    match sent {
        Ok(r) if r.status().is_success() => Outcome::Ok(r),
        Ok(r) => {
            let st = r.status().as_u16();
            let ra = r.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<u64>().ok());
            let body = r.text().await.unwrap_or_default();
            let low = body.to_lowercase();
            let quota = ["quota", "exceeded", "insufficient", "credit", "balance", "daily", "per day", "billing", "limit"].iter().any(|w| low.contains(w));
            let secs = match st {
                // cota, crédito, limite do dia: até a meia-noite UTC
                402 => until_midnight_utc(),
                429 if ["day", "daily", "quota", "credit", "balance"].iter().any(|w| low.contains(w)) => until_midnight_utc(),
                429 => ra.unwrap_or(60),
                401 | 403 if quota => until_midnight_utc(),
                // chave recusada (revogada, errada): uma hora
                401 | 403 => 3600,
                _ => return Outcome::Fail(passthrough(st, body)),
            };
            let msg: String = serde_json::from_str::<Value>(&body).ok()
                .and_then(|v| v["error"]["message"].as_str().or(v["detail"].as_str()).or(v["message"].as_str()).map(str::to_string))
                .unwrap_or_else(|| body.chars().take(200).collect());
            let why = format!("{st}: {}", msg.trim().chars().take(200).collect::<String>());
            let resp = err(StatusCode::TOO_MANY_REQUESTS, LF!("Todas as chaves recusaram; a última disse {why}.", "All keys were refused; the last one said {why}."));
            Outcome::Spent(secs, why, resp)
        }
        Err(e @ (SendErr::Daily(..) | SendErr::Limit(..) | SendErr::Refused(..))) => {
            let secs = match &e {
                SendErr::Daily(..) => until_midnight_utc(),
                SendErr::Limit(s, _) | SendErr::Refused(s, _, _) => (*s).max(5),
                _ => 60,
            };
            let why = e.msg();
            let mut h = axum::http::HeaderMap::new();
            if let Ok(v) = secs.min(86_400).to_string().parse::<axum::http::HeaderValue>() {
                h.insert(axum::http::header::RETRY_AFTER, v);
            }
            let resp = (StatusCode::TOO_MANY_REQUESTS, h, Json(json!({ "error": { "message": why.clone() } }))).into_response();
            Outcome::Spent(secs, why, resp)
        }
        Err(e) => Outcome::Fail(send_err(e)),
    }
}

/// Repassa um erro do provedor que não é de chave (400, 500...) como veio.
fn passthrough(st: u16, body: String) -> Response {
    Response::builder().status(st).header("content-type", "application/json").body(Body::from(body)).unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

/// Para a interface: as chaves mascaradas (só o fim), qual é a da vez e as que estão de lado.
fn rot_public(c: &ApiProvider) -> Value {
    let keys = pool(c);
    if keys.len() < 2 && !c.rotate {
        return Value::Null;
    }
    let g = ROT.lock().unwrap_or_else(|e| e.into_inner());
    let r = g.as_ref().and_then(|m| m.get(&c.id));
    let now = std::time::Instant::now();
    json!({
        "cur": r.map(|r| r.cur % keys.len().max(1)).unwrap_or(0),
        "list": keys.iter().map(|k| {
            let tail: String = k.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
            let b = r.and_then(|r| r.blocked.get(&khash(k))).filter(|(t, _)| *t > now);
            json!({ "tail": tail, "wait": b.map(|(t, _)| t.saturating_duration_since(now).as_secs()), "why": b.map(|(_, w)| w.clone()) })
        }).collect::<Vec<_>>(),
    })
}

/// A chave da vez (para listar modelos, testar e o medidor).
pub fn current(c: &ApiProvider) -> ApiProvider {
    let keys = pool(c);
    if keys.len() < 2 {
        return c.clone();
    }
    let i = rot_order(c, &keys).first().map(|x| x.0).unwrap_or(0);
    ApiProvider { key: keys[i].clone(), ..c.clone() }
}

/// Abre a conexão com o provedor antes do primeiro pedido (TLS pronto quando o auditor ou o explorador
/// precisar). Um HEAD na raiz do servidor: não conta como pedido de modelo.
pub async fn warm(app: &App, id: &str) {
    let Some(c) = provider(app, id) else { return };
    let Ok(u) = reqwest::Url::parse(c.base.trim()) else { return };
    let Ok(root) = u.join("/") else { return };
    let _ = client_for(root.as_str()).head(root).timeout(Duration::from_secs(5)).header("User-Agent", "llama-studio").send().await;
}

/// Testa se a API responde (ping leve). Retorna Ok se a API está online.
pub async fn ping(app: &App, id: &str) -> Result<(), String> {
    let c = current(&provider(app, id).ok_or_else(|| L!("API não encontrada.", "API not found.").to_string())?);
    if c.base.trim().is_empty() || c.model.trim().is_empty() {
        return Err(L!("Configuração incompleta.", "Incomplete configuration.").into());
    }
    // a Cloudflare não tem /models: confere o token (de usuário ou da conta)
    let urls: Vec<String> = match c.base.find("api.cloudflare.com/client/v4/accounts/") {
        Some(_) => {
            let acc = c.base.trim().trim_end_matches('/').trim_end_matches("/ai/v1").to_string();
            vec!["https://api.cloudflare.com/client/v4/user/tokens/verify".into(), format!("{acc}/tokens/verify")]
        }
        None => vec![endpoint(&c.base, "models")],
    };
    let mut last = String::new();
    for u in urls {
        let mut rb = client_for(&u).get(&u).timeout(Duration::from_secs(10)).header("User-Agent", "llama-studio");
        if !c.key.trim().is_empty() {
            rb = rb.bearer_auth(c.key.trim());
        }
        let resp = rb.send().await.map_err(chain)?;
        if resp.status().is_success() {
            return Ok(());
        }
        last = format!("HTTP {}", resp.status().as_u16());
    }
    Err(last)
}

/// Lista os modelos do provedor (GET /models), para escolher sem digitar.
pub async fn models(app: &App, id: &str) -> Result<Vec<String>, String> {
    let c = current(&provider(app, id).ok_or_else(|| L!("API não encontrada.", "API not found.").to_string())?);
    if c.base.trim().is_empty() {
        return Err(L!("Informe o endereço da API.", "Enter the API address.").into());
    }
    let mut rb = client_for(&c.base).get(endpoint(&c.base, "models")).timeout(Duration::from_secs(20)).header("User-Agent", "llama-studio");
    if !c.key.trim().is_empty() {
        rb = rb.bearer_auth(c.key.trim());
    }
    let resp = rb.send().await.map_err(chain)?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), text.chars().take(300).collect::<String>()));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let mut ids: Vec<String> = v["data"]
        .as_array()
        .or_else(|| v["models"].as_array())
        .map(|a| a.iter().filter_map(|m| m["id"].as_str().or_else(|| m["name"].as_str()).map(|s| s.trim_start_matches("models/").to_string())).collect())
        .unwrap_or_default();
    ids.sort();
    ids.dedup();
    Ok(ids)
}

#[cfg(test)]
mod t {
    use super::*;
    #[test]
    fn loopback() {
        assert!(is_loopback("http://127.0.0.1:8095/v1"));
        assert!(is_loopback("http://localhost:1234/v1"));
        assert!(is_loopback("http://[::1]:8080/v1"));
        assert!(!is_loopback("https://api.openai.com/v1"));
        assert!(!is_loopback("http://192.168.0.5:8080/v1"));
        assert!(!is_loopback("http://127.0.0.1.evil.com/v1"));
    }

    #[test]
    fn so_nvidia_e_limitado() {
        assert!(is_nim(&ApiProvider { id: "nvidia".into(), ..Default::default() }));
        assert!(is_nim(&ApiProvider { id: "openai".into(), base: "https://integrate.api.nvidia.com/v1".into(), ..Default::default() }));
        assert!(!is_nim(&ApiProvider { id: "openai".into(), base: "https://api.openai.com/v1".into(), ..Default::default() }));
    }

    #[test]
    fn pensar_usa_os_campos_do_provedor() {
        let mut c = ApiProvider::default();
        c.think_params.insert("on".into(), [("thinking".into(), json!({"type": "enabled"}))].into());
        let mut o = serde_json::Map::new();
        o.insert("reasoning_effort".into(), json!("low"));
        apply_think(&mut o, &c, Some("on"));
        assert_eq!(o.get("thinking"), Some(&json!({"type": "enabled"})));
        assert!(!o.contains_key("reasoning_effort"));
        apply_think(&mut o, &c, Some("off"));
        assert_eq!(o.get("reasoning_effort"), Some(&json!("none")));
    }
}
