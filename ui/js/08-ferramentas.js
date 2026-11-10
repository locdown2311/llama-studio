/* llama studio - ferramentas internas (execute_code, explorar, histórico...) */
'use strict';

/* ============================================================ ferramentas internas */
const TOOL_INFO = {
  browser: { sec: L('Navegador'), title: L('Controlar o navegador'), short: 'navegador', desc: L('Abrir sites, ler páginas, clicar e preencher numa janela própria do Edge.') },
  computer: { sec: L('Computador'), title: L('Controlar o computador'), short: 'computador', desc: L('Ver janelas e elementos da tela, clicar, digitar e atalhos. Sempre pede permissão.') },
  read: { sec: L('Arquivos'), title: L('Ler arquivos'), short: 'ler', desc: L('Listar pastas, ler e procurar arquivos.') },
  edit: { sec: L('Arquivos'), title: L('Editar arquivos'), short: 'editar', desc: L('Trocar trechos de arquivos existentes.') },
  write: { sec: L('Arquivos'), title: L('Escrever arquivos'), short: 'escrever', desc: L('Criar arquivos e pastas.') },
  shell: { sec: L('Shell'), title: L('Executar comandos'), short: 'comandos', desc: L('Rodar comandos no PowerShell dentro da pasta de trabalho.') },
  code: { sec: L('Shell'), title: L('Executar código de ferramentas'), short: L('código'), desc: L('JavaScript que chama várias ferramentas e combina os resultados.') },
  history: { sec: L('Busca'), title: L('Lembrar conversas'), short: L('histórico'), desc: L('Procurar no histórico desta e das outras conversas.') },
  toolsearch: { sec: L('Busca'), title: L('Buscar ferramentas'), short: L('buscar ferramentas'), desc: L('Achar e ativar ferramentas de conectores sob demanda.') },
  todo: { sec: L('Planejamento'), title: L('Lista de tarefas'), short: 'tarefas', desc: L('O modelo escreve um plano e vai marcando cada passo; você acompanha acima da caixa de texto.') },
  notebook: { sec: L('Planejamento'), title: L('Caderno de investigação'), short: 'caderno', desc: L('O modelo registra achados (endereços, funções, hipóteses) num caderno do projeto e consulta antes de repetir trabalho.') },
  interface: { sec: L('Interface'), title: L('Personalizar a interface'), short: 'interface', desc: L('Temas, cores, fontes e layout do studio, pedidos ao modelo.') },
  video: { sec: L('Vídeo'), title: L('Edição de vídeo'), short: L('vídeo'), desc: L('Só nas conversas de um projeto de vídeo: editar gravações (cortes, layouts, legendas), ver quadros, gerar legendas e criar cenas animadas em equipe.') },
  explore: { sec: L('Subagentes'), title: L('Subagentes exploradores'), short: 'exploradores', desc: L('Investigação só de leitura com contexto próprio, vários em paralelo.') },
};
function enabledGroups() { return TOOL_GROUPS.filter((g) => S.settings.tools[g]); }
function visionOn() {
  if (S.settings.vision === 'on') return true;
  if (S.settings.vision !== 'auto') return false;
  // conversa numa API externa: vale a marca "Aceita imagens" do provedor
  const ma = typeof mainApiForChat === 'function' ? mainApiForChat() : null;
  return ma ? ma.vision === true : !!S.vision;
}

/** Executa uma ferramenta: as da interface aqui, as outras no servidor. */
const FILE_MUT = new Set(['write_file', 'edit_file', 'create_directory']);
/** Ferramentas só de leitura que podem rodar ao mesmo tempo (no agente e nos exploradores). */
const PARALLEL_READS = new Set(['read_file', 'list_directory', 'search_files', 'read_skill_file', 'recall_history']);

