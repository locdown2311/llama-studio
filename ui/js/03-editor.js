/* llama studio - caixa de texto com etiquetas (@, arquivos, imagens) */
'use strict';

/* ============================================================ editor com etiquetas */
const editor = () => $('#input');
let savedRange = null;

function focusEditor(toEnd) {
  const ed = editor();
  ed.focus();
  if (toEnd || !savedRange) {
    const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); savedRange = r.cloneRange();
  }
}

function saveRange() {
  const s = getSelection();
  if (s.rangeCount && editor().contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange();
}

function setEditorText(text) { editor().textContent = text; focusEditor(true); }

function makePill(p) {
  const kind = p.kind;
  const label = kind === 'skill' ? 'Habilidade' : kind === 'mcp' ? 'Conector' : 'Arquivo';
  const el = h('span.pill.pill-' + kind, { contenteditable: 'false', dataset: { kind, id: p.id || '', name: p.name || '' } }, h('span.k', null, label + ':'), h('span.v', null, p.name || ''));
  if (kind === 'file') {
    el.dataset.ref = p.ref;
    el.addEventListener('click', () => { const r = S.refs.find((x) => x.id === p.ref); if (r) refAction(r); });
  }
  return el;
}

/** Ponto de inserção no texto a partir de coordenadas, sempre fora das etiquetas. */
function rangeAtPoint(x, y) {
  if (!document.caretRangeFromPoint) return null;
  const r = document.caretRangeFromPoint(x, y);
  if (!r || !editor().contains(r.startContainer)) return null;
  return outsidePill(r);
}
function outsidePill(r) {
  const n = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
  const pill = n?.closest?.('.pill');
  if (pill && editor().contains(pill)) { r.setStartAfter(pill); r.collapse(true); }
  return r;
}

function insertNodeAtCaret(node) {
  const ed = editor();
  let r = savedRange;
  if (!r || !ed.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); }
  outsidePill(r);
  r.deleteContents();
  const space = document.createTextNode(' ');
  r.insertNode(space);
  r.insertNode(node);
  r.setStartAfter(space); r.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  savedRange = r.cloneRange();
  ed.focus();
}

function insertPill(p) { insertNodeAtCaret(makePill(p)); updatePickers(); }

function editorPills() {
  return $$('.pill', editor()).map((el) => ({ kind: el.dataset.kind, id: el.dataset.id, name: el.dataset.name, ref: el.dataset.ref }));
}

function readEditor() {
  const parts = [];
  const push = (t) => { if (!t) return; const last = parts[parts.length - 1]; if (last?.t === 'text') last.v += t; else parts.push({ t: 'text', v: t }); };
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) push(n.textContent.replace(/ /g, ' '));
      else if (n.nodeName === 'BR') push('\n');
      else if (n.classList?.contains('pill')) {
        const kind = n.dataset.kind;
        if (kind === 'file') {
          const r = S.refs.find((x) => x.id === n.dataset.ref);
          if (r && r.path && r.status !== 'missing') parts.push({ t: 'pill', kind, name: r.name || basename(r.path), path: r.path, dir: !!r.dir });
        } else parts.push({ t: 'pill', kind, id: n.dataset.id, name: n.dataset.name });
      } else if (n.nodeName === 'DIV' || n.nodeName === 'P') { if (parts.length) push('\n'); walk(n); }
      else walk(n);
    }
  };
  walk(editor());
  // apara espaços nas pontas
  if (parts[0]?.t === 'text') parts[0].v = parts[0].v.replace(/^\s+/, '');
  const lastP = parts[parts.length - 1];
  if (lastP?.t === 'text') lastP.v = lastP.v.replace(/\s+$/, '');
  return parts.filter((p) => p.t !== 'text' || p.v);
}

function partsToContent(parts) {
  return parts.map((p) => {
    if (p.t === 'text') return p.v;
    if (p.kind === 'skill') return `Habilidade:${p.name}`;
    if (p.kind === 'mcp') return `Conector:${p.name}`;
    return `"${p.path}"`;
  }).join('');
}

function loadEditorParts(parts) {
  const ed = editor(); ed.innerHTML = ''; S.refs = [];
  for (const p of parts) {
    if (p.t === 'text') ed.append(document.createTextNode(p.v));
    else if (p.kind === 'file') {
      const r = { id: uid(), name: p.name, path: p.path, dir: p.dir, status: 'ok' };
      S.refs.push(r);
      ed.append(makePill({ kind: 'file', name: p.name, ref: r.id }), document.createTextNode(' '));
    } else ed.append(makePill(p), document.createTextNode(' '));
  }
}

