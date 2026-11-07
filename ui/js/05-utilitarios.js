/* llama studio - página Utilitários (programas, compartilhar, calendário, arrumar pastas) */
'use strict';

/* ============================================================ utilitários (uv, rg, fd, rtk...) */
const BIN_ICONS = { rtk: 'archive', ripgrep: 'search', fd: 'file', uv: 'terminal', bun: 'braces' };
S.bins = null; S.binsBusy = new Set();

function fmtBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

async function loadBins(latest = false, manual = false) {
  try { S.bins = await api('/api/bins' + (latest ? '?latest=1' : '')); } catch (e) { if (manual) toast(e.message, 'err'); return; }
  if (S.view === 'tools') drawBins();
  if (manual) {
    const errs = S.bins.items.filter((b) => b.latestError);
    const ups = S.bins.items.filter((b) => b.update);
    toast(errs.length === S.bins.items.length ? errs[0].latestError : ups.length ? `${ups.length} com versão nova` : 'Tudo em dia', errs.length === S.bins.items.length ? 'err' : undefined);
  }
}

function renderToolsPage() {
  const box = $('#ctx-opts'); box.innerHTML = '';
  const opt = (key, title, desc) => {
    const i = h('input', { type: 'checkbox', checked: S.info[key] !== false, onchange: async () => {
      try { await api('/api/config', { [key]: i.checked }); S.info[key] = i.checked; } catch (e) { toast(e.message, 'err'); i.checked = !i.checked; }
    } });
    return h('label.tcard.wrap', null, h('span.tc-main', null, h('span.tc-title', null, title), h('span.tc-desc', null, desc)), h('span.switch', null, i, h('span')));
  };
  box.append(
    opt('compactOutput', 'Enxugar saídas de ferramentas', 'Antes de ir para o modelo, tira cores e barras de progresso, junta linhas repetidas e, se passar de ~12 mil caracteres, mantém começo e fim. A saída inteira fica salva para o modelo consultar se precisar.'),
    (() => {
      const i = h('input', { type: 'checkbox', checked: S.settings.confirmPlan !== false, onchange: () => { S.settings.confirmPlan = i.checked; store.set('settings', S.settings); } });
      return h('label.tcard.wrap', null, h('span.tc-main', null, h('span.tc-title', null, 'Aprovar o plano antes de executar'),
        h('span.tc-desc', null, 'Quando o modelo monta uma lista de tarefas nova, ele espera você clicar em Continuar (ou Ajustar) antes de começar.')), h('span.switch', null, i, h('span')));
    })(),
    (() => {
      const i = h('input', { type: 'checkbox', checked: S.settings.kvSave !== false, onchange: () => { S.settings.kvSave = i.checked; store.set('settings', S.settings); } });
      return h('label.tcard.wrap', null, h('span.tc-main', null, h('span.tc-title', null, 'Guardar o cache de cada conversa'),
        h('span.tc-desc', null, 'Ao trocar de conversa, o que o llama-server já processou da anterior vai para o disco e volta quando ela for retomada, em vez de reprocessar o histórico inteiro. Usa alguns GB em disco (guarda as 6 mais recentes).')), h('span.switch', null, i, h('span')));
    })(),
    opt('useRtk', 'Passar comandos pelo RTK', 'Quando o RTK está instalado, git, cargo, pytest, docker, gh e outros rodam por ele, que devolve só o essencial (falhas, arquivos alterados).'),
    (() => {
      const i = h('input', { type: 'checkbox', checked: S.settings.lazyLoad !== false, onchange: () => { S.settings.lazyLoad = i.checked; store.set('settings', S.settings); } });
      return h('label.tcard.wrap', null, h('span.tc-main', null, h('span.tc-title', null, 'Carregar ferramentas e habilidades sob demanda'),
        h('span.tc-desc', null, 'Em vez de mandar o esquema de todas as ferramentas dos conectores e o texto inteiro das habilidades em todo pedido, manda só um catálogo com nome e uma linha. O modelo carrega o que for usar. Reduz muito o contexto fixo.')), h('span.switch', null, i, h('span')));
    })());
  drawBins();
  drawArr();
  loadBins(false).then(() => { if (!S.bins?.items.some((b) => 'latest' in b)) loadBins(true); });
}

