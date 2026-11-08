/* llama studio - projetos, personalidades, lista de conversas e mensagens */
'use strict';

/* ============================================================ projetos e personalidades */
const DEFAULT_PERSONAS = [
  { id: 'programador', name: L('Programador'), color: '#5b5bd6', prompt: L('Você é um engenheiro de software sênior. Leia o código antes de mudar, prefira mudanças pequenas e corretas, explique o porquê em poucas linhas e mostre o código final completo quando for curto. Rode testes ou comandos para confirmar quando puder.') },
  { id: 'engenheiro-reverso', name: L('Engenheiro reverso'), color: '#c2410c', prompt: L('Você é um engenheiro reverso experiente (binários nativos, .NET, Electron/JavaScript, APKs). Use as ferramentas de análise disponíveis antes de concluir. Registre achados com nomes de classes, métodos, assinaturas, offsets e endereços exatos. Separe o que foi confirmado do que é hipótese.') },
  { id: 'revisor', name: L('Revisor de texto'), color: '#2f9e58', prompt: L('Você revisa textos em português do Brasil: corrige gramática, clareza e tom sem mudar o sentido. Mostre o texto revisado e, depois, uma lista curta das mudanças mais importantes.') },
];
if (!Array.isArray(S.personas)) S.personas = DEFAULT_PERSONAS.map((p) => ({ ...p }));
const PERSONA_COLORS = ['#5b5bd6', '#c2410c', '#2f9e58', '#b4366b', '#0e7490', '#7c4dcc', '#a16207', '#475569'];

function saveProjects() { store.set('projects', S.projects); }
function savePersonas() { store.set('personas', S.personas); }
function projectOf(c) { return c?.projectId ? S.projects.find((p) => p.id === c.projectId) || null : null; }
function personaOf(c) {
  const id = c ? c.personaId : (S.draftPersona !== undefined ? S.draftPersona : S.settings.defaultPersona);
  return id ? S.personas.find((p) => p.id === id) || null : null;
}
/** Pasta de trabalho da conversa: a do projeto ou a geral. */
function wsOf(c) { return projectOf(c)?.dir || S.info.workspace || ''; }

/** Painel de arquivos acompanha a pasta da conversa aberta. */
function syncWsRoot(force) {
  const w = wsOf(cur());
  if (!w || (w === S.ws.path && !force)) { syncMade(); return; }
  S.ws.path = w;
  S.ws.cache.clear(); S.ws.fresh.clear();
  S.ws.expanded = new Set(store.get('wsExp:' + w, []));
  $('#ws-preview')?.classList.remove('open');
  renderWsPath(); renderTree(); updatePickers(); drawMade();
}

/* ============================================================ conversas */
function newConv(projectId) {
  const prevKit = kitModelId();
  const proj = projectId ? S.projects.find((p) => p.id === projectId) : null;
  const personaId = S.draftPersona !== undefined ? S.draftPersona : (proj?.personaId || S.settings.defaultPersona || null);
  S.draftPersona = undefined;
  const modelId = S.draftModel; S.draftModel = undefined;
  const c = { id: uid(), title: L('Nova conversa'), messages: [], createdAt: Date.now(), updatedAt: Date.now(), autoApprove: false, projectId: proj ? proj.id : null, personaId, modelId: modelId || null, think: S.draftThink || undefined, plan: S.draftPlan || undefined, autoLevel: S.draftAuto || undefined };
  if (proj) { proj.open = true; saveProjects(); }
  S.convs.unshift(c);
  S.curId = c.id;
  saveConvs();
  renderConvList(); renderChat();
  const nk = kitModelId();
  if (nk && nk !== prevKit) applyKit(nk, true);
  return c;
}

function selectConv(id) {
  if (S.sideDrawer) toggleSide(false);
  setTimeout(() => { const c = cur(); if (c && S.settings.projMap === true) ensureMap(c).then(() => maybeSummarizeMap(c)); }, 50);
  const prev = kitModelId();
  S.curId = id; saveConvs(); closeMention?.();
  const next = kitModelId();
  if (next && next !== prev) applyKit(next, true);
  if (S.view !== 'chat') setView('chat');
  renderConvList(); renderChat();
}

async function deleteConv(c) {
  if (!(await confirmBox(L('Apagar a conversa "{0}"?', c.title), L('Apagar'), true))) return;
  S.runs.get(c.id)?.abort();
  S.convs = S.convs.filter((x) => x.id !== c.id);
  if (S.curId === c.id) S.curId = S.convs[0]?.id || null;
  saveConvs(); renderConvList(); renderChat();
  api('/api/kvcache/prune', { keep: 6, drop: [c.id] }).catch(() => {});
  api('/api/checkpoints/prune', { forget: [c.id] }).catch(() => {});
  if (!c.projectId) { NB.delete('conv-' + c.id); api('/api/notebook/save', { key: 'conv-' + c.id, cards: [], next: 1 }).catch(() => {}); }
}

function convRow(c, nested) {
  const active = c.id === S.curId && S.view === 'chat';
  const tags = tagsOf(c);
  const row = h('div.conv' + (active ? '.active' : '') + (nested ? '.nested' : ''), { onclick: () => selectConv(c.id), title: c.title + (tags.length ? ' · ' + tags.map((t) => t.name).join(', ') : '') },
    tags.length ? h('span.conv-tags', null, tags.slice(0, 3).map((t) => h('i', { style: { background: t.color } }))) : null,
    h('span.conv-name', null, c.title),
    S.waiting.has(c.id) ? h('span.wait-dot', { title: L('Esperando sua permissão') }) : running(c) ? h('span.run-dot', { title: L('Respondendo em segundo plano') }) : null,
    h('button.icon-btn', { title: L('Etiquetas'), 'aria-label': L('Etiquetas'), html: svg('tag'), onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); tagMenu(c, r.left, r.bottom + 4); } }),
    h('button.icon-btn', { title: L('Apagar'), 'aria-label': L('Apagar'), html: svg('trash'), onclick: (e) => { e.stopPropagation(); deleteConv(c); } }));
  row.addEventListener('dblclick', () => renameConv(c, row));
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); tagMenu(c, e.clientX, e.clientY); });
  return row;
}

