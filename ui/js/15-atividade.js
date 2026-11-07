/* llama studio - alterações, telas estreitas e aba Atividade */
'use strict';

/* ------------------------------------------------------------ alterações (aba Atividade) */
// Arquivos que a conversa alterou, a partir dos pontos de restauração: diff do estado
// original até agora, desfazer por arquivo ou tudo, abrir e ir para a ferramenta.
S.chg = { conv: '', key: '', list: {}, loading: false, open: new Set(), diffs: new Map(), section: store.get('chgOpen', true) };
function chgKey(c) { return c.id + ':' + c.messages.reduce((n, m) => n + (m.cps?.length || 0) * 2 + (m.undone ? 1 : 0), 0); }
async function refreshChanges(c, force) {
  const key = chgKey(c);
  if (!force && (S.chg.key === key || S.chg.loading)) return;
  S.chg.loading = true;
  try {
    const list = await api('/api/checkpoints', { conv: c.id });
    S.chg.list = list; S.chg.conv = c.id; S.chg.key = key; S.chg.diffs.clear();
    // ações cujos pontos já foram desfeitos (por arquivo) contam como desfeitas
    let changed = false;
    for (const m of c.messages) if (m.cps?.length && !m.undone && !m.cps.some((id) => list[id])) { m.undone = true; changed = true; }
    if (changed) { saveConvs(); scheduleRender(); S.chg.key = chgKey(c); }
  } catch { /* sem pontos */ }
  S.chg.loading = false;
  drawActivitySoon();
}
function chgGroups(c) {
  if (S.chg.conv !== c.id) return [];
  const by = new Map();
  for (const [id, v] of Object.entries(S.chg.list)) {
    const p = String(v.path || '');
    if (!by.has(p)) by.set(p, []);
    by.get(p).push({ id, ...v });
  }
  return [...by.entries()].map(([path, items]) => {
    items.sort((a, b) => (a.at || 0) - (b.at || 0));
    return { path, items, first: items[0], last: items[items.length - 1] };
  }).sort((a, b) => (b.last.at || 0) - (a.last.at || 0));
}
/** Diff de linhas (LCS) com trechos de contexto. */
function lineDiff(a, b) {
  const A = a.split('\n'); const B = b.split('\n');
  let pre = 0; while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0; while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const a2 = A.slice(pre, A.length - suf); const b2 = B.slice(pre, B.length - suf);
  const ops = A.slice(0, pre).map((l) => [' ', l]);
  if (a2.length * b2.length > 4e6) { a2.forEach((l) => ops.push(['-', l])); b2.forEach((l) => ops.push(['+', l])); }
  else {
    const n = a2.length; const m = b2.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a2[i] === b2[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0; let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a2[i] === b2[j]) { ops.push([' ', a2[i]]); i++; j++; }
      else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) { ops.push(['-', a2[i]]); i++; }
      else { ops.push(['+', b2[j]]); j++; }
    }
  }
  A.slice(A.length - suf).forEach((l) => ops.push([' ', l]));
  return ops;
}
function diffEl(ops, ctx = 2) {
  const box = h('div.diff');
  const keep = ops.map(() => false);
  ops.forEach((o, i) => { if (o[0] !== ' ') for (let k = Math.max(0, i - ctx); k <= Math.min(ops.length - 1, i + ctx); k++) keep[k] = true; });
  let gap = false;
  ops.forEach((o, i) => {
    if (!keep[i]) { if (!gap) { box.append(h('div.gap', null, '⋯')); gap = true; } return; }
    gap = false;
    box.append(h('div' + (o[0] === '-' ? '.del' : o[0] === '+' ? '.add' : '.ctx'), null, o[1] || ' '));
  });
  return box;
}
function chgOwner(c, id) { return c.messages.find((m) => m.role === 'tool' && m.cps?.includes(id)); }
function jumpToTool(c, tmsg) {
  if (!tmsg) return;
  const i = c.messages.indexOf(tmsg);
  const b = blocksOf(c).filter((x) => x.start <= i).pop();
  if (b) jumpTo(b.start, tmsg.tool_call_id);
}
async function undoChange(c, g) {
  const ids = [...g.items].reverse().map((x) => x.id);
  try {
    const r = await api('/api/checkpoints/undo', { conv: c.id, ids });
    if (r.errors.length) toast(L('Não consegui desfazer: ') + r.errors.map((x) => x.error).join('; '), 'err');
    else toast(`${basename(g.path)}: ${g.first.existed ? L('voltou ao original') : L('removido (foi criado pela conversa)')}`);
  } catch (e) { toast(L('Erro: ') + e.message, 'err'); }
  if (wsOf(c) === S.ws.path) refreshTree();
  await refreshChanges(c, true);
}
function changesSection(c) {
  const groups = chgGroups(c);
  if (!groups.length) return null;
  const sec = h('details.chg', { open: S.chg.section });
  listen(sec, 'toggle', () => { S.chg.section = sec.open; store.set('chgOpen', sec.open); });
  sec.append(h('summary.chg-head', null, ic('filePen'), h('span', null, L('Alterações')), h('span.chg-n', null, `${groups.length} ${groups.length === 1 ? L('arquivo') : L('arquivos')}`),
    groups.length > 1 ? h('button.btn.sm', { onclick: async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!(await confirmBox(L('Desfazer as alterações em {0} arquivos? Arquivos criados pela conversa são apagados.', groups.length), L('Desfazer tudo'), true))) return;
      for (const g of groups) await undoChange(c, g);
    } }, L('Desfazer tudo')) : null));
  for (const g of groups) {
    const key = g.first.id + ':' + g.last.id;
    const open = S.chg.open.has(g.path);
    const d = S.chg.diffs.get(key);
    let counts = null;
    if (d?.ops) { const add = d.ops.filter((o) => o[0] === '+').length; const del = d.ops.filter((o) => o[0] === '-').length; counts = h('span.chg-cnt', null, h('b.a', null, '+' + add), h('b.d', null, '−' + del)); }
    const rel = relOf(g.path);
    const item = h('details.chg-file', { open });
    listen(item, 'toggle', () => {
      if (item.open) { S.chg.open.add(g.path); if (!S.chg.diffs.has(key)) loadDiff(c, g, key); } else S.chg.open.delete(g.path);
    });
    item.append(h('summary', { title: g.path },
      h('span', { html: svg(g.first.existed ? 'filePen' : 'plus'), class: 'chg-ico' + (g.first.existed ? '' : ' new') }),
      h('span.chg-name', null, basename(rel), h('small', null, rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')),
      counts || h('span.chg-cnt', null, g.items.length > 1 ? L('{0} vezes', g.items.length) : g.first.existed ? L('editado') : L('novo'))));
    const body = h('div.chg-body');
    if (open) {
      if (!d) { body.append(h('div.chg-note', null, 'Carregando...')); if (!S.chg.diffs.has(key)) loadDiff(c, g, key); }
      else if (d.note) body.append(h('div.chg-note', null, d.note));
      else body.append(diffEl(d.ops));
      const owner = chgOwner(c, g.last.id);
      body.append(h('div.chg-acts', null,
        h('button.btn.sm', { onclick: () => undoChange(c, g) }, ic('history'), g.first.existed ? L('Desfazer') : L('Remover arquivo')),
        d?.exists !== false ? h('button.btn.sm', { onclick: () => api('/api/reveal', { path: g.path, ws: wsOf(c) }).catch((e) => toast(e.message, 'err')) }, ic('external'), L('Mostrar na pasta')) : null,
        owner ? h('button.btn.sm', { onclick: () => jumpToTool(c, owner) }, ic('chat'), L('Ver na conversa')) : null));
    }
    item.append(body);
    sec.append(item);
  }
  return sec;
}
async function loadDiff(c, g, key) {
  S.chg.diffs.set(key, null);
  try {
    const r = await api('/api/checkpoints/diff', { conv: c.id, id: g.first.id });
    const txt = (x) => (x && typeof x.text === 'string' ? x.text : null);
    let v;
    if (r.error) v = { note: r.error };
    else if (r.before?.tooBig || r.after?.tooBig) v = { note: L('Arquivo grande demais para mostrar a diferença.') };
    else if (r.before?.binary || r.after?.binary) v = { note: L('Arquivo binário: a diferença não é mostrada.') };
    else if (r.after?.dir || r.before?.dir) v = { note: L('Pasta criada pela conversa.') };
    else if (r.after === null) v = { note: L('O arquivo não existe mais.'), exists: false };
    else {
      const a = txt(r.before) ?? ''; const b = txt(r.after) ?? '';
      v = a === b ? { note: L('Sem diferença: o arquivo está igual ao original.') } : { ops: lineDiff(a, b) };
    }
    S.chg.diffs.set(key, v);
  } catch (e) { S.chg.diffs.set(key, { note: L('Erro: ') + e.message }); }
  drawActivity();
}

/** Texto de uma mensagem do usuário como ele digitou (etiquetas viram o nome). */
function plainOf(m) {
  if (!m.parts?.length) return m.content || '';
  return m.parts.map((p) => (p.t === 'text' ? p.v : p.t === 'br' ? ' ' : p.name ? `[${p.name}]` : '')).join('');
}

function drawActivity() {
  const box = $('#ws-activity'); if (!box || box.hidden) return;
  const c = cur();
  const keep = box.scrollTop; const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = '';
  if (!c || !c.messages.length) { box.append(h('div.act-empty', null, ic('list'), L('Os passos do modelo (raciocínio, ferramentas, respostas) desta conversa aparecem aqui conforme ele trabalha.'))); return; }
  box.append(h('div.ws-scope', null, ic('list'), L('Atividade de "{0}"', clipText(c.title, 40))));
  const blocks = blocksOf(c);
  let nTools = 0; let nErr = 0; let ms = 0;
  const list = h('div.act');
  blocks.forEach((b, bi) => {
    if (b.type === 'user') {
      const m = b.msgs[0];
      list.append(h('button.act-user', { onclick: () => jumpTo(b.start) }, h('span.act-time', null, fmtStamp(m.ts).slice(11)), h('span.act-u', null, plainOf(m).replace(/\s+/g, ' ').slice(0, 140))));
      return;
    }
    if (b.type === 'notice') { list.append(h('button.act-row', { onclick: () => jumpTo(b.start) }, h('span.act-ico', { html: svg(b.msgs[0].icon || 'arrowUp') }), h('span.act-main', null, h('span.act-name', null, L('Studio')), h('span.act-sub', null, b.msgs[0].content.slice(0, 120))))); return; }
    if (b.type === 'error') { list.append(h('button.act-row.err', { onclick: () => jumpTo(b.start) }, h('span.act-ico', { html: svg('alert') }), h('span.act-main', null, h('span.act-name', null, L('Erro')), h('span.act-sub', null, b.msgs[0].content.slice(0, 120))))); return; }
    const live = bi === blocks.length - 1 && running(c);
    const results = new Map(b.msgs.filter((m) => m.role === 'tool').map((m) => [m.tool_call_id, m]));
    const asts = b.msgs.filter((m) => m.role === 'assistant');
    asts.forEach((m) => {
      const sp = splitThink(m.content);
      const think = (m.reasoning || '') + (sp.think || '');
      if (think.trim()) list.append(h('button.act-row.k-think', { onclick: () => jumpTo(b.start) }, h('span.act-ico', { html: svg('brain') }), h('span.act-main', null, h('span.act-name', null, L('Raciocínio')), h('span.act-sub', null, think.trim().replace(/\s+/g, ' ').slice(0, 90)))));
      if (sp.text.trim() && m.tool_calls?.length) list.append(h('button.act-row.k-say', { onclick: () => jumpTo(b.start) }, h('span.act-ico', { html: svg('chat') }), h('span.act-main', null, h('span.act-name', null, L('Comentário')), h('span.act-sub', null, sp.text.trim().replace(/\s+/g, ' ').slice(0, 90)))));
      for (const tc of m.tool_calls || []) {
        const r = results.get(tc.id); const name = tc.function?.name || '?';
        const st = r ? r.status || (r.isError ? 'error' : 'ok') : (live ? 'running' : 'error');
        nTools++; if (st === 'error' || st === 'denied') nErr++; if (r?.ms) ms += r.ms;
        const src = r?.source || (name.includes('__') ? 'mcp' : 'builtin');
        const nm = src === 'mcp' && name.includes('__') ? name.slice(name.indexOf('__') + 2) : name;
        list.append(h('button.act-row.k-tool.s-' + st, { onclick: () => jumpTo(b.start, tc.id), title: name },
          h('span.act-ico', { html: svg(st === 'running' || st === 'pending' || st === 'audit' ? 'loader' : toolIcon(name, src), st === 'running' || st === 'pending' || st === 'audit' ? 'spin' : '') }),
          h('span.act-main', null, h('span.act-name', null, nm), h('span.act-sub', null, toolSummary(name, parseArgs(tc.function?.arguments)) || '')),
          h('span.act-st', null, st === 'ok' ? (r?.ms != null ? fmtMs(r.ms) : '') : st === 'error' ? L('erro') : st === 'denied' ? L('negada') : st === 'approval' ? L('aguarda') : st === 'audit' ? L('auditando') : '')));
      }
      if (sp.text.trim() && !m.tool_calls?.length) list.append(h('button.act-row.k-answer', { onclick: () => jumpTo(b.start) }, h('span.act-ico', { html: svg('check') }), h('span.act-main', null, h('span.act-name', null, L('Resposta')), h('span.act-sub', null, sp.text.trim().replace(/\s+/g, ' ').slice(0, 90)))));
    });
    if (live) list.append(h('div.act-row.k-live', null, h('span.act-ico', { html: svg('loader', 'spin') }), h('span.act-main', null, h('span.act-name', null, c._waitingModel ? L('Esperando o modelo') : 'Trabalhando...'))));
  });
  box.append(h('div.act-stats', null,
    h('div', null, h('b', null, String(nTools)), h('span', null, L('ferramentas'))),
    h('div', { class: nErr ? 'bad' : '' }, h('b', null, String(nErr)), h('span', null, L('erros'))),
    h('div', null, h('b', null, fmtMs(ms)), h('span', null, L('em ferramentas')))));
  const chg = changesSection(c);
  if (chg) box.append(chg);
  box.append(list);
  if (chgKey(c) !== S.chg.key) refreshChanges(c);
  box.scrollTop = atEnd ? box.scrollHeight : keep;
}

/* ------------------------------------------------------------ telas estreitas */
// Até 1100 px o painel da direita vira gaveta por cima do chat (fechada por padrão);
// até 860 px a barra lateral também, aberta pelo botão de menu.
const MQ_WS = matchMedia('(max-width: 1100px)');
const MQ_SIDE = matchMedia('(max-width: 860px)');
S.wsDrawer = false; S.sideDrawer = false;
function applyLayout() {
  const narrow = MQ_WS.matches;
  const hid = narrow ? !S.wsDrawer : store.get('wsHidden', false);
  $('#ws').classList.toggle('hidden', hid);
  $('#toggle-ws').classList.toggle('on', !hid);
  if (!MQ_SIDE.matches) S.sideDrawer = false;
  document.body.classList.toggle('side-open', S.sideDrawer);
  document.body.classList.toggle('ws-drawer', narrow && S.wsDrawer);
  $('#scrim').hidden = !((narrow && S.wsDrawer) || S.sideDrawer);
}
function toggleWs() {
  if (MQ_WS.matches) S.wsDrawer = !S.wsDrawer;
  else store.set('wsHidden', !store.get('wsHidden', false));
  applyLayout();
}
function toggleSide(open) { S.sideDrawer = open ?? !S.sideDrawer; if (S.sideDrawer) S.wsDrawer = false; applyLayout(); }
function closeDrawers() { if (S.sideDrawer || S.wsDrawer) { S.sideDrawer = false; S.wsDrawer = false; applyLayout(); } }

function initWsTabs() {
  initScrollFollow();
  $$('.ws-tabs button').forEach((b) => b.addEventListener('click', () => setWsTab(b.dataset.tab)));
  setWsTab(store.get('wsTab', 'files'));
}
