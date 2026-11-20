/* llama studio - tarefas agendadas: um pedido que roda sozinho num horário, com o agente completo, em segundo
   plano (o servidor cuida do relógio em src/agenda.rs e entrega para o executor). A lista fica na chave
   "schedules" do estado da interface; a última e a próxima execução vêm de /api/schedules/state. */
'use strict';

S.schedules = store.get('schedules', []);
function saveSchedules() { store.set('schedules', S.schedules); uiFlush(); }

const WEEKDAYS = () => [L('Dom'), L('Seg'), L('Ter'), L('Qua'), L('Qui'), L('Sex'), L('Sáb')];
function describeWhen(w) {
  w = w || {};
  if (w.kind === 'hours') return Number(w.every) === 1 ? L('A cada hora') : L('A cada {0} horas', w.every);
  if (w.kind === 'once') return L('Uma vez, em {0}', w.at ? fmtStamp(w.at) : '?');
  if (w.kind === 'weekly') return L('{0} às {1}', (w.days || []).slice().sort().map((d) => WEEKDAYS()[d]).join(', ') || L('nenhum dia'), w.time || '08:00');
  return L('Todo dia às {0}', w.time || '08:00');
}

/** Cria ou atualiza (mantém o id). */
function putSchedule(s) {
  const i = S.schedules.findIndex((x) => x.id === s.id);
  if (i >= 0) S.schedules[i] = s; else S.schedules.push(s);
  saveSchedules();
}

function editSchedule(s0, conv) {
  const isNew = !s0;
  const s = s0 ? JSON.parse(JSON.stringify(s0)) : { id: 'a' + uid().slice(0, 8), name: '', prompt: '', on: true, created: Date.now(), when: { kind: 'daily', time: '08:00', days: [1, 2, 3, 4, 5] }, projectId: conv ? projectOf(conv)?.id || null : null, modelId: conv?.modelId || null, reuse: false };
  const name = h('input.input', { value: s.name, placeholder: L('Ex.: Resumo das notícias') });
  const prompt = h('textarea.textarea', { rows: 5, value: s.prompt, placeholder: L('O que pedir, como numa mensagem. Ex.: Pesquise as principais notícias de tecnologia de hoje e resuma em 5 tópicos com os links.') });
  const time = h('input.input', { type: 'time', value: s.when.time || '08:00', style: { maxWidth: '140px' } });
  const every = h('input.input', { type: 'number', min: 1, max: 720, value: s.when.every || 6, style: { maxWidth: '100px' } });
  const pad = (n) => String(n).padStart(2, '0');
  const atD = s.when.at ? new Date(s.when.at) : new Date(Date.now() + 3600000);
  const at = h('input.input', { type: 'datetime-local', value: `${atD.getFullYear()}-${pad(atD.getMonth() + 1)}-${pad(atD.getDate())}T${pad(atD.getHours())}:${pad(atD.getMinutes())}`, style: { maxWidth: '230px' } });
  let kind = s.when.kind || 'daily';
  let days = new Set(s.when.days || [1, 2, 3, 4, 5]);
  const dayBox = h('div.sched-days');
  const drawDays = () => { dayBox.innerHTML = ''; WEEKDAYS().forEach((l, d) => dayBox.append(h('button.chip' + (days.has(d) ? '.on' : ''), { type: 'button', onclick: () => { days.has(d) ? days.delete(d) : days.add(d); drawDays(); } }, l))); };
  drawDays();
  const whenBox = h('div.sched-when');
  const drawWhen = () => {
    whenBox.innerHTML = '';
    if (kind === 'daily') whenBox.append(h('div.inline', null, h('span', null, L('às')), time));
    if (kind === 'weekly') whenBox.append(dayBox, h('div.inline', null, h('span', null, L('às')), time));
    if (kind === 'hours') whenBox.append(h('div.inline', null, h('span', null, L('a cada')), every, h('span', null, L('horas'))));
    if (kind === 'once') whenBox.append(at);
  };
  const kindSeg = h('div.seg', null, [['daily', L('Todo dia')], ['weekly', L('Dias da semana')], ['hours', L('A cada N horas')], ['once', L('Uma vez')]].map(([v, l]) => h('button', { type: 'button', class: kind === v ? 'on' : '', onclick: (e) => { kind = v; e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); drawWhen(); } }, l)));
  drawWhen();
  const proj = h('select.select', null, h('option', { value: '' }, L('Nenhum (conversa avulsa)')), S.projects.map((p) => h('option', { value: p.id }, p.name)));
  proj.value = s.projectId || '';
  const model = h('select.select', null, h('option', { value: '' }, L('O modelo padrão')), (S.models?.models || []).map((m) => h('option', { value: m.id }, m.name)));
  model.value = s.modelId || '';
  const reuse = h('input', { type: 'checkbox', checked: !!s.reuse });
  let m;
  const save = (runNow) => {
    const n = name.value.trim(), p = prompt.value.trim();
    if (!p) { toast(L('Escreva o que pedir.'), 'err'); return; }
    if (kind === 'weekly' && !days.size) { toast(L('Escolha pelo menos um dia.'), 'err'); return; }
    s.name = n || p.slice(0, 50);
    s.prompt = p;
    s.projectId = proj.value || null;
    s.modelId = model.value || null;
    s.reuse = reuse.checked;
    s.when = { kind, tz: new Date().getTimezoneOffset() };
    if (kind === 'daily' || kind === 'weekly') s.when.time = time.value || '08:00';
    if (kind === 'weekly') s.when.days = [...days].sort();
    if (kind === 'hours') { s.when.every = Math.max(1, Math.min(720, Number(every.value) || 6)); s.when.from = s0?.when?.kind === 'hours' && s0.when.from ? s0.when.from : Date.now(); }
    if (kind === 'once') { const t = new Date(at.value).getTime(); if (!t || t < Date.now()) { toast(L('Escolha uma data no futuro.'), 'err'); return; } s.when.at = t; }
    putSchedule(s);
    m.close();
    toast(isNew ? L('Tarefa agendada: {0}', describeWhen(s.when)) : L('Tarefa salva'));
    if (runNow) schedRunNow(s.id);
    if (S.view === 'settings') showSetPage('schedules');
  };
  m = modal({
    title: isNew ? L('Nova tarefa agendada') : L('Tarefa: {0}', s.name), wide: true,
    body: h('div.form', null,
      h('div.field', null, h('label', null, L('Nome')), name),
      h('div.field', null, h('label', null, L('O que pedir')), prompt, h('small', null, L('Roda sozinha, sem ninguém olhando: o modelo decide em vez de perguntar. Quando terminar, chega um aviso.'))),
      h('div.field', null, h('label', null, L('Quando')), kindSeg, whenBox),
      h('div.row', null,
        h('div.field', null, h('label', null, L('Projeto')), proj),
        h('div.field', null, h('label', null, L('Modelo')), model)),
      h('label.kb-on', null, reuse, h('span', null, L('Sempre na mesma conversa (cada execução vê as anteriores)')))),
    foot: [
      h('button.btn', { onclick: () => m.close() }, L('Cancelar')),
      h('button.btn', { onclick: () => save(true) }, L('Salvar e rodar agora')),
      h('button.btn.primary', { onclick: () => save(false) }, isNew ? L('Agendar') : L('Salvar')),
    ],
  });
}

