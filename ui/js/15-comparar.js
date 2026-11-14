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

/* ============================================================ verificação das afirmações (pesquisa na web) */
// Depois de uma resposta que usou web_search/web_fetch, outro modelo confere cada afirmação factual contra o texto
// das páginas lidas (e os trechos dos resultados) e marca o que ficou sem fonte ou contradiz a fonte. Fica num
// painel embaixo da resposta; "Pedir correção" manda o modelo pesquisar de novo só o que faltou.

const VERIFY_RUNS = new Map();

function webToolsOf(b) {
  return b.msgs.filter((m) => m.role === 'tool' && (m.name === 'web_search' || m.name === 'web_fetch') && !m.isError);
}

function maybeVerify(conv) {
  if (S.settings.verifyClaims === false) return;
  const blocks = blocksOf(conv);
  const b = blocks[blocks.length - 1];
  if (!b || b.type !== 'ai' || !webToolsOf(b).length) return;
  const last = abLastAssistant(b);
  if (!last || last.verify || splitThink(last.content || '').text.trim().length < 150) return;
  verifyClaims(conv, b);
}

async function verifyClaims(conv, b) {
  const last = abLastAssistant(b);
  if (!last || VERIFY_RUNS.has(last)) return;
  const web = webToolsOf(b);
  const urls = [...new Set(web.filter((m) => m.name === 'web_fetch').map((m) => m.data?.url).filter(Boolean))];
  const snippets = web.filter((m) => m.name === 'web_search').flatMap((m) => m.data?.results || []).map((r) => `- ${r.title} (${r.url}): ${r.snippet}`);
  const ac = new AbortController();
  VERIFY_RUNS.set(last, ac);
  last.verify = { status: 'running' };
  scheduleRender();
  try {
    const { sources } = await api('/api/web/sources', { urls }, { signal: ac.signal });
    let budget = 60000;
    const docs = [];
    sources.forEach((s, i) => { const t = s.text.slice(0, Math.max(0, Math.min(14000, budget))); budget -= t.length; if (t) docs.push(`[F${i + 1}] ${s.url}\n${t}`); });
    if (snippets.length) docs.push(L('[Trechos dos resultados de busca]\n') + snippets.slice(0, 30).join('\n'));
    if (!docs.length) throw new Error(L('nenhuma página lida para conferir'));
    const answer = splitThink(last.content || '').text;
    const sys = L('Você confere respostas contra fontes. Liste as afirmações factuais verificáveis da RESPOSTA (números, datas, nomes, versões, comportamentos; ignore opiniões e conselhos). Para cada uma, diga se as FONTES apoiam: "ok" (apoiada), "parcial" (só em parte), "sem_fonte" (as fontes não falam disso) ou "contradiz" (as fontes dizem outra coisa). Use só as fontes dadas, nunca o seu conhecimento. Responda só JSON: {"claims":[{"claim":"...","status":"ok|parcial|sem_fonte|contradiz","source":"URL ou vazio","note":"curto, só quando não for ok"}]}. No máximo 15 afirmações, as mais importantes.');
    const user = L('RESPOSTA:\n{0}\n\nFONTES:\n{1}', answer.slice(0, 12000), docs.join('\n\n'));
    const msgs = [{ role: 'system', content: sys }, { role: 'user', content: user }];
    const schema = { type: 'object', properties: { claims: { type: 'array', items: { type: 'object', properties: { claim: { type: 'string' }, status: { enum: ['ok', 'parcial', 'sem_fonte', 'contradiz'] }, source: { type: 'string' }, note: { type: 'string' } }, required: ['claim', 'status'] } } }, required: ['claims'] };
    let m = { content: '', reasoning: '', tool_calls: [] };
    const p = apiFor('auditor') || mainApiForChat(conv)?.id;
    const ex = { temperature: 0, max_tokens: 3000, _timeout: 90000, _fixed: true };
    if (p) {
      try { await streamApi(msgs, [], m, ac.signal, null, { ...ex, _p: p, response_format: { type: 'json_schema', json_schema: { name: 'verificacao', schema } } }); }
      catch (e) {
        if (ac.signal.aborted || !/response_format|json_schema|schema|400|422/i.test(e.message)) throw e;
        m = { content: '', reasoning: '', tool_calls: [] };
        await streamApi(msgs, [], m, ac.signal, null, { ...ex, _p: p });
      }
    } else {
      await sideRun(conv, ex, () => streamRaw(msgs, [], m, ac.signal, null, ex));
    }
    const text = splitThink(m.content || '').text;
    let v = null;
    for (const t of (text.match(/\{[\s\S]*\}/g) || []).reverse()) { try { v = JSON.parse(t); break; } catch { /* outro */ } }
    if (!Array.isArray(v?.claims)) throw new Error(L('o verificador não devolveu a lista'));
    const claims = v.claims.filter((c) => c && c.claim).slice(0, 20).map((c) => ({ claim: String(c.claim), status: ['ok', 'parcial', 'sem_fonte', 'contradiz'].includes(c.status) ? c.status : 'sem_fonte', source: String(c.source || ''), note: String(c.note || '') }));
    last.verify = { status: 'done', claims, by: m.via || '', at: Date.now() };
  } catch (e) {
    if (ac.signal.aborted) delete last.verify;
    else last.verify = { status: 'error', err: e.message || String(e) };
  } finally {
    VERIFY_RUNS.delete(last);
    saveConvs(); scheduleRender();
  }
}

