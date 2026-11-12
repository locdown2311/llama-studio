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

O instalador começa perguntando o idioma (português do Brasil ou inglês) e o studio já abre nele.

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
- **Recursos automáticos**: pelo pedido, o studio liga sozinho o que a conversa precisa (ferramentas, conectores, habilidades, raciocínio). "Investigue a função em 0x401000 no x64dbg" liga o conector do x64dbg (conectando se estiver desligado), o caderno e os exploradores. Feito por padrões de texto, sem gastar tokens; aparece na mensagem com opção de desfazer. Conector citado pelo nome ("pelo x64dbg") vai com as ferramentas completas, e em engenharia reversa o controle da tela sai da conversa, para o modelo usar o conector em vez de clicar na janela. O botão de placa (setas) na barra do chat escolhe o quanto ele liga: desligado, cauteloso, equilibrado (padrão) ou liberal.
- **Ferramentas internas**, ligadas e desligadas por grupo: ler, escrever e editar arquivos; PowerShell; executar código que combina várias ferramentas; navegador próprio (Edge/Chrome via CDP); controle do computador (UI Automation, cliques, teclado, capturas); busca no histórico; lista de tarefas do modelo.
- **Subagentes exploradores**: investigações só de leitura, com contexto próprio, várias em paralelo.
- **Conectores MCP**: stdio, Streamable HTTP e SSE antigo. Aceita a configuração do Claude Desktop, Cherry Studio e Cursor colada direto. Dá para esconder ferramentas específicas de cada conector.
- **Habilidades** (`SKILL.md`), importadas de pasta, zip ou arquivo e escolhidas na barra do chat ou com `@`.
- **Pontos de restauração**: antes de cada escrita ou edição, o arquivo é guardado. Dá para desfazer uma alteração pelo card da ferramenta ou usar "Voltar até aqui" numa mensagem, que desfaz tudo o que veio depois.
- **Modo plano**: o modelo só investiga e propõe um plano, sem alterar nada. Um botão executa o plano quando você aprovar.
- **Leituras em paralelo**: leituras pedidas no mesmo passo rodam juntas, no agente e nos subagentes.
- **Correções viram regras**: ao negar uma ação ou desfazer uma alteração, o botão "Virar regra" propõe uma regra curta, que você guarda no prompt, no projeto ou na política do auditor.
- **Caderno de investigação**: o modelo registra achados (funções, endereços, strings, hipóteses) em cartões do projeto (ou da conversa, fora de projeto) e consulta antes de repetir trabalho. Exporta em Markdown ou como script de rótulos do x64dbg.
- **Hipótese testada**: o botão Testar de um cartão abre uma conversa que testa a hipótese no debugger e grava no cartão se foi confirmada ou descartada, com a evidência.
- **Assinaturas de funções**: os bytes de uma função identificada (com curingas em chamadas, saltos e endereços) viram uma assinatura; num binário novo, o studio acha as funções conhecidas e cria os cartões. Sem o modelo.
- **Habilidade a partir da conversa**: transforma uma conversa que deu certo num `SKILL.md` para revisar e salvar.
- **Aprovação de ações** que alteram algo (sempre, só o que altera ou nunca). Vale também para os conectores: ferramentas que escrevem, apagam, enviam ou executam (pela anotação do servidor ou pelo nome) pedem confirmação; leituras não. Dá para marcar um conector como confiável.
- **Auditor de ações**: um subagente lê cada ação que pediria permissão junto com o seu pedido, avalia o risco segundo uma política editável e aprova sozinho o que é seguro. O resto chega para você com a análise dele.

