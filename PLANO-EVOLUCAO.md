# Plano de evolução (inspirado no DeepSeek Harness)

Comparação feita com o dsh em 21/11/2026. Estado do studio: **2.106.0**.

Legenda: ✅ feito · ⏳ pendente

## Progresso (21/11/2026)

| Item | Estado | Versão | Commit |
|---|---|---|---|
| 1.1 Jobs de shell | ✅ | 2.104.0 | `d033f7b` |
| 1.2 Workflows salvos | ✅ | 2.105.0 | `a6a3121` |
| 1.3 `list_plugins` | ✅ | 2.106.0 | `6cfd4e3` |
| 1.4 Webhook de entrada | ⏳ | — | — |
| 2.1 Terminais PTY | ✅ | 2.107.0 | `5a04435` |
| 2.2 LSP | ⏭ pulado | — | — |
| Loop de habilidades automáticas | ✅ | 2.108.0 | — |

Também nesta leva: preflight só pede build quando a mudança não é só documentação (2.104.1, `a276f14`) e este plano (`53e0042`).

O 1.1 e o 1.2 já foram para o `main` pelo PR do `master`; o 1.3 (`6cfd4e3`) ainda está só no `master` (precisa de push + PR).

## Já existe no studio (não precisa fazer)

| Recurso do dsh | Onde está no studio |
|---|---|
| PTC (ferramentas dentro de código) | `execute_code` (Web Worker com `tool()` → `execTool`, mesmo caminho do modelo: auditoria, permissão, ponto de restauração). `ui/js/08-ferramentas.js` |
| Jobs de fundo (conversa) | `src/jobs.rs` (executor em navegador sem janela), agenda, nuvem |
| Introspecção de plugins (interface) | `/api/plugins` (list/enable/install/update/uninstall/hook/command), `ui/js/10-plugins.js` |

---

## Fase 1 — barata, alto retorno

### 1.1 Jobs de shell (comando em segundo plano) ✅ 2.104.0 · commit `d033f7b`
- `run_command` com `background: true`: volta na hora com o id do job.
- Ferramentas `job_list`, `job_output(id, tail)`, `job_kill(id)` (grupo `shell`).
- `src/shell.rs`: registro com estado (`running/done/error/killed`), código de saída, anel de 600 linhas de stdout/stderr lidas incrementalmente, histórico de 40 jobs, árvore encerrada como o Parar.
- Rota `GET /api/shell/jobs?run=<conversa>`.
- Limite conhecido: com o Linux isolado (WSL) ligado, `background` é recusado (o sandbox é one-shot).
- Testes: `shell::tests::job_roda_e_mostra_a_saida`, `job_kill_encerra`, `job_desconhecido`.

### 1.2 Workflows JS salvos ✅ 2.105.0
- `dados/workflows/<nome>.mjs` com frontmatter (`name`, `description`, `params`) e corpo JS; o corpo roda no mesmo worker do `execute_code` com `params` definido.
- Ferramentas `list_workflows`, `run_workflow(name, params)` e `save_workflow(name, text)` (grupo `code`).
- Página Configurações › Workflows (listar, editar, apagar, novo).
- Rotas `GET/POST /api/workflows`, `/api/workflows/get`, `/api/workflows/delete`; parser em `src/workflows.rs` (sem YAML).
- Limite: só JavaScript de worker (sem Node/Python), como o `execute_code`.

### 1.3 `list_plugins` para o modelo ✅ 2.106.0
- Ferramenta de leitura `list_plugins` (grupo `toolsearch`): nome, versão, ligado/desligado, descrição e o que cada plugin traz (habilidades, comandos, agentes, ganchos, conectores), direto de `/api/plugins`.
- Ganho: o modelo para de adivinhar o que está instalado.