async function schedRunNow(id) {
  await uiFlush();
  try {
    const r = await api('/api/schedules/run', { id });
    const s = S.schedules.find((x) => x.id === id);
    if (s?.reuse && r.conv) { s.convId = r.conv; saveSchedules(); }
    toast(L('Rodando em segundo plano. Você recebe um aviso quando terminar.'));
  } catch (e) { toast(e.message, 'err'); }
}

/** Página das configurações. */
function schedulesPage() {
  const list = h('div.sched-list');
  const draw = async () => {
    list.innerHTML = '';
    if (!S.schedules.length) { list.append(h('div.muted.small', null, L('Nenhuma tarefa agendada. Crie uma aqui, ou peça numa conversa: "todo dia às 8h, me mande um resumo das notícias".'))); return; }
    let st = {};
    try { st = await api('/api/schedules/state'); } catch { /* sem servidor */ }
    for (const s of S.schedules) {
      const e = st[s.id] || {};
      const sw = h('input', { type: 'checkbox', checked: s.on !== false });
      sw.addEventListener('change', () => { s.on = sw.checked; saveSchedules(); draw(); });
      const proj = s.projectId ? S.projects.find((p) => p.id === s.projectId)?.name : '';
      list.append(h('div.sched-item' + (s.on === false ? '.off' : ''), null,
        h('label.switch', null, sw, h('span')),
        h('div.sched-main', null,
          h('div.sched-name', null, s.name),
          h('div.sched-sub.muted', null, [describeWhen(s.when), proj ? L('projeto {0}', proj) : '', s.on !== false && e.next ? L('próxima: {0}', fmtStamp(e.next)) : '', e.last ? L('última: {0}', fmtStamp(e.last)) : ''].filter(Boolean).join(' · ')),
          e.lastError ? h('div.sched-err', null, e.lastError) : null),
        h('div.sched-acts', null,
          e.lastConv && S.convs.some((c) => c.id === e.lastConv) ? h('button.btn.sm', { type: 'button', onclick: () => { selectConv(e.lastConv); setView('chat'); } }, L('Ver resultado')) : null,
          h('button.btn.sm', { type: 'button', onclick: () => schedRunNow(s.id) }, L('Rodar agora')),
          h('button.icon-btn.sm', { type: 'button', title: L('Editar'), 'aria-label': L('Editar'), html: svg('edit'), onclick: () => editSchedule(s) }),
          h('button.icon-btn.sm', { type: 'button', title: L('Apagar'), 'aria-label': L('Apagar'), html: svg('trash'), onclick: async () => {
            if (!(await confirmBox(L('Apagar a tarefa "{0}"? As conversas que ela já criou ficam.', s.name), L('Apagar'), true))) return;
            S.schedules = S.schedules.filter((x) => x !== s); saveSchedules(); draw();
          } }))));
    }
  };
  draw();
  return [h('div.page-actions', null, h('button.btn.primary', { type: 'button', onclick: () => editSchedule(null, cur()) }, ic('plus'), L('Nova tarefa agendada'))), list,
    h('small.muted', null, L('As tarefas rodam no studio deste computador, em segundo plano: o computador precisa estar ligado e o studio aberto (pode estar na bandeja). Se ele estava desligado na hora, a tarefa roda assim que o studio abrir.'))];
}

