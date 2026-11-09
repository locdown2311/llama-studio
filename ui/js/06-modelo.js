/* llama studio - raciocínio, cache dos slots e medidor de contexto */
'use strict';

/* ============================================================ raciocínio por conversa e slot */
const THINK_OPTS = [
  ['eco', L('Econômico'), L('Pensa no começo de cada pedido e quando algo falha; nos outros passos age direto. Gasta bem menos tokens.')],
  ['auto', L('Padrão do modelo'), L('O modelo decide (como vem no template dele).')],
  ['on', L('Pensar'), L('Raciocina antes de responder. Melhor para tarefas difíceis.')],
  ['off', L('Responder direto'), L('Sem raciocínio: bem mais rápido para pedidos simples.')],
];
/* ------------------------------------------------------------ modo plano */
// O modelo só investiga e escreve um plano; nada é alterado até o usuário aprovar.
// O aviso vai na mensagem do usuário (e não no prompt de sistema) para não invalidar o cache.
const PLAN_NOTE = L('\n\n[Modo plano] Não altere nada ainda: não escreva nem edite arquivos, não rode comandos e não use ferramentas que mudem algo. ')
  + L('Investigue só com leitura (e subagentes exploradores, se ajudar) e responda com um plano numerado: o que vai mudar, em quais arquivos, em que ordem, os riscos e como verificar. ')
  + L('Termine perguntando se pode executar.');
function planOf(c) { return c ? !!c.plan : !!S.draftPlan; }
function togglePlan() {
  const c = cur();
  if (c) { c.plan = !c.plan; saveConvs(); } else S.draftPlan = !S.draftPlan;
  updatePickers();
  toast(planOf(c) ? L('Modo plano: o modelo investiga e propõe um plano, sem alterar nada') : L('Modo plano desligado'));
}
/** A resposta em `b` veio de um pedido em modo plano e o plano ainda não foi executado. */
function planPending(conv, b) {
  if (!conv.plan) return false;
  for (let i = b.start - 1; i >= 0; i--) { const m = conv.messages[i]; if (m.role === 'user' && !m.hidden) return !!m.plan; }
  return false;
}
async function runPlan(conv) {
  conv.plan = false; saveConvs(); updatePickers();
  const text = L('Plano aprovado. Pode executar.');
  await submit(conv, { content: text, parts: [{ t: 'text', v: text }], refs: [] });
}

function thinkDefault() { return S.settings.thinkDefault || 'eco'; }
function thinkOf(c) { return (c ? c.think || c.autoThink : S.draftThink) || thinkDefault(); }
/** Econômico: raciocínio no primeiro passo do pedido, depois de erro ou de mensagem nova; nos outros, direto.
   Só muda o fim do prompt (a abertura da resposta), então não estraga o cache. */
function thinkNow(conv) {
  const t = thinkOf(conv);
  if (t !== 'eco') return t;
  return !conv._step || conv._thinkNext ? 'on' : 'off';
}
function requestExtras(conv) {
  const x = {};
  const t = thinkNow(conv);
  x._think = t;
  if (t !== 'auto') x.chat_template_kwargs = { enable_thinking: t === 'on' };
  if (t === 'off') x.reasoning_budget = 0;
  if (conv._slot != null) x.id_slot = conv._slot;
  return x;
}
function fillThinkPop() {
  const pop = $('#pop-think'); pop.innerHTML = '';
  const cur0 = thinkOf(cur());
  pop.append(h('div.pop-head', null, h('span', null, L('Raciocínio nesta conversa'))));
  for (const [v, l, d] of THINK_OPTS) {
    pop.append(h('button.menu-item' + (v === cur0 ? '.sel' : ''), { onclick: () => {
      const c = cur(); if (c) { c.think = v; saveConvs(); } else S.draftThink = v;
      closePops(); updatePickers();
    } }, ic(v === 'off' ? 'zap' in ICONS ? 'zap' : 'send' : 'brain'), h('span.mi-main', null, l, h('span.mi-sub', null, d)), v === cur0 ? ic('check') : null));
  }
}