/* ------------------------------------------------------------ menção com @ */
let mention = null; // { items, index, node, start }

function mentionItems(q) {
  q = q.toLowerCase();
  const items = [];
  for (const s of S.skills) if (!q || s.name.toLowerCase().includes(q) || s.id.includes(q)) items.push({ kind: 'skill', id: s.id, name: s.name, desc: s.description });
  for (const s of S.mcp) if (!q || s.name.toLowerCase().includes(q)) items.push({ kind: 'mcp', id: s.name, name: s.name, desc: s.status === 'connected' ? `${s.tools.length} ferramentas` : statusInfo(s.status).label });
  for (const it of S.ws.cache.get('') || []) if (q && it.name.toLowerCase().includes(q)) items.push({ kind: 'file', name: it.name, path: it.path, dir: it.dir, desc: it.dir ? 'pasta do espaço de trabalho' : fmtSize(it.size) });
  return items.slice(0, 12);
}

function checkMention() {
  const s = getSelection();
  if (!s.rangeCount || !s.isCollapsed) return closeMention();
  const node = s.anchorNode;
  if (node?.nodeType !== 3 || !editor().contains(node)) return closeMention();
  const before = node.textContent.slice(0, s.anchorOffset);
  const m = before.match(/(?:^|[\s ])@([^\s@ ]{0,40})$/);
  if (!m) return closeMention();
  const items = mentionItems(m[1]);
  mention = { items, index: 0, node, start: s.anchorOffset - m[1].length - 1, end: s.anchorOffset };
  drawMention();
}

function drawMention() {
  const pop = $('#pop-mention');
  pop.innerHTML = '';
  pop.classList.add('open');
  if (!mention.items.length) { pop.append(h('div.pop-empty', null, 'Nada encontrado. Crie habilidades e conectores no menu à esquerda.')); return; }
  pop.append(h('div.pop-head', null, h('span', null, 'Inserir na mensagem')));
  mention.items.forEach((it, i) => {
    const kindLbl = { skill: 'habilidade', mcp: 'conector', file: 'arquivo' }[it.kind];
    pop.append(h('button.menu-item' + (i === mention.index ? '.hl' : ''), { onmousedown: (e) => { e.preventDefault(); chooseMention(i); } },
      ic(it.kind === 'skill' ? 'sparkles' : it.kind === 'mcp' ? 'plug' : it.dir ? 'folder' : ftype(it.name).icon),
      h('span.mi-main', null, h('b', null, it.name), it.desc ? h('span.mi-sub', null, it.desc) : null),
      h('span.kind.' + it.kind, null, kindLbl)));
  });
}

function closeMention() { mention = null; $('#pop-mention').classList.remove('open'); }

function chooseMention(i) {
  const it = mention?.items[i];
  if (!it) return;
  const { node, start, end } = mention;
  const r = document.createRange();
  r.setStart(node, Math.max(0, start)); r.setEnd(node, end);
  r.deleteContents();
  savedRange = r;
  closeMention();
  if (it.kind === 'file') {
    const ref = { id: uid(), name: it.name, path: it.path, dir: it.dir, status: 'ok' };
    S.refs.push(ref);
    insertPill({ kind: 'file', name: it.name, ref: ref.id });
  } else insertPill({ kind: it.kind, id: it.id, name: it.name });
}

/* ------------------------------------------------------------ barra inferior */
function closePops() { $$('.popover').forEach((p) => p.classList.remove('open')); }
function togglePop(id, fill) {
  const pop = $(id);
  const wasOpen = pop.classList.contains('open');
  closePops();
  if (wasOpen) return;
  fill();
  pop.classList.add('open');
}
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.pick-wrap') && !e.target.closest('#pop-mention')) closePops();
});

function renderComposer() {
  updateSendBtn();
  drawTodos();
  drawQueue();
  updatePickers();
  drawCtxMeter();
}

function updateSendBtn() {
  const send = $('#send');
  const busy = running(cur());
  // respondendo + texto na caixa: o botão enfileira (Esc continua parando)
  const queueMode = busy && !editorEmpty();
  send.innerHTML = svg(queueMode ? 'list' : busy ? 'stop' : 'send');
  send.classList.toggle('stop', busy && !queueMode);
  sendRing();
  send.classList.toggle('queue', queueMode);
  send.title = queueMode ? 'Pôr na fila (Enter) · Esc para parar a resposta' : busy ? 'Parar (Esc)' : 'Enviar (Enter)';
  send.setAttribute('aria-label', send.title);
}

