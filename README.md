<p align="center">
  <img src="assets/icon-256.png" width="96" alt="">
</p>

<h1 align="center">Llama Studio</h1>

<p align="center">
  Um <b>agent harness</b> leve e otimizado para modelos locais no Windows.<br>
  Junta o <a href="https://github.com/ggml-org/llama.cpp">llama.cpp</a>, ferramentas, conectores MCP e habilidades numa janela só, sem roubar memória nem GPU do modelo.
</p>

<p align="center">
  <a href="../../releases/latest"><b>Baixar o instalador</b></a> ·
  <a href="#recursos">Recursos</a> ·
  <a href="#como-ele-economiza">Como ele economiza</a> ·
  <a href="#desenvolvimento">Desenvolvimento</a>
</p>

---

<p align="center">
  <img src="assets/screenshots/chat.png" alt="Conversa com linha do tempo das ferramentas e a aba Atividade" width="900">
</p>

O Llama Studio transforma o `llama-server` num agente que trabalha no seu computador: lê e edita arquivos, roda comandos, navega na web, controla aplicativos, chama conectores MCP e segue habilidades (`SKILL.md`), tudo com o modelo rodando localmente.

É um único executável em Rust (cerca de 5 MB) com a interface embutida. Ele foi feito para atrapalhar o mínimo possível o modelo: roda com prioridade baixa e em modo de economia de energia do Windows, a janela não usa a GPU, e ao fechar ela é destruída de verdade (o programa fica só na bandeja).

## Instalação

1. Baixe o `llama-studio-setup-X.Y.Z.exe` da [última versão](../../releases/latest).
2. Abra o programa. Na primeira vez, um guia sugere o motor pela placa de vídeo detectada e baixa:
   - **llama.cpp**: Vulkan (AMD, NVIDIA e Intel), CUDA, ROCm, SYCL ou só CPU, da release oficial;
   - **ik_llama.cpp**: fork mais rápido para MoE com camadas na CPU, compilado pelo CI deste projeto.
3. No mesmo guia, baixe um modelo GGUF do Hugging Face.

O instalador não pede administrador: instala em `%LOCALAPPDATA%\Programs\Llama Studio` e, se faltar, instala o WebView2. Depois disso, o próprio programa avisa quando há versão nova e se atualiza sozinho.