### Conversas
- **Projetos**: conversas que dividem a mesma pasta de trabalho, com instruções e personalidade padrão.
- **Personalidades**: prompts de sistema com nome e cor, escolhidos por conversa.
- **Progresso da resposta**: antes da primeira palavra, uma barra mostra quanto do contexto o llama-server já leu ("Lendo o contexto: 4.200 de 12.000 tokens · 35% · faltam ~8s"), e um anel em volta do botão de parar enche junto. Tokens que já estavam no cache não contam. Com servidores que não informam o progresso, aparece uma barra animada com o tempo passando. Quando o servidor relê muito, a espera diz por quê (instruções ou ferramentas que mudaram, compactação, imagem que saiu do histórico, servidor reiniciado, auditor no mesmo slot), e a janela de contexto mostra quanto do último pedido veio do cache. Conector citado com @ fica carregado até o fim da conversa, para não trocar a lista de ferramentas a cada mensagem.
- **Criados nesta conversa**: a aba Arquivos marca com **N** o que a conversa criou e com **A** o que ela alterou, com um ponto nas pastas que têm algo assim dentro. Um resumo no topo ("2 novos · 1 alterado") filtra a árvore para mostrar só esses. As marcas saem do histórico da conversa, então trocam sozinhas ao mudar de conversa e voltam ao reabrir.
- **Em uso agora**: enquanto um comando copia ou move pastas (`Copy-Item`, `robocopy`, `xcopy`, `Move-Item`, `Compress-Archive`...), a aba Arquivos mostra a origem como somente leitura e o destino recebendo, com cadeado na árvore. Outra conversa não escreve na origem até o comando terminar.
- **Respostas em segundo plano**: troque de conversa sem parar a que está respondendo.
- **Fila de mensagens**: escreva enquanto o modelo responde, e as mensagens seguem em ordem. Com Ctrl+Enter (ou o ⚡ na fila), a mensagem entra logo depois do passo atual, sem esperar a resposta inteira.
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

### Configurações
Um painel só, com menu lateral em quatro grupos: **Geral** (Modelo, Ferramentas, Recursos automáticos, Contexto), **Recursos** (Servidor, Conectores, Habilidades, Personalidades, Utilitários), **Segurança** (Segurança, Auditor) e **Sistema** (Aparência, Janela, Compartilhar, Atualizações, Avançado). Os itens da barra lateral são atalhos para as páginas de Recursos. Tudo salva sozinho, e o studio volta na última subpágina aberta.

**APIs externas** (Configurações › API externa): um ou mais provedores compatíveis com OpenAI (Groq, Google Gemini, Cerebras, OpenRouter, NVIDIA NIM ou outro, inclusive outro llama-server), cada um com a sua chave e o seu modelo. Cada função escolhe quem faz: auditor, subagentes exploradores, tarefas de fundo (mapa da pasta, regras, habilidades geradas) e resumo da compactação, no modelo local ou numa das APIs. Assim os limites dos planos grátis se somam. Pela API essas funções não ocupam slot do llama-server, então a conversa não perde o cache por causa delas. As chaves ficam só no `config.json` deste PC (nunca voltam para a interface nem saem no pacote de compartilhar). Se uma API falhar (sem internet, limite do plano grátis), o pedido volta para o modelo local. Os subagentes exploradores usam também as ferramentas que só leem dos conectores ligados na conversa (decompilador, debugger...); no modelo local, se forem mais de 25, só as que a conversa já usou. Com o auditor numa API, as auditorias de um mesmo passo saem em paralelo, e a conexão com a API é aberta enquanto o modelo ainda escreve a chamada de ferramenta. Prazos: auditor 15 s, explorador 120 s por passo, o resto 60 s; erro 500/502/503 do provedor ou falha de conexão tenta de novo uma vez. Planos grátis podem usar o que você manda para treinar modelos: deixe no modelo local o que tiver dado sensível.

**Idioma:** português do Brasil ou inglês, escolhido no instalador, no guia de boas-vindas ou em Configurações › Aparência e idioma (a tela recarrega). Vale para tudo: interface, menu da bandeja, mensagens do programa e o que o modelo recebe (instruções, descrições das ferramentas e resultados delas). Os recursos automáticos entendem pedidos nas duas línguas, qualquer que seja o idioma escolhido.

Com o **Modo avançado** (em Avançado) aparece a subpágina **Testes**, com funções experimentais:
- **Escalar para um modelo maior**: depois de 2 a 4 falhas seguidas de ferramenta, ou da mesma chamada falhando de novo, o studio troca o modelo carregado por um maior escolhido por você. O modelo maior recebe uma nota sobre o que deu errado e continua a tarefa de onde parou. Depois, a conversa volta ao modelo dela no próximo pedido (ou fica no maior, se preferir). Não escala se outra conversa estiver usando o servidor.

### Compartilhar
- **Exportar e importar configurações** num arquivo `.studio.json`: configurações, personalidades, projetos, etiquetas, habilidades (com os arquivos), conectores, perfis de modelo, assinaturas e regras de pastas. Você escolhe o que vai.
- **Segredos nunca saem**: tokens, chaves e senhas dos conectores viram campos que quem importa preenche; conector sem segredo entra desligado.
- Para importar, use Configurações → Compartilhar ou arraste o arquivo para a janela. Dá para manter o que já existe ou substituir.