function activeSel(conv) {
  const skills = new Set(S.sel.skills); const mcpS = new Set(S.sel.mcp);
  for (const m of conv?.messages || []) for (const p of m.parts || []) {
    if (p.kind === 'skill') skills.add(p.id);
    if (p.kind === 'mcp') mcpS.add(p.id);
  }
  return {
    skills: [...skills].filter((id) => S.skills.some((s) => s.id === id)),
    mcp: [...mcpS].filter((n) => S.mcp.some((s) => s.name === n)),
  };
}

function updatePickers() {
  const c = cur();
  const act = activeSel(c);
  const pills = editorPills();
  const nSk = new Set([...act.skills, ...pills.filter((p) => p.kind === 'skill').map((p) => p.id)]).size;
  const nMcp = new Set([...act.mcp, ...pills.filter((p) => p.kind === 'mcp').map((p) => p.id)]).size;

  const pm = $('#pick-model'); pm.innerHTML = '';
  const want = convModel(c);
  const pending = want && S.models.active && want.id !== S.models.active;
  const dot = pending ? 'idle' : ({ ok: 'ok', loading: 'busy', offline: 'err' }[S.health.status] || '');
  const label = want ? want.name : S.model ? shortModel(S.model) : (S.health.status === 'loading' ? 'carregando...' : 'llama-server');
  pm.append(h('span.dot.' + dot), h('b', null, label.replace(/[-_.](I?Q\d[\w]*|BF16|F16|F32)$/i, '')), h('span', { html: svg('chev', 'caret'), style: { display: 'contents' } }));
  pm.title = pending ? `${want.name}: será carregado no lugar de ${modelById(S.models.active)?.name || 'o atual'} quando você enviar` : (want?.model || S.model || S.info.llamaUrl || '');
  pm.querySelector('.caret').style.transform = 'rotate(90deg)';

  // só ícone; o nome aparece na dica e no menu ao clicar
  const iconBtn = (el, icon, title, on, badge, color) => {
    el.innerHTML = ''; el.classList.add('icon-only'); el.classList.toggle('on', !!on);
    el.style.setProperty('--on', color || '');
    el.append(icon);
    if (badge) el.append(h('span.badge', null, String(badge)));
    el.title = title; el.setAttribute('aria-label', title);
  };
  const pers = personaOf(c);
  iconBtn($('#pick-persona'), pers ? h('span.p-ava', { style: { background: pers.color } }, (pers.name[0] || '?').toUpperCase()) : ic('user'),
    pers ? `Personalidade: ${pers.name}` : 'Personalidade: nenhuma', !!pers, 0, pers?.color);
  const tk = thinkOf(c);
  iconBtn($('#pick-think'), ic(tk === 'off' ? ('zap' in ICONS ? 'zap' : 'send') : 'brain'), `Raciocínio: ${THINK_OPTS.find((o) => o[0] === tk)[1]}`, tk !== 'auto', 0, tk === 'off' ? '#d99a1e' : 'var(--accent)');
  const al = autoLevelOf(c);
  iconBtn($('#pick-auto'), ic(al === 'desligado' ? 'ban' : 'signpost'), `Recursos automáticos: ${AUTO_LEVELS.find((o) => o[0] === al)[1]}`, al !== 'equilibrado', 0, al === 'desligado' ? 'var(--muted)' : al === 'liberal' ? '#d99a1e' : 'var(--accent)');
  const pl = planOf(c);
  iconBtn($('#pick-plan'), ic('list'), pl ? 'Modo plano: ligado (o modelo só investiga e propõe)' : 'Modo plano: desligado', pl, 0, '#0e9f8a');
  const skNames = act.skills.map((id) => S.skills.find((k) => k.id === id)?.name || id);
  iconBtn($('#pick-skills'), ic('sparkles'), nSk ? `Habilidades: ${skNames.join(', ') || nSk}` : 'Habilidades: nenhuma', nSk > 0, nSk, 'var(--skill)');
  iconBtn($('#pick-mcp'), ic('plug'), nMcp ? `Conectores: ${act.mcp.join(', ') || nMcp}` : 'Conectores: nenhum', nMcp > 0, nMcp, 'var(--mcp)');
  const proj = projectOf(c);
  iconBtn($('#pick-ws'), ic('folder'), proj ? `Projeto: ${proj.name}\n${S.ws.path}` : `Espaço de trabalho: ${S.ws.path || '...'}`, !!proj, 0, '#b07a14');
}

function checkRow({ checked, title, desc, extra, disabled, onchange }) {
  const input = h('input', { type: 'checkbox', checked, disabled });
  input.addEventListener('change', () => onchange(input.checked));
  return h('label.opt', null, input, h('span.check', { html: svg('check') }),
    h('span.opt-main', null, h('span.opt-title', null, title, extra), desc ? h('span.opt-desc', null, desc) : null));
}

