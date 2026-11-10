/* llama studio - Vídeos: app opcional com o Remotion (vídeos feitos em React, escritos pelo agente) */
'use strict';

/* ------------------------------------------------------------ estado e ativação */
const VID = { data: null, sel: store.get('vidSel', null), comps: {}, compErr: {}, media: {}, up: null, poll: 0, busy: false };
const VIDEO_SKILL = 'remotion-best-practices';
const VIDEO_NOTE = L('Este projeto é um vídeo do Remotion (React). Para editar gravações que estão em public/ (cortes, tirar pausas, recorte vertical, react com facecam em cima, legendas, transições, zoom, música), use video_edit com uma lista de edição: o studio monta com um modelo pronto, sem você escrever React. Antes de escolher os tempos, veja o vídeo com video_look e a fala com video_find (gere a legenda com video_captions). Para animações criadas do zero, use video_scenes: você escreve o roteiro e a equipe escreve as cenas em paralelo. Depois de mudar código à mão, confira com video_check. A prévia do Remotion Studio atualiza sozinha.');

function videosOn() { return S.settings.videos === true; }
function applyVideosNav() {
  const b = $('.nav-item[data-view="videos"]');
  if (b) b.hidden = !videosOn();
  if (!videosOn() && S.view === 'videos') setView('chat');
}

/** Liga ou desliga o app (em Utilitários). Ligar baixa as habilidades oficiais do Remotion. */
async function setVideosOn(on) {
  S.settings.videos = on; store.set('settings', S.settings);
  applyVideosNav();
  if (on) {
    const d = await api('/api/videos').catch(() => null);
    if (d && !d.skills?.length) {
      toast(L('Baixando as habilidades do Remotion...'));
      try { const r = await api('/api/videos/skills', {}); toast(L('{0} habilidades do Remotion instaladas', r.installed)); loadSkills().catch(() => {}); }
      catch (e) { toast(e.message, 'err'); }
    }
  } else {
    api('/api/videos/studio', { action: 'stop' }).catch(() => {});
  }
}

/* ------------------------------------------------------------ página */
async function loadVideos() {
  try { VID.data = await api('/api/videos'); } catch (e) { VID.data = { error: e.message, projects: [], jobs: [] }; }
}

async function renderVideos() {
  if (!VID.data) { $('#vid-body').innerHTML = ''; $('#vid-body').append(h('div.muted', null, L('Carregando...'))); await loadVideos(); }
  drawVideos();
  pollVideos();
}

function pollVideos() {
  clearTimeout(VID.poll);
  if (S.view !== 'videos') return;
  const busy = VID.data?.jobs?.some((j) => !j.done);
  VID.poll = setTimeout(async () => {
    if (S.view !== 'videos') return;
    const before = JSON.stringify(VID.data?.jobs || []);
    await loadVideos();
    // redesenha só quando algo mudou; se só andou o progresso, troca só os cartões dos trabalhos
    // (redesenhar tudo recarregava a prévia e as miniaturas a cada 1,2 s: a tela piscava em branco)
    const shape = (js) => JSON.stringify((js || []).map((j) => [j.kind, j.project, j.out, j.started, j.done]));
    const jobsBox = $('#vid-body .vid-jobs');
    const p = vidProject(VID.sel);
    if (jobsBox && p && shape(JSON.parse(before)) === shape(VID.data?.jobs)) {
      if (JSON.stringify(VID.data?.jobs || []) !== before) jobsBox.replaceChildren(...jobCards(p, VID.data));
    } else if (JSON.stringify(VID.data?.jobs || []) !== before) {
      if ((VID.data?.jobs || []).some((j) => j.kind === 'captions' && j.done) && /"kind":"captions",[^}]*"done":false/.test(before)) delete VID.media[VID.sel];
      drawVideos(true);
    }
    pollVideos();
  }, busy ? 1200 : 6000);
}

function vidProject(id) { return (VID.data?.projects || []).find((p) => p.id === id); }

/* Layout de editor: barra no topo (projeto e ações), palco grande (prévia do Remotion Studio ou o vídeo escolhido)
   e um painel lateral que rola sozinho (trabalhos, vídeos renderizados, mídia). Em tela estreita vira uma coluna. */
function drawVideos(keepPreview) {
  const box = $('#vid-body');
  const d = VID.data || {};
  // o palco (prévia do Remotion Studio ou vídeo assistido) fica no lugar se vai mostrar a mesma coisa:
  // tirar um iframe ou um <video> do documento e pôr de volta recarrega (e pisca em branco)
  const oldWork = box.querySelector(':scope > .vid-work');
  const oldStage = oldWork?.querySelector(':scope > .vid-stage');
  const sideTop = $('.vid-side')?.scrollTop || 0;
  for (const n of [...box.childNodes]) if (n !== oldWork) n.remove();
  const add = (el) => (oldWork ? box.insertBefore(el, oldWork) : box.append(el));
  const creating = (d.jobs || []).filter((j) => j.kind === 'create' && !j.done);
  const failed = (d.jobs || []).filter((j) => j.kind === 'create' && j.done && !j.ok);
  const p = vidProject(VID.sel) || (d.projects || [])[0];
  if (p && VID.sel !== p.id) VID.sel = p.id;

  // criar projeto (na barra, ou no meio da tela quando ainda não há nenhum)
  const name = h('input.input', { placeholder: L('Nome do vídeo (ex.: abertura do canal)'), maxlength: 60 });
  const create = h('button.btn.primary', { type: 'button', disabled: !d.node, onclick: async () => {
    if (!name.value.trim()) { name.focus(); return; }
    create.disabled = true;
    try { const r = await api('/api/videos/create', { name: name.value.trim() }); VID.sel = r.id; store.set('vidSel', r.id); VID.newOpen = false; toast(L('Criando "{0}"... (baixa o modelo e instala as dependências, alguns minutos na primeira vez)', r.id)); await loadVideos(); drawVideos(); pollVideos(); }
    catch (e) { toast(e.message, 'err'); create.disabled = false; }
  } }, ic('plus'), L('Criar'));
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') create.click(); if (e.key === 'Escape') { VID.newOpen = false; drawVideos(true); } });
  const newForm = h('div.vid-new', null, name, create);

  const top = h('div.vid-top', null, h('h1.vid-title', null, L('Vídeos')));
  if ((d.projects || []).length || creating.length) {
    const sel = h('select.select.vid-proj', { title: p ? p.path : '' },
      (d.projects || []).map((x) => h('option', { value: x.id }, x.id + (d.studio?.project === x.id ? ' · ' + L('prévia') : ''))),
      creating.map((j) => h('option', { value: '', disabled: true }, `${j.project} · ${L('criando...')}`)));
    if (p) sel.value = p.id;
    sel.addEventListener('change', () => { if (!sel.value) return; VID.sel = sel.value; VID.watch = null; store.set('vidSel', sel.value); drawVideos(); });
    top.append(sel, h('button.icon-btn', { type: 'button', title: L('Novo projeto'), 'aria-label': L('Novo projeto'), html: svg('plus'), onclick: () => { VID.newOpen = !VID.newOpen; drawVideos(true); if (VID.newOpen) setTimeout(() => $('.vid-top .vid-new input')?.focus()); } }));
    if (VID.newOpen) top.append(newForm);
  }
  if (p) top.append(...projectActions(p, d));
  add(top);

  // avisos em uma linha cada
  const warn = (icon, ...kids) => add(h('div.vid-warn', null, ic(icon), ...kids));
  if (d.error) warn('alert', d.error);
  if (!d.node) warn('alert', h('span', null, L('O Node.js não foi encontrado neste PC. O Remotion precisa do Node 18 ou mais novo (nodejs.org) e do Git para criar projetos. Depois de instalar, reabra o studio.')));
  if (!d.skills?.length) warn('sparkles', h('span', null, L('As habilidades do Remotion não estão instaladas: sem elas o modelo escreve vídeos piores.')),
    h('button.btn.sm', { onclick: async (e) => { e.target.disabled = true; try { const r = await api('/api/videos/skills', {}); toast(L('{0} habilidades do Remotion instaladas', r.installed)); loadSkills().catch(() => {}); await loadVideos(); drawVideos(); } catch (er) { toast(er.message, 'err'); e.target.disabled = false; } } }, L('Instalar')));
  for (const j of failed) warn('alert', h('div', null, h('b', null, L('Não consegui criar "{0}"', j.project)), h('pre.vid-log', null, j.tail)));
  if (p && VID.compErr[p.id]) warn('alert', h('span', null, L('Não consegui listar as composições: {0}', VID.compErr[p.id])),
    h('button.btn.sm', { onclick: () => { delete VID.comps[p.id]; delete VID.compErr[p.id]; drawVideos(true); } }, L('Tentar de novo')));
  if (p && !p.ready) warn('alert', h('span', null, L('As dependências deste projeto não estão instaladas. Rode "npm install" na pasta dele (pela conversa do projeto, por exemplo).')));

  if (!p) {
    oldWork?.remove();
    box.append(h('div.vid-empty', null, ic('film'),
      h('p', null, L('Crie um projeto. O studio monta um projeto do Remotion em branco; depois, numa conversa ligada a ele, você pede o vídeo (ou envia gravações para editar) e acompanha na prévia.')),
      creating.length ? h('div.muted', null, L('Criando "{0}"...', creating[0].project)) : newForm));
    return;
  }
  const side = h('div.vid-side', null, h('div.vid-jobs', null, ...jobCards(p, d)), rendersSection(p), mediaSection(p));
  const key = stageKey(p, d);
  if (oldStage && oldStage.dataset.key === key) {
    for (const c of [...oldWork.children]) if (c !== oldStage) c.remove();
    oldWork.append(side);
  } else {
    oldWork?.remove();
    const st = stage(p, d);
    st.dataset.key = key;
    box.append(h('div.vid-work', null, st, side));
  }
  side.scrollTop = sideTop;
}

