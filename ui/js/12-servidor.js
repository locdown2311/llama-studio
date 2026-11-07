/* llama studio - servidor llama-server, tela de abertura, atualizações e status */
'use strict';

/* ============================================================ servidor (llama-server) */
async function startLlama() {
  try { S.llama = await api('/api/llama/start', {}); showSplash(); }
  catch (e) { toast(e.message, 'err'); setView('server'); }
  lastHealth = ''; checkHealth(); if (S.view === 'server') drawServerStatus();
}
async function stopLlama() {
  try { S.llama = await api('/api/llama/stop', {}); toast('Servidor parado'); } catch (e) { toast(e.message, 'err'); }
  lastHealth = ''; checkHealth(); if (S.view === 'server') drawServerStatus();
}

let srvTimer = null; let logNext = 0;
async function renderServerPage() {
  try { S.llama = await api('/api/llama'); } catch (e) { toast(e.message, 'err'); return; }
  await loadModels();
  drawServerStatus(); drawServerForm(); drawModels(); pollHf(); loadEngines(true);
  $('#srv-log').textContent = ''; logNext = 0;
  await pollLog();
  clearInterval(srvTimer);
  srvTimer = setInterval(async () => {
    if (S.view !== 'server') { clearInterval(srvTimer); return; }
    await pollLog();
    try { const n = await api('/api/llama'); const changed = n.state !== S.llama.state || n.running !== S.llama.running; S.llama = n; if (changed) drawServerStatus(); } catch { /* ok */ }
  }, 1000);
}

/* ------------------------------------------------------------ lista de modelos */
function drawModels() {
  const box = $('#models-list'); if (!box) return;
  box.innerHTML = '';
  const { models, active, found } = S.models;
  for (const m of models) {
    const on = m.id === active;
    const used = S.convs.filter((c) => c.modelId === m.id).length;
    box.append(h('div.mdl' + (on ? '.on' : ''), null,
      h('div.mdl-ico', { html: svg('cpu' in ICONS ? 'cpu' : 'server') }),
      h('div.mdl-main', null,
        h('div.mdl-name', null, m.name, on ? h('span.tag.ok', null, S.llama?.state === 'ready' ? 'carregado' : S.llama?.state?.includes('loading') ? 'carregando' : 'ativo') : null),
        h('div.mdl-path', { title: m.model }, m.model),
        h('div.mdl-meta', null, `contexto ${fmtK(m.context)}`, m.cpuMoe ? ` · ${m.cpuMoe} camadas MoE na CPU` : '', m.threads ? ` · ${m.threads} threads` : '', used ? ` · ${used} conversa${used > 1 ? 's' : ''}` : '')),
      h('div.mdl-acts', null,
        on ? null : h('button.btn.sm', { onclick: async () => { try { await activateModel(m.id); } catch (e) { toast(e.message, 'err'); } } }, ic('play'), 'Carregar'),
        h('button.btn.sm.ghost', { title: 'Mede algumas configurações no seu PC e grava a mais rápida neste modelo', onclick: () => openBench(m) }, ic('zap'), 'Otimizar'),
        h('button.icon-btn.sm', { title: 'Editar', 'aria-label': 'Editar', html: svg('edit'), onclick: () => editModel(m) }),
        on ? null : h('button.icon-btn.sm', { title: 'Remover da lista', 'aria-label': 'Remover', html: svg('trash'), onclick: async () => {
          if (!(await confirmBox(`Tirar "${m.name}" da lista? O arquivo não é apagado.`, 'Remover', true))) return;
          await saveModels(models.filter((x) => x.id !== m.id));
        } }))));
  }
  drawDownloads(box);
  box.append(h('div.mdl-adds', null,
    h('button.mdl.add', { onclick: () => openHf() }, ic('download'), 'Buscar e baixar do Hugging Face'),
    h('button.mdl.add', { onclick: () => editModel(null) }, ic('plus'), 'Adicionar arquivo .gguf do computador')));
  if (found?.length) {
    box.append(h('div.mdl-found-t', null, 'Encontrados perto do llama-server'));
    const wrap = h('div.mdl-found');
    for (const f of found.slice(0, 12)) wrap.append(h('button.chip', { title: f.path, onclick: () => editModel(null, f.path) }, ic('plus'), f.name, h('span.muted', null, fmtBytes(f.size))));
    box.append(wrap);
  }
}

