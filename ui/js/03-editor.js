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
  const label = kind === 'skill' ? L('Habilidade') : kind === 'mcp' ? L('Conector') : L('Arquivo');
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
    if (p.kind === 'skill') return L('Habilidade:{0}', p.name);
    if (p.kind === 'mcp') return L('Conector:{0}', p.name);
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
  for (const s of S.mcp) if (!q || s.name.toLowerCase().includes(q)) items.push({ kind: 'mcp', id: s.name, name: s.name, desc: s.status === 'connected' ? L('{0} ferramentas', s.tools.length) : statusInfo(s.status).label });
  for (const it of S.ws.cache.get('') || []) if (q && it.name.toLowerCase().includes(q)) items.push({ kind: 'file', name: it.name, path: it.path, dir: it.dir, desc: it.dir ? L('pasta do espaço de trabalho') : fmtSize(it.size) });
  return items.slice(0, 12);
}

function checkMention() {
  const s = getSelection();
  if (!s.rangeCount || !s.isCollapsed) return closeMention();
  const node = s.anchorNode;
  if (node?.nodeType !== 3 || !editor().contains(node)) return closeMention();
  const before = node.textContent.slice(0, s.anchorOffset);
  // "/" no começo da mensagem: prompts salvos
  const sm = before.match(/^\s*\/([^\s/]{0,40})$/);
  if (sm && editor().textContent.trim() === before.trim()) {
    mention = { items: promptItems(sm[1]), index: 0, node, start: s.anchorOffset - sm[1].length - 1, end: s.anchorOffset, slash: true };
    drawMention();
    return;
  }
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
  if (mention.slash) {
    pop.append(h('div.pop-head', null, h('span', null, L('Prompts salvos')), h('button.btn.sm', { onmousedown: (e) => { e.preventDefault(); closeMention(); managePrompts(); } }, L('Gerenciar'))));
    if (!mention.items.length) { pop.append(h('div.pop-empty', null, L('Nenhum prompt com esse nome. Salve um pela mensagem enviada (Salvar como prompt) ou em Gerenciar.'))); return; }
  } else {
    if (!mention.items.length) { pop.append(h('div.pop-empty', null, L('Nada encontrado. Crie habilidades e conectores no menu à esquerda.'))); return; }
    pop.append(h('div.pop-head', null, h('span', null, L('Inserir na mensagem'))));
  }
  mention.items.forEach((it, i) => {
    const kindLbl = { skill: L('habilidade'), mcp: L('conector'), file: L('arquivo'), prompt: '/' + it.id }[it.kind];
    pop.append(h('button.menu-item' + (i === mention.index ? '.hl' : ''), { onmousedown: (e) => { e.preventDefault(); chooseMention(i); } },
      ic(it.kind === 'prompt' ? 'bookmark' : it.kind === 'skill' ? 'sparkles' : it.kind === 'mcp' ? 'plug' : it.dir ? 'folder' : ftype(it.name).icon),
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
  if (it.kind === 'prompt') { usePrompt(it.prompt); return; }
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
  // já pediu para parar e ainda não parou: o próximo clique força
  const stopping = busy && !queueMode && !!S.runs.get(cur()?.id)?.stopAt;
  send.classList.toggle('stopping', stopping);
  send.title = queueMode ? L('Pôr na fila (Enter) · Esc para parar a resposta') : stopping ? L('Parando... clique de novo para forçar a parada') : busy ? L('Parar (Esc)') : L('Enviar (Enter)');
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
  // para APIs remotas, mostra o status real (online/offline) em vez do llama-server
  const isRemote = want?.model?.startsWith('remote:');
  const remoteApi = isRemote ? (S.info.apis || []).find((a) => a.id === want.model.slice(7)) : null;
  const dot = pending ? 'idle' : isRemote ? (remoteApi?.online === true ? 'ok' : remoteApi?.online === false ? 'err' : 'idle') : ({ ok: 'ok', loading: 'busy', offline: 'err' }[S.health.status] || '');
  const label = want ? want.name : S.model ? shortModel(S.model) : (S.health.status === 'loading' ? 'carregando...' : 'llama-server');
  pm.append(h('span.dot.' + dot), h('b', null, label.replace(/[-_.](I?Q\d[\w]*|BF16|F16|F32)$/i, '')), h('span', { html: svg('chev', 'caret'), style: { display: 'contents' } }));
  maybeStartNimPoll();
  pm.title = pending ? L('{0}: será carregado no lugar de {1} quando você enviar', want.name, modelById(S.models.active)?.name || L('o atual')) : (want?.model || S.model || S.info.llamaUrl || '');
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
    pers ? L('Personalidade: {0}', pers.name) : L('Personalidade: nenhuma'), !!pers, 0, pers?.color);
  const tk = thinkOf(c);
  iconBtn($('#pick-think'), ic(tk === 'off' ? ('zap' in ICONS ? 'zap' : 'send') : 'brain'), L('Raciocínio: {0}', THINK_OPTS.find((o) => o[0] === tk)[1]), tk !== thinkDefault(), 0, tk === 'off' ? '#d99a1e' : 'var(--accent)');
  const al = autoLevelOf(c);
  iconBtn($('#pick-auto'), ic(al === 'desligado' ? 'ban' : 'signpost'), L('Recursos automáticos: {0}', AUTO_LEVELS.find((o) => o[0] === al)[1]), al !== 'equilibrado', 0, al === 'desligado' ? 'var(--muted)' : al === 'liberal' ? '#d99a1e' : 'var(--accent)');
  const pl = planOf(c);
  iconBtn($('#pick-plan'), ic('list'), pl ? L('Modo plano: ligado (o modelo só investiga e propõe)') : L('Modo plano: desligado'), pl, 0, '#0e9f8a');
  const skNames = act.skills.map((id) => S.skills.find((k) => k.id === id)?.name || id);
  iconBtn($('#pick-skills'), ic('sparkles'), nSk ? L('Habilidades: {0}', skNames.join(', ') || nSk) : L('Habilidades: nenhuma'), nSk > 0, nSk, 'var(--skill)');
  iconBtn($('#pick-mcp'), ic('plug'), nMcp ? L('Conectores: {0}', act.mcp.join(', ') || nMcp) : L('Conectores: nenhum'), nMcp > 0, nMcp, 'var(--mcp)');
  const proj = projectOf(c);
  iconBtn($('#pick-ws'), ic('folder'), proj ? L('Projeto: {0}\n{1}', proj.name, S.ws.path) : L('Espaço de trabalho: {0}', S.ws.path || '...'), !!proj, 0, '#b07a14');
}

function checkRow({ checked, title, desc, extra, disabled, onchange }) {
  const input = h('input', { type: 'checkbox', checked, disabled });
  input.addEventListener('change', () => onchange(input.checked));
  return h('label.opt', null, input, h('span.check', { html: svg('check') }),
    h('span.opt-main', null, h('span.opt-title', null, title, extra), desc ? h('span.opt-desc', null, desc) : null));
}

function fillSkillsPop() {
  const pop = $('#pop-skills'); pop.className = 'popover pop-skills'; pop.innerHTML = '';
  pop.append(h('div.pop-head', null, h('span', null, L('Habilidades ativas em todas as mensagens')), S.sel.skills.length ? h('button', { onclick: () => { S.sel.skills = []; saveSel(); fillSkillsPop(); updatePickers(); renderChatTitle(); } }, L('Limpar')) : null));
  if (!S.skills.length) pop.append(h('div.pop-empty', null, L('Nenhuma habilidade ainda. Crie ou importe no menu Habilidades.')));
  for (const s of S.skills) {
    pop.append(checkRow({
      checked: S.sel.skills.includes(s.id), title: s.name, desc: s.description,
      onchange: (on) => { S.sel.skills = on ? [...new Set([...S.sel.skills, s.id])] : S.sel.skills.filter((x) => x !== s.id); saveSel(); updatePickers(); renderChatTitle(); },
    }));
  }
  pop.append(h('div.pop-foot', null, h('button.btn.ghost.sm.wide', { onclick: () => { closePops(); setView('skills'); } }, ic('gear'), L('Gerenciar habilidades'))));
}

function fillMcpPop() {
  const pop = $('#pop-mcp'); pop.className = 'popover pop-mcp'; pop.innerHTML = '';
  pop.append(h('div.pop-head', null, h('span', null, L('Ferramentas disponíveis ao modelo'))));
  const on = enabledGroups();
  pop.append(h('button.menu-item', { onclick: () => { closePops(); openSettings('tools'); } },
    ic('wrench'), h('span.mi-main', null, L('Ferramentas internas: {0} de {1} ativas', on.length, TOOL_GROUPS.length - 1), h('span.mi-sub', null, on.map((g) => TOOL_INFO[g].short).join(', ') || 'nenhuma')), h('span.tag', null, L('Configurar'))));
  pop.append(h('div.menu-sep'));
  if (!S.mcp.length) pop.append(h('div.pop-empty', null, L('Nenhum conector MCP configurado.')));
  for (const s of S.mcp) {
    const st = statusInfo(s.status);
    pop.append(checkRow({
      checked: S.sel.mcp.includes(s.name), title: s.name,
      extra: h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto', fontSize: '12px', color: 'var(--muted)', fontWeight: 400 } }, h('span.dot.' + st.dot), s.status === 'connected' ? L('{0} ferramentas', s.tools.length) : st.label),
      desc: s.error || s.tools.slice(0, 6).map((t) => t.name).join(', '),
      onchange: (on) => { S.sel.mcp = on ? [...new Set([...S.sel.mcp, s.name])] : S.sel.mcp.filter((x) => x !== s.name); saveSel(); updatePickers(); renderChatTitle(); },
    }));
  }
  pop.append(h('div.pop-foot', null, h('button.btn.ghost.sm.wide', { onclick: () => { closePops(); setView('mcp'); } }, ic('gear'), L('Gerenciar conectores'))));
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
  if (!quiet) toast(L('Carregando {0}...', m?.name || L('modelo')));
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
  if (st.repeat) return L('repetiu {0} com o mesmo erro', st.repeat);
  if (st.fails >= cfg.after) return L('{0} falhas seguidas', st.fails);
  return '';
}
function normArgs(a) { const o = parseArgs(a); return o ? JSON.stringify(o, Object.keys(o).sort()) : String(a || ''); }
async function escalate(conv, why, st, signal) {
  const cfg = escalateCfg(); st.done = true;
  const big = modelById(cfg.model); const small = modelById(S.models.active);
  if (!big || big.id === S.models.active) return;
  if ([...S.runs.keys()].some((id) => id !== conv.id)) {
    conv.messages.push({ role: 'notice', icon: 'flask', content: L('Ia escalar para {0} ({1}), mas outra conversa está usando o servidor.', big.name, why) });
    return;
  }
  conv._thinkNext = true;
  conv.messages.push({ role: 'notice', content: L('Escalado para {0}: {1} {2}.', big.name, small?.name || L('o modelo atual'), why) });
  conv.messages.push({ role: 'user', hidden: true, note: true, content: L('(Nota do studio: o modelo anterior{0} {1} nesta tarefa. Você é um modelo maior assumindo daqui. Releia os erros acima, descubra a causa e, se preciso, siga por outro caminho.)', small ? ` (${small.name})` : '', why) });
  saveConvs(); scheduleRender();
  conv._waitingModel = true; conv._waitText = L('Trocando para {0}...', big.name); scheduleRender();
  try { await activateModel(big.id, true); } finally { conv._waitingModel = false; conv._waitText = ''; }
  await waitModel(conv, signal); await assignSlot(conv);
  // voltar: a conversa fica presa ao modelo de antes, e o próximo pedido troca de volta
  if (cfg.then === 'ficar') conv.modelId = big.id; else if (!conv.modelId && small) conv.modelId = small.id;
  saveConvs();
}

/** Antes de responder: carrega o modelo da conversa (esperando outras conversas terminarem).
 *  Conversa numa API externa não carrega nada nem espera ninguém: várias respondem ao mesmo tempo. */
async function ensureModel(conv, signal) {
  const want = conv.modelId && modelById(conv.modelId);
  if (!want || want.id === S.models.active) return;
  if (String(want.model || '').startsWith('remote:')) return;
  // só as conversas que usam o llama-server atrapalham a troca do modelo local
  const others = () => [...S.runs.keys()].some((id) => {
    if (id === conv.id) return false;
    const o = S.convs.find((x) => x.id === id);
    return !o?._waitingModel && !mainApiForChat(o);
  });
  if (others()) {
    conv._waitingModel = true; conv._waitText = L('Esperando outra conversa terminar para trocar para {0}.', want.name); scheduleRender();
    try { while (others() && !signal.aborted) await new Promise((r) => setTimeout(r, 700)); }
    finally { conv._waitingModel = false; conv._waitText = ''; }
  }
  if (signal.aborted || want.id === S.models.active) return;
  conv._waitingModel = true; conv._waitText = L('Trocando para {0}...', want.name); scheduleRender();
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
  const st = { ok: L('Pronto'), loading: L('Carregando o modelo'), offline: L('Desligado ou inacessível') }[S.health.status] || L('Verificando');
  const want = convModel(cur());
  pop.append(h('div.pop-head', null, h('span', null, L('Modelo desta conversa'))));
  if (!S.models.models.length) pop.append(h('div.pop-path', null, S.model || L('Nenhum modelo cadastrado')));
  for (const m of S.models.models) {
    const loaded = m.id === S.models.active;
    pop.append(h('button.menu-item.model-item' + (want?.id === m.id ? '.sel' : ''), { onclick: () => { closePops(); chooseModel(m.id); } },
      h('span.dot.' + (loaded ? ({ ok: 'ok', loading: 'busy', offline: 'err' }[S.health.status] || '') : 'idle')),
      h('span.mi-main', null, m.name, h('span.mi-sub', null, loaded ? L('{0} · contexto {1}', st, fmtK(m.context)) : L('contexto {0} · troca ao escolher', fmtK(m.context)))),
      want?.id === m.id ? ic('check') : null));
  }
  pop.append(...[h('div.menu-sep'),
    h('div.mi-note', null, L('Só um modelo fica carregado por vez. Cada modelo lembra as habilidades, conectores e ferramentas que estavam marcados com ele.')),
    S.llama && !S.llama.running && S.health.status === 'offline' ? h('button.menu-item', { onclick: () => { closePops(); startLlama(); } }, ic('play'), L('Iniciar o servidor')) : null,
    S.llama?.running ? h('button.menu-item', { onclick: () => { closePops(); stopLlama(); } }, ic('stop'), L('Parar o servidor')) : null,
    h('button.menu-item', { onclick: () => { closePops(); setView('server'); } }, ic('server'), L('Gerenciar modelos e servidor'))].filter(Boolean));
}

function fillWsPop() {
  const pop = $('#pop-ws'); pop.innerHTML = '';
  const proj = projectOf(cur());
  pop.append(h('div.pop-head', null, h('span', null, proj ? L('Pasta do projeto {0}', proj.name) : L('Espaço de trabalho'))), h('div.pop-path', null, S.ws.path));
  if (proj) pop.append(h('button.menu-item', { onclick: () => { closePops(); editProject(proj); } }, ic('gear'), L('Configurar o projeto')));
  for (const p of proj ? [] : (S.info.recentWorkspaces || []).filter((x) => x !== S.ws.path).slice(0, 5)) {
    pop.append(h('button.menu-item', { onclick: () => { closePops(); setWorkspace(p); } }, ic('folder'), h('span.mi-main', null, basename(p), h('span.mi-sub', null, p))));
  }
  pop.append(h('div.menu-sep'),
    h('button.menu-item', { onclick: () => { closePops(); chooseWorkspace(); } }, ic('folderOpen'), L('Escolher outra pasta...')),
    h('button.menu-item', { onclick: () => { closePops(); api('/api/reveal', { path: '.', ws: S.ws.path }); } }, ic('external'), L('Abrir no Explorer')),
    h('button.menu-item', { onclick: () => { closePops(); toggleWs(); } }, ic('panel'), $('#ws').classList.contains('hidden') ? L('Mostrar painel de arquivos') : L('Ocultar painel de arquivos')));
}

function fillPlusPop() {
  const pop = $('#pop-plus'); pop.innerHTML = '';
  pop.append(h('div.pop-head', null, h('span', null, L('Inserir na mensagem'))),
    h('button.menu-item', { onclick: async () => {
      closePops();
      const p = await pickPath({ title: L('Referenciar arquivo ou pasta'), mode: 'any', start: S.ws.path });
      if (p) { const st = await api('/api/stat', { path: p, ws: S.ws.path }); addRef({ name: basename(p), path: st.path, dir: st.dir }); }
    } }, ic('pin'), h('span.mi-main', null, L('Arquivo ou pasta do computador'), h('span.mi-sub', null, L('Entra o caminho completo, sem enviar o arquivo')))),
    h('button.menu-item', { onclick: () => { closePops(); focusEditor(); document.execCommand('insertText', false, '@'); checkMention(); } }, ic('sparkles'), h('span.mi-main', null, L('Habilidade ou conector'), h('span.mi-sub', null, L('O mesmo que digitar @')))),
    h('button.menu-item', { onclick: () => { closePops(); if (editor().textContent.trim()) { managePrompts(); return; } focusEditor(); document.execCommand('insertText', false, '/'); checkMention(); } }, ic('bookmark'), h('span.mi-main', null, L('Prompt salvo'), h('span.mi-sub', null, L('O mesmo que digitar / no começo da mensagem')))),
    h('div.menu-sep'),
    h('button.menu-item', { onclick: () => { closePops(); setView('skills'); } }, ic('download'), L('Importar habilidades')),
    h('button.menu-item', { onclick: () => { closePops(); setView('mcp'); } }, ic('plus'), L('Adicionar conector MCP')));
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
    el.title = r.status === 'loading' ? L('Localizando no computador...') : r.status === 'missing' ? L('Não encontrei este arquivo. Clique para resolver.') : r.status === 'choose' ? L('Há mais de um arquivo com este nome. Clique para escolher.') : r.path;
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
        h('small', null, [o.exact ? L('mesmo tamanho e data') : L('mesmo nome'), o.size != null && !r.dir ? fmtSize(o.size) : null, o.mtime ? new Date(o.mtime).toLocaleString(LOCALE) : null].filter(Boolean).join(', '))));
    }
  }
  const body = [
    h('p', { style: { marginTop: 0, color: 'var(--text-2)' } },
      r.status === 'missing' ? L('Não encontrei "{0}" nas pastas comuns nem no índice de pesquisa do Windows.', r.name)
        : r.status === 'choose' ? L('Há mais de um "{0}" no computador. Qual deles?', r.name) : r.path),
    list.childElementCount ? list : null,
  ];
  const foot = [
    h('button.btn.danger', { style: { marginRight: 'auto' }, onclick: () => { refPillEls(r).forEach((el) => el.remove()); S.refs = S.refs.filter((x) => x !== r); m.close(); updatePickers(); } }, L('Remover da mensagem')),
    h('button.btn', { onclick: async () => {
      const p = await promptBox(L('Caminho do arquivo'), L('Cole o caminho completo de "{0}"', r.name), r.path || '', L('Usar'));
      if (!p) return;
      const st = await api('/api/stat', { path: p.replace(/^"|"$/g, ''), ws: S.ws.path });
      if (!st.exists) { toast(L('Esse caminho não existe.'), 'err'); return; }
      r.path = st.path; r.dir = st.dir; r.status = 'ok'; r.name = basename(st.path); remember(r); done();
    } }, L('Informar caminho')),
    r.file && r.status !== 'ok' ? h('button.btn.primary', { onclick: async () => {
      try {
        r.status = 'loading'; done();
        const res = await api('/api/ws/upload?name=' + encodeURIComponent(r.name) + '&ws=' + encodeURIComponent(S.ws.path), r.file);
        r.path = res.path; r.status = 'ok'; r.file = null; updateRefPill(r); refreshTree();
        toast(L('Copiado para a pasta anexos do espaço de trabalho'));
      } catch (e) { r.status = 'missing'; updateRefPill(r); toast(e.message, 'err'); }
    } }, L('Copiar para o espaço de trabalho')) : null,
  ];
  m = modal({ title: r.name || L('Arquivo'), body, foot });
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
  const name = L('colada-{0}{1}{2}-{3}{4}{5}.{6}', d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate()), pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds()), ext);
  const r = addRef({ name, status: 'loading' });
  const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(file); });
  try {
    const up = await api('/api/ws/upload?name=' + encodeURIComponent(name) + '&ws=' + encodeURIComponent(S.ws.path), file);
    r.path = up.path; r.name = basename(up.path); r.status = 'ok';
    if (data) S.imgData.set(up.path, data);
    refreshTree();
    const seer = seerFor(cur());
    if (seer) toast(L('O modelo da conversa não enxerga imagens: {0} vai descrevê-la para ele.', apiLabel(seer)));
    else if (!visionOn()) toast(L('Imagem salva em anexos. O modelo atual não enxerga imagens: ele recebe só o caminho.'));
  } catch (e) { r.status = 'missing'; toast(L('Não consegui salvar a imagem: ') + e.message, 'err'); }
  updateRefPill(r); updatePickers();
}
/* ---- imagens no modo API: uma API que enxerga descreve para a que não enxerga ---- */
/** API que aceita imagens para descrever pela conversa: as da equipe primeiro, depois qualquer pronta. */
/** Fila de quem enxerga: as APIs com "Aceita imagens" (a ordem da equipe de exploradores primeiro), sem as
 *  que estão esfriando depois de um erro. */
