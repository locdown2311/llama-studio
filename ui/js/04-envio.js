/* llama studio - envio, recursos automáticos, lista de tarefas e fila */
'use strict';

/* ============================================================ envio e ciclo do agente */
/** Lê o editor como uma mensagem pronta para enviar (ou null). */
function takeEditor() {
  if (S.refs.some((r) => r.status === 'loading' && refPillEls(r).length)) { toast(L('Aguarde: ainda localizando os arquivos arrastados.')); return null; }
  const parts = readEditor();
  if (!parts.length) return null;
  const content = partsToContent(parts);
  const refs = parts.filter((p) => p.kind === 'file').map((p) => ({ name: p.name, path: p.path, dir: p.dir }));
  if (S.refs.some((r) => r.status === 'missing' && refPillEls(r).length)) toast(L('Arquivos não localizados ficaram de fora.'));
  editor().innerHTML = ''; S.refs = []; savedRange = null;
  return { content, parts, refs };
}

async function send(now) {
  const busy = running(cur());
  if (busy && editorEmpty()) { stop(); return; }
  const item = takeEditor();
  if (!item) return;
  const conv = cur() || newConv();
  if (busy) { enqueue(conv, { ...item, ...(now ? { now: true } : {}) }); return; }
  await submit(conv, item);
}

/** Mensagens da fila marcadas para entrar no próximo passo (sem esperar a resposta inteira acabar). */
function takeUrgent(conv) {
  const q = conv.queue || [];
  const out = q.filter((it) => it.now);
  if (!out.length) return [];
  conv.queue = q.filter((it) => !it.now);
  saveConvs(); drawQueue();
  return out;
}

/** Recria o conteúdo de uma mensagem (texto e etiquetas) para a caixa de texto. */
function partsToNodes(parts) {
  const out = [];
  for (const p of parts) {
    if (p.t === 'text') {
      p.v.split('\n').forEach((line, i) => { if (i) out.push(document.createElement('br')); if (line) out.push(document.createTextNode(line)); });
    } else if (p.kind === 'file') {
      const r = { id: uid(), name: p.name, path: p.path, dir: !!p.dir, status: 'ok' };
      S.refs.push(r);
      out.push(makePill({ kind: 'file', ref: r.id, name: p.name }), document.createTextNode(' '));
    } else out.push(makePill(p), document.createTextNode(' '));
  }
  return out;
}

function editorEmpty() { return !readEditor().length; }

async function submit(conv, item) {
  const { content, parts, refs } = item;
  conv.messages.push({ role: 'user', content, parts, refs, ts: Date.now(), ...(conv.plan ? { plan: true } : {}) });
  if (conv.title === 'Nova conversa' || conv.title === L('Nova conversa')) {
    const plain = parts.filter((p) => p.t === 'text').map((p) => p.v).join(' ').replace(/\s+/g, ' ').trim();
    conv.title = (plain || parts.map((p) => p.name).filter(Boolean).join(', ')).slice(0, 60);
  }
  conv.updatedAt = Date.now();
  if (autoLevelOf(conv) !== 'desligado') await autoRoute(conv, conv.messages[conv.messages.length - 1]);
  saveConvs(); renderConvList();
  if (conv.id === S.curId) { renderChatTitle(); renderMessages(false); updatePickers(); }
  await runAgent(conv);
}