/* ------------------------------------------------------------ argumentos do llama-server */
// Opções conhecidas do llama-server, com explicação. O que não estiver aqui vai para "Outros".
const ARG_GROUPS = [
  ['gpu', 'Desempenho e memória', 'cpu'],
  ['think', 'Raciocínio e formato', 'brain'],
  ['sample', 'Amostragem (criatividade)', 'sparkles'],
  ['vision', 'Visão', 'eye'],
];
const ARG_DEFS = [
  { k: 'ngl', f: ['-ngl', '--gpu-layers', '--n-gpu-layers'], g: 'gpu', t: 'num', min: 0, max: 99, def: 99, l: 'Camadas na GPU', d: 'Quantas camadas do modelo vão para a placa de vídeo. 99 = todas (mais rápido, se couber na VRAM).' },
  { k: 'fa', f: ['-fa', '--flash-attn'], g: 'gpu', t: 'sel', o: ['on', 'off', 'auto'], l: 'Flash attention', d: 'Atenção otimizada: menos memória e mais velocidade. Deixe ligada se a placa suportar.' },
  { k: 'ctk', f: ['-ctk', '--cache-type-k'], g: 'gpu', t: 'sel', o: ['f16', 'q8_0', 'q4_0', 'q5_0', 'q5_1', 'q4_1', 'bf16', 'f32'], l: 'Cache K', d: 'Precisão da memória do contexto (chaves). q8_0 usa metade da memória de f16 quase sem perda.' },
  { k: 'ctv', f: ['-ctv', '--cache-type-v'], g: 'gpu', t: 'sel', o: ['f16', 'q8_0', 'q4_0', 'q5_0', 'q5_1', 'q4_1', 'bf16', 'f32'], l: 'Cache V', d: 'Precisão da memória do contexto (valores). Com q8_0/q4_0 é preciso flash attention ligada.' },
  { k: 'b', f: ['-b', '--batch-size'], g: 'gpu', t: 'num', opts: [64, 128, 256, 512, 1024, 2048, 4096, 8192], def: 2048, l: 'Lote (batch)', d: 'Tokens processados por vez ao ler o prompt. Maior = leitura mais rápida, mais memória. Padrão 2048.' },
  { k: 'ub', f: ['-ub', '--ubatch-size'], g: 'gpu', t: 'num', opts: [32, 64, 128, 256, 512, 1024, 2048, 4096], def: 512, l: 'Microlote (ubatch)', d: 'Pedaço físico do lote. 512 é um bom valor; maior pode acelerar em GPUs grandes.' },
  { k: 'np', f: ['-np', '--parallel'], g: 'gpu', t: 'num', min: 1, max: 8, def: 1, l: 'Conversas em paralelo', d: 'Quantas respostas o servidor gera ao mesmo tempo (slots). Cada uma divide o contexto, a não ser com contexto unificado.' },
  { k: 'kvu', f: ['--kv-unified', '-kvu'], g: 'gpu', t: 'bool', l: 'Contexto unificado', d: 'Os slots paralelos compartilham o mesmo contexto em vez de dividi-lo. Recomendado com mais de 1 em paralelo.' },
  { k: 'ckpt', f: ['--ctx-checkpoints'], g: 'gpu', t: 'num', min: 0, max: 64, def: 8, l: 'Checkpoints de contexto', d: 'Pontos salvos do contexto para reaproveitar o prompt entre mensagens em modelos híbridos/SWA. Mais = menos reprocessamento, mais RAM.' },
  { k: 'creuse', f: ['--cache-reuse'], g: 'gpu', t: 'num', opts: [0, 64, 128, 256, 512, 1024], def: 0, l: 'Reaproveitar cache (cache-reuse)', d: 'Reaproveita pedaços do cache quando o começo do prompt muda (compactação, ferramenta carregada). 256 acelera bastante conversas longas; 0 desliga.' },
  { k: 'mlock', f: ['--mlock'], g: 'gpu', t: 'bool', l: 'Travar na RAM (mlock)', d: 'Impede o sistema de mandar o modelo para o disco. Use só se sobrar RAM.' },
  { k: 'nommap', f: ['--no-mmap'], g: 'gpu', t: 'bool', l: 'Não mapear o arquivo (no-mmap)', d: 'Carrega o modelo inteiro na memória em vez de ler do disco sob demanda. Carrega mais devagar, pode rodar mais estável.' },
  { k: 'jinja', f: ['--jinja'], g: 'think', t: 'bool', l: 'Template Jinja', d: 'Usa o template de chat do próprio modelo. Necessário para ferramentas (tool calling). Deixe ligado.' },
  { k: 'rbudget', f: ['--reasoning-budget'], g: 'think', t: 'num', opts: [-1, 0, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768], def: -1, fmt: (v) => (v == -1 ? 'sem limite' : v == 0 ? 'desligado' : v), l: 'Limite de raciocínio (tokens)', d: 'Quantos tokens o modelo pode pensar antes de responder. -1 = sem limite, 0 = sem raciocínio.' },
  { k: 'rmsg', f: ['--reasoning-budget-message'], g: 'think', t: 'text', l: 'Mensagem ao estourar o limite', d: 'Texto inserido quando o raciocínio atinge o limite, para o modelo partir para a resposta.' },
  { k: 'tkw', f: ['--chat-template-kwargs'], g: 'think', t: 'text', l: 'Parâmetros do template (JSON)', d: 'Opções passadas ao template de chat. Ex.: {"enable_thinking":true} liga o raciocínio nos Qwen3.5 pequenos, que vêm com ele desligado.' },
  { k: 'rformat', f: ['--reasoning-format'], g: 'think', t: 'sel', o: ['auto', 'deepseek', 'none'], l: 'Formato do raciocínio', d: 'Como separar o pensamento da resposta. auto funciona para a maioria.' },
  { k: 'temp', f: ['--temp', '--temperature'], g: 'sample', t: 'num', min: 0, max: 2, def: 0.8, step: 0.05, l: 'Temperatura', d: 'Criatividade. Baixa (0,2-0,6) = mais preciso e repetível; alta (0,8+) = mais variado.' },
  { k: 'topk', f: ['--top-k'], g: 'sample', t: 'num', min: 0, max: 100, def: 40, l: 'Top-K', d: 'Considera só os K tokens mais prováveis. 20-40 é comum; 0 desliga.' },
  { k: 'topp', f: ['--top-p'], g: 'sample', t: 'num', min: 0, max: 1, step: 0.01, def: 0.95, step: 0.05, l: 'Top-P', d: 'Considera os tokens até somar essa probabilidade. 0,9-0,95 é comum; 1 desliga.' },
  { k: 'minp', f: ['--min-p'], g: 'sample', t: 'num', min: 0, max: 1, def: 0.05, step: 0.01, l: 'Min-P', d: 'Descarta tokens muito menos prováveis que o melhor. 0,05 é um bom valor; 0 desliga.' },
  { k: 'rpen', f: ['--repeat-penalty'], g: 'sample', t: 'num', min: 0.8, max: 2, step: 0.01, def: 1, step: 0.05, l: 'Penalidade de repetição', d: 'Evita repetir texto. 1,0 = desligada (recomendado para modelos novos).' },
  { k: 'ppen', f: ['--presence-penalty'], g: 'sample', t: 'num', min: 0, max: 2, def: 0, step: 0.1, l: 'Penalidade de presença', d: 'Incentiva assuntos novos. 0 = desligada; alguns modelos recomendam 1,5.' },
  { k: 'mmproj', f: ['--mmproj', '-mm'], g: 'vision', t: 'file', l: 'Projetor de visão (mmproj)', d: 'Arquivo mmproj-*.gguf que permite ao modelo ver imagens. Vem no mesmo repositório do modelo.' },
];

