/* llama studio - Processos: tudo o que está rodando ou vai rodar, num lugar só. Respostas nesta tela, tarefas e
   metas em segundo plano, comandos em segundo plano (run_command background), transcrições da base de
   conhecimento e tarefas agendadas, com Parar e Ver em cada um. O número no menu é o que está rodando agora. */
'use strict';

const PROCS = { timer: 0, data: null };

function procAgo(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, '0')}` : s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : L('{0}s', s);
}

async function procsLoad() {
  const [jobs, shell, media, sched] = await Promise.all([
    api('/api/jobs').catch(() => ({ jobs: [] })),
    api('/api/shell/jobs?run=').catch(() => ({ jobs: [] })),
    api('/api/kb/media').catch(() => ({ queued: 0, current: '' })),
    api('/api/schedules/state').catch(() => ({})),
  ]);
  PROCS.data = { jobs: jobs.jobs || [], executor: jobs.executor, shell: shell.jobs || [], media, sched, at: Date.now() };
  return PROCS.data;
}

function procsCount(d) {
  if (!d) return S.runs.size;
  return S.runs.size + d.jobs.filter((j) => j.state === 'queued' || j.state === 'running').length + d.shell.filter((j) => j.state === 'running').length + (d.media.current ? 1 : 0) + (d.media.queued || 0);
}

function drawProcsBadge() {
  const b = $('.nav-item[data-view="procs"]');
  if (!b) return;
  const n = procsCount(PROCS.data);
  let badge = b.querySelector('.nav-badge');
  if (!n) { badge?.remove(); return; }
  if (!badge) { badge = h('span.nav-badge'); b.append(badge); }
  badge.textContent = n;
}

function procRow(icon, title, sub, state, acts) {
  return h('div.proc-row' + (state ? '.st-' + state : ''), null,
    h('span.proc-ico', { html: svg(icon) }),
    h('div.proc-main', null, h('b', { title }, title), sub ? h('span.proc-sub', null, sub) : null),
    h('div.proc-acts', null, ...(acts || [])));
}
const procBtn = (label, fn, cls = '') => h('button.btn.sm' + cls, { type: 'button', onclick: fn }, label);
const openConvBtn = (id) => (S.convs.some((c) => c.id === id) ? procBtn(L('Abrir'), () => { selectConv(id); setView('chat'); }) : null);

async function renderProcsPage() {
  const page = $('#view-procs .page');
  if (!page) return;
  if (!page.firstChild) {
    page.append(h('header.page-head', null, h('div', null, h('h1', null, L('Processos')), h('p.lead', null, L('O que está rodando agora e o que vai rodar: respostas, tarefas e metas em segundo plano, comandos, transcrições e tarefas agendadas.')))), h('div#procs-body'));
  }
  const body = $('#procs-body');
  let d;
  try { d = await procsLoad(); } catch (e) { body.innerHTML = ''; body.append(h('p.muted', null, e.message)); return; }
  drawProcsBadge();
  if (S.view !== 'procs') return;
  const out = [];
  const sec = (title, rows, empty) => out.push(h('section.proc-sec', null, h('h3', null, title, rows.length ? h('span.proc-n', null, String(rows.length)) : null), rows.length ? h('div.proc-list', null, rows) : h('p.muted.small', null, empty)));

  // 1. respostas nesta tela
  sec(L('Respondendo nesta tela'), [...S.runs.keys()].map((id) => {
    const c = S.convs.find((x) => x.id === id);
    return procRow('chat', c?.title || id, (c?.goal?.status === 'active' ? L('Meta, rodada {0}/{1}', c.goal.round + 1, c.goal.max) + ' · ' : '') + (c ? bgStatus(c) : ''), 'running',
      [openConvBtn(id), procBtn(L('Parar'), () => { S.runs.get(id)?.abort(); setTimeout(renderProcsPage, 300); })]);
  }), L('Nenhuma resposta rodando aqui.'));

  // 2. segundo plano
  const live = d.jobs.filter((j) => j.state === 'queued' || j.state === 'running');
  const done = d.jobs.filter((j) => !(j.state === 'queued' || j.state === 'running')).slice(0, 8);
  sec(L('Em segundo plano'), live.map((j) => {
    const c = S.convs.find((x) => x.id === j.conv);
    const quiet = j.state === 'running' && j.pat && Date.now() - j.pat > 90000;
    return procRow(c?.goal?.status === 'active' ? 'zap' : 'cloud', j.title || c?.title || j.conv,
      (j.state === 'queued' ? L('Na fila') : (j.progress || L('Rodando'))) + ' · ' + procAgo(Date.now() - j.created) + (quiet ? ' · ' + L('sem notícias há {0} min', Math.round((Date.now() - j.pat) / 60000)) : ''),
      quiet ? 'warn' : j.state,
      [openConvBtn(j.conv), procBtn(L('Parar'), () => { const cc = S.convs.find((x) => x.id === j.conv); if (cc) bgStop(cc); else api('/api/jobs/answer', { stop: j.conv }); setTimeout(renderProcsPage, 500); })]);
  }), d.executor === false ? L('Nada rodando. (O executor de segundo plano não está aberto agora; ele abre sozinho quando precisa.)') : L('Nada rodando em segundo plano.'));
  if (done.length) {
    out.push(h('details.proc-done', { 'data-k': 'jobs' }, h('summary', null, L('Terminadas recentemente ({0})', done.length)),
      h('div.proc-list', null, done.map((j) => procRow(j.state === 'done' ? 'check' : 'alert', j.title || j.conv,
        (j.state === 'done' ? L('Terminou') : L('Falhou')) + ' · ' + fmtStamp(j.finished || j.created) + (j.note ? ' · ' + j.note : ''), j.state, [openConvBtn(j.conv)])))));
  }

  // 3. comandos em segundo plano
  const shellLive = d.shell.filter((j) => j.state === 'running');
  const shellDone = d.shell.filter((j) => j.state !== 'running').slice(0, 6);
  const shellRow = (j) => {
    const c = S.convs.find((x) => x.id === j.owner);
    return procRow('terminal', j.cmd, [j.state === 'running' ? L('rodando') : j.state === 'killed' ? L('encerrado') : L('código {0}', j.code ?? '?'), procAgo(j.ms), c ? c.title : '', j.dir].filter(Boolean).join(' · '),
      j.state === 'running' ? 'running' : j.code === 0 ? 'done' : 'error',
      [procBtn(L('Saída'), () => procShellOut(j)), j.state === 'running' ? procBtn(L('Encerrar'), async () => { await api('/api/shell/kill', { id: j.id }).catch((e) => toast(e.message, 'err')); renderProcsPage(); }) : null, c ? openConvBtn(c.id) : null]);
  };
  sec(L('Comandos em segundo plano'), shellLive.map(shellRow), L('Nenhum comando rodando (run_command com background).'));
  if (shellDone.length) out.push(h('details.proc-done', { 'data-k': 'shell' }, h('summary', null, L('Comandos terminados ({0})', shellDone.length)), h('div.proc-list', null, shellDone.map(shellRow))));

  // 4. metas
  const goals = S.convs.filter((c) => c.goal && (c.goal.status === 'active' || Date.now() - (c.goal.endedAt || 0) < 86400000));
  sec(L('Metas'), goals.map((c) => procRow(c.goal.status === 'done' ? 'check' : 'zap', c.goal.text, [c.title, goalState(c.goal, c), c.goal.status !== 'active' && c.goal.why ? c.goal.why : ''].filter(Boolean).join(' · '),
    c.goal.status === 'active' ? 'running' : c.goal.status === 'done' ? 'done' : 'error',
    [openConvBtn(c.id), c.goal.status === 'active' ? procBtn(L('Parar a meta'), () => { goalStopBtn(c); setTimeout(renderProcsPage, 500); }) : null])), L('Nenhuma meta nas últimas 24 horas. Comece uma com /meta.'));

  // 5. transcrições da base de conhecimento
  const mq = d.media || {};
  sec(L('Transcrições da base de conhecimento'), [
    ...(mq.current ? [procRow('mic', mq.current, L('Transcrevendo com o Whisper'), 'running', [])] : []),
    ...(mq.queued ? [procRow('clock', L('{0} na fila', mq.queued), L('Esperando a vez'), 'queued', [])] : []),
  ], L('Nada sendo transcrito.'));

  // 6. tarefas agendadas
  sec(L('Próximas tarefas agendadas'), (S.schedules || []).filter((s) => s.on !== false).map((s) => ({ s, e: d.sched[s.id] || {} })).sort((a, b) => (a.e.next || Infinity) - (b.e.next || Infinity)).map(({ s, e }) =>
    procRow('clock', s.name, [describeWhen(s.when), e.next ? L('próxima: {0}', fmtStamp(e.next)) : '', e.last ? L('última: {0}', fmtStamp(e.last)) : '', e.lastError || ''].filter(Boolean).join(' · '), e.lastError ? 'error' : 'queued',
      [procBtn(L('Rodar agora'), () => schedRunNow(s.id)), e.lastConv ? openConvBtn(e.lastConv) : null])), L('Nenhuma tarefa agendada ligada.'));

  // os detalhes abertos continuam abertos depois de atualizar
  PROCS.open = {};
  body.querySelectorAll('details[data-k]').forEach((x) => { PROCS.open[x.dataset.k] = x.open; });
  out.forEach((x) => { if (x.dataset?.k) x.open = !!PROCS.open[x.dataset.k]; });
  body.innerHTML = '';
  body.append(...out);
}

async function procShellOut(j) {
  let r;
  try { r = await api('/api/shell/output?id=' + encodeURIComponent(j.id) + '&tail=400'); } catch (e) { toast(e.message, 'err'); return; }
  modal({ title: j.cmd.slice(0, 80), wide: true, body: h('pre.proc-out', null, r.out || L('(sem saída)')) });
}

// atualiza a página aberta a cada 2 s e o número do menu a cada 6 s
setInterval(() => {
  if (EXECUTOR || document.hidden) return;
  if (S.view === 'procs') renderProcsPage();
}, 2000);
setInterval(() => {
  if (EXECUTOR || document.hidden || S.view === 'procs') return;
  procsLoad().then(drawProcsBadge).catch(() => {});
}, 6000);