/* ------------------------------------------------------------ etiquetas de cor */
const TAG_COLORS = ['#e5484d', '#f76b15', '#e2a336', '#30a46c', '#12a594', '#0090ff', '#6e56cf', '#d6409f', '#8b8d98'];
function saveTags() { store.set('tags', S.tags); }
function tagsOf(c) { return (c?.tags || []).map((id) => S.tags.find((t) => t.id === id)).filter(Boolean); }
function toggleTag(c, id) {
  const set = new Set(c.tags || []);
  if (set.has(id)) set.delete(id); else set.add(id);
  c.tags = [...set]; saveConvs(); renderConvList();
}
/** Menu flutuante simples: itens {label, icon, color, check, onclick} ou 'sep'. */
function floatMenu(x, y, items) {
  $$('.fmenu').forEach((m) => m.remove());
  const m = h('div.fmenu', { role: 'menu' });
  for (const it of items) {
    if (it === 'sep') { m.append(h('div.fm-sep')); continue; }
    m.append(h('button.fm-item', { onclick: (e) => { e.stopPropagation(); if (!it.keep) close(); it.onclick?.(e); } },
      it.color ? h('i.fm-dot', { style: { background: it.color } }) : it.icon ? ic(it.icon) : h('i.fm-dot.none'),
      h('span', null, it.label),
      it.check ? ic('check') : null));
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + 'px';
  m.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
  const close = () => { m.remove(); document.removeEventListener('pointerdown', out, true); document.removeEventListener('keydown', key); };
  const out = (e) => { if (!m.contains(e.target)) close(); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  setTimeout(() => { document.addEventListener('pointerdown', out, true); document.addEventListener('keydown', key); });
  return { close, el: m };
}
function tagMenu(c, x, y) {
  const has = new Set(c.tags || []);
  floatMenu(x, y, [
    ...S.tags.map((t) => ({ label: t.name, color: t.color, check: has.has(t.id), onclick: () => toggleTag(c, t.id) })),
    S.tags.length ? 'sep' : null,
    { label: L('Nova etiqueta...'), icon: 'plus', onclick: async () => { const t = await editTag(null); if (t) toggleTag(c, t.id); } },
    S.tags.length ? { label: L('Gerenciar etiquetas'), icon: 'gear', onclick: manageTags } : null,
  ].filter(Boolean));
}
async function editTag(t) {
  const name = h('input.input', { value: t?.name || '', placeholder: L('Ex.: Trabalho, Instagram, Engenharia reversa') });
  let color = t?.color || TAG_COLORS[S.tags.length % TAG_COLORS.length];
  const sw = h('div.tag-swatches', null, TAG_COLORS.map((col) => h('button', { type: 'button', class: col === color ? 'on' : '', style: { background: col }, 'aria-label': col, onclick: (e) => { color = col; $$('button', sw).forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } })));
  return new Promise((resolve) => {
    let m;
    const save = () => {
      const n = name.value.trim();
      if (!n) { toast(L('Dê um nome à etiqueta.'), 'err'); return; }
      let out = t;
      if (t) Object.assign(t, { name: n, color }); else { out = { id: uid(), name: n, color }; S.tags.push(out); }
      saveTags(); renderConvList(); m.close(); resolve(out);
    };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    m = modal({ title: t ? L('Editar etiqueta') : L('Nova etiqueta'), body: [h('div.field', null, h('label', null, L('Nome')), name), h('div.field', null, h('label', null, L('Cor')), sw)],
      foot: [h('button.btn', { onclick: () => { m.close(); resolve(null); } }, L('Cancelar')), h('button.btn.primary', { onclick: save }, t ? L('Salvar') : L('Criar'))] });
    setTimeout(() => name.focus(), 30);
  });
}
function manageTags() {
  const list = h('div.tag-list');
  const draw = () => {
    list.innerHTML = '';
    if (!S.tags.length) list.append(h('p.muted', null, L('Nenhuma etiqueta ainda.')));
    for (const t of S.tags) {
      const n = S.convs.filter((c) => c.tags?.includes(t.id)).length;
      list.append(h('div.tag-row', null, h('i.fm-dot', { style: { background: t.color } }), h('span', null, t.name), h('small.muted', null, `${n} ${n === 1 ? L('conversa') : L('conversas')}`),
        h('button.icon-btn.sm', { title: L('Editar'), 'aria-label': L('Editar'), html: svg('edit'), onclick: async () => { await editTag(t); draw(); } }),
        h('button.icon-btn.sm', { title: L('Apagar'), 'aria-label': L('Apagar'), html: svg('trash'), onclick: async () => {
          if (!(await confirmBox(L('Apagar a etiqueta "{0}"? As conversas continuam, só perdem a etiqueta.', t.name), L('Apagar'), true))) return;
          S.tags = S.tags.filter((x) => x.id !== t.id);
          for (const c of S.convs) if (c.tags?.includes(t.id)) c.tags = c.tags.filter((x) => x !== t.id);
          if (S.tagFilter === t.id) { S.tagFilter = null; store.set('tagFilter', null); }
          saveTags(); saveConvs(); renderConvList(); draw();
        } })));
    }
  };
  draw();
  const m = modal({ title: L('Etiquetas'), body: [h('p.muted', { style: { marginTop: 0 } }, L('Etiquetas de cor organizam as conversas. Clique com o botão direito numa conversa para marcar.')), list],
    foot: [h('button.btn', { onclick: async () => { await editTag(null); draw(); } }, ic('plus'), L('Nova etiqueta')), h('button.btn.primary', { onclick: () => m.close() }, L('Fechar'))] });
}
function tagBar() {
  if (!S.tags.length) return null;
  const count = (id) => S.convs.filter((c) => c.tags?.includes(id)).length;
  return h('div.tag-bar', null,
    S.tags.map((t) => h('button.tag-chip' + (S.tagFilter === t.id ? '.on' : ''), { title: S.tagFilter === t.id ? L('Mostrar todas') : L('Só "{0}"', t.name), style: { '--c': t.color }, onclick: () => { S.tagFilter = S.tagFilter === t.id ? null : t.id; store.set('tagFilter', S.tagFilter); renderConvList(); } },
      h('i', { style: { background: t.color } }), t.name, h('small', null, String(count(t.id))))),
    h('button.icon-btn.sm', { title: L('Gerenciar etiquetas'), 'aria-label': L('Gerenciar etiquetas'), html: svg('gear'), onclick: manageTags }));
}

function secHead(key, label, extra) {
  const open = store.get('sec:' + key, true);
  return [h('div.sec-row', null,
    h('button.sec-head', { 'aria-expanded': String(open), onclick: () => { store.set('sec:' + key, !open); renderConvList(); } }, h('span', { html: svg('chev'), style: { display: 'contents' } }), h('span', null, label)),
    extra || null), open];
}

function renderConvList() {
  const box = $('#conv-list'); box.innerHTML = '';
  const q = ($('#search').value || '').trim().toLowerCase();
  if (S.tagFilter && !S.tags.some((t) => t.id === S.tagFilter)) S.tagFilter = null;
  const tf = S.tagFilter;
  const match = (c) => (!tf || c.tags?.includes(tf)) && (!q || c.title.toLowerCase().includes(q) || c.messages.some((m) => m.role === 'user' && (m.content || '').toLowerCase().includes(q)));
  const curProj = projectOf(cur());
  const tb = tagBar(); if (tb) box.append(tb);

  // projetos
  const [phead, popen] = secHead('projects', L('Projetos'), h('button.icon-btn.sm', { title: L('Novo projeto'), 'aria-label': L('Novo projeto'), html: svg('plus'), onclick: () => editProject(null) }));
  box.append(phead);
  if (popen || q || tf) {
    if (!S.projects.length && !q) box.append(h('div.side-empty', null, L('Projetos agrupam conversas que trabalham na mesma pasta.')));
    for (const p of [...S.projects].sort((a, b) => a.name.localeCompare(b.name, LOCALE))) {
      const convs = S.convs.filter((c) => c.projectId === p.id && match(c)).sort((a, b) => b.updatedAt - a.updatedAt);
      if ((q || tf) && !convs.length && !(q && !tf && p.name.toLowerCase().includes(q))) continue;
      const busy = convs.some((c) => running(c));
      box.append(h('div.proj' + (curProj?.id === p.id ? '.active' : ''), { onclick: () => { p.open = !p.open; saveProjects(); renderConvList(); }, title: p.dir },
        h('span', { html: svg(p.open || q || tf ? 'folderOpen' : 'folder'), style: { display: 'contents' } }),
        h('span.conv-name', null, p.name),
        busy ? h('span.run-dot', { title: L('Alguma conversa está respondendo') }) : h('span.proj-count', null, S.convs.filter((c) => c.projectId === p.id).length || ''),
        h('button.icon-btn', { title: L('Nova conversa neste projeto'), 'aria-label': L('Nova conversa neste projeto'), html: svg('plus'), onclick: (e) => { e.stopPropagation(); newConv(p.id); setView('chat'); } }),
        h('button.icon-btn', { title: L('Configurar projeto'), 'aria-label': L('Configurar projeto'), html: svg('gear'), onclick: (e) => { e.stopPropagation(); editProject(p); } })));
      if (p.open || q || tf) {
        for (const c of convs) box.append(convRow(c, true));
        if (!convs.length && !q) box.append(h('button.side-empty.nested.link', { onclick: () => { newConv(p.id); setView('chat'); } }, L('+ Começar uma conversa aqui')));
      }
    }
  }

  // conversas sem projeto
  const byTag = store.get('groupByTag', false) && S.tags.length && !tf;
  const [rhead, ropen] = secHead('recent', L('Conversas'), S.tags.length ? h('button.icon-btn.sm' + (byTag ? '.on' : ''), { title: byTag ? L('Agrupar por data') : L('Agrupar por etiqueta (como pastas)'), 'aria-label': L('Agrupar por etiqueta'), html: svg('tag'), onclick: () => { store.set('groupByTag', !store.get('groupByTag', false)); renderConvList(); } }) : null);
  box.append(rhead);
  if (!ropen && !q) return;
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups = [[L('Hoje'), (t) => t >= today], [L('Ontem'), (t) => t >= today - 864e5 && t < today], [L('Últimos 7 dias'), (t) => t >= today - 7 * 864e5 && t < today - 864e5], [L('Mais antigas'), (t) => t < today - 7 * 864e5]];
  let sorted = S.convs.filter((c) => !projectOf(c) && match(c)).sort((a, b) => b.updatedAt - a.updatedAt);
  if (byTag) {
    // etiquetas como pastas; uma conversa com duas etiquetas aparece nas duas
    for (const t of [...S.tags].sort((a, b) => a.name.localeCompare(b.name, LOCALE))) {
      const items = sorted.filter((c) => c.tags?.includes(t.id));
      if (!items.length) continue;
      const open = store.get('tagsec:' + t.id, true) || !!q;
      box.append(h('div.proj.tag-folder', { onclick: () => { store.set('tagsec:' + t.id, !open); renderConvList(); } },
        h('i.fm-dot', { style: { background: t.color } }), h('span.conv-name', null, t.name), h('span.proj-count', null, String(items.length)),
        h('span', { html: svg('chev', open ? 'rot' : ''), style: { display: 'contents' } })));
      if (open) for (const c of items) box.append(convRow(c, true));
    }
    sorted = sorted.filter((c) => !tagsOf(c).length);
    if (sorted.length) box.append(h('div.conv-group', null, L('Sem etiqueta')));
  }
  for (const [label, test] of byTag ? [['', () => true]] : groups) {
    const items = sorted.filter((c) => test(c.updatedAt));
    if (!items.length) continue;
    if (label) box.append(h('div.conv-group', null, label));
    for (const c of items) box.append(convRow(c, false));
  }
  if (!sorted.length && !(byTag && S.convs.some((c) => !projectOf(c) && match(c)))) box.append(h('div.side-empty', null, q || tf ? L('Nada encontrado.') : L('Suas conversas aparecem aqui.')));
}

/** Criar ou configurar um projeto. */
async function editProject(p) {
  const isNew = !p;
  const name = h('input.input', { value: p?.name || '', placeholder: L('Ex.: Decompilar dll') });
  const dir = h('input.input.mono', { value: p?.dir || '', placeholder: L('Pasta onde as conversas do projeto trabalham') });
  const instr = h('textarea.textarea', { rows: 5, value: p?.instructions || '', placeholder: L('Contexto que vale para todas as conversas do projeto. Ex.: o alvo é o arquivo app.dll; registre os achados em notas.md.') });
  const persona = h('select.select', null, h('option', { value: '' }, L('Nenhuma (usa a padrão)')), S.personas.map((x) => h('option', { value: x.id }, x.name)));
  persona.value = p?.personaId || '';
  const browse = h('button.btn', { type: 'button', onclick: async () => { const r = await pickPath({ title: L('Pasta do projeto'), mode: 'dir', start: dir.value || S.info.workspace }); if (r) { dir.value = r; if (!name.value.trim()) name.value = basename(r); } } }, L('Procurar'));
  let m;
  const save = async () => {
    const n = name.value.trim(); const d = dir.value.trim().replace(/^"|"$/g, '');
    if (!n) { toast(L('Dê um nome ao projeto.'), 'err'); return; }
    if (!d) { toast(L('Escolha a pasta do projeto.'), 'err'); return; }
    const st = await api('/api/stat', { path: d }).catch(() => ({}));
    if (!st.exists || !st.dir) { toast(L('Essa pasta não existe.'), 'err'); return; }
    if (isNew) {
      const np = { id: uid(), name: n, dir: st.path, instructions: instr.value.trim(), personaId: persona.value || null, createdAt: Date.now(), open: true };
      S.projects.push(np); saveProjects(); m.close();
      newConv(np.id); setView('chat');
      toast(L('Projeto "{0}" criado', n));
    } else {
      Object.assign(p, { name: n, dir: st.path, instructions: instr.value.trim(), personaId: persona.value || null });
      saveProjects(); m.close(); renderConvList(); renderChatTitle(); syncWsRoot(true);
      toast(L('Projeto salvo'));
    }
  };
  m = modal({
    title: isNew ? L('Novo projeto') : L('Projeto: {0}', p.name),
    body: h('div.form', null,
      h('div.field', null, h('label', null, L('Nome')), name),
      h('div.field', null, h('label', null, L('Pasta do projeto')), h('div.inline', null, dir, browse), h('small', null, L('Todas as conversas do projeto leem e escrevem aqui.'))),
      h('div.field', null, h('label', null, L('Instruções do projeto')), instr),
      h('div.field', null, h('label', null, L('Personalidade das conversas novas')), persona)),
    foot: [
      !isNew ? h('button.btn.danger', { style: { marginRight: 'auto' }, onclick: async () => {
        const n = S.convs.filter((c) => c.projectId === p.id).length;
        if (!(await confirmBox(L('Apagar o projeto "{0}"? {1} A pasta não é apagada.', p.name, n ? L('As {0} conversas dele continuam, como conversas avulsas.', n) : ''), L('Apagar projeto'), true))) return;
        S.convs.forEach((c) => { if (c.projectId === p.id) c.projectId = null; });
        S.projects = S.projects.filter((x) => x.id !== p.id);
        saveProjects(); saveConvs(); m.close(); renderConvList(); renderChat();
      } }, L('Apagar projeto')) : null,
      h('button.btn', { onclick: () => m.close() }, L('Cancelar')),
      h('button.btn.primary', { onclick: save }, isNew ? L('Criar projeto') : L('Salvar')),
    ],
  });
}

/* ------------------------------------------------------------ personalidades */
function renderPersonasPage() {
  const grid = $('#persona-grid'); grid.innerHTML = '';
  if (!S.personas.length) grid.append(h('div.empty-card', null, L('Nenhuma personalidade. Crie uma para mudar o jeito de o modelo trabalhar.')));
  for (const p of S.personas) {
    const isDef = S.settings.defaultPersona === p.id;
    grid.append(h('div.skill.persona', null,
      h('div.skill-top', null, h('div.p-avatar', { style: { background: p.color } }, (p.name[0] || '?').toUpperCase()), h('div.skill-name', null, p.name), isDef ? h('span.tag', null, L('padrão')) : null),
      h('div.skill-desc', null, p.prompt || L('Sem instruções.')),
      h('div.skill-foot', null,
        h('span', null, L('{0} caracteres', p.prompt.length)), h('span.spacer'),
        !isDef ? h('button.btn.ghost.sm', { onclick: () => { S.settings.defaultPersona = p.id; store.set('settings', S.settings); renderPersonasPage(); updatePickers(); toast(L('{0} é a personalidade padrão', p.name)); } }, L('Usar como padrão'))
          : h('button.btn.ghost.sm', { onclick: () => { S.settings.defaultPersona = null; store.set('settings', S.settings); renderPersonasPage(); updatePickers(); } }, L('Tirar padrão')),
        h('button.icon-btn.sm', { title: L('Editar'), 'aria-label': L('Editar'), html: svg('edit'), onclick: () => editPersona(p) }),
        h('button.icon-btn.sm', { title: L('Apagar'), 'aria-label': L('Apagar'), html: svg('trash'), onclick: async () => {
          if (!(await confirmBox(L('Apagar a personalidade "{0}"?', p.name), L('Apagar'), true))) return;
          S.personas = S.personas.filter((x) => x.id !== p.id);
          if (S.settings.defaultPersona === p.id) { S.settings.defaultPersona = null; store.set('settings', S.settings); }
          savePersonas(); renderPersonasPage(); updatePickers();
        } }))));
  }
}

function editPersona(p) {
  const isNew = !p;
  let color = p?.color || PERSONA_COLORS[S.personas.length % PERSONA_COLORS.length];
  const name = h('input.input', { value: p?.name || '', placeholder: L('Ex.: Commander') });
  const prompt = h('textarea.textarea', { rows: 12, value: p?.prompt || '', placeholder: L('Quem o modelo é, como deve pensar, falar e trabalhar. Ex.: Você é um analista de segurança. Responda em tópicos, cite as evidências...') });
  prompt.style.minHeight = '260px';
  const swatches = h('div.swatches', null, PERSONA_COLORS.map((c) => {
    const b = h('button.swatch' + (c === color ? '.on' : ''), { type: 'button', style: { background: c }, 'aria-label': L('Cor'), onclick: () => { color = c; $$('.swatch', swatches).forEach((x) => x.classList.toggle('on', x === b)); } });
    return b;
  }));
  let m;
  m = modal({
    title: isNew ? L('Nova personalidade') : L('Editar {0}', p.name), wide: true,
    body: h('div.form', null,
      h('div.row', null, h('div.field', null, h('label', null, L('Nome')), name), h('div.field', null, h('label', null, L('Cor')), swatches)),
      h('div.field', null, h('label', null, L('Prompt de sistema')), prompt, h('small', null, L('Entra depois do prompt geral das configurações e antes das instruções do projeto.')))),
    foot: [h('button.btn', { onclick: () => m.close() }, L('Cancelar')), h('button.btn.primary', { onclick: () => {
      const n = name.value.trim();
      if (!n) { toast(L('Dê um nome à personalidade.'), 'err'); return; }
      if (isNew) S.personas.push({ id: uid(), name: n, color, prompt: prompt.value.trim() });
      else Object.assign(p, { name: n, color, prompt: prompt.value.trim() });
      savePersonas(); m.close(); renderPersonasPage(); updatePickers(); renderMessages(false);
      toast(isNew ? L('Personalidade criada') : L('Personalidade salva'));
    } }, isNew ? L('Criar') : L('Salvar'))],
  });
}

function fillPersonaPop() {
  const pop = $('#pop-persona'); pop.innerHTML = '';
  const c = cur(); const curP = personaOf(c);
  const pick = (id) => {
    if (c) { c.personaId = id; saveConvs(); } else S.draftPersona = id;
    closePops(); updatePickers(); renderMessages(false);
  };
  pop.append(h('div.pop-head', null, h('span', null, c ? L('Personalidade desta conversa') : L('Personalidade da próxima conversa'))));
  pop.append(h('button.menu-item' + (!curP ? '.hl' : ''), { onclick: () => pick(null) }, h('span.p-dot', { style: { background: 'var(--line-2)' } }), h('span.mi-main', null, L('Sem personalidade'), h('span.mi-sub', null, L('Só o prompt geral das configurações')))));
  for (const p of S.personas) {
    pop.append(h('button.menu-item' + (curP?.id === p.id ? '.hl' : ''), { onclick: () => pick(p.id) }, h('span.p-dot', { style: { background: p.color } }), h('span.mi-main', null, p.name, h('span.mi-sub', null, p.prompt.split('\n')[0]))));
  }
  pop.append(h('div.pop-foot', null, h('button.btn.ghost.sm.wide', { onclick: () => { closePops(); setView('personas'); } }, ic('gear'), L('Gerenciar personalidades'))));
}

function renameConv(c, row) {
  const name = row.querySelector('.conv-name');
  const inp = h('input', { value: c.title });
  name.replaceWith(inp); inp.focus(); inp.select();
  let finished = false;
  const done = () => { if (finished) return; finished = true; c.title = inp.value.trim() || c.title; saveConvs(); renderConvList(); renderChatTitle(); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') { finished = true; renderConvList(); } });
  inp.addEventListener('blur', done);
  inp.addEventListener('click', (e) => e.stopPropagation());
}

function renderChatTitle() {
  const c = cur();
  $('#chat-title').textContent = c ? c.title : L('Nova conversa');
  document.title = c && c.messages.length ? L('{0} - llama studio', c.title) : L('llama studio');
  const sub = $('#chat-sub'); sub.innerHTML = '';
  // cabeçalho: só onde a conversa está (projeto ou pasta); os controles ficam na barra de baixo
  const chip = (cls, title, onclick, ...kids) => h('button.hchip' + cls, { title, onclick }, ...kids);
  const proj = projectOf(c);
  if (proj) sub.append(chip('.hc-proj', L('Projeto · {0}', proj.dir), (e) => { e.stopPropagation(); editProject(proj); }, ic('folder'), h('span.t', null, proj.name),
    basename(proj.dir) && basename(proj.dir).toLowerCase() !== proj.name.toLowerCase() ? h('span.dim', null, basename(proj.dir)) : null));
  // personalidade, modelo, habilidades e conectores ficam só na barra de baixo
  if (c?.compactions) sub.append(h('span.hnote', { title: L('O começo da conversa foi resumido para caber no contexto') }, ic('archive'), L('compactada {0}x', c.compactions)));
}

function fillConvMenu() {
  const pop = $('#pop-conv'); pop.innerHTML = '';
  const c = cur();
  if (!c) { pop.append(h('div.pop-empty', null, L('Nenhuma conversa aberta.'))); return; }
  pop.append(
    h('button.menu-item', { onclick: async () => { closePops(); const t = await promptBox(L('Renomear conversa'), L('Título'), c.title, L('Renomear')); if (t) { c.title = t; saveConvs(); renderConvList(); renderChatTitle(); } } }, ic('edit'), L('Renomear')),
    h('button.menu-item', { onclick: () => { closePops(); exportConv(c); } }, ic('download'), L('Exportar como Markdown')),
    h('button.menu-item', { onclick: () => { closePops(); compactNow(c); } }, ic('archive'), L('Compactar agora')),
    h('button.menu-item', { onclick: () => { closePops(); skillFromConv(c); } }, ic('sparkles'), L('Criar habilidade desta conversa')),
    h('button.menu-item', { onclick: () => { closePops(); showMap(c); } }, ic('folder'), L('Mapa da pasta (pré-leitura)')),
    h('button.menu-item', { onclick: () => { closePops(); c.autoApprove = !c.autoApprove; saveConvs(); toast(c.autoApprove ? L('Ferramentas liberadas nesta conversa') : L('Confirmação reativada')); } }, ic('check'), c.autoApprove ? L('Voltar a pedir confirmação') : L('Permitir ferramentas sem perguntar')),
    h('div.menu-sep'),
    h('button.menu-item.danger', { onclick: () => { closePops(); deleteConv(c); } }, ic('trash'), L('Apagar conversa')));
}

function exportConv(c) {
  const lines = [`# ${c.title}`, ''];
  for (const m of c.messages) {
    if (m.role === 'user') lines.push(L('## Você'), '', userContent(m), '');
    else if (m.role === 'assistant') {
      const t = splitThink(m.content).text.trim();
      if (t) lines.push('## llama', '', t, '');
      for (const tc of m.tool_calls || []) lines.push(L('> Ferramenta `{0}` {1}', tc.function.name, tc.function.arguments), '');
    }
  }
  api('/api/export', { name: c.title, text: lines.join('\n'), ws: wsOf(c) })
    .then((r) => { toast(L('Conversa salva em ') + r.path); api('/api/reveal', { path: r.path, ws: wsOf(c) }).catch(() => {}); refreshTree(); })
    .catch((e) => toast(e.message, 'err'));
}

/* ============================================================ mensagens */
function splitThink(content) {
  const c = content || '';
  const open = c.indexOf('<think>');
  const close = c.indexOf('</think>');
  if (open >= 0 && (open === 0 || !c.slice(0, open).trim())) {
    if (close < 0) return { think: c.slice(open + 7), text: '', thinking: true };
    return { think: c.slice(open + 7, close), text: c.slice(close + 8) };
  }
  if (open < 0 && close >= 0) return { think: c.slice(0, close), text: c.slice(close + 8) };
  return { think: '', text: c };
}

/**
 * Transforma `a` em `b` mexendo só no que mudou. Elementos que continuam iguais não são
 * recriados, então um clique ou rolagem no meio de uma atualização não se perde.
 */
function morph(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName || (a.nodeType === 1 && a.dataset.id !== b.dataset.id)) { a.replaceWith(b); return; }
  if (a.nodeType === 3 || a.nodeType === 8) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
  if (a.nodeType !== 1) return;
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  if (a.nodeName === 'DETAILS' && a.open !== b.open) a.open = b.open;
  // nos elementos reaproveitados, os eventos passam a ser os do render novo
  if (b._h) for (const [ev, fn] of Object.entries(b._h)) listen(a, ev, fn);
  const ak = [...a.childNodes]; const bk = [...b.childNodes];
  const n = Math.min(ak.length, bk.length);
  for (let i = 0; i < n; i++) morph(ak[i], bk[i]);
  for (let i = n; i < bk.length; i++) a.appendChild(bk[i]);
  for (let i = n; i < ak.length; i++) ak[i].remove();
}

function blocksOf(conv) {
  const out = []; let ai = null;
  conv.messages.forEach((m, i) => {
    if (m.hidden) return;
    if (m.role === 'user' || m.role === 'error' || m.role === 'notice') { out.push({ type: m.role, msgs: [m], start: i }); ai = null; }
    else { if (!ai) { ai = { type: 'ai', msgs: [], start: i }; out.push(ai); } ai.msgs.push(m); }
  });
  return out;
}

// Rolagem durante a resposta: segue o fim só enquanto a pessoa estiver lá embaixo.
// Qualquer gesto dela (roda, toque, teclas, arrastar a barra) decide se continua seguindo.
let followBottom = true;
let userScrollAt = 0;
// ponteiro sobre algo clicável (ou botão pressionado): a rolagem automática espera,
// senão o bloco foge do mouse enquanto o modelo escreve e o clique cai em outro lugar
let pressing = false; let overClickable = false;
const holdScroll = () => pressing || overClickable;
const CLICKABLE = '.tool-head, summary, button, a, .chip, input, select, textarea';
function nearBottom() { const el = $('#messages'); return el.scrollHeight - el.scrollTop - el.clientHeight < 60; }
function toBottom() { const el = $('#messages'); el.scrollTop = el.scrollHeight; followBottom = true; }
function initScrollFollow() {
  const el = $('#messages');
  const mark = () => { userScrollAt = Date.now(); };
  el.addEventListener('wheel', (e) => { mark(); if (e.deltaY < 0) followBottom = false; }, { passive: true });
  el.addEventListener('touchmove', mark, { passive: true });
  el.addEventListener('pointerdown', () => { mark(); pressing = true; });
  // solta um pouco depois: o clique termina e o bloco abre antes de a rolagem voltar
  const release = () => { if (pressing) setTimeout(() => { pressing = false; }, 250); };
  window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
  el.addEventListener('pointerover', (e) => { overClickable = e.pointerType !== 'touch' && !!e.target.closest?.(CLICKABLE); });
  el.addEventListener('pointerleave', () => { overClickable = false; });
  el.addEventListener('keydown', mark);
  el.addEventListener('scroll', () => {
    // só gestos da pessoa mudam o modo; as rolagens do próprio app não contam
    if (Date.now() - userScrollAt < 800) followBottom = nearBottom();
  }, { passive: true });
}

let rafPending = false;
function scheduleRender() {
  if (S.runs.size) renderConvListSoon();
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; renderMessages(true); updateBusy(); syncMade(); sendRing(); });
}