function visionQueue(exceptId) {
  const ids = [...new Set([...apiForAll('explorer'), ...(S.info.apis || []).filter((a) => a.ready).map((a) => a.id)])];
  return ids.map(apiById).filter((a) => a?.ready && a.vision && a.id !== exceptId && !apiCooled(a.id));
}
function visionApi(exceptId) { return visionQueue(exceptId)[0] || null; }
/** O modelo da conversa (local ou API) não enxerga, e alguma API enxerga. */
function seerFor(conv) {
  if (visionOn(conv)) return null;
  return visionApi(mainApiForChat(conv)?.id);
}

/** Pergunta sobre uma imagem a um modelo com visão, trocando de API se uma falhar. Devolve { text, by }. */
async function askVision(url, ask, signal, exceptId) {
  const queue = visionQueue(exceptId);
  if (!queue.length) throw new Error(L('Nenhuma API com visão pronta: marque "Aceita imagens" numa API em Configurações › API externa.'));
  let last;
  for (const api of queue) {
    const out = { content: '', reasoning: '', tool_calls: [] };
    try {
      await streamApi([{ role: 'user', content: [{ type: 'text', text: ask }, { type: 'image_url', image_url: { url } }] }], [], out, signal, null, { _p: api.id, _bg: true, _timeout: 120000 });
      const text = splitThink(out.content).text.trim();
      if (text) return { text, by: `${apiLabel(api)} · ${api.model}` };
      last = new Error(L('{0} não devolveu texto.', apiLabel(api)));
    } catch (e) {
      if (signal?.aborted) throw e;
      last = e;
      apiCool?.(api.id);
    }
  }
  throw last || new Error(L('Nenhuma API conseguiu olhar a imagem.'));
}
const DESCRIBE_IMG = L('Descreva esta imagem para um assistente que não consegue vê-la e vai trabalhar a partir da sua descrição. Transcreva exatamente todo texto visível (código, erros, números, nomes de arquivos, menus). Descreva o layout, os elementos importantes, cores quando importarem e o que parece estar acontecendo. Seja completo e objetivo, sem opinião e sem introdução.');
/** Antes do primeiro passo: as imagens da última mensagem viram texto (guardado na mensagem, vale para o resto da conversa). */
async function describeImgs(conv, signal) {
  const seer = seerFor(conv);
  if (!seer) return;
  const m = [...conv.messages].reverse().find((x) => x.role === 'user' && !x.hidden);
  const todo = (m?.refs || []).filter(isImgRef).filter((r) => !m.imgDesc?.[r.path]?.text);
  if (!todo.length) return;
  m.imgDesc ||= {};
  conv._waitingModel = true; conv._waitText = L('{0} está olhando a imagem para o modelo da conversa...', apiLabel(seer)); scheduleRender();
  const except = mainApiForChat(conv)?.id;
  try {
    await Promise.all(todo.map(async (r) => {
      const url = await loadImg(r.path, wsOf(conv));
      if (!url) return;
      const ask = DESCRIBE_IMG + (String(m.content || '').trim() ? '\n\n' + L('O pedido do usuário junto com a imagem (foque no que importa para ele): {0}', String(m.content).slice(0, 600)) : '');
      try {
        m.imgDesc[r.path] = await askVision(url, ask, signal, except);
      } catch (e) {
        if (signal?.aborted) throw e;
        m.imgDesc[r.path] = { by: apiLabel(seer), err: String(e.message || e).slice(0, 200) };
      }
    }));
  } finally {
    conv._waitingModel = false; conv._waitText = ''; saveConvs(); scheduleRender();
  }
}
/** Carrega as imagens da última mensagem do usuário antes de mandar ao modelo. */
async function preloadImgs(conv) {
  if (!visionOn(conv)) return;
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

/* ------------------------------------------------------------ prompts salvos (/atalho) */
// Textos prontos com campos {{nome}} ou {{nome=padrão}}: ao usar, um formulário pede os campos e o texto
// entra na mensagem. Ficam no armazenamento da interface (que tem cópia no servidor).
const PROMPT_VAR = /\{\{\s*([^{}=]+?)\s*(?:=([^{}]*))?\}\}/g;

function seedPrompts() {
  return [
    { id: 'corte-live', title: L('Corte de live'), text: L('Faça um corte de live de {{arquivo}} para {{destino=Shorts, Reels e TikTok}}: o melhor momento, contado do começo ao fim, entre {{duração=40 e 120}} segundos, vertical 9:16. Siga a skill editor-de-video (receita de corte de live). Me mostre o roteiro e já monte.') },
    { id: 'melhores-momentos', title: L('Melhores momentos de gameplay'), text: L('Short vertical 9:16 de {{duração=45 a 60}} segundos com os melhores momentos de {{tipo=ação}} do meu gameplay de {{jogo}} em {{arquivo}}. Siga a skill editor-de-video. Gancho forte nos 2 primeiros segundos, sem cutSilences e "PARTE 2?" no final.') },
    { id: 'miniatura', title: L('Miniatura'), text: L('Faça a miniatura do corte {{corte}}: o quadro mais expressivo, texto de até 4 palavras e formato {{formato=9:16}}.') },
  ];
}
let PROMPTS = (() => { const v = store.get('prompts', null); if (Array.isArray(v)) return v; const s = seedPrompts(); store.set('prompts', s); return s; })();
function savePrompts() { store.set('prompts', PROMPTS); }
const promptSlug = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

function promptItems(q) {
  const f = promptSlug(q);
  return PROMPTS.filter((p) => !f || p.id.includes(f) || promptSlug(p.title).includes(f))
    .slice(0, 12).map((p) => ({ kind: 'prompt', id: p.id, name: p.title, desc: p.text.replace(/\s+/g, ' ').slice(0, 90), prompt: p }));
}

function promptVars(text) {
  const out = [];
  for (const m of String(text).matchAll(PROMPT_VAR)) if (!out.some((v) => v.name === m[1].trim())) out.push({ name: m[1].trim(), def: (m[2] || '').trim() });
  return out;
}

async function usePrompt(p) {
  const vars = promptVars(p.text);
  let text = p.text;
  if (vars.length) {
    const vals = await new Promise((resolve) => {
      let done = false;
      const inputs = vars.map((v) => h('input.input', { value: v.def, placeholder: v.def || v.name }));
      const ok = () => { done = true; m.close(); resolve(inputs.map((i) => i.value.trim())); };
      inputs.forEach((i, k) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (k + 1 < inputs.length) inputs[k + 1].focus(); else ok(); } }));
      const m = modal({
        title: p.title,
        body: h('div.form', null, vars.map((v, k) => h('div.field', null, h('label', null, v.name), inputs[k]))),
        foot: [h('button.btn', { onclick: () => m.close() }, L('Cancelar')), h('button.btn.primary', { onclick: ok }, L('Usar'))],
        onClose: () => { if (!done) resolve(null); },
      });
    });
    if (!vals) return;
    const by = Object.fromEntries(vars.map((v, k) => [v.name, vals[k] || v.def]));
    text = text.replace(PROMPT_VAR, (_, n) => by[n.trim()] ?? '');
  }
  if (!editor().textContent.trim()) setEditorText(text);
  else { focusEditor(true); document.execCommand('insertText', false, text); }
  updateSendBtn();
}