function fillSkillsPop() {
  const pop = $('#pop-skills'); pop.className = 'popover pop-skills'; pop.innerHTML = '';
  pop.append(h('div.pop-head', null, h('span', null, 'Habilidades ativas em todas as mensagens'), S.sel.skills.length ? h('button', { onclick: () => { S.sel.skills = []; saveSel(); fillSkillsPop(); updatePickers(); renderChatTitle(); } }, 'Limpar') : null));
  if (!S.skills.length) pop.append(h('div.pop-empty', null, 'Nenhuma habilidade ainda. Crie ou importe no menu Habilidades.'));
  for (const s of S.skills) {
    pop.append(checkRow({
      checked: S.sel.skills.includes(s.id), title: s.name, desc: s.description,
      onchange: (on) => { S.sel.skills = on ? [...new Set([...S.sel.skills, s.id])] : S.sel.skills.filter((x) => x !== s.id); saveSel(); updatePickers(); renderChatTitle(); },
    }));
  }
  pop.append(h('div.pop-foot', null, h('button.btn.ghost.sm.wide', { onclick: () => { closePops(); setView('skills'); } }, ic('gear'), 'Gerenciar habilidades')));
}

function fillMcpPop() {
  const pop = $('#pop-mcp'); pop.className = 'popover pop-mcp'; pop.innerHTML = '';
  pop.append(h('div.pop-head', null, h('span', null, 'Ferramentas disponíveis ao modelo')));
  const on = enabledGroups();
  pop.append(h('button.menu-item', { onclick: () => { closePops(); openSettings('tools'); } },
    ic('wrench'), h('span.mi-main', null, `Ferramentas internas: ${on.length} de ${TOOL_GROUPS.length} ativas`, h('span.mi-sub', null, on.map((g) => TOOL_INFO[g].short).join(', ') || 'nenhuma')), h('span.tag', null, 'Configurar')));
  pop.append(h('div.menu-sep'));
  if (!S.mcp.length) pop.append(h('div.pop-empty', null, 'Nenhum conector MCP configurado.'));
  for (const s of S.mcp) {
    const st = statusInfo(s.status);
    pop.append(checkRow({
      checked: S.sel.mcp.includes(s.name), title: s.name,
      extra: h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto', fontSize: '12px', color: 'var(--muted)', fontWeight: 400 } }, h('span.dot.' + st.dot), s.status === 'connected' ? `${s.tools.length} ferramentas` : st.label),
      desc: s.error || s.tools.slice(0, 6).map((t) => t.name).join(', '),
      onchange: (on) => { S.sel.mcp = on ? [...new Set([...S.sel.mcp, s.name])] : S.sel.mcp.filter((x) => x !== s.name); saveSel(); updatePickers(); renderChatTitle(); },
    }));
  }
  pop.append(h('div.pop-foot', null, h('button.btn.ghost.sm.wide', { onclick: () => { closePops(); setView('mcp'); } }, ic('gear'), 'Gerenciar conectores')));
}

function modelById(id) { return S.models.models.find((m) => m.id === id) || null; }
/** Modelo escolhido para a conversa (ou o carregado agora). */
function convModel(c) {
  const id = c ? c.modelId : S.draftModel;
  return modelById(id) || modelById(S.models.active);
}

async function loadModels() {
  try { S.models = await api('/api/models'); } catch { return; }
  updatePickers();
  if (S.view === 'server') drawModels();
}

async function activateModel(id, quiet) {
  const m = modelById(id);
  if (!quiet) toast(`Carregando ${m?.name || 'modelo'}...`);
  S.llama = noteLlama(await api('/api/models/activate', { id }));
  S.models.active = id; S.model = ''; S.nCtx = 0;
  updatePickers();
  if (S.view === 'server') { drawServerStatus(); drawServerForm(); drawModels(); }
}

/* ---- Testes: escalar para um modelo maior ----
   Falhas seguidas de ferramenta (ou a mesma chamada falhando de novo) trocam o modelo carregado
   por um maior no meio da resposta. Só com o modo avançado, e só se nenhuma outra conversa estiver usando o servidor. */
