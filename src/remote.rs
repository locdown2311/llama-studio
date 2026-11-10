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
fn is_nim(c: &ApiProvider) -> bool {
    c.id.trim().eq_ignore_ascii_case("nvidia") || c.base.to_ascii_lowercase().contains("integrate.api.nvidia.com")
}

/// Falha no envio: limite de plano (NIM) ou erro de rede.
enum SendErr {
    /// Segundos para esperar antes de tentar de novo.
    Limit(u64),
    Net(reqwest::Error),
}

impl SendErr {
    fn msg(self) -> String {
        match self {
            SendErr::Limit(s) => LF!("Limite do NVIDIA NIM: 40 pedidos por minuto. Fila cheia. Tente de novo em {}s.", "NVIDIA NIM limit: 40 requests per minute. Queue full. Retry in {}s.", s),
            SendErr::Net(e) => chain(e),
        }
    }
}

/// Contexto usado quando o provedor não informa o dele (a maioria dos modelos de API tem 128k ou mais).
pub const DEFAULT_CONTEXT: u32 = 131_072;

pub fn context_of(p: &ApiProvider) -> u32 {
    if p.context >= 1024 { p.context } else { DEFAULT_CONTEXT }
}

pub fn ready(p: &ApiProvider) -> bool {
    !p.base.trim().is_empty() && !p.model.trim().is_empty()
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

        "params": p.params,
        "thinkParams": p.think_params,
        "hasKey": !p.key.trim().is_empty(),
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
            .build()
            .expect("cliente das APIs externas")
    })
}
/// `side`: pedido que não é a conversa (explorador, auditor, tarefa de fundo); na fila do NIM ele cede a vez.
async fn send_with_retries(app: &App, c: &ApiProvider, body_str: &str, max_retries: u32, side: bool) -> Result<reqwest::Response, SendErr> {
    let mut attempt = 0u32;
    let nim = is_nim(c);

    loop {
        // NIM: espera uma vaga na janela de 60 s em vez de bater no limite (as novas tentativas também contam)
        if nim {
            if let Err(wait) = app.nim.acquire(side).await {
                return Err(SendErr::Limit(wait));
            }
        }
        let mut rb = client()
            .post(endpoint(&c.base, "chat/completions"))
            .timeout(Duration::from_secs(300))
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

            // o NIM recusou mesmo com a fila (outro programa na mesma chave): fecha a porta pelo tempo que ele
            // pedir; a próxima tentativa espera na fila em vez de insistir e gastar mais pedidos
            Ok(r) if nim && r.status().as_u16() == 429 => {
                let secs = r.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<u64>().ok()).unwrap_or(15);
                app.nim.block(secs);
                if attempt >= max_retries.max(1) {
                    return Ok(r);
                }
                attempt += 1;
            }

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
    let sent = send_with_retries(app, &c, &body.to_string(), max_retries, true).await;

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
fn chain(e: reqwest::Error) -> String {
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
    let mut sent = send_with_retries(app, &c, &prep_body(&c.model), max_retries, side).await;
    let mut used_fallback = false;

    let has_fallback = !c.fallback_model.trim().is_empty() && c.fallback_model.trim() != c.model.trim();
    if has_fallback {
        let needs_fallback = match &sent {
            Err(SendErr::Limit(_)) => false,
            Err(_) => true,
            Ok(r) => !r.status().is_success(),
        };
        if needs_fallback {
            let fb_res = send_with_retries(app, &c, &prep_body(&c.fallback_model), max_retries, side).await;
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

    match sent {
        Ok(resp) => {
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

            out.body(Body::from_stream(resp.bytes_stream())).unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
        }

        Err(SendErr::Limit(wait)) => {
            let mut h = axum::http::HeaderMap::new();
            if let Ok(v) = wait.to_string().parse::<axum::http::HeaderValue>() {
                h.insert(axum::http::header::RETRY_AFTER, v);
            }
            (StatusCode::TOO_MANY_REQUESTS, h, Json(json!({ "error": { "message": SendErr::Limit(wait).msg() } }))).into_response()
        }

        Err(e) => err(StatusCode::BAD_GATEWAY, LF!("API externa indisponível ({}).", "External API unavailable ({}).", e.msg())),
    }
}

/// Abre a conexão com o provedor antes do primeiro pedido (TLS pronto quando o auditor ou o explorador
/// precisar). Um HEAD na raiz do servidor: não conta como pedido de modelo.
pub async fn warm(app: &App, id: &str) {
    let Some(c) = provider(app, id) else { return };
    let Ok(u) = reqwest::Url::parse(c.base.trim()) else { return };
    let Ok(root) = u.join("/") else { return };
    let _ = client().head(root).timeout(Duration::from_secs(5)).header("User-Agent", "llama-studio").send().await;
}

/// Testa se a API responde (ping leve). Retorna Ok se a API está online.
pub async fn ping(app: &App, id: &str) -> Result<(), String> {
    let c = provider(app, id).ok_or_else(|| L!("API não encontrada.", "API not found.").to_string())?;
    if c.base.trim().is_empty() || c.model.trim().is_empty() {
        return Err(L!("Configuração incompleta.", "Incomplete configuration.").into());
    }
    let mut rb = client().get(endpoint(&c.base, "models")).timeout(Duration::from_secs(10)).header("User-Agent", "llama-studio");
    if !c.key.trim().is_empty() {
        rb = rb.bearer_auth(c.key.trim());
    }
    let resp = rb.send().await.map_err(chain)?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("HTTP {}", resp.status().as_u16()))
    }
}

/// Lista os modelos do provedor (GET /models), para escolher sem digitar.
pub async fn models(app: &App, id: &str) -> Result<Vec<String>, String> {
    let c = provider(app, id).ok_or_else(|| L!("API não encontrada.", "API not found.").to_string())?;
    if c.base.trim().is_empty() {
        return Err(L!("Informe o endereço da API.", "Enter the API address.").into());
    }
    let mut rb = client().get(endpoint(&c.base, "models")).timeout(Duration::from_secs(20)).header("User-Agent", "llama-studio");
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