function splitArgs(str) {
  const out = []; const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g; let m;
  while ((m = re.exec(str || ''))) out.push(m[1] !== undefined ? m[1].replace(/\\"/g, '"') : m[2] !== undefined ? m[2] : m[3]);
  return out;
}
const quoteArg = (v) => (/[\s"]/.test(v) || v === '' ? '"' + v.replace(/"/g, '\\"') + '"' : v);

function parseServerArgs(str) {
  const toks = splitArgs(str); const vals = {}; const rest = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const eq = t.startsWith('--') && t.includes('=') ? t.indexOf('=') : -1;
    const flag = eq > 0 ? t.slice(0, eq) : t;
    const def = ARG_DEFS.find((d) => d.f.includes(flag));
    if (!def) {
      rest.push(t);
      // valor da opção desconhecida vai junto
      if (t.startsWith('-') && eq < 0 && toks[i + 1] !== undefined && !/^-[a-zA-Z-]/.test(toks[i + 1])) rest.push(toks[++i]);
      continue;
    }
    if (def.t === 'bool') { vals[def.k] = true; continue; }
    vals[def.k] = eq > 0 ? t.slice(eq + 1) : (toks[++i] ?? '');
  }
  return { vals, rest };
}

function buildArgs(vals, restStr) {
  const parts = [];
  for (const d of ARG_DEFS) {
    const v = vals[d.k];
    if (d.t === 'bool') { if (v) parts.push(d.f[0]); continue; }
    if (v === undefined || v === null || String(v).trim() === '') continue;
    parts.push(d.f[0], quoteArg(String(v).trim()));
  }
  const rest = (restStr || '').trim();
  return [parts.join(' '), rest].filter(Boolean).join(' ');
}

/**
 * Controle deslizante com limites. Sem valor = "padrão" do llama-server (apagado);
 * mexer define o valor, e o x volta ao padrão. opts = lista de valores permitidos.
 */
function slider(d, value, { optional = true } = {}) {
  const opts = d.opts;
  const min = opts ? 0 : d.min; const max = opts ? opts.length - 1 : d.max;
  const step = opts ? 1 : (d.step || (Number.isInteger(d.min) && Number.isInteger(d.max) && d.max > 4 ? 1 : 0.05));
  const toPos = (v) => {
    if (!opts) return Math.min(max, Math.max(min, Number(v)));
    const n = Number(v); let best = 0;
    opts.forEach((o, i) => { if (Math.abs(o - n) < Math.abs(opts[best] - n)) best = i; });
    return best;
  };
  const decimals = String(step).split('.')[1]?.length || 0;
  const fromPos = (p) => (opts ? opts[p] : Number((Math.round(Number(p) / step) * step).toFixed(decimals)));
  const show = (v) => (d.fmt ? d.fmt(v) : decimals ? Number(v).toFixed(decimals).replace('.', ',') : Number(v).toLocaleString('pt-BR'));
  let set = value !== undefined && value !== null && String(value).trim() !== '' && !isNaN(Number(String(value).replace(',', '.')));
  const start = set ? Number(String(value).replace(',', '.')) : (d.def ?? (opts ? opts[0] : min));
  const range = h('input', { type: 'range', min, max, step, value: toPos(start) });
  const out = h('output.sld-v');
  const reset = optional ? h('button.sld-x', { type: 'button', title: 'Voltar ao padrão do llama-server', 'aria-label': 'Voltar ao padrão', html: svg('x') }) : null;
  const el = h('div.sld', null, range, out, reset);
  const paint = () => {
    const pct = (Number(range.value) - min) / (max - min || 1) * 100;
    range.style.setProperty('--p', pct + '%');
    el.classList.toggle('unset', !set);
    out.textContent = set ? show(fromPos(Number(range.value))) : 'padrão';
    out.title = set ? '' : `Não definido: o llama-server usa o próprio padrão${d.def !== undefined ? ' (' + show(d.def) + ')' : ''}`;
  };
  range.addEventListener('input', () => { set = true; paint(); });
  reset?.addEventListener('click', () => { set = false; range.value = toPos(d.def ?? min); paint(); });
  paint();
  return { el, get: () => (set ? String(fromPos(Number(range.value))) : ''), set: (v) => { set = true; range.value = toPos(v); paint(); } };
}

/** Editor visual dos argumentos extras, com troca para texto. */
function argsEditor(initial) {
  let raw = initial || '';
  let mode = 'form';
  const box = h('div.args-ed');
  const seg = h('div.seg.sm', null,
    h('button', { type: 'button', onclick: () => setMode('form') }, 'Opções'),
    h('button', { type: 'button', onclick: () => setMode('text') }, 'Texto'));
  const ta = h('textarea.textarea.mono', { rows: 4 });
  const form = h('div.args-form');
  let read = () => raw;

  const drawForm = () => {
    const { vals, rest } = parseServerArgs(raw);
    form.innerHTML = '';
    const getters = [];
    for (const [g, title, icon] of ARG_GROUPS) {
      const defs = ARG_DEFS.filter((d) => d.g === g);
      const setCount = defs.filter((d) => vals[d.k] !== undefined && vals[d.k] !== false).length;
      const body = h('div.args-grid');
      for (const d of defs) {
        let input; const v = vals[d.k];
        if (d.t === 'bool') {
          input = h('input', { type: 'checkbox', checked: !!v });
          getters.push(() => [d.k, input.checked]);
          body.append(h('label.arg.arg-bool', { title: d.d }, h('span.switch.sm', null, input, h('span')), h('span.arg-main', null, h('span.arg-l', null, d.l), h('span.arg-d', null, d.d))));
          continue;
        }
        if (d.t === 'sel') {
          input = h('select.select', null, h('option', { value: '' }, 'padrão'), ...[...new Set([...(v && !d.o.includes(v) ? [v] : []), ...d.o])].map((o) => h('option', { value: o }, o)));
          input.value = v ?? '';
        } else if (d.t === 'file') {
          input = h('input.input.mono', { value: v ?? '', placeholder: 'nenhum' });
        } else if (d.t === 'num' && (d.opts || d.max !== undefined)) {
          const sl = slider(d, v);
          input = sl.el;
          getters.push(() => [d.k, sl.get()]);
        } else {
          input = h('input.input' + (d.t === 'num' ? '.mono' : ''), { value: v ?? '', placeholder: 'padrão', inputmode: d.t === 'num' ? 'decimal' : undefined });
        }
        if (!input.classList.contains('sld')) getters.push(() => [d.k, input.value.trim().replace(/,/g, d.t === 'num' ? '.' : ',')]);
        const pick = d.t === 'file' ? h('button.btn.sm', { type: 'button', onclick: async () => {
          const p = await pickPath({ title: 'Escolher o mmproj (.gguf)', mode: 'file', start: input.value ? input.value.replace(/[\\/][^\\/]*$/, '') : S.info.home });
          if (p) input.value = p;
        } }, 'Procurar') : null;
        body.append(h('div.arg' + (d.t === 'file' || d.t === 'text' ? '.wide' : ''), null,
          h('label.arg-l', { title: d.d }, d.l, h('span.arg-help', { title: d.d, html: svg('info' in ICONS ? 'info' : 'alert') })),
          pick ? h('div.inline', null, input, pick) : input,
          h('span.arg-d', null, d.d)));
      }
      const det = h('details.args-sec', { open: setCount > 0 || g === 'gpu' }, h('summary', null, ic('chev'), ic(icon in ICONS ? icon : 'gear'), h('span', null, title), setCount ? h('span.tag', null, `${setCount} definida${setCount > 1 ? 's' : ''}`) : null), body);
      form.append(det);
    }
    const restIn = h('textarea.textarea.mono', { rows: 2, value: rest.map(quoteArg).join(' '), placeholder: 'Outras opções do llama-server, como no terminal' });
    form.append(h('div.args-sec.rest', null, h('div.arg-l', null, 'Outros argumentos'), restIn, h('span.arg-d', null, 'Opções que não estão acima ficam aqui, sem mudança. Lista completa: llama-server --help.')));
    read = () => buildArgs(Object.fromEntries(getters.map((g) => g())), restIn.value);
  };
  const setMode = (m) => {
    raw = mode === 'form' ? read() : ta.value;
    mode = m;
    seg.children[0].classList.toggle('on', m === 'form');
    seg.children[1].classList.toggle('on', m === 'text');
    if (m === 'form') { drawForm(); form.hidden = false; ta.hidden = true; }
    else { ta.value = raw; form.hidden = true; ta.hidden = false; }
  };
  box.append(h('div.args-top', null, h('span.arg-l', null, 'Argumentos do llama-server'), h('span.spacer'), seg), form, ta);
  setMode('form');
  return { el: box, get: () => (mode === 'form' ? read() : ta.value).trim() };
}

/* ------------------------------------------------------------ motores do llama.cpp */
S.engines = null;
let engTimer = 0;
const ENGINE_ICON = { vulkan: 'cpu', cuda: 'cpu', rocm: 'cpu', sycl: 'cpu', cpu: 'cpu' };

async function loadEngines(check = true) {
  try { S.engines = await api('/api/engines' + (check ? '?check=1' : '')); } catch (e) { if (check) toast(e.message, 'err'); return null; }
  drawEngines();
  clearTimeout(engTimer);
  if (S.engines.jobs?.some((j) => j.status === 'downloading')) engTimer = setTimeout(() => pollEngines(), 1000);
  return S.engines;
}

async function pollEngines() {
  const before = new Map((S.engines?.jobs || []).map((j) => [j.id, j.status]));
  let r; try { r = await api('/api/engines'); } catch { return; }
  S.engines = { ...S.engines, ...r, available: S.engines?.available, suggest: r.suggest };
  for (const j of r.jobs) if (before.get(j.id) === 'downloading' && j.status !== 'downloading') {
    if (j.status === 'done') { toast(`Motor ${j.variant} ${j.tag} instalado e em uso`); try { S.llama = await api('/api/llama'); } catch { /* ok */ } if (S.view === 'server') { drawServerStatus(); drawServerForm(); } }
    else if (j.status === 'error') toast(`Motor ${j.variant}: ${j.error}`, 'err');
  }
  drawEngines(); $('#onb')?.dispatchEvent(new Event('refresh'));
  if (r.jobs.some((j) => j.status === 'downloading')) engTimer = setTimeout(pollEngines, 1000);
}

async function installEngine(variant) {
  try { await api('/api/engines/install', { variant, activate: true }); toast('Baixando o motor...'); pollEngines(); }
  catch (e) { toast(e.message, 'err'); }
}

function engineCards(box, { compact = false } = {}) {
  const E = S.engines; if (!E) { box.append(h('div.empty-card', null, 'Carregando...')); return; }
  const job = (v) => E.jobs?.find((j) => j.variant === v && j.status === 'downloading');
  const inst = (v) => (E.installed || []).filter((x) => x.id.startsWith(v + '-'));
  if (E.error) box.append(h('div.eng-err', null, ic('alert'), E.error));
  const fams = [['llama', 'llama.cpp', 'O oficial. Suporte a tudo que sai de novo.'], ['ik', 'ik_llama.cpp', 'Fork focado em velocidade na CPU e em MoE com camadas na CPU (como o Qwen 35B-A3B). Compilado pelo projeto do Llama Studio.']];
  for (const [fam, title, sub] of fams) {
  const list = (E.available || []).filter((a) => (a.family || 'llama') === fam);
  if (!list.length || (compact && fam !== 'llama')) continue;
  if (!compact) box.append(h('div.eng-fam', null, h('b', null, title), h('span', null, sub)));
  const grid = h('div.eng-grid');
  for (const a of list) {
    const mine = inst(a.id); const act = mine.find((x) => x.active); const jb = job(a.id);
    const newer = mine.length && a.tag && !mine.some((x) => x.id === `${a.id}-${a.tag}`);
    const rec = E.suggest === a.id;
    let action;
    if (jb) {
      const pct = jb.total ? Math.min(100, jb.done / jb.total * 100) : 0;
      action = h('div.eng-prog', null, h('div.dl-bar', null, h('i', { style: { width: pct.toFixed(1) + '%' } })), h('span', null, `${fmtBytes(jb.done)} de ${fmtBytes(jb.total)}`),
        h('button.icon-btn.sm', { title: 'Cancelar', 'aria-label': 'Cancelar', html: svg('x'), onclick: async () => { await api('/api/engines/cancel', { id: jb.id }); loadEngines(false); } }));
    } else if (a.missing) action = h('span.muted', null, a.family === 'ik' ? 'Ainda não compilado' : 'Sem pacote para Windows agora');
    else if (act && !newer) action = h('span.tag.ok', null, 'em uso');
    else if (mine.length && !newer) action = h('button.btn.sm', { onclick: async () => { try { S.llama = await api('/api/engines/use', { path: mine[0].path }); toast('Motor trocado'); loadEngines(false); drawServerStatus?.(); } catch (e) { toast(e.message, 'err'); } } }, ic('play'), 'Usar');
    else action = h('button.btn.sm' + (rec || newer ? '.primary' : ''), { onclick: () => installEngine(a.id) }, ic('download'), newer ? `Atualizar para ${a.tag}` : `Instalar · ${fmtBytes(a.size)}`);
    grid.append(h('div.eng' + (act ? '.on' : '') + (rec ? '.rec' : ''), null,
      h('div.eng-top', null, h('b', null, a.name), a.label ? h('span.tag', null, a.label) : null, rec ? h('span.tag.ctx', null, 'recomendado') : null),
      compact ? null : h('div.eng-desc', null, a.desc),
      h('div.eng-foot', null, action)));
  }
  box.append(grid);
  }
  if (!compact) {
    const cur = E.current;
    box.append(h('div.eng-cur', null, ic(E.currentExists ? 'check' : 'alert'),
      h('span', null, E.currentExists ? (E.managed ? 'Em uso: ' : 'Em uso (fora do studio): ') : 'O llama-server configurado não existe: '), h('code', { title: cur }, cur || 'nenhum'),
      (E.gpus || []).length ? h('span.muted', null, ' · placa: ' + E.gpus.join(', ')) : null));
    const others = (E.installed || []).filter((x) => !x.active);
    if (others.length) {
      box.append(h('div.eng-inst', null, h('span.muted', null, 'Também instalados:'),
        ...others.map((x) => h('span.chip', null, x.id, h('button.linkish', { onclick: async () => { try { S.llama = await api('/api/engines/use', { path: x.path }); loadEngines(false); } catch (e) { toast(e.message, 'err'); } } }, 'usar'),
          h('button.linkish', { onclick: async () => { if (!(await confirmBox(`Remover o motor ${x.id}?`, 'Remover', true))) return; try { S.engines = { ...S.engines, ...(await api('/api/engines/remove', { id: x.id })) }; drawEngines(); } catch (e) { toast(e.message, 'err'); } } }, 'remover')))));
    }
  }
}

function drawEngines() {
  const box = $('#engines'); if (!box) return;
  box.innerHTML = '';
  engineCards(box);
}

/* ------------------------------------------------------------ primeira abertura: guia */
async function maybeOnboard(force = false) {
  if (!force && store.get('onboarded', false)) return;
  const E = await loadEngines(true);
  await loadModels();
  const needEngine = !E?.currentExists;
  const needModel = !S.models.models.length;
  if (!force && !needEngine && !needModel) { store.set('onboarded', true); return; }
  openOnboarding();
}

function openOnboarding() {
  if ($('#onb')) return;
  const body = h('div.onb#onb');
  const draw = () => {
    body.innerHTML = '';
    const E = S.engines || {};
    const engOk = !!E.currentExists && !E.jobs?.some((j) => j.status === 'downloading');
    const modelOk = S.models.models.length > 0;
    const step = (n, done, title, sub, content) => h('div.onb-step' + (done ? '.done' : ''), null,
      h('div.onb-n', null, done ? h('span', { html: svg('check') }) : String(n)),
      h('div.onb-main', null, h('div.onb-title', null, title), h('div.onb-sub', null, sub), content));
    const engBox = h('div'); engineCards(engBox, { compact: true });
    body.append(
      h('p.onb-lead', null, 'Dois passos e você já pode conversar com um modelo rodando no seu computador.'),
      step(1, engOk, 'Instale o motor', E.gpus?.length ? `Encontrei: ${E.gpus.join(', ')}. Já marquei o recomendado.` : 'Escolha conforme a sua placa de vídeo. Em dúvida, Vulkan.', engOk && !E.jobs?.some((j) => j.status === 'downloading') ? null : engBox),
      step(2, modelOk, 'Baixe um modelo', modelOk ? `${S.models.models.length} modelo(s) na lista.` : 'Modelos GGUF do Hugging Face. Para começar, algo entre 4B e 9B em Q4_K_M roda bem na maioria das placas.',
        modelOk ? null : h('div.onb-models', null,
          ...[['Qwen3.5 9B', 'unsloth/Qwen3.5-9B-GGUF'], ['Qwen3.5 4B (leve)', 'unsloth/Qwen3.5-4B-GGUF'], ['Gemma 4', 'gemma 4 gguf']].map(([l, q]) => h('button.chip', { onclick: () => openHf(q) }, ic('download'), l)),
          h('button.btn.sm', { onclick: () => openHf() }, ic('search'), 'Procurar outro'))));
  };
  body.addEventListener('refresh', draw);
  draw();
  const timer = setInterval(async () => { if (!document.body.contains(body)) { clearInterval(timer); return; } await loadModels(); draw(); }, 2500);
  const m = modal({
    title: 'Boas-vindas ao Llama Studio', wide: true, body: [body],
    foot: [h('button.btn', { onclick: () => { store.set('onboarded', true); m.close(); } }, 'Configurar depois'),
      h('button.btn.primary', { onclick: async () => {
        store.set('onboarded', true); m.close();
        if (S.engines?.currentExists && S.models.models.length) {
          if (!S.models.active) { try { await activateModel(S.models.models[0].id); } catch (e) { toast(e.message, 'err'); } }
          else if (S.llama?.state === 'stopped') startLlama();
        }
      } }, 'Começar')],
  });
}

/* ------------------------------------------------------------ Hugging Face */
S.hfJobs = [];
let hfTimer = 0;

function drawDownloads(box) {
  for (const j of S.hfJobs) {
    const pct = j.total ? Math.min(100, j.done / j.total * 100) : 0;
    const eta = j.rate > 0 && j.total > j.done ? Math.round((j.total - j.done) / j.rate) : 0;
    const etaTxt = eta ? (eta > 3600 ? `${Math.floor(eta / 3600)} h ${Math.round(eta % 3600 / 60)} min` : eta > 60 ? `${Math.round(eta / 60)} min` : `${eta} s`) : '';
    const sub = j.status === 'downloading' ? `${fmtBytes(j.done)} de ${fmtBytes(j.total)} · ${j.rate ? fmtBytes(j.rate) + '/s' : 'conectando...'}${etaTxt ? ' · falta ' + etaTxt : ''}`
      : j.status === 'done' ? 'Baixado e adicionado à lista' : j.status === 'canceled' ? 'Cancelado (o que já baixou fica guardado para continuar depois)' : (j.error || 'Erro');
    box.append(h('div.mdl.dl.' + j.status, null,
      h('div.mdl-ico', { html: svg(j.status === 'done' ? 'check' : j.status === 'error' ? 'alert' : 'download') }),
      h('div.mdl-main', null,
        h('div.mdl-name', null, j.name, h('span.muted.mdl-repo', null, j.repo)),
        j.status === 'downloading' ? h('div.dl-bar', null, h('i', { style: { width: pct.toFixed(1) + '%' } })) : null,
        h('div.mdl-meta', null, sub)),
      h('div.mdl-acts', null,
        j.status === 'error' || j.status === 'canceled' ? h('button.btn.sm', { onclick: () => hfDownload(j.repo, { name: j.name, parts: j.parts }) }, ic('refresh'), 'Continuar') : null,
        j.status === 'done' && j.profile ? h('button.btn.sm', { onclick: async () => { try { await activateModel(j.profile); } catch (e) { toast(e.message, 'err'); } } }, ic('play'), 'Carregar') : null,
        h('button.icon-btn.sm', { title: j.status === 'downloading' ? 'Cancelar' : 'Tirar da lista', 'aria-label': 'Cancelar', html: svg('x'), onclick: async () => {
          try { S.hfJobs = (await api('/api/hf/cancel', { id: j.id })).jobs; } catch { /* ok */ }
          drawModels();
        } }))));
  }
}

async function pollHf() {
  clearTimeout(hfTimer);
  let r; try { r = await api('/api/hf/downloads'); } catch { return; }
  const before = new Map(S.hfJobs.map((j) => [j.id, j.status]));
  S.hfJobs = r.jobs;
  for (const j of r.jobs) if (before.get(j.id) === 'downloading' && j.status !== 'downloading') {
    if (j.status === 'done') { toast(`${j.name} baixado`); loadModels(); }
    else if (j.status === 'error') toast(`${j.name}: ${j.error}`, 'err');
  }
  if (S.view === 'server') drawModels();
  if (r.jobs.some((j) => j.status === 'downloading')) hfTimer = setTimeout(pollHf, 1000);
}

async function hfDownload(repo, f, mmproj) {
  try {
    await api('/api/hf/download', { repo, name: f.name, parts: f.parts, mmproj: mmproj?.path || '', size: (f.size || 0) + (mmproj?.size || 0) });
    toast(`Baixando ${f.name}...`);
    if (S.view !== 'server') setView('server');
    pollHf();
  } catch (e) { toast(e.message, 'err'); }
}

function openHf(initial = '') {
  let timer = 0; let seq = 0;
  const q = h('input.input', { placeholder: 'Buscar modelos GGUF (ex.: qwen3 coder, gemma 3, llama 3.1 8b)', autofocus: true, value: initial });
  const list = h('div.hf-list');
  const back = h('button.btn.ghost.sm', { hidden: true, onclick: () => { back.hidden = true; q.parentElement.hidden = false; run(); } }, ic('chev'), 'Voltar à busca');
  back.querySelector('svg').style.transform = 'rotate(180deg)';
  const tokenBox = h('details.hf-token', null, h('summary', null, 'Token do Hugging Face (só para modelos restritos)'));
  api('/api/hf').then((i) => {
    const t = h('input.input.mono', { type: 'password', placeholder: i.hasToken ? 'Token salvo (digite para trocar)' : 'hf_...' });
    tokenBox.append(h('div.inline', null, t, h('button.btn', { onclick: async () => { await api('/api/hf', { token: t.value }); t.value = ''; toast('Token salvo'); } }, 'Salvar')),
      h('small.muted', null, `Os modelos são salvos em ${i.dir}`));
  }).catch(() => {});
  const run = async () => {
    const my = ++seq;
    list.innerHTML = ''; list.append(h('div.hf-empty', null, h('span', { html: svg('loader', 'spin'), style: { display: 'grid' } }), 'Buscando...'));
    let r; try { r = await api('/api/hf/search?q=' + encodeURIComponent(q.value.trim())); } catch (e) { if (my === seq) { list.innerHTML = ''; list.append(h('div.hf-empty.err', null, e.message)); } return; }
    if (my !== seq) return;
    list.innerHTML = '';
    if (!r.models.length) { list.append(h('div.hf-empty', null, 'Nada encontrado.')); return; }
    for (const m of r.models) {
      const [owner, name] = m.id.split('/');
      list.append(h('button.hf-repo', { onclick: () => openRepo(m.id) },
        h('div.hf-r-main', null, h('div.hf-r-name', null, name || m.id), h('div.hf-r-owner', null, owner)),
        h('span.hf-r-stat', { title: 'Downloads' }, ic('download'), fmtNum(m.downloads)),
        h('span.hf-r-stat', { title: 'Curtidas' }, ic('heart' in ICONS ? 'heart' : 'sparkles'), fmtNum(m.likes)),
        h('span', { html: svg('chev'), style: { display: 'grid', color: 'var(--muted)' } })));
    }
  };
  const openRepo = async (repo) => {
    ++seq; back.hidden = false; q.parentElement.hidden = true;
    list.innerHTML = ''; list.append(h('div.hf-empty', null, h('span', { html: svg('loader', 'spin'), style: { display: 'grid' } }), 'Lendo os arquivos...'));
    let r; try { r = await api('/api/hf/files?repo=' + encodeURIComponent(repo)); } catch (e) { list.innerHTML = ''; list.append(h('div.hf-empty.err', null, e.message)); return; }
    list.innerHTML = '';
    list.append(h('div.hf-head', null, h('b', null, repo), h('a.bin-link', { href: 'https://huggingface.co/' + repo, target: '_blank', rel: 'noopener' }, ic('external'), 'página')));
    let mm = null;
    if (r.mmproj.length) {
      const pick = r.mmproj.find((x) => /F16/i.test(x.quant)) || r.mmproj[0];
      const cb = h('input', { type: 'checkbox', checked: true, onchange: () => { mm = cb.checked ? pick : null; } });
      mm = pick;
      list.append(h('label.hf-mm', null, cb, h('span', null, `Incluir o projetor de visão (${pick.path.split('/').pop()}, ${fmtBytes(pick.size)}) para o modelo ver imagens`)));
    }
    if (!r.files.length) list.append(h('div.hf-empty', null, 'Este repositório não tem arquivos .gguf.'));
    const rec = r.files.find((f) => f.quant === 'Q4_K_M') || r.files.find((f) => /^Q4/.test(f.quant));
    for (const f of r.files) {
      list.append(h('div.hf-file', null,
        h('span.hf-q', null, f.quant || '?'),
        h('div.hf-f-main', null, h('div.hf-f-name', null, f.name, f === rec ? h('span.tag.ok', null, 'bom equilíbrio') : null),
          h('div.hf-f-sub', null, fmtBytes(f.size), f.parts.length > 1 ? ` · ${f.parts.length} partes` : '')),
        h('button.btn.sm' + (f === rec ? '.primary' : ''), { onclick: () => { md.close(); hfDownload(repo, f, mm); } }, ic('download'), 'Baixar')));
    }
  };
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 350); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); run(); } });
  const md = modal({ title: 'Modelos do Hugging Face', wide: true, body: [h('div.hf-search', null, h('span', { html: svg('search'), style: { display: 'grid' } }), q), back, list, tokenBox], foot: [h('button.btn', { onclick: () => md.close() }, 'Fechar')] });
  setTimeout(() => q.focus(), 50);
  if (/^[\w.-]+\/[\w.-]+$/.test(initial)) openRepo(initial); else run();
}

