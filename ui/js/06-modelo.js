/* llama studio - raciocínio, cache dos slots e medidor de contexto */
'use strict';

/* ============================================================ raciocínio por conversa e slot */
const THINK_OPTS = [
  ['auto', 'Padrão do modelo', 'O modelo decide (como vem no template dele).'],
  ['on', 'Pensar', 'Raciocina antes de responder. Melhor para tarefas difíceis.'],
  ['off', 'Responder direto', 'Sem raciocínio: bem mais rápido para pedidos simples.'],
];
/* ------------------------------------------------------------ modo plano */
// O modelo só investiga e escreve um plano; nada é alterado até o usuário aprovar.
// O aviso vai na mensagem do usuário (e não no prompt de sistema) para não invalidar o cache.
const PLAN_NOTE = '\n\n[Modo plano] Não altere nada ainda: não escreva nem edite arquivos, não rode comandos e não use ferramentas que mudem algo. '
  + 'Investigue só com leitura (e subagentes exploradores, se ajudar) e responda com um plano numerado: o que vai mudar, em quais arquivos, em que ordem, os riscos e como verificar. '
  + 'Termine perguntando se pode executar.';
function planOf(c) { return c ? !!c.plan : !!S.draftPlan; }
function togglePlan() {
  const c = cur();
  if (c) { c.plan = !c.plan; saveConvs(); } else S.draftPlan = !S.draftPlan;
  updatePickers();
  toast(planOf(c) ? 'Modo plano: o modelo investiga e propõe um plano, sem alterar nada' : 'Modo plano desligado');
}
/** A resposta em `b` veio de um pedido em modo plano e o plano ainda não foi executado. */
function planPending(conv, b) {
  if (!conv.plan) return false;
  for (let i = b.start - 1; i >= 0; i--) { const m = conv.messages[i]; if (m.role === 'user' && !m.hidden) return !!m.plan; }
  return false;
}
async function runPlan(conv) {
  conv.plan = false; saveConvs(); updatePickers();
  const text = 'Plano aprovado. Pode executar.';
  await submit(conv, { content: text, parts: [{ t: 'text', v: text }], refs: [] });
}

