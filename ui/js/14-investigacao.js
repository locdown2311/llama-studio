/* llama studio - caderno de investigação, hipóteses e assinaturas */
'use strict';

/* ------------------------------------------------------------ caderno de investigação */
// Cartões por projeto (todas as conversas dele dividem o caderno) ou, fora de projeto, por conversa.
const NB = new Map();
// valores guardados ficam em português (cadernos antigos continuam batendo); a tela mostra no idioma
const NB_STATUS = ['hipótese', 'confirmado', 'descartado'];
const NB_EN = { hypothesis: 'hipótese', confirmed: 'confirmado', discarded: 'descartado' };
const nbStatus = (s) => { const v = String(s || '').toLowerCase(); return NB_EN[v] || (NB_STATUS.includes(v) ? v : 'hipótese'); };
// O caderno é do projeto (todas as conversas dele) ou, fora de projeto, só da conversa.
// Conversas abertas a partir de um cartão (Testar) usam o caderno de onde vieram.
function nbOwner(conv) { return (conv?.nbOf && S.convs.find((x) => x.id === conv.nbOf)) || conv; }
function nbKey(conv) {
  const o = nbOwner(conv); const proj = projectOf(o);
  return proj ? 'proj-' + proj.id : 'conv-' + (o?.id || 'nenhuma');
}
function nbScope(conv) { const proj = projectOf(nbOwner(conv)); return proj ? L('do projeto {0}', proj.name) : L('desta conversa'); }
// versões antigas guardavam um caderno por pasta de trabalho
function nbLegacyKey(conv) { const ws = (wsOf(conv) || 'geral').toLowerCase(); let x = 5381; for (let i = 0; i < ws.length; i++) x = ((x * 33) ^ ws.charCodeAt(i)) >>> 0; return 'ws-' + x.toString(36); }
async function nbLoad(key, conv) {
  if (!NB.has(key)) {
    const r = await api('/api/notebook', { key });
    let cards = Array.isArray(r.cards) ? r.cards : [];
    const nb = { cards, next: r.next || cards.reduce((a, c) => Math.max(a, c.id), 0) + 1 };
    NB.set(key, nb);
    if (!cards.length && !r.migrated && conv && key !== CAL_KEY) {
      // traz do caderno antigo da pasta só os cartões criados nesta conversa (ou nas do projeto)
      try {
        const old = await api('/api/notebook', { key: nbLegacyKey(nbOwner(conv)) });
        const o = nbOwner(conv); const proj = projectOf(o);
        const mine = new Set(proj ? S.convs.filter((x) => x.projectId === proj.id).map((x) => x.id) : [o.id]);
        cards = (old.cards || []).filter((c) => (c.conv ? mine.has(c.conv) : !!proj));
        if (cards.length) { nb.cards = cards; nb.next = cards.reduce((a, c) => Math.max(a, c.id), 0) + 1; await api('/api/notebook/save', { key, cards: nb.cards, next: nb.next }); }
      } catch { /* sem caderno antigo */ }
    }
    return nb;
  }
  return NB.get(key);
}
async function nbSave(key) {
  const nb = NB.get(key); if (!nb) return;
  await api('/api/notebook/save', { key, cards: nb.cards, next: nb.next });
  if (S.wsTab === 'notebook') drawNotebook();
}
const nbLine = (c) => `#${c.id} [${L(c.status || 'hipótese')}]${c.kind ? ' ' + c.kind : ''}${c.addr ? ' ' + c.addr : ''} — ${c.title}`;
async function notebookTool(conv, a) {
  if (typeof a === 'string') a = parseArgs(a) || {};
  a = a || {};
  const key = nbKey(conv); const nb = await nbLoad(key, conv);
  const id = a.id != null ? Number(String(a.id).replace(/^#/, '')) : null;
  const card = id != null ? nb.cards.find((c) => c.id === id) : null;
  const fields = ['title', 'kind', 'addr', 'status', 'text'];
  const ok = (content) => ({ content, isError: false });
  const err = (content) => ({ content: L('Erro: ') + content, isError: true });
  switch (a.action) {
    case 'list': {
      const q = String(a.query || '').toLowerCase();
      const hits = nb.cards.filter((c) => !q || fields.some((f) => String(c[f] || '').toLowerCase().includes(q)));
      if (!nb.cards.length) return ok(L('O caderno está vazio.'));
      if (!hits.length) return ok(L('Nada encontrado para "{0}" ({1} cartões no caderno).', a.query, nb.cards.length));
      return ok(L('{0} de {1} cartões (use get com o id para ler o texto):\n', hits.length, nb.cards.length) + hits.slice(-80).map(nbLine).join('\n'));
    }
    case 'get': return card ? ok(nbLine(card) + (card.text ? '\n\n' + card.text : '')) : err(L('não existe o cartão #{0}.', id));
    case 'add': {
      if (!a.title) return err(L('informe title.'));
      // mesmo endereço e tipo: atualiza em vez de duplicar
      const dup = a.addr && nb.cards.find((c) => c.addr && c.addr.toLowerCase() === String(a.addr).toLowerCase() && (c.kind || '') === (a.kind || ''));
      if (dup) { for (const f of fields) if (a[f] != null && a[f] !== '') dup[f] = String(a[f]); dup.at = Date.now(); await nbSave(key); return ok(L('Já existia o cartão #{0} para {1}; atualizado.', dup.id, a.addr)); }
      const c = { id: nb.next++, at: Date.now(), conv: conv.id, status: 'hipótese' };
      for (const f of fields) if (a[f] != null && a[f] !== '') c[f] = String(a[f]);
      c.status = nbStatus(c.status);
      nb.cards.push(c); await nbSave(key);
      return ok(L('Cartão #{0} criado.', c.id));
    }
    case 'update': {
      if (!card) return err(L('não existe o cartão #{0}.', id));
      for (const f of fields) if (a[f] != null) card[f] = String(a[f]);
      if (a.status != null) card.status = nbStatus(a.status);
      card.at = Date.now(); await nbSave(key);
      return ok(L('Cartão #{0} atualizado: {1}', card.id, nbLine(card)));
    }
    case 'remove': {
      if (!card) return err(L('não existe o cartão #{0}.', id));
      nb.cards = nb.cards.filter((c) => c !== card); await nbSave(key);
      return ok(L('Cartão #{0} removido.', id));
    }
    default: return err(L('action deve ser list, get, add, update ou remove.'));
  }
}
async function editCard(conv, card) {
  const key = nbKey(conv); const nb = await nbLoad(key, conv);
  const title = h('input.input', { value: card?.title || '', placeholder: L('Ex.: verifica a licença') });
  const kind = h('input.input', { value: card?.kind || '', placeholder: L('função, endereço, string...'), list: 'nb-kinds' });
  const addr = h('input.input.mono', { value: card?.addr || '', placeholder: '0x401000' });
  const status = h('select.select', null, NB_STATUS.map((x) => h('option', { value: x }, L(x)))); status.value = card?.status || 'hipótese';
  const text = h('textarea.textarea', { rows: 6, value: card?.text || '' });
  const m = modal({ title: card ? L('Cartão #{0}', card.id) : L('Novo cartão'), body: h('div.form', null,
    h('datalist#nb-kinds', null, [L('função'), L('endereço'), 'string', 'estrutura', L('hipótese'), 'achado'].map((k) => h('option', { value: k }))),
    h('div.field', null, h('label', null, L('Título')), title),
    h('div.row', null, h('div.field', null, h('label', null, L('Tipo')), kind), h('div.field', null, h('label', null, L('Endereço ou local')), addr), h('div.field', null, h('label', null, L('Situação')), status)),
    h('div.field', null, h('label', null, L('Anotações')), text)),
  foot: [
    card ? h('button.btn', { style: { marginRight: 'auto' }, title: L('Abre uma conversa que testa esta hipótese no debugger e atualiza o cartão com a evidência'), onclick: () => { m.close(); testCard(conv, card); } }, ic('play'), L('Testar')) : null,
    card?.addr ? h('button.btn', { title: L('Guarda os bytes desta função para reconhecê-la em outros binários'), onclick: () => { m.close(); sigDialog(conv, card); } }, ic('braces'), L('Criar assinatura')) : null,
    h('button.btn', { onclick: () => m.close() }, L('Cancelar')), h('button.btn.primary', { onclick: async () => {
    if (!title.value.trim()) { toast(L('Dê um título.'), 'err'); return; }
    const c = card || { id: nb.next++, conv: conv.id };
    Object.assign(c, { title: title.value.trim(), kind: kind.value.trim(), addr: addr.value.trim(), status: status.value, text: text.value, at: Date.now() });
    if (!card) nb.cards.push(c);
    await nbSave(key); m.close();
  } }, L('Salvar'))] });
  setTimeout(() => title.focus(), 30);
}
function nbExport(conv, nb, kind) {
  let text; let name;
  if (kind === 'x64dbg') {
    const q = (t) => String(t).replace(/"/g, "'");
    const lines = nb.cards.filter((c) => /^(0x)?[0-9a-f]{4,16}$/i.test(c.addr || '') && c.status !== 'descartado')
      .map((c) => `${/fun[cç]/i.test(c.kind || '') ? 'lbl' : 'cmt'} ${c.addr.startsWith('0x') ? c.addr : '0x' + c.addr}, "${q(c.title)}"`);
    if (!lines.length) { toast(L('Nenhum cartão com endereço em hexadecimal.')); return; }
    text = lines.join('\n') + '\n'; name = 'caderno-x64dbg.txt';
  } else {
    const by = (st) => nb.cards.filter((c) => (c.status || 'hipótese') === st);
    text = L('# Caderno de investigação\n\nPasta: {0}\n', wsOf(conv));
    for (const st of NB_STATUS) {
      const cs = by(st); if (!cs.length) continue;
      text += `\n## ${L(st)[0].toUpperCase() + L(st).slice(1)}\n`;
      for (const c of cs) text += `\n### #${c.id} ${c.title}\n${[c.kind && L('- Tipo: {0}', c.kind), c.addr && L('- Local: `{0}`', c.addr)].filter(Boolean).join('\n')}\n${c.text ? '\n' + c.text + '\n' : ''}`;
    }
    name = 'caderno.md';
  }
  navigator.clipboard?.writeText(text).catch(() => {});
  api('/api/ws/upload?name=' + encodeURIComponent(name) + '&ws=' + encodeURIComponent(wsOf(conv)), new Blob([text]))
    .then((r) => { toast(L('Copiado e salvo em {0}', relOf(r.path))); refreshTree(); })
    .catch((e) => toast(e.message, 'err'));
}
/* ------------------------------------------------------------ hipótese testada */
// Abre uma conversa que planeja e executa o teste no debugger e grava o veredito no cartão.
// O pedido é curto e direto; as ferramentas do debugger entram pelo catálogo de conectores.
async function testCard(conv, card) {
  const dbg = S.mcp.filter((x) => x.status === 'connected' && /dbg|debug|ida|ghidra|binja|radare|r2/i.test(x.name)).map((x) => x.name);
  const proj = projectOf(conv);
  const c = newConv(proj?.id || null);
  c.title = L('Testar #{0}: {1}', card.id, card.title).slice(0, 60);
  c.testCard = card.id; c.nbOf = nbOwner(conv).id;
  if (dbg.length) { const sel = activeSel(c); for (const n of dbg) if (!sel.mcp.includes(n)) sel.mcp.push(n); S.sel.mcp = [...new Set([...S.sel.mcp, ...dbg])]; saveSel(); }
  if (!S.settings.tools.notebook) { S.settings.tools.notebook = true; store.set('settings', S.settings); }
  setView('chat'); updatePickers();
  const text = [
    L('Teste a hipótese do cartão #{0} do caderno: "{1}"{2}.', card.id, card.title, card.kind ? ` (${card.kind}` + (card.addr ? L(' em {0})', card.addr) : ')') : card.addr ? ` (${card.addr})` : ''),
    card.text ? L('Anotações: {0}', clipText(card.text, 600)) : '',
    L('Faça assim: 1) diga em até 3 linhas o que, se for verdade, você vai observar; 2) execute o mínimo de passos no debugger para observar (breakpoint, executar, ler registradores ou memória); 3) atualize o cartão com notebook update: status "confirmado" ou "descartado" e no text a evidência (o que viu, com endereços e valores). Se não der para concluir, deixe "hipótese" e explique o que faltou.'),
    dbg.length ? '' : L('Observação: nenhum conector de debugger está conectado; diga isso e sugira como testar manualmente.'),
  ].filter(Boolean).join('\n\n');
  card.testConv = c.id; card.at = Date.now(); nbSave(nbKey(conv));
  await submit(c, { content: text, parts: [{ t: 'text', v: text }], refs: [] });
}

/* ------------------------------------------------------------ assinaturas de funções */
// Montadas e procuradas pelo servidor, sem o modelo: zero tokens.
function binKey(conv) { return 'nbBin:' + nbKey(conv); }
async function sigDialog(conv, card) {
  const file = h('input.input.mono', { value: card.module || store.get(binKey(conv), ''), placeholder: L('C:\\\\caminho\\\\programa.exe ou .dll') });
  const addr = h('input.input.mono', { value: card.addr || '' });
  const base = h('input.input.mono', { placeholder: L('só se o x64dbg carregou em outra base (ASLR)') });
  const len = h('input.input', { value: '48', inputmode: 'numeric' });
  const out = h('div.sig-out');
  let made = null;
  const gen = async () => {
    out.innerHTML = ''; made = null;
    try {
      const r = await api('/api/sig/make', { file: file.value.trim().replace(/^"|"$/g, ''), addr: addr.value, base: base.value, len: Number(len.value) || 48, ws: wsOf(conv) });
      made = r;
      out.append(h('code.sig-pat', null, r.pattern),
        h('small', null, L('RVA {0} · base preferida {1} · {2} bits · ', r.rva, r.imageBase, r.is64 ? '64' : '32'), r.unique ? h('b.ok', null, L('única no binário')) : h('b.warn', null, L('aparece {0}× no binário; aumente o tamanho', r.hits))));
      saveBtn.disabled = !r.unique;
    } catch (e) { out.append(h('div.chg-note', null, e.message)); saveBtn.disabled = true; }
  };
  const saveBtn = h('button.btn.primary', { disabled: true, onclick: async () => {
    if (!made) return;
    const all = (await api('/api/sig', {})).sigs || [];
    all.push({ id: uid(), name: card.title, kind: card.kind || L('função'), note: clipText(card.text || '', 300), pattern: made.pattern, is64: made.is64, from: basename(file.value.trim()), rva: made.rva, at: Date.now() });
    await api('/api/sig/save', { sigs: all });
    store.set(binKey(conv), file.value.trim());
    card.module = file.value.trim(); card.sig = true; await nbSave(nbKey(conv));
    m.close(); toast(L('Assinatura salva ({0} no total)', all.length));
  } }, L('Salvar assinatura'));
  const m = modal({ title: L('Assinatura de "{0}"', card.title), wide: true, body: h('div.form', null,
    h('p.muted', { style: { margin: 0 } }, L('Os primeiros bytes da função, com curingas onde o código muda entre versões (chamadas, saltos e endereços). Depois o studio reconhece a função em outros binários, sem o modelo.')),
    h('div.field', null, h('label', null, L('Binário (exe ou dll)')), h('div', { style: { display: 'flex', gap: '8px' } }, file, h('button.btn', { type: 'button', onclick: async () => { const p = await pickPath({ title: L('Escolher o binário'), mode: 'file', start: file.value ? file.value.replace(/[\\/][^\\/]*$/, '') : S.info.home }); if (p) { file.value = p; gen(); } } }, L('Procurar')))),
    h('div.row', null, h('div.field', null, h('label', null, L('Endereço')), addr), h('div.field', null, h('label', null, L('Base do módulo')), base), h('div.field', null, h('label', null, L('Bytes')), len)),
    out),
  foot: [h('button.btn', { onclick: gen }, L('Gerar')), h('button.btn', { onclick: () => m.close() }, L('Cancelar')), saveBtn] });
  if (file.value) gen();
}
async function sigScan(conv) {
  const p = await pickPath({ title: L('Procurar assinaturas em qual binário?'), mode: 'file', start: store.get(binKey(conv), '').replace(/[\\/][^\\/]*$/, '') || S.info.home });
  if (!p) return;
  let r;
  try { r = await api('/api/sig/scan', { file: p, ws: wsOf(conv) }); } catch (e) { toast(e.message, 'err'); return; }
  if (!r.total) { toast(L('Nenhuma assinatura salva ainda. Crie pelo cartão de uma função (botão Criar assinatura).')); return; }
  const key = nbKey(conv); const nb = await nbLoad(key, conv);
  const addCard = (x) => {
    if (x.hits.length !== 1) return false;
    const va = x.hits[0].va;
    if (nb.cards.some((c) => (c.addr || '').toLowerCase() === va.toLowerCase())) return false;
    nb.cards.push({ id: nb.next++, title: x.name, kind: x.kind || L('função'), addr: va, status: 'hipótese', module: p, text: L('Reconhecida por assinatura (vinda de {0}).{1}', x.from || L('outro binário'), x.note ? '\n' + x.note : ''), at: Date.now(), conv: conv.id });
    return true;
  };
  const list = h('div.sig-list', null, r.matches.length ? r.matches.map((x) => h('div.sig-row', null,
    h('div', null, h('b', null, x.name), h('small.muted', null, L(' · {0} · de {1}', x.kind || L('função'), x.from || '?'))),
    h('code', null, x.hits.length === 1 ? x.hits[0].va : L('{0} lugares', x.hits.length)),
    h('button.btn.sm', { disabled: x.hits.length !== 1, onclick: async (e) => { if (addCard(x)) { await nbSave(key); e.currentTarget.textContent = L('Criado'); } e.currentTarget.disabled = true; } }, L('Criar cartão')))) : h('p.muted', null, L('Nenhuma assinatura encontrada neste binário.')));
  const m = modal({ title: L('Assinaturas em {0}', basename(p)), wide: true, body: h('div.form', null,
    h('p.muted', { style: { margin: 0 } }, L('{0} de {1} assinaturas encontradas · base {2} · {3} bits. Endereços na base preferida do binário.', r.matches.length, r.total, r.imageBase, r.is64 ? '64' : '32')), list),
  foot: [r.matches.some((x) => x.hits.length === 1) ? h('button.btn', { onclick: async () => { let n = 0; for (const x of r.matches) if (addCard(x)) n++; await nbSave(key); toast(L('{0} cartões criados', n)); m.close(); } }, L('Criar todos')) : null, h('button.btn.primary', { onclick: () => m.close() }, L('Fechar'))] });
}
async function sigManage() {
  const r = await api('/api/sig', {});
  let sigs = r.sigs || [];
  const list = h('div.sig-list');
  const draw = () => {
    list.innerHTML = '';
    if (!sigs.length) list.append(h('p.muted', null, L('Nenhuma assinatura salva.')));
    for (const x of sigs) list.append(h('div.sig-row', null,
      h('div', null, h('b', null, x.name), h('small.muted', null, L(' · de {0} {1}', x.from || '?', x.rva || '')), h('code.sig-pat.sm', null, x.pattern)),
      h('button.icon-btn.sm', { title: L('Apagar'), 'aria-label': L('Apagar'), html: svg('trash'), onclick: async () => { sigs = sigs.filter((y) => y !== x); await api('/api/sig/save', { sigs }); draw(); } })));
  };
  draw();
  const m = modal({ title: L('Assinaturas salvas'), wide: true, body: list, foot: [h('button.btn.primary', { onclick: () => m.close() }, L('Fechar'))] });
}

S.nbQuery = '';
async function drawNotebook() {
  const box = $('#ws-notebook'); if (!box || box.hidden) return;
  const c = cur();
  if (!c) { S.nbShown = null; box.innerHTML = ''; box.append(h('div.act-empty', null, ic('book'), L('Abra uma conversa ou um projeto para ver o caderno dele.'))); return; }
  const key = nbKey(c);
  S.nbShown = key;
  let nb;
  try { nb = await nbLoad(key, c); } catch (e) { box.innerHTML = ''; box.append(h('div.act-empty', null, L('Erro: ') + e.message)); return; }
  const keep = box.scrollTop;
  box.innerHTML = '';
  const q = S.nbQuery.toLowerCase();
  const search = h('input.input.nb-search', { value: S.nbQuery, placeholder: L('Filtrar cartões'), oninput: (e) => { S.nbQuery = e.target.value; clearTimeout(drawNotebook._t); drawNotebook._t = setTimeout(() => { drawNotebook().then(() => { const i = $('.nb-search'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 150); } });
  box.append(h('div.ws-scope', null, ic('book'), L('Caderno {0}', nbScope(c))), h('div.nb-top', null, search,
    h('button.icon-btn.sm', { title: L('Novo cartão'), 'aria-label': L('Novo cartão'), html: svg('plus'), onclick: () => editCard(c) }),
    h('button.icon-btn.sm', { title: L('Mais'), 'aria-label': L('Mais opções do caderno'), html: svg('more'), onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); floatMenu(r.left - 200, r.bottom + 4, [
      { label: L('Procurar assinaturas num binário'), icon: 'search', onclick: () => sigScan(c) },
      { label: L('Assinaturas salvas'), icon: 'braces', onclick: sigManage },
      'sep',
      { label: L('Exportar em Markdown'), icon: 'fileText', onclick: () => nbExport(c, nb, 'md') },
      { label: L('Exportar rótulos para o x64dbg'), icon: 'terminal', onclick: () => nbExport(c, nb, 'x64dbg') }]); } })));
  const list = nb.cards.filter((x) => !q || ['title', 'kind', 'addr', 'text', 'status'].some((f) => String(x[f] || '').toLowerCase().includes(q))).sort((a, b) => (b.at || 0) - (a.at || 0));
  if (!nb.cards.length) { box.append(h('div.act-empty', null, ic('book'), L('O caderno desta pasta está vazio. O modelo registra aqui o que descobrir (com a ferramenta Caderno ligada), e você também pode anotar.'))); return; }
  const counts = NB_STATUS.map((st) => [st, nb.cards.filter((x) => (x.status || 'hipótese') === st).length]);
  box.append(h('div.nb-counts', null, counts.map(([st, n]) => h('span.nb-st.st-' + st.normalize('NFD').replace(/[\u0300-\u036f]/g, ''), null, `${n} ${L(n === 1 ? st : st + 's')}`))));
  for (const card of list) {
    const st = (card.status || 'hipótese');
    box.append(h('div.nb-card.st-' + st.normalize('NFD').replace(/[\u0300-\u036f]/g, ''), { onclick: () => editCard(c, card) },
      h('div.nb-h', null,
        h('button.nb-st', { title: L('Trocar a situação'), onclick: async (e) => { e.stopPropagation(); card.status = NB_STATUS[(NB_STATUS.indexOf(st) + 1) % 3]; card.at = Date.now(); await nbSave(key); } }, L(st)),
        card.kind ? h('span.nb-kind', null, card.kind) : null,
        card.addr ? h('code.nb-addr', null, card.addr) : null,
        h('span.nb-id', null, '#' + card.id)),
      h('div.nb-title', null, card.title),
      card.text ? h('div.nb-text', null, card.text) : null));
  }
  box.scrollTop = keep;
}