/* ------------------------------------------------------------ compartilhar configurações */
// Um arquivo .studio.json com as partes escolhidas. O que fica no navegador (configurações,
// personalidades, projetos, etiquetas) sai daqui; habilidades, conectores (sem segredos),
// assinaturas, regras de pastas e perfis de modelo saem do servidor.
const SHARE_FORMAT = 'llama-studio/compartilhar';
async function exportDialog() {
  let models = [];
  try { models = (await api('/api/models')).models || []; } catch { /* sem modelos */ }
  let sigs = []; let rules = [];
  try { sigs = (await api('/api/sig', {})).sigs || []; rules = (await api('/api/arrumar', {})).rules || []; } catch { /* vazio */ }
  const secretsN = S.mcp.length;
  const parts = [
    ['settings', 'Configurações', 'Prompt de sistema, ferramentas, aprovação, auditor, recursos automáticos, aparência.', 1],
    ['personas', 'Personalidades', `${S.personas.length} personalidade(s).`, S.personas.length],
    ['projects', 'Projetos', `${S.projects.length} projeto(s), com instruções e regras aprendidas. A pasta vai como referência.`, S.projects.length],
    ['tags', 'Etiquetas', `${S.tags.length} etiqueta(s) de cor (sem as conversas).`, S.tags.length],
    ['skills', 'Habilidades', `${S.skills.length} habilidade(s), com os arquivos de cada uma.`, S.skills.length],
    ['mcp', 'Conectores', `${secretsN} conector(es). Tokens, chaves e senhas são retirados.`, secretsN],
    ['models', 'Perfis de modelo', `${models.length} perfil(is): contexto e argumentos. O arquivo do modelo não vai.`, models.length],
    ['signatures', 'Assinaturas de funções', `${sigs.length} assinatura(s).`, sigs.length],
    ['arrumar', 'Regras de pastas', `${rules.length} regra(s). Entram desligadas em quem importa.`, rules.length],
  ];
  const checks = {};
  const skillChecks = {};
  const name = h('input.input', { value: 'Meu Llama Studio', placeholder: 'Nome do pacote' });
  const desc = h('textarea.textarea', { rows: 2, placeholder: 'Para que serve (opcional). Ex.: setup de engenharia reversa com x64dbg' });
  const list = h('div.share-parts', null, parts.map(([id, label, d, n]) => {
    const c = h('input', { type: 'checkbox', checked: n > 0 && id !== 'arrumar', disabled: n === 0 });
    checks[id] = c;
    const row = h('label.share-part' + (n ? '' : '.off'), null, c, h('span', null, h('b', null, label), h('small', null, d)));
    if (id !== 'skills' || !S.skills.length) return row;
    const sub = h('div.share-sub', null, S.skills.map((sk) => { const x = h('input', { type: 'checkbox', checked: true }); skillChecks[sk.id] = x; return h('label', null, x, sk.name); }));
    c.addEventListener('change', () => { sub.hidden = !c.checked; });
    return h('div', null, row, sub);
  }));
  const m = modal({ title: 'Exportar configurações', wide: true, body: h('div.form', null,
    h('div.field', null, h('label', null, 'Nome'), name), h('div.field', null, h('label', null, 'Descrição'), desc),
    h('div.field', null, h('label', null, 'O que vai no pacote'), list)),
  foot: [h('button.btn', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.primary', { onclick: async (e) => {
    const sel = Object.keys(checks).filter((k) => checks[k].checked);
    if (!sel.length) { toast('Escolha ao menos uma parte.'); return; }
    e.currentTarget.disabled = true;
    try {
      const pkg = { format: SHARE_FORMAT, version: 1, app: S.info.version, name: name.value.trim() || 'Llama Studio', description: desc.value.trim(), at: new Date().toISOString(), parts: sel };
      if (sel.includes('settings')) { const { ...st } = S.settings; pkg.settings = st; }
      if (sel.includes('personas')) pkg.personas = S.personas;
      if (sel.includes('projects')) pkg.projects = S.projects.map((p) => ({ ...p }));
      if (sel.includes('tags')) pkg.tags = S.tags;
      const srv = sel.filter((x) => ['skills', 'mcp', 'models', 'signatures', 'arrumar'].includes(x));
      if (srv.length) Object.assign(pkg, await api('/api/share/collect', { parts: srv, skills: Object.keys(skillChecks).filter((k) => skillChecks[k].checked) }));
      const r = await api('/api/share/save', { name: pkg.name, data: pkg });
      m.close();
      const secrets = pkg.mcp?.secrets?.length || 0;
      modal({ title: 'Pacote exportado', body: h('div.form', null,
        h('p', { style: { margin: 0 } }, 'Salvo em ', h('code', null, r.path)),
        secrets ? h('p.muted', { style: { margin: 0 } }, `${secrets} segredo(s) dos conectores foram retirados. Quem importar vai preencher os dele.`) : null,
        pkg.notes?.length ? h('p.muted', { style: { margin: 0 } }, pkg.notes.join(' ')) : null,
        h('p.muted', { style: { margin: 0 } }, 'Para importar: Configurações → Compartilhar → Importar, ou arraste o arquivo para a janela.')),
      foot: [h('button.btn', { onclick: () => api('/api/reveal', { path: r.path }).catch(() => {}) }, ic('folderOpen'), 'Mostrar na pasta')] });
    } catch (err) { toast('Não consegui exportar: ' + err.message, 'err'); e.currentTarget.disabled = false; }
  } }, 'Exportar')] });
}
async function importDialog(path) {
  if (!path) path = await pickPath({ title: 'Escolha o pacote (.studio.json)', mode: 'file', start: S.info.home ? S.info.home.replace(/[\\/]+$/, '') + (S.info.home.includes('\\') ? '\\Downloads' : '/Downloads') : '' });
  if (!path) return;
  let pkg;
  try { pkg = await api('/api/share/read', { path }); } catch (e) { toast(e.message, 'err'); return; }
  const count = { settings: 1, personas: pkg.personas?.length, projects: pkg.projects?.length, tags: pkg.tags?.length, skills: pkg.skills?.length, mcp: Object.keys(pkg.mcp?.servers || {}).length, models: pkg.models?.length, signatures: pkg.signatures?.length, arrumar: pkg.arrumar?.length };
  const label = { settings: 'Configurações', personas: 'Personalidades', projects: 'Projetos', tags: 'Etiquetas', skills: 'Habilidades', mcp: 'Conectores', models: 'Perfis de modelo', signatures: 'Assinaturas', arrumar: 'Regras de pastas' };
  const exists = {
    personas: (x) => S.personas.some((p) => p.id === x.id || p.name === x.name),
    projects: (x) => S.projects.some((p) => p.id === x.id || p.name === x.name),
    skills: (x) => S.skills.some((s) => s.id === x.id || s.name === x.name),
    mcp: (n) => S.mcp.some((s) => s.name === n),
  };
  const conflicts = [
    ...(pkg.personas || []).filter(exists.personas).map((x) => x.name),
    ...(pkg.projects || []).filter(exists.projects).map((x) => x.name),
    ...(pkg.skills || []).filter(exists.skills).map((x) => x.name),
    ...Object.keys(pkg.mcp?.servers || {}).filter(exists.mcp),
  ];
  const checks = {};
  const list = h('div.share-parts', null, (pkg.parts || []).filter((p) => count[p]).map((p) => {
    const c = h('input', { type: 'checkbox', checked: p !== 'settings' });
    checks[p] = c;
    const extra = p === 'settings' ? 'Substitui as suas configurações gerais (as conversas não mudam).'
      : p === 'mcp' ? `${count[p]} conector(es): ${Object.keys(pkg.mcp.servers).join(', ')}`
      : p === 'skills' ? pkg.skills.map((x) => x.name).join(', ')
      : p === 'models' ? 'O arquivo do modelo precisa já estar no seu PC (o studio procura pelo nome).'
      : p === 'arrumar' ? 'Entram desligadas; confira as pastas antes de ligar.'
      : p === 'projects' ? 'Projetos com pasta que não existe aqui ficam sem pasta até você escolher.' : `${count[p]} item(ns)`;
    return h('label.share-part', null, c, h('span', null, h('b', null, `${label[p]}${p === 'settings' ? '' : ` (${count[p]})`}`), h('small', null, extra)));
  }));
  const secrets = (pkg.mcp?.secrets || []);
  const secretInputs = {};
  const secBox = secrets.length ? h('div.field', null, h('label', null, 'Segredos dos conectores'),
    h('small', null, 'O pacote não traz tokens nem chaves. Preencha os seus; o que ficar em branco deixa o conector desligado até você completar.'),
    h('div.share-secrets', null, secrets.map((x) => {
      const key = `${x.server}:${x.where}:${x.key}`;
      const inp = h('input.input.mono', { type: 'password', placeholder: x.key.replace(/^\d+:/, ''), autocomplete: 'off' });
      secretInputs[key] = inp;
      return h('label', null, h('span', null, h('b', null, x.server), ` · ${x.where === 'headers' ? 'cabeçalho' : x.where === 'env' ? 'variável' : x.where === 'args' ? 'argumento' : 'endereço'} ${x.key.replace(/^\d+:/, '')}`), inp);
    }))) : null;
  const pol = h('select.select', null, h('option', { value: 'keep' }, 'Manter o que eu já tenho com o mesmo nome'), h('option', { value: 'replace' }, 'Substituir pelo do pacote'));
  const m = modal({ title: `Importar "${pkg.name}"`, wide: true, body: h('div.form', null,
    h('p.muted', { style: { margin: 0 } }, [pkg.description, `Exportado do Llama Studio ${pkg.app || '?'} em ${new Date(pkg.at).toLocaleString('pt-BR')}.`].filter(Boolean).join(' · ')),
    h('div.field', null, h('label', null, 'O que importar'), list),
    conflicts.length ? h('div.field', null, h('label', null, `Já existe aqui: ${conflicts.slice(0, 6).join(', ')}${conflicts.length > 6 ? '...' : ''}`), pol) : null,
    secBox),
  foot: [h('button.btn', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.primary', { onclick: async (e) => {
    const sel = Object.keys(checks).filter((k) => checks[k].checked);
    if (!sel.length) { toast('Escolha ao menos uma parte.'); return; }
    e.currentTarget.disabled = true;
    const overwrite = pol.value === 'replace';
    const done = [];
    const merge = (cur, items, same) => {
      let n = 0;
      for (const it of items || []) {
        const i = cur.findIndex((x) => same(x, it));
        if (i < 0) { cur.push({ ...it }); n++; } else if (overwrite) { cur[i] = { ...cur[i], ...it, id: cur[i].id }; n++; }
      }
      return n;
    };
    try {
      if (sel.includes('settings')) { const keepTheme = S.settings.theme; S.settings = { ...S.settings, ...pkg.settings, tools: { ...S.settings.tools, ...(pkg.settings.tools || {}) }, theme: keepTheme }; store.set('settings', S.settings); done.push('configurações'); }
      if (sel.includes('personas')) { done.push(`${merge(S.personas, pkg.personas, (a, b) => a.id === b.id || a.name === b.name)} personalidade(s)`); savePersonas(); }
      if (sel.includes('tags')) { done.push(`${merge(S.tags, pkg.tags, (a, b) => a.name === b.name)} etiqueta(s)`); saveTags(); }
      if (sel.includes('projects')) {
        const n = merge(S.projects, pkg.projects, (a, b) => a.id === b.id || a.name === b.name);
        saveProjects(); done.push(`${n} projeto(s)`);
      }
      const srv = sel.filter((x) => ['skills', 'mcp', 'models', 'signatures', 'arrumar'].includes(x));
      let r = {};
      if (srv.length) {
        const vals = {}; for (const [k, inp] of Object.entries(secretInputs)) if (inp.value.trim()) vals[k] = inp.value.trim();
        r = await api('/api/share/apply', { data: pkg, parts: srv, overwrite, secrets: vals });
        if (r.skills) done.push(`${r.skills.added} habilidade(s)`);
        if (r.mcp) done.push(`${r.mcp.added} conector(es)`);
        if (r.models) done.push(`${r.models.added} perfil(is) de modelo`);
        if (r.signatures) done.push(`${r.signatures.added} assinatura(s)`);
        if (r.arrumar) done.push(`${r.arrumar.added} regra(s) de pastas`);
      }
      m.close();
      await Promise.all([loadSkills(), loadMcp(), loadModels()].map((p) => p.catch?.(() => {})));
      applyTheme(); renderConvList(); updatePickers(); if (S.view === 'settings') renderSettings();
      const warn = [
        r.mcp?.pending?.length ? `Conectores esperando o segredo (desligados): ${r.mcp.pending.join(', ')}.` : '',
        r.models?.missing?.length ? `Modelos que não estão no seu PC: ${r.models.missing.join(', ')}. Baixe pelo Hugging Face e importe de novo.` : '',
        ...(r.notes || []),
      ].filter(Boolean);
      modal({ title: 'Importado', body: h('div.form', null, h('p', { style: { margin: 0 } }, 'Entrou: ' + (done.join(', ') || 'nada novo') + '.'), ...warn.map((w) => h('p.muted', { style: { margin: 0 } }, w))), foot: [] });
    } catch (err) { toast('Não consegui importar: ' + err.message, 'err'); e.currentTarget.disabled = false; }
  } }, 'Importar')] });
}