/** Ações do projeto, na barra: conversa, prévia, composição + renderizar, apagar. */
function projectActions(p, d) {
  const live = d.studio?.project === p.id;
  const rendering = (d.jobs || []).some((j) => j.project === p.id && j.kind === 'render' && !j.done);
  // composições: o CLI do Remotion lista (demora uns segundos na primeira vez)
  const comps = VID.comps[p.id];
  const sel = h('select.select.vid-comp', { disabled: !comps?.length, title: L('Composição') }, (comps || []).map((c) => h('option', { value: c }, c)));
  if (comps?.includes(VID.comp?.[p.id])) sel.value = VID.comp[p.id];
  else if (comps?.includes('Video')) sel.value = 'Video';
  sel.addEventListener('change', () => { (VID.comp ||= {})[p.id] = sel.value; });
  // undefined = ainda não pediu; null = pedindo (não pede de novo a cada atualização da página)
  if (comps === undefined && p.ready) {
    VID.comps[p.id] = null;
    api('/api/videos/compositions?id=' + encodeURIComponent(p.id)).then((r) => { VID.comps[p.id] = r.compositions; if (S.view === 'videos' && VID.sel === p.id) drawVideos(true); })
      .catch((e) => { VID.comps[p.id] = []; VID.compErr[p.id] = e.message; if (S.view === 'videos' && VID.sel === p.id) drawVideos(true); });
  }
  const preview = h('button.btn' + (live ? '' : '.primary'), { type: 'button', disabled: !p.ready || VID.busy, onclick: async () => {
    VID.busy = true; preview.disabled = true;
    try {
      if (live) await api('/api/videos/studio', { action: 'stop' });
      else { VID.watch = null; toast(L('Abrindo o Remotion Studio... (a primeira vez empacota o projeto)')); await api('/api/videos/studio', { id: p.id }); }
      await loadVideos();
    } catch (e) { toast(e.message, 'err'); }
    VID.busy = false; drawVideos();
  } }, ic(live ? 'stop' : 'play'), live ? L('Fechar prévia') : L('Abrir prévia'));
  const render = h('button.btn', { type: 'button', disabled: !p.ready || !comps?.length || rendering, title: comps === null ? L('Listando as composições...') : '', onclick: async () => {
    try { await api('/api/videos/render', { id: p.id, comp: sel.value }); await loadVideos(); drawVideos(true); pollVideos(); } catch (e) { toast(e.message, 'err'); }
  } }, ic('download'), L('Renderizar MP4'));
  const chat = h('button.btn', { type: 'button', onclick: () => videoChat(p) }, ic('chat'), L('Conversa do projeto'));
  const del = h('button.icon-btn', { type: 'button', title: L('Apagar projeto'), 'aria-label': L('Apagar projeto'), html: svg('trash'), onclick: async () => {
    if (!(await confirmBox(L('Apagar o projeto "{0}" e os vídeos dele? Não dá para desfazer.', p.id), L('Apagar'), true))) return;
    try { await api('/api/videos/delete', { id: p.id }); VID.sel = null; VID.watch = null; await loadVideos(); drawVideos(); } catch (e) { toast(e.message, 'err'); }
  } });
  return [chat, preview, h('span.spacer'), h('span.vid-render', null, sel, render), del];
}

/** O que o palco mostra; mesma chave = o palco atual fica como está. */
function stageKey(p, d) {
  const live = d.studio?.project === p.id;
  const w = VID.watch?.project === p.id ? VID.watch : null;
  if (w) return `watch:${p.id}:${w.from}:${w.file}:${live}`;
  if (live) return `live:${p.id}:${d.studio.port}`;
  return `idle:${p.id}:${!!p.ready}`;
}

/** O palco: o vídeo escolhido no painel, ou a prévia ao vivo do Remotion Studio, ou um convite para abri-la. */
function stage(p, d) {
  const live = d.studio?.project === p.id;
  const w = VID.watch?.project === p.id ? VID.watch : null;
  if (w) {
    const url = w.from === 'public' ? mediaUrl(p.id, w.file) : `/api/videos/file?id=${encodeURIComponent(p.id)}&f=${encodeURIComponent(w.file)}`;
    const media = /\.(png|jpe?g|gif|webp|svg)$/i.test(w.file) ? h('img', { src: url, alt: w.file }) : /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(w.file) ? h('audio', { src: url, controls: true }) : h('video', { src: url, controls: true, autoplay: true });
    return h('div.vid-stage.watch', null,
      h('div.vid-stage-bar', null, h('b', null, w.file), h('span.spacer'), h('a.btn.sm', { href: url + (w.from === 'public' ? '&dl=1' : ''), download: w.file.split('/').pop() }, ic('download'), L('Baixar')),
        h('button.btn.sm', { type: 'button', onclick: () => { VID.watch = null; drawVideos(); } }, ic('x'), live ? L('Voltar à prévia') : L('Fechar'))),
      h('div.vid-stage-media', null, media));
  }
  if (live) {
    const src = `http://127.0.0.1:${d.studio.port}/`;
    const frame = h('iframe#vid-frame', { src, allow: 'autoplay; fullscreen; clipboard-write', title: L('Prévia do Remotion Studio') });
    return h('div.vid-stage', null, frame,
      h('div.vid-preview-foot', null, h('small.muted', null, L('Remotion Studio na porta {0}. Atualiza sozinho quando o agente edita os arquivos.', d.studio.port)),
        h('a.small', { href: src, target: '_blank', rel: 'noopener' }, ic('external'), L('Abrir no navegador'))));
  }
  return h('div.vid-stage.idle', null, h('div.vid-stage-empty', null, ic('play'),
    h('p', null, L('A prévia está fechada. Abra para ver o vídeo ao vivo enquanto o modelo edita, ou escolha um vídeo no painel ao lado para assistir.')),
    h('button.btn.primary', { type: 'button', disabled: !p.ready, onclick: () => $('.vid-top .btn.primary')?.click() }, ic('play'), L('Abrir prévia'))));
}