function editPrompt(p, onDone) {
  const isNew = !p || !p.id;
  p = p ? { ...p } : { id: '', title: '', text: '' };
  const title = h('input.input', { value: p.title, placeholder: L('Ex.: Corte de live') });
  const slug = h('input.input.mono', { value: p.id, placeholder: 'corte-live' });
  const text = h('textarea.input', { rows: 12, value: p.text, placeholder: L('O texto do prompt. Campos a preencher: {{arquivo}} ou {{duração=45 a 60}} (com valor padrão).') });
  title.addEventListener('input', () => { if (!slug.dataset.touched && isNew) slug.value = promptSlug(title.value); });
  slug.addEventListener('input', () => { slug.dataset.touched = '1'; });
  const m = modal({
    title: isNew ? L('Novo prompt') : L('Editar prompt'), wide: true,
    body: h('div.form', null,
      h('div.field', null, h('label', null, L('Nome')), title),
      h('div.field', null, h('label', null, L('Atalho (digite / e o atalho no começo da mensagem)')), slug),
      h('div.field', null, h('label', null, L('Texto')), text),
      h('small.muted', null, L('Campos entre chaves duplas viram um formulário ao usar: {{jogo}}, {{arquivo}}, {{duração=45 a 60}}.'))),
    foot: [h('button.btn', { onclick: () => m.close() }, L('Cancelar')), h('button.btn.primary', { onclick: () => {
      const id = promptSlug(slug.value || title.value);
      if (!id || !text.value.trim()) { toast(L('Dê um nome e escreva o texto.'), 'err'); return; }
      if (PROMPTS.some((x) => x.id === id && x.id !== p.id)) { toast(L('Já existe um prompt com o atalho /{0}.', id), 'err'); return; }
      const item = { id, title: title.value.trim() || id, text: text.value.trim() };
      const i = isNew ? -1 : PROMPTS.findIndex((x) => x.id === p.id);
      if (i >= 0) PROMPTS[i] = item; else PROMPTS.unshift(item);
      savePrompts(); m.close(); toast(L('Prompt salvo: /{0}', id)); onDone?.();
    } }, L('Salvar'))],
  });
}

