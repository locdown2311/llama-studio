# Mapa de Alterações: Rate Limit NIM

## Arquivo Modificado
`ui/js/08-ferramentas.js`

## Mudanças Principais

| Linha | O que é | Para que serve |
|-------|---------|----------------|
| 29 | `function sleep(ms)` | Delay assíncrono (setTimeout) sem bloquear UI |
| ~216 | `let delayInit` | 5s se total > 3 passos; 0 se ≤ 3 |
| ~217 | `let delayBetween` | 3s fixo entre cada step (exceto último) |
| ~218 | `let delayExtra` | 2s a cada 3 steps se total > 5 |
| ~220 | `await sleep(delayInit)` | Aguarda antes de iniciar loop |
| ~243 | `await sleep(delayExtra)` | Delay extra a cada 3 steps |
| ~246 | `await sleep(delayBetween)` | Delay entre steps (sem delay após último) |

## Lógica de Delay (exemplo com 20 passos)

```
Inicial: 5s (20 > 3)
Entre 1-2: 3s
Entre 2-3: 3s + 2s (extra a cada 3)
Entre 3-4: 3s
Entre 4-5: 3s + 2s (extra a cada 3)
...continua até 20 passos
```

## Objetivo

Evitar rate limit da API NVIDIA NIM (40 requests/60s) transformando a abordagem **reativa** (tratar erro 429 após ocorrer) em **proativa** (delayes antes de exceder o limite).

## Integração

- Todos os exploradores passam por `runExplorer()` → mudança cobre todos os casos
- Nenhuma chamada externa ou configuração adicional necessária
- JavaScript syntax validada ✅