/* ------------------------------------------------------------ arrumar pastas */
// O motor é do servidor (sem o modelo). O modelo só ajuda a montar a regra a partir de uma frase,
// e só quando você pede (uma resposta curta em JSON).
async function drawArr() {
  const box = $('#arr-box'); if (!box) return;
  let st;
  try { st = await api('/api/arrumar', {}); } catch (e) { box.textContent = e.message; return; }
  box.innerHTML = '';
  const rules = st.rules || [];
  const saveRules = async () => { await api('/api/arrumar/rules', { rules }); drawArr(); };
  const list = h('div.arr-list');
  for (const r of rules) {
    const sw = (key, label) => { const i = h('input', { type: 'checkbox', checked: key === 'enabled' ? r.enabled !== false : !!r[key] }); i.addEventListener('change', () => { r[key] = i.checked; saveRules(); }); return h('label.arr-sw', null, h('span.switch', null, i, h('span')), label); };
    list.append(h('div.arr-rule' + (r.enabled === false ? '.off' : ''), null,
      h('div.arr-main', null, h('b', null, r.name || 'Regra'),
        h('div.arr-path', null, h('code', null, r.src || '?'), ' → ', h('code', null, r.dest || '?')),
        h('small.muted', null, [r.patterns || '*', r.contains ? `contém "${r.contains}"` : '', r.minAgeDays ? `com mais de ${r.minAgeDays} dia(s)` : ''].filter(Boolean).join(' · '))),
      h('div.arr-acts', null, sw('enabled', 'Ativa'), sw('auto', 'Automática'),
        h('button.btn.sm', { onclick: () => arrPreview(r) }, 'Prévia'),
        h('button.icon-btn.sm', { title: 'Editar', 'aria-label': 'Editar', html: svg('edit'), onclick: () => arrEdit(r, rules, saveRules) }),
        h('button.icon-btn.sm', { title: 'Apagar', 'aria-label': 'Apagar', html: svg('trash'), onclick: async () => { if (await confirmBox(`Apagar a regra "${r.name}"? Os arquivos já movidos ficam onde estão.`, 'Apagar', true)) { rules.splice(rules.indexOf(r), 1); saveRules(); } } }))));
  }
  if (!rules.length) list.append(h('div.side-empty', null, 'Nenhuma regra ainda. Ex.: "prints da pasta Imagens vão para Capturas/ano/mês".'));
  box.append(list, h('div', { style: { margin: '10px 0 18px' } }, h('button.btn', { onclick: () => arrEdit(null, rules, saveRules) }, ic('plus'), 'Nova regra')));
  const runs = (st.runs || []).slice(0, 8);
  if (runs.length) {
    box.append(h('div.tsec', null, 'Últimas execuções'), h('div.arr-runs', null, runs.map((x) => h('div.arr-run', null,
      h('span', null, `${new Date(x.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · ${x.name || 'regra'}${x.auto ? ' (automática)' : ''}`),
      h('small.muted', null, `${x.moves.length} arquivo(s)${x.errors?.length ? `, ${x.errors.length} erro(s)` : ''}`),
      x.moves.length ? h('button.btn.sm', { onclick: async () => { const r = await api('/api/arrumar/undo', { run: x.id }); toast(`${r.back} arquivo(s) voltaram${r.errors.length ? `, ${r.errors.length} não` : ''}`); drawArr(); } }, 'Desfazer') : null))));
  }
}
async function arrPreview(r) {
  let p;
  try { p = await api('/api/arrumar/plan', { rule: r }); } catch (e) { toast(e.message, 'err'); return; }
  const rel = (x) => String(x).replace(r.src.replace(/[\\/]+$/, ''), '…');
  const m = modal({ title: `Prévia: ${r.name}`, wide: true, body: h('div.form', null,
    h('p.muted', { style: { margin: 0 } }, p.count ? `${p.count} arquivo(s) seriam movidos agora.` : 'Nada para mover agora.'),
    p.count ? h('div.arr-moves', null, p.moves.map(([a, b]) => h('div', null, h('span', null, basename(a)), h('span.muted', null, ' → '), h('code', null, rel(b).replace(/[\\/][^\\/]*$/, '')))), p.count > p.moves.length ? h('div.muted', null, `... e mais ${p.count - p.moves.length}`) : null) : null),
  foot: [h('button.btn', { onclick: () => m.close() }, 'Fechar'), p.count ? h('button.btn.primary', { onclick: async () => { const x = await api('/api/arrumar/apply', { rule: r }); m.close(); toast(`${x.moves.length} arquivo(s) movidos${x.errors.length ? `, ${x.errors.length} erro(s)` : ''}. Dá para desfazer em Últimas execuções.`); drawArr(); } }, `Mover ${p.count}`) : null] });
}
function arrEdit(r, rules, saveRules) {
  const isNew = !r; r = r || { id: uid(), enabled: true, auto: false };
  const desc = h('textarea.textarea', { rows: 2, placeholder: 'Ex.: capturas de tela da pasta Imagens vão para Capturas, separadas por ano e mês' });
  const f = {
    name: h('input.input', { value: r.name || '' }),
    src: h('input.input.mono', { value: r.src || '' }),
    patterns: h('input.input.mono', { value: r.patterns || '', placeholder: '*.png;*.jpg' }),
    contains: h('input.input', { value: r.contains || '', placeholder: 'opcional' }),
    minAgeDays: h('input.input', { value: r.minAgeDays || '', placeholder: '0', inputmode: 'numeric' }),
    dest: h('input.input.mono', { value: r.dest || '', placeholder: 'Capturas\\{ano}\\{mesnome}' }),
  };
  const auto = h('input', { type: 'checkbox', checked: !!r.auto });
  const ask = h('button.btn', { type: 'button', onclick: async () => {
    if (!desc.value.trim()) { toast('Descreva a regra.'); return; }
    ask.disabled = true; ask.textContent = 'Montando...';
    try {
      const out = await sideAsk(null, 'Converta o pedido do usuário numa regra para mover arquivos. Responda só JSON: {"name": "nome curto", "src": "pasta de origem (caminho absoluto do Windows)", "patterns": "curingas separados por ;", "contains": "texto no nome ou vazio", "minAgeDays": número, "dest": "destino relativo à origem ou absoluto; pode usar {ano} {mes} {mesnome} {dia} {ext}"}.',
        `Pasta do usuário: ${S.info.home}\nPastas comuns: Downloads, Documents (Documentos), Pictures (Imagens), Desktop (Área de Trabalho), Videos, Music.\nPedido: ${desc.value.trim()}`, { maxTokens: 160 });
      const j = JSON.parse(out.match(/\{[\s\S]*\}/)?.[0] || '{}');
      for (const k of Object.keys(f)) if (j[k] != null && j[k] !== '') f[k].value = j[k];
    } catch (e) { toast('Não consegui montar: ' + e.message, 'err'); }
    ask.disabled = false; ask.textContent = 'Montar com o modelo';
  } }, 'Montar com o modelo');
  const m = modal({ title: isNew ? 'Nova regra' : 'Editar regra', wide: true, body: h('div.form', null,
    h('div.field', null, h('label', null, 'Descreva (opcional)'), desc, h('div', { style: { marginTop: '6px' } }, ask)),
    h('div.field', null, h('label', null, 'Nome'), f.name),
    h('div.field', null, h('label', null, 'Pasta de origem'), h('div', { style: { display: 'flex', gap: '8px' } }, f.src, h('button.btn', { type: 'button', onclick: async () => { const p = await pickPath({ title: 'Pasta de origem', mode: 'dir', start: f.src.value || S.info.home }); if (p) f.src.value = p; } }, 'Procurar'))),
    h('div.row', null, h('div.field', null, h('label', null, 'Arquivos'), f.patterns), h('div.field', null, h('label', null, 'Nome contém'), f.contains), h('div.field', null, h('label', null, 'Idade mínima (dias)'), f.minAgeDays)),
    h('div.field', null, h('label', null, 'Destino'), f.dest, h('small', null, 'Relativo à origem ou caminho completo. {ano}, {mes}, {mesnome}, {dia} e {ext} vêm da data e do tipo do arquivo. Só a própria pasta é lida (sem subpastas).')),
    h('label.tcard', null, h('span.tc-main', null, h('span.tc-title', null, 'Automática'), h('span.tc-desc', null, 'Roda sozinha a cada 5 minutos enquanto o studio estiver aberto.')), h('span.switch', null, auto, h('span')))),
  foot: [h('button.btn', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.primary', { onclick: async () => {
    for (const k of Object.keys(f)) r[k] = k === 'minAgeDays' ? Number(f[k].value) || 0 : f[k].value.trim();
    r.auto = auto.checked;
    if (!r.src || !r.dest) { toast('Preencha a origem e o destino.', 'err'); return; }
    if (!r.name) r.name = basename(r.src) + ' → ' + r.dest;
    if (isNew) rules.push(r);
    m.close(); await saveRules(); arrPreview(r);
  } }, 'Salvar e ver prévia')] });
}