/** Desfaz as alterações de arquivo das mensagens de ferramenta dadas (da mais nova para a mais antiga). */
async function undoTools(conv, tmsgs) {
  const ids = []; const owners = [];
  for (const m of [...tmsgs].reverse()) {
    if (!m.cps?.length || m.undone) continue;
    ids.push(...[...m.cps].reverse()); owners.push(m);
  }
  if (!ids.length) return { done: [], errors: [] };
  const r = await api('/api/checkpoints/undo', { conv: conv.id, ids });
  const failed = new Set(r.errors.map((e) => e.id));
  for (const m of owners) if (!m.cps.some((c) => failed.has(c))) m.undone = true;
  saveConvs();
  if (wsOf(conv) === S.ws.path) refreshTree();
  return r;
}

/** Até onde a conversa já leu o arquivo (trechos "[linhas A-B de N]" dos resultados), a partir da linha 1. */
function readCoverage(conv, path, self) {
  const cut = conv.compactCut || 0; const want = normP(path);
  const calls = new Map();
  for (const m of conv.messages) if (m.role === 'assistant') for (const tc of m.tool_calls || []) calls.set(tc.id, tc);
  const spans = []; let total = 0;
  conv.messages.forEach((m, i) => {
    if (i < cut || m === self || m.role !== 'tool' || m.status !== 'ok') return;
    const tc = calls.get(m.tool_call_id); if (tc?.function?.name !== 'read_file') return;
    const a = parseArgs(tc.function.arguments) || {}; if (normP(a.path || '') !== want) return;
    const hm = /\[(?:linhas|lines) (\d+)-(\d+) (?:de|of) (\d+)/.exec(String(m.content).slice(0, 400));
    if (hm) { spans.push([+hm[1], +hm[2]]); total = +hm[3]; }
    const om = /^\[(\d+) (?:linhas|lines), /.exec(String(m.content)); if (om) total = total || +om[1];
  });
  let next = 1;
  for (const [a, b] of spans.sort((x, y) => x[0] - y[0])) if (a <= next && b >= next) next = b + 1;
  return { next, total };
}

/** Esta conversa já recebeu o sumário desse arquivo (read_file sem trecho de um arquivo grande)? */
function outlineGiven(conv, path, self) {
  const cut = conv.compactCut || 0; const want = normP(path);
  const calls = new Map();
  for (const m of conv.messages) if (m.role === 'assistant') for (const tc of m.tool_calls || []) calls.set(tc.id, tc);
  return conv.messages.some((m, i) => {
    if (i < cut || m === self || m.role !== 'tool' || m.status !== 'ok' || !/^\[\d+ (?:linhas|lines), .*(?:Sumário|Outline)/.test(String(m.content))) return false;
    const a = parseArgs(calls.get(m.tool_call_id)?.function?.arguments) || {};
    return a.offset == null && a.limit == null && normP(a.path || '') === want;
  });
}

async function execTool(name, args, info, tctx, tmsg) {
  try {
    if (['write_file', 'edit_file', 'create_directory'].includes(name) && args?.path && tctx.conv) {
      const why = busyBlock(tctx.conv, tmsg?.tool_call_id, joinPath(tctx.ws, args.path));
      if (why) return { content: why, isError: true };
    }
    // sumário já entregue e o modelo pede o arquivo inteiro de novo: em vez de repetir o sumário,
    // entrega o próximo trecho que ele ainda não leu (ou avisa que já leu tudo)
    if (name === 'read_file' && args?.path && args.offset == null && args.limit == null && tctx.conv && outlineGiven(tctx.conv, args.path, tmsg)) {
      const { next, total } = readCoverage(tctx.conv, args.path, tmsg);
      if (total && next > total) return { content: L('[Você já leu este arquivo inteiro nesta conversa (linhas 1-{0}); o conteúdo está mais acima. Use o que já tem, ou leia de novo só um trecho com offset/limit se ele mudou.]', total), isError: false };
      const r = await api('/api/tools/call', { name, arguments: { ...args, offset: next, limit: 600 }, allow: tctx.refs, ws: tctx.ws });
      return { ...r, content: L('[O sumário deste arquivo já está mais acima. Seguem as linhas a partir da {0}, que você ainda não leu; continue com offset para o resto.]\n', next) + r.content };
    }
    if (name === 'execute_code') return await runCode(args?.code ?? '', tctx, tmsg);
    if (name === 'video_scenes') return await runVideoScenes(args || {}, tctx, tmsg);
    if (name === 'video_look') return await runVideoLook(args || {}, tctx, tmsg);
    if (name === 'video_check') return await runVideoCheck(args || {}, tctx, tmsg);
    if (name === 'video_edit') return await runVideoEdit(args || {}, tctx, tmsg);
    if (name === 'video_find') return await runVideoFind(args || {}, tctx, tmsg);
    if (name === 'video_peaks') return await runVideoPeaks(args || {}, tctx, tmsg);
    if (name === 'video_thumbnail') return await runVideoThumbnail(args || {}, tctx, tmsg);
    if (name === 'video_captions') return await runVideoCaptions(args || {}, tctx, tmsg);
    if (name === 'recall_history') return recallHistory(args || {}, tctx.conv);
    if (name === 'update_todos') return await updateTodos(tctx.conv, args, tctx.signal);
    if (name === 'notebook') return await notebookTool(tctx.conv, args);
    if (name === 'search_tools') {
      const names = Array.isArray(args?.names) ? args.names : typeof args?.names === 'string' ? args.names.split(/[\s,]+/).filter(Boolean) : [];
      if (!names.length && !String(args?.query || '').trim()) return { content: L('Passe query (palavras-chave) para procurar, ou names para carregar.'), isError: true };
      const r = await api('/api/tools/search', { query: names.length ? '' : args?.query || '', names });
      if (!r.tools.length) return { content: L('Nenhuma ferramenta encontrada para essa busca.'), isError: false };
      // a busca só mostra; carregar é com names (um conector grande não entra inteiro no contexto)
      if (!names.length) return { content: L('Encontradas (ainda não carregadas). Para usar, chame search_tools com names=[...] das que precisar:\n') + r.tools.map((t) => `- ${t.name} (${t.server}): ${t.description}`).join('\n'), isError: false };
      tctx.conv.extraTools = [...new Set([...(tctx.conv.extraTools || []), ...r.tools.map((t) => t.name)])];
      return { content: L('Carregadas para os próximos passos:\n') + r.tools.map((t) => `- ${t.name} (${t.server}): ${t.description}`).join('\n'), isError: false };
    }
    const body = { name, arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}), allow: tctx.refs, ws: tctx.ws };
    // ponto de restauração: o servidor guarda o arquivo antes de mexer
    const owner = tmsg?._cpOwner || tmsg;
    if (FILE_MUT.has(name) && owner?.tool_call_id && tctx.conv) {
      const cps = (owner.cps ||= []);
      body.cp = cps.length ? `${owner.tool_call_id}_${cps.length}` : owner.tool_call_id;
      body.conv = tctx.conv.id;
      cps.push(body.cp);
    }
    const r = await api('/api/tools/call', body);
    return r;
  } catch (e) { return { content: L('Erro: ') + e.message, isError: true }; }
}

function recallHistory(args, conv) {
  const words = String(args.query || '').toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return { content: L('Informe o que procurar.'), isError: true };
  const convs = (args.scope === 'atual' || args.scope === 'current') ? [conv] : S.convs;
  const hits = [];
  for (const c of convs) {
    c.messages.forEach((m, i) => {
      if (m.hidden) return;
      const text = m.role === 'user' ? m.content : m.role === 'assistant' ? splitThink(m.content).text : m.role === 'tool' ? m.content : '';
      if (!text) return;
      const low = text.toLowerCase();
      const score = words.filter((w) => low.includes(w)).length;
      if (!score) return;
      const at = Math.max(0, low.indexOf(words.find((w) => low.includes(w))) - 160);
      hits.push({ score, c, i, role: m.role, t: m.ts || c.updatedAt, snip: (at ? '...' : '') + text.slice(at, at + 420).replace(/\s+/g, ' ') + (text.length > at + 420 ? '...' : '') });
    });
  }
  hits.sort((a, b) => b.score - a.score || b.t - a.t);
  const top = hits.slice(0, Math.min(20, Number(args.limit) || 8));
  if (!top.length) return { content: L('Nada encontrado no histórico.'), isError: false };
  const role = { user: L('usuário'), assistant: 'assistente', tool: 'ferramenta' };
  return { content: top.map((h) => `### ${h.c.title} (${fmtStamp(h.t)}, ${role[h.role]})\n${h.snip}`).join('\n\n'), isError: false };
}

/** Executa JavaScript num Worker isolado; tool() chama as ferramentas de verdade. */
function runCode(code, tctx, tmsg) {
  const src = `
    const pending = new Map(); let seq = 0;
    self.tool = (name, args = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); postMessage({ t: 'call', id, name, args }); });
    const fmt = (a) => a.map((x) => typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()).join(' ');
    console.log = console.info = console.warn = console.error = (...a) => postMessage({ t: 'log', s: fmt(a) });
    onmessage = async (e) => {
      const m = e.data;
      if (m.t === 'run') {
        try {
          const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
          const v = await new AsyncFn(m.code)();
          postMessage({ t: 'done', v: v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v, null, 2) });
        } catch (err) { postMessage({ t: 'error', s: String((err && err.stack) || err) }); }
      } else if (m.t === 'result') {
        const p = pending.get(m.id); pending.delete(m.id);
        if (m.error) p.rej(new Error(m.error)); else p.res(m.content);
      }
    };`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const w = new Worker(url);
  const logs = []; let calls = 0;
  tmsg._sub = [];
  return new Promise((resolve) => {
    let done = false;
    const logText = () => (logs.length ? '[console]\n' + logs.join('\n').slice(-20000) : '');
    const finish = (content, isError) => { if (done) return; done = true; clearTimeout(timer); w.terminate(); URL.revokeObjectURL(url); resolve({ content: content || L('(sem saída)'), isError }); };
    const timer = setTimeout(() => finish([logText(), L('Tempo esgotado (120 s).')].filter(Boolean).join('\n\n'), true), 120000);
    tctx.signal.addEventListener('abort', () => finish('Cancelado.', true), { once: true });
    w.onmessage = async (e) => {
      const m = e.data;
      if (m.t === 'log') logs.push(m.s);
      else if (m.t === 'call') {
        let r;
        if (++calls > 200) r = { content: L('Limite de 200 chamadas por execução.'), isError: true };
        else if (['execute_code', 'explore'].includes(m.name)) r = { content: L('{0} não pode ser chamada de dentro do código.', m.name), isError: true };
        else {
          const step = { name: m.name, summary: toolSummary(m.name, m.args), status: 'running' };
          tmsg._sub.push(step); scheduleRender();
          r = await execTool(m.name, m.args, {}, tctx, { _cpOwner: tmsg });
          step.status = r.isError ? 'error' : 'ok'; scheduleRender();
        }
        if (!done) w.postMessage({ t: 'result', id: m.id, content: r.content, error: r.isError ? r.content : null });
      } else if (m.t === 'done') finish([logText(), m.v != null ? '[retorno]\n' + m.v : ''].filter(Boolean).join('\n\n'), false);
      else if (m.t === 'error') finish([logText(), '[erro]\n' + m.s].filter(Boolean).join('\n\n'), true);
    };
    w.onerror = (e) => finish('[erro]\n' + (e.message || L('falha ao executar o código')), true);
    w.postMessage({ t: 'run', code });
  });
}

/* ---- equipe de subagentes (exploradores e escritores de cena) ----
   As APIs marcadas em Configurações › API externa › Subagentes exploradores, na ordem de preferência. */

/** Estado de um subagente: a API em que ele está, as que já tentou e o slot local (se cair no modelo local). */
function teamStart(apiId) {
  const st = { tried: new Set(), remote: apiId || explorerNext(new Set()), extra: undefined, slotTried: false };
  if (st.remote) st.tried.add(st.remote);
  return st;
}
function teamRunOn(st) { return st.remote ? { api: apiLabel(apiById(st.remote) || {}), model: apiById(st.remote)?.model || '' } : { local: true }; }
/** Quem fez a parte, para o relatório: "Groq · modelo" ou "modelo local". */
function teamBy(sm) { return sm.runOn?.local ? L('modelo local') : `${sm.runOn?.api || ''} · ${sm.via || sm.runOn?.model || ''}`; }

/** Um pedido de um subagente. Se a API falhar (limite do plano, fora do ar), a próxima da equipe assume do
    ponto em que parou; o modelo local só entra quando nenhuma responde. */
async function teamStep(st, msgs, tools, m, tctx, tmsg) {
  while (st.remote) {
    try {
      await streamApi(msgs, tools, m, tctx.signal, null, { _p: st.remote, _timeout: 120000 });
      tmsg.via = m.via; tmsg.apiTokens = (tmsg.apiTokens || 0) + (m.usage?.total_tokens || 0); scheduleRender();
      return;
    } catch (e) {
      if (tctx.signal.aborted) throw e;
      apiCool(st.remote);
      const from = apiLabel(apiById(st.remote) || {});
      tmsg.apiErr = String(e.message || e).slice(0, 200);
      m.content = ''; m.reasoning = ''; m.tool_calls = [];
      st.remote = explorerNext(st.tried);
      if (st.remote) { st.tried.add(st.remote); tmsg.runOn = { ...teamRunOn(st), moved: from }; }
      else tmsg.runOn = { local: true, fell: true };
      scheduleRender();
    }
  }
  // fora do slot da conversa (ela fica esperando e não pode perder o cache)
  if (!st.slotTried) { st.slotTried = true; const s = await sideSlot(tctx.conv); st.extra = s != null ? { id_slot: s } : undefined; }
  await streamRaw(msgs, tools, m, tctx.signal, null, st.extra);
}

/** Roda `count` tarefas com a equipe: cada API é um trabalhador (com tantas vagas quantas ela aguenta) que
    puxa a próxima tarefa da fila ao terminar a dele. As rápidas fazem mais; ninguém espera um lote inteiro.
    runOne(i, apiId): apiId null = modelo local (sem API na equipe, ou todas falharam). */
async function teamRun(count, runOne, signal, limit = count) {
  let next = 0, running = 0;
  const worker = async (apiId) => {
    while (next < count && !signal.aborted) {
      if (apiId && apiCooled(apiId)) return;
      if (running >= limit) { await new Promise((r) => setTimeout(r, 150)); continue; }
      const i = next++;
      running++;
      try { await runOne(i, apiId); } finally { running--; }
    }
  };
  const team = apiForAll('explorer').filter((id) => !apiCooled(id));
  // as vagas se alternam entre as APIs (1ª de cada, depois a 2ª de cada...): as primeiras tarefas se espalham
  const seats = [];
  for (let k = 0; k < 8; k++) for (const id of team) if (k < explorerConc(id)) seats.push(id);
  await Promise.all(seats.slice(0, count).map((id) => worker(id)));
  // sobrou fila (todas as APIs saíram, ou não há nenhuma): o modelo local termina
  if (next < count && !signal.aborted) {
    const n = Math.max(1, Math.min(limit, team.length ? 1 : count, count - next));
    await Promise.all(Array.from({ length: n }, () => worker(null)));
  }
}

/** Subagente explorador: ciclo próprio, só ferramentas de leitura, devolve um relatório.
   apiId: força uma API externa específica (o multi_explore distribui as subtarefas entre as escolhidas). */
async function runExplorer(args, tctx, tmsg, apiId) {
  const only = ['list_directory', 'read_file', 'search_files'];
  if (tctx.groups.includes('browser')) only.push('browser_navigate', 'browser_read', 'browser_click', 'browser_back');
  if (tctx.groups.includes('history')) only.push('recall_history');
  const { tools } = await api('/api/tools', { groups: ['read', 'browser', 'history'], mcp: [], skills: [], only });
  // conectores da conversa (decompilador, debugger...): o explorador usa as ferramentas que só leem
  const mcpMeta = {};
  if (tctx.mcp?.length) {
    try {
      const r = await api('/api/tools', { groups: [], mcp: tctx.mcp, skills: [], lazy: false, eager: tctx.mcp, full: tctx.mcp });
      let ro = r.tools.filter((t) => r.meta[t.function.name]?.source === 'mcp' && r.meta[t.function.name]?.mutating === false);
      // no modelo local cada definição pesa no contexto: só as que a conversa já carregou, se forem muitas
      if (!apiFor('explorer') && ro.length > 25) {
        const used = new Set([...(tctx.conv.extraTools || []), ...tctx.conv.messages.filter((m) => m.role === 'tool').map((m) => m.name)]);
        ro = ro.filter((t) => used.has(t.function.name));
      }
      for (const t of ro) { tools.push(t); only.push(t.function.name); mcpMeta[t.function.name] = r.meta[t.function.name]; }
    } catch { /* conectores fora: segue só com as ferramentas de leitura */ }
  }
  const sys = L('Você é um subagente explorador do llama studio. Investigue a tarefa usando só as ferramentas de leitura disponíveis. ')
    + L('Seja eficiente: procure antes de ler, leia só o necessário. Não faça perguntas. Quando terminar, responda com um relatório objetivo em português: ')
    + L('o que encontrou, com caminhos de arquivo, trechos curtos relevantes e URLs. Se algo não existir, diga.\n\n') + L('Use só as ferramentas que você recebeu (aqui não existem update_todos, search_tools nem nada que escreva).\n\n')
    // o contexto da conversa, sem as partes que falam de ferramentas que o explorador não tem
    + tctx.ctxText.split('\n\n').filter((p) => !p.startsWith('The user turned on the sk') && !p.startsWith('O usuário ativou as skills')
      && !/\b(update_todos|search_tools|execute_code|run_command|edit_file|write_file|notebook|explore)\b/.test(p)).join('\n\n');
  const msgs = [{ role: 'system', content: sys }, { role: 'user', content: args.task + (args.where ? L('\n\nComece por: {0}', args.where) : '') }];
  tmsg._sub = [];
  // fora do slot da conversa (ela fica esperando o relatório e não pode perder o cache)
  // equipe: a API indicada (multi_explore) ou a primeira da ordem que não falhou há pouco
  const st = teamStart(apiId);
  // onde o subagente roda, para o cartão mostrar (API e modelo, ou local)
  tmsg.runOn = teamRunOn(st);
  tmsg.apiTokens = 0;
  const max = Math.max(3, Number(S.settings.explorerSteps) || 20);
  for (let step = 0; step <= max; step++) {
    if (tctx.signal.aborted) return { content: 'Cancelado.', isError: true };
    const last = step === max;
    if (last) msgs.push({ role: 'user', content: L('Limite de passos atingido. Escreva agora o relatório final com o que já encontrou.') });
    const m = { content: '', reasoning: '', tool_calls: [] };
    await teamStep(st, msgs, last ? [] : tools, m, tctx, tmsg);
    const calls = m.tool_calls.filter((t) => t && t.function?.name);
    calls.forEach((t) => { if (!t.id) t.id = 'call_' + uid(); });
    const text = splitThink(m.content).text;
    if (!calls.length) { tmsg.sub = tmsg._sub.map((x) => ({ name: x.name, summary: x.summary, status: x.status })); return { content: text.trim() || L('O subagente terminou sem relatório.'), isError: false }; }
    msgs.push({ role: 'assistant', content: text, tool_calls: calls.map((t) => ({ id: t.id, type: 'function', function: { name: t.function.name, arguments: validArgs(t.function.arguments, () => {}) } })) });
    // leituras do mesmo passo rodam juntas; o navegador (uma página só) vai em ordem
    const results = new Array(calls.length);
    const pend = [];
    for (let i = 0; i < calls.length; i++) {
      const t = calls[i];
      const a = parseArgs(t.function.arguments) || {};
      const st = { name: t.function.name, summary: toolSummary(t.function.name, a), status: 'running' };
      tmsg._sub.push(st); scheduleRender();
      const run = () => (only.includes(t.function.name) ? execTool(t.function.name, a, mcpMeta[t.function.name] || {}, tctx, {}) : Promise.resolve({ content: L('Ferramenta não disponível para o explorador. Use uma destas: {0}', only.join(', ')), isError: true }))
        .then((r) => { results[i] = r; st.status = r.isError ? 'error' : 'ok'; scheduleRender(); });
      if (PARALLEL_READS.has(t.function.name)) pend.push(run());
      else { await Promise.all(pend); pend.length = 0; await run(); }
    }
    await Promise.all(pend);
    calls.forEach((t, i) => msgs.push({ role: 'tool', tool_call_id: t.id, content: String(results[i].content).slice(0, 24000) }));
  }
  return { content: L('O subagente não concluiu.'), isError: true };
}

/** multi_explore: dispara vários subagentes em paralelo e consolida os relatórios. */
async function runMultiExplore(args, tctx, tmsg) {
  const task = String(args.task || '').trim();
  const subs = Array.isArray(args.subtasks) ? args.subtasks.filter((s) => s && String(s.task).trim()) : [];
  if (!subs.length) return { content: L('multi_explore precisa de pelo menos uma subtarefa.'), isError: true };
  // prioridade: arg explícito > config do usuário > ilimitado
  let limit = Number(args.maxConcurrentExplorers);
  if (!Number.isFinite(limit) || limit < 1) limit = Number(S.settings?.maxConcurrentExplorers) || subs.length;
  const mainId = tmsg.tool_call_id;
  // o cartão do multi_explore mostra cada agente, onde ele rodou e o relatório dele
  tmsg.subs = subs.map((sub, idx) => ({
    tool_call_id: `${mainId}-sub-${idx}`,
    agentId: `${tmsg.agentId || 'a'}s${idx}`,
    status: 'queued',
    task: String(sub.task),
    where: String(sub.where || ''),
  }));
  scheduleRender();
  const all = new Array(subs.length);
  await teamRun(subs.length, async (i, apiId) => {
    const sub = subs[i], subMsg = tmsg.subs[i];
    subMsg.status = 'running'; scheduleRender();
    let r;
    try { r = await runExplorer({ task: sub.task, where: sub.where || '' }, tctx, subMsg, apiId); }
    catch (e) { if (tctx.signal.aborted) throw e; r = { content: String(e.message || e), isError: true }; }
    subMsg.status = r.isError ? 'error' : 'ok';
    subMsg.content = r.content;
    scheduleRender();
    all[i] = { task: String(sub.task), where: String(sub.where || ''), content: r.content, isError: !!r.isError, by: teamBy(subMsg) };
  }, tctx.signal, limit);
  if (tctx.signal.aborted) return { content: 'Cancelado.', isError: true };
  const sections = all.map((p, i) => {
    const head = `## Agente ${i + 1} (${p.by}): ${p.task}${p.where ? ' (' + p.where + ')' : ''}`;
    return `${head}\n${p.content}`;
  }).join('\n\n---\n\n');
  return {
    content: `# Pesquisa: ${task}\n\n${sections}\n\n---\n\nResponda ao usuário com um relatório consolidado citando achados de cada agente. Se algum agente falhou, mencione e peça se deve reenviar.`,
    isError: false,
  };
}