function fmtNum(n) { return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' mi' : n >= 1000 ? Math.round(n / 1000) + ' mil' : String(n); }

/* ------------------------------------------------------------ otimizar para o PC (llama-bench) */
function openBench(m) {
  const body = h('div.bench');
  let timer = 0; let started = false;
  const fmt = (x) => (x ? x.toFixed(1).replace('.', ',') : '–');
  const draw = (st) => {
    body.innerHTML = '';
    if (!started && !st?.running) {
      body.append(h('p', null, `Mede a velocidade de ${m.name} no seu computador com algumas combinações de microlote (ubatch) e threads, e grava a mais rápida neste modelo.`),
        h('ul.bench-notes', null, h('li', null, 'O llama-server fica parado durante o teste (alguns minutos) e volta sozinho no fim.'),
          h('li', null, 'Conta metade a velocidade de leitura do prompt e metade a de geração, que é o que mais pesa num agente.')));
      return;
    }
    if (st.error) body.append(h('div.eng-err', null, ic('alert'), st.error));
    if (st.running) {
      const pct = st.total ? st.done / st.total * 100 : 0;
      body.append(h('div.bench-prog', null, h('span', { html: svg('loader', 'spin') }), h('span', null, `Medindo... ${st.done} de ${st.total}`)), h('div.dl-bar', null, h('i', { style: { width: pct + '%' } })));
    }
    const r = st.result;
    if (r) {
      const gain = (a, b) => (a && b ? ` (${a >= b ? '+' : ''}${Math.round((a / b - 1) * 100)}%)` : '');
      body.append(h('div.bench-win', null, ic('check'), h('div', null, h('b', null, `Gravado: ubatch ${r.ub}, ${r.threads} threads`),
        h('div', null, `Leitura do prompt ${fmt(r.pp)} tok/s${gain(r.pp, r.beforePp)} · geração ${fmt(r.tg)} tok/s${gain(r.tg, r.beforeTg)}`))));
    }
    const combos = r?.combos || [];
    const rows = combos.length ? combos : [];
    if (!rows.length && st.rows?.length) {
      const map = new Map();
      for (const x of st.rows) { const k = x.ub + '|' + x.t; const o = map.get(k) || { ub: x.ub, t: x.t }; if (x.pp) o.pp = x.ts; else o.tg = x.ts; map.set(k, o); }
      rows.push(...map.values());
    }
    if (rows.length) {
      const best = r ? rows.find((x) => x.ub === r.ub && x.t === r.threads) : null;
      body.append(h('table.bench-t', null, h('thead', null, h('tr', null, h('th', null, 'ubatch'), h('th', null, 'threads'), h('th', null, 'leitura (tok/s)'), h('th', null, 'geração (tok/s)'))),
        h('tbody', null, rows.map((x) => h('tr' + (x === best ? '.best' : ''), null, h('td', null, String(x.ub)), h('td', null, String(x.t)), h('td', null, fmt(x.pp)), h('td', null, fmt(x.tg)))))));
    }
    if (st.log?.length && (st.running || st.error)) body.append(h('pre.bench-log', null, st.log.slice(-6).join('\n')));
  };
  const poll = async () => {
    let st; try { st = await api('/api/bench'); } catch { return; }
    draw(st);
    if (st.running) timer = setTimeout(poll, 1000);
    else { goBtn.disabled = false; goBtn.textContent = 'Medir de novo'; if (st.result) { loadModels(); try { S.llama = await api('/api/llama'); } catch { /* ok */ } } }
  };
  const goBtn = h('button.btn.primary', { onclick: async () => {
    try { started = true; goBtn.disabled = true; draw(await api('/api/bench/start', { id: m.id })); poll(); } catch (e) { toast(e.message, 'err'); goBtn.disabled = false; }
  } }, 'Começar');
  draw(null);
  api('/api/bench').then((st) => { if (st.running) { started = true; goBtn.disabled = true; poll(); } }).catch(() => {});
  const md = modal({ title: `Otimizar ${m.name} para o seu PC`, wide: true, body: [body],
    onClose: () => clearTimeout(timer),
    foot: [h('button.btn', { onclick: async () => { const st = await api('/api/bench').catch(() => ({})); if (st.running && await confirmBox('Parar a medição?', 'Parar', true)) await api('/api/bench/cancel', {}); md.close(); } }, 'Fechar'), goBtn] });
}