/* ------------------------------------------------------------ calendário de conteúdo */
// Posts guardados no servidor (mesma estrutura do caderno, chave "calendario").
// O modelo só entra quando você pede: escrever um post (na conversa dele) ou sugerir temas.
const CAL_KEY = 'calendario';
const CAL_ST = [['ideia', 'Ideia'], ['rascunho', 'Rascunho'], ['pronto', 'Pronto'], ['publicado', 'Publicado']];
S.calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
async function calData() { return nbLoad(CAL_KEY); }
async function calSave() { await nbSave(CAL_KEY); if (S.view === 'calendar') renderCalendar(); }
async function renderCalendar() {
  const box = $('#cal'); const acts = $('#cal-actions'); if (!box) return;
  const nb = await calData();
  const mo = S.calMonth;
  acts.innerHTML = '';
  acts.append(
    h('button.btn', { onclick: () => { S.calMonth = new Date(mo.getFullYear(), mo.getMonth() - 1, 1); renderCalendar(); } }, '‹'),
    h('b.cal-month', null, ((t) => t[0].toUpperCase() + t.slice(1))(mo.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }))),
    h('button.btn', { onclick: () => { S.calMonth = new Date(mo.getFullYear(), mo.getMonth() + 1, 1); renderCalendar(); } }, '›'),
    h('button.btn', { onclick: (e) => calSuggest(e.currentTarget) }, ic('sparkles'), 'Sugerir temas'));
  box.innerHTML = '';
  const grid = h('div.cal-grid');
  for (const d of ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']) grid.append(h('div.cal-dow', null, d));
  const start = new Date(mo.getFullYear(), mo.getMonth(), 1 - mo.getDay());
  const today = isoDay(new Date());
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (i >= 35 && d.getMonth() !== mo.getMonth()) break;
    const key = isoDay(d);
    const posts = nb.cards.filter((p) => p.date === key);
    grid.append(h('div.cal-day' + (d.getMonth() !== mo.getMonth() ? '.out' : '') + (key === today ? '.today' : ''), { onclick: (e) => { if (e.target === e.currentTarget || e.target.classList.contains('cal-n')) editPost(null, key); } },
      h('span.cal-n', null, String(d.getDate())),
      posts.map((p) => h('button.cal-post.st-' + (p.status || 'ideia'), { title: p.caption || p.title, onclick: () => editPost(p) }, p.good ? '★ ' : '', p.title))));
  }
  box.append(grid, h('div.cal-legend', null, CAL_ST.map(([v, l]) => h('span.cal-post.st-' + v, null, l)), h('span.muted', null, 'Clique num dia para criar um post.')));
}
async function editPost(p, date) {
  const nb = await calData();
  const isNew = !p; p = p || { id: nb.next++, date, status: 'ideia', at: Date.now() };
  const title = h('input.input', { value: p.title || '', placeholder: 'Tema do post' });
  const day = h('input.input', { type: 'date', value: p.date || isoDay(new Date()) });
  const st = h('select.select', null, CAL_ST.map(([v, l]) => h('option', { value: v }, l))); st.value = p.status || 'ideia';
  const cap = h('textarea.textarea', { rows: 6, value: p.caption || '', placeholder: 'Legenda' });
  const tags = h('input.input', { value: p.hashtags || '', placeholder: '#hashtags' });
  const img = h('input.input.mono', { value: p.image || '', placeholder: 'Caminho da imagem' });
  const good = h('input', { type: 'checkbox', checked: !!p.good });
  const thumb = h('div.cal-thumb');
  const showThumb = async () => { thumb.innerHTML = ''; const v = img.value.trim(); if (!v || !IMG_RE.test(v)) return; const d = await loadImg(v); if (d) thumb.append(h('img', { src: d })); };
  img.addEventListener('change', showThumb);
  const conv = p.conv && S.convs.find((c) => c.id === p.conv);
  const lastAnswer = conv && [...conv.messages].reverse().find((m) => m.role === 'assistant' && splitThink(m.content || '').text.trim());
  const collect = () => Object.assign(p, { title: title.value.trim() || 'Post', date: day.value, status: st.value, caption: cap.value, hashtags: tags.value.trim(), image: img.value.trim(), good: good.checked, at: Date.now() });
  const persist = async () => { collect(); if (isNew && !nb.cards.includes(p)) nb.cards.push(p); await calSave(); };
  const m = modal({ title: isNew ? 'Novo post' : p.title, wide: true, body: h('div.form', null,
    h('div.row', null, h('div.field', null, h('label', null, 'Tema'), title), h('div.field', null, h('label', null, 'Dia'), day), h('div.field', null, h('label', null, 'Situação'), st)),
    h('div.field', null, h('label', null, 'Legenda'), cap, lastAnswer ? h('div', { style: { marginTop: '6px' } }, h('button.btn.sm', { type: 'button', onclick: () => { cap.value = splitThink(lastAnswer.content).text.trim(); if (st.value === 'ideia') st.value = 'rascunho'; } }, ic('download'), 'Usar a última resposta da conversa')) : null),
    h('div.field', null, h('label', null, 'Hashtags'), tags),
    h('div.field', null, h('label', null, 'Imagem'), h('div', { style: { display: 'flex', gap: '8px' } }, img, h('button.btn', { type: 'button', onclick: async () => { const x = await pickPath({ title: 'Imagem do post', mode: 'file', start: img.value ? img.value.replace(/[\\/][^\\/]*$/, '') : S.info.home }); if (x) { img.value = x; showThumb(); } } }, 'Procurar')), thumb),
    h('label.tcard', null, h('span.tc-main', null, h('span.tc-title', null, '★ Foi bem'), h('span.tc-desc', null, 'As sugestões de temas se baseiam nos posts marcados.')), h('span.switch', null, good, h('span')))),
  foot: [
    !isNew ? h('button.btn.danger', { style: { marginRight: 'auto' }, onclick: async () => { nb.cards = nb.cards.filter((x) => x !== p); m.close(); await calSave(); } }, 'Apagar') : null,
    h('button.btn', { onclick: async () => { await persist(); m.close(); writePost(p); } }, ic('chat'), conv ? 'Abrir a conversa' : 'Escrever com o modelo'),
    h('button.btn', { onclick: () => m.close() }, 'Cancelar'),
    h('button.btn.primary', { onclick: async () => { await persist(); m.close(); } }, 'Salvar')] });
  showThumb();
}
async function writePost(p) {
  const old = p.conv && S.convs.find((c) => c.id === p.conv);
  if (old) { selectConv(old.id); setView('chat'); return; }
  const c = newConv(null);
  c.title = `Post ${p.date.split('-').reverse().slice(0, 2).join('/')}: ${p.title}`.slice(0, 60);
  p.conv = c.id; await calSave();
  setView('chat');
  const good = (await calData()).cards.filter((x) => x.good && x.caption).slice(-2);
  const text = [`Escreva a legenda de um post de Instagram sobre: ${p.title} (para ${p.date.split('-').reverse().join('/')}).`,
    p.caption ? `Rascunho atual:\n${p.caption}` : '',
    good.length ? `Posts que foram bem, como referência de tom:\n${good.map((x) => '- ' + clipText(x.caption, 280)).join('\n')}` : '',
    'Entregue só a legenda pronta e, na última linha, até 8 hashtags.'].filter(Boolean).join('\n\n');
  const refs = p.image ? [{ name: basename(p.image), path: p.image, dir: false }] : [];
  await submit(c, { content: text, parts: [{ t: 'text', v: text }, ...refs.map((r) => ({ t: 'pill', kind: 'file', ...r }))], refs });
}
async function calSuggest(btn) {
  const nb = await calData();
  const today = new Date(); const days = [];
  for (let i = 0; i < 21 && days.length < 7; i++) { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i); const k = isoDay(d); if (!nb.cards.some((p) => p.date === k)) days.push(k); }
  if (!days.length) { toast('As próximas três semanas já têm posts.'); return; }
  const recent = nb.cards.slice(-30).map((p) => `- ${p.date} ${p.good ? '★ ' : ''}${p.title}`).join('\n') || '(nenhum ainda)';
  btn.disabled = true;
  try {
    const out = await sideAsk(null, 'Você sugere temas de posts para o Instagram do usuário. Mantenha o assunto e o tom dos posts anteriores (os com ★ foram bem), sem repetir temas. Responda uma linha por dia, no formato AAAA-MM-DD | tema curto. Nada além disso.',
      `Posts anteriores:\n${recent}\n\nDias sem post: ${days.join(', ')}`, { maxTokens: 220, temperature: 0.7 });
    let n = 0;
    for (const line of out.split('\n')) {
      const mm = line.match(/(\d{4}-\d{2}-\d{2})\s*\|\s*(.+)/);
      if (mm && days.includes(mm[1]) && !nb.cards.some((p) => p.date === mm[1])) { nb.cards.push({ id: nb.next++, date: mm[1], title: mm[2].trim().slice(0, 120), status: 'ideia', at: Date.now(), suggested: true }); n++; }
    }
    await calSave(); toast(n ? `${n} temas sugeridos` : 'O modelo não sugeriu nada utilizável.');
  } catch (e) { toast('Não consegui sugerir: ' + e.message, 'err'); }
  btn.disabled = false;
}