/* ============================================================ cache de cada conversa (slots do llama-server) */
// Cada conversa ganha um slot do servidor. Quando outra conversa precisa do slot, o cache da
// anterior vai para o disco (--slot-save-path) e volta quando ela for usada de novo:
// conversas longas retomam sem reprocessar o histórico inteiro.
S.slots = { ok: true, owner: [], used: [], key: '', started: 0 };
function kvKey() {
  let h = 5381; const str = `${S.model}|${S.nCtx}`;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
function kvFile(c) { return L('{0}-{1}.bin', c.id, kvKey()); }

/** Slot reservado para o auditor e outros pedidos laterais (-1 se não houver). */
function auditSlot() { return S.settings.auditor && S.nSlots >= 2 ? S.nSlots - 1 : -1; }

async function assignSlot(conv) {
  conv._slot = null;
  const sl = S.slots;
  // cada conversa fica presa a um slot mesmo sem guardar cache no disco: sem isso o servidor escolhe o slot
  // e o auditor (ou outra conversa) pode cair em cima do cache dela
  if (!S.nSlots) return;
  const disk = S.settings.kvSave !== false && sl.ok;
  const key = kvKey();
  const started = S.llama?.startedAt || 0;
  if (sl.key !== key || sl.started !== started) { sl.key = key; sl.started = started; sl.owner = []; sl.used = []; }
  const busy = new Set([...S.runs.keys()].filter((id) => id !== conv.id).map((id) => S.convs.find((c) => c.id === id)?._slot).filter((x) => x != null));
  const mine = sl.owner.indexOf(conv.id);
  if (mine >= 0 && !busy.has(mine)) { conv._slot = mine; sl.used[mine] = Date.now(); return; }
  // com o auditor ligado, o último slot é dele: as conversas só usam se todos os outros estiverem ocupados
  const res = auditSlot();
  const pick = (skipRes) => {
    let b = -1;
    for (let k = 0; k < S.nSlots; k++) {
      if (busy.has(k) || (skipRes && k === res)) continue;
      if (!sl.owner[k]) return k;
      if (b < 0 || (sl.used[k] || 0) < (sl.used[b] || 0)) b = k;
    }
    return b;
  };
  let best = pick(true);
  if (best < 0 && res >= 0) best = pick(false);
  if (best < 0) return;
  const prev = sl.owner[best] && sl.owner[best] !== conv.id ? S.convs.find((c) => c.id === sl.owner[best]) : null;
  try {
    if (disk && prev && (prev.ctx?.tokens || 0) >= 3000) {
      conv._waitingModel = true; conv._waitText = L('Guardando o cache da outra conversa...'); scheduleRender();
      await api(`/slots/${best}?action=save`, { filename: kvFile(prev) });
      (prev.kv ||= {})[key] = Date.now();
      api('/api/kvcache/prune', { keep: 6 }).catch(() => {});
    }
    if (disk && conv.kv?.[key]) {
      conv._waitingModel = true; conv._waitText = L('Recuperando o cache desta conversa...'); scheduleRender();
      try { await api(`/slots/${best}?action=restore`, { filename: kvFile(conv) }); }
      catch { delete conv.kv[key]; }
    }
  } catch (e) {
    if (/save.?path|not supported|501|404/i.test(e.message)) sl.ok = false;
  } finally { conv._waitingModel = false; conv._waitText = ''; }
  sl.owner[best] = conv.id; sl.used[best] = Date.now(); conv._slot = best;
  saveConvs();
}

/* ============================================================ medidor de contexto */
/** De onde vêm os tokens fixos de cada pedido (instruções, ferramentas por origem). */
function ctxBreakdown(system, ctxText, catalog, tools, meta) {
  const tk = (x) => Math.ceil((typeof x === 'string' ? x.length : JSON.stringify(x).length) / 3.2);
  const parts = {};
  const add = (k, n) => { parts[k] = (parts[k] || 0) + n; };
  // o texto vem do programa, no idioma escolhido
  const skillsAt = Math.max(ctxText.indexOf('O usuário ativou as skills'), ctxText.indexOf('The user turned on the skills'));
  add(L('Instruções'), tk(system) - (catalog ? tk(catalog) : 0) - (skillsAt >= 0 ? tk(ctxText.slice(skillsAt)) : 0));
  if (skillsAt >= 0) add(L('Habilidades'), tk(ctxText.slice(skillsAt)));
  if (catalog) add(L('Catálogo de conectores'), tk(catalog));
  for (const t of tools) {
    const m = meta[t.function.name] || {};
    add(m.source === 'mcp' ? L('Conector ') + m.server : L('Ferramentas internas'), tk(t));
  }
  return Object.entries(parts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
}

/** Tokens ocupados: a última medida do servidor + estimativa do que entrou depois. */
function ctxUsage(conv) {
  const nCtx = ctxLimit(conv);
  if (!conv) return { used: 0, nCtx, exact: false };
  const m = conv.ctx;
  const est = (from) => Math.ceil(JSON.stringify(conv.messages.slice(from).map((x) => [x.content, x.tool_calls])).length / 3.2);
  if (m && m.cut === (conv.compactCut || 0) && m.n <= conv.messages.length) {
    const extra = m.n < conv.messages.length ? est(m.n) : 0;
    return { used: m.tokens + extra, nCtx, exact: !extra };
  }
  if (!conv.messages.length) return { used: 0, nCtx, exact: false };
  return { used: estimateTokens(conv, '', []) + (conv.ctxSys || 0), nCtx, exact: false };
}

function fmtK(n) { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',') + 'k' : String(n); }

function drawCtxMeter() {
  const el = $('#ctx-meter'); if (!el) return;
  const c = cur();
  const { used, nCtx, exact } = ctxUsage(c);
  const at = Number(S.settings.compactAt) || 75;
  const pct = nCtx ? Math.min(100, used / nCtx * 100) : 0;
  const lvl = pct >= at ? 'hi' : pct >= at * 0.75 ? 'mid' : 'lo';
  const R = 7, C = 2 * Math.PI * R;
  el.className = 'ctx-meter ' + lvl;
  el.hidden = !nCtx;
  el.innerHTML = `<svg viewBox="0 0 18 18" width="18" height="18"><circle cx="9" cy="9" r="${R}" class="trk"/><circle cx="9" cy="9" r="${R}" class="val" stroke-dasharray="${(pct / 100 * C).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 9 9)"/></svg><span>${used ? (exact ? '' : '~') + Math.round(pct) + '%' : '0%'}</span>`;
  el.title = L('Contexto: {0} de {1} tokens ({2}%){3}. Clique para detalhes.', used.toLocaleString(LOCALE), nCtx.toLocaleString(LOCALE), pct.toFixed(0), exact ? '' : L(', estimado'));
}

function fillCtxPop() {
  const pop = $('#pop-ctx'); pop.innerHTML = '';
  const add = (...xs) => pop.append(...xs.filter(Boolean));
  const c = cur();
  const { used, nCtx, exact } = ctxUsage(c);
  const at = Number(S.settings.compactAt) || 75;
  const pct = nCtx ? used / nCtx * 100 : 0;
  const sys = c?.ctxSys || 0;
  const row = (k, v) => h('div.ctx-row', null, h('span', null, k), h('b', null, v));
  const bar = h('div.ctx-bar', null, h('i', { style: { width: Math.min(100, pct) + '%' } }), h('em', { style: { left: at + '%' }, title: L('Compactação automática') }));
  bar.classList.add(pct >= at ? 'hi' : pct >= at * 0.75 ? 'mid' : 'lo');
  add(
    h('div.pop-title', null, L('Contexto da conversa')),
    bar,
    row(L('Em uso'), L('{0}{1} tokens ({2}%)', exact ? '' : '~', used.toLocaleString(LOCALE), pct.toFixed(0))),
    row(L('Limite do modelo'), nCtx.toLocaleString(LOCALE)),
    sys ? row(L('Instruções e ferramentas'), '~' + sys.toLocaleString(LOCALE)) : null,
    c?.ctxParts?.length ? h('div.ctx-parts', null, c.ctxParts.slice(0, 7).map(([k, n]) => h('div.ctx-row.sub', null, h('span', null, k), h('b', null, '~' + n.toLocaleString(LOCALE))))) : null,
    row(L('Compacta sozinho em'), S.settings.autoCompact ? `${at}% (${Math.round(nCtx * at / 100).toLocaleString(LOCALE)})` : 'desligado'),
    c?.compactions ? row(L('Compactações feitas'), String(c.compactions)) : null,
    c?.cacheLast ? row(L('Último pedido: do cache'), c.cacheLast.cache.toLocaleString(LOCALE)) : null,
    c?.cacheLast ? row(L('Último pedido: lido de novo'), c.cacheLast.read.toLocaleString(LOCALE)) : null,
    c?.cacheLast?.why ? h('div.ctx-why', null, L('Releu {0} tokens{1} porque {2}.', c.cacheLast.read.toLocaleString(LOCALE), c.cacheLast.ms ? L(' em {0}s', Math.round(c.cacheLast.ms / 1000)) : '', c.cacheLast.why)) : null,
    h('div.ctx-note', null, exact ? L('Medido pelo llama-server na última resposta.') : L('Estimativa: a medida exata chega com a próxima resposta.')),
    h('button.btn.sm', { disabled: !c || !c.messages.length, onclick: () => { closePops(); compactNow(c); } }, ic('archive'), L('Compactar agora')));
}


let noProgress = false;
/* ---- API externa (auditor, exploradores, tarefas de fundo) ---- */
/** IDs das APIs externas desta função, na ordem em que ficaram salvas.
   Configurações › API externa: cada função escolhe um provedor (true, do formato antigo, = o primeiro);
   o explorer aceita vários — as subtarefas do multi_explore se distribuem entre eles. */
function apiForAll(role) {
  const apis = (S.info?.apis || []).filter((a) => a.ready);
  const v = S.settings.apiRoles?.[role];
  const ids = Array.isArray(v) ? v : [v === true ? apis[0]?.id : v];
  return [...new Set(ids.map((id) => apis.find((a) => a.id === id)?.id).filter(Boolean))];
}
/** Por qual API externa esta função vai (id do provedor), ou null para o modelo local. */
function apiFor(role) {
  return apiForAll(role)[0] || null;
}
/** Abre a conexão com a API antes de precisar dela (no máximo uma vez a cada 6 s por API). */
const API_WARM = new Map();
function apiWarm(pid) {
  if (!pid || Date.now() - (API_WARM.get(pid) || 0) < 6000) return;
  API_WARM.set(pid, Date.now());
  api('/api/remote/warm?p=' + encodeURIComponent(pid), {}).catch(() => {});
}
function apiById(id) { return (S.info?.apis || []).find((a) => a.id === id); }
/** API externa que responde a conversa: o modelo dela (ou o ativo) é um perfil "remote:<id>" da lista de modelos. */
function mainApiForChat(conv = cur()) {
  const m = convModel(conv)?.model || '';
  if (!m.startsWith('remote:')) return null;
  const a = apiById(m.slice(7));
  return a && a.ready ? a : null;
}
/** O provedor é o NVIDIA NIM (40 pedidos por minuto)? */
function isNimApi(a) { return !!a && (a.nim === true || String(a.id || '').trim().toLowerCase() === 'nvidia' || String(a.base || '').toLowerCase().includes('integrate.api.nvidia.com')); }
/** Janela de contexto que vale para a conversa: a do modelo remoto dela, ou a do llama-server. */
function ctxLimit(conv = cur()) { return mainApiForChat(conv)?.context || S.nCtx || 0; }
/** Contagem do dia: pedidos, tokens e falhas (só neste navegador). */
function apiUse(add, pid) {
  const today = new Date().toISOString().slice(0, 10);
  let all = store.get('apiUse2', null);
  if (!all || all.day !== today) all = { day: today, by: {} };
  const u = all.by[pid || '_'] ||= { calls: 0, tokens: 0, fails: 0 };
  if (add) { u.calls += add.calls || 0; u.tokens += add.tokens || 0; u.fails += add.fails || 0; store.set('apiUse2', all); }
  return u;
}
/** Pede pela API externa; se ela falhar (sem internet, limite do plano grátis...), o chamador volta ao modelo local. */
async function streamApi(messages, tools, msg, signal, onDelta, extra = {}) {
  // prazo: uma API lenta não pode segurar o agente; estourou, o chamador volta para o modelo local
  const { _timeout = 60000, ...ex } = extra;
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let late = false;
  const timer = setTimeout(() => { late = true; ac.abort(); }, _timeout);
  try {
    await streamRaw(messages, tools, msg, ac.signal, onDelta, { ...ex, _remote: true });
    apiUse({ calls: 1, tokens: msg.usage?.total_tokens || 0 }, extra._p);
    msg.via = msg._fallbackModel || apiById(extra._p)?.model || '';
  } catch (e) {
    if (signal?.aborted) throw e;
    apiUse({ fails: 1 }, extra._p);
    if (late) throw new Error(L('a API {0} não respondeu em {1} s', apiLabel(apiById(extra._p) || {}), Math.round(_timeout / 1000)));
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function streamRaw(messages, tools, msg, signal, onDelta, extra = {}) {
  const { _fixed, _remote, _p, _think, ...rest } = extra;
  // return_progress: o llama-server conta quanto do prompt já leu (barra de progresso antes da 1ª palavra)
  const body = { messages, stream: true, ...(_remote ? {} : { cache_prompt: true }), ...rest };
  if (!noProgress && !_remote) body.return_progress = true;
  // O backend escolhe os campos do modo Pensar configurados para este provedor.
  if (_remote && _think && _think !== 'auto') body._think = _think;
  msg._t0 = Date.now(); msg._pp = null;
  if (tools.length) body.tools = tools;
  const st = S.settings;
  if (!_fixed) {
    if (st.temperature !== '' && st.temperature != null) body.temperature = Number(st.temperature);
    if (st.topP !== '' && st.topP != null) body.top_p = Number(st.topP);
    if (st.maxTokens !== '' && st.maxTokens != null && body.max_tokens == null) body.max_tokens = Number(st.maxTokens);
  }

  const post = () => fetch(_remote ? '/remote/v1/chat/completions?p=' + encodeURIComponent(_p || '') : '/v1/chat/completions', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Studio': '1' },
    body: JSON.stringify(body),
  });
  let res = await post();
  if (!res.ok) {
    let t = await res.text();
    // servidor que não é o llama.cpp e recusa o campo: tenta de novo sem ele e não manda mais
    if (body.return_progress && res.status >= 400 && res.status < 500 && /return_progress|unrecognized|unknown (field|param)|extra (inputs|fields)/i.test(t)) {
      noProgress = true; delete body.return_progress;
      res = await post();
      if (res.ok) t = null; else t = await res.text();
    }
    if (t != null) {
      let m = t; let waitMs = 0;
      try { const j = JSON.parse(t); m = j.error?.message || j.error || t;
        // Detecta erro de rate limit do NVIDIA NIM e extrai tempo de espera em segundos
        const rateLimitPattern = /Limite do NVIDIA NIM:.+Tente de novo em (\d+)s/;
        const enRateLimitPattern = /NVIDIA NIM limit:.+Retry in (\d+)s/;
        const matchPt = m.match(rateLimitPattern);
        const matchEn = m.match(enRateLimitPattern);
        if (matchPt) waitMs = parseInt(matchPt[1]) * 1000;
        else if (matchEn) waitMs = parseInt(matchEn[1]) * 1000;
        // Também tenta extrair do header Retry-After
        if (waitMs === 0) {
          const retryAfter = res.headers.get('Retry-After');
          if (retryAfter) waitMs = parseInt(retryAfter) * 1000;
        }
        // Armazena o tempo de rate limit na mensagem para a UI exibir
        msg._rateLimitWait = waitMs;
      } catch { /* texto */ }
      throw new Error(_remote ? L('API externa respondeu {0}: {1}', res.status, String(m).slice(0, 600)) : L('llama-server respondeu {0}: {1}', res.status, String(m).slice(0, 600)));
    }
  }
  const fbModel = res.headers?.get('x-studio-fallback-model');
  if (fbModel) msg._fallbackModel = fbModel;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
      if (j.prompt_progress) { msg._pp = j.prompt_progress; onDelta?.(); }
      const d = j.choices?.[0]?.delta;
      if (d) {
        if (d.reasoning_content) msg.reasoning += d.reasoning_content;
        else if (typeof d.reasoning === 'string') msg.reasoning += d.reasoning; // OpenRouter, Groq
        if (d.content) msg.content += d.content;
        for (const tc of d.tool_calls || []) {
          const idx = tc.index ?? 0;
          const slot = msg.tool_calls[idx] || (msg.tool_calls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name && !slot.function.name) slot.function.name = tc.function.name;
          if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
        }
      }
      if (j.usage) msg.usage = j.usage;
      if (j.timings) { msg.tps = j.timings.predicted_per_second; msg.tokens = j.timings.predicted_n; msg.ctxTokens = (j.timings.prompt_n || 0) + (j.timings.cache_n || 0) + (j.timings.predicted_n || 0); }
      onDelta?.();
    }
  }
}