async function saveModels(list) {
  try { S.models = await api('/api/models', { models: list }); } catch (e) { toast(e.message, 'err'); return; }
  drawModels(); updatePickers();
}

function editModel(m, path) {
  const d = S.models.defaults || {};
  const base = m || { id: 'm' + Date.now().toString(36), name: path ? path.split(/[\\/]/).pop().replace(/\.gguf$/i, '').replace(/-\d{5}-of-\d{5}$/, '') : '', model: path || '', context: d.context || 32768, cpuMoe: d.cpuMoe || 0, threads: d.threads || 0, extraArgs: d.extraArgs || '' };
  const inp = (v, extra = {}) => h('input.input.mono', { value: v ?? '', ...extra });
  const name = h('input.input', { value: base.name, placeholder: 'ex.: Qwen 35B rápido' });
  const file = inp(base.model, { placeholder: 'C:\\modelos\\modelo.gguf' });
  const CTX_OPTS = [2048, 4096, 8192, 16384, 24576, 32768, 49152, 65536, 98304, 131072, 196608, 262144];
  const ctx = slider({ opts: CTX_OPTS, fmt: (v) => (v >= 1024 ? v / 1024 + 'k' : v) }, base.context || 32768, { optional: false });
  const moe = slider({ min: 0, max: 99, fmt: (v) => (v == 0 ? 'nenhuma' : v) }, base.cpuMoe || 0, { optional: false });
  const thr = slider({ min: 0, max: Math.max(4, navigator.hardwareConcurrency || 16), fmt: (v) => (v == 0 ? 'automático' : v) }, base.threads || 0, { optional: false });
  const extra = argsEditor(base.extraArgs);
  const pick = h('button.btn', { type: 'button', onclick: async () => {
    const p = await pickPath({ title: 'Escolher o modelo (.gguf)', mode: 'file', start: file.value ? file.value.replace(/[\\/][^\\/]*$/, '') : S.info.home });
    if (p) { file.value = p; if (!name.value.trim()) name.value = p.split(/[\\/]/).pop().replace(/\.gguf$/i, ''); }
  } }, 'Procurar');
  const field = (l, i, small) => h('div.field', null, h('label', null, l), i, small ? h('small', null, small) : null);
  const md = modal({
    title: m ? `Editar ${m.name}` : 'Adicionar modelo', wide: true,
    body: [h('div.form', null,
      field('Nome', name),
      h('div.field', null, h('label', null, 'Arquivo (.gguf)'), h('div.inline', null, file, pick)),
      h('div.row.sld-row', null, field('Contexto (tokens)', ctx.el, 'Mais contexto = conversas mais longas, mais memória.'), field('Camadas MoE na CPU', moe.el, 'Só para modelos MoE: tira camadas de especialistas da GPU.'), field('Threads', thr.el, 'Núcleos da CPU usados.')),
      extra.el)],
    foot: [h('button.btn', { onclick: () => md.close() }, 'Cancelar'), h('button.btn.primary', { onclick: async () => {
      const p = { ...base, name: name.value.trim() || 'Modelo', model: file.value.trim().replace(/^"|"$/g, ''), context: Number(ctx.get()), cpuMoe: Number(moe.get()), threads: Number(thr.get()), extraArgs: extra.get() };
      if (!p.model) { toast('Escolha o arquivo do modelo.', 'err'); return; }
      const list = S.models.models.filter((x) => x.id !== p.id);
      const at = S.models.models.findIndex((x) => x.id === p.id);
      list.splice(at < 0 ? list.length : at, 0, p);
      md.close();
      await saveModels(list);
      if (p.id === S.models.active) {
        if (S.llama?.running) {
          if (await confirmBox(`Recarregar ${p.name} agora para aplicar as mudanças?`, 'Recarregar')) { try { await activateModel(p.id); } catch (e) { toast(e.message, 'err'); } }
          else toast('Salvo. Vale na próxima vez que o modelo for carregado.');
        } else {
          try { S.llama = await api('/api/llama/config', { config: { Model: p.model, Context: p.context, CpuMoe: p.cpuMoe, Threads: p.threads, ExtraArgs: p.extraArgs } }); } catch { /* ok */ }
        }
      }
    } }, m ? 'Salvar' : 'Adicionar')],
  });
}