### 1.4 Webhook de entrada ⏳
- `POST /api/hooks/<nome>` com regra em `dados/hooks.json` (`{nome, secret, prompt, projeto, modelo}`).
- Dispara o mesmo caminho da agenda (`jobs::start`) + notificação (`cloud::notify`).
- Rota fora do `guard` (o `x-studio` não vale para fora), com segredo próprio no header.
- Custo: ~1 dia. Risco: médio — única superfície de segurança da fase.

---

## Fase 2 — média

### 2.1 Terminais persistentes (PTY) ✅ 2.107.0
- `src/pty.rs` com `portable-pty` (ConPTY no Windows, PTY no Linux): `terminal_start`, `terminal_send` (Enter por padrão), `terminal_read` (ANSI limpo, `alive`), `terminal_close`, `terminal_list`; 12 sessões, 2.000 linhas cada.
- **Ambientes**: pasta normal → PowerShell (Windows) ou `$SHELL`; com o Linux isolado (WSL) ligado → `wsl.exe -d <distro> -u root -e sh -c "<mount /workspace; cd; exec bash>"` (mesmo mount do `run_command`).
- O Parar da conversa encerra os terminais (`pty::stop`); fechamento por `taskkill /T /F`.
- Corrigido no caminho: deadlock do `job_output`/`terminal_read` (lock de `out` e `job_json`/`view` travando o mesmo mutex).

### 2.2 LSP ⏭ pulado (decisão de 21/11/2026)
- Motivo: exige language server instalado por linguagem e o ganho não compensa agora; o `search_files`/rg cobre a busca de texto.
- Se voltar: `src/lsp.rs` com JSON-RPC por stdio, ferramentas read-only `lsp_definition`/`lsp_references`/`lsp_hover`/`lsp_symbols`.

---

## Fase 3 — cara, decidir com calma

### 3.1 Log de sessão event-sourced (incremental) ⏳
- **Não** trocar o JSON: acrescentar `conv.events` append-only (`seq`, `t`, `kind`, `payload`) gravado junto; mutações atuais viram eventos (`msg`, `tool_result`, `approval`, `checkpoint`, `compact`, `fork`).
- `messages` continua existindo como projeção para a UI (`derive()` ao carregar) — nada quebra.
- Depois: fork = slice de eventos, rewind = replay até `seq`, migração = versão no cabeçalho.
- Só fazer quando fork/resume/migração doerem: hoje eles funcionam (cópia profunda + snapshots em `dados/pontos`).

### 3.2 Agent Teams com quadro de tarefas ⏳
- Peça barata: quadro compartilhado (`conv.board`: id, título, dono, status, notas) + ferramenta `team_task` (add/claim/done) — generaliza o `todos`.
- Peça cara: subagente **que escreve**. Hoje é proibido de propósito (exploradores read-only, `scopeClash`). Para abrir com segurança, cada escritor precisa da **sua própria pasta** — `ramos::create` já faz isso (worktree/cópia + `git apply` de volta).
- Depois: mensagens entre agentes (`send_to_chat` é o embrião).
- Custo: 1–2 semanas. Só faz sentido depois que o ramo com pasta própria estiver maduro.

---

## Loop de habilidades automáticas ✅ 2.108.0
- Detecção no fim do turno (`maybeAutoSkill`): trabalho de verdade (arquivos alterados ou 6+ ferramentas), sem erro/parada, uma vez por conversa.
- Rascunho via `sideAsk` (`draftSkill`, mesmo prompt do "Habilidade a partir da conversa").
- Modo **Perguntar** (padrão): card na conversa com Revisar / Ativar / Descartar; **Automático** salva direto; **Desligado**. Em Configurações › Respostas › Aprender com a conversa.
- A sugestão não entra no catálogo do modelo sem aprovação.

## Ordem recomendada
1. 1.4 webhook (fecha a fase 1).
2. Loop de melhoria das skills (peça 4: propõe diff quando uma skill falha).
3. 3.1 event-sourced e 3.2 Agent Teams quando houver demanda.