/* ------------------------------------------------------------ ferramenta schedule (pedido na conversa) */
function runScheduleTool(tctx, args) {
  const a = String(args?.action || '').toLowerCase();
  if (a === 'list') {
    if (!S.schedules.length) return { content: L('Nenhuma tarefa agendada.') };
    return { content: S.schedules.map((s) => `- ${s.id} · "${s.name}" · ${describeWhen(s.when)}${s.on === false ? L(' (desligada)') : ''}\n  ${clip(s.prompt, 160)}`).join('\n') };
  }
  if (a === 'delete') {
    const s = S.schedules.find((x) => x.id === String(args?.id || ''));
    if (!s) return { content: L('Não achei a tarefa {0}. Use action "list".', args?.id || ''), isError: true };
    S.schedules = S.schedules.filter((x) => x !== s); saveSchedules();
    return { content: L('Tarefa "{0}" apagada.', s.name) };
  }
  if (a !== 'create') return { content: L('action deve ser create, list ou delete.'), isError: true };
  const prompt = String(args?.prompt || '').trim();
  if (!prompt) return { content: L('Passe prompt com o pedido que vai rodar.'), isError: true };
  const kind = ['daily', 'weekly', 'hours', 'once'].includes(args?.kind) ? args.kind : 'daily';
  const when = { kind, tz: new Date().getTimezoneOffset() };
  const time = /^\d{1,2}:\d{2}$/.test(String(args?.time || '')) ? String(args.time).padStart(5, '0') : '08:00';
  if (kind === 'daily' || kind === 'weekly') when.time = time;
  if (kind === 'weekly') { when.days = [].concat(args?.days || []).map(Number).filter((d) => d >= 0 && d < 7); if (!when.days.length) return { content: L('Para weekly, passe days (0 = domingo ... 6 = sábado).'), isError: true }; }
  if (kind === 'hours') { when.every = Math.max(1, Math.min(720, Number(args?.every) || 6)); when.from = Date.now(); }
  if (kind === 'once') {
    const t = new Date(String(args?.at || '').replace(' ', 'T')).getTime();
    if (!t || t < Date.now()) return { content: L('Para once, passe at no futuro, no horário local (ex.: 2026-11-21 08:00).'), isError: true };
    when.at = t;
  }
  const conv = tctx.conv;
  const s = { id: 'a' + uid().slice(0, 8), name: String(args?.name || '').trim() || prompt.slice(0, 50), prompt, on: true, created: Date.now(), when, projectId: projectOf(conv)?.id || null, modelId: conv?.modelId || null, reuse: !!args?.same_chat };
  putSchedule(s);
  return { content: L('Agendada: "{0}" ({1}), id {2}. Roda em segundo plano neste computador e avisa quando terminar; o usuário vê e edita em Configurações → Tarefas agendadas.', s.name, describeWhen(when), s.id) };
}
