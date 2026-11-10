---
name: Editor de vídeo (cortes e edição)
description: Método para editar gravações do projeto com as ferramentas de vídeo (video_captions, video_find, video_look, video_edit). Diz como achar os momentos e montar o vídeo conforme a situação: corte de live, melhores momentos de gameplay, tiroteio ou combate, momentos engraçados, react, tutorial, conversa ou podcast, montagem no ritmo da música e resumo horizontal. Use sempre que o pedido for editar, cortar ou resumir um vídeo que está em public/.
version: 1
---

# Editor de vídeo

Você edita gravações que estão em public/ montando uma lista de edição com video_edit. O studio transforma a lista em vídeo do Remotion; você não escreve React.

Siga as 7 etapas na ordem. Na etapa 3 escolha UMA receita (ou duas, se o pedido misturar) e use os parâmetros dela.

## Regras que valem sempre

1. **Tempo:** todo from/to é em SEGUNDOS do arquivo original (175.5) ou texto "2:55.5". Nunca 2.55 para dizer 2:55.
   - Exceção: at de texts e punch é em segundos desde o início do trecho, não do arquivo.
2. **Formato:**
   - edl.format sempre preenchido.
   - Shorts, Reels e TikTok: "9:16". YouTube normal: "16:9". Feed do Instagram: "4:5" ou "1:1".
   - É a proporção do vídeo FINAL, não da gravação: gravação 16:9 vira 9:16 se o destino for Shorts.
   - Se o usuário não disser, pergunte o destino ou use 9:16.
3. **Duração:**
   - Some os trechos ANTES de montar.
   - Transições que não são "cut" sobrepõem os trechos e encurtam o total (0,5 s cada). speed 1.25 encurta o trecho em 20%.
   - Depois de montar, confira a duração e o tamanho na resposta do video_edit. Se não bater com o pedido, ajuste e chame de novo.
4. **Nunca suponha o que aparece na tela pela fala.**
   - Confirme com video_look antes de escolher um trecho.
   - As ferramentas não ouvem sons que não são fala (tiros, explosões, música). Esses momentos só se acham olhando quadros.
5. **Um momento por trecho, cortado no lugar certo:**
   - Começa um pouco antes da ação (0,5 a 2 s) e termina logo depois da reação.
   - Não corte no meio de uma frase nem de uma troca de tiros.
6. **cutSilences tira tudo o que não tem fala.**
   - Use só quando a fala é o conteúdo (tutorial, conversa, live falada).
   - Em gameplay e ação ele apaga justamente a ação.
   - Com cutSilences, ponha o at de texts e punch num instante com fala: o que cair numa pausa cortada é descartado.
7. Se o usuário pediu para ver o roteiro antes, mostre e ESPERE. Se não pediu, mostre e monte em seguida.

## 1. Entender o pedido

Antes de tudo, defina, deduzindo do pedido sempre que der:
- **Arquivo:** use list_directory em public/ se o nome não for dado.
- **Destino e formato:** Shorts, Reels, TikTok, YouTube ou feed.
- **Duração alvo:** se não for dada, Shorts de melhores momentos 30–60 s, corte de live 40–120 s, YouTube 3–10 min.
- **Tipo de conteúdo e o que o usuário quer destacar:** escolhe a receita na etapa 3.
- **Quantos vídeos:** um corte só ou vários.

## 2. Inventário

- video_look no arquivo inteiro com 24 quadros: estrutura, menus, partes paradas, se tem facecam, onde fica a ação na tela.
- video_captions (language "pt", model "small"). Pule se public/captions/<nome>.json já existir.
  - Legenda vazia ou só ruído: o vídeo não tem fala; siga só pelos quadros.
  - Com fala: video_find sem query, num pedaço, mostra o estilo; com query, acha as reações.
- **Vídeo longo** (mais de 5 min) em que o momento é visual: varra em blocos de 3 minutos (video_look from/to, 24 quadros cada, um quadro a cada ~7 s). Pule blocos que forem menu ou tela parada.

## 3. Escolher a receita

| Situação | Sinais | Receita |
|---|---|---|
| Live ou vídeo com o streamer falando e reagindo | fala frequente, facecam, risadas, gritos | A. Corte de live |
| Gameplay em que a ação importa mais que a fala | pouca fala, muita ação na tela | B. Melhores momentos |
| Gameplay com combate | armas, inimigos, barras de vida, abates | C. Tiroteio e combate |
| Falhas, mortes bobas, bugs, sustos | risadas, "kkk", personagem caindo | D. Engraçados |
| Dois vídeos: a pessoa reagindo e o conteúdo | dois arquivos em public/ | E. React |
| Explicação, aula, tutorial | fala contínua, tela parada ou demonstração | F. Tutorial |
| Conversa, podcast, entrevista, vlog | rostos falando, pouca ação | G. Conversa |
| Edição no ritmo de uma música | arquivo de áudio em public/ | H. Música |
| Resumo longo horizontal | destino YouTube 16:9 | I. Resumo |