const renderConvListSoon = debounce(() => renderConvList(), 300);

function renderChat() {
  syncWsRoot(); renderChatTitle(); renderMessages(false); renderComposer();
  // painel da direita acompanha a conversa e o projeto atuais
  if (S.wsTab === 'notebook' && S.nbShown !== (cur() ? nbKey(cur()) : null)) drawNotebook();
  if (S.wsTab === 'activity') drawActivity();
  // iniciar polling do status NIM
  maybeStartNimPoll();
}

/* --- indicador NVIDIA NIM --- */

let nimPollInterval = 0;

function isNimModel() {
  // Verifica se a API principal configurada é o NVIDIA NIM (provedor "nvidia")
  const mainApi = mainApiForChat();
  return mainApi && mainApi.id && mainApi.id.trim().toLowerCase() === 'nvidia';
}

function maybeStartNimPoll() {
  // só começa se já estivermos na view de chat
  if (!$('#view-chat').classList.contains('active')) return;
  // já está rodando?
  if (nimPollInterval) return;
  // só inicia se estiver usando modelo NIM
  if (!isNimModel()) { stopNimPoll(); return; }
  // busca inicial IMEDIATA (sem esperar o intervalo)
  updateNimStatusChat();
  // poll a cada 5 segundos (mais responsivo)
  nimPollInterval = setInterval(updateNimStatusChat, 5000);
}