function drawServerStatus() {
  const l = S.llama; const box = $('#srv-status'); box.innerHTML = '';
  const info = {
    ready: ['ok', 'Pronto', `Respondendo em ${l.url}`],
    external: ['ok', 'Rodando fora do studio', `Alguém já iniciou um llama-server em ${l.url} (start.bat ou llama-gui).`],
    loading: ['busy', 'Carregando o modelo...', 'Isso pode levar alguns minutos na primeira vez.'],
    'external-loading': ['busy', 'Carregando o modelo (fora do studio)...', `Um llama-server iniciado fora do studio está carregando em ${l.url}.`],
    stopped: ['err', 'Parado', l.config.Model ? 'Pronto para iniciar.' : 'Escolha o modelo abaixo para poder iniciar.'],
  }[l.state] || ['', l.state, ''];
  box.append(
    h('span.dot.big.' + info[0]),
    h('div.srv-st-main', null, h('div.srv-st-title', null, info[1]), h('div.srv-st-sub', null, info[2], l.pid ? `  (PID ${l.pid})` : '')),
    h('div.page-actions', null,
      !l.running && l.state === 'stopped' ? h('button.btn.primary', { onclick: startLlama }, ic('play'), 'Iniciar') : null,
      l.running ? h('button.btn', { onclick: async () => { try { S.llama = await api('/api/llama/restart', {}); toast('Reiniciando...'); drawServerStatus(); } catch (e) { toast(e.message, 'err'); } } }, ic('refresh'), 'Reiniciar') : null,
      l.running ? h('button.btn.danger', { onclick: stopLlama }, ic('stop'), 'Parar') : null,
      h('button.btn', { onclick: () => navigator.clipboard.writeText(l.command).then(() => toast('Comando copiado')) }, ic('copy'), 'Copiar comando')));
}