### Utilitários
O programa baixa e mantém na pasta dele, sem mexer no sistema: **RTK**, **ripgrep**, **fd**, **uv**, **Bun** e **7-Zip**. Eles entram no PATH dos comandos do modelo e dos conectores.

**Pacotes de instruções**, também em Utilitários: o studio baixa o repositório, põe as regras no prompt de sistema no nível escolhido no card e instala as habilidades extras.
- **Ponytail** ([DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail), MIT): a menor mudança que resolve, reaproveitando o que já existe e dizendo no fim o que pulou. Níveis Leve, Completo e Ultra; cerca de 700 tokens. Traz `ponytail-review`, `ponytail-audit` e `ponytail-debt`.
- **Caveman** ([JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman), Apache-2.0): respostas telegráficas, com a resposta primeiro e código, caminhos e erros exatos. Gerar texto é a parte lenta de um modelo local. Níveis Normal e Ultra; cerca de 900 e 500 tokens. Ligado, substitui a instrução de respostas enxutas. Traz `caveman-review` e `caveman-commit`.

### Conversas: prompts, ramos, ditado e comparação

- **Prompts salvos:** digite `/` no começo da mensagem para escolher um prompt guardado. Campos `{{assim}}` ou `{{duração=45 a 60}}` viram um formulário. Salve qualquer mensagem enviada com "Salvar como prompt".
- **Ramificar:** o botão "Ramificar" de uma resposta (ou o menu da conversa) abre uma conversa nova com tudo até ali; a original não muda e o ramo mostra de onde veio.
- **Ditado por voz:** o microfone ao lado do enviar grava e o Whisper transcreve no próprio PC. Na primeira vez (Windows) baixa o programa e o modelo base (~150 MB); usa a mesma instalação das legendas de vídeo.
- **Comparar respostas (A/B):** "Comparar" gera a mesma resposta com outra API (só texto, sem ferramentas) e mostra as duas lado a lado; a escolhida fica. De vez em quando (1 em ~15 respostas sem ferramentas, no máximo uma a cada 10 min) o studio pergunta sozinho; dá para desligar em Configurações › Modelo. O placar por modelo fica no menu da conversa.
- **Imagens para quem não enxerga:** se o modelo da conversa (local ou API) não enxerga, as imagens anexadas (colar, arrastar ou @) são descritas por uma fila de APIs com "Aceita imagens", com troca automática se uma falhar. A ferramenta `analyze_image` deixa o agente perguntar sobre qualquer imagem do projeto a qualquer momento.
- **Limites das APIs:** cada API externa aceita "Pedidos por minuto" e "Pedidos por dia". O studio segura a fila antes do limite (como no NIM, que já vem com 40 por minuto), reserva vagas para a conversa e mostra o medidor no rodapé; ao acabar o limite do dia, o pedido vai para outra API ou para o modelo local. APIs com o mesmo endereço e chave dividem o limite (é a mesma conta).
- **Conversas longas e muitas conversas:** cada conversa fica num arquivo (`dados\ui\c-<id>.json`) e só as que mudaram são gravadas; conversas longas mostram os últimos 30 blocos (o botão no topo traz os anteriores). Embaixo de cada resposta, "cache N%" diz quanto do contexto o llama-server reaproveitou.
- **Backup:** Configurações › Backup grava um .zip numa pasta (a do Google Drive para computador sobe sozinha para a nuvem), à mão ou de tempos em tempos, mantendo os últimos N. Sem as chaves das APIs e os segredos dos conectores, a não ser que você peça. Restaurar guarda antes uma cópia do estado atual em `dados\backups`.