function stopNimPoll() {
  if (nimPollInterval) { clearInterval(nimPollInterval); nimPollInterval = 0; }
}

function getNimLevel(used, total) {
  if (total <= 0) return 'limit';
  const pct = (used / total) * 100;
  if (pct >= 80) return 'high';
  if (pct >= 50) return 'medium';
  // pct > 0 inclui todos os valores > 0; pct === 0 (zero uso) também é 'low' — faz sentido lógico
  return 'low';
}

function updateNimStatusChat() {
  // verifica se ainda estamos usando modelo NIM
  if (!isNimModel()) { stopNimPoll(); return; }
  // busca status da API
  api('/api/nim-status')
    .then((data) => {
      let used, total;
      // Se não houver dados, usa used=0, total=40 para calcular nível corretamente
      // (sem forçar 'limit' — permite que 0% seja classificado como 'low')
      if (!data) {
        used = 0;
        total = 40;
      } else {
        // API retorna: {used, wait_secs, max=40, window_secs=60}
        used = data.used || 0;
        total = data.max || 40; // usa 'max' da API (padrão 40)
      }
      const level = getNimLevel(used, total);
      const pct = Math.min(100, Math.max(0, Math.round((used / total) * 100)));

      // atualizar indicador no cabeçalho
      const ind = $('#chat-nim-indicator');
      if (ind) {
        ind.className = 'chat-nim-indicator ' + level;
        $('#nim-status-text').textContent = L('NIM: {0} / {1}', used.toLocaleString(), total.toLocaleString());
        const fill = ind.querySelector('.fill');
        if (fill) fill.style.width = pct + '%';
      }

      // atualizar indicador flutuante
      const floatInd = $('#chat-nim-floating');
      if (floatInd) {
        floatInd.textContent = used.toLocaleString() + '/' + total.toLocaleString();
        floatInd.className = 'chat-nim-floating ' + level;
      }
    })
    .catch((e) => {
      console.warn('NIM status error:', e.message);
      // em caso de erro, mostra estado: used=0, total=40 → nível 'low' (0% uso)
      let used = 0, total = 40;
      const level = getNimLevel(used, total);
      const pct = 0;
      const ind = $('#chat-nim-indicator');
      if (ind) { ind.className = 'chat-nim-indicator ' + level; ind.querySelector('.txt').textContent = L('NIM off'); }
      const floatInd = $('#chat-nim-floating');
      if (floatInd) { floatInd.textContent = '0/40'; floatInd.className = 'chat-nim-floating ' + level; }
    });
}
/* ------------------------------------------------------------ chat */