function drawBins() {
  const grid = $('#bins-grid'); if (!grid) return;
  grid.innerHTML = '';
  if (!S.bins) { grid.append(h('div.empty-card', null, 'Carregando...')); return; }
  for (const b of S.bins.items) {
    const busy = S.binsBusy.has(b.id);
    const tags = [];
    if (b.version) tags.push(h('span.tag', null, 'v' + b.version));
    if (b.source === 'system') tags.push(h('span.tag', { title: 'Encontrado no PATH do Windows' }, 'do sistema'));
    if (b.source === 'studio') tags.push(h('span.tag.ok', null, 'instalado'));
    if (b.size) tags.push(h('span.tag', null, fmtBytes(b.size)));
    if (b.update) tags.push(h('span.tag.new', null, 'v' + b.latest + ' disponível'));
    const act = busy ? h('button.btn.sm', { disabled: true }, ic('loader'), b.source === 'studio' ? 'Atualizando...' : 'Baixando...')
      : b.source === 'studio' ? h('div.bin-acts', null,
          b.update ? h('button.btn.sm.primary', { onclick: () => binInstall(b) }, ic('download'), 'Atualizar') : null,
          h('button.icon-btn.sm', { title: 'Reinstalar', 'aria-label': 'Reinstalar', html: svg('refresh'), onclick: () => binInstall(b) }),
          h('button.icon-btn.sm', { title: 'Remover', 'aria-label': 'Remover', html: svg('trash'), onclick: () => binRemove(b) }))
      : h('button.btn.sm' + (b.source ? '' : '.primary'), { onclick: () => binInstall(b), title: b.source === 'system' ? 'Baixa uma cópia própria do studio, que passa a ter preferência' : '' }, ic('download'), b.source === 'system' ? 'Instalar cópia' : 'Instalar' + (b.latest ? ' v' + b.latest : ''));
    grid.append(h('div.skill.bin' + (b.source ? '.on' : ''), null,
      h('div.skill-top', null, h('div.skill-ico.bin-ico', { html: svg(BIN_ICONS[b.id] || 'terminal') }),
        h('div.skill-name', null, b.name, h('span.bin-cmd', null, b.cmd)), b.tag === 'contexto' ? h('span.tag.ctx', null, 'economiza contexto') : null),
      h('div.bin-tags', null, tags.length ? tags : h('span.tag.off', null, 'não instalado')),
      h('div.skill-desc', null, b.desc),
      h('div.skill-foot', null,
        h('a.bin-link', { href: 'https://github.com/' + b.repo, target: '_blank', rel: 'noopener', title: b.repo }, ic('external'), 'GitHub'),
        b.site ? h('a.bin-link', { href: b.site, target: '_blank', rel: 'noopener' }, ic('globe'), 'site') : null,
        h('span.spacer'), act)));
  }
  grid.append(h('div.bin-dir', null, ic('folder'), 'Pasta: ', h('code', null, S.bins.dir)));
}

async function binInstall(b) {
  S.binsBusy.add(b.id); drawBins();
  try { const r = await api('/api/bins/install', { id: b.id }); toast(`${b.name} ${r.version ? 'v' + r.version + ' ' : ''}instalado`); }
  catch (e) { toast(`${b.name}: ${e.message}`, 'err'); }
  S.binsBusy.delete(b.id); await loadBins(true);
}

async function binRemove(b) {
  if (!(await confirmBox(`Remover ${b.name} da pasta do studio?`, 'Remover', true))) return;
  try { await api('/api/bins/remove', { id: b.id }); toast(`${b.name} removido`); } catch (e) { toast(e.message, 'err'); }
  await loadBins(true);
}