function managePrompts() {
  const list = h('div.prompt-list');
  const draw = () => {
    list.innerHTML = '';
    if (!PROMPTS.length) list.append(h('div.muted', null, L('Nenhum prompt salvo.')));
    for (const p of PROMPTS) {
      list.append(h('div.prompt-row', null,
        h('div.pr-main', null, h('b', null, p.title), h('code', null, '/' + p.id), h('small.muted', null, p.text.replace(/\s+/g, ' ').slice(0, 140))),
        h('button.btn.sm', { onclick: () => { m.close(); usePrompt(p); } }, L('Usar')),
        h('button.icon-btn.sm', { title: L('Editar'), 'aria-label': L('Editar'), html: svg('edit'), onclick: () => editPrompt(p, draw) }),
        h('button.icon-btn.sm', { title: L('Apagar'), 'aria-label': L('Apagar'), html: svg('trash'), onclick: async () => {
          if (!(await confirmBox(L('Apagar o prompt "{0}"?', p.title), L('Apagar'), true))) return;
          PROMPTS = PROMPTS.filter((x) => x !== p); savePrompts(); draw();
        } })));
    }
  };
  const m = modal({
    title: L('Prompts salvos'), wide: true,
    body: h('div', null, h('p.muted.small', null, L('Digite / no começo da mensagem para usar um prompt. Campos {{assim}} viram um formulário.')), list),
    foot: [h('button.btn', { onclick: () => editPrompt(null, draw) }, ic('plus'), L('Novo prompt')), h('span.spacer'), h('button.btn', { onclick: () => m.close() }, L('Fechar'))],
  });
  draw();
}

