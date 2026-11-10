/* llama studio - Vídeos: app opcional com o Remotion (vídeos feitos em React, escritos pelo agente) */
'use strict';

/* ------------------------------------------------------------ estado e ativação */
const VID = { data: null, sel: store.get('vidSel', null), comps: {}, compErr: {}, poll: 0, busy: false };
const VIDEO_SKILL = 'remotion-best-practices';
const VIDEO_NOTE = L('Este projeto é um vídeo do Remotion (React). As composições ficam em src/ (Root.tsx registra cada uma). Siga a habilidade remotion-best-practices. Para um vídeo novo ou com várias cenas, use a ferramenta video_scenes: você escreve o roteiro (estilo comum e cenas com duração e descrição detalhada) e a equipe escreve as cenas em paralelo; depois revise e ajuste com edit_file. Depois de editar, não precisa rodar nada: a prévia do Remotion Studio no studio atualiza sozinha. Para conferir erros de tipo, rode npx tsc --noEmit.');

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
    // redesenha só quando algo mudou (o iframe da prévia não pisca)
    if (JSON.stringify(VID.data?.jobs || []) !== before) drawVideos(true);
    pollVideos();
  }, busy ? 1200 : 6000);
}

function vidProject(id) { return (VID.data?.projects || []).find((p) => p.id === id); }

function drawVideos(keepPreview) {
  const box = $('#vid-body');
  const d = VID.data || {};
  const oldFrame = keepPreview ? $('#vid-frame') : null;
  box.innerHTML = '';
  if (d.error) box.append(h('div.vid-warn', null, ic('alert'), d.error));
  if (!d.node) box.append(h('div.vid-warn', null, ic('alert'), h('span', null, L('O Node.js não foi encontrado neste PC. O Remotion precisa do Node 18 ou mais novo (nodejs.org) e do Git para criar projetos. Depois de instalar, reabra o studio.'))));
  if (!d.skills?.length) box.append(h('div.vid-warn', null, ic('sparkles'), h('span', null, L('As habilidades do Remotion não estão instaladas: sem elas o modelo escreve vídeos piores.')),
    h('button.btn.sm', { onclick: async (e) => { e.target.disabled = true; try { const r = await api('/api/videos/skills', {}); toast(L('{0} habilidades do Remotion instaladas', r.installed)); loadSkills().catch(() => {}); await loadVideos(); drawVideos(); } catch (er) { toast(er.message, 'err'); e.target.disabled = false; } } }, L('Instalar'))));

  // coluna dos projetos
  const name = h('input.input', { placeholder: L('Nome do vídeo (ex.: abertura do canal)'), maxlength: 60 });
  const create = h('button.btn.primary', { type: 'button', disabled: !d.node, onclick: async () => {
    if (!name.value.trim()) { name.focus(); return; }
    create.disabled = true;
    try { const r = await api('/api/videos/create', { name: name.value.trim() }); VID.sel = r.id; store.set('vidSel', r.id); toast(L('Criando "{0}"... (baixa o modelo e instala as dependências, alguns minutos na primeira vez)', r.id)); await loadVideos(); drawVideos(); pollVideos(); }
    catch (e) { toast(e.message, 'err'); create.disabled = false; }
  } }, ic('plus'), L('Criar'));
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') create.click(); });
  const creating = (d.jobs || []).filter((j) => j.kind === 'create' && !j.done);
  const list = h('div.vid-list', null,
    h('div.vid-new', null, name, create),
    ...creating.map((j) => h('div.vid-item.busy', null, h('span', { html: svg('loader', 'spin') }), h('div.vi-main', null, h('b', null, j.project), h('small.muted', null, L('criando...'))))),
    ...(d.projects || []).map((p) => h('button.vid-item' + (VID.sel === p.id ? '.on' : ''), { onclick: () => { VID.sel = p.id; store.set('vidSel', p.id); drawVideos(); } },
      h('span', { html: svg('film') }),
      h('div.vi-main', null, h('b', null, p.id), h('small.muted', null, !p.ready ? L('sem dependências') : p.renders.length ? L('{0} vídeo(s) renderizado(s)', p.renders.length) : L('nenhum vídeo ainda'))),
      d.studio?.project === p.id ? h('span.tag.ok', null, L('prévia')) : null)),
    !(d.projects || []).length && !creating.length ? h('div.muted.small', null, L('Nenhum projeto ainda. Dê um nome e clique em Criar.')) : null);

  // projeto escolhido
  const p = vidProject(VID.sel) || (d.projects || [])[0];
  if (p && VID.sel !== p.id) { VID.sel = p.id; }
  const main = h('div.vid-main');
  const failed = (d.jobs || []).filter((j) => j.kind === 'create' && j.done && !j.ok);
  for (const j of failed) main.append(h('div.vid-warn', null, ic('alert'), h('div', null, h('b', null, L('Não consegui criar "{0}"', j.project)), h('pre.vid-log', null, j.tail))));
  if (p) main.append(projectPanel(p, d, oldFrame));
  else if (!failed.length) main.append(h('div.vid-empty', null, ic('film'), h('p', null, L('Crie um projeto à esquerda. O studio monta um projeto do Remotion em branco; depois, numa conversa ligada a ele, você pede o vídeo e o modelo escreve as cenas em React, com a prévia ao lado.'))));
  box.append(h('div.vid-layout', null, list, main));
}

