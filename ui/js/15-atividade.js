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

const ACT_FILTERS = [['all', L('Tudo')], ['tools', L('Ferramentas')], ['err', L('Erros')], ['reread', L('Releituras')]];
function drawActivity() {
  const box = $('#ws-activity'); if (!box || box.hidden) return;
  const c = cur();
  const keep = box.scrollTop; const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = '';
  if (!c || !c.messages.length) { box.append(h('div.act-empty', null, ic('list'), L('Os passos do modelo (raciocínio, ferramentas, respostas) desta conversa aparecem aqui conforme ele trabalha.'))); return; }
  box.append(h('div.ws-scope', null, ic('list'), L('Atividade de "{0}"', clipText(c.title, 40))));
  const filt = S.actFilter || 'all';
  const show = (kind) => filt === 'all' || filt === kind;
  const blocks = blocksOf(c);
  const n = { tools: 0, err: 0, msTools: 0, msModel: 0, msAudit: 0, re: 0, reTok: 0, api: 0, apiTok: 0, gen: 0 };
  const list = h('div.act');
  const errLine = (r) => String(r?.content || '').split('\n').map((x) => x.trim()).find(Boolean)?.slice(0, 160) || '';
  blocks.forEach((b, bi) => {
    if (b.type === 'user') {
      const m = b.msgs[0];
      // duração do turno: do primeiro passo do modelo ao último
      const ai = blocks[bi + 1]?.type === 'ai' ? blocks[bi + 1].msgs.filter((x) => x.role === 'assistant') : [];
      const dur = ai.length && ai[0].t0 && ai[ai.length - 1].t1 ? ai[ai.length - 1].t1 - ai[0].t0 : 0;
      list.append(h('button.act-user', { onclick: () => jumpTo(b.start) },
        h('span.act-time', null, fmtStamp(m.ts).slice(11), dur > 1500 ? h('span.act-dur', null, ' · ' + fmtMs(dur)) : null),
        h('span.act-u', null, plainOf(m).replace(/\s+/g, ' ').slice(0, 140))));
      return;
    }
    if (b.type === 'notice') { if (show('all') && filt === 'all') list.append(h('button.act-row', { onclick: () => jumpTo(b.start) }, h('span.act-ico', { html: svg(b.msgs[0].icon || 'arrowUp') }), h('span.act-main', null, h('span.act-name', null, L('Studio')), h('span.act-sub.wrap', null, b.msgs[0].content)))); return; }
    if (b.type === 'error') { n.err++; if (show('err') || filt === 'tools') list.append(h('button.act-row.err', { onclick: () => jumpTo(b.start) }, h('span.act-ico', { html: svg('alert') }), h('span.act-main', null, h('span.act-name', null, L('Erro')), h('span.act-sub.wrap', null, String(b.msgs[0].content).slice(0, 200))))); return; }
    const live = bi === blocks.length - 1 && running(c);
    const results = new Map(b.msgs.filter((m) => m.role === 'tool').map((m) => [m.tool_call_id, m]));
    const asts = b.msgs.filter((m) => m.role === 'assistant');
    asts.forEach((m) => {
      const sp = splitThink(m.content);
      const think = (m.reasoning || '') + (sp.think || '');
      // o passo do modelo: quanto leu (e do cache), quanto pensou e gerou, quanto levou
      const dur = m.t0 && m.t1 ? m.t1 - m.t0 : 0;
      n.msModel += dur; n.gen += m.tokens || 0;
      const pp = m.pp; const read = pp ? Math.max(0, pp.total - pp.cache) : 0;
      const re = !!(pp && pp.why && read > Math.max(2000, pp.total * 0.3));
      if (re) { n.re++; n.reTok += read; }
      if (show('reread') && (filt !== 'reread' || re) && (dur || pp)) {
        const bits = [];
        if (pp) bits.push(pp.cache ? L('leu {0} novos ({1} do cache)', fmtK(read), fmtK(pp.cache)) : L('leu {0}', fmtK(read)));
        if (think.trim()) bits.push(L('pensou {0} palavras', think.trim().split(/\s+/).length));
        if (m.tokens) bits.push(L('gerou {0}', fmtK(m.tokens)) + (m.tps ? ` · ${m.tps.toFixed(1)} tok/s` : ''));
        list.append(h('button.act-row.k-model' + (re ? '.reread' : ''), { onclick: () => jumpTo(b.start), title: re ? L('Releu porque {0}', pp.why) : '' },
          h('span.act-ico', { html: svg(re ? 'refresh' : 'brain') }),
          h('span.act-main', null, h('span.act-name', null, re ? L('Modelo · releu o contexto') : L('Modelo')), h('span.act-sub', null, bits.join(' · ')),
            re ? h('span.act-why', null, L('porque {0}', pp.why)) : null),
          h('span.act-st', null, dur ? fmtMs(dur) : '')));
      }
      if (filt === 'all' && sp.text.trim() && m.tool_calls?.length) list.append(h('button.act-row.k-say', { onclick: () => jumpTo(b.start) }, h('span.act-ico', { html: svg('chat') }), h('span.act-main', null, h('span.act-name', null, L('Comentário')), h('span.act-sub', null, sp.text.trim().replace(/\s+/g, ' ').slice(0, 120)))));
      // ferramentas do passo; mais de uma = pedidas juntas (leituras e exploradores rodam em paralelo)
      const calls = m.tool_calls || [];
      const holder = calls.length > 1 && (filt === 'all' || filt === 'tools') ? h('div.act-par', null, h('span.act-par-lbl', null, L('{0} no mesmo passo', calls.length))) : null;
      for (const tc of calls) {
        const r = results.get(tc.id); const name = tc.function?.name || '?';
        const st = r ? r.status || (r.isError ? 'error' : 'ok') : (live ? 'running' : 'error');
        const bad = st === 'error' || st === 'denied';
        n.tools++; if (bad) n.err++; if (r?.ms) n.msTools += r.ms;
        if (r?.audit && !r.audit.rule) { n.msAudit += r.audit.ms || 0; if (r.audit.via) n.api++; }
        if (r?.runOn?.api) { n.api++; n.apiTok += r.apiTokens || 0; }
        if (!(filt === 'all' || filt === 'tools' || (filt === 'err' && bad))) continue;
        const src = r?.source || (name.includes('__') ? 'mcp' : 'builtin');
        const nm = src === 'mcp' && name.includes('__') ? name.slice(name.indexOf('__') + 2) : name;
        const busy = st === 'running' || st === 'pending' || st === 'audit';
        const badges = [];
        if (r?.runOn) badges.push(h('span.act-badge' + (r.runOn.api ? '.api' : ''), { title: r.runOn.api ? L('Rodou pela API {0} ({1})', r.runOn.api, r.runOn.model) : '' }, r.runOn.api ? `${r.runOn.api}${r.apiTokens ? ' · ' + fmtK(r.apiTokens) : ''}` : r.runOn.fell ? L('local (API falhou)') : L('local')));
        if (r?.audit) badges.push(h('span.act-badge' + (r.audit.approve ? '.ok' : '.bad'), { title: r.audit.reason || '' }, ic('shield'),
          r.audit.rule ? L('regra') : `${r.audit.risk || ''}${r.audit.via ? ' · API' : r.audit.slot != null ? ' · slot ' + r.audit.slot : ''}${r.audit.ms ? ' · ' + fmtMs(r.audit.ms) : ''}`));
        const subs = r?._sub?.length ? r._sub : r?.sub || [];
        const row = h('button.act-row.k-tool.s-' + st, { onclick: () => jumpTo(b.start, tc.id), title: name },
          h('span.act-ico', { html: svg(busy ? 'loader' : toolIcon(name, src), busy ? 'spin' : '') }),
          h('span.act-main', null,
            h('span.act-name', null, nm),
            h('span.act-sub', null, toolSummary(name, parseArgs(tc.function?.arguments)) || ''),
            badges.length ? h('span.act-badges', null, badges) : null,
            bad && r ? h('span.act-err', null, errLine(r)) : null,
            subs.length ? h('span.act-subs', null, subs.slice(0, 8).map((x) => h('span.act-subs-i.s-' + x.status, null, x.name)), subs.length > 8 ? h('span.act-subs-i', null, '+' + (subs.length - 8)) : null) : null),
          h('span.act-st', null, st === 'ok' ? (r?.ms != null ? fmtMs(r.ms) : '') : st === 'error' ? L('erro') : st === 'denied' ? L('negada') : st === 'approval' ? L('aguarda') : st === 'audit' ? L('auditando') : ''));
        (holder || list).append(row);
      }
      if (holder && holder.children.length > 1) list.append(holder);
      if (filt === 'all' && sp.text.trim() && !calls.length) list.append(h('button.act-row.k-answer', { onclick: () => jumpTo(b.start) }, h('span.act-ico', { html: svg('check') }), h('span.act-main', null, h('span.act-name', null, L('Resposta')), h('span.act-sub', null, sp.text.trim().replace(/\s+/g, ' ').slice(0, 120)))));
    });
    if (live) list.append(h('div.act-row.k-live', null, h('span.act-ico', { html: svg('loader', 'spin') }), h('span.act-main', null, h('span.act-name', null, c._waitingModel ? L('Esperando o modelo') : L('Trabalhando...')))));
  });
  const stat = (big, label, cls, title) => h('div', { class: cls || '', title: title || '' }, h('b', null, big), h('span', null, label));
  box.append(h('div.act-stats', null,
    stat(String(n.tools), n.err ? L('ferramentas · {0} com erro', n.err) : L('ferramentas'), n.err ? 'bad' : ''),
    stat(fmtMs(n.msModel), L('modelo · {0} ferramentas', fmtMs(n.msTools)) + (n.msAudit ? L(' · {0} auditor', fmtMs(n.msAudit)) : ''), '', L('Tempo do modelo lendo e escrevendo; das ferramentas rodando; do auditor decidindo')),
    stat(String(n.re), n.re ? L('releituras · {0} tokens', fmtK(n.reTok)) : L('releituras'), n.re ? 'warn' : '', L('Vezes em que o servidor teve que reler boa parte da conversa')),
    n.api ? stat(String(n.api), L('usos de API') + (n.apiTok ? ` · ${fmtK(n.apiTok)}` : ''), 'api') : stat(fmtK(n.gen), L('tokens gerados'))));
  box.append(h('div.act-filter', null, ACT_FILTERS.map(([k, label]) => h('button' + (filt === k ? '.on' : ''), { type: 'button', onclick: () => { S.actFilter = k; drawActivity(); } },
    label, k === 'err' && n.err ? h('span.act-fn', null, String(n.err)) : k === 'reread' && n.re ? h('span.act-fn', null, String(n.re)) : null))));
  const chg = filt === 'all' ? changesSection(c) : null;
  if (chg) box.append(chg);
  box.append(list.children.length ? list : h('div.act-empty.small', null, filt === 'err' ? L('Nenhum erro nesta conversa.') : filt === 'reread' ? L('Nenhuma releitura grande nesta conversa.') : L('Nada aqui ainda.')));
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