/** Manda um pedido do studio como mensagem do usuário (aparece na conversa) e roda a resposta. */
function sendFollowup(conv, text) {
  if (running(conv)) return;
  submit(conv, { content: text, parts: [{ t: 'text', v: text }], refs: [] });
}

const VERIFY_LABEL = () => ({ ok: L('com fonte'), parcial: L('em parte'), sem_fonte: L('sem fonte'), contradiz: L('contradiz a fonte') });

function verifyPanel(conv, b) {
  const last = abLastAssistant(b);
  const v = last?.verify;
  if (!v) return null;
  if (v.status === 'running') return h('div.verify.small.muted', null, h('span', { html: svg('loader', 'spin') }), L('Conferindo as afirmações contra as páginas lidas...'),
    h('button.link.small', { onclick: () => VERIFY_RUNS.get(last)?.abort() }, L('Cancelar')));
  if (v.status === 'error') return h('div.verify.small.muted', null, ic('alert'), L('Não deu para conferir: {0}', v.err),
    h('button.link.small', { onclick: () => { delete last.verify; verifyClaims(conv, b); } }, L('Tentar de novo')),
    h('button.link.small', { onclick: () => { delete last.verify; saveConvs(); scheduleRender(); } }, L('Ocultar')));
  const n = (s) => v.claims.filter((c) => c.status === s).length;
  const bad = v.claims.filter((c) => c.status === 'sem_fonte' || c.status === 'contradiz');
  const lab = VERIFY_LABEL();
  const sum = [n('ok') && L('{0} com fonte', n('ok')), n('parcial') && L('{0} em parte', n('parcial')), n('sem_fonte') && L('{0} sem fonte', n('sem_fonte')), n('contradiz') && L('{0} contradiz', n('contradiz'))].filter(Boolean).join(' · ');
  const fix = () => {
    const list = v.claims.filter((c) => c.status !== 'ok').map((c) => `- ${c.claim} (${lab[c.status]}${c.note ? ': ' + c.note : ''})`).join('\n');
    sendFollowup(conv, L('A verificação contra as páginas lidas apontou estas afirmações da sua última resposta:\n{0}\n\nPesquise e leia fontes para cada uma. Corrija ou remova o que não se confirmar e cite a fonte do que ficar. Reescreva a resposta inteira já corrigida.', list));
  };
  return h('details.verify' + (bad.length ? '.warn' : '.good'), { open: bad.length > 0 },
    h('summary', null, ic(bad.length ? 'alert' : 'check'), h('b', null, L('Verificação')), h('span.muted', null, ` ${sum || L('nenhuma afirmação verificável')}`)),
    h('ul.verify-list', null, v.claims.map((c) => h('li.v-' + c.status, null, h('span.v-tag', null, lab[c.status]), h('span', null, c.claim),
      c.note ? h('small.muted', null, ' — ' + c.note) : null,
      c.source && /^https?:/.test(c.source) ? h('a.small', { href: c.source, target: '_blank', rel: 'noopener' }, ' ↗') : null))),
    h('div.verify-acts', null,
      v.claims.some((c) => c.status !== 'ok') ? h('button.btn.sm', { onclick: fix, disabled: running(conv) }, L('Pedir correção')) : null,
      h('small.muted', null, v.by ? L('conferido por {0}', v.by) : ''),
      h('span.spacer'),
      h('button.link.small', { onclick: () => { delete last.verify; verifyClaims(conv, b); } }, L('Conferir de novo'))));
}