function escalateCfg() { const e = S.settings.escalate || {}; return S.settings.advanced && e.on && e.model ? { after: Number(e.after) || 3, then: e.then || 'voltar', model: e.model } : null; }
/** Conta as falhas do passo; devolve o motivo quando é hora de escalar. */
function escalateWhy(conv, msg, st) {
  const cfg = escalateCfg();
  if (!cfg || st.done) return '';
  for (const tc of msg.tool_calls || []) {
    const r = conv.messages.find((m) => m.role === 'tool' && m.tool_call_id === tc.id);
    if (!r || r.status === 'denied') continue;
    if (r.status === 'error') {
      st.fails++;
      const sig = tc.function.name + ' ' + normArgs(tc.function.arguments);
      if (st.sigs.has(sig)) st.repeat = tc.function.name;
      st.sigs.add(sig);
    } else if (r.status === 'ok') { st.fails = 0; }
  }
  if (st.repeat) return `repetiu ${st.repeat} com o mesmo erro`;
  if (st.fails >= cfg.after) return `${st.fails} falhas seguidas`;
  return '';
}
function normArgs(a) { const o = parseArgs(a); return o ? JSON.stringify(o, Object.keys(o).sort()) : String(a || ''); }
async function escalate(conv, why, st, signal) {
  const cfg = escalateCfg(); st.done = true;
  const big = modelById(cfg.model); const small = modelById(S.models.active);
  if (!big || big.id === S.models.active) return;
  if ([...S.runs.keys()].some((id) => id !== conv.id)) {
    conv.messages.push({ role: 'notice', icon: 'flask', content: `Ia escalar para ${big.name} (${why}), mas outra conversa está usando o servidor.` });
    return;
  }
  conv.messages.push({ role: 'notice', content: `Escalado para ${big.name}: ${small?.name || 'o modelo atual'} ${why}.` });
  conv.messages.push({ role: 'user', hidden: true, note: true, content: `(Nota do studio: o modelo anterior${small ? ` (${small.name})` : ''} ${why} nesta tarefa. Você é um modelo maior assumindo daqui. Releia os erros acima, descubra a causa e, se preciso, siga por outro caminho.)` });
  saveConvs(); scheduleRender();
  conv._waitingModel = true; conv._waitText = `Trocando para ${big.name}...`; scheduleRender();
  try { await activateModel(big.id, true); } finally { conv._waitingModel = false; conv._waitText = ''; }
  await waitModel(conv, signal); await assignSlot(conv);
  // voltar: a conversa fica presa ao modelo de antes, e o próximo pedido troca de volta
  if (cfg.then === 'ficar') conv.modelId = big.id; else if (!conv.modelId && small) conv.modelId = small.id;
  saveConvs();
}

/** Antes de responder: carrega o modelo da conversa (esperando outras conversas terminarem). */
async function ensureModel(conv, signal) {
  const want = conv.modelId && modelById(conv.modelId);
  if (!want || want.id === S.models.active) return;
  const others = () => [...S.runs.keys()].some((id) => id !== conv.id && !S.convs.find((x) => x.id === id)?._waitingModel);
  if (others()) {
    conv._waitingModel = true; conv._waitText = `Esperando outra conversa terminar para trocar para ${want.name}.`; scheduleRender();
    try { while (others() && !signal.aborted) await new Promise((r) => setTimeout(r, 700)); }
    finally { conv._waitingModel = false; conv._waitText = ''; }
  }
  if (signal.aborted || want.id === S.models.active) return;
  conv._waitingModel = true; conv._waitText = `Trocando para ${want.name}...`; scheduleRender();
  try { await activateModel(want.id, true); } finally { conv._waitingModel = false; conv._waitText = ''; }
}

function chooseModel(id) {
  const c = cur();
  const prev = kitModelId();
  if (prev && prev !== id) saveKit(prev);
  if (c) { c.modelId = id; saveConvs(); } else S.draftModel = id;
  // o modelo novo traz a seleção dele; se ainda não tiver, herda a atual
  if (!applyKit(id, true)) saveKit(id);
  updatePickers();
  // ninguém respondendo: já carrega, para a próxima mensagem não esperar
  if (id !== S.models.active && !S.runs.size) activateModel(id).catch((e) => toast(e.message, 'err'));
}