function projectPanel(p, d, oldFrame) {
  const live = d.studio?.project === p.id;
  const jobs = (d.jobs || []).filter((j) => j.project === p.id && j.kind === 'render');
  const rendering = jobs.find((j) => !j.done);
  // composições: o CLI do Remotion lista (demora uns segundos na primeira vez)
  const comps = VID.comps[p.id];
  const sel = h('select.select', { disabled: !comps?.length }, (comps || []).map((c) => h('option', { value: c }, c)));
  if (comps?.includes('Video')) sel.value = 'Video';
  if (!comps && p.ready) {
    VID.comps[p.id] = null;
    api('/api/videos/compositions?id=' + encodeURIComponent(p.id)).then((r) => { VID.comps[p.id] = r.compositions; if (S.view === 'videos' && VID.sel === p.id) drawVideos(true); })
      .catch((e) => { VID.comps[p.id] = []; VID.compErr[p.id] = e.message; if (S.view === 'videos' && VID.sel === p.id) drawVideos(true); });
  }
  const preview = h('button.btn' + (live ? '' : '.primary'), { type: 'button', disabled: !p.ready || VID.busy, onclick: async () => {
    VID.busy = true; preview.disabled = true;
    try {
      if (live) await api('/api/videos/studio', { action: 'stop' });
      else { toast(L('Abrindo o Remotion Studio... (a primeira vez empacota o projeto)')); await api('/api/videos/studio', { id: p.id }); }
      await loadVideos();
    } catch (e) { toast(e.message, 'err'); }
    VID.busy = false; drawVideos();
  } }, ic(live ? 'stop' : 'play'), live ? L('Fechar prévia') : L('Abrir prévia'));
  const render = h('button.btn', { type: 'button', disabled: !p.ready || !comps?.length || !!rendering, onclick: async () => {
    try { await api('/api/videos/render', { id: p.id, comp: sel.value }); await loadVideos(); drawVideos(true); pollVideos(); } catch (e) { toast(e.message, 'err'); }
  } }, ic('download'), L('Renderizar MP4'));
  const chat = h('button.btn', { type: 'button', onclick: () => videoChat(p) }, ic('chat'), L('Conversa do projeto'));
  const del = h('button.icon-btn', { type: 'button', title: L('Apagar projeto'), 'aria-label': L('Apagar projeto'), html: svg('trash'), onclick: async () => {
    if (!(await confirmBox(L('Apagar o projeto "{0}" e os vídeos dele? Não dá para desfazer.', p.id), L('Apagar'), true))) return;
    try { await api('/api/videos/delete', { id: p.id }); VID.sel = null; await loadVideos(); drawVideos(); } catch (e) { toast(e.message, 'err'); }
  } });
  const panel = h('div.vid-panel', null,
    h('div.vid-head', null, h('div', null, h('h2', null, p.id), h('code.muted.small', null, p.path)), h('span.spacer'), del),
    h('div.vid-actions', null, chat, preview, h('span.vid-render', null, sel, render)));
  if (VID.compErr[p.id]) panel.append(h('div.vid-warn', null, ic('alert'), h('span', null, L('Não consegui listar as composições: {0}', VID.compErr[p.id])),
    h('button.btn.sm', { onclick: () => { delete VID.comps[p.id]; delete VID.compErr[p.id]; drawVideos(true); } }, L('Tentar de novo'))));
  if (!p.ready) panel.append(h('div.vid-warn', null, ic('alert'), L('As dependências deste projeto não estão instaladas. Rode "npm install" na pasta dele (pela conversa do projeto, por exemplo).')));
  // prévia ao vivo: o Remotion Studio do projeto, embutido
  if (live) {
    const src = `http://127.0.0.1:${d.studio.port}/`;
    const frame = oldFrame && oldFrame.dataset.src === src ? oldFrame : h('iframe#vid-frame', { src, dataset: { src }, allow: 'autoplay; fullscreen; clipboard-write', title: L('Prévia do Remotion Studio') });
    panel.append(h('div.vid-preview', null, frame,
      h('div.vid-preview-foot', null, h('small.muted', null, L('Remotion Studio na porta {0}. Atualiza sozinho quando o agente edita os arquivos.', d.studio.port)),
        h('a.small', { href: src, target: '_blank', rel: 'noopener' }, ic('external'), L('Abrir no navegador')))));
  }
  for (const j of jobs) {
    const pct = Math.round((j.progress || 0) * 100);
    panel.append(h('div.vid-job' + (j.done ? (j.ok ? '.ok' : '.err') : ''), null,
      h('div.vid-job-head', null, h('b', null, j.done ? (j.ok ? L('Renderizado: {0}', j.out) : L('O render falhou')) : L('Renderizando {0}... {1}%', j.out, pct))),
      j.done ? null : h('div.vid-bar', null, h('i', { style: { width: pct + '%' } })),
      !j.done || !j.ok ? h('pre.vid-log', null, j.tail) : null));
  }
  if (p.renders.length) {
    panel.append(h('h3.sec-title', null, L('Vídeos')));
    panel.append(h('div.vid-renders', null, p.renders.slice(0, 12).map((r) => {
      const url = `/api/videos/file?id=${encodeURIComponent(p.id)}&f=${encodeURIComponent(r.file)}`;
      const media = /\.(png|gif)$/i.test(r.file) ? h('img', { src: url, alt: r.file }) : h('video', { src: url, controls: true, preload: 'metadata' });
      return h('div.vid-render-item', null, media, h('div.vr-meta', null, h('b', null, r.file), h('small.muted', null, `${fmtBytes(r.size)} · ${new Date(r.mtime * 1000).toLocaleString(LOCALE)}`),
        h('a.small', { href: url, download: r.file }, ic('download'), L('Baixar'))));
    })));
  }
  return panel;
}