/* ============================================================ desempenho por modelo */
// Tirado das conversas: quantas respostas, chamadas de ferramenta e quantas deram erro (fora cancelamento e
// permissão negada), respostas vazias, repetições cortadas, respostas cortadas por limite e tempos. Serve para
// decidir qual API fica com cada função.
function modelStats() {
  const st = new Map();
  for (const c of S.convs) {
    const by = new Map();
    for (const m of c.messages || []) {
      if (m.role === 'assistant') {
        const v = m.via || (c.modelId ? (convModel(c)?.name || c.modelId) : L('modelo local'));
        const s = st.get(v) || { by: v, resp: 0, calls: 0, errs: 0, empty: 0, loops: 0, cut: 0, ms: 0, msN: 0, ttft: 0, ttftN: 0 };
        st.set(v, s);
        s.resp++;
        const calls = (m.tool_calls || []).filter((t) => t.function?.name);
        s.calls += calls.length;
        for (const t of calls) by.set(t.id, s);
        const text = typeof m.content === 'string' ? splitThink(m.content).text : '';
        if (!text.trim() && !calls.length && !m.looped) s.empty++;
        if (m.looped || (m.reasoning && looping(m.reasoning))) s.loops++;
        if (m.finish === 'length') s.cut++;
        if (m.t0 && m.t1 && m.t1 > m.t0) { s.ms += m.t1 - m.t0; s.msN++; }
        if (m.ttft) { s.ttft += m.ttft; s.ttftN++; }
      } else if (m.role === 'tool' && m.isError) {
        const s = by.get(m.tool_call_id);
        const t = String(m.content || '');
        if (s && !/Cancelad|Cancelled|negou|denied|Parada forçada|Forced stop/i.test(t)) s.errs++;
      }
    }
  }
  return [...st.values()].filter((s) => s.resp >= 3).sort((a, b) => b.resp - a.resp);
}

function showModelStats() {
  const rows = modelStats();
  const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '—');
  const sec = (ms, n) => (n ? fmtMs(ms / n) : '—');
  const best = rows.filter((r) => r.calls >= 20).sort((a, b) => a.errs / a.calls - b.errs / b.calls)[0];
  const m = modal({
    title: L('Desempenho dos modelos'),
    body: h('div', null,
      rows.length ? h('div.mstats-wrap', null, h('table.ab-table.mstats', null,
        h('tr', null, [L('Modelo'), L('Respostas'), L('Chamadas'), L('Erros'), L('Vazias'), L('Repetição'), L('Cortadas'), L('Tempo médio'), L('1º sinal')].map((t) => h('th', null, t))),
        rows.map((r) => h('tr', r === best ? { class: 'best' } : null,
          h('td', { title: r.by }, r.by), h('td', null, String(r.resp)), h('td', null, String(r.calls)),
          h('td', { class: r.calls >= 10 && r.errs / r.calls > 0.08 ? 'bad' : '' }, pct(r.errs, r.calls)),
          h('td', null, String(r.empty)), h('td', { class: r.loops ? 'bad' : '' }, String(r.loops)), h('td', { class: r.cut ? 'bad' : '' }, String(r.cut)),
          h('td', null, sec(r.ms, r.msN)), h('td', null, sec(r.ttft, r.ttftN))))))
        : h('p.muted', null, L('Ainda não há respostas suficientes para comparar.')),
      h('small.muted', null, L('Erros = chamadas de ferramenta que falharam (sem contar cancelamentos e permissões negadas). Destacado: o que menos erra entre os que fizeram 20+ chamadas. O 1º sinal só existe nas respostas desta versão em diante.'))),
    foot: [h('span.spacer'), h('button.btn', { onclick: () => m.close() }, L('Fechar'))],
  });
}