function jobCards(p, d) {
  return (d.jobs || []).filter((j) => j.project === p.id && (j.kind === 'render' || j.kind === 'captions')).map((j) => {
    const pct = Math.round((j.progress || 0) * 100);
    return h('div.vid-job' + (j.done ? (j.ok ? '.ok' : '.err') : ''), null,
      h('div.vid-job-head', null, h('b', null, j.kind === 'captions'
        ? (j.done ? (j.ok ? L('Legendas prontas: {0}', j.out) : L('As legendas falharam')) : L('Gerando legendas... {0}%', pct))
        : (j.done ? (j.ok ? L('Renderizado: {0}', j.out) : L('O render falhou')) : L('Renderizando {0}... {1}%', j.out, pct)))),
      j.done ? null : h('div.vid-bar', null, h('i', { style: { width: pct + '%' } })),
      j.done && !j.ok && j.err ? h('div.small', null, j.err) : null,
      !j.done || (!j.ok && !j.err) ? h('pre.vid-log', null, j.tail) : null);
  });
}

/** Vídeos renderizados: lista compacta; clicar abre no palco. */
function rendersSection(p) {
  const box = h('div.vid-sec', null, h('div.vid-sec-head', null, h('h3.sec-title', null, L('Vídeos')), h('small.muted', null, p.renders.length ? String(p.renders.length) : '')));
  if (!p.renders.length) { box.append(h('div.muted.small', null, L('Nenhum vídeo renderizado ainda. Escolha a composição na barra e clique em Renderizar MP4.'))); return box; }
  box.append(h('div.vid-rows', null, p.renders.slice(0, 30).map((r) => {
    const url = `/api/videos/file?id=${encodeURIComponent(p.id)}&f=${encodeURIComponent(r.file)}`;
    const on = VID.watch?.project === p.id && VID.watch.file === r.file;
    const thumb = /\.(png|gif)$/i.test(r.file) ? h('img', { src: url, alt: '', loading: 'lazy' }) : h('video', { src: url + '#t=1', preload: 'metadata', muted: true });
    return h('div.vid-row' + (on ? '.on' : ''), { title: L('Assistir no palco'), onclick: (e) => { if (e.target.closest('a')) return; VID.watch = { project: p.id, file: r.file, from: 'out' }; drawVideos(true); } },
      h('div.vm-thumb', null, thumb),
      h('div.vm-main', null, h('b', null, r.file), h('small.muted', null, `${fmtBytes(r.size)} · ${new Date(r.mtime * 1000).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' })}`)),
      h('a.icon-btn.sm', { href: url, download: r.file, title: L('Baixar'), 'aria-label': L('Baixar'), html: svg('download') }));
  })));
  return box;
}