function fillModelPop() {
  const pop = $('#pop-model'); pop.innerHTML = '';
  const st = { ok: 'Pronto', loading: 'Carregando o modelo', offline: 'Desligado ou inacessível' }[S.health.status] || 'Verificando';
  const want = convModel(cur());
  pop.append(h('div.pop-head', null, h('span', null, 'Modelo desta conversa')));
  if (!S.models.models.length) pop.append(h('div.pop-path', null, S.model || 'Nenhum modelo cadastrado'));
  for (const m of S.models.models) {
    const loaded = m.id === S.models.active;
    pop.append(h('button.menu-item.model-item' + (want?.id === m.id ? '.sel' : ''), { onclick: () => { closePops(); chooseModel(m.id); } },
      h('span.dot.' + (loaded ? ({ ok: 'ok', loading: 'busy', offline: 'err' }[S.health.status] || '') : 'idle')),
      h('span.mi-main', null, m.name, h('span.mi-sub', null, loaded ? `${st} · contexto ${fmtK(m.context)}` : `contexto ${fmtK(m.context)} · troca ao escolher`)),
      want?.id === m.id ? ic('check') : null));
  }
  pop.append(...[h('div.menu-sep'),
    h('div.mi-note', null, 'Só um modelo fica carregado por vez. Cada modelo lembra as habilidades, conectores e ferramentas que estavam marcados com ele.'),
    S.llama && !S.llama.running && S.health.status === 'offline' ? h('button.menu-item', { onclick: () => { closePops(); startLlama(); } }, ic('play'), 'Iniciar o servidor') : null,
    S.llama?.running ? h('button.menu-item', { onclick: () => { closePops(); stopLlama(); } }, ic('stop'), 'Parar o servidor') : null,
    h('button.menu-item', { onclick: () => { closePops(); setView('server'); } }, ic('server'), 'Gerenciar modelos e servidor')].filter(Boolean));
}

function fillWsPop() {
  const pop = $('#pop-ws'); pop.innerHTML = '';
  const proj = projectOf(cur());
  pop.append(h('div.pop-head', null, h('span', null, proj ? `Pasta do projeto ${proj.name}` : 'Espaço de trabalho')), h('div.pop-path', null, S.ws.path));
  if (proj) pop.append(h('button.menu-item', { onclick: () => { closePops(); editProject(proj); } }, ic('gear'), 'Configurar o projeto'));
  for (const p of proj ? [] : (S.info.recentWorkspaces || []).filter((x) => x !== S.ws.path).slice(0, 5)) {
    pop.append(h('button.menu-item', { onclick: () => { closePops(); setWorkspace(p); } }, ic('folder'), h('span.mi-main', null, basename(p), h('span.mi-sub', null, p))));
  }
  pop.append(h('div.menu-sep'),
    h('button.menu-item', { onclick: () => { closePops(); chooseWorkspace(); } }, ic('folderOpen'), 'Escolher outra pasta...'),
    h('button.menu-item', { onclick: () => { closePops(); api('/api/reveal', { path: '.', ws: S.ws.path }); } }, ic('external'), 'Abrir no Explorer'),
    h('button.menu-item', { onclick: () => { closePops(); toggleWs(); } }, ic('panel'), $('#ws').classList.contains('hidden') ? 'Mostrar painel de arquivos' : 'Ocultar painel de arquivos'));
}

function fillPlusPop() {
  const pop = $('#pop-plus'); pop.innerHTML = '';
  pop.append(h('div.pop-head', null, h('span', null, 'Inserir na mensagem')),
    h('button.menu-item', { onclick: async () => {
      closePops();
      const p = await pickPath({ title: 'Referenciar arquivo ou pasta', mode: 'any', start: S.ws.path });
      if (p) { const st = await api('/api/stat', { path: p, ws: S.ws.path }); addRef({ name: basename(p), path: st.path, dir: st.dir }); }
    } }, ic('pin'), h('span.mi-main', null, 'Arquivo ou pasta do computador', h('span.mi-sub', null, 'Entra o caminho completo, sem enviar o arquivo'))),
    h('button.menu-item', { onclick: () => { closePops(); focusEditor(); document.execCommand('insertText', false, '@'); checkMention(); } }, ic('sparkles'), h('span.mi-main', null, 'Habilidade ou conector', h('span.mi-sub', null, 'O mesmo que digitar @'))),
    h('div.menu-sep'),
    h('button.menu-item', { onclick: () => { closePops(); setView('skills'); } }, ic('download'), 'Importar habilidades'),
    h('button.menu-item', { onclick: () => { closePops(); setView('mcp'); } }, ic('plus'), 'Adicionar conector MCP'));
}

/* ------------------------------------------------------------ arquivos arrastados */
function locKey(r) { return `${r.name}|${r.size}|${r.lastModified}`; }

function refPillEls(r) { return $$(`.pill[data-ref="${r.id}"]`, editor()); }

