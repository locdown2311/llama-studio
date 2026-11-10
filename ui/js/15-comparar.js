/* ============================================================ comparar respostas (A/B) */
// Gera a mesma resposta com outra API (só texto, sem ferramentas: nada roda duas vezes) e mostra as duas
// lado a lado. Quem escolhe a B troca o texto da resposta; o placar por modelo fica guardado. De vez em
// quando (1 em ~15 respostas sem ferramentas, no máximo uma a cada 10 min) o studio pergunta sozinho.

const AB_EVERY = 15;
const AB_GAP = 10 * 60 * 1000;
const AB_RUNS = new Map(); // id da mensagem -> AbortController

function abStats() { return store.get('abStats', {}); }

/** APIs prontas para gerar a B (fora a que respondeu a A). */
function abCandidates(conv, aBy) {
  const cur = mainApiForChat(conv)?.id || null;
  return (S.info?.apis || []).filter((a) => a.ready && a.id !== cur && apiLabel(a) !== aBy && !apiCooled(a.id));
}

function abLastAssistant(b) {
  const as = b.msgs.filter((m) => m.role === 'assistant');
  return as[as.length - 1] || null;
}

function abLabelA(conv, m) {
  const api = mainApiForChat(conv);
  return m?.via || (api ? `${apiLabel(api)} · ${api.model}` : convModel(conv)?.name || L('modelo local'));
}

/** Gera a resposta B para o bloco de resposta `b` da conversa. */
async function abCompare(conv, b, auto) {
  const last = abLastAssistant(b);
  if (!last || AB_RUNS.has(last)) return;
  const aBy = abLabelA(conv, last);
  const pool = abCandidates(conv, aBy);
  if (!pool.length) { if (!auto) toast(L('Para comparar, configure outra API pronta em Configurações › APIs externas.'), 'err'); return; }
  const api = pool[Math.floor(Math.random() * pool.length)];
  const hadTools = b.msgs.some((m) => m.role === 'tool');
  const tmp = { ...conv, messages: conv.messages.slice(0, b.start) };
  const msgs = apiMessages(tmp, conv._sys || '');
  last.ab = { status: 'running', auto: !!auto, a: { by: aBy }, b: { by: `${apiLabel(api)} · ${api.model}`, text: '' }, tools: hadTools };
  const ac = new AbortController();
  AB_RUNS.set(last, ac);
  scheduleRender();
  const m = { content: '', reasoning: '', tool_calls: [] };
  try {
    await streamApi(msgs, [], m, ac.signal, () => { last.ab.b.text = splitThink(m.content).text; scheduleRender(); }, { _p: api.id, _timeout: 180000 });
    last.ab.b.text = splitThink(m.content).text.trim();
    last.ab.status = last.ab.b.text ? 'pending' : 'error';
    if (!last.ab.b.text) last.ab.err = L('A API não devolveu texto.');
  } catch (e) {
    if (ac.signal.aborted) { delete last.ab; } else { last.ab.status = 'error'; last.ab.err = e.message; }
  } finally {
    AB_RUNS.delete(last);
    if (auto) store.set('abLast', Date.now());
    saveConvs(); scheduleRender();
  }
}

/** Depois de uma resposta: às vezes compara sozinho. */
function maybeAskAB(conv) {
  if (S.settings.abAuto === false || conv.id !== S.curId) return;
  const blocks = blocksOf(conv);
  const b = blocks[blocks.length - 1];
  if (!b || b.type !== 'ai' || b.msgs.some((m) => m.role === 'tool')) return;
  const last = abLastAssistant(b);
  if (!last || last.ab || splitThink(last.content || '').text.trim().length < 200) return;
  if (Date.now() - store.get('abLast', 0) < AB_GAP || Math.random() >= 1 / AB_EVERY) return;
  if (!abCandidates(conv, abLabelA(conv, last)).length) return;
  abCompare(conv, b, true);
}

function abChoose(conv, last, pick) {
  const ab = last.ab;
  if (!ab || ab.status !== 'pending') return;
  const st = abStats();
  const bump = (by, k) => { st[by] = st[by] || { w: 0, l: 0, t: 0 }; st[by][k]++; };
  if (pick === 'tie') { bump(ab.a.by, 't'); bump(ab.b.by, 't'); }
  else { bump(pick === 'a' ? ab.a.by : ab.b.by, 'w'); bump(pick === 'a' ? ab.b.by : ab.a.by, 'l'); }
  store.set('abStats', st);
  ab.status = pick;
  if (pick === 'b') {
    // a resposta passa a ser a B; a A fica guardada para desfazer
    ab.a.text = splitThink(last.content || '').text;
    last.content = ab.b.text;
    last.via = ab.b.by;
  }
  saveConvs(); scheduleRender();
}