/* ============================================================ recursos automáticos */
// Lê o pedido (sem o modelo: só padrões de texto, zero tokens) e liga para esta conversa o que
// ele vai precisar: grupos de ferramentas, conectores, habilidades e o raciocínio. Só acrescenta,
// nunca desliga o que você escolheu. O que foi ligado aparece na mensagem, com "desfazer".
const ROUTES = [
  // strong: um sinal basta; weak: precisa de dois sinais diferentes (evita "serial killer", "patch na moda")
  { id: 're', label: L('Engenharia reversa'), think: 'on', groups: ['notebook', 'explore', 'read'], mcp: /dbg|debug|ida\b|ghidra|binja|binary.?ninja|radare|r2|cheat.?engine|^ce$|dnspy|ilspy|dotpeek|de4dot|\bjeb\b|^rea$|decompil|frida/i, skills: /dbg|debug|revers|engenharia/i,
    strong: /x(32|64)dbg|\bdbg\b|\bdebugger\b|breakpoint|dnspy|ilspy|dotpeek|de4dot|descompil|decompil|\bassembl(y|ies) \.net|\.net assembl|\bil\b.{0,20}(patch|m[eé]todo)|\bbps?\b|\bdlls?\b|endere[cç]o\s+(0x)?[0-9a-f]{6,}|desassembl|disassembl|\bida\b|ghidra|radare|cheat.?engine|(?<!(erro|error|c[oó]digo|code)\s{0,3})\b0x[0-9a-f]{4,}\b|\.(exe|dll|sys)\b|anti.?debug|desempacot|unpack|\bupx\b|\bsub_[0-9a-f]{3,}|\bdump\b.{0,30}(m[oó]dulo|mem[oó]ria|processo)|\b[er](ax|bx|cx|dx|si|di)\b/i,
    weak: /debug|depura|engenharia reversa|reverse|assembly|registrador|\bpatch|offset|\bserial\b|licen[cç]a|execut[aá]vel|bin[aá]rio|mem[oó]ria|processo|\bstrings?\b|referen[cç]i|m[oó]dulo|\bdump\b|senha|compar[ae]|rotina|criptograf|\bimports?\b|\bexports?\b|endere[cç]o|ponteiro|\bhook|inje[cç]|\bjogo\b|registers?\b|license|executable|binary|memory|\bprocess|\bmodules?\b|password|routine|encrypt|address|pointer|inject|\bgame\b/gi },
  { id: 'code', label: L('Programação'), groups: ['read', 'edit', 'write', 'shell', 'explore'],
    strong: /\.(rs|js|mjs|ts|tsx|jsx|py|cs|cpp|hpp|go|java|kt|php|rb|sh|ps1|lua|sql|html?|css|vue|svelte)\b|\b(sql|query|queries)\b|\b(cargo|npm|pnpm|yarn|pip|pytest|gradle|maven|dotnet|cmake)\b|stack.?trace|\bcommit|\bgit\b|pull request|\b(react|vue|svelte|django|flask|express|node\.?js)\b|typescript|javascript|python|\brust\b|c\+\+|\bc#|\bsrc\//i,
    weak: /c[oó]digo|compil|\bbuild\b|\bbug|\berros?\b|exce[cç][aã]o|refator|\btestes?\b|script|componente|fun[cç][aã]o|m[oó]dulo|classe|\bapi\b|deploy|login|programa[cç][aã]o|\bmerge\b|\bbranch\b|quebr|\bcode\b|\btests?\b|compil|exception|refactor|\bfunctions?\b|\bclass(es)?\b|programming|\bbroke|crash/gi },
  { id: 'web', label: L('Web'), groups: ['browser'],
    strong: /https?:\/\/|www\.|\bsites?\b|pesquis|procur[ae] na (web|internet)|na internet|\bgoogle\b(?!\s*(drive|docs|sheets|agenda|calendar|fotos|photos))|not[ií]cias?|cota[cç][aã]o|previs[aã]o do tempo|naveg|search (the )?(web|internet)|look (it )?up online|on the internet|\bnews\b|weather forecast|\bbrows(e|ing)\b/i,
    weak: /pre[cç]os?|\bhoje\b|p[aá]gina|\blink|atual|tutorial|lan[cç]amento|\blojas?\b|promo[cç]|onde comprar|\bprices?\b|\btoday\b|\bpages?\b|\bcurrent\b|\blatest\b|\breleases?\b|\bstores?\b|\bdeals?\b|where to buy/gi },
  { id: 'pc', label: L('Computador'), groups: ['computer'],
    strong: /abr[ae] o (app|programa|aplicativo)|\bclic(a|ar|ue|k)\b|\bna (minha )?tela\b|tir[ae]r? (um )?print|captura de tela|fech[ae]r? a janela|\bdigit[ae]r?\b.{0,30}\b(campo|caixa|barra)\b|open the (app|program|application)|\bclick\b|on (my )?screen|take a screenshot|screenshot|close the window|\btype\b.{0,30}\b(field|box|bar)\b/i,
    weak: /photoshop|spotify|\bpaint\b|\bword\b|\bexcel\b|bot[aã]o|\bmenu\b|aplicativo|\bbuttons?\b|\bapp\b|application/gi },
  { id: 'files', label: L('Arquivos'), groups: ['read', 'write', 'shell'],
    need: /\b(arquivos?|pastas?|fotos?|planilhas?|pdfs?|zip|documentos?|imagens?|v[ií]deos?|prints?|files?|folders?|photos?|spreadsheets?|documents?|images?|screenshots?)\b/i,
    strong: /\.(pdf|zip|rar|7z|docx?|xlsx?|csv|txt|png|jpe?g|mp4|mp3)\b|\b(docx|xlsx|pptx)\b|\bdownloads\b|[aá]rea de trabalho|\bdesktop\b/i,
    weak: /renome|organiz|extra[ií]|compact|\bjunt[ae]|mescl|convert|planilha|\bpdfs?\b|\bfotos\b|\barquivos?\b|\bpastas?\b|espa[cç]o|duplicad|\bmov[ae]\b|\bapag[ae]|\bmaiores\b|renam|organi[sz]|extract|compress|\bmerge|spreadsheet|\bphotos\b|\bfiles?\b|\bfolders?\b|\bspace\b|duplicate|\bmove\b|\bdelete\b|\blargest\b|\bbiggest\b/gi },
  { id: 'social', label: L('Conteúdo'), think: 'off', skills: /instagram|social|post|legenda|conte[uú]do/i,
    strong: /instagram|\breels?\b|\bstories\b|carrossel|carousel|tiktok|hashtags?|legenda|caption/i,
    weak: /\bposts?\b|engajamento|seguidores|\bfeed\b|engagement|followers/gi },
];
// pergunta de conceito ("o que é um debugger?", "qual a diferença entre site e app?") não liga nada,
// a não ser que fale de algo concreto: "esse", "meu", "quando abro", um arquivo, um link, um endereço
const ASK_RE = /^\s*(me\s+)?(o que (é|e|são|significa)|explica|explique|como funciona|qual (a|é a|e a) diferen[cç]a|qual o significado|por ?que|quem (foi|é)|what (is|are) (a|an)\b|what does \w+ mean|explain|how does|what(\'?s| is) the difference|why|who (was|is))/i;
const CONCRETE_RE = /\b(esse|essa|este|esta|isso|isto|aqui|nesse|nessa|neste|nesta|meu|minha|meus|minhas|abro|uso|rodo|tento|estou|t[oô]|this|that|these|here|my|mine|i\'?m|i (use|run|open|try))\b|https?:\/\/|\b0x[0-9a-f]{4,}\b|\b\w+\.(exe|dll|sys|rs|js|ts|py|cs|cpp|go|java|pdf|zip|docx?|xlsx?|csv|txt|png|jpe?g|json|md)\b/i;
// níveis: cauteloso (só sinais fortes), equilibrado (fortes ou dois fracos) e liberal (um fraco basta,
// e perguntas de conceito também ligam)
const AUTO_LEVELS = [
  ['desligado', L('Desligado'), L('Só o que você ligar na barra do chat.')],
  ['cauteloso', L('Cauteloso'), L('Só com sinais claros: x64dbg, 0x401000, .dll, cargo, um link, instagram.')],
  ['equilibrado', L('Equilibrado'), L('Sinais claros ou dois indícios juntos. Erra pouco para os dois lados.')],
  ['liberal', L('Liberal'), L('Um indício basta, inclusive em perguntas. Liga mais coisas e gasta mais contexto.')],
];
function routeProfiles(text, level = 'equilibrado') {
  if (level === 'desligado') return [];
  const t = String(text).replace(/(ik_)?llama\.cpp/gi, 'llama');
  if (level !== 'liberal' && ASK_RE.test(t) && !CONCRETE_RE.test(t)) return [];
  const strongHit = ROUTES.filter((r) => r.strong.test(t));
  const need = level === 'cauteloso' ? Infinity : level === 'liberal' ? 1 : 2;
  const weakHit = (r) => (level === 'liberal' || !r.need || r.need.test(t)) && new Set((t.match(r.weak) || []).map((x) => x.toLowerCase().slice(0, 5))).size >= need;
  const out = ROUTES.filter((r) => strongHit.includes(r) || weakHit(r));
  // engenharia reversa explícita: "função", "compila" e "erro" ali não são pedido de programação
  return strongHit.some((r) => r.id === 're') && !strongHit.some((r) => r.id === 'code') ? out.filter((r) => r.id !== 'code') : out;
}
const STOP = new Set(L('para como sobre quando entre depois antes mesmo ainda cada todos todas outro outra sendo usar use usa esta este isso essa esse aqui onde qual quais pelo pela pelos pelas fazer feito skill skills habilidade arquivo arquivos').split(' '));
const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const words = (t) => new Set(norm(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !STOP.has(w)));

/** Conectores citados pelo nome e habilidades cujo nome ou descrição batem com o pedido. */
function routeExtras(text, skills, mcps, level = 'equilibrado') {
  if (level === 'desligado' || (level !== 'liberal' && ASK_RE.test(text) && !CONCRETE_RE.test(text))) return { mcp: [], skills: [] };
  const low = ' ' + norm(text).replace(/[^a-z0-9]+/g, ' ') + ' ';
  const mcp = mcps.filter((s) => {
    const key = norm(s.name).replace(/mcp|server|servidor/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
    return key.length >= 3 && low.includes(' ' + key + ' ');
  }).map((s) => s.name);
  const ws = words(text);
  const out = [];
  for (const sk of skills) {
    const nameKey = norm(sk.name || sk.id).replace(/[^a-z0-9]+/g, ' ').trim();
    const nameWs = words(sk.name + ' ' + sk.id);
    const nameHit = [...nameWs].filter((w) => ws.has(w)).length;
    const descHit = [...words(sk.description)].filter((w) => !nameWs.has(w) && ws.has(w)).length;
    // nome completo citado; ou parte do nome + assunto da descrição; ou três palavras do assunto
    const min = level === 'cauteloso' ? Infinity : level === 'liberal' ? 2 : 3;
    // sinais declarados pela skill (triggers): uma frase dessas no pedido já indica a skill
    const trig = (sk.triggers || []).some((t) => { const k = norm(t).replace(/[^a-z0-9]+/g, ' ').trim(); return k.length >= 3 && low.includes(' ' + k + ' '); });
    const sc = low.includes(' ' + nameKey + ' ') || low.includes(' ' + nameKey + 's ') ? 10 : trig && level !== 'cauteloso' ? 8 : level !== 'cauteloso' && nameHit && descHit ? 5 + descHit : descHit >= min ? descHit : 0;
    if (sc) out.push([sk.id, sc]);
  }
  return { mcp, skills: out.sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]) };
}

function autoLevelOf(c) {
  const v = (c ? c.autoLevel : S.draftAuto) || S.settings.autoLevel || 'equilibrado';
  return S.settings.autoRoute === false && !(c?.autoLevel || S.draftAuto) ? 'desligado' : v;
}
function fillAutoPop() {
  const pop = $('#pop-auto'); pop.innerHTML = '';
  const cur0 = autoLevelOf(cur());
  pop.append(h('div.pop-head', null, h('span', null, L('Recursos automáticos nesta conversa'))));
  for (const [v, l, d] of AUTO_LEVELS) {
    pop.append(h('button.menu-item' + (v === cur0 ? '.sel' : ''), { onclick: () => {
      const c = cur(); if (c) { c.autoLevel = v; saveConvs(); } else S.draftAuto = v;
      closePops(); updatePickers();
    } }, ic(v === 'desligado' ? 'ban' : 'signpost'), h('span.mi-main', null, l, h('span.mi-sub', null, d)), v === cur0 ? ic('check') : null));
  }
  pop.append(h('div.pop-foot', null, h('button.link', { onclick: () => { closePops(); openSettings('auto'); } }, L('Padrão para novas conversas'))));
}

// Qual conector de engenharia reversa o pedido quer: o citado (x64dbg, dnspy...) ou o indicado
// pelo assunto (.NET -> dnspy, 32 bits -> x32dbg). Sem pista, só os que já estão conectados,
// sem acordar os desligados.
const RE_HINTS = [
  [/\.net|assembl(y|ies)|\bc#|dnspy|ilspy|\bil\b/i, /dnspy|ilspy|dotpeek|de4dot/i],
  [/x64|64.?bits?|\b(rax|rbx|rcx|rdx|rip|rsp)\b/i, /x64dbg/i],
  [/x32|32.?bits?|\b(eax|ebx|ecx|edx|eip|esp)\b/i, /x32dbg/i],
  [/ghidra|descompil|decompil|pseudo.?c[oó]digo/i, /^rea$|ghidra|decompil/i],
  [/cheat.?engine|mem[oó]ria do jogo|valor .{0,30}jogo/i, /^ce$|cheat/i],
];
function pickConnectors(r, text, mcps) {
  const cands = mcps.filter((s) => r.mcp.test(s.name));
  const low = ' ' + norm(text).replace(/[^a-z0-9#.]+/g, ' ') + ' ';
  const named = cands.filter((s) => { const k = norm(s.name).replace(/mcp|server/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); return k.length >= 2 && low.includes(' ' + k + ' '); });
  const hinted = r.id === 're' ? cands.filter((s) => RE_HINTS.some(([q, c]) => q.test(text) && c.test(s.name))) : [];
  const pick = named.length ? named : hinted; // citou um pelo nome: só ele
  return (pick.length ? pick : cands.filter((s) => s.status === 'connected')).map((s) => s.name);
}

async function autoRoute(conv, msg) {
  const text = plainOf(msg) + ' ' + (msg.refs || []).map((r) => r.name).join(' ');
  const low = norm(text);
  const auto = conv.auto || { groups: [], mcp: [], skills: [] };
  const have = { groups: new Set([...enabledGroups(), ...auto.groups]), mcp: new Set([...activeSel(conv).mcp, ...auto.mcp]), skills: new Set([...activeSel(conv).skills, ...auto.skills]) };
  const added = { groups: [], mcp: [], skills: [], profiles: [], eager: [], block: [] };
  const add = (k, v) => { if (!have[k].has(v)) { have[k].add(v); added[k].push(v); } };
  const level = autoLevelOf(conv);
  const profs = routeProfiles(text, level);
  for (const r of profs) {
    added.profiles.push(r.label);
    for (const g of r.groups || []) add('groups', g);
    if (r.mcp) for (const n of pickConnectors(r, text, S.mcp)) add('mcp', n);
    if (r.skills) for (const sk of S.skills) if (r.skills.test(sk.name + ' ' + sk.id)) add('skills', sk.id);
    if (r.think && !conv.think && !conv.autoThink) conv.autoThink = r.think;
  }
  // conectores e habilidades citados pelo nome ou pelo assunto
  const ex = routeExtras(text, S.skills, S.mcp, level);
  for (const n of ex.mcp) add('mcp', n);
  for (const id of ex.skills) add('skills', id);
  // conector desligado que o pedido precisa: liga e espera conectar (até 8 s)
  for (const n of added.mcp) {
    const s = S.mcp.find((x) => x.name === n);
    if (s && s.status === 'disabled') {
      try { S.mcp = (await api('/api/mcp/toggle', { name: n, disabled: false })).servers; } catch { /* segue sem */ }
    }
  }
  if (added.mcp.length) {
    for (let i = 0; i < 16 && added.mcp.some((n) => !['connected', 'error'].includes(S.mcp.find((x) => x.name === n)?.status)); i++) {
      await new Promise((r) => setTimeout(r, 500));
      try { S.mcp = (await api('/api/mcp')).servers; } catch { break; }
    }
  }
  // conector citado pelo nome vai completo (sem catálogo) e, em engenharia reversa, a tela fica de fora:
  // o modelo usa o x64dbg pelo conector em vez de clicar na janela dele
  for (const n of ex.mcp) if (!(auto.eager || []).includes(n)) added.eager.push(n);
  // o que o pedido indicou vira o mesmo aviso que o @ gera ("Conector:x64dbg"), que o modelo segue
  const said = [...new Set([...ex.mcp, ...added.mcp.filter((n) => ROUTES[0].mcp.test(n))])];
  const pills = new Set((msg.parts || []).filter((p) => p.kind === 'mcp' || p.kind === 'skill').map((p) => p.name));
  const use = [...said.filter((n) => !pills.has(n)).map((n) => L('Conector:{0}', n)),
    ...ex.skills.map((id) => S.skills.find((x) => x.id === id)?.name || id).filter((n) => !pills.has(n)).map((n) => L('Habilidade:{0}', n))];
  if (use.length) msg.use = use;
  const reMcp = profs.some((r) => r.id === 're') && [...have.mcp].some((n) => ROUTES[0].mcp.test(n));
  const namedDbg = ex.mcp.some((n) => ROUTES[0].mcp.test(n)); // "abre o programa no x64dbg": é o debugger, não a tela
  if (reMcp && (namedDbg || !profs.some((r) => r.id === 'pc')) && !(auto.block || []).includes('computer')) added.block.push('computer');
  if (!added.groups.length && !added.mcp.length && !added.skills.length && !added.eager.length && !added.block.length) return;
  conv.auto = { groups: [...auto.groups, ...added.groups], mcp: [...auto.mcp, ...added.mcp], skills: [...auto.skills, ...added.skills], eager: [...(auto.eager || []), ...added.eager], block: [...(auto.block || []), ...added.block] };
  msg.auto = added;
}
function undoAuto(conv, msg) {
  const a = msg.auto; if (!a || !conv.auto) return;
  for (const k of ['groups', 'mcp', 'skills', 'eager', 'block']) conv.auto[k] = (conv.auto[k] || []).filter((x) => !(a[k] || []).includes(x));
  msg.auto = { ...a, undone: true };
  saveConvs(); renderMessages(); updatePickers();
  toast(L('Recursos automáticos desta mensagem removidos para as próximas respostas'));
}
function autoChip(conv, m) {
  const a = m.auto; if (!a || a.undone) return null;
  const names = [
    ...a.mcp,
    ...a.skills.map((id) => S.skills.find((s) => s.id === id)?.name || id),
    ...a.groups.map((g) => TOOL_INFO[g]?.short || TOOL_INFO[g]?.title || g),
  ];
  if (a.block?.includes('computer')) names.push(L('sem controle da tela'));
  return h('div.auto-chip', { title: L('Ligado automaticamente pelo pedido{0}. Vale para esta conversa.', a.profiles.length ? ` (${a.profiles.join(', ')})` : '') },
    ic('sparkles'), h('span', null, L('Ativado: ') + names.join(', ')),
    h('button', { title: L('Desfazer'), 'aria-label': L('Desfazer'), html: svg('x'), onclick: () => undoAuto(conv, m) }));
}

/* ============================================================ lista de tarefas do modelo */
async function updateTodos(conv, args, signal) {
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
  const isNew = !conv.todos?.length || conv.todos.every((t) => t.status === 'done');
  let list = args?.todos;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = null; } }
  if (!Array.isArray(list)) return { content: L('Erro: envie todos como uma lista de {text, status}.'), isError: true };
  const norm = (st) => (/progress|andamento|doing/i.test(st) ? 'in_progress' : /done|complet|feito|conclu/i.test(st) ? 'done' : 'pending');
  conv.todos = list.filter((t) => t && String(t.text || t.content || '').trim()).slice(0, 40).map((t) => ({ text: String(t.text || t.content).trim(), status: norm(String(t.status || '')) }));
  conv.todosAt = Date.now();
  saveConvs();
  if (conv.id === S.curId) drawTodos();
  const done = conv.todos.filter((t) => t.status === 'done').length;
  const now = conv.todos.find((t) => t.status === 'in_progress');
  // plano novo: pergunta se pode seguir antes de começar a executar
  if (isNew && conv.todos.length > 1 && S.settings.confirmPlan !== false) {
    conv._planWait = true; conv.todosOpen = true;
    if (conv.id === S.curId) drawTodos();
    if (conv.id !== S.curId) toast(L('"{0}" montou um plano e espera você aprovar', conv.title));
    const ans = await new Promise((resolve) => {
      S.planWaits.set(conv.id, resolve);
      signal?.addEventListener('abort', () => resolve('stop'), { once: true });
    });
    S.planWaits.delete(conv.id); conv._planWait = false;
    if (conv.id === S.curId) drawTodos();
    if (ans === 'stop') return { content: L('O usuário não aprovou o plano e interrompeu. Não execute nada; espere a próxima mensagem dele.'), isError: false };
    return { content: L('O usuário aprovou o plano ({0} passos). Pode executar, atualizando a lista a cada passo.', conv.todos.length), isError: false };
  }
  return { content: L('Lista atualizada: {0} de {1} feitas.{2}', done, conv.todos.length, now ? L(' Em andamento: ') + now.text : ''), isError: false };
}
S.planWaits = new Map();
S.closedThink = new Set();

function drawTodos() {
  const box = $('#todos'); if (!box) return;
  const c = cur(); const list = c?.todos || [];
  box.innerHTML = '';
  box.hidden = !list.length;
  if (!list.length) return;
  const done = list.filter((t) => t.status === 'done').length;
  const all = done === list.length;
  const open = c.todosOpen ?? !all;
  const nowItem = list.find((t) => t.status === 'in_progress');
  const head = h('button.td-head' + (c._planWait ? '.ask' : ''), { onclick: () => { c.todosOpen = !open; saveConvs(); drawTodos(); }, 'aria-expanded': String(open) },
    h('span.td-ring', { html: (() => { const C = 2 * Math.PI * 6; return `<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--line-2)" stroke-width="2.2"/><circle cx="8" cy="8" r="6" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="${(done / list.length * C).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 8 8)"/></svg>`; })() }),
    h('span.td-title', null, all ? L('Tarefas concluídas') : nowItem ? nowItem.text : L('Tarefas')),
    h('span.td-count', null, `${done}/${list.length}`),
    h('span', { html: svg('chev'), style: { display: 'grid', transform: open ? 'rotate(90deg)' : '', transition: 'transform .15s' } }));
  box.append(head);
  if (open) {
    const ul = h('ol.td-list');
    for (const t of list) ul.append(h('li.td.' + t.status, null, h('span.td-box', { html: t.status === 'done' ? svg('check') : '' }), h('span.td-text', null, t.text)));
    box.append(ul);
    if (c._planWait) {
      box.append(h('div.td-ask', null, h('span', null, L('Seguir com este plano?')),
        h('button.btn.ghost.sm', { onclick: () => { S.planWaits.get(c.id)?.('stop'); S.runs.get(c.id)?.abort(); setEditorText(L('Ajuste o plano: ')); focusEditor(); } }, L('Ajustar')),
        h('button.btn.primary.sm', { onclick: () => S.planWaits.get(c.id)?.('go') }, ic('check'), L('Continuar'))));
    } else if (all || !running(c)) box.append(h('div.td-foot', null, h('button.btn.ghost.sm', { onclick: () => { c.todos = []; saveConvs(); drawTodos(); } }, L('Limpar lista'))));
  }
}

/* ============================================================ fila de mensagens */
function enqueue(conv, item) {
  (conv.queue ||= []).push({ ...item, id: uid(), ts: Date.now() });
  conv.queuePaused = false;
  saveConvs(); drawQueue(); renderComposer();
}

/** Chamado quando uma resposta termina: manda a próxima da fila. */
function nextInQueue(conv, aborted) {
  if (!conv.queue?.length) return;
  if (aborted) { conv.queuePaused = true; saveConvs(); drawQueue(); return; }
  const ui = conv.queue.findIndex((it) => it.now);
  const item = conv.queue.splice(ui >= 0 ? ui : 0, 1)[0];
  delete item.now;
  conv.queuePaused = false;
  saveConvs(); drawQueue();
  setTimeout(() => submit(conv, item), 0);
}

function drawQueue() {
  const box = $('#queue'); if (!box) return;
  const c = cur();
  const q = c?.queue || [];
  box.innerHTML = '';
  box.hidden = !q.length;
  if (!q.length) return;
  const busy = running(c);
  box.append(h('div.q-head', null, ic('list'),
    h('span', null, c.queuePaused && !busy ? L('Fila pausada ({0})', q.length) : L('Na fila ({0})', q.length)),
    h('span.muted', null, c.queuePaused && !busy ? L(' · a resposta foi interrompida') : busy ? L(' · enviadas quando a resposta atual terminar (⚡ ou Ctrl+Enter: logo depois do passo atual)') : ''),
    h('span.spacer'),
    c.queuePaused && !busy ? h('button.btn.sm.primary', { onclick: () => nextInQueue(c, false) }, ic('send'), L('Retomar')) : null,
    q.length > 1 ? h('button.btn.ghost.sm', { onclick: () => { c.queue = []; saveConvs(); drawQueue(); renderComposer(); } }, L('Limpar')) : null));
  q.forEach((it, i) => {
    const text = (it.content || '').replace(/\s+/g, ' ').trim() || it.parts.map((p) => p.name).filter(Boolean).join(', ');
    box.append(h('div.q-item', null,
      h('span.q-n', null, String(i + 1)),
      it.now ? h('span.q-now', { title: L('Entra logo depois do passo atual') }, ic('zap'), L('próximo passo')) : null,
      h('span.q-text', { title: it.content }, text),
      h('button.icon-btn.sm' + (it.now ? '.on' : ''), { title: it.now ? L('Voltar a esperar a resposta terminar') : L('Executar logo depois do passo atual (sem esperar a resposta inteira)'), 'aria-label': L('Executar no próximo passo'), html: svg('zap'), onclick: () => {
        it.now = !it.now; saveConvs(); drawQueue();
        if (it.now && !running(c)) nextInQueue(c, false);
      } }),
      i > 0 ? h('button.icon-btn.sm', { title: L('Subir'), 'aria-label': L('Subir'), html: svg('up'), onclick: () => { [q[i - 1], q[i]] = [q[i], q[i - 1]]; saveConvs(); drawQueue(); } }) : null,
      h('button.icon-btn.sm', { title: L('Editar (volta para a caixa de texto)'), 'aria-label': L('Editar'), html: svg('edit'), onclick: () => {
        q.splice(i, 1); saveConvs(); drawQueue();
        const ed = editor();
        if (editorEmpty()) { ed.innerHTML = ''; ed.append(...partsToNodes(it.parts)); }
        else ed.append(document.createElement('br'), ...partsToNodes(it.parts));
        ed.focus(); renderComposer();
      } }),
      h('button.icon-btn.sm', { title: L('Tirar da fila'), 'aria-label': L('Tirar da fila'), html: svg('x'), onclick: () => { q.splice(i, 1); saveConvs(); drawQueue(); renderComposer(); } })));
  });
}

/* Parar: cancela a resposta e encerra os comandos que a conversa abriu (a árvore inteira, no servidor). Se algo
   ainda segurar a resposta (um conector que não responde, um passo travado), o segundo clique, ou 6 s depois,
   força: a conversa é liberada na hora e o que chegar depois é ignorado. */
const STOP_FORCE_MS = 6000;
function stop(c = cur()) {
  const ac = c && S.runs.get(c.id);
  if (!ac) return;
  if (ac.stopAt) { forceStop(c); return; }
  ac.stopAt = Date.now();
  ac.abort();
  api('/api/tools/stop', { run: c.id }).catch(() => {});
  renderComposer();
  setTimeout(() => { if (S.runs.get(c.id) === ac) forceStop(c); }, STOP_FORCE_MS);
}

function forceStop(c) {
  const ac = S.runs.get(c.id);
  if (!ac || ac.dead) return;
  ac.dead = true;
  ac.abort();
  api('/api/tools/stop', { run: c.id }).catch(() => {});
  finishRun(c, ac, L('Parada forçada.'));
  toast(L('Parada forçada: a conversa foi liberada.'));
}

function collectRefs(conv) {
  return [...new Set(conv.messages.flatMap((m) => (m.refs || []).map((r) => r.path)))];
}

function userContent(m) {
  let c = m.content || '';
  if (m.refs?.length) c += L('{0}[Caminhos referenciados]\n', c ? '\n\n' : '') + m.refs.map((r) => `- ${r.path}${r.dir ? L(' (pasta)') : ''}`).join('\n');
  return c;
}

/** Argumentos de uma chamada como JSON de objeto válido; senão '{}'. */
function validArgs(a, onBroken) {
  if (a == null || (typeof a === 'string' && !a.trim())) return '{}';
  if (typeof a === 'object') return JSON.stringify(a);
  try { const v = JSON.parse(a); if (v && typeof v === 'object' && !Array.isArray(v)) return a; } catch { /* inválido */ }
  const r = repairJson(a);
  if (r) return JSON.stringify(r);
  onBroken();
  return '{}';
}

function apiMessages(conv, system) {
  const keepThink = !!mainApiForChat(conv)?.preserveThinking;
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  const msgs = conv.messages;
  // imagens só vão na requisição logo depois de serem geradas (economiza contexto)
  let lastAssistant = -1;
  msgs.forEach((m, i) => { if (m.role === 'assistant') lastAssistant = i; });
  msgs.forEach((m, i) => { m.__i = i; });
  // imagens anexadas pelo usuário vão só durante o turno da mensagem dele
  let lastUserIdx = -1;
  msgs.forEach((m, i) => { if (m.role === 'user' && !m.hidden) lastUserIdx = i; });
  const cut = conv.compactCut || 0;
  const head = cut ? Math.min(conv.compactHead || 0, cut) : 0;
  let summaryDone = !(cut && conv.summary);
  const pushSummary = () => {
    if (summaryDone) return; summaryDone = true;
    if (out[out.length - 1]?.role === 'user') out.push({ role: 'assistant', content: L('Certo, vou trabalhar nisso.') });
    out.push({ role: 'user', content: (head ? L('[Resumo automático do meio da conversa, gerado para caber no contexto]\n\n') : L('[Resumo automático da conversa anterior, gerado para caber no contexto]\n\n')) + conv.summary });
    // mantém a alternância usuário/assistente que alguns templates exigem
    out.push({ role: 'assistant', content: L('Entendido. Vou continuar a partir desse resumo.') });
  };
  if (!head) pushSummary();
  for (const m of msgs) {
    if (m.__i >= head && m.__i < cut) continue;
    if (m.__i >= cut) pushSummary();
    if (m.role === 'user' && m.hidden && m.note) { out.push({ role: 'user', content: m.content }); continue; }
    if (m.role === 'user' && m.hidden) {
      if (m._images?.length && m.__i > lastAssistant) out.push({ role: 'user', content: [{ type: 'text', text: m.content }, ...m._images.map((url) => ({ type: 'image_url', image_url: { url } }))] });
      else out.push({ role: 'user', content: m.content + L(' [imagem omitida do histórico]') });
      continue;
    }
    if (m.role === 'user') {
      const text = userContent(m) + (m.use?.length && !m.auto?.undone ? L('\n\n(Use {0} para isso.)', m.use.join(' e ')) : '') + (m.plan ? PLAN_NOTE : '') + (m.skillNote ? '\n\n' + m.skillNote : '') + (m.catalogNote ? '\n\n' + m.catalogNote : '');
      const imgs = m.__i === lastUserIdx && visionOn(conv) ? (m.refs || []).filter(isImgRef).map((r) => S.imgData.get(r.path)).filter(Boolean) : [];
      // modelo sem visão: as imagens vão como a descrição que outra API fez
      const desc = !imgs.length && m.imgDesc ? Object.entries(m.imgDesc).filter(([, d]) => d.text).map(([path, d]) => L('[Imagem {0}, descrita por {1} porque este modelo não enxerga imagens]\n{2}', path, d.by, d.text)).join('\n\n') : '';
      const full = desc ? text + '\n\n' + desc : text;
      out.push({ role: 'user', content: imgs.length ? [{ type: 'text', text: full }, ...imgs.map((url) => ({ type: 'image_url', image_url: { url } }))] : full });
    }
    else if (m.role === 'assistant') {
      const text = splitThink(m.content).text;
      const calls = (m.tool_calls || []).filter((t) => t.function?.name);
      if (!text.trim() && !calls.length) continue;
      const o = { role: 'assistant', content: text };
      // raciocínio dos passos deste pedido volta para o modelo: ele continua o plano em vez de
      // recomeçar a cada passo (os templates descartam o de pedidos anteriores)
      // raciocínio preservado (opção da API): o de todas as respostas anteriores também volta
      if ((m.__i > lastUserIdx || keepThink) && m.reasoning?.trim()) o.reasoning_content = m.reasoning;
      // argumentos cortados (resposta interrompida no meio da chamada) ou JSON inválido do próprio modelo:
      // o llama-server recusa o pedido inteiro (erro 500), então vão como {} com um aviso no resultado
      const broken = new Set();
      if (calls.length) o.tool_calls = calls.map((t) => ({ id: t.id, type: 'function', function: { name: t.function.name, arguments: validArgs(t.function.arguments, () => broken.add(t.id)) } }));
      out.push(o);
      for (const t of calls) {
        const r = msgs.find((x) => x.role === 'tool' && x.tool_call_id === t.id);
        let c = r && (r.apiContent || r.content) ? (r.apiContent || r.content) : L('Execução cancelada pelo usuário.');
        if (broken.has(t.id)) c = L('A chamada foi interrompida antes de os argumentos terminarem de ser gerados (JSON incompleto) e não foi executada.') + (r?.content ? '\n' + r.content : '');
        if (r?.short && c.length > 1500) c = c.slice(0, 1500) + L('\n[... resultado antigo encurtado pela compactação]');
        if (r?.studioNote) c += '\n\n' + r.studioNote;
        out.push({ role: 'tool', tool_call_id: t.id, content: c });
      }
    }
  }
  return out;
}

/* ---- por que o llama-server releu ----
   O cache só serve até o primeiro ponto em que o pedido difere do anterior. Guarda uma impressão
   de cada pedido e, quando muda, diz onde: instruções, ferramentas ou uma mensagem do histórico. */
function strHash(s) { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0; return x; }
function reqPrint(conv, system, tools, msgs) {
  return { sys: system || '', tools: (tools || []).map((t) => t.function?.name || ''), toolsHash: strHash(JSON.stringify(tools || [])), msgs: msgs.map((m) => strHash(JSON.stringify(m))), roles: msgs.map((m) => m.role), imgs: msgs.map((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url')), cut: conv.compactCut || 0, compactions: conv.compactions || 0, slot: conv._slot, started: S.llama?.startedAt || 0, side: S.sideShared || 0 };
}
/** Qual parte do prompt de sistema mudou, em palavras. */
const SYS_PARTS = [
  [['Catálogo de ferramentas dos conectores', 'Catalog of the active connectors'], 'a lista de conectores mudou'],
  [['O usuário ativou as skills', 'The user turned on the skills'], 'as habilidades ligadas mudaram'],
  [['# Modo Ponytail', '# Ponytail mode', '# Modo Caveman', '# Caveman mode'], 'o nível do Ponytail ou do Caveman mudou'],
  [['Mapa da pasta de trabalho', 'Workspace map'], 'o mapa da pasta mudou'],
  [['Pasta de trabalho:', 'Workspace:'], 'a pasta de trabalho ou as ferramentas ligadas mudaram'],
  [['Data de hoje:', "Today's date:"], 'o dia mudou'],
  [['# Personalidade:', '# Personality:'], 'a personalidade mudou'],
  [['# Instruções do projeto', '# Instructions for the project'], 'as instruções do projeto mudaram'],
];
function sysWhy(a, b) {
  let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let best = null, at = -1;
  for (const [marks, why] of SYS_PARTS) for (const t of [b, a]) for (const m of marks) { const i = t.lastIndexOf(m, p); if (i > at) { at = i; best = why; } }
  return best ? L(best) : (p < 80 ? L('as suas instruções nas configurações mudaram') : L('as instruções do sistema mudaram'));
}

function cacheWhy(prev, now) {
  if (!prev) return { why: L('é o primeiro pedido desta conversa desde que o studio abriu'), start: 0 };
  if (prev.started !== now.started) return { why: L('o llama-server reiniciou ou trocou de modelo'), start: 0 };
  if (prev.compactions !== now.compactions || prev.cut !== now.cut) return { why: L('a conversa foi compactada'), start: 1 };
  if (prev.sys !== now.sys) return { why: sysWhy(prev.sys, now.sys), start: 0 };
  if (prev.toolsHash !== now.toolsHash) {
    const add = now.tools.filter((t) => !prev.tools.includes(t)); const del = prev.tools.filter((t) => !now.tools.includes(t));
    const list = (xs, sign) => xs.length ? `${sign}${xs.length}: ${xs.slice(0, 2).join(', ')}${xs.length > 2 ? '…' : ''}` : '';
    return { why: L('as ferramentas mudaram') + ((add.length || del.length) ? ` (${[list(add, '+'), list(del, '−')].filter(Boolean).join('; ')})` : L(' (parâmetros diferentes)')), start: 0 };
  }
  for (let i = 0; i < prev.msgs.length && i < now.msgs.length; i++) {
    if (prev.msgs[i] === now.msgs[i]) continue;
    if (prev.imgs[i] && !now.imgs[i]) return { why: L('uma imagem saiu do histórico (só vai no turno em que foi enviada)'), start: i };
    return { why: L('a mensagem {0} do histórico mudou ({1})', i, prev.roles[i] === 'assistant' ? L('resposta do modelo') : prev.roles[i] === 'tool' ? L('resultado de ferramenta') : L('mensagem')), start: i };
  }
  if (prev.slot !== now.slot) return { why: L('a conversa mudou de slot no servidor'), start: 0 };
  if (prev.side !== now.side) return { why: L('o auditor ou outro pedido lateral usou o mesmo slot (o servidor tem um slot só; com --parallel 2 ou mais eles ficam separados)'), start: 0 };
  return { why: '', start: -1 };
}

/** Erro de conexão (vale tentar de novo): queda no meio do streaming, rede, API ou llama-server fora por um instante. */
function isNetErr(e) {
  const m = String(e?.message || e || '');
  return e instanceof TypeError || /network ?error|failed to fetch|load failed|conexão .*caiu|connection .*dropped|respondeu (502|503|504)|responded (502|503|504)|ECONNRESET|socket hang up/i.test(m);
}

async function streamCompletion(conv, system, tools, msg, signal) {
  const msgs = apiMessages(conv, system);
  const print = reqPrint(conv, system, tools, msgs);
  msg._why = cacheWhy(conv._req, print).why;
  conv._req = print;
  conv.ctxSys = Math.ceil(((system || '').length + JSON.stringify(tools || []).length) / 3.2);
  // várias ferramentas no mesmo passo (dois explore em paralelo, ler e editar...): o llama-server só aceita
  // mais de uma chamada por resposta quando o pedido diz; sem isso vale o que ele acha do template
  const extra = requestExtras(conv);
  if (tools?.length) extra.parallel_tool_calls = true;
  const mainApi = mainApiForChat(conv);
  if (mainApi) { extra._remote = true; extra._p = mainApi.id; }
  // a conexão caiu (rede, API ou llama-server reiniciando): tenta de novo do começo, até 2 vezes, sem
  // mostrar o erro; a parte que já tinha chegado é descartada (o pedido é o mesmo)
  let r;
  for (let attempt = 0; ; attempt++) {
    try { r = await streamRaw(msgs, tools, msg, signal, scheduleRender, extra); break; }
    catch (e) {
      if (signal?.aborted || e.name === 'AbortError' || attempt >= 2 || !isNetErr(e)) throw e;
      msg.content = ''; msg.reasoning = ''; msg.tool_calls = []; msg._pp = null;
      msg._retry = L('A conexão caiu; tentando de novo ({0}/2)...', attempt + 1);
      scheduleRender();
      await new Promise((ok) => setTimeout(ok, attempt ? 4000 : 1500));
      if (signal?.aborted) throw e;
    } finally { delete msg._retry; }
  }
  if (mainApi) {
    apiUse({ calls: 1, tokens: msg.usage?.total_tokens || 0 }, mainApi.id);
    msg.via = msg._fallbackModel || mainApi.model || '';
  }
  // medida real do servidor: prompt (com o que veio do cache) + resposta
  if (msg.ctxTokens) { conv.ctx = { tokens: msg.ctxTokens, n: conv.messages.length, cut: conv.compactCut || 0 }; drawCtxMeter(); }
  // quanto veio do cache no último pedido, e por que o resto foi relido
  if (msg._pp?.total) {
    const read = Math.max(0, msg._pp.total - msg._pp.cache);
    conv.cacheLast = { total: msg._pp.total, cache: msg._pp.cache, read, ms: msg._pp.time_ms || 0, why: read > Math.max(2000, msg._pp.total * 0.3) ? (msg._why || L('o servidor não tinha esse trecho guardado (modelos com camadas recorrentes, como Qwen3.5/3.6, só voltam até o último ponto salvo)')) : '' };
    // guardado na mensagem (vai para o disco): a aba Atividade mostra o que cada passo leu e por que releu
    msg.pp = { total: msg._pp.total, cache: msg._pp.cache, ms: Math.round(msg._pp.time_ms || 0), why: conv.cacheLast.why || '' };
    drawCtxMeter();
    // causa desconhecida: o log do llama-server mostra onde o pedido divergiu do que o slot tinha
    if (conv.cacheLast.why && !msg._why) serverDiff(conv._slot).then((d) => { if (d) { conv.cacheLast.why = d; conv.cacheLast.diff = true; if (msg.pp) msg.pp.why = d; drawCtxMeter(); saveConvs(); } }).catch(() => {});
  }
  return r;
}

/** Último "old/new" do log do llama-server (LLAMA_SERVER_SLOTS_DEBUG) para este slot, em palavras.
   Os pedaços de texto podem ter quebras de linha, então a linha "old" pode continuar nas seguintes. */
async function serverDiff(slot) {
  const { next } = await api('/api/llama/log?since=999999999');
  const r = await api('/api/llama/log?since=' + Math.max(0, next - 300));
  const text = (r.lines || []).join('\n');
  const id = slot == null ? '\\d+' : String(slot);
  const re = new RegExp('id +' + id + ' \\| task (\\d+) \\| old: \\.\\.\\. ([\\s\\S]*?)\\n[^\\n]*?id +' + id + ' \\| task \\1 \\| new: \\.\\.\\. ([\\s\\S]*?)\\n[^\\n]*?id +' + id + ' \\| task \\1 \\|', 'g');
  let m, last = null;
  while ((m = re.exec(text))) last = m;
  if (!last) return '';
  const show = (t) => t.replace(/\n/g, '⏎').replace(/\s+/g, ' ').trim();
  const [oa, ob = ''] = last[2].split(' | '); const [, nb = ''] = last[3].split(' | ');
  return L('o pedido divergiu do que o servidor tinha guardado logo depois de «{0}»: antes vinha «{1}», agora «{2}»', show(oa).slice(-60), show(ob).slice(0, 60) || '∅', show(nb).slice(0, 60) || '∅');
}

/* ============================================================ conserto das chamadas de ferramenta
   Modelos (os locais principalmente) erram a forma da chamada: JSON quebrado ou cortado, caminho do Windows com
   \ sem escapar, nome de parâmetro de outra ferramenta (cmd, file_path, old_string), número como texto, tudo
   embrulhado em {"arguments": ...}. Antes de executar, o studio conserta o que dá para consertar com segurança
   (pelo esquema da ferramenta) e avisa o modelo do que mudou; o que falta vira um erro que explica o esperado. */

/** Tenta transformar um JSON quase válido num objeto. Devolve o objeto ou null. */
function repairJson(src) {
  if (src && typeof src === 'object') return Array.isArray(src) ? null : src;
  let s = String(src ?? '').trim();
  if (!s) return {};
  try { const v = JSON.parse(s); if (v && typeof v === 'object' && !Array.isArray(v)) return v; if (typeof v === 'string') return repairJson(v); } catch { /* conserta abaixo */ }
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const a = s.indexOf('{');
  if (a < 0) return null;
  s = s.slice(a);
  // uma passada: dentro de strings escapa quebras de linha e barras inválidas; fora, troca True/None/aspas
  // simples e tira vírgulas sobrando; no fim fecha a string e as chaves que ficaram abertas (resposta cortada)
  let out = '', inStr = false, q = '"';
  const stack = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') {
        const n = s[i + 1];
        if (n != null && '"\\/bfnrtu'.includes(n) && !(n === 'u' && !/^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6)))) { out += c + n; i++; }
        else if (n === "'" && q === "'") { out += "'"; i++; }
        else out += '\\\\';
        continue;
      }
      if (c === q) { inStr = false; out += '"'; continue; }
      if (c === '"') { out += '\\"'; continue; } // aspas duplas dentro de string com aspas simples
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
      out += c; continue;
    }
    if (c === '"' || c === "'") { inStr = true; q = c; out += '"'; continue; }
    if (c === '{' || c === '[') { stack.push(c === '{' ? '}' : ']'); out += c; continue; }
    if (c === '}' || c === ']') {
      out = out.replace(/,\s*$/, '');
      if (stack.length && stack[stack.length - 1] === c) stack.pop();
      out += c;
      if (!stack.length) break; // o resto é lixo depois do objeto
      continue;
    }
    const word = /^(True|False|None|null|true|false)\b/.exec(s.slice(i));
    if (word) { out += { True: 'true', False: 'false', None: 'null' }[word[1]] || word[1]; i += word[1].length - 1; continue; }
    // chave sem aspas: {command: "x"}
    const key = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(s.slice(i));
    if (key && /[{,]\s*$/.test(out)) { out += '"' + key[1] + '":'; i += key[0].length - 1; continue; }
    out += c;
  }
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, '').replace(/:\s*$/, ':null');
  while (stack.length) out += stack.pop();
  try { const v = JSON.parse(out); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

// nomes que os modelos usam no lugar do certo (o certo é a chave)
const ARG_ALIASES = {
  command: ['cmd', 'commands', 'shell', 'script', 'command_line', 'commandline'],
  path: ['file_path', 'filepath', 'file', 'filename', 'file_name', 'dir', 'directory', 'folder', 'target_file', 'pathname', 'relative_path'],
  old_text: ['old_string', 'old', 'search', 'find', 'oldtext', 'old_str', 'original', 'from'],
  new_text: ['new_string', 'new', 'replace', 'replacement', 'newtext', 'new_str', 'to'],
  content: ['text', 'contents', 'data', 'body', 'file_content', 'file_text', 'pattern', 'regex', 'grep', 'query', 'search'],
  name: ['glob', 'file_pattern', 'filename_pattern', 'include', 'mask'],
  query: ['q', 'pattern', 'search', 'term', 'regex', 'keyword', 'keywords', 'search_query'],
  code: ['source', 'script', 'js', 'javascript', 'program'],
  url: ['href', 'link', 'uri', 'address'],
  task: ['prompt', 'description', 'instructions', 'goal', 'objective'],
  cwd: ['workdir', 'working_dir', 'working_directory', 'dir', 'directory'],
  offset: ['start', 'start_line', 'line', 'from_line'],
  limit: ['count', 'max_lines', 'lines', 'num_lines', 'n'],
  names: ['tools', 'tool_names', 'name'],
  skill: ['skill_id', 'skill_name', 'id', 'name'],
};
const snake = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[-\s]+/g, '_').toLowerCase();

/** Ajusta os argumentos ao esquema. Devolve { args, notes: [...], missing: [...] }. */
function fitArgs(args, schema) {
  const notes = [];
  const props = schema?.properties || {};
  const names = Object.keys(props);
  if (!names.length) return { args, notes, missing: [] };
  let a = { ...args };
  // tudo embrulhado: {"arguments": {...}}, {"input": {...}}, {"parameters": "{...}"}
  const keys0 = Object.keys(a);
  if (keys0.length === 1 && !props[keys0[0]] && ['arguments', 'args', 'input', 'parameters', 'params', 'kwargs'].includes(keys0[0])) {
    const inner = repairJson(a[keys0[0]]);
    if (inner) { a = inner; notes.push(L('tirei o embrulho "{0}"', keys0[0])); }
  }
  const req = schema.required || [];
  const unknown = () => Object.keys(a).filter((k) => !props[k]);
  for (const k of unknown()) {
    const sk = snake(k);
    let to = props[sk] && a[sk] === undefined ? sk : null;
    if (!to) to = names.find((n) => a[n] === undefined && (ARG_ALIASES[n] || []).includes(sk) && !(ARG_ALIASES[sk] && props[sk]));
    if (to) { a[to] = a[k]; delete a[k]; notes.push(`${k} → ${to}`); }
  }
  // sobrou um nome desconhecido e falta exatamente um obrigatório: é ele
  const miss0 = req.filter((n) => a[n] === undefined || a[n] === null);
  const unk = unknown();
  if (miss0.length === 1 && unk.length === 1) { a[miss0[0]] = a[unk[0]]; delete a[unk[0]]; notes.push(`${unk[0]} → ${miss0[0]}`); }
  // tipos
  for (const n of names) {
    const v = a[n], p = props[n];
    if (v === undefined || v === null || !p) continue;
    const t = Array.isArray(p.type) ? p.type.find((x) => x !== 'null') : p.type;
    let nv = v;
    if ((t === 'integer' || t === 'number') && typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) nv = t === 'integer' ? parseInt(v, 10) : parseFloat(v);
    else if (t === 'integer' && typeof v === 'number' && !Number.isInteger(v)) nv = Math.round(v);
    else if (t === 'boolean' && typeof v === 'string' && /^(true|false|sim|não|nao|yes|no|1|0)$/i.test(v.trim())) nv = /^(true|sim|yes|1)$/i.test(v.trim());
    else if (t === 'boolean' && typeof v === 'number') nv = v !== 0;
    else if (t === 'array' && !Array.isArray(v)) {
      if (typeof v === 'string' && v.trim().startsWith('[')) { try { nv = JSON.parse(v); } catch { const r = repairJson('{"x":' + v + '}'); nv = r?.x ?? [v]; } }
      else if (typeof v === 'string' && p.items?.type === 'string' && /,/.test(v) && !/\s/.test(v.replace(/,\s+/g, ','))) nv = v.split(',').map((x) => x.trim()).filter(Boolean);
      else nv = [v];
    }
    else if (t === 'object' && typeof v === 'string' && v.trim().startsWith('{')) nv = repairJson(v) ?? v;
    else if (t === 'string' && typeof v === 'number') nv = String(v);
    else if (t === 'string' && typeof v === 'boolean') nv = String(v);
    else if (t === 'string' && Array.isArray(v) && v.every((x) => typeof x === 'string')) nv = v.join(n === 'command' ? ' ' : '\n');
    else if (t === 'string' && v && typeof v === 'object' && n !== 'command') nv = JSON.stringify(v, null, 2);
    if (p.enum && typeof nv === 'string' && !p.enum.includes(nv)) {
      const e = p.enum.find((x) => String(x).toLowerCase() === nv.trim().toLowerCase());
      if (e !== undefined) nv = e;
    }
    if (nv !== v) { a[n] = nv; notes.push(L('{0} convertido para {1}', n, t)); }
  }
  // "C:\temp\novo" sem escapar chega com tabulação e quebra de linha no lugar de \t e \n: em caminho, volta a ser barra
  const unctl = (x) => (typeof x === 'string' && /^[A-Za-z]:|\\/.test(x) && /[\t\n\r\b\f\v]/.test(x) ? x.replace(/[\t\n\r\b\f\v]/g, (c) => '\\' + { '\t': 't', '\n': 'n', '\r': 'r', '\b': 'b', '\f': 'f', '\v': 'v' }[c]) : x);
  for (const n of ['path', 'cwd', 'dir', 'where']) if (props[n] && unctl(a[n]) !== a[n]) { a[n] = unctl(a[n]); notes.push(L('barras do caminho em {0} consertadas', n)); }
  if (Array.isArray(a.files)) a.files = a.files.map(unctl);
  const missing = req.filter((n) => a[n] === undefined || a[n] === null || (props[n]?.type === 'string' && n !== 'new_text' && n !== 'content' && a[n] === ''));
  return { args: a, notes, missing };
}

function editDist(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Nome da ferramenta: o certo, consertado (Functions.read_file, ReadFile, servidor.ferramenta) ou null. */
function fixToolName(name, known) {
  if (known.has(name)) return name;
  const n0 = String(name || '').trim().replace(/^(functions?|tools?|default_api|api)[.:]/i, '').replace(/[<>"'`]/g, '');
  const cands = [n0, snake(n0), n0.toLowerCase(), n0.replace('.', '__'), n0.replace(/^([a-z0-9-]+)_(?!_)/i, '$1__'), n0.replace(/-/g, '_')];
  for (const c of cands) if (known.has(c)) return c;
  const low = n0.toLowerCase();
  const near = [...known].filter((k) => !k.includes('__') && editDist(k.toLowerCase(), low) <= 2);
  return near.length === 1 ? near[0] : null;
}

/** Conserta as chamadas de um passo pelo esquema das ferramentas. Marca tc.fix (o que mudou) e tc.bad (erro). */
function repairCalls(calls, tools) {
  const by = new Map((tools || []).map((t) => [t.function?.name, t.function]));
  const known = new Set(by.keys());
  for (const tc of calls || []) {
    const fix = [];
    const raw = tc.function.arguments;
    let args = parseArgs(raw);
    if (!args || Array.isArray(args)) {
      args = repairJson(raw);
      if (args) fix.push(L('JSON dos argumentos consertado'));
    }
    const nm = fixToolName(tc.function.name, known);
    if (nm && nm !== tc.function.name) { fix.push(L('ferramenta {0} → {1}', tc.function.name, nm)); tc.function.name = nm; }
    if (!args) {
      tc.bad = L('Os argumentos não são um JSON válido e não consegui consertar. Mande de novo como um objeto JSON (aspas duplas, \\\\ nos caminhos do Windows, \\n nas quebras de linha). Recebi: {0}', String(raw ?? '').slice(0, 300));
      continue;
    }
    const fn = by.get(tc.function.name);
    if (!fn && !tc.function.name.includes('__')) {
      const sug = [...known].map((k) => [k, editDist(k.toLowerCase(), tc.function.name.toLowerCase())]).sort((x, y) => x[1] - y[1]).slice(0, 4).map((x) => x[0]);
      tc.bad = L('A ferramenta "{0}" não existe aqui. Parecidas: {1}. Se for de um conector, procure com search_tools.', tc.function.name, sug.join(', '));
      continue;
    }
    if (fn?.parameters) {
      const r = fitArgs(args, fn.parameters);
      args = r.args; fix.push(...r.notes);
      if (r.missing.length) {
        const p = fn.parameters.properties || {};
        tc.bad = L('Faltou {0} em {1}. Parâmetros desta ferramenta:\n{2}', r.missing.join(', '), tc.function.name,
          Object.entries(p).map(([k, v]) => `- ${k}${(fn.parameters.required || []).includes(k) ? L(' (obrigatório)') : ''}: ${v.type || ''}${v.description ? ' — ' + String(v.description).slice(0, 140) : ''}`).join('\n'));
      }
    }
    if (fix.length) { tc.function.arguments = JSON.stringify(args); tc.fix = fix; }
  }
}
