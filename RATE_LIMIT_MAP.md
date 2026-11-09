# Limite do NVIDIA NIM (40 pedidos por 60 s)

Só o NVIDIA NIM tem limite por minuto no plano grátis. O studio não deixa o pedido bater no limite: quem
segura é uma fila no servidor (`src/nim.rs`). A interface só mostra.

## Fila no servidor (`src/nim.rs`)

| O quê | Valor | Para que serve |
|-------|-------|----------------|
| `MAX` | 40 | O limite do NIM (o que aparece no contador) |
| `BUDGET` | 38 | O que o studio usa de fato (2 de folga para diferença de relógio) |
| `RESERVE` | 10 | Vagas só da conversa: pedidos laterais param em 28 |
| `WINDOW` | 60 s | Janela móvel |
| `MAX_WAIT` | 75 s | Tempo máximo na fila; além disso volta 429 com `Retry-After` |

- `Nim::acquire(side)`: cada pedido ao NIM pega uma vaga antes de sair. Sem vaga, **espera** a mais antiga
  sair da janela (não falha). `side = true` para explorador, auditor, resumo e tarefas de fundo.
- A reserva só vale se alguma conversa usou o NIM nos últimos 5 minutos; sem conversa no NIM, os pedidos
  laterais usam as 38 vagas.
- `Nim::block(secs)`: se o NIM responder 429 mesmo assim (outro programa na mesma chave), ninguém pede pelo
  tempo do `Retry-After` (15 s se não vier). A nova tentativa espera na fila em vez de insistir.
- Novas tentativas e o modelo de fallback também passam pela fila (cada envio conta).
- `Nim::status()` → `GET /api/nim-status`: `{used, wait_secs, waiting, free, next_secs, max, budget, reserve, window_secs}`.

## Quem é conversa e quem é lateral (`src/remote.rs`, `src/server.rs`)

- `POST /remote/v1/chat/completions?p=<id>`: conversa.
- O mesmo com `&bg=1`: lateral. A interface manda `bg=1` em tudo que passa por `streamApi` (auditor,
  exploradores, tarefas de fundo, resumo da compactação).
- Pedidos que chegam pelo proxy `/v1/...` com um perfil `remote:` ativo: laterais.
- `is_nim()`: provedor com id `nvidia` ou endereço `integrate.api.nvidia.com`.

## Interface

- Contador no rodapé do cartão da conversa (`#nim-meter`, `drawNimMeter` em `ui/js/02-conversas.js`): só
  aparece quando a conversa aberta roda num provedor NIM (`isNimApi(mainApiForChat())`). Mostra
  `NIM usados/40` e, com a janela cheia, os segundos até abrir vaga.
- Tela do servidor: `updateNimStatus` em `ui/js/12-servidor.js`.
- Os exploradores não fazem mais pausa no navegador: a espera é a da fila.