/* ------------------------------------------------------------ ditado por voz */
// Grava o microfone em PCM (Web Audio), converte para WAV 16 kHz mono e o studio transcreve com o
// whisper.cpp no próprio PC. O texto entra onde está o cursor. Clique de novo (ou Esc) para parar.
const VOICE = { on: false, busy: false, ctx: null, stream: null, node: null, chunks: [], rate: 48000, t0: 0, timer: 0 };

function initDictation() {
  const b = $('#mic');
  if (!b) return;
  b.innerHTML = svg('mic');
  drawMic();
  b.addEventListener('click', () => (VOICE.on ? stopDictation() : startDictation()));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && VOICE.on) stopDictation(true); });
}

function drawMic() {
  const b = $('#mic');
  if (!b) return;
  b.classList.toggle('rec', VOICE.on);
  b.classList.toggle('busy', VOICE.busy);
  b.disabled = VOICE.busy;
  const secs = VOICE.on ? Math.round((Date.now() - VOICE.t0) / 1000) : 0;
  b.title = VOICE.busy ? L('Transcrevendo...') : VOICE.on ? L('Gravando ({0}s): clique para parar e transcrever, Esc para cancelar', secs) : L('Ditar por voz (transcrito no seu PC com o Whisper)');
  b.setAttribute('aria-label', b.title);
}