function abUndo(conv, last) {
  const ab = last.ab;
  if (ab?.status !== 'b' || ab.a.text == null) return;
  last.content = ab.a.text; last.via = ab.a.by; ab.status = 'a';
  saveConvs(); scheduleRender();
}

/** O painel embaixo da resposta: a B (ou o andamento) e os botões de escolha. */
function abPanel(conv, b) {
  const last = abLastAssistant(b);
  const ab = last?.ab;
  if (!ab) return null;
  const head = h('div.ab-head', null, ic('scale'), h('b', null, ab.auto ? L('Qual resposta ficou melhor?') : L('Comparação')),
    h('small.muted', null, L('A: {0} · B: {1}', ab.a.by, ab.b.by)));
  if (ab.status === 'running') {
    return h('div.ab-panel', null, head, h('div.ab-b.md', { html: md(ab.b.text || L('_{0} está escrevendo..._', ab.b.by)) }),
      h('div.ab-acts', null, h('button.btn.sm', { onclick: () => AB_RUNS.get(last)?.abort() }, L('Cancelar'))));
  }
  if (ab.status === 'error') {
    return h('div.ab-panel', null, head, h('div.small.err', null, L('A comparação falhou: {0}', ab.err || '?')),
      h('div.ab-acts', null, h('button.btn.sm', { onclick: () => { delete last.ab; saveConvs(); scheduleRender(); } }, L('Fechar'))));
  }
  if (ab.status !== 'pending') {
    const won = ab.status === 'tie' ? L('Empate') : ab.status === 'a' ? L('Ficou a A ({0})', ab.a.by) : L('Ficou a B ({0})', ab.b.by);
    return h('div.ab-done', null, ic('scale'), h('small.muted', null, won),
      ab.status === 'b' && ab.a.text != null ? h('button.chip', { onclick: () => abUndo(conv, last) }, L('Voltar para a A')) : null,
      h('button.chip', { onclick: () => { delete last.ab; saveConvs(); scheduleRender(); } }, L('Ocultar')));
  }
  return h('div.ab-panel', null, head,
    ab.tools ? h('small.muted', null, L('A B foi gerada só com o texto da conversa, sem ferramentas.')) : null,
    h('div.ab-cols', null,
      h('div.ab-col', null, h('div.ab-tag', null, 'A'), h('div.md', { html: md(splitThink(last.content || '').text) })),
      h('div.ab-col', null, h('div.ab-tag.b', null, 'B'), h('div.md', { html: md(ab.b.text) }))),
    h('div.ab-acts', null,
      h('button.btn.sm', { onclick: () => abChoose(conv, last, 'a') }, L('A é melhor')),
      h('button.btn.sm', { onclick: () => abChoose(conv, last, 'tie') }, L('Empate')),
      h('button.btn.sm.primary', { onclick: () => abChoose(conv, last, 'b') }, L('B é melhor')),
      h('span.spacer'),
      ab.auto ? h('button.link.small', { onclick: () => { S.settings.abAuto = false; store.set('settings', S.settings); delete last.ab; saveConvs(); scheduleRender(); toast(L('Não vou mais perguntar sozinho. Dá para comparar pelo botão Comparar de cada resposta.')); } }, L('Não perguntar mais')) : null));
}

/** Placar das comparações, por modelo. */
function showAbStats() {
  const st = Object.entries(abStats()).map(([by, s]) => ({ by, ...s, n: s.w + s.l + s.t })).sort((a, b) => (b.w - b.l) - (a.w - a.l) || b.n - a.n);
  const auto = h('input', { type: 'checkbox', checked: S.settings.abAuto !== false, onchange: () => { S.settings.abAuto = auto.checked; store.set('settings', S.settings); } });
  const m = modal({
    title: L('Placar das comparações'),
    body: h('div', null,
      st.length ? h('table.ab-table', null, h('tr', null, h('th', null, L('Modelo')), h('th', null, L('Venceu')), h('th', null, L('Perdeu')), h('th', null, L('Empate'))),
        st.map((s) => h('tr', null, h('td', null, s.by), h('td', null, String(s.w)), h('td', null, String(s.l)), h('td', null, String(s.t)))))
        : h('p.muted', null, L('Nenhuma comparação ainda. Use o botão Comparar embaixo de uma resposta.')),
      h('label.ab-auto', null, auto, h('span', null, L('Perguntar de vez em quando (1 em cada ~{0} respostas sem ferramentas)', AB_EVERY)))),
    foot: [st.length ? h('button.btn', { onclick: async () => { if (await confirmBox(L('Zerar o placar?'), L('Zerar'), true)) { store.set('abStats', {}); m.close(); } } }, L('Zerar')) : null, h('span.spacer'), h('button.btn', { onclick: () => m.close() }, L('Fechar'))],
  });
}