function updateRefPill(r) {
  // pacote de configurações arrastado para a janela: abre a importação em vez de virar etiqueta
  if (r.status === 'ok' && /\.studio\.json$/i.test(r.path || '') && !r.offered) {
    r.offered = true;
    for (const el of refPillEls(r)) el.remove();
    importDialog(r.path);
    return;
  }
  for (const el of refPillEls(r)) {
    el.classList.remove('loading', 'missing', 'choose');
    if (r.status !== 'ok') el.classList.add(r.status);
    el.querySelector('.v').textContent = r.name || basename(r.path);
    el.dataset.name = r.name || '';
    el.title = r.status === 'loading' ? 'Localizando no computador...' : r.status === 'missing' ? 'Não encontrei este arquivo. Clique para resolver.' : r.status === 'choose' ? 'Há mais de um arquivo com este nome. Clique para escolher.' : r.path;
  }
}

function addRef(r) {
  const ref = { id: uid(), status: 'ok', ...r };
  S.refs.push(ref);
  insertPill({ kind: 'file', name: ref.name || basename(ref.path), ref: ref.id });
  updateRefPill(ref);
  return ref;
}

async function remember(r) {
  if (!r.path) return;
  const cache = store.get('loc', {});
  if (r.size != null) { cache[locKey(r)] = r.path; store.set('loc', cache); }
  api('/api/remember', { path: r.path }).catch(() => {});
}

async function locateRef(r) {
  try {
    const cached = store.get('loc', {})[locKey(r)];
    if (cached && !r.dir) {
      const st = await api('/api/stat', { path: cached, ws: S.ws.path });
      if (st.exists && st.size === r.size) { r.path = cached; r.status = 'ok'; updateRefPill(r); return; }
    }
    const res = await api('/api/locate', { name: r.name, size: r.size, lastModified: r.lastModified, isDir: r.dir });
    const exact = res.matches.filter((m) => m.exact);
    if (exact.length === 1 || (res.matches.length === 1 && (r.dir || res.matches[0].score >= 3))) {
      r.path = (exact[0] || res.matches[0]).path; r.status = 'ok'; remember(r);
    } else if (res.matches.length) {
      r.options = res.matches; r.path = res.matches[0].path; r.status = 'choose';
    } else r.status = 'missing';
  } catch (e) { r.status = 'missing'; console.warn(e); }
  updateRefPill(r);
}

function refAction(r) {
  if (r.status === 'loading') return;
  let m;
  const done = () => { m.close(); updateRefPill(r); };
  const list = h('div.choose-list');
  if (r.status === 'choose' || (r.options && r.options.length > 1)) {
    for (const o of r.options || []) {
      list.append(h('button', { onclick: () => { r.path = o.path; r.status = 'ok'; remember(r); done(); } }, o.path,
        h('small', null, [o.exact ? 'mesmo tamanho e data' : 'mesmo nome', o.size != null && !r.dir ? fmtSize(o.size) : null, o.mtime ? new Date(o.mtime).toLocaleString('pt-BR') : null].filter(Boolean).join(', '))));
    }
  }
  const body = [
    h('p', { style: { marginTop: 0, color: 'var(--text-2)' } },
      r.status === 'missing' ? `Não encontrei "${r.name}" nas pastas comuns nem no índice de pesquisa do Windows.`
        : r.status === 'choose' ? `Há mais de um "${r.name}" no computador. Qual deles?` : r.path),
    list.childElementCount ? list : null,
  ];
  const foot = [
    h('button.btn.danger', { style: { marginRight: 'auto' }, onclick: () => { refPillEls(r).forEach((el) => el.remove()); S.refs = S.refs.filter((x) => x !== r); m.close(); updatePickers(); } }, 'Remover da mensagem'),
    h('button.btn', { onclick: async () => {
      const p = await promptBox('Caminho do arquivo', `Cole o caminho completo de "${r.name}"`, r.path || '', 'Usar');
      if (!p) return;
      const st = await api('/api/stat', { path: p.replace(/^"|"$/g, ''), ws: S.ws.path });
      if (!st.exists) { toast('Esse caminho não existe.', 'err'); return; }
      r.path = st.path; r.dir = st.dir; r.status = 'ok'; r.name = basename(st.path); remember(r); done();
    } }, 'Informar caminho'),
    r.file && r.status !== 'ok' ? h('button.btn.primary', { onclick: async () => {
      try {
        r.status = 'loading'; done();
        const res = await api('/api/ws/upload?name=' + encodeURIComponent(r.name) + '&ws=' + encodeURIComponent(S.ws.path), r.file);
        r.path = res.path; r.status = 'ok'; r.file = null; updateRefPill(r); refreshTree();
        toast('Copiado para a pasta anexos do espaço de trabalho');
      } catch (e) { r.status = 'missing'; updateRefPill(r); toast(e.message, 'err'); }
    } }, 'Copiar para o espaço de trabalho') : null,
  ];
  m = modal({ title: r.name || 'Arquivo', body, foot });
}