## 4. Achar os momentos (por receita)

### A. Corte de live
- **Objetivo:** UM momento contado do começo ao fim (contexto, clímax, reação). 40 a 120 s.
- **Busca:** video_find com query "caraca|meu deus|não acredito|kkk|socorro|morri|perdi|ganhei|corre|para|olha isso". Para cada achado, video_find from 40 s antes e to 20 s depois, para ler o contexto.
- **Confirmar:** video_look do trecho com 12 quadros.
- **Nota de 1 a 10 por:** reação forte, história fechada, entendível sem contexto da live.

### B. Melhores momentos de gameplay
- **Objetivo:** vários lances curtos, em ordem crescente de intensidade. 30 a 60 s.
- **Busca:** inventário em blocos procurando perseguições, quase mortes, recordes, quedas, partes difíceis vencidas. Com fala, some a query da receita A.
- **Por trecho, anote:** segundo do impacto e posição horizontal da ação (vira focusX).

### C. Tiroteio e combate
- **Objetivo:** trocas de tiros, abates, explosões, viradas. 45 a 60 s em Shorts.
- **Sinais na tela:**
  - clarão de disparo, rastro de bala, faíscas;
  - inimigos atirando ou caindo, explosões;
  - barra de vida caindo, tela vermelha;
  - munição ou recarga;
  - marcador de acerto ou abate.
- **Busca:**
  - Varredura em blocos (obrigatória: tiro não aparece na legenda).
  - Agrupe sinais com menos de 10 s entre eles num trecho.
  - Com fala, video_find com query "atira|tiro|bala|munição|recarrega|matei|mata|morre|morreu|headshot|pega ele|cuidado|atrás|explodiu|granada" e confirme cada achado com video_look.
- **Prioridade:** abates seguidos > quase morte com virada > explosão > troca de tiros longa.
- Perseguição sem disparo não conta, a não ser que emende num tiroteio.

### D. Engraçados
- **Objetivo:** falhas e reações curtas; o riso vem do timing.
- **Busca:** query "kkk|kkkk|haha|não acredito|que isso|socorro|bug|morri|ai|nossa". Na tela: personagem caindo, travando, morrendo de forma boba.
- O trecho vai até o fim da risada, nem um segundo a mais.

### E. React
- **Precisa de dois arquivos:** a facecam (cam) e o conteúdo. A cam começa em sincronia: cam.from = onde a cam está quando o trecho começa.
- **Limite:** se a facecam está embutida na mesma gravação, não dá para separar. Use layout "full" com focusX/focusY no conteúdo, ou avise o usuário.
- **Busca:** reações da pessoa (receita A sobre o arquivo da cam, com captions.source "cam").

### F. Tutorial
- **Objetivo:** explicação enxuta, sem pausas, hesitações e repetições.
- **Busca:** video_find sem query, em pedaços, para mapear os tópicos. Corte "é...", recomeços e trechos fora do assunto.
- Mantenha a ordem da explicação.

### G. Conversa ou podcast
- **Objetivo:** a melhor ideia ou história da conversa, que se entende sozinha.
- **Busca:** video_find em pedaços. Procure frases de impacto, opiniões fortes, histórias com começo e fim, perguntas boas com resposta curta.
- Prefira uma resposta inteira a várias metades.

### H. Música
- **Objetivo:** cortes no ritmo da música.
- Trechos de duração igual ou múltipla da batida (ex.: 120 BPM = 0,5 s por batida; trechos de 2 ou 4 s). Os melhores visuais caem nas viradas.
- music.src é o arquivo em public/; volume 0.6 a 1. Abaixe o áudio dos trechos (volume 0 a 0.2).

### I. Resumo horizontal (YouTube)
- **Objetivo:** a história do vídeo em ordem, sem as partes paradas. format "16:9".
- **Busca:** inventário e varredura para marcar menus, loadings, esperas e repetições; essas partes saem.
- Trechos longos (10 a 60 s). Transições "fade" entre partes ou fases.

## 5. Roteiro

Mostre ao usuário uma linha por trecho com: início e fim no arquivo (segundos), duração, o que acontece, focusX e layout. Depois a soma.