> Já tem o llama.cpp numa pasta? Coloque o `llama-studio.exe` numa subpasta dela (`llama\llama-studio\`) e ele encontra o `llama-server.exe` e o `llama-gui.json` sozinho.

## Recursos

<table>
  <tr>
    <td width="50%"><img src="assets/screenshots/primeiro-uso.png" alt="Guia da primeira abertura"><br><sub>Primeira abertura: motor sugerido pela placa de vídeo e modelos para começar.</sub></td>
    <td width="50%"><img src="assets/screenshots/motor-e-modelos.png" alt="Motores do llama.cpp e modelos"><br><sub>Motores (llama.cpp e ik_llama.cpp), modelos e "Otimizar para o seu PC".</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="assets/screenshots/escuro.png" alt="Tema escuro com o painel de arquivos do projeto"><br><sub>Tema escuro, projeto com pasta própria e personalidade.</sub></td>
  </tr>
</table>

### Agente
- **Recursos automáticos**: pelo pedido, o studio liga sozinho o que a conversa precisa (ferramentas, conectores, habilidades, raciocínio). "Investigue a função em 0x401000 no x64dbg" liga o conector do x64dbg (conectando se estiver desligado), o caderno e os exploradores. Feito por padrões de texto, sem gastar tokens; aparece na mensagem com opção de desfazer. O botão de placa (setas) na barra do chat escolhe o quanto ele liga: desligado, cauteloso, equilibrado (padrão) ou liberal.
- **Ferramentas internas**, ligadas e desligadas por grupo: ler, escrever e editar arquivos; PowerShell; executar código que combina várias ferramentas; navegador próprio (Edge/Chrome via CDP); controle do computador (UI Automation, cliques, teclado, capturas); busca no histórico; lista de tarefas do modelo.
- **Subagentes exploradores**: investigações só de leitura, com contexto próprio, várias em paralelo.
- **Conectores MCP**: stdio, Streamable HTTP e SSE antigo. Aceita a configuração do Claude Desktop, Cherry Studio e Cursor colada direto. Dá para esconder ferramentas específicas de cada conector.
- **Habilidades** (`SKILL.md`), importadas de pasta, zip ou arquivo e escolhidas na barra do chat ou com `@`.
- **Pontos de restauração**: antes de cada escrita ou edição, o arquivo é guardado. Dá para desfazer uma alteração pelo card da ferramenta ou usar "Voltar até aqui" numa mensagem, que desfaz tudo o que veio depois.
- **Modo plano**: o modelo só investiga e propõe um plano, sem alterar nada. Um botão executa o plano quando você aprovar.
- **Leituras em paralelo**: leituras pedidas no mesmo passo rodam juntas, no agente e nos subagentes.
- **Correções viram regras**: ao negar uma ação ou desfazer uma alteração, o botão "Virar regra" propõe uma regra curta, que você guarda no prompt, no projeto ou na política do auditor.
- **Caderno de investigação**: o modelo registra achados (funções, endereços, strings, hipóteses) em cartões por pasta de trabalho e consulta antes de repetir trabalho. Exporta em Markdown ou como script de rótulos do x64dbg.
- **Hipótese testada**: o botão Testar de um cartão abre uma conversa que testa a hipótese no debugger e grava no cartão se foi confirmada ou descartada, com a evidência.
- **Assinaturas de funções**: os bytes de uma função identificada (com curingas em chamadas, saltos e endereços) viram uma assinatura; num binário novo, o studio acha as funções conhecidas e cria os cartões. Sem o modelo.
- **Habilidade a partir da conversa**: transforma uma conversa que deu certo num `SKILL.md` para revisar e salvar.
- **Aprovação de ações** que alteram algo (sempre, só escrita ou nunca).
- **Auditor de ações**: um subagente lê cada ação que pediria permissão junto com o seu pedido, avalia o risco segundo uma política editável e aprova sozinho o que é seguro. O resto chega para você com a análise dele.

### Conversas
- **Projetos**: conversas que dividem a mesma pasta de trabalho, com instruções e personalidade padrão.
- **Personalidades**: prompts de sistema com nome e cor, escolhidos por conversa.
- **Respostas em segundo plano**: troque de conversa sem parar a que está respondendo.
- **Fila de mensagens**: escreva enquanto o modelo responde, e as mensagens seguem em ordem.
- **Linha do tempo**: raciocínio, falas e ferramentas num trilho único, e uma aba **Atividade** com a linha do tempo da conversa inteira.
- **Arrastar arquivos**: entra o caminho absoluto, sem upload.
- **Alterações** na aba Atividade: os arquivos que a conversa mudou, com a diferença de cada um, desfazer por arquivo ou tudo.
- **Colar imagens** (Ctrl+V): a imagem vai para `anexos\` e, se o modelo enxerga, segue junto com a mensagem.
- **Etiquetas de cor** nas conversas, com filtro e agrupamento como pastas.
- Exportar a conversa em Markdown, histórico pesquisável e medidor de contexto.

### Modelos
- **Motores** direto do programa: llama.cpp (Vulkan, CUDA, ROCm, SYCL ou CPU) e ik_llama.cpp. Dá para ter vários instalados e trocar com um clique. Opções que um motor não aceita são ignoradas automaticamente.
- **Otimizar para o seu PC**: o programa mede algumas combinações de microlote e threads com o `llama-bench` e grava no modelo a combinação mais rápida.
- **Vários modelos cadastrados, um carregado por vez.** Cada conversa escolhe o seu, e o studio troca quando precisa, esperando as respostas em andamento.
- **Busca e download do Hugging Face**: lista as quantizações com o tamanho, inclui o projetor de visão, retoma downloads interrompidos e cria o modelo pronto para usar.
- **Editor visual dos argumentos** do llama-server, com explicação de cada opção e sliders com limites.
- **Cada modelo lembra** as habilidades, conectores e ferramentas que estavam marcados com ele.

### Organização
- **Arrumar pastas**: regras que movem arquivos para subpastas por tipo, nome e data (`Capturas\{ano}\{mesnome}`), com prévia, desfazer e modo automático. O modelo só ajuda a montar a regra a partir de uma frase.
- **Calendário de conteúdo**: posts por dia com situação, legenda, hashtags e imagem; cada post pode ter a própria conversa, e o modelo sugere temas para os dias vazios com base nos posts que foram bem.

### Utilitários
O programa baixa e mantém na pasta dele, sem mexer no sistema: **RTK**, **ripgrep**, **fd**, **uv**, **Bun** e **7-Zip**. Eles entram no PATH dos comandos do modelo e dos conectores.

## Como ele economiza

Modelo local tem contexto curto e processamento caro, então o harness foi pensado para gastar pouco:

| | |
|---|---|
| **Cache por conversa** | Cada conversa tem um slot no llama-server. Quando outra conversa precisa do slot, o cache vai para o disco e volta quando ela é retomada, então uma conversa longa não é reprocessada do zero. |
| **Pensar ou responder direto** | Um botão na barra do chat liga ou desliga o raciocínio por conversa. Pedidos simples saem na hora. |
| **Prompt estável** | O prompt de sistema é idêntico entre mensagens (sem hora, sem listas que mudam). Assim o llama-server reaproveita o cache e não relê a conversa inteira. |
| **Carregamento sob demanda** | Conectores entram como um catálogo de uma linha por ferramenta; o modelo carrega só as que vai usar. Habilidades longas entram só com o resumo. |
| **Esquemas enxutos** | As definições das ferramentas MCP vêm sem títulos, exemplos e campos que não ajudam o modelo, e com descrições encurtadas. |
| **Saídas compactadas** | As saídas de comandos e conectores perdem cores ANSI e barras de progresso, e linhas repetidas viram uma. Saídas longas mantêm começo e fim, e a saída completa fica salva para consulta. O RTK resume `git`, `cargo`, `pytest` e outros. |
| **Compactação automática** | Perto do limite, o meio da conversa é resumido. O primeiro pedido e o final ficam intactos. |
| **Imagens** | Imagens vão só na mensagem seguinte à captura, depois saem do histórico. |
| **Busca rápida** | A busca por conteúdo usa o ripgrep quando ele está instalado e respeita o `.gitignore`. |

No sistema, o programa roda com prioridade abaixo do normal e no modo EcoQoS do Windows. Os processos filhos ficam presos a um *job object* e morrem junto com ele.

## Atualizações

Cada release publica:

- `llama-studio-setup-X.Y.Z.exe`: o instalador completo.
- `llama-studio.exe`: o programa. O app baixa, troca o executável e reinicia.
- `ui.zip`: só a interface. O app instala em `dados\ui` e recarrega, sem reiniciar.

Uma interface nova só é aplicada se o executável for compatível: o `ui/min-exe.txt` diz a versão mínima que ela exige.

## Desenvolvimento

```
cargo build --release
```

| Pasta | O quê |
|---|---|
| `src/` | Servidor local (axum), cliente MCP, gerenciador do llama-server, ferramentas, downloads, janela e bandeja |
| `ui/` | Interface (HTML, CSS e JS sem build), embutida no executável |
| `installer/` | Instalador (Inno Setup) |
| `.github/workflows/ik-llama.yml` | Compila o ik_llama.cpp para Windows e publica como pré-release `ik-*` |
| `assets/` | Ícone |
| `.github/workflows/` | CI e publicação |

Opções de linha de comando: `--navegador` (abre no navegador em vez da janela), `--bandeja` (começa minimizado) e `--iniciar-servidor` (sobe o llama-server ao abrir).

**Publicar uma versão:** suba o `version` no `Cargo.toml` e faça push no `main`. O workflow `Release` compila no Windows, gera o instalador com o llama.cpp mais recente, cria o tag e publica tudo. Pushes sem mudança de versão só compilam.

Bibliotecas de terceiros em `ui/vendor`: marked (MIT), DOMPurify (Apache-2.0/MPL-2.0) e highlight.js (BSD-3-Clause).