function fileUriToPath(u) {
  try {
    const url = new URL(u.trim());
    if (url.protocol !== 'file:') return null;
    let p = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1).replace(/\//g, '\\');
    if (url.host) p = `\\\\${url.host}${p.replace(/\//g, '\\')}`;
    return p;
  } catch { return null; }
}

function statRef(p) {
  const r = addRef({ name: basename(p), path: p, status: 'loading' });
  api('/api/stat', { path: p, ws: S.ws.path }).then((st) => { r.dir = st.dir; r.path = st.path; r.status = st.exists ? 'ok' : 'missing'; updateRefPill(r); });
}

/* ------------------------------------------------------------ imagens nas mensagens */
// Imagem colada (Ctrl+V) vira um arquivo em anexos\ do espaço de trabalho e entra como etiqueta.
// Etiquetas de imagem (coladas ou arrastadas) vão como imagem para modelos com visão.
const IMG_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;
S.imgData = new Map();
const imgLoading = new Set();
function isImgRef(r) { return !!r?.path && !r.dir && IMG_RE.test(r.path); }
async function loadImg(path, ws) {
  if (S.imgData.has(path) || imgLoading.has(path)) return S.imgData.get(path);
  imgLoading.add(path);
  try { const r = await api('/api/img', { path, ws: ws || S.ws.path }); S.imgData.set(path, r.data); return r.data; }
  catch { S.imgData.set(path, null); return null; }
  finally { imgLoading.delete(path); }
}
async function pasteImage(file) {
  const ext = ({ 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' })[file.type] || 'png';
  const d = new Date(); const pad = (n) => String(n).padStart(2, '0');
  const name = `colada-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
  const r = addRef({ name, status: 'loading' });
  const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(file); });
  try {
    const up = await api('/api/ws/upload?name=' + encodeURIComponent(name) + '&ws=' + encodeURIComponent(S.ws.path), file);
    r.path = up.path; r.name = basename(up.path); r.status = 'ok';
    if (data) S.imgData.set(up.path, data);
    refreshTree();
    if (!visionOn()) toast('Imagem salva em anexos. O modelo atual não enxerga imagens: ele recebe só o caminho.');
  } catch (e) { r.status = 'missing'; toast('Não consegui salvar a imagem: ' + e.message, 'err'); }
  updateRefPill(r); updatePickers();
}
/** Carrega as imagens da última mensagem do usuário antes de mandar ao modelo. */
async function preloadImgs(conv) {
  if (!visionOn()) return;
  const m = [...conv.messages].reverse().find((x) => x.role === 'user' && !x.hidden);
  await Promise.all((m?.refs || []).filter(isImgRef).map((r) => loadImg(r.path, wsOf(conv))));
}

function handleDrop(dt) {
  const internal = dt.getData('application/x-studio-path');
  if (internal) { try { addRef(JSON.parse(internal)); } catch { /* ok */ } return; }
  const uris = (dt.getData('text/uri-list') || '').split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const fromUri = uris.map(fileUriToPath).filter(Boolean);
  if (fromUri.length) { fromUri.forEach(statRef); return; }
  const items = [...(dt.items || [])].filter((i) => i.kind === 'file');
  if (items.length) {
    for (const it of items) {
      const entry = it.webkitGetAsEntry?.();
      const f = it.getAsFile();
      if (!f) continue;
      const isDir = !!entry?.isDirectory;
      const r = addRef({ name: f.name, size: isDir ? undefined : f.size, lastModified: f.lastModified, dir: isDir, status: 'loading', file: isDir ? null : f });
      locateRef(r);
    }
    return;
  }
  const text = dt.getData('text/plain');
  if (text && /^"?([A-Za-z]:\\|\\\\|\/)/.test(text.trim())) statRef(text.trim().replace(/^"|"$/g, ''));
}

function setupDrop() {
  const chat = $('#chat'); const comp = $('#composer');
  let depth = 0;
  const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].some((t) => t === 'Files' || t === 'application/x-studio-path' || t === 'text/uri-list');
  chat.addEventListener('dragenter', (e) => { if (!isFileDrag(e)) return; e.preventDefault(); depth++; comp.classList.add('dragging'); });
  chat.addEventListener('dragover', (e) => { if (!isFileDrag(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'link'; });
  chat.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) comp.classList.remove('dragging'); });
  chat.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault(); depth = 0; comp.classList.remove('dragging');
    // posiciona o cursor onde o arquivo caiu, se foi dentro do texto
    const r = rangeAtPoint(e.clientX, e.clientY);
    if (r) savedRange = r;
    handleDrop(e.dataTransfer);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}