async function startDictation() {
  if (VOICE.busy) return;
  let st;
  try { st = await (await fetch('/api/dictate/status', { headers: { 'x-studio': '1' } })).json(); } catch { st = null; }
  if (st && (!st.installed || !st.models?.length)) { if (!(await setupDictation(st))) return; }
  try {
    VOICE.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (e) { toast(L('Não consegui usar o microfone: {0}', e.message), 'err'); return; }
  VOICE.ctx = new (window.AudioContext || window.webkitAudioContext)();
  VOICE.rate = VOICE.ctx.sampleRate;
  const src = VOICE.ctx.createMediaStreamSource(VOICE.stream);
  VOICE.node = VOICE.ctx.createScriptProcessor(4096, 1, 1);
  VOICE.chunks = [];
  VOICE.node.onaudioprocess = (e) => { if (VOICE.on) VOICE.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
  src.connect(VOICE.node); VOICE.node.connect(VOICE.ctx.destination);
  VOICE.on = true; VOICE.t0 = Date.now();
  VOICE.timer = setInterval(() => { drawMic(); if (Date.now() - VOICE.t0 > 5 * 60 * 1000) stopDictation(); }, 1000);
  drawMic();
}

async function stopDictation(cancel) {
  if (!VOICE.on) return;
  VOICE.on = false; clearInterval(VOICE.timer);
  try { VOICE.node.disconnect(); } catch { /* já desligado */ }
  VOICE.stream?.getTracks().forEach((t) => t.stop());
  VOICE.ctx?.close().catch(() => {});
  const chunks = VOICE.chunks; VOICE.chunks = [];
  if (cancel) { drawMic(); return; }
  const wav = encodeWav16k(chunks, VOICE.rate);
  if (!wav) { drawMic(); toast(L('Nada gravado.')); return; }
  VOICE.busy = true; drawMic();
  try {
    const lang = S.settings.whisperLang ?? (LANG === 'en' ? 'en' : 'pt');
    const res = await fetch(`/api/dictate?lang=${encodeURIComponent(lang)}&model=${encodeURIComponent(S.settings.dictModel || '')}`, { method: 'POST', headers: { 'x-studio': '1', 'content-type': 'audio/wav' }, body: wav });
    const r = await res.json();
    if (!res.ok || r.error) throw new Error(r.error || res.statusText);
    if (r.needSetup) { toast(L('O Whisper não está instalado.'), 'err'); return; }
    const text = String(r.text || '').trim();
    if (!text) { toast(L('Não entendi nada. Tente falar mais perto do microfone.')); return; }
    focusEditor(true);
    const before = editor().textContent;
    document.execCommand('insertText', false, (before && !/\s$/.test(before) ? ' ' : '') + text);
    updateSendBtn();
  } catch (e) { toast(L('O ditado falhou: {0}', e.message), 'err'); }
  finally { VOICE.busy = false; drawMic(); }
}

/** Float32 na taxa do microfone → WAV PCM 16 bits, 16 kHz, mono (média simples por janela). */
function encodeWav16k(chunks, rate) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  if (total < rate * 0.3) return null;
  const ratio = rate / 16000;
  const n = Math.floor(total / ratio);
  const out = new Int16Array(n);
  let ci = 0, off = 0, acc = 0, cnt = 0, oi = 0, pos = 0, next = ratio;
  while (ci < chunks.length && oi < n) {
    const c = chunks[ci];
    acc += c[off]; cnt++; pos++;
    if (pos >= next) { const v = Math.max(-1, Math.min(1, acc / cnt)); out[oi++] = v < 0 ? v * 0x8000 : v * 0x7fff; acc = 0; cnt = 0; next += ratio; }
    if (++off >= c.length) { off = 0; ci++; }
  }
  const buf = new ArrayBuffer(44 + oi * 2);
  const dv = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + oi * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 16000, true);
  dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, oi * 2, true);
  new Int16Array(buf, 44, oi).set(out.subarray(0, oi));
  return buf;
}