/** Conversa ligada ao projeto: um projeto do studio com a pasta do vídeo, a habilidade do Remotion e a nota. */
function videoChat(p) {
  let proj = S.projects.find((x) => x.dir && x.dir.replace(/[\\/]+$/, '').toLowerCase() === String(p.path).replace(/[\\/]+$/, '').toLowerCase());
  if (!proj) {
    proj = { id: uid(), name: L('Vídeo: {0}', p.id), dir: p.path, instructions: VIDEO_NOTE, personaId: null, createdAt: Date.now(), open: true, video: p.id };
    S.projects.push(proj); saveProjects();
  }
  if (proj.video !== p.id) { proj.video = p.id; saveProjects(); }
  // projetos criados antes: a nota do projeto acompanha a versão atual (com as ferramentas novas)
  if (/^(Este projeto é um vídeo do Remotion|This project is a Remotion)/.test(proj.instructions || '') && proj.instructions !== VIDEO_NOTE) { proj.instructions = VIDEO_NOTE; saveProjects(); }
  // a última conversa do projeto, ou uma nova
  const last = S.convs.filter((c) => c.projectId === proj.id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (last) { selectConv(last.id); setView('chat'); return; }
  const conv = newConv(proj.id);
  const sk = S.skills.some((s) => s.id === VIDEO_SKILL) ? [VIDEO_SKILL] : S.skills.filter((s) => /^remotion/i.test(s.id)).slice(0, 1).map((s) => s.id);
  conv.auto = { groups: ['read', 'edit', 'write', 'shell', 'video'], mcp: [], skills: sk };
  conv.title = L('Vídeo: {0}', p.id); saveConvs(); renderConvList();
  setView('chat');
}

/* ------------------------------------------------------------ cenas em equipe (ferramenta video_scenes) */
// O modelo da conversa escreve o roteiro (estilo comum + cenas com duração e descrição). Cada cena vira um
// subagente que escreve só o arquivo dela, rodando nas APIs da equipe em paralelo (teamRun). Depois: monta a
// sequência, registra a composição "Video" no Root.tsx, confere os tipos e devolve os erros a quem escreveu.

const SCENE_TOOLS_READ = ['list_directory', 'read_file', 'search_files'];
const WRITE_SCENE = { type: 'function', function: { name: 'write_scene', description: 'Grava o código completo da sua cena (substitui o arquivo inteiro). Chame quando o código estiver pronto.', parameters: { type: 'object', properties: { code: { type: 'string', description: 'O arquivo .tsx inteiro' } }, required: ['code'] } } };
let VIDEO_SKILL_TEXT = null;

/** Regras do Remotion para os escritores: a habilidade oficial, se instalada (resumida). */
async function videoSkillText() {
  if (VIDEO_SKILL_TEXT != null) return VIDEO_SKILL_TEXT;
  try { const s = await api('/api/skills/get?id=' + encodeURIComponent(VIDEO_SKILL)); VIDEO_SKILL_TEXT = String(s.body || '').slice(0, 9000); }
  catch { VIDEO_SKILL_TEXT = ''; }
  return VIDEO_SKILL_TEXT;
}

function sceneFrames(sc, fps) { return Math.max(1, Math.round((Number(sc.seconds) || 3) * fps)); }

/** Escreve (ou corrige) uma cena. sm guarda a conversa do escritor (sm._msgs) para a rodada de correção. */
async function runSceneWriter(sc, plan, tctx, sm, apiId, owner) {
  const path = `src/scenes/${sc.name}.tsx`;
  const frames = sceneFrames(sc, plan.fps);
  if (!sm._msgs) {
    const list = plan.scenes.map((x, i) => `${i + 1}. ${x.name} (${x.seconds}s): ${x.description}`).join('\n');
    const skill = await videoSkillText();
    const sys = L('Você escreve UMA cena de um vídeo do Remotion (React + TypeScript), como parte de uma equipe: cada cena é escrita por um subagente diferente, ao mesmo tempo.') + '\n\n'
      + L('Regras:') + '\n'
      + L('- Arquivo: {0}. Exporte exatamente: export const {1}: React.FC = () => {...}', path, sc.name) + '\n'
      + L('- A cena começa no frame 0 e dura {0} frames ({1}s a {2} fps). Tela {3}x{4}. A raiz é <AbsoluteFill>.', frames, sc.seconds, plan.fps, plan.width, plan.height) + '\n'
      + L('- Tudo deriva do frame: useCurrentFrame(), useVideoConfig(), interpolate (com extrapolateLeft/extrapolateRight: "clamp") e spring. Nada de animação CSS, setTimeout, fetch ou Math.random (use random("semente") do remotion).') + '\n'
      + L('- Importe de "react", "remotion" e dos pacotes @remotion/* que já estão no projeto (ex.: @remotion/captions). Imagens, vídeos e sons só de public/ com staticFile(); se não houver, desenhe com formas, gradientes e texto.') + '\n'
      + L('- Estilos inline (objetos style). Fonte: as do sistema (ex.: "Inter, system-ui, sans-serif") ou a que o estilo pedir, se for do sistema.') + '\n'
      + L('- interpolate: a faixa de entrada tem que ser crescente. Para algo que diminui (partícula subindo, contagem regressiva), inverta as duas listas juntas: interpolate(y, [0, h * 0.7, h + 30], [0, 1, 0]), nunca [h + 30, h * 0.7, 0]. Com valores calculados, garanta a ordem para qualquer duração.') + '\n'
      + L('- Termine a cena de um jeito que emende na próxima (a descrição diz como).') + '\n\n'
      + (plan.media?.length ? L('Mídia em public/ (use com staticFile, sem o "public/"; vídeo com <OffthreadVideo>, áudio com <Audio>, recorte com trimBefore/trimAfter em frames):') + '\n' + plan.media.map((f) => `- ${f.file}${f.duration ? ' (' + fmtDur(f.duration) + ')' : ''}${f.captions ? ' · ' + L('legenda: {0}', f.captions) : ''}`).join('\n') + '\n\n' : '')
      + L('Estilo comum a todas as cenas:') + '\n' + plan.style + '\n\n'
      + L('Roteiro completo (para continuidade; você escreve só a cena {0}):', sc.name) + '\n' + list + '\n\n'
      + L('Pode olhar o projeto antes (list_directory, read_file), mas seja breve. Quando o código estiver pronto, chame write_scene com o arquivo inteiro. Não escreva explicações.')
      + (skill ? '\n\n' + L('Boas práticas do Remotion (habilidade oficial):') + '\n' + skill : '');
    sm._msgs = [{ role: 'system', content: sys }, { role: 'user', content: L('Cena {0} ({1}s): {2}', sc.name, sc.seconds, sc.description) }];
  }
  const msgs = sm._msgs;
  const { tools: readTools } = await api('/api/tools', { groups: ['read'], mcp: [], skills: [], only: SCENE_TOOLS_READ });
  const tools = [...readTools, WRITE_SCENE];
  const st = teamStart(apiId);
  sm.runOn = teamRunOn(st);
  sm._sub = sm._sub || [];
  for (let step = 0; step < 10; step++) {
    if (tctx.signal.aborted) return { ok: false, content: L('Cancelado.') };
    const last = step === 9;
    if (last) msgs.push({ role: 'user', content: L('Último passo: chame write_scene agora com o código completo.') });
    const m = { content: '', reasoning: '', tool_calls: [] };
    await teamStep(st, msgs, tools, m, tctx, sm);
    const calls = m.tool_calls.filter((t) => t && t.function?.name);
    calls.forEach((t) => { if (!t.id) t.id = 'call_' + uid(); });
    const text = splitThink(m.content).text;
    if (!calls.length) {
      // respondeu com o código no texto em vez de chamar a ferramenta: aproveita se for um componente
      const code = (text.match(/```(?:tsx|ts|jsx|typescript)?\n([\s\S]*?)```/) || [])[1];
      if (code && code.includes(`export const ${sc.name}`)) calls.push({ id: 'call_' + uid(), function: { name: 'write_scene', arguments: JSON.stringify({ code }) } });
      else { msgs.push({ role: 'assistant', content: text }, { role: 'user', content: L('Chame write_scene com o código completo da cena.') }); continue; }
    }
    msgs.push({ role: 'assistant', content: text, tool_calls: calls.map((t) => ({ id: t.id, type: 'function', function: { name: t.function.name, arguments: validArgs(t.function.arguments, () => {}) } })) });
    let wrote = null;
    for (const t of calls) {
      const a = parseArgs(t.function.arguments) || {};
      const row = { name: t.function.name, summary: t.function.name === 'write_scene' ? path : toolSummary(t.function.name, a), status: 'running' };
      sm._sub.push(row); scheduleRender();
      let r;
      if (t.function.name === 'write_scene') {
        const code = String(a.code || '');
        if (!new RegExp(`export\\s+const\\s+${sc.name}\\b`).test(code)) r = { content: L('O arquivo precisa exportar: export const {0}: React.FC = () => ...', sc.name), isError: true };
        else {
          // ponto de restauração no cartão do video_scenes: desfazer volta as cenas
          r = await execTool('write_file', { path, content: code.endsWith('\n') ? code : code + '\n' }, {}, tctx, { _cpOwner: owner });
          if (!r.isError) wrote = code;
        }
      } else if (SCENE_TOOLS_READ.includes(t.function.name)) r = await execTool(t.function.name, a, {}, tctx, {});
      else r = { content: L('Ferramenta não disponível aqui. Use: {0}, write_scene', SCENE_TOOLS_READ.join(', ')), isError: true };
      row.status = r.isError ? 'error' : 'ok'; scheduleRender();
      msgs.push({ role: 'tool', tool_call_id: t.id, content: String(r.content).slice(0, 16000) });
    }
    if (wrote != null) {
      sm.sub = sm._sub.map((x) => ({ name: x.name, summary: x.summary, status: x.status }));
      return { ok: true, content: L('{0}: {1} linhas', path, wrote.split('\n').length) };
    }
  }
  return { ok: false, content: L('O subagente não gravou a cena.') };
}

/** A sequência das cenas (src/scenes/Video.tsx), com as medidas que o Root.tsx lê. */
function videoSeries(plan) {
  const total = plan.scenes.reduce((n, sc) => n + sceneFrames(sc, plan.fps), 0);
  return '// Gerado pelo llama studio (video_scenes): a ordem e a duração de cada cena.\n'
    + 'import { Series } from "remotion";\n'
    + plan.scenes.map((sc) => `import { ${sc.name} } from "./${sc.name}";`).join('\n') + '\n\n'
    + `export const VIDEO = { fps: ${plan.fps}, width: ${plan.width}, height: ${plan.height}, durationInFrames: ${total} };\n\n`
    + 'export const Video: React.FC = () => {\n  return (\n    <Series>\n'
    + plan.scenes.map((sc) => `      <Series.Sequence durationInFrames={${sceneFrames(sc, plan.fps)}}>\n        <${sc.name} />\n      </Series.Sequence>`).join('\n')
    + '\n    </Series>\n  );\n};\n';
}

/** Erros do tsc por cena: { Abertura: ['src/scenes/Abertura.tsx(12,5): ...'], _outros: [...] }. */
function tscByScene(out, names) {
  const by = {};
  for (const line of String(out).split(/\r?\n/)) {
    if (!/error TS\d+/.test(line)) continue;
    const m = line.match(/src[\\/]scenes[\\/](\w+)\.tsx\(/);
    const k = m && names.includes(m[1]) ? m[1] : '_outros';
    (by[k] ||= []).push(line.trim());
  }
  return by;
}

async function runVideoScenes(args, tctx, tmsg) {
  const proj = projectOf(tctx.conv);
  const vid = proj?.video;
  if (!vid) return { content: L('video_scenes só funciona numa conversa de projeto de vídeo (abra pela página Vídeos › Conversa do projeto).'), isError: true };
  const plan = {
    style: String(args.style || '').trim(),
    fps: Math.max(1, Math.min(120, Number(args.fps) || 30)),
    width: Math.max(16, Math.min(7680, Number(args.width) || 1920)),
    height: Math.max(16, Math.min(7680, Number(args.height) || 1080)),
    scenes: (Array.isArray(args.scenes) ? args.scenes : []).map((s) => ({ name: String(s?.name || '').trim(), seconds: Math.max(0.2, Math.min(600, Number(s?.seconds) || 3)), description: String(s?.description || '').trim() })),
  };
  const bad = plan.scenes.filter((s) => !/^[A-Z][A-Za-z0-9]{0,40}$/.test(s.name) || s.name === 'Video');
  if (!plan.scenes.length) return { content: L('Passe pelo menos uma cena em scenes.'), isError: true };
  if (plan.scenes.length > 30) return { content: L('No máximo 30 cenas por vez.'), isError: true };
  if (bad.length) return { content: L('Nomes de cena inválidos: {0}. Use PascalCase só com letras e números (ex.: Abertura, Grafico2), sem "Video".', bad.map((s) => s.name || '""').join(', ')), isError: true };
  if (new Set(plan.scenes.map((s) => s.name)).size !== plan.scenes.length) return { content: L('Há nomes de cena repetidos.'), isError: true };
  try { plan.media = (await api('/api/videos/media', { id: vid })).files.filter((f) => f.kind !== 'other'); } catch { plan.media = []; }
  const only = Array.isArray(args.only) && args.only.length ? plan.scenes.filter((s) => args.only.includes(s.name)) : plan.scenes;
  if (!only.length) return { content: L('Nenhuma cena de only está em scenes.'), isError: true };

  // o cartão mostra cada cena como um agente da equipe
  tmsg.subs = only.map((sc, i) => ({ tool_call_id: `${tmsg.tool_call_id}-scene-${i}`, status: 'queued', task: `${sc.name} · ${sc.seconds}s`, where: '' }));
  scheduleRender();
  const results = new Array(only.length);
  const write = (idxs) => teamRun(idxs.length, async (k, apiId) => {
    const i = idxs[k], sc = only[i], sm = tmsg.subs[i];
    sm.status = 'running'; scheduleRender();
    let r;
    try { r = await runSceneWriter(sc, plan, tctx, sm, apiId, tmsg); }
    catch (e) { if (tctx.signal.aborted) throw e; r = { ok: false, content: String(e.message || e) }; }
    results[i] = r; sm.status = r.ok ? 'ok' : 'error'; sm.content = r.content; scheduleRender();
  }, tctx.signal);
  await write(only.map((_, i) => i));
  if (tctx.signal.aborted) return { content: L('Cancelado.'), isError: true };

  // sequência + composição no Root (uma vez)
  const lines = [];
  const w = await execTool('write_file', { path: 'src/scenes/Video.tsx', content: videoSeries(plan) }, {}, tctx, tmsg);
  if (w.isError) lines.push(L('Não consegui gravar src/scenes/Video.tsx: {0}', w.content));
  try { const r = await api('/api/videos/wire', { id: vid }); if (r.changed) lines.push(L('Registrei a composição "Video" em src/Root.tsx.')); }
  catch (e) { lines.push(L('Registre a composição você mesmo em src/Root.tsx (importe Video e VIDEO de "./scenes/Video"): {0}', e.message)); }

  // tipos: até 2 rodadas devolvendo os erros a quem escreveu cada cena
  let errs = {}, checked = false;
  for (let round = 0; round < 3; round++) {
    tmsg.phase = L('Conferindo os tipos...'); scheduleRender();
    let c;
    try { c = await api('/api/videos/check', { id: vid }); } catch (e) { lines.push(L('Não consegui conferir os tipos: {0}', e.message)); break; }
    checked = true;
    errs = c.ok ? {} : tscByScene(c.out, plan.scenes.map((s) => s.name));
    const fix = only.map((sc, i) => (errs[sc.name] && results[i]?.ok ? i : -1)).filter((i) => i >= 0);
    if (!fix.length || round === 2 || tctx.signal.aborted) break;
    for (const i of fix) {
      const sm = tmsg.subs[i];
      sm._msgs?.push({ role: 'user', content: L('O tsc encontrou erros na sua cena. Corrija e chame write_scene de novo com o arquivo inteiro:\n{0}', errs[only[i].name].slice(0, 12).join('\n')) });
      sm.status = 'queued'; sm.fixes = (sm.fixes || 0) + 1;
    }
    tmsg.phase = L('Corrigindo {0} cena(s)...', fix.length); scheduleRender();
    await write(fix);
  }

  // em execução: o que o tsc não vê (interpolate fora de ordem, undefined, arquivo que falta). Até 2 cenas
  // voltam para quem as escreveu; o resto vai no relatório para o modelo da conversa
  let smoke = null;
  if (checked && !Object.keys(errs).length) {
    for (let round = 0; round < 3 && !tctx.signal.aborted; round++) {
      tmsg.phase = L('Testando o vídeo rodando...'); scheduleRender();
      try { smoke = await api('/api/videos/smoke', { id: vid }); } catch (e) { smoke = { ok: false, message: e.message, skipped: true }; break; }
      if (smoke.ok) break;
      const i = only.findIndex((sc) => sc.name === smoke.scene);
      if (i < 0 || round === 2 || !results[i]?.ok) break;
      const sm = tmsg.subs[i];
      sm._msgs?.push({ role: 'user', content: L('Sua cena quebra ao renderizar (quadro {0} do vídeo, {1}): {2}\nCorrija e chame write_scene de novo com o arquivo inteiro.', smoke.frame ?? '?', smoke.at || only[i].name, smoke.message) });
      sm.status = 'queued'; sm.fixes = (sm.fixes || 0) + 1;
      tmsg.phase = L('Corrigindo {0}...', only[i].name); scheduleRender();
      await write([i]);
      // a correção não pode ter quebrado os tipos
      try { const c = await api('/api/videos/check', { id: vid }); errs = c.ok ? {} : tscByScene(c.out, plan.scenes.map((s) => s.name)); } catch { /* segue */ }
      if (Object.keys(errs).length) break;
    }
  }
  tmsg.phase = '';

  // a página Vídeos relista as composições (a "Video" acabou de entrar)
  delete VID.comps[vid]; delete VID.compErr[vid];
  const total = plan.scenes.reduce((n, sc) => n + sceneFrames(sc, plan.fps), 0);
  const rows = only.map((sc, i) => {
    const sm = tmsg.subs[i], r = results[i];
    const e = errs[sc.name];
    const state = !r?.ok ? L('falhou: {0}', String(r?.content || '').slice(0, 160)) : e ? L('{0} erro(s) de tipo', e.length) : sm.fixes ? L('ok (corrigida {0}x)', sm.fixes) : 'ok';
    return `| ${sc.name} | ${sc.seconds}s | ${teamBy(sm)} | ${state} |`;
  });
  const left = Object.entries(errs).flatMap(([, v]) => v).slice(0, 20);
  const content = `# ${L('Cenas do vídeo')}\n\n| ${L('cena')} | ${L('duração')} | ${L('escrita por')} | ${L('estado')} |\n|---|---|---|---|\n${rows.join('\n')}\n\n`
    + L('Sequência: src/scenes/Video.tsx ({0} cenas, {1} frames = {2}s a {3} fps, {4}x{5}).', plan.scenes.length, total, (total / plan.fps).toFixed(1), plan.fps, plan.width, plan.height) + '\n'
    + (lines.length ? lines.join('\n') + '\n' : '')
    + (!checked ? '' : left.length ? '\n' + L('Erros de tipo que sobraram (corrija você com edit_file):') + '\n```\n' + left.join('\n') + '\n```\n' : L('Tipos: ok.') + '\n')
    + (!smoke ? '' : smoke.ok ? L('Teste rodando (um quadro por segundo): ok.') + '\n' : smoke.skipped ? L('Não consegui testar o vídeo rodando: {0}', smoke.message) + '\n'
      : '\n' + L('O vídeo quebra ao rodar, no quadro {0} ({1}): {2}\nCorrija com edit_file e confira com video_check.', smoke.frame ?? '?', smoke.at || smoke.scene || '?', smoke.message) + '\n')
    + '\n' + L('A prévia do Remotion Studio atualiza sozinha (composição "Video"). Para ajustar uma cena, edite o arquivo dela ou chame video_scenes de novo com a lista completa e only com os nomes. Para gerar o MP4, o usuário usa Renderizar na página Vídeos.');
  const failed = only.filter((_, i) => !results[i]?.ok).length;
  return { content, isError: failed === only.length };
}

/* ------------------------------------------------------------ mídia do projeto (public/) */
const WHISPER_LABEL = { base: 'base · 150 MB', small: 'small · 470 MB', medium: 'medium · 1,5 GB', 'large-v3-turbo': 'large-v3-turbo · 1,6 GB' };

function fmtDur(sec) {
  if (sec == null || !isFinite(sec)) return '';
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec - Math.floor(sec / 60) * 60;
  const ss = (s < 10 ? '0' : '') + s.toFixed(1).replace(/\.0$/, '');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function mediaUrl(id, file, dl) {
  const f = String(file).replace(/^public\//, '');
  return `/api/videos/file?id=${encodeURIComponent(id)}&in=public&f=${encodeURIComponent(f)}${dl ? '&dl=1' : ''}`;
}

/** Envia arquivos para public/ (direto para o disco, sem limite de tamanho), com progresso. */
function uploadMedia(p, files) {
  const list = [...files];
  const one = (f) => new Promise((ok, fail) => {
    const x = new XMLHttpRequest();
    x.open('POST', `/api/videos/upload?id=${encodeURIComponent(p.id)}&name=${encodeURIComponent(f.name)}`);
    x.setRequestHeader('X-Studio', '1');
    x.upload.onprogress = (e) => { if (e.lengthComputable) { VID.up = { name: f.name, pct: Math.round(e.loaded / e.total * 100) }; drawUpload(); } };
    x.onload = () => (x.status < 300 ? ok() : fail(new Error((() => { try { return JSON.parse(x.responseText).error; } catch { return 'HTTP ' + x.status; } })())));
    x.onerror = () => fail(new Error(L('Falha ao enviar {0}', f.name)));
    x.send(f);
  });
  (async () => {
    for (const f of list) {
      VID.up = { name: f.name, pct: 0 }; drawUpload();
      try { await one(f); } catch (e) { toast(e.message, 'err'); }
    }
    VID.up = null; delete VID.media[p.id];
    if (S.view === 'videos') drawVideos(true);
  })();
}
function drawUpload() {
  const el = $('#vid-up'); if (!el) return;
  el.hidden = !VID.up;
  if (VID.up) el.innerHTML = '', el.append(h('small.muted', null, L('Enviando {0}... {1}%', VID.up.name, VID.up.pct)), h('div.vid-bar', null, h('i', { style: { width: VID.up.pct + '%' } })));
}

function mediaSection(p) {
  const box = h('div.vid-sec.vid-media');
  const m = VID.media[p.id];
  if (m === undefined && p.ready) {
    VID.media[p.id] = null;
    api('/api/videos/media', { id: p.id }).then((r) => { VID.media[p.id] = r; if (S.view === 'videos' && VID.sel === p.id) drawVideos(true); })
      .catch(() => { VID.media[p.id] = { files: [] }; });
  }
  const input = h('input', { type: 'file', multiple: true, accept: 'video/*,audio/*,image/*', hidden: true, onchange: () => { if (input.files.length) uploadMedia(p, input.files); input.value = ''; } });
  const model = h('select.select.sm', { title: L('Modelo de fala do Whisper') }, (m?.whisperModels || ['base', 'small', 'medium', 'large-v3-turbo']).map((x) => h('option', { value: x }, WHISPER_LABEL[x] + (m?.models?.includes(x) ? ' ✓' : ''))));
  model.value = S.settings.whisperModel || 'small';
  model.addEventListener('change', () => { S.settings.whisperModel = model.value; store.set('settings', S.settings); });
  const lang = h('select.select.sm', { title: L('Idioma da fala') }, [['', L('detectar idioma')], ['pt', 'português'], ['en', 'english'], ['es', 'español']].map(([v, t]) => h('option', { value: v }, t)));
  lang.value = S.settings.whisperLang ?? 'pt';
  lang.addEventListener('change', () => { S.settings.whisperLang = lang.value; store.set('settings', S.settings); });
  const busy = (VID.data?.jobs || []).some((j) => j.kind === 'captions' && !j.done);
  box.append(h('div.vid-sec-head', null, h('h3.sec-title', { title: L('Vídeos, áudios e imagens em public/ para o vídeo usar. O modelo pode olhar os quadros e gerar legendas.') }, L('Mídia')),
    h('span.spacer'), h('button.btn.sm', { type: 'button', disabled: !p.ready, onclick: () => input.click() }, ic('plus'), L('Adicionar')), input));
  box.append(h('div#vid-up', { hidden: !VID.up }));
  setTimeout(drawUpload);
  if (m?.files?.length) {
    box.append(h('div.vid-media-opts', null, h('small.muted', null, L('Legendas:')), model, lang,
      m.whisperInstalled ? null : h('small.muted', null, L('na primeira vez baixa o Whisper e o modelo escolhido'))));
    box.append(h('div.vid-media-list', null, m.files.map((f) => {
      const av = f.kind === 'video' || f.kind === 'audio';
      const thumb = f.kind === 'image' ? h('img', { src: mediaUrl(p.id, f.file), alt: '', loading: 'lazy' })
        : f.kind === 'video' ? h('video', { src: mediaUrl(p.id, f.file) + '#t=1', preload: 'metadata', muted: true })
        : h('span.vm-ico', { html: svg(f.kind === 'audio' ? 'mic' : 'file') });
      const on = VID.watch?.project === p.id && VID.watch.file === f.file;
      return h('div.vid-media-item' + (on ? '.on' : ''), null, h('div.vm-thumb', { title: L('Assistir no palco'), onclick: () => { VID.watch = { project: p.id, file: f.file, from: 'public' }; drawVideos(true); } }, thumb),
        h('div.vm-main', null, h('b', { title: f.file }, f.file.replace(/^public\//, '')),
          h('small.muted', null, [fmtBytes(f.size), f.duration ? fmtDur(f.duration) : ''].filter(Boolean).join(' · '))),
        h('div.vm-acts', null,
        f.captions ? h('a.tag.ok', { href: mediaUrl(p.id, f.captions.replace(/\.json$/, '.srt'), true), title: L('Baixar as legendas (.srt)') }, L('legendas')) : null,
        av ? h('button.btn.sm', { type: 'button', disabled: busy, title: L('Transcrever a fala com o Whisper (no seu PC)'), onclick: async () => {
          try { await api('/api/videos/captions', { id: p.id, file: f.file, model: model.value, lang: lang.value }); await loadVideos(); drawVideos(true); pollVideos(); }
          catch (e) { toast(e.message, 'err'); }
        } }, ic('captions'), f.captions ? L('Refazer legendas') : L('Gerar legendas')) : null));
    })));
  } else if (m) box.append(h('div.muted.small', null, L('Nada em public/ ainda. Adicione gravações, músicas, logos ou fotos que o vídeo deve usar.')));
  return box;
}

/* ------------------------------------------------------------ ferramentas: video_look e video_captions */

/** Junta os quadros numa folha (4 colunas) com o tempo de cada um no canto: uma imagem só para o modelo. */
async function contactSheet(frames, cols = 4) {
  const imgs = await Promise.all(frames.map((f) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = f.data; })));
  const ok = imgs.map((im, k) => im && { im, t: frames[k].t }).filter(Boolean);
  if (!ok.length) return null;
  const w = ok[0].im.naturalWidth, hh = ok[0].im.naturalHeight, gap = 4;
  const rows = Math.ceil(ok.length / cols), c = Math.min(cols, ok.length);
  const cv = document.createElement('canvas');
  cv.width = c * w + (c - 1) * gap; cv.height = rows * hh + (rows - 1) * gap;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
  const fs = Math.max(14, Math.round(w / 14));
  g.font = `600 ${fs}px Inter, system-ui, sans-serif`; g.textBaseline = 'top';
  ok.forEach(({ im, t }, k) => {
    const x = (k % cols) * (w + gap), y = Math.floor(k / cols) * (hh + gap);
    g.drawImage(im, x, y, w, hh);
    const label = `${fmtDur(t)} · ${Math.round(t)}s`, tw = g.measureText(label).width;
    g.fillStyle = 'rgba(0,0,0,.72)'; g.fillRect(x + 6, y + 6, tw + 12, fs + 8);
    g.fillStyle = '#ffd84d'; g.fillText(label, x + 12, y + 10);
  });
  return cv.toDataURL('image/jpeg', 0.82);
}

/** Linhas da legenda (Caption[] do Remotion) agrupadas como no .srt. */
function captionLines(caps) {
  const lines = []; let cur = null;
  for (const c of caps || []) {
    if (!cur || (cur.text + c.text).trim().length > 42 || c.endMs - cur.startMs > 3500) { if (cur) lines.push(cur); cur = { startMs: c.startMs, endMs: c.endMs, text: String(c.text).trimStart() }; }
    else { cur.text += c.text; cur.endMs = c.endMs; }
  }
  if (cur) lines.push(cur);
  return lines;
}

async function videoProjectOf(tctx) {
  const vid = projectOf(tctx.conv)?.video;
  if (!vid) throw new Error(L('Esta ferramenta só funciona numa conversa de projeto de vídeo (abra pela página Vídeos › Conversa do projeto).'));
  return vid;
}

async function runVideoLook(args, tctx, tmsg) {
  let vid;
  try { vid = await videoProjectOf(tctx); } catch (e) { return { content: e.message, isError: true }; }
  let file = String(args.file || '').trim().replace(/^\.?\//, '');
  const count = Math.max(1, Math.min(24, Number(args.count) || 12));
  const from = Math.max(0, Number(args.from) || 0), to = Math.max(0, Number(args.to) || 0);
  let r;
  try { r = await api('/api/videos/frames', { id: vid, file, count, from, to, width: 360 }); }
  catch (e) { return { content: e.message, isError: true }; }
  const sheets = [];
  for (let i = 0; i < r.frames.length; i += 12) sheets.push(await contactSheet(r.frames.slice(i, i + 12)));
  const times = r.frames.map((f) => `${f.t.toFixed(1)}s`);
  const asked = file; file = r.file || file;
  let text = (asked !== file ? L('("{0}" não existe com esse nome; usei {1}.) ', asked, file) : '') + L('{0}: {1} de duração. {2} quadros em {3} folha(s), da esquerda para a direita e de cima para baixo, cada um com o tempo no canto: {4}.', file, r.duration ? `${r.duration.toFixed(1)}s (${fmtDur(r.duration)})` : '?', r.frames.length, sheets.length, times.join(', ')) + ' ' + L('Na lista de edição, use os tempos em segundos (175.5) ou como texto "2:55.5"; nunca 2.55 para dizer 2:55.');
  // a fala do trecho, se o vídeo já tem legenda
  const stem = file.split('/').pop().replace(/\.[^.]+$/, '');
  try {
    const res = await fetch(mediaUrl(vid, `captions/${stem}.json`));
    if (res.ok) {
      const end = to || r.duration || 1e9;
      const lines = captionLines(await res.json()).filter((l) => l.endMs / 1000 >= from && l.startMs / 1000 <= end).slice(0, 80);
      if (lines.length) text += '\n\n' + L('Fala nesse trecho (da legenda):') + '\n' + lines.map((l) => `[${(l.startMs / 1000).toFixed(1)}s] ${l.text.trim()}`).join('\n');
    }
  } catch { /* sem legenda */ }
  const imgs = sheets.filter(Boolean);
  if (visionOn()) return { content: text, isError: false, images: imgs };
  // o modelo da conversa não enxerga: uma API da equipe (ou outra pronta) que enxergue descreve os quadros
  const seer = [...apiForAll('explorer'), ...(S.info.apis || []).filter((a) => a.ready).map((a) => a.id)].map(apiById).find((a) => a?.vision && !apiCooled(a.id));
  if (!seer) return { content: text + '\n\n' + L('O modelo desta conversa não recebe imagens, e nenhuma API marcada como "Aceita imagens" está disponível para descrever os quadros. Os tempos e a fala acima ainda servem para planejar os cortes.'), isError: false };
  tmsg.phase = L('{0} está descrevendo os quadros...', apiLabel(seer)); scheduleRender();
  const m = { content: '', reasoning: '', tool_calls: [] };
  try {
    await streamApi([{ role: 'user', content: [{ type: 'text', text: L('Descreva o que aparece em cada quadro destas folhas, um por linha começando pelo tempo escrito no canto do quadro. Diga pessoas, textos na tela, ambiente, cortes de cena, telas pretas ou borradas. Seja objetivo.') }, ...imgs.map((url) => ({ type: 'image_url', image_url: { url } }))] }], [], m, tctx.signal, null, { _p: seer.id, _timeout: 120000 });
  } catch (e) { tmsg.phase = ''; return { content: text + '\n\n' + L('Não consegui a descrição dos quadros ({0}).', e.message), isError: false }; }
  tmsg.phase = '';
  tmsg._images = imgs;
  return { content: text + '\n\n' + L('O que aparece (descrito por {0}):', `${apiLabel(seer)} · ${seer.model}`) + '\n' + splitThink(m.content).text.trim(), isError: false };
}

async function runVideoCaptions(args, tctx, tmsg) {
  let vid;
  try { vid = await videoProjectOf(tctx); } catch (e) { return { content: e.message, isError: true }; }
  const file = String(args.file || '').trim().replace(/^\.?\//, '');
  const model = String(args.model || S.settings.whisperModel || 'small');
  const lang = String(args.language ?? S.settings.whisperLang ?? 'pt');
  let start;
  try { start = await api('/api/videos/captions', { id: vid, file, model, lang }); } catch (e) { return { content: e.message, isError: true }; }
  let j;
  for (;;) {
    if (tctx.signal.aborted) return { content: L('Cancelado. As legendas continuam sendo geradas na página Vídeos.'), isError: true };
    await new Promise((r) => setTimeout(r, 1500));
    try { j = await api('/api/videos/job?id=' + encodeURIComponent(start.job)); } catch { continue; }
    const pct = Math.round((j.progress || 0) * 100);
    const stage = (j.progress || 0) < 0.1 ? L('instalando o Whisper') : j.progress < 0.4 ? L('baixando o modelo {0}', model) : L('transcrevendo');
    tmsg.phase = `${stage} · ${pct}%`; scheduleRender();
    if (j.done || j.missing) break;
  }
  tmsg.phase = '';
  if (!j.ok) return { content: j.err || L('As legendas falharam:\n{0}', String(j.log || '').split('\n').slice(-12).join('\n')), isError: true };
  delete VID.media[vid];
  const srtPath = start.out.replace(/\.json$/, '.srt');
  let preview = '';
  try { const res = await fetch(mediaUrl(vid, srtPath.replace(/^public\//, ''))); if (res.ok) preview = (await res.text()).split('\n\n').slice(0, 25).join('\n\n'); } catch { /* sem prévia */ }
  return {
    content: L('Legendas prontas: {0} (palavras com startMs/endMs, formato Caption do @remotion/captions) e {1}.', start.out, srtPath) + '\n\n'
      + L('Para usar numa cena: carregue com fetch(staticFile("{0}")) dentro de delayRender/continueRender (ou useDelayRender) e mostre o trecho em que startMs <= tempo atual < endMs; para legendas no estilo TikTok, createTikTokStyleCaptions de "@remotion/captions" agrupa as palavras em páginas.', start.out.replace(/^public\//, '')) + '\n\n'
      + (preview ? L('Começo do .srt:') + '\n```\n' + preview + '\n```' : ''),
    isError: false,
  };
}

/** video_check: tipos (tsc) e o teste rodando, para o modelo conferir depois de editar à mão. */
async function runVideoCheck(args, tctx, tmsg) {
  let vid;
  try { vid = await videoProjectOf(tctx); } catch (e) { return { content: e.message, isError: true }; }
  tmsg.phase = L('Conferindo os tipos...'); scheduleRender();
  let c;
  try { c = await api('/api/videos/check', { id: vid }); } catch (e) { tmsg.phase = ''; return { content: L('Não consegui conferir os tipos: {0}', e.message), isError: true }; }
  if (!c.ok) {
    tmsg.phase = '';
    const lines = String(c.out).split(/\r?\n/).filter((l) => /error TS\d+/.test(l)).slice(0, 25);
    return { content: L('Erros de tipo (corrija antes do teste rodando):') + '\n```\n' + (lines.join('\n') || String(c.out).slice(0, 3000)) + '\n```', isError: true };
  }
  tmsg.phase = L('Testando o vídeo rodando...'); scheduleRender();
  let r;
  try { r = await api('/api/videos/smoke', { id: vid, comp: String(args.composition || 'Video') }); } catch (e) { tmsg.phase = ''; return { content: L('Tipos: ok. Não consegui testar o vídeo rodando: {0}', e.message), isError: true }; }
  tmsg.phase = '';
  delete VID.comps[vid];
  if (r.ok) return { content: L('Tipos: ok. Teste rodando (um quadro por segundo): ok.'), isError: false };
  return { content: L('Tipos: ok. O vídeo quebra ao rodar, no quadro {0} ({1}): {2}', r.frame ?? '?', r.at || r.scene || '?', r.message), isError: true };
}

/* ------------------------------------------------------------ edição de vídeos de verdade (video_edit, video_find) */

/** video_edit: o studio confere e grava a lista de edição, registra a composição e testa. */
async function runVideoEdit(args, tctx, tmsg) {
  let vid;
  try { vid = await videoProjectOf(tctx); } catch (e) { return { content: e.message, isError: true }; }
  const name = String(args.name || '').trim();
  let edl = args.edl;
  if (typeof edl === 'string') { try { edl = JSON.parse(edl); } catch { return { content: L('edl precisa ser um objeto JSON.'), isError: true }; } }
  tmsg.phase = L('Conferindo a lista de edição...'); scheduleRender();
  let r;
  try { r = await api('/api/videos/edit', { id: vid, name, edl: edl || {} }); } catch (e) { tmsg.phase = ''; return { content: e.message, isError: true }; }
  if (!r.ok) { tmsg.phase = ''; return { content: L('A lista de edição tem problemas; corrija e chame de novo:') + '\n' + r.errors.map((x) => '- ' + x).join('\n'), isError: true }; }
  tmsg.edit = { name, seconds: r.seconds, clips: r.clips, width: r.width, height: r.height, cut: r.silenceCut };
  delete VID.comps[vid]; delete VID.compErr[vid];
  // tipos e o teste rodando, na composição nova
  tmsg.phase = L('Conferindo os tipos...'); scheduleRender();
  let check = '';
  try {
    const c = await api('/api/videos/check', { id: vid });
    if (!c.ok) check = L('Erros de tipo:') + '\n```\n' + String(c.out).split(/\r?\n/).filter((l) => /error TS\d+/.test(l)).slice(0, 15).join('\n') + '\n```';
    else {
      tmsg.phase = L('Testando o vídeo rodando...'); scheduleRender();
      const s = await api('/api/videos/smoke', { id: vid, comp: name });
      check = s.ok ? L('Teste rodando (um quadro por segundo): ok.') : L('O vídeo quebra ao rodar, no quadro {0} ({1}): {2}', s.frame ?? '?', s.at || '?', s.message);
    }
  } catch (e) { check = L('Não consegui testar o vídeo rodando: {0}', e.message); }
  tmsg.phase = '';
  const cut = r.silenceCut > 0.05 ? ' ' + L('Pausas cortadas: {0}s.', r.silenceCut.toFixed(1)) : '';
  const short = r.seconds < 12 ? '\n\n' + L('⚠ O vídeo ficou com só {0}s. Confira se from/to cobrem o momento inteiro (os tempos são do arquivo original; um corte de live costuma ter de 40 a 120 s). Se o pedido tinha uma duração, refaça com o trecho certo.', r.seconds.toFixed(1)) : '';
  return {
    content: L('Composição "{0}": {1}x{2}, {3} trecho(s), {4} no total.{5}', name, r.width, r.height, r.clips, fmtDur(r.seconds), cut) + '\n'
      + L('Lista gravada em {0} (dá para ajustar tempos ali com edit_file; o modelo de montagem é src/edit/EditVideo.tsx, não edite). A prévia do Remotion Studio mostra "{1}", e o usuário renderiza na página Vídeos; o MP4 sai em out/{1}-<data>.mp4 (para olhar, video_look com file "out/{1}" acha o mais recente).', r.file, name) + short + '\n\n' + check,
    isError: /quebra|Erros de tipo/.test(check),
  };
}

/** video_find: frase por frase com o tempo de cada uma (e busca por palavras), pela legenda. */
async function runVideoFind(args, tctx) {
  let vid;
  try { vid = await videoProjectOf(tctx); } catch (e) { return { content: e.message, isError: true }; }
  const query = String(args.query || '').trim();
  let r;
  try { r = await api('/api/videos/speech', { id: vid, file: String(args.file || ''), gap: Number(args.gap) || 0, from: Number(args.from) || 0, to: Number(args.to) || 0, query }); }
  catch (e) { return { content: e.message, isError: true }; }
  const line = (s) => `[${s.from.toFixed(1)}–${s.to.toFixed(1)}s | ${fmtDur(s.from)}] ${s.text}`;
  // cabe no contexto: o começo da lista e o aviso de como ver o resto
  let body = '', shown = 0;
  for (const s of r.segments) { const l = line(s) + '\n'; if (body.length + l.length > 14000) break; body += l; shown++; }
  const more = shown < r.segments.length ? '\n' + L('… mais {0} falas. Use from/to (ex.: a partir de {1}) ou query para ver o resto.', r.segments.length - shown, Math.floor(r.segments[shown].from)) : '';
  const sil = r.silences.filter((s) => s.to - s.from >= 1).slice(0, 60).map((s) => `${s.from.toFixed(1)}–${s.to.toFixed(1)}s`);
  const head = query
    ? L('public/{0}: {1} de {2} falas com "{3}".', r.file, r.segments.length, r.total, query)
    : L('public/{0}: {1} falas, frase por frase (tempos em segundos do arquivo | m:ss).', r.file, r.total);
  return {
    content: head + '\n\n' + (r.segments.length ? body + more : L('Nada encontrado. Tente outras palavras (sem acento também vale) ou veja a lista inteira sem query.'))
      + (!query && sil.length ? '\n\n' + L('Pausas de 1 s ou mais:') + ' ' + sil.join(', ') : '')
      + '\n\n' + L('Para um corte, o trecho começa alguns segundos antes da fala que dá contexto e termina logo depois da reação.'),
    isError: false,
  };
}