function drawServerForm() {
  // as opções de cada modelo ficam no próprio modelo (lápis na lista acima); aqui só o que vale para todos
  const c = S.llama.config; const f = $('#srv-form'); f.innerHTML = '';
  const inp = (v, mono = true, extra = {}) => h('input.input' + (mono ? '.mono' : ''), { value: v ?? '', ...extra });
  const exe = inp(c.ServerExe);
  const host = inp(c.BindHost); const port = inp(c.Port, true, { inputmode: 'numeric' });
  const hip = inp(c.HipDevices, true, { placeholder: 'todas' });
  const auto = h('input', { type: 'checkbox', checked: !!c.AutoStart });
  const row = (label, input, btn, small) => h('div.field', null, h('label', null, label), btn ? h('div.inline', null, input, btn) : input, small ? h('small', null, small) : null);
  const browse = h('button.btn', { type: 'button', onclick: async () => {
    const start = exe.value ? exe.value.replace(/[\\/][^\\/]*$/, '') : S.info.home;
    const p = await pickPath({ title: 'Escolher o llama-server', mode: 'file', start }); if (p) exe.value = p;
  } }, 'Procurar');
  f.append(
    h('div.form-sec', null, 'Servidor', h('small', null, 'Vale para todos os modelos. Contexto, MoE, threads e argumentos ficam em cada modelo (lápis na lista de modelos).')),
    h('div.row', null, row('Host', host), row('Porta', port), row('Placas (HIP_VISIBLE_DEVICES)', hip, null, 'Ex.: 0 para só a primeira')),
    h('label.opt', { style: { padding: '2px 0' } }, auto, h('span.check', { html: svg('check'), style: { background: auto.checked ? 'var(--accent)' : '' } }), h('span.opt-main', null, h('span.opt-title', null, 'Iniciar o servidor quando o studio abrir'))),
    h('details.adv', null, h('summary', null, 'Avançado: usar outro llama-server'),
      row('Executável', exe, browse, 'Normalmente é escolhido em Motor, acima. Use para apontar uma build sua.')),
    h('div.form-foot', null, h('button.btn.primary', { type: 'button', onclick: async () => {
      const num = (x) => Math.max(0, parseInt(x.value, 10) || 0);
      try {
        S.llama = await api('/api/llama/config', { config: { ServerExe: exe.value.trim().replace(/^"|"$/g, ''), BindHost: host.value.trim() || '127.0.0.1', Port: num(port) || 1235, HipDevices: hip.value.trim(), AutoStart: auto.checked } });
        S.info.llamaUrl = S.llama.url; lastHealth = '';
        toast(S.llama.running ? 'Salvo. Reinicie o servidor para aplicar.' : 'Configuração salva');
        drawServerStatus(); checkHealth(); loadEngines(false);
      } catch (e) { toast(e.message, 'err'); }
    } }, 'Salvar')));
  auto.addEventListener('change', () => { auto.nextElementSibling.style.background = auto.checked ? 'var(--accent)' : ''; });
}

async function pollLog() {
  let r; try { r = await api('/api/llama/log?since=' + logNext); } catch { return; }
  if (!r.lines.length) { logNext = r.next; return; }
  const pre = $('#srv-log');
  const stick = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
  if (r.from > logNext && logNext) pre.append('[... linhas antigas descartadas]\n');
  pre.append(r.lines.join('\n') + '\n');
  logNext = r.next;
  // mantém o DOM leve
  if (pre.textContent.length > 400000) pre.textContent = pre.textContent.slice(-300000);
  if (stick) pre.scrollTop = pre.scrollHeight;
  $('#srv-log-count').textContent = `${logNext} linhas`;
}

/* ============================================================ tela de abertura */
// Etapas reconhecidas no log do llama-server e onde cada uma começa na barra (%)
const LOAD_STEPS = [
  { re: /llama_model_loader|print_info|loading model/i, pct: 5, label: 'Lendo o modelo' },
  { re: /load_tensors|offload|model buffer size/i, pct: 20, label: 'Carregando os pesos na memória e na GPU' },
  { re: /llama_context|llama_kv_cache|KV self size|kv_unified|n_ctx/i, pct: 80, label: 'Preparando o contexto' },
  { re: /warming up|warmup/i, pct: 92, label: 'Aquecendo o modelo' },
  { re: /server is listening|all slots are idle|main: model loaded/i, pct: 99, label: 'Abrindo o servidor' },
];
const splash = { on: false, step: -1, logNext: 0, timer: null, t0: 0, last: '' };

function splashFmt(ms) { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; }

function showSplash() {
  if (splash.on) return;
  const l = S.llama || {};
  splash.on = true; splash.step = -1; splash.logNext = 0; splash.last = '';
  splash.t0 = l.startedAt || Date.now();
  $('#sp-model').textContent = l.config?.Model ? shortModel(l.config.Model) : `llama-server em ${l.url || S.info.llamaUrl}`;
  $('#sp-steps').innerHTML = '';
  if (l.state !== 'external-loading') for (const st of LOAD_STEPS.slice(0, 4)) $('#sp-steps').append(h('li', null, st.label));
  $('#splash').hidden = false;
  requestAnimationFrame(() => $('#splash').classList.add('show'));
  tickSplash();
  splash.timer = setInterval(tickSplash, 700);
}

function hideSplash(done) {
  if (!splash.on) return;
  splash.on = false; clearInterval(splash.timer);
  if (done) {
    $('#sp-fill').style.width = '100%'; $('#sp-stage').textContent = 'Pronto';
    $$('#sp-steps li').forEach((li) => { li.className = 'ok'; });
  }
  setTimeout(() => { $('#splash').classList.remove('show'); setTimeout(() => { $('#splash').hidden = true; }, 350); }, done ? 450 : 0);
}

async function tickSplash() {
  let l;
  try { l = S.llama = noteLlama(await api('/api/llama')); } catch { return; }
  if (l.state === 'ready' || l.state === 'external') {
    lastHealth = ''; checkHealth();
    return hideSplash(true);
  }
  if (l.state === 'stopped') { toast('O llama-server parou durante a carga. Veja o log.', 'err'); hideSplash(false); setView('server'); return; }
  // log: etapa e última linha
  if (l.running) {
    try {
      const r = await api('/api/llama/log?since=' + splash.logNext);
      splash.logNext = r.next;
      for (const line of r.lines) {
        LOAD_STEPS.forEach((st, i) => { if (i > splash.step && st.re.test(line)) splash.step = i; });
        if (line.trim()) splash.last = line.trim();
      }
    } catch { /* ok */ }
  }
  const elapsed = Date.now() - splash.t0;
  const prev = store.get('loadMs', 0);
  const stage = LOAD_STEPS[splash.step];
  const floor = stage ? stage.pct : 2;
  const ceil = LOAD_STEPS[splash.step + 1]?.pct ?? 99;
  let pct = floor;
  if (prev) pct = Math.max(floor, Math.min(ceil - 1, (elapsed / prev) * 100));
  else if (stage) pct = Math.min(ceil - 1, floor + Math.log1p(elapsed / 4000) * 6);
  const known = l.running;
  $('#splash').classList.toggle('indet', !known);
  $('#sp-fill').style.width = known ? `${Math.min(99, pct).toFixed(1)}%` : '35%';
  $('#sp-stage').textContent = known ? (stage ? stage.label + '...' : 'Iniciando o servidor...') : 'Carregando o modelo (servidor iniciado fora do studio)...';
  $('#sp-time').textContent = splashFmt(elapsed) + (prev && known ? ` de ~${splashFmt(prev)}` : '');
  $$('#sp-steps li').forEach((li, i) => { li.className = i < splash.step ? 'ok' : i === splash.step ? 'now' : ''; });
  $('#sp-log').textContent = splash.last;
}