/** Primeira vez: baixa o Whisper e um modelo (no Windows); em outro sistema, explica como instalar. */
async function setupDictation(st) {
  if (!st.canSetup && !st.installed) { toast(L('O Whisper ainda não está instalado: gere uma legenda uma vez na página Vídeos e o ditado passa a funcionar.'), 'err'); return false; }
  const model = 'base';
  if (!(await confirmBox(L('O ditado usa o Whisper no seu PC. Na primeira vez ele baixa o programa e o modelo de fala "{0}" (cerca de 150 MB). Baixar agora?', model), L('Baixar')))) return false;
  VOICE.busy = true; drawMic();
  toast(L('Baixando o Whisper... (alguns minutos)'));
  try {
    const r = await fetch('/api/dictate/setup', { method: 'POST', headers: { 'x-studio': '1', 'content-type': 'application/json' }, body: JSON.stringify({ model }) });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || r.statusText);
    toast(L('Whisper pronto. Clique no microfone para ditar.'));
    return false;
  } catch (e) { toast(L('Não consegui baixar o Whisper: {0}', e.message), 'err'); return false; }
  finally { VOICE.busy = false; drawMic(); }
}

/** analyze_image: uma pergunta sobre uma imagem do projeto. Se o modelo da conversa enxerga, a imagem vai para
 *  ele junto do resultado; senão, a fila de APIs com visão olha e responde em texto. */