function renderMessages(onlyLast) {
  const box = $('#messages');
  const conv = cur();
  const stick = onlyLast ? followBottom && !holdScroll() : true;
  const top = box.scrollTop;
  if (!conv || !conv.messages.length) { box.innerHTML = ''; box.append(renderEmpty()); drawActivitySoon(); return; }
  const blocks = blocksOf(conv);
  // o marcador de compactação não é bloco: conta só os blocos, senão tudo seria recriado a cada quadro
  if (onlyLast && box.lastElementChild?.dataset.start == blocks[blocks.length - 1].start && box.querySelectorAll(':scope > [data-start]').length === blocks.length) {
    // rolagem interna (raciocínio, código) sobrevive à troca do bloco; no fim, segue o texto
    const inner = new Map($$('.think-body', box.lastElementChild).map((e) => [e.dataset.key, e.scrollHeight - e.scrollTop - e.clientHeight < 24]));
    // atualiza no lugar (sem trocar os elementos): cliques, seleção e rolagem continuam funcionando
    morph(box.lastElementChild, renderBlock(blocks[blocks.length - 1], conv, true));
    for (const e of $$('.think-body', box.lastElementChild)) if (inner.get(e.dataset.key) !== false) e.scrollTop = e.scrollHeight;
    // trocar o bloco não pode mexer na posição de quem está lendo mais acima
    if (!stick) box.scrollTop = top;
  } else {
    box.innerHTML = '';
    const cut = conv.compactCut || 0; let marked = false;
    blocks.forEach((b, i) => {
      if (cut && !marked && b.start >= cut) { marked = true; box.append(compactMark(conv)); }
      box.append(renderBlock(b, conv, i === blocks.length - 1));
    });
  }
  if (stick) toBottom();
  drawActivitySoon();
}

function renderEmpty() {
  const starters = [
    ['folderOpen', L('Liste o que tem no espaço de trabalho e resuma do que se trata')],
    ['fileCode', L('Crie um script Python que renomeia fotos pela data')],
    ['eye', L('Leia o README desta pasta e sugira melhorias')],
    ['pin', L('Arraste um arquivo para cá e peça para explicar o que ele faz')],
  ];
  return h('div.empty', null,
    h('div.empty-mark', null, 'L'),
    h('h2', null, L('O que vamos fazer hoje?')),
    h('p', null, L('O modelo roda no seu computador. Ele pode ler e escrever no espaço de trabalho, seguir as habilidades que você ativar e usar os conectores MCP.')),
    h('div.starters', null, starters.map(([icon, s]) => h('button.starter', { onclick: () => { setEditorText(s); focusEditor(); } }, ic(icon), h('span', null, s)))));
}

function compactMark(conv) {
  const d = h('details.compact-mark', null,
    h('summary', null, ic('archive'), h('span', null, L('Conversa compactada{0}: {1} foi resumido para o modelo', conv.compactions > 1 ? L(' {0} vezes', conv.compactions) : '', conv.compactHead ? L('o trecho entre o primeiro pedido e aqui') : L('o que vem antes daqui'))), h('span.cm-see', null, L('ver resumo'))),
    h('div.md', { html: md(conv.summary || '') }));
  return d;
}

