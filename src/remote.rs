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
    json!(app.cfg().api_providers.iter().map(|p| json!({ "id": p.id, "name": p.name, "base": p.base, "model": p.model, "params": p.params, "hasKey": !p.key.trim().is_empty(), "ready": ready(p) })).collect::<Vec<_>>())
}

/// Cliente próprio para a internet: respeita o proxy do sistema (o de app.http é só para o llama-server
/// local, sem proxy) e larga conexões paradas antes que o provedor as feche.
fn client() -> &'static reqwest::Client {
    static C: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
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

pub async fn chat(app: &App, id: &str, body: Bytes) -> Response {
    let Some(c) = provider(app, id).filter(ready) else {
        return err(StatusCode::BAD_REQUEST, L!("Essa API externa não está configurada.", "That external API is not configured.").into());
    };
    let Ok(mut v) = serde_json::from_slice::<Value>(&body) else {
        return err(StatusCode::BAD_REQUEST, L!("Pedido inválido.", "Invalid request.").into());
    };
    if let Some(o) = v.as_object_mut() {
        for k in LLAMA_ONLY {
            o.remove(*k);
        }
        // parâmetros escolhidos para este provedor: valem por cima dos do studio (menos os que definem o pedido)
        for (k, val) in &c.params {
            if !matches!(k.as_str(), "model" | "messages" | "tools" | "stream" | "stream_options") {
                o.insert(k.clone(), val.clone());
            }
        }
        o.insert("model".into(), json!(c.model.trim()));
        if o.get("stream").and_then(Value::as_bool).unwrap_or(false) {
            // o uso de tokens chega no último pedaço
            o.insert("stream_options".into(), json!({ "include_usage": true }));
        }
    }
    let body = v.to_string();
    let build = || {
        let mut rb = client().post(endpoint(&c.base, "chat/completions")).timeout(Duration::from_secs(300)).header("Content-Type", "application/json").header("User-Agent", "llama-studio");
        if !c.key.trim().is_empty() {
            rb = rb.bearer_auth(c.key.trim());
        }
        if c.base.contains("openrouter.ai") {
            rb = rb.header("X-Title", "Llama Studio");
        }
        rb.body(body.clone())
    };
    // uma conexão parada no pool pode ter sido fechada pelo provedor: falha ao mandar = tenta de novo uma vez
    let sent = match build().send().await {
        Err(e) if e.is_connect() || e.is_request() => {
            tokio::time::sleep(Duration::from_millis(400)).await;
            build().send().await
        }
        r => r,
    };
    match sent {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let mut out = Response::builder().status(status);
            for (k, val) in resp.headers() {
                if matches!(k.as_str(), "content-type" | "retry-after" | "x-ratelimit-remaining-requests" | "x-ratelimit-remaining-tokens") {
                    out = out.header(k, val);
                }
            }
            out.body(Body::from_stream(resp.bytes_stream())).unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
        }
        Err(e) => err(StatusCode::BAD_GATEWAY, LF!("API externa indisponível ({}).", "External API unavailable ({}).", chain(e))),
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