function needsApproval(info, conv) {
  const mode = S.settings.approval;
  if (mode === 'never' || conv.autoApprove) return false;
  if (mode === 'all') return true;
  // conectores também: o que altera algo (pela anotação do servidor ou pelo nome: write_, delete_,
  // Execute..., Set...) pede confirmação, a não ser que você confie no conector
  if (info.source === 'mcp') return !!info.mutating && !(S.settings.trustedMcp || []).includes(info.server);
  return (info.source === 'builtin' || info.source === 'client') && info.mutating;
}
/* carregamento das ferramentas de cada conector:
   'auto'     sob demanda (catálogo + search_tools); citado no pedido, vai completo só se for pequeno
   'lazy'     sempre sob demanda: o modelo busca e carrega só as que vai usar
   'eager'    sempre completo (todas as ferramentas com os parâmetros) */
const MCP_LOAD = [['auto', L('Automático'), L('Sob demanda; citado no pedido, vai completo se tiver até 12 ferramentas visíveis.')], ['lazy', L('Sob demanda'), L('Só o catálogo; o modelo busca e carrega as ferramentas que for usar.')], ['eager', L('Completo'), L('Todas as ferramentas com os parâmetros, sempre. Gasta mais contexto.')]];
const EAGER_MAX = 12;
function mcpLoadOf(name) { return S.settings.mcpLoad?.[name] || 'auto'; }
function setMcpLoad(name, v) { S.settings.mcpLoad = { ...(S.settings.mcpLoad || {}), [name]: v }; if (v === 'auto') delete S.settings.mcpLoad[name]; store.set('settings', S.settings); }
function visibleToolCount(name) { const s = S.mcp.find((x) => x.name === name); return s ? s.tools.filter((t) => !(s.hidden || []).includes(t.name)).length : 0; }
/** Quais conectores selecionados vão com as ferramentas completas. */
function eagerList(selected, cited) {
  return selected.filter((n) => {
    const mode = mcpLoadOf(n);
    if (mode === 'eager') return true;
    if (mode === 'lazy') return false;
    return cited.includes(n) && visibleToolCount(n) <= EAGER_MAX;
  });
}
function trustMcp(name, on) {
  const set = new Set(S.settings.trustedMcp || []);
  if (on) set.add(name); else set.delete(name);
  S.settings.trustedMcp = [...set]; store.set('settings', S.settings);
}

function waitApproval(id, signal) {
  return new Promise((resolve) => {
    S.approvals.set(id, resolve);
    signal.addEventListener('abort', () => resolve('deny'), { once: true });
  });
}