/** Guarda quanto a última carga do modelo levou (estimativa da barra). */
function noteLlama(l) {
  if (!l) return l;
  if (l.state === 'loading' && l.running && l.startedAt) S._loadingSince = l.startedAt;
  else if (l.state === 'ready' && S._loadingSince && l.startedAt === S._loadingSince) {
    const took = Date.now() - l.startedAt;
    if (took > 3000) store.set('loadMs', took);
    S._loadingSince = 0;
  }
  return l;
}

/** Espera o modelo terminar de carregar antes de responder (sem dar erro). */
async function waitModel(conv, signal) {
  const loading = () => S.llama && ['loading', 'external-loading'].includes(S.llama.state);
  if (!loading()) return;
  conv._waitingModel = true;
  const nm = modelById(S.models.active)?.name;
  conv._waitText = nm ? `Carregando ${nm}. A resposta começa sozinha.` : '';
  scheduleRender();
  const t0 = Date.now();
  try {
    while (loading() && !signal.aborted && Date.now() - t0 < 20 * 60 * 1000) {
      await new Promise((r) => setTimeout(r, 1000));
      try { S.llama = noteLlama(await api('/api/llama')); } catch { /* ok */ }
    }
  } finally { conv._waitingModel = false; conv._waitText = ''; scheduleRender(); lastHealth = ''; checkHealth(); }
}

/* ============================================================ atualizações */
async function checkUpdates(force = false) {
  try { S.update = await api('/api/update' + (force ? '?force=1' : '')); } catch { return null; }
  drawUpdateBadge();
  return S.update;
}

function drawUpdateBadge() {
  const u = S.update;
  let el = $('#update-badge');
  if (!(u && (u.uiUpdate || u.exeUpdate))) { el?.remove(); return; }
  if (!el) { el = h('button.update-badge#update-badge', { onclick: openUpdate }); $('#server-status').before(el); }
  el.innerHTML = '';
  el.append(ic('download'), h('span.ub-main', null, h('b', null, `Versão ${u.latest} disponível`), h('span', null, u.exeUpdate ? 'Programa e interface' : 'Interface nova')), h('span.ub-go', null, 'Ver'));
}

function openUpdate() {
  const u = S.update; if (!u) return;
  const running = S.llama?.running;
  let m;
  const busy = (b, label) => { b.disabled = true; b.textContent = label; };
  const uiBtn = u.uiUpdate ? h('button.btn' + (u.exeUpdate ? '' : '.primary'), { onclick: async (e) => {
    busy(e.currentTarget, 'Baixando...');
    try { const r = await api('/api/update/ui', {}); toast(`Interface ${r.version} instalada. Recarregando...`); setTimeout(() => location.reload(), 700); }
    catch (err) { toast(err.message, 'err'); m.close(); }
  } }, u.exeUpdate ? 'Só a interface' : 'Atualizar interface') : null;
  const exeBtn = u.exeUpdate ? h('button.btn.primary', { onclick: async (e) => {
    busy(e.currentTarget, 'Baixando...');
    try {
      await api('/api/update/exe', {});
      m.close();
      modal({ title: 'Reiniciando', body: h('p', null, 'A versão nova está abrindo. Esta janela vai fechar sozinha.') });
      if (!S.info.native) {
        // no navegador: espera a versão nova responder e recarrega
        const t0 = Date.now();
        const wait = async () => { try { const a = await api('/api/app'); if (a.version !== u.exe) return location.reload(); } catch { /* ainda reiniciando */ } if (Date.now() - t0 < 60000) setTimeout(wait, 1000); };
        setTimeout(wait, 2500);
      }
    } catch (err) { toast(err.message, 'err'); m.close(); }
  } }, 'Atualizar e reiniciar') : null;
  m = modal({
    title: `Atualização ${u.latest}`,
    body: [
      h('p.muted', { style: { marginTop: 0 } }, `Você usa o programa ${u.exe} com a interface ${u.ui}.`),
      u.notes ? h('div.md.update-notes', { html: md(u.notes) }) : null,
      u.exeUpdate && running ? h('p', { style: { color: 'var(--warn)', fontSize: '13.5px' } }, 'O llama-server reinicia junto e vai recarregar o modelo.') : null,
    ],
    foot: [h('a.btn.ghost', { href: u.url, target: '_blank', style: { marginRight: 'auto' } }, 'Ver no GitHub'), h('button.btn', { onclick: () => m.close() }, 'Depois'), uiBtn, exeBtn],
  });
}

function updateSection() {
  const box = h('div.form', { style: { gap: '10px' } });
  const info = h('p.muted', { style: { margin: 0, fontSize: '13.5px' } }, `Programa ${S.info.version || '?'}, interface ${S.info.uiVersion || '?'}. Atualizações vêm de github.com/${S.info.repo || ''}.`);
  const btn = h('button.btn', { type: 'button', onclick: async () => {
    btn.disabled = true; btn.textContent = 'Procurando...';
    const u = await checkUpdates(true);
    btn.disabled = false; btn.textContent = 'Procurar atualizações';
    if (!u) toast('Não consegui verificar agora.', 'err');
    else if (u.error) toast(u.error, 'err');
    else if (u.uiUpdate || u.exeUpdate) openUpdate();
    else toast(`Você já está na versão mais nova (${u.latest}).`);
  } }, 'Procurar atualizações');
  const reset = S.info.uiVersion && S.info.uiVersion !== S.info.version ? h('button.btn.ghost', { type: 'button', onclick: async () => {
    if (!(await confirmBox('Voltar para a interface que veio com o programa?', 'Voltar'))) return;
    await api('/api/update/reset-ui', {}); location.reload();
  } }, 'Voltar à interface original') : null;
  box.append(info, h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, btn, reset));
  return box;
}

/* ============================================================ status do servidor */
let lastHealth = '';
async function checkHealth() {
  let status = 'offline';
  try {
    S.llama = noteLlama(await api('/api/llama'));
    status = { ready: 'ok', external: 'ok', loading: 'loading', 'external-loading': 'loading' }[S.llama.state] || 'offline';
  } catch {
    try { const r = await fetch('/health'); status = r.ok ? 'ok' : r.status === 503 ? 'loading' : 'offline'; } catch { status = 'offline'; }
  }
  if (status === 'ok' && !S.model) {
    try { const p = await (await fetch('/props')).json(); S.model = p.model_path || p.model_alias || ''; S.vision = !!(p.modalities?.vision); S.nCtx = p.default_generation_settings?.n_ctx || p.n_ctx || 0; S.nSlots = p.total_slots || 1; drawCtxMeter(); } catch { /* ok */ }
    if (!S.model) { try { const m = await (await fetch('/v1/models')).json(); S.model = m.data?.[0]?.id || ''; } catch { /* ok */ } }
  }
  if (status !== 'ok') S.model = '';
  S.health.status = status;
  const canStart = status === 'offline' && S.llama && !S.llama.running && S.llama.config?.Model;
  const sig = status + S.model + S.info.llamaUrl + canStart;
  if (sig === lastHealth) return;
  lastHealth = sig;
  const el = $('#server-status'); el.innerHTML = '';
  el.append(h('span.dot.' + { ok: 'ok', loading: 'busy', offline: 'err' }[status]), h('div.ss-main', null,
    h('div.ss-title', null, { ok: 'llama-server pronto', loading: 'Carregando o modelo...', offline: 'llama-server desligado' }[status]),
    h('div.ss-sub', { title: S.model || S.info.llamaUrl }, S.model ? shortModel(S.model) : S.info.llamaUrl || '')),
    ...(canStart ? [h('button.btn.sm', { onclick: startLlama, title: 'Iniciar o llama-server' }, ic('play'), 'Iniciar')] : []));
  el.style.cursor = 'pointer';
  el.onclick = (e) => { if (!e.target.closest('button')) setView('server'); };
  updatePickers(); renderChatTitle();
}