async function runAnalyzeImage(args, tctx, tmsg) {
  const path = String(args.path || '').trim();
  if (!IMG_RE.test(path)) return { content: L('Passe o caminho de uma imagem (png, jpg, gif, webp ou bmp).'), isError: true };
  const conv = tctx?.conv || cur();
  const url = await loadImg(path, wsOf(conv));
  if (!url) return { content: L('Não consegui abrir a imagem {0}.', path), isError: true };
  if (tmsg) tmsg._images = [url];
  const q = String(args.question || '').trim();
  if (visionOn(conv) && !visionQueue(mainApiForChat(conv)?.id).length) {
    return { content: L('Imagem {0} anexada abaixo.', path) + (q ? ' ' + L('Pergunta: {0}', q) : ''), isError: false, images: [url] };
  }
  if (tmsg) { tmsg.phase = L('Um modelo com visão está olhando a imagem...'); scheduleRender(); }
  try {
    const ask = q ? L('Olhe a imagem e responda com precisão, transcrevendo exatamente qualquer texto relevante: {0}', q) : DESCRIBE_IMG;
    const r = await askVision(url, ask, tctx?.signal, mainApiForChat(conv)?.id);
    return { content: L('Resposta de {0} sobre {1}:', r.by, path) + '\n\n' + r.text, isError: false };
  } catch (e) {
    return { content: String(e.message || e), isError: true };
  } finally { if (tmsg) tmsg.phase = ''; }
}