Estrutura padrão para vídeos curtos:
- **Gancho (1 a 2 s, ou até 3 s em fala):** o instante mais forte, como prévia. Esse momento aparece de novo, inteiro, depois.
- **Desenvolvimento:** os momentos em ordem crescente de intensidade (receitas B, C, D) ou o contexto do momento (A, G).
- **Clímax e final:** o melhor momento ou a reação, terminando seco. Opcional: texto "PARTE 2?" ou uma piada curta.

## 6. Montar com video_edit

### Parâmetros por receita

| Receita | layout | cutSilences | captions | trechos | transições | efeitos |
|---|---|---|---|---|---|---|
| A. Live | full (ou fit) | sim (minSilence 0.4) | tiktok, center | 1 a 3 longos | cut | punch no clímax e na reação |
| B. Melhores | full | não | tiktok se houver fala; senão none | 2 a 6 s cada | cut; slide ou zoom em até 2 mudanças de fase | punch no impacto; speed 1.25 em deslocamentos |
| C. Tiroteio | full | não | idem B | 3 a 8 s cada | cut; zoom em até 2 viradas | punch em cada abate ou explosão (dur 0.4); sem speed nos tiroteios |
| D. Engraçados | full | não | tiktok | 2 a 8 s | cut | punch no instante da falha; texto curto de reação |
| E. React | react (split 0.4 a 0.5) | sim, se a fala da cam importa | tiktok, source "cam" | longos | cut | punch na reação |
| F. Tutorial | fit, ou full na região importante | sim (minSilence 0.5) | line, bottom | longos | cut ou fade | zoom 1.1 lento em demonstrações |
| G. Conversa | full no rosto (focusX) | sim (minSilence 0.5) | tiktok, center | 1 a 3 longos | cut | punch nas frases fortes |
| H. Música | full | não | none | no ritmo | cut (ou fade curto) | punch nas batidas fortes; filter opcional |
| I. Resumo | fit/full em 16:9 | só em partes faladas | line ou none | 10 a 60 s | fade 0.5 entre partes | — |

### Layout e recorte (9:16 a partir de gravação 16:9)

- **full:** preenche a tela recortando; só cerca de 1/3 da largura aparece.
  - focusX = posição horizontal da ação (0 esquerda, 0.5 meio, 1 direita). É aproximado: ação muito perto da borda fica no limite do recorte.
  - Se a ação muda de lado, divida o trecho em partes com focusX diferentes.
- **fit:** a gravação inteira numa faixa no meio, com fundo desfocado. Use quando o recorte perderia algo essencial (dois personagens em lados opostos, interface importante).
- Evite alternar full e fit a cada trecho: a imagem fica pulando.

### Textos e ênfase

- **texts:** até 5 palavras, style "label", pos "top" (a legenda fica em center ou bottom), dur 2 a 3 s.
  - Um no gancho (curiosidade sem spoiler) e, se quiser, um no final.
  - Não cubra a ação.
- **punch:** scale 1.15 a 1.25, dur 0.4 a 0.6, no instante do impacto. No máximo 1 a cada 2 s.
- **zoom:** aproximação lenta (1.05 a 1.15) para trechos parados longos.
- **speed:** 1.25 a 1.5 só em deslocamento sem ação. Acelerar fala ou tiroteio estraga o som.

### Depois de chamar video_edit

- Confira na resposta:
  - tamanho (1080x1920 para 9:16);
  - duração dentro do alvo;
  - nota do teste.
- Se avisar erro ou duração errada, corrija a lista e chame de novo com o mesmo name. Ele substitui a anterior.
- Para vários cortes, um name por corte (Corte1, Corte2...).

## 7. Conferir e entregar

- **Ao usuário:**
  - duração final;
  - lista de trechos (segundos do arquivo, layout, focusX);
  - o que conferir na prévia (gancho, recortes, legenda).
- **Quando ele renderizar:** video_look com file "out/<Nome>" e 16 quadros. Confira:
  - formato certo, sem faixas indesejadas;
  - ação dentro do recorte;
  - legenda em sincronia;
  - texto sem cobrir a ação;
  - gancho forte no primeiro segundo;
  - final sem tempo morto.
- Sugira ajustes concretos: qual trecho, quais segundos, qual parâmetro.
- **Para postar, se pedido:** título até 60 caracteres (curiosidade, sem spoiler), descrição de uma linha, 5 hashtags. Pesquise as hashtags na web se tiver acesso; senão, diga que são sugestões.