function thinkOf(c) { return (c ? c.think || c.autoThink : S.draftThink) || 'auto'; }
function requestExtras(conv) {
  const x = {};
  const t = thinkOf(conv);
  if (t !== 'auto') x.chat_template_kwargs = { enable_thinking: t === 'on' };
  if (t === 'off') x.reasoning_budget = 0;
  if (conv._slot != null) x.id_slot = conv._slot;
  return x;
}
function fillThinkPop() {
  const pop = $('#pop-think'); pop.innerHTML = '';
  const cur0 = thinkOf(cur());
  pop.append(h('div.pop-head', null, h('span', null, 'Raciocínio nesta conversa')));
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
function kvFile(c) { return `${c.id}-${kvKey()}.bin`; }

async function assignSlot(conv) {
  conv._slot = null;
  const sl = S.slots;
  if (S.settings.kvSave === false || !sl.ok || !S.nSlots || !S.model) return;
  const key = kvKey();
  const started = S.llama?.startedAt || 0;
  if (sl.key !== key || sl.started !== started) { sl.key = key; sl.started = started; sl.owner = []; sl.used = []; }
  const busy = new Set([...S.runs.keys()].filter((id) => id !== conv.id).map((id) => S.convs.find((c) => c.id === id)?._slot).filter((x) => x != null));
  const mine = sl.owner.indexOf(conv.id);
  if (mine >= 0 && !busy.has(mine)) { conv._slot = mine; sl.used[mine] = Date.now(); return; }
  let best = -1;
  for (let k = 0; k < S.nSlots; k++) {
    if (busy.has(k)) continue;
    if (!sl.owner[k]) { best = k; break; }
    if (best < 0 || (sl.used[k] || 0) < (sl.used[best] || 0)) best = k;
  }
  if (best < 0) return;
  const prev = sl.owner[best] && sl.owner[best] !== conv.id ? S.convs.find((c) => c.id === sl.owner[best]) : null;
  try {
    if (prev && (prev.ctx?.tokens || 0) >= 3000) {
      conv._waitingModel = true; conv._waitText = 'Guardando o cache da outra conversa...'; scheduleRender();
      await api(`/slots/${best}?action=save`, { filename: kvFile(prev) });
      (prev.kv ||= {})[key] = Date.now();
      api('/api/kvcache/prune', { keep: 6 }).catch(() => {});
    }
    if (conv.kv?.[key]) {
      conv._waitingModel = true; conv._waitText = 'Recuperando o cache desta conversa...'; scheduleRender();
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
  const skillsAt = ctxText.indexOf('O usuário ativou as skills');
  add('Instruções', tk(system) - (catalog ? tk(catalog) : 0) - (skillsAt >= 0 ? tk(ctxText.slice(skillsAt)) : 0));
  if (skillsAt >= 0) add('Habilidades', tk(ctxText.slice(skillsAt)));
  if (catalog) add('Catálogo de conectores', tk(catalog));
  for (const t of tools) {
    const m = meta[t.function.name] || {};
    add(m.source === 'mcp' ? 'Conector ' + m.server : 'Ferramentas internas', tk(t));
  }
  return Object.entries(parts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
}

/** Tokens ocupados: a última medida do servidor + estimativa do que entrou depois. */
function ctxUsage(conv) {
  const nCtx = S.nCtx || 0;
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
  el.title = `Contexto: ${used.toLocaleString('pt-BR')} de ${nCtx.toLocaleString('pt-BR')} tokens (${pct.toFixed(0)}%)${exact ? '' : ', estimado'}. Clique para detalhes.`;
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
  const bar = h('div.ctx-bar', null, h('i', { style: { width: Math.min(100, pct) + '%' } }), h('em', { style: { left: at + '%' }, title: 'Compactação automática' }));
  bar.classList.add(pct >= at ? 'hi' : pct >= at * 0.75 ? 'mid' : 'lo');
  add(
    h('div.pop-title', null, 'Contexto da conversa'),
    bar,
    row('Em uso', `${exact ? '' : '~'}${used.toLocaleString('pt-BR')} tokens (${pct.toFixed(0)}%)`),
    row('Limite do modelo', nCtx.toLocaleString('pt-BR')),
    sys ? row('Instruções e ferramentas', '~' + sys.toLocaleString('pt-BR')) : null,
    c?.ctxParts?.length ? h('div.ctx-parts', null, c.ctxParts.slice(0, 7).map(([k, n]) => h('div.ctx-row.sub', null, h('span', null, k), h('b', null, '~' + n.toLocaleString('pt-BR'))))) : null,
    row('Compacta sozinho em', S.settings.autoCompact ? `${at}% (${Math.round(nCtx * at / 100).toLocaleString('pt-BR')})` : 'desligado'),
    c?.compactions ? row('Compactações feitas', String(c.compactions)) : null,
    h('div.ctx-note', null, exact ? 'Medido pelo llama-server na última resposta.' : 'Estimativa: a medida exata chega com a próxima resposta.'),
    h('button.btn.sm', { disabled: !c || !c.messages.length, onclick: () => { closePops(); compactNow(c); } }, ic('archive'), 'Compactar agora'));
}


let noProgress = false;
async function streamRaw(messages, tools, msg, signal, onDelta, extra = {}) {
  const { _fixed, ...rest } = extra;
  // return_progress: o llama-server conta quanto do prompt já leu (barra de progresso antes da 1ª palavra)
  const body = { messages, stream: true, cache_prompt: true, ...rest };
  if (!noProgress) body.return_progress = true;
  msg._t0 = Date.now(); msg._pp = null;
  if (tools.length) body.tools = tools;
  const st = S.settings;
  if (!_fixed) {
    if (st.temperature !== '' && st.temperature != null) body.temperature = Number(st.temperature);
    if (st.topP !== '' && st.topP != null) body.top_p = Number(st.topP);
    if (st.maxTokens !== '' && st.maxTokens != null) body.max_tokens = Number(st.maxTokens);
  }

  const post = () => fetch('/v1/chat/completions', {
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
      let m = t; try { const j = JSON.parse(t); m = j.error?.message || j.error || t; } catch { /* texto */ }
      throw new Error(`llama-server respondeu ${res.status}: ${String(m).slice(0, 600)}`);
    }
  }
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
        if (d.content) msg.content += d.content;
        for (const tc of d.tool_calls || []) {
          const idx = tc.index ?? 0;
          const slot = msg.tool_calls[idx] || (msg.tool_calls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name && !slot.function.name) slot.function.name = tc.function.name;
          if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
        }
      }
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
const MCP_LOAD = [['auto', 'Automático', 'Sob demanda; citado no pedido, vai completo se tiver até 12 ferramentas visíveis.'], ['lazy', 'Sob demanda', 'Só o catálogo; o modelo busca e carrega as ferramentas que for usar.'], ['eager', 'Completo', 'Todas as ferramentas com os parâmetros, sempre. Gasta mais contexto.']];
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