function fmtStamp(t) {
  if (!t) return '';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Quanto falta para a primeira palavra: o llama-server conta o prompt lido (return_progress). */
function promptProgress(msg) {
  const p = msg?._pp;
  if (!p || !(p.total > p.cache)) return null;
  const done = Math.max(0, p.processed - p.cache); const all = p.total - p.cache;
  const frac = Math.min(1, done / all);
  const rate = p.time_ms > 300 && done > 0 ? done / p.time_ms : 0; // tokens por ms
  const left = rate && frac < 1 ? Math.ceil((all - done) / rate / 1000) : 0;
  return { frac, done, all, left, cached: p.cache };
}
function fmtLeft(s) { return s >= 90 ? L('~{0} min', Math.round(s / 60)) : L('~{0}s', s); }
function waitProgress(msg) {
  const pp = promptProgress(msg);
  const secs = msg?._t0 ? Math.floor((Date.now() - msg._t0) / 1000) : 0;
  waitTicker();
  if (!pp) {
    return h('div.wprog.indet', null, h('div.wprog-bar', null, h('i')),
      h('div.wprog-txt', null, msg?._pp ? L('Contexto já estava pronto; começando a responder') : L('Preparando a resposta'), secs >= 2 ? L(' · {0}s', secs) : ''));
  }
  const pct = Math.round(pp.frac * 100);
  const txt = pp.frac >= 1 ? L('Contexto lido; começando a responder')
    : L('Lendo o contexto: {0} de {1} tokens · {2}%{3}', pp.done.toLocaleString(LOCALE), pp.all.toLocaleString(LOCALE), pct, pp.left ? L(' · faltam ') + fmtLeft(pp.left) : secs >= 2 ? L(' · {0}s', secs) : '');
  // releitura grande: diz por quê (o cache só vale até onde o pedido é igual ao anterior)
  const big = pp.all > Math.max(2000, (pp.all + pp.cached) * 0.3);
  const why = big && pp.frac < 1 && msg._why ? L('Relendo porque {0}.', msg._why) : '';
  return h('div.wprog' + (pp.frac >= 1 ? '.full' : ''), { title: pp.cached ? L('{0} tokens já estavam no cache e não precisam ser lidos de novo.', pp.cached.toLocaleString(LOCALE)) : L('Nada veio do cache: o pedido inteiro é lido.') },
    h('div.wprog-bar', null, h('i', { style: { width: pct + '%' } })), h('div.wprog-txt', null, txt), why ? h('div.wprog-why', null, why) : null);
}
/* sem atualização do servidor por um tempo (modelo pensando no prompt), o relógio continua andando */
let waitTimer = 0;
function waitTicker() {
  if (waitTimer) return;
  waitTimer = setInterval(() => {
    if (!S.runs.size) { clearInterval(waitTimer); waitTimer = 0; return; }
    scheduleRender();
  }, 1000);
}

/** Anel em volta do botão de parar: enche enquanto o llama-server lê o prompt. */
function sendRing() {
  const send = $('#send'); if (!send) return;
  const c = cur(); const live = c && running(c);
  const last = live ? [...c.messages].reverse().find((m) => m.role === 'assistant') : null;
  const waiting = live && last && !last.content && !last.reasoning && !last.tool_calls?.length;
  const pp = waiting ? promptProgress(last) : null;
  send.classList.toggle('ring', !!waiting);
  send.classList.toggle('ring-indet', !!waiting && !pp);
  send.style.setProperty('--p', pp ? Math.round(pp.frac * 100) + '%' : '0%');
}

/** Onde o subagente rodou: numa API externa (qual, modelo e tokens) ou no modelo local. */
function runOnChip(res) {
  const r = res.runOn;
  if (r.local) return h('span.tag.run-on', { title: r.fell ? L('A API falhou ({0}) e o subagente continuou no modelo local.', res.apiErr || '') : L('Rodou no modelo local, num slot separado da conversa.') }, ic('cpu'), r.fell ? L('local (API falhou)') : L('local'));
  return h('span.tag.run-on.api', { title: L('Rodou pela API {0} ({1}){2}', r.api, r.model, res.apiTokens ? L(', {0} tokens', res.apiTokens.toLocaleString(LOCALE)) : '') }, ic('globe'), `${r.api}${res.apiTokens ? ' · ' + fmtK(res.apiTokens) : ''}`);
}

function renderBlock(b, conv, isLast) {
  if (b.type === 'user') return renderUser(b.msgs[0], b.start, conv);
  if (b.type === 'error') {
    return h('div.err-box', { dataset: { start: b.start } }, ic('alert'), h('div', null, b.msgs[0].content),
      isLast && !running(conv) ? h('button.btn.sm', { onclick: () => { conv.messages.splice(b.start, 1); runAgent(conv); } },
        ...(b.msgs[0].limit || b.msgs[0].loop ? [ic('play'), b.msgs[0].loop ? L('Continuar mesmo assim') : L('Continuar')] : [ic('refresh'), L('Tentar de novo')])) : null);
  }
  if (b.type === 'notice') return h('div.notice-line', { dataset: { start: b.start } }, ic(b.msgs[0].icon || 'arrowUp'), h('span', null, b.msgs[0].content));
  return renderAI(b, conv, isLast);
}

function pillEl(p) {
  const kind = p.kind;
  const label = kind === 'skill' ? L('Habilidade') : kind === 'mcp' ? L('Conector') : L('Arquivo');
  const name = kind === 'file' ? (p.name || basename(p.path)) : p.name;
  const el = h('span.pill.pill-' + kind, { title: kind === 'file' ? p.path : `${label}: ${name}` }, h('span.k', null, label + ':'), name);
  if (kind === 'file' && p.path) el.addEventListener('click', () => api('/api/reveal', { path: p.path, ws: S.ws.path }).catch((e) => toast(e.message, 'err')));
  return el;
}

function renderUser(m, idx, conv) {
  const bubble = h('div.bubble');
  if (m.parts?.length) {
    for (const p of m.parts) {
      if (p.t === 'text') bubble.append(p.v);
      else if (p.t === 'br') bubble.append('\n');
      else bubble.append(pillEl(p));
    }
  } else bubble.append(m.content || '');
  const imgRefs = (m.refs || []).filter(isImgRef);
  const thumbs = imgRefs.length ? h('div.u-imgs', null, imgRefs.map((r) => {
    const data = S.imgData.get(r.path);
    if (data === undefined) loadImg(r.path, wsOf(conv)).then(() => scheduleRender());
    return data ? h('img.u-img', { src: data, alt: r.name, title: r.path, onclick: () => api('/api/reveal', { path: r.path, ws: wsOf(conv) }).catch(() => {}) }) : null;
  })) : null;
  return h('div.msg.msg-user', { dataset: { start: idx } },
    h('div.stamp', null, fmtStamp(m.ts)),
    thumbs,
    bubble,
    autoChip(conv, m),
    h('div.chips', null,
      h('button.chip', { onclick: () => navigator.clipboard.writeText(m.content || '').then(() => toast(L('Copiado'))) }, ic('copy'), L('Copiar')),
      h('button.chip', { onclick: () => editFrom(conv, idx) }, ic('edit'), L('Editar')),
      conv.messages.slice(idx + 1).some((x) => x.role === 'tool' && x.cps?.length && !x.undone)
        ? h('button.chip', { title: L('Desfaz as alterações de arquivo feitas depois desta mensagem e volta a conversa até aqui'), onclick: () => rewindTo(conv, idx) }, ic('history'), L('Voltar até aqui')) : null));
}

async function rewindTo(conv, idx) {
  if (running(conv)) return;
  const later = conv.messages.slice(idx + 1).filter((x) => x.role === 'tool' && x.cps?.length && !x.undone);
  const files = new Set(later.flatMap((m) => { const a = parseArgs(conv.messages.find((x) => x.tool_calls?.some((t) => t.id === m.tool_call_id))?.tool_calls.find((t) => t.id === m.tool_call_id)?.function.arguments); return a?.path ? [a.path] : []; }));
  const cmds = conv.messages.slice(idx + 1).some((x) => x.role === 'tool' && ['run_command', 'execute_code'].includes(x.name) && x.status === 'ok');
  const ok = await confirmBox(L('Desfazer {0} em {1} feitas depois desta mensagem e voltar a conversa até aqui? A mensagem volta para a caixa de texto.', later.length === 1 ? L('a alteração') : L('as {0} alterações', later.length), files.size === 1 ? L('arquivo') : L('{0} arquivos', files.size || ''))
    + (cmds ? L(' Comandos e códigos executados não são desfeitos.') : ''), L('Voltar até aqui'), true);
  if (!ok) return;
  try {
    const r = await undoTools(conv, later);
    if (r.errors.length) { toast(L('Alguns arquivos não voltaram: ') + r.errors.map((x) => `${basename(String(x.path))} (${x.error})`).join('; ')); renderMessages(); return; }
    toast(`${r.done.length} ${r.done.length === 1 ? L('alteração desfeita') : L('alterações desfeitas')}`);
  } catch (e) { toast(L('Erro: ') + e.message); return; }
  editFrom(conv, idx);
}

function editFrom(conv, idx) {
  if (running(conv)) return;
  const m = conv.messages[idx];
  conv.messages.splice(idx);
  loadEditorParts(m.parts || [{ t: 'text', v: m.content || '' }]);
  saveConvs(); renderChat(); focusEditor(true);
}

function renderAI(b, conv, isLast) {
  const live = isLast && running(conv);
  const results = new Map(b.msgs.filter((m) => m.role === 'tool').map((m) => [m.tool_call_id, m]));
  const assistants = b.msgs.filter((m) => m.role === 'assistant');
  const last = assistants[assistants.length - 1];
  const toolMsgs = b.msgs.filter((m) => m.role === 'tool');
  const toolCount = assistants.reduce((n, m) => n + (m.tool_calls?.length || 0), 0);
  const reads = toolMsgs.filter((m) => ['read_file', 'list_directory', 'search_files', 'read_skill_file'].includes(m.name)).length;
  const writes = toolMsgs.filter((m) => ['write_file', 'edit_file', 'create_directory'].includes(m.name) && m.status === 'ok').length;
  const t0 = b.msgs[0]?.t0; const t1 = last?.t1;
  const aborted = !live && b.aborted;

  const card = h('div.ai-card');
  if (!live && t0 && t1 && t1 - t0 > 1500) {
    card.append(h('div.ai-status', null, h('span', null, L('Duração')), h('b', null, fmtMs(t1 - t0)), last?.tps ? h('span.muted', null, `${last.tps.toFixed(1)} tok/s`) : null));
  }
  // linha do tempo: raciocínio, falas intermediárias e ferramentas num trilho só;
  // o texto final (depois da última ferramenta) fica fora, como a resposta.
  const steps = [];
  let finalMd = null;
  assistants.forEach((m, ai) => {
    const sp = splitThink(m.content);
    const think = (m.reasoning || '') + (sp.think || '');
    const thinkingNow = live && m === last && !sp.text && !m.tool_calls?.length && (m.reasoning || sp.thinking);
    if (think.trim() && S.settings.showThinking) {
      const key = L('think-{0}-{1}', b.start, ai);
      // enquanto pensa fica aberto, a não ser que a pessoa feche (aí respeita)
      const d = h('details.think' + (thinkingNow ? '.live' : ''), { open: thinkingNow ? !S.closedThink.has(key) : S.openTools.has(key) },
        // o estado é gravado no clique (antes do navegador abrir/fechar), para a próxima atualização já respeitar
        h('summary', { onclick: (e) => {
          const willOpen = !e.currentTarget.parentElement.open;
          if (willOpen) { S.openTools.add(key); S.closedThink.delete(key); if (!e.currentTarget.parentElement.classList.contains('live')) followBottom = false; } else { S.openTools.delete(key); S.closedThink.add(key); }
        } }, h('span', { html: svg('chev', 'chev'), style: { display: 'contents' } }), h('span.lbl', null, thinkingNow ? 'Pensando...' : L('Raciocínio')), thinkingNow ? null : h('span.think-n', null, L('{0} palavras', think.trim().split(/\s+/).length))),
        h('div.think-body', { dataset: { key } }, think.trim()));
      steps.push(tlItem('think' + (thinkingNow ? '.now' : ''), ic('brain'), d));
    }
    const isFinal = m === last && !m.tool_calls?.length;
    if (sp.text.trim()) {
      const mdEl = h('div.md', { html: live && m === last ? mdLive(sp.text) : md(sp.text) });
      if (isFinal) finalMd = mdEl; else steps.push(tlItem('say', ic('message' in ICONS ? 'message' : 'chat'), mdEl));
    }
    for (const tc of m.tool_calls || []) {
      const res = results.get(tc.id);
      const t = renderTool(tc, res, live);
      const st = [...t.classList].find((c) => c.startsWith('s-')) || 's-ok';
      steps.push(tlItem('tool.' + st, h('span', { html: svg(toolIcon(tc.function?.name || '', res?.source || ((tc.function?.name || '').includes('__') ? 'mcp' : 'builtin'))) }), t));
    }
  });
  const nowLabel = live && conv._waitingModel ? (conv._waitText || L('Esperando o modelo terminar de carregar. A resposta começa sozinha.'))
    : live && conv._compacting ? L('Compactando a conversa para caber no contexto...') : '';
  if (nowLabel) steps.push(tlItem('wait.now', h('span', { html: svg('loader', 'spin') }), h('div.tl-wait', null, nowLabel)));
  // Indicador de rate limit do NVIDIA NIM
  const rateLimitWait = live && last && last._rateLimitWait && !nowLabel;
  if (rateLimitWait) {
    const waitSec = Math.max(0, Math.ceil((last._rateLimitWait - Date.now() + (live ? 0 : 1000)) / 1000));
    const waitText = waitSec > 0 ? L('Aguardando rate limit: {0}s', waitSec) : L('Rate limit pronto, pode enviar novamente.');
    steps.push(tlItem('wait.now', h('span', { html: svg('loader', 'spin') }), h('div.tl-wait', null, waitText)));
  }
  const waiting = live && !nowLabel && !finalMd && (!steps.length || (last && !last.content && !last.reasoning && !last.tool_calls?.length && toolMsgs.length));
  if (waiting) steps.push(tlItem('wait.now', h('span.tl-dot'), waitProgress(last)));
  if (steps.length) {
    const tl = h('div.tl' + (live ? '.live' : ''));
    const key = 'tl-all-' + b.start;
    const hideN = !live && steps.length > 7 && !S.openTools.has(key) ? steps.length - 4 : 0;
    if (hideN) tl.append(h('button.tl-more', { onclick: () => { S.openTools.add(key); renderMessages(false); } }, h('span.tl-node', { html: svg('list') }), L('Mostrar {0} passos anteriores', hideN)));
    steps.slice(hideN).forEach((x) => tl.append(x));
    card.append(tl);
  }
  if (finalMd) card.append(finalMd);
  if (!live && !assistants.some((m) => splitThink(m.content).text.trim() || m.tool_calls?.length)) card.append(h('div.muted', null, L('Execução interrompida.')));

  if (!live && toolCount) {
    const parts = [h('span', null, L('Este turno executou '), h('b', null, L('{0} {1} de ferramenta', toolCount, toolCount === 1 ? L('chamada') : L('chamadas'))))];
    if (reads) parts.push(h('span', null, `${reads} ${reads === 1 ? L('leitura') : L('leituras')}`));
    if (writes) parts.push(h('span', null, `${writes} ${writes === 1 ? L('alteração de arquivo') : L('alterações de arquivo')}`));
    card.append(h('div.ai-foot', null, parts));
  }

  const finalText = assistants.map((m) => splitThink(m.content).text).filter((t) => t.trim()).join('\n\n');
  return h('div.msg.msg-ai', { dataset: { start: b.start } },
    (() => { const pp = personaOf(conv); return h('div.ai-head', null, h('div.ai-avatar', { style: pp ? { background: pp.color, color: '#fff', borderColor: pp.color } : null }, pp ? (pp.name[0] || 'L').toUpperCase() : 'L'), h('span.ai-name', null, pp ? pp.name : 'llama'), h('span.stamp', null, fmtStamp(t0))); })(),
    card,
    !live ? h('div.chips', null,
      h('button.chip', { onclick: () => navigator.clipboard.writeText(finalText).then(() => toast(L('Resposta copiada'))) }, ic('copy'), L('Copiar')),
      isLast && planPending(conv, b) ? h('button.chip.primary', { onclick: () => runPlan(conv) }, ic('play'), L('Executar o plano')) : null,
      isLast ? h('button.chip', { onclick: () => { conv.messages.splice(b.start); runAgent(conv); } }, ic('refresh'), L('Tentar novamente')) : null,
      isLast && toolCount ? h('button.chip', { onclick: (e) => { $$('.tool', e.currentTarget.closest('.msg-ai')).forEach((t) => { t.classList.add('open'); S.openTools.add(t.dataset.id); }); } }, ic('list'), L('Expandir ferramentas')) : null) : null);
}

function tlItem(kind, icon, content) {
  return h('div.tl-item.k-' + kind, null, h('span.tl-node', null, icon), h('div.tl-body', null, content));
}

function shortModel(p) { return basename(p).replace(/\.gguf$/i, ''); }

/* ------------------------------------------------------------ cartões de ferramenta */
function parseArgs(s) {
  if (s && typeof s === 'object') return s;
  try { return JSON.parse(s || '{}'); } catch { return null; }
}

const TOOL_ICON = { list_directory: 'list', read_file: 'eye', write_file: 'filePen', edit_file: 'edit', create_directory: 'folderPlus', search_files: 'search', read_skill_file: 'book', run_command: 'terminal', execute_code: 'code', recall_history: 'history', search_tools: 'search', explore: 'compass', update_todos: 'list', notebook: 'book' };
function toolIcon(name, source) {
  if (source === 'mcp') return 'plug';
  if (name.startsWith('browser_')) return 'globe';
  if (name.startsWith('computer_')) return 'monitor';
  return TOOL_ICON[name] || 'wrench';
}

function toolSummary(name, args) {
  if (name === 'notebook' && args) return [args.action, args.id != null ? '#' + args.id : '', args.title || args.query || '', args.status || ''].filter(Boolean).join(' ');
  if (!args) return '';
  const pick = args.task || args.path || args.file_path || args.url || args.query || args.name || args.command || args.keys || args.text || args.window || args.pattern || args.skill || (args.id != null ? `#${args.id}` : '');
  if (typeof pick === 'string') return pick;
  const first = Object.values(args).find((v) => typeof v === 'string');
  return first ? first.slice(0, 120) : '';
}

function renderTool(tc, res, live) {
  const name = tc.function?.name || '...';
  const meta = res || {};
  const source = meta.source || (name.includes('__') ? 'mcp' : 'builtin');
  const args = parseArgs(tc.function?.arguments);
  const status = res ? res.status || (res.isError ? 'error' : 'ok') : (live ? 'pending' : 'error');
  const key = tc.id;
  const open = S.openTools.has(key);
  const el = h('div.tool.s-' + status + '.src-' + source + (open ? '.open' : ''), { dataset: { id: key } });

  let displayName = name; let server = '';
  if (source === 'mcp') {
    const i = name.indexOf('__');
    if (i > 0) { server = meta.server || name.slice(0, i); displayName = name.slice(i + 2); }
  }
  const stateEl = {
    pending: [h('span', { html: svg('loader', 'spin') }), L('preparando')],
    approval: [h('span', { html: svg('alert') }), L('aguardando você')],
    audit: [h('span', { html: svg('loader', 'spin') }), L('auditando')],
    running: [h('span', { html: svg('loader', 'spin') }), L('executando')],
    ok: [h('span', { html: svg('check') }), meta.ms != null ? fmtMs(meta.ms) : 'ok'],
    error: [h('span', { html: svg('alert') }), res ? L('erro') : L('interrompida')],
    denied: [h('span', { html: svg('ban') }), L('negada')],
  }[status];

  const head = h('button.tool-head', { onclick: (e) => { const t = e.currentTarget.closest('.tool'); t.classList.toggle('open'); if (t.classList.contains('open')) { S.openTools.add(key); followBottom = false; } else S.openTools.delete(key); } },
    h('span.tool-ico', { html: svg(toolIcon(name, source)) }),
    h('span.tool-name', null, displayName),
    server ? h('span.tool-server', null, server) : null,
    h('span.tool-sub', null, toolSummary(name, args)),
    res?.runOn ? runOnChip(res) : null,
    res?.audit?.approve && status !== 'approval' ? h('span.audit-chip', { title: L('Aprovado pelo auditor: ') + res.audit.reason + (res.audit.via ? L(' (via API: {0})', res.audit.via) : ''), html: svg('shield') }) : null,
    h('span.tool-state', null, stateEl),
    h('span', { html: svg('chev', 'chev'), style: { display: 'contents' } }));

  const bodyEl = h('div.tool-body');
  if (name === 'run_command' && args) {
    bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, args.cwd ? L('Comando (em {0})', args.cwd) : L('Comando')), h('div', { html: codeHTML(String(args.command || ''), 'powershell', { title: L('PowerShell') }) })));
  } else if ((name === 'execute_code' || name === 'browser_eval') && args) {
    bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, L('Código')), h('div', { html: codeHTML(String(args.code || ''), 'javascript', { title: L('JavaScript'), collapse: true }) })));
  } else if (name === 'explore' && args) {
    bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, L('Tarefa do subagente')), h('div.md', { html: md(args.task + (args.where ? L('\n\n**Começar por:** {0}', args.where) : '')) })));
  } else if (name === 'write_file' && args) {
    bodyEl.append(h('div.tool-sec', null,
      h('div.tool-sec-label', null, L('Conteúdo escrito em {0}', args.path || '')),
      h('div', { html: codeHTML(String(args.content ?? ''), ftype(args.path || '').lang, { title: basename(args.path || L('arquivo')), collapse: true }) })));
  } else if (name === 'edit_file' && args) {
    const pairs = Array.isArray(args.edits) && args.edits.length ? args.edits : [{ old_text: args.old_text, new_text: args.new_text }];
    const byLines = !args.old_text && args.start_line != null && !(Array.isArray(args.edits) && args.edits.length);
    const diff = h('div.diff');
    pairs.forEach((p, i) => {
      if (i) diff.append(h('div.diff-gap', null, '···'));
      if (!byLines) String(p.old_text ?? '').split('\n').forEach((l) => diff.append(h('div.del', null, l || ' ')));
      String(p.new_text ?? '').split('\n').forEach((l) => diff.append(h('div.add', null, l || ' ')));
    });
    const end = args.end_line ?? args.start_line;
    const where = byLines ? (end < args.start_line ? L(' (inserido antes da linha {0})', args.start_line) : L(' (linhas {0}{1})', args.start_line, end !== args.start_line ? '–' + end : '')) : pairs.length > 1 ? L(' ({0} trocas)', pairs.length) : args.replace_all ? L(' (todas as ocorrências)') : '';
    bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, L('Alteração em {0}{1}', args.path || '', where)), diff));
  } else if (args && Object.keys(args).length) {
    const vals = Object.values(args);
    const simple = vals.every((v) => v == null || ['string', 'number', 'boolean'].includes(typeof v)) && vals.every((v) => String(v).length < 600);
    if (simple) {
      const dl = h('dl.kv');
      for (const [k, v] of Object.entries(args)) dl.append(h('dt', null, k), h('dd', null, String(v)));
      bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, L('Argumentos')), dl));
    } else {
      bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, L('Argumentos')), h('div', { html: codeHTML(JSON.stringify(args, null, 2), 'json', { collapse: true }) })));
    }
  } else if (!args && tc.function?.arguments) {
    bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, L('Argumentos')), h('pre.result-text', null, tc.function.arguments)));
  }

  const subs = res?._sub?.length ? res._sub : res?.sub || [];
  if (subs.length) {
    const steps = h('div.substeps');
    for (const st of subs) {
      steps.append(h('div.substep.s-' + st.status, null,
        h('span', { html: svg(st.status === 'running' ? 'loader' : st.status === 'error' ? 'alert' : 'check', st.status === 'running' ? 'spin' : '') }),
        h('span.ss-name', null, st.name), h('span.ss-sub', null, st.summary || '')));
    }
    bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, name === 'explore' ? L('Passos do subagente ({0})', subs.length) : L('Ferramentas chamadas pelo código ({0})', subs.length)), steps));
  }
  if (res?._images?.length) {
    bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, L('Imagem')), ...res._images.map((src) => h('img.tool-img', { src, alt: L('Captura'), onclick: () => window.open(src) }))));
  }
  if (res && res.content && status !== 'approval') {
    const content = res.content;
    let inner; let parsed = null;
    if (/^\s*[[{]/.test(content)) { try { parsed = JSON.parse(content); } catch { /* texto */ } }
    if (parsed && !res.isError) inner = h('div', { html: codeHTML(JSON.stringify(parsed, null, 2), 'json', { collapse: true }) });
    else if (name === 'read_file' && !res.isError && args?.path && ftype(args.path).lang) inner = h('div', { html: codeHTML(content, ftype(args.path).lang, { title: basename(args.path), collapse: true }) });
    else if (name === 'explore' && !res.isError) inner = h('div.md.report', { html: md(content) });
    else if (name === 'run_command') inner = h('pre.term', null, content);
    else inner = h('pre.result-text', null, content);
    bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, res.isError ? L('Erro') : L('Resultado'), h('span', { style: { marginLeft: 'auto', fontWeight: 400 } }, content.length > 1000 ? fmtSize(content.length) : '')), inner));
  }

  if (status === 'denied' && /^O usuário negou/.test(res?.content || '')) {
    const conv = S.convs.find((c) => c.messages.includes(res));
    if (conv) bodyEl.append(h('div.cp-row', null, ic('shield'), h('span', null, L('Você negou esta ação.')), h('button.btn.sm', { onclick: () => ruleFrom(conv, res, tc, 'negou') }, L('Virar regra'))));
  }
  if (res?.cps?.length && (status === 'ok' || status === 'error')) {
    const conv = S.convs.find((c) => c.messages.includes(res));
    bodyEl.append(h('div.cp-row', null, ic('history'),
      h('span', null, res.undone ? L('Alteração desfeita: o arquivo voltou ao estado de antes.') : L('Ponto de restauração guardado antes desta alteração.')),
      res.undone && conv ? h('button.btn.sm', { onclick: () => ruleFrom(conv, res, tc, 'desfez') }, L('Virar regra')) : null,
      res.undone || !conv ? null : h('button.btn.sm', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const r = await undoTools(conv, [res]);
          if (r.errors.length) toast(L('Não consegui desfazer: ') + r.errors.map((x) => x.error).join('; '));
          else toast(r.done.length === 1 ? L('Desfeito: {0}', basename(String(r.done[0].path))) : L('{0} alterações desfeitas', r.done.length));
        } catch (err) { toast(L('Erro: ') + err.message); }
        renderMessages();
      } }, L('Desfazer'))));
  }
  if (res?.audit && status !== 'audit') {
    const a = res.audit;
    bodyEl.append(h('div.audit.r-' + a.risk + (a.approve ? '.ok' : ''), null,
      h('span.audit-ico', { html: svg('shield') }),
      h('span.audit-main', null,
        h('b', null, a.approve ? L('Aprovado pelo auditor · {0}', RISK_LABEL[a.risk]) : a.failed ? L('Auditor indisponível') : L('O auditor pediu sua análise · {0}', RISK_LABEL[a.risk])),
        h('span', null, a.reason + (a.ms ? ` (${fmtMs(a.ms)}${a.via ? L(', via API: {0}', a.via) : a.slot != null ? L(', slot {0}', a.slot) : a.slot === null ? L(', slot da conversa') : ''}${a.apiErr ? L('; a API falhou ({0}) e usou o modelo local', a.apiErr) : ''})` : '')))));
  }
  if (status === 'approval') {
    const answer = (a) => { const fn = S.approvals.get(tc.id); if (fn) { S.approvals.delete(tc.id); fn(a); } };
    bodyEl.append(h('div.approval', null,
      h('span', null, source === 'mcp' ? L('Permitir que o modelo use {0} ({1})?', displayName, server)
        : name === 'run_command' ? L('Permitir que o modelo execute este comando no seu computador?')
        : name === 'execute_code' ? L('Permitir que o modelo execute este código? Ele pode chamar outras ferramentas sem pedir de novo.')
        : name.startsWith('computer_') ? L('Permitir que o modelo use o mouse e o teclado do seu computador?')
        : name.startsWith('browser_') ? L('Permitir que o modelo execute código na página aberta?')
        : L('Permitir que o modelo altere arquivos no espaço de trabalho?')),
      h('button.btn.sm.danger', { onclick: () => answer('deny') }, L('Negar')),
      source === 'mcp' && server ? h('button.btn.sm', { title: L('Não pedir mais confirmação para as ferramentas do {0} (dá para desfazer em Conectores)', server), onclick: () => { trustMcp(server, true); answer('allow'); toast(L('Confiando no conector {0}', server)); } }, L('Confiar no {0}', server)) : null,
      h('button.btn.sm', { onclick: () => answer('always') }, L('Sempre nesta conversa')),
      h('button.btn.sm.primary', { onclick: () => answer('allow') }, L('Permitir'))));
  }

  el.append(h('div.tool-card', null, head, bodyEl));
  return el;
}
