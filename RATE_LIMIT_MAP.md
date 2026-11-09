# Limite do NVIDIA NIM (40 pedidos por 60 s)

Só o NVIDIA NIM tem limite por minuto no plano grátis. O studio trata isso em três lugares.

## Servidor (`src/app.rs`, `src/remote.rs`)

| O quê | Onde | Para que serve |
|-------|------|----------------|
| `NIM_MAX_REQS` / `NIM_WINDOW` | `app.rs` | 40 pedidos numa janela móvel de 60 s |
| `App::nim_gate()` | `app.rs` | Conta cada pedido; no limite devolve os segundos de espera |
| `App::nim_status()` | `app.rs` | Quantos pedidos na janela e quanto falta para liberar |
| `is_nim()` | `remote.rs` | Provedor é NIM: id `nvidia` ou endereço `integrate.api.nvidia.com` |
| `send_with_retries()` | `remote.rs` | Passa pelo `nim_gate` antes de cada envio; no limite responde 429 com `Retry-After` |
| `GET /api/nim-status` | `server.rs` | `{used, wait_secs, max, window_secs}` para a interface |

A contagem é única para o app inteiro: conversa, exploradores e auditor no NIM somam no mesmo contador.

## Exploradores (`ui/js/08-ferramentas.js`)

`nimPace(signal)` roda antes de cada passo de um explorador **que está no NIM** (`isNimApi`). Consulta
`/api/nim-status` e espera conforme o uso real:

| Situação | Espera |
|----------|--------|
| menos de 50% da janela usada | nenhuma |
| 50% a 80% | 1,5 s |
| 80% ou mais | 3 s |
| limite atingido (`wait_secs > 0`) | `wait_secs` + 0,5 s |

Exploradores no modelo local ou em outras APIs (Groq, Gemini...) não esperam nada. A pausa é interrompida
quando a resposta é cancelada.

## Interface

- `isNimApi(a)` e `mainApiForChat(conv)` em `ui/js/06-modelo.js`: a conversa está no NIM quando o modelo dela
  é um perfil `remote:<id>` de um provedor NIM.
- Indicador no cabeçalho do chat (`ui/js/02-conversas.js`, `maybeStartNimPoll`) e na tela do servidor
  (`ui/js/12-servidor.js`, `updateNimStatus`).
- `streamRaw` (`ui/js/06-modelo.js`) lê o `Retry-After` do 429 e guarda em `msg._rateLimitWait`.