/** Conversa ligada ao projeto: um projeto do studio com a pasta do vídeo, a habilidade do Remotion e a nota. */
function videoChat(p) {
  let proj = S.projects.find((x) => x.dir && x.dir.replace(/[\\/]+$/, '').toLowerCase() === String(p.path).replace(/[\\/]+$/, '').toLowerCase());
  if (!proj) {
    proj = { id: uid(), name: L('Vídeo: {0}', p.id), dir: p.path, instructions: VIDEO_NOTE, personaId: null, createdAt: Date.now(), open: true, video: p.id };
    S.projects.push(proj); saveProjects();
  }
  if (proj.video !== p.id) { proj.video = p.id; saveProjects(); }
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
      + L('- Importe só de "react" e "remotion". Imagens e sons só de public/ com staticFile(); se não houver, desenhe com formas, gradientes e texto.') + '\n'
      + L('- Estilos inline (objetos style). Fonte: as do sistema (ex.: "Inter, system-ui, sans-serif") ou a que o estilo pedir, se for do sistema.') + '\n'
      + L('- Termine a cena de um jeito que emende na próxima (a descrição diz como).') + '\n\n'
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
    + '\n' + L('A prévia do Remotion Studio atualiza sozinha (composição "Video"). Para ajustar uma cena, edite o arquivo dela ou chame video_scenes de novo com a lista completa e only com os nomes. Para gerar o MP4, o usuário usa Renderizar na página Vídeos.');
  const failed = only.filter((_, i) => !results[i]?.ok).length;
  return { content, isError: failed === only.length };
}
