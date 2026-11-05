# llama studio

Interface local para o [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server`) no Windows:
um executável só, com janela própria (WebView2), ícone na bandeja, pasta de trabalho, habilidades
(`SKILL.md`), conectores MCP, ferramentas (arquivos, PowerShell, navegador, computador) e subagentes.

Feito para atrapalhar o mínimo o modelo: roda com prioridade baixa, a janela não usa a GPU por padrão
e é destruída ao fechar (o studio fica na bandeja).

## Instalação

Baixe o `llama-studio.exe` da [última versão](../../releases/latest) e coloque em `llama\llama-studio\`
(a pasta de cima deve ter o `llama-server.exe`). Depois disso o próprio app avisa quando houver versão nova.

## Atualizações

Cada release publica:

- `llama-studio.exe`: o programa inteiro. O app baixa, troca o executável e reinicia.
- `ui.zip`: só a interface (`ui/`). O app instala em `dados\ui` e recarrega, sem reiniciar.

A interface só é aplicada se o executável for compatível: `ui/min-exe.txt` diz a versão mínima do
programa que ela exige. Se a mudança for só visual, mantenha o número; se a interface passar a usar
uma rota nova do servidor, suba para a versão em que a rota apareceu.

### Lançar uma versão

```
git tag v2.1.1
git push origin v2.1.1
```

O workflow `Release` compila no Windows, gera os dois pacotes e publica a release.

## Estrutura

| Pasta | O quê |
|---|---|
| `src/` | Servidor local (axum), cliente MCP, gerenciador do llama-server, ferramentas, janela e bandeja |
| `ui/` | Interface (HTML, CSS e JS sem build); vai embutida no executável |
| `.github/workflows/` | CI e publicação |

## Compilar

```
cargo build --release
```

Opções: `--navegador` (usa o navegador em vez da janela), `--bandeja` (começa minimizado),
`--iniciar-servidor` (sobe o llama-server ao abrir).

Bibliotecas de terceiros em `ui/vendor`: marked (MIT), DOMPurify (Apache-2.0/MPL-2.0), highlight.js (BSD-3-Clause).