## Vídeos (opcional)
Ligue em Utilitários › Apps opcionais. Aparece **Vídeos** na barra lateral, com projetos do [Remotion](https://github.com/remotion-dev/remotion): vídeos escritos em React pelo modelo.
- **Projetos:** criar (`create-video`, modelo em branco), listar, apagar. Na criação o studio já baixa o navegador que o Remotion usa (~100 MB, uma vez).
- **Prévia ao vivo:** o Remotion Studio do projeto embutido na página; atualiza sozinho quando o modelo edita os arquivos.
- **Render:** escolhe a composição e gera o MP4 em `out/`, com progresso; os vídeos ficam na página para assistir e baixar.
- **Conversa do projeto:** abre uma conversa ligada à pasta do vídeo, com a habilidade oficial do Remotion. O modelo é o que você escolher no seletor (local ou uma API, pelos perfis ☁️).
- **Cenas em equipe (`video_scenes`):** o modelo da conversa escreve o roteiro (estilo comum e cenas com duração e descrição) e as APIs da equipe dos exploradores escrevem as cenas em paralelo, cada uma no seu arquivo (`src/scenes/<Nome>.tsx`). O studio monta a sequência (`src/scenes/Video.tsx`), registra a composição `Video` no `Root.tsx`, roda o `tsc` e devolve os erros a quem escreveu cada cena (até duas rodadas). Se uma API falhar, outra assume a cena.

- **Teste rodando (`video_check`, e automático no fim do `video_scenes`):** além do `tsc`, renderiza um quadro por segundo em tamanho mínimo para pegar erros que só aparecem na prévia (um `interpolate` com a faixa fora de ordem, um valor `undefined`, um arquivo de `public/` que falta). O erro volta para quem escreveu a cena, com o quadro e a linha.
- **Edição de gravações (`video_edit`):** o modelo manda uma lista de edição em JSON (trechos com início e fim, layout, transição, efeitos) e o studio monta com um modelo pronto (`src/edit/EditVideo.tsx`), sem o modelo escrever React. Tem:
  - **cortes** e **cortar pausas sozinho** (`cutSilences`, pela legenda);
  - **layouts:** recorte vertical com ponto de foco, vídeo inteiro com fundo desfocado, **react** (facecam em cima, vídeo embaixo), janela no canto e lado a lado;
  - **transições** (fade, deslizar, cortina, zoom), zoom lento e de ênfase, velocidade, filtros, textos;
  - **legenda animada** que segue os cortes e **música** de fundo.

  A lista fica em `src/edit/<Nome>.ts` (dá para ajustar à mão) e vira a composição `<Nome>`. O studio confere arquivos e tempos antes e testa o vídeo rodando depois. `video_find` lista os trechos falados e as pausas para escolher os cortes.
- **Picos de áudio (`video_peaks`):** mede o volume do vídeo e devolve os trechos barulhentos (tiros, explosões, gritos, risadas), do mais forte ao mais fraco, com quantos picos cada um tem e os minutos mais agitados. Acha em segundos o que a legenda não pega.
- **Facecam embutida, recorte e seguir a ação:** no `video_edit`, a `cam` pode ser a própria gravação com `crop` (a região da facecam), para o layout react com um arquivo só; `crop` no trecho usa só uma parte do quadro; `focusX: "auto"` faz o recorte vertical seguir o movimento da cena. Com as medidas do arquivo, o `focusX` é o centro exato do recorte.
- **Sobreposições:** emoji, imagem de `public/` (meme, logo), seta e círculo de destaque, cada um no seu instante.
- **Miniatura (`video_thumbnail`):** um quadro com texto grande por cima, em `out/<nome>.png`.
- **Renderizar todos** e **corrigir a legenda:** na página Vídeos, um botão põe todos os cortes na fila (as miniaturas ficam de fora), e o lápis ao lado das legendas abre as frases para corrigir o que o Whisper errou (o `.srt` é refeito junto).
- **Método de edição (skill `editor-de-video`):** o studio grava na pasta de skills um roteiro de trabalho que entra sozinho nas conversas dos projetos de vídeo. Ele dá as etapas (entender o pedido, inventário, escolher a receita, achar os momentos, roteiro, montar, conferir) e uma receita por situação: corte de live, melhores momentos, tiroteio e combate, engraçados, react, tutorial, conversa ou podcast, montagem com música e resumo horizontal. Cada receita diz onde procurar e quais parâmetros usar no `video_edit`. Dá para editar o arquivo à mão; ele só é trocado quando o studio traz uma versão nova.
- **Mídia:** envie gravações, músicas, logos e fotos para `public/` pela página (arquivos grandes vão direto para o disco). As cenas usam esses arquivos (`<OffthreadVideo>`, `<Audio>`, `staticFile`).
- **O modelo vê o vídeo (`video_look`):** o studio tira quadros espaçados com o ffmpeg do próprio Remotion e monta uma folha com o tempo de cada quadro, junto com a fala do trecho se houver legenda. Se o modelo da conversa não enxerga imagens, uma API da equipe marcada como "Aceita imagens" descreve os quadros.
- **Legendas automáticas (`video_captions` ou o botão na mídia):** transcreve a fala com o Whisper no seu PC (whisper.cpp pelo Remotion) e grava `public/captions/<nome>.json` (palavras com tempo, para legendas animadas) e `.srt`. Na primeira vez baixa o Whisper e o modelo de fala escolhido (base 150 MB, small 470 MB, medium 1,5 GB ou large-v3-turbo 1,6 GB).

Precisa do **Node.js** (18 ou mais novo) e do **Git**. O Remotion é grátis para pessoas e empresas pequenas; empresas maiores precisam de licença ([remotion.dev/license](https://remotion.dev/license)).

## Como ele economiza

Modelo local tem contexto curto e processamento caro, então o harness foi pensado para gastar pouco:

| | |
|---|---|
| **Raciocínio econômico** | Padrão das conversas novas: o modelo pensa no primeiro passo de cada pedido, depois de um erro ou de uma mensagem nova; nos passos seguintes (ler, editar, rodar) age direto. O raciocínio dos passos do pedido atual volta para o modelo, que continua o plano em vez de recomeçar. Muda em Configurações > Modelo ou por conversa. |
| **Respostas enxutas** | Instrução curta para ir direto ao ponto, sem repetir o pedido nem resumir no fim o que já está visível. Liga e desliga em Configurações > Modelo. |
| **Auditor sem estragar o cache** | Criar e editar arquivos na pasta de trabalho, e comandos que só compilam, testam ou leem dentro dela (gcc, cargo build, dotnet test, git status, rg...), passam direto pelo auditor, sem chamar o modelo. Qualquer coisa que apague, baixe, mexa no sistema ou saia da pasta continua indo ao auditor. Quando o auditor ou outro pedido lateral precisa do modelo e o servidor tem um slot só, o cache da conversa vai para o disco antes e volta depois, em vez de a conversa ser relida inteira no passo seguinte. |
| **Slot do auditor** | Com o auditor ligado e o llama-server com 2 ou mais conversas em paralelo, o último slot fica reservado para ele: as instruções e a política ficam no cache e cada auditoria só lê o pedido novo. As conversas só usam esse slot quando todos os outros estão ocupados. Ferramentas de conector que só leem e ferramentas já aprovadas 3 vezes com risco baixo na conversa passam sem chamar o modelo. |
| **Por que releu** | O studio sobe o llama-server com `LLAMA_SERVER_SLOTS_DEBUG`: quando um pedido diverge do que o slot tinha guardado e o motivo não está no próprio pedido, a conversa mostra o trecho em que o servidor viu a diferença. |
| **Laços cortados cedo** | A mesma chamada devolvendo o mesmo resultado 3 vezes, ou o mesmo erro 3 vezes, gera um aviso ao modelo (e uma linha na conversa); se ele insistir, a resposta para com um botão **Continuar mesmo assim**. O limite de passos (40 por padrão) estica sozinho, até 3 vezes, enquanto a lista de tarefas avança ou arquivos são alterados; faltando 2 passos, o modelo é avisado para fechar com um resumo do que fez e do que falta. |
| **Sem leituras repetidas** | Resultado idêntico a um que ainda está no contexto vai como referência curta. Pedir de novo o arquivo inteiro depois do sumário entrega o próximo trecho ainda não lido, e, quando tudo já foi lido, só um aviso. |
| **Cache por conversa** | Cada conversa tem um slot no llama-server. Quando outra conversa precisa do slot, o cache vai para o disco e volta quando ela é retomada, então uma conversa longa não é reprocessada do zero. |
| **Pensar ou responder direto** | Um botão na barra do chat liga ou desliga o raciocínio por conversa. Pedidos simples saem na hora. |
| **Prompt estável** | O prompt de sistema é idêntico entre mensagens (sem hora, sem listas que mudam). Uma habilidade ou conector ligado no meio da conversa entra junto com a mensagem, não no prompt de sistema; um conector desligado continua no catálogo da conversa (a chamada só falha). Quando o servidor precisa reler, a conversa diz qual parte mudou. Assim o llama-server reaproveita o cache e não relê a conversa inteira. |
| **Carregamento sob demanda** | Conectores entram como um catálogo de uma linha por ferramenta (só os nomes, se tiver mais de 25); o modelo procura com `search_tools` (só mostra) e carrega pelo nome só as que vai usar. Cada conector escolhe em **Carregar ferramentas**: Automático (citado no pedido, vai completo só se for pequeno), Sob demanda ou Completo. Habilidades longas entram só com o resumo. |
| **Arquivos grandes sem desperdício** | Ler um arquivo grande (mais de 400 linhas ou 40 KB) sem trecho devolve um sumário com o número da linha: seções e figuras no LaTeX, títulos no Markdown, funções e classes no código. O modelo lê só os trechos que precisa, procura dentro do arquivo com `search_files`, e edita por linhas (`start_line`/`end_line`, sem repetir o texto antigo) ou com várias trocas numa chamada só. Quebras de linha do Windows (CRLF) são mantidas. O studio empurra o modelo para esse caminho: ler um arquivo grande inteiro pelo terminal (`Get-Content`, `cat`, `type`) é recusado com a indicação do `read_file`, trechos acima de 600 linhas são cortados, e reescrever um arquivo grande para mudar pouco funciona, mas volta com uma dica de quanto mudou e como usar `edit_file`. Vale também para os arquivos das habilidades (`read_skill_file`). Pastas com mais de 300 itens listam o resto como contagem por tipo, buscas mostram até 120 resultados, trechos param em 24 KB, e saídas de conectores acima de 12 mil caracteres ficam resumidas, com o texto completo salvo num arquivo. |
| **Esquemas enxutos** | As definições das ferramentas MCP vêm sem títulos, exemplos e campos que não ajudam o modelo, e com descrições encurtadas. |
| **Saídas compactadas** | As saídas de comandos e conectores perdem cores ANSI e barras de progresso, e linhas repetidas viram uma. Saídas longas mantêm começo e fim, e a saída completa fica salva para consulta. O RTK resume `git`, `cargo`, `pytest` e outros. |
| **Compactação automática** | Perto do limite, o meio da conversa é resumido. O primeiro pedido e o final ficam intactos. |
| **Imagens** | Imagens vão só na mensagem seguinte à captura, depois saem do histórico. |
| **Busca rápida** | A busca por conteúdo usa o ripgrep quando ele está instalado e respeita o `.gitignore`. |

No sistema, o programa roda com prioridade abaixo do normal e no modo EcoQoS do Windows. Os processos filhos ficam presos a um *job object* e morrem junto com ele.

## Atualizações

Cada release publica:

- `llama-studio-setup-X.Y.Z.exe`: o instalador completo.
- `llama-studio.exe`: o programa. O app baixa, confere o SHA-256 com o `SHA256SUMS.txt` da release, troca o executável e reinicia.
- `ui.zip`: só a interface, também conferida pelo `SHA256SUMS.txt`. O app instala em `dados\ui` e recarrega, sem reiniciar.

Uma interface nova só é aplicada se o executável for compatível: o `ui/min-exe.txt` diz a versão mínima que ela exige.

## Desenvolvimento

```
cargo build --release
```

| Pasta | O quê |
|---|---|
| `src/` | Servidor local (axum), cliente MCP, gerenciador do llama-server, ferramentas, downloads, janela e bandeja |
| `ui/` | Interface (HTML, CSS e JS sem build), embutida no executável |
| `ui/js/` | O JavaScript da interface, um arquivo por assunto (`01-base.js` … `16-inicio.js`). São scripts comuns que dividem o mesmo escopo e carregam na ordem do número; código que roda ao carregar só pode usar o que vem de arquivos anteriores. |
| `ui/i18n/` | Traduções. O texto em português é a chave: na interface `L('texto', ...)` com `{0}`, `{1}`; no Rust `L!(pt, en)` e `LF!(pt, en, args)` (`src/i18n.rs`). As descrições das ferramentas em inglês ficam em `src/tools_en.rs`. |
| `tests/` | `rotas/`: frases que conferem os recursos automáticos. `ordem/`: confere a regra de ordem dos arquivos de `ui/js`. Os dois rodam no CI. |
| `installer/` | Instalador (Inno Setup) |
| `.github/workflows/ik-llama.yml` | Compila o ik_llama.cpp para Windows e publica como pré-release `ik-*` |
| `assets/` | Ícone |
| `.github/workflows/` | CI e publicação |

Opções de linha de comando: `--navegador` (abre no navegador em vez da janela), `--bandeja` (começa minimizado) e `--iniciar-servidor` (sobe o llama-server ao abrir).

**Publicar uma versão:** suba o `version` no `Cargo.toml` e faça push no `main`. O workflow `Release` compila no Windows, gera o instalador com o llama.cpp mais recente, cria o tag e publica tudo. Pushes sem mudança de versão só compilam.

Bibliotecas de terceiros em `ui/vendor`: marked (MIT), DOMPurify (Apache-2.0/MPL-2.0) e highlight.js (BSD-3-Clause).

## Licença

O Llama Studio é software livre, sob a [GNU GPL v3](LICENSE) ou posterior: você pode usar, estudar, mudar e redistribuir, e quem distribuir uma versão modificada precisa publicar o código dela sob a mesma licença.
