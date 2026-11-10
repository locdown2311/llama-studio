/* llama studio - página Utilitários (programas, compartilhar, calendário, arrumar pastas) */
'use strict';

/* ============================================================ utilitários (uv, rg, fd, rtk...) */
const BIN_ICONS = { rtk: 'archive', ripgrep: 'search', fd: 'file', uv: 'terminal', bun: 'braces', ponytail: 'sparkles', caveman: 'zap' };
// pacotes de instruções: nível das regras no prompt de sistema (o primeiro é desligado)
const PACK_LEVELS = {
  ponytail: [['off', L('Desligado'), L('Instalado, mas fora do prompt.')], ['lite', L('Leve'), L('Faz o que foi pedido e só cita, numa linha, a opção mais simples.')], ['full', L('Completo'), L('A menor mudança completa, com verificação quando a lógica pede e o que ficou de fora no fim. Padrão.')], ['ultra', L('Ultra'), L('Também questiona o pedido e contesta o que não for necessário antes de construir.')]],
  caveman: [['off', L('Desligado'), L('Instalado, mas fora do prompt.')], ['on', L('Normal'), L('Resposta primeiro, sem cerimônia nem resumo no fim; frases curtas e completas. Padrão.')], ['ultra', L('Ultra'), L('Fragmentos, uma palavra quando basta, cada fato uma vez. Economiza mais, lê-se pior.')]],
};
const PACK_DEFAULT = { ponytail: 'full', caveman: 'on' };
/** Níveis escolhidos ({ponytail: 'full', caveman: 'on'}); lê o formato antigo (settings.ponytail). */
function packLevels() {
  const p = { ...(S.settings.packs || {}) };
  if (!p.ponytail && S.settings.ponytail) p.ponytail = S.settings.ponytail;
  return p;
}
function setPackLevel(id, v) { S.settings.packs = { ...packLevels(), [id]: v }; delete S.settings.ponytail; store.set('settings', S.settings); }
S.bins = null; S.binsBusy = new Set();

function fmtBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

async function loadBins(latest = false, manual = false) {
  try { S.bins = await api('/api/bins' + (latest ? '?latest=1' : '')); } catch (e) { if (manual) toast(e.message, 'err'); return; }
  if (S.view === 'tools') drawBins();
  if (manual) {
    const errs = S.bins.items.filter((b) => b.latestError);
    const ups = S.bins.items.filter((b) => b.update);
    toast(errs.length === S.bins.items.length ? errs[0].latestError : ups.length ? L('{0} com versão nova', ups.length) : L('Tudo em dia'), errs.length === S.bins.items.length ? 'err' : undefined);
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
    opt('compactOutput', L('Enxugar saídas de ferramentas'), L('Antes de ir para o modelo, tira cores e barras de progresso, junta linhas repetidas e, se passar de ~12 mil caracteres, mantém começo e fim. A saída inteira fica salva para o modelo consultar se precisar.')),
    (() => {
      const i = h('input', { type: 'checkbox', checked: S.settings.confirmPlan !== false, onchange: () => { S.settings.confirmPlan = i.checked; store.set('settings', S.settings); } });
      return h('label.tcard.wrap', null, h('span.tc-main', null, h('span.tc-title', null, L('Aprovar o plano antes de executar')),
        h('span.tc-desc', null, L('Quando o modelo monta uma lista de tarefas nova, ele espera você clicar em Continuar (ou Ajustar) antes de começar.'))), h('span.switch', null, i, h('span')));
    })(),
    (() => {
      const i = h('input', { type: 'checkbox', checked: S.settings.kvSave !== false, onchange: () => { S.settings.kvSave = i.checked; store.set('settings', S.settings); } });
      return h('label.tcard.wrap', null, h('span.tc-main', null, h('span.tc-title', null, L('Guardar o cache de cada conversa')),
        h('span.tc-desc', null, L('Ao trocar de conversa, o que o llama-server já processou da anterior vai para o disco e volta quando ela for retomada, em vez de reprocessar o histórico inteiro. Usa alguns GB em disco (guarda as 6 mais recentes).'))), h('span.switch', null, i, h('span')));
    })(),
    opt('useRtk', L('Passar comandos pelo RTK'), L('Quando o RTK está instalado, git, cargo, pytest, docker, gh e outros rodam por ele, que devolve só o essencial (falhas, arquivos alterados).')),
    (() => {
      const i = h('input', { type: 'checkbox', checked: S.settings.lazyLoad !== false, onchange: () => { S.settings.lazyLoad = i.checked; store.set('settings', S.settings); } });
      return h('label.tcard.wrap', null, h('span.tc-main', null, h('span.tc-title', null, L('Carregar ferramentas e habilidades sob demanda')),
        h('span.tc-desc', null, L('Em vez de mandar o esquema de todas as ferramentas dos conectores e o texto inteiro das habilidades em todo pedido, manda só um catálogo com nome e uma linha. O modelo carrega o que for usar. Reduz muito o contexto fixo.'))), h('span.switch', null, i, h('span')));
    })());
  const apps = $('#apps-opts'); apps.innerHTML = '';
  const vi = h('input', { type: 'checkbox', checked: videosOn(), onchange: () => setVideosOn(vi.checked) });
  apps.append(h('label.tcard.wrap', null, h('span.tc-main', null, h('span.tc-title', null, ic('film'), L('Vídeos (Remotion)')),
    h('span.tc-desc', null, L('Põe "Vídeos" na barra lateral: projetos do Remotion em que o modelo escreve o vídeo em React, com prévia ao vivo e render para MP4. Precisa do Node.js e do Git. O Remotion é grátis para pessoas e empresas pequenas; empresas maiores precisam de licença (remotion.dev/license).'))),
    h('span.switch', null, vi, h('span'))));
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
    ['settings', L('Configurações'), L('Prompt de sistema, ferramentas, aprovação, auditor, recursos automáticos, aparência.'), 1],
    ['personas', L('Personalidades'), L('{0} personalidade(s).', S.personas.length), S.personas.length],
    ['projects', L('Projetos'), L('{0} projeto(s), com instruções e regras aprendidas. A pasta vai como referência.', S.projects.length), S.projects.length],
    ['tags', L('Etiquetas'), L('{0} etiqueta(s) de cor (sem as conversas).', S.tags.length), S.tags.length],
    ['skills', L('Habilidades'), L('{0} habilidade(s), com os arquivos de cada uma.', S.skills.length), S.skills.length],
    ['mcp', L('Conectores'), L('{0} conector(es). Tokens, chaves e senhas são retirados.', secretsN), secretsN],
    ['models', L('Perfis de modelo'), L('{0} perfil(is): contexto e argumentos. O arquivo do modelo não vai.', models.length), models.length],
    ['signatures', L('Assinaturas de funções'), L('{0} assinatura(s).', sigs.length), sigs.length],
    ['arrumar', L('Regras de pastas'), L('{0} regra(s). Entram desligadas em quem importa.', rules.length), rules.length],
  ];
  const checks = {};
  const skillChecks = {};
  const name = h('input.input', { value: 'Meu Llama Studio', placeholder: L('Nome do pacote') });
  const desc = h('textarea.textarea', { rows: 2, placeholder: L('Para que serve (opcional). Ex.: setup de engenharia reversa com x64dbg') });
  const list = h('div.share-parts', null, parts.map(([id, label, d, n]) => {
    const c = h('input', { type: 'checkbox', checked: n > 0 && id !== 'arrumar', disabled: n === 0 });
    checks[id] = c;
    const row = h('label.share-part' + (n ? '' : '.off'), null, c, h('span', null, h('b', null, label), h('small', null, d)));
    if (id !== 'skills' || !S.skills.length) return row;
    const sub = h('div.share-sub', null, S.skills.map((sk) => { const x = h('input', { type: 'checkbox', checked: true }); skillChecks[sk.id] = x; return h('label', null, x, sk.name); }));
    c.addEventListener('change', () => { sub.hidden = !c.checked; });
    return h('div', null, row, sub);
  }));
  const m = modal({ title: L('Exportar configurações'), wide: true, body: h('div.form', null,
    h('div.field', null, h('label', null, L('Nome')), name), h('div.field', null, h('label', null, L('Descrição')), desc),
    h('div.field', null, h('label', null, L('O que vai no pacote')), list)),
  foot: [h('button.btn', { onclick: () => m.close() }, L('Cancelar')), h('button.btn.primary', { onclick: async (e) => {
    const sel = Object.keys(checks).filter((k) => checks[k].checked);
    if (!sel.length) { toast(L('Escolha ao menos uma parte.')); return; }
    e.currentTarget.disabled = true;
    try {
      const pkg = { format: SHARE_FORMAT, version: 1, app: S.info.version, name: name.value.trim() || L('Llama Studio'), description: desc.value.trim(), at: new Date().toISOString(), parts: sel };
      if (sel.includes('settings')) { const { ...st } = S.settings; pkg.settings = st; }
      if (sel.includes('personas')) pkg.personas = S.personas;
      if (sel.includes('projects')) pkg.projects = S.projects.map((p) => ({ ...p }));
      if (sel.includes('tags')) pkg.tags = S.tags;
      const srv = sel.filter((x) => ['skills', 'mcp', 'models', 'signatures', 'arrumar'].includes(x));
      if (srv.length) Object.assign(pkg, await api('/api/share/collect', { parts: srv, skills: Object.keys(skillChecks).filter((k) => skillChecks[k].checked) }));
      const r = await api('/api/share/save', { name: pkg.name, data: pkg });
      m.close();
      const secrets = pkg.mcp?.secrets?.length || 0;
      modal({ title: L('Pacote exportado'), body: h('div.form', null,
        h('p', { style: { margin: 0 } }, L('Salvo em '), h('code', null, r.path)),
        secrets ? h('p.muted', { style: { margin: 0 } }, L('{0} segredo(s) dos conectores foram retirados. Quem importar vai preencher os dele.', secrets)) : null,
        pkg.notes?.length ? h('p.muted', { style: { margin: 0 } }, pkg.notes.join(' ')) : null,
        h('p.muted', { style: { margin: 0 } }, L('Para importar: Configurações → Compartilhar → Importar, ou arraste o arquivo para a janela.'))),
      foot: [h('button.btn', { onclick: () => api('/api/reveal', { path: r.path }).catch(() => {}) }, ic('folderOpen'), L('Mostrar na pasta'))] });
    } catch (err) { toast(L('Não consegui exportar: ') + err.message, 'err'); e.currentTarget.disabled = false; }
  } }, L('Exportar'))] });
}
async function importDialog(path) {
  if (!path) path = await pickPath({ title: L('Escolha o pacote (.studio.json)'), mode: 'file', start: S.info.home ? S.info.home.replace(/[\\/]+$/, '') + (S.info.home.includes('\\') ? '\\Downloads' : '/Downloads') : '' });
  if (!path) return;
  let pkg;
  try { pkg = await api('/api/share/read', { path }); } catch (e) { toast(e.message, 'err'); return; }
  const count = { settings: 1, personas: pkg.personas?.length, projects: pkg.projects?.length, tags: pkg.tags?.length, skills: pkg.skills?.length, mcp: Object.keys(pkg.mcp?.servers || {}).length, models: pkg.models?.length, signatures: pkg.signatures?.length, arrumar: pkg.arrumar?.length };
  const label = { settings: L('Configurações'), personas: L('Personalidades'), projects: L('Projetos'), tags: L('Etiquetas'), skills: L('Habilidades'), mcp: L('Conectores'), models: L('Perfis de modelo'), signatures: L('Assinaturas'), arrumar: L('Regras de pastas') };
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
    const extra = p === 'settings' ? L('Substitui as suas configurações gerais (as conversas não mudam).')
      : p === 'mcp' ? L('{0} conector(es): {1}', count[p], Object.keys(pkg.mcp.servers).join(', '))
      : p === 'skills' ? pkg.skills.map((x) => x.name).join(', ')
      : p === 'models' ? L('O arquivo do modelo precisa já estar no seu PC (o studio procura pelo nome).')
      : p === 'arrumar' ? L('Entram desligadas; confira as pastas antes de ligar.')
      : p === 'projects' ? L('Projetos com pasta que não existe aqui ficam sem pasta até você escolher.') : L('{0} item(ns)', count[p]);
    return h('label.share-part', null, c, h('span', null, h('b', null, `${label[p]}${p === 'settings' ? '' : ` (${count[p]})`}`), h('small', null, extra)));
  }));
  const secrets = (pkg.mcp?.secrets || []);
  const secretInputs = {};
  const secBox = secrets.length ? h('div.field', null, h('label', null, L('Segredos dos conectores')),
    h('small', null, L('O pacote não traz tokens nem chaves. Preencha os seus; o que ficar em branco deixa o conector desligado até você completar.')),
    h('div.share-secrets', null, secrets.map((x) => {
      const key = `${x.server}:${x.where}:${x.key}`;
      const inp = h('input.input.mono', { type: 'password', placeholder: x.key.replace(/^\d+:/, ''), autocomplete: 'off' });
      secretInputs[key] = inp;
      return h('label', null, h('span', null, h('b', null, x.server), ` · ${x.where === 'headers' ? L('cabeçalho') : x.where === 'env' ? L('variável') : x.where === 'args' ? L('argumento') : L('endereço')} ${x.key.replace(/^\d+:/, '')}`), inp);
    }))) : null;
  const pol = h('select.select', null, h('option', { value: 'keep' }, L('Manter o que eu já tenho com o mesmo nome')), h('option', { value: 'replace' }, L('Substituir pelo do pacote')));
  const m = modal({ title: L('Importar "{0}"', pkg.name), wide: true, body: h('div.form', null,
    h('p.muted', { style: { margin: 0 } }, [pkg.description, L('Exportado do Llama Studio {0} em {1}.', pkg.app || '?', new Date(pkg.at).toLocaleString(LOCALE))].filter(Boolean).join(' · ')),
    h('div.field', null, h('label', null, L('O que importar')), list),
    conflicts.length ? h('div.field', null, h('label', null, L('Já existe aqui: {0}{1}', conflicts.slice(0, 6).join(', '), conflicts.length > 6 ? '...' : '')), pol) : null,
    secBox),
  foot: [h('button.btn', { onclick: () => m.close() }, L('Cancelar')), h('button.btn.primary', { onclick: async (e) => {
    const sel = Object.keys(checks).filter((k) => checks[k].checked);
    if (!sel.length) { toast(L('Escolha ao menos uma parte.')); return; }
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
      if (sel.includes('settings')) { const keepTheme = S.settings.theme; S.settings = { ...S.settings, ...pkg.settings, tools: { ...S.settings.tools, ...(pkg.settings.tools || {}) }, theme: keepTheme }; store.set('settings', S.settings); done.push(L('configurações')); }
      if (sel.includes('personas')) { done.push(L('{0} personalidade(s)', merge(S.personas, pkg.personas, (a, b) => a.id === b.id || a.name === b.name))); savePersonas(); }
      if (sel.includes('tags')) { done.push(L('{0} etiqueta(s)', merge(S.tags, pkg.tags, (a, b) => a.name === b.name))); saveTags(); }
      if (sel.includes('projects')) {
        const n = merge(S.projects, pkg.projects, (a, b) => a.id === b.id || a.name === b.name);
        saveProjects(); done.push(L('{0} projeto(s)', n));
      }
      const srv = sel.filter((x) => ['skills', 'mcp', 'models', 'signatures', 'arrumar'].includes(x));
      let r = {};
      if (srv.length) {
        const vals = {}; for (const [k, inp] of Object.entries(secretInputs)) if (inp.value.trim()) vals[k] = inp.value.trim();
        r = await api('/api/share/apply', { data: pkg, parts: srv, overwrite, secrets: vals });
        if (r.skills) done.push(L('{0} habilidade(s)', r.skills.added));
        if (r.mcp) done.push(L('{0} conector(es)', r.mcp.added));
        if (r.models) done.push(L('{0} perfil(is) de modelo', r.models.added));
        if (r.signatures) done.push(L('{0} assinatura(s)', r.signatures.added));
        if (r.arrumar) done.push(L('{0} regra(s) de pastas', r.arrumar.added));
      }
      m.close();
      await Promise.all([loadSkills(), loadMcp(), loadModels()].map((p) => p.catch?.(() => {})));
      applyTheme(); renderConvList(); updatePickers(); if (S.view === 'settings') renderSettings();
      const warn = [
        r.mcp?.pending?.length ? L('Conectores esperando o segredo (desligados): {0}.', r.mcp.pending.join(', ')) : '',
        r.models?.missing?.length ? L('Modelos que não estão no seu PC: {0}. Baixe pelo Hugging Face e importe de novo.', r.models.missing.join(', ')) : '',
        ...(r.notes || []),
      ].filter(Boolean);
      modal({ title: L('Importado'), body: h('div.form', null, h('p', { style: { margin: 0 } }, L('Entrou: ') + (done.join(', ') || L('nada novo')) + '.'), ...warn.map((w) => h('p.muted', { style: { margin: 0 } }, w))), foot: [] });
    } catch (err) { toast(L('Não consegui importar: ') + err.message, 'err'); e.currentTarget.disabled = false; }
  } }, L('Importar'))] });
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
      h('div.arr-main', null, h('b', null, r.name || L('Regra')),
        h('div.arr-path', null, h('code', null, r.src || '?'), ' → ', h('code', null, r.dest || '?')),
        h('small.muted', null, [r.patterns || '*', r.contains ? L('contém "{0}"', r.contains) : '', r.minAgeDays ? L('com mais de {0} dia(s)', r.minAgeDays) : ''].filter(Boolean).join(' · '))),
      h('div.arr-acts', null, sw('enabled', L('Ativa')), sw('auto', L('Automática')),
        h('button.btn.sm', { onclick: () => arrPreview(r) }, L('Prévia')),
        h('button.icon-btn.sm', { title: L('Editar'), 'aria-label': L('Editar'), html: svg('edit'), onclick: () => arrEdit(r, rules, saveRules) }),
        h('button.icon-btn.sm', { title: L('Apagar'), 'aria-label': L('Apagar'), html: svg('trash'), onclick: async () => { if (await confirmBox(L('Apagar a regra "{0}"? Os arquivos já movidos ficam onde estão.', r.name), L('Apagar'), true)) { rules.splice(rules.indexOf(r), 1); saveRules(); } } }))));
  }
  if (!rules.length) list.append(h('div.side-empty', null, L('Nenhuma regra ainda. Ex.: "prints da pasta Imagens vão para Capturas/ano/mês".')));
  box.append(list, h('div', { style: { margin: '10px 0 18px' } }, h('button.btn', { onclick: () => arrEdit(null, rules, saveRules) }, ic('plus'), L('Nova regra'))));
  const runs = (st.runs || []).slice(0, 8);
  if (runs.length) {
    box.append(h('div.tsec', null, L('Últimas execuções')), h('div.arr-runs', null, runs.map((x) => h('div.arr-run', null,
      h('span', null, `${new Date(x.at).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' })} · ${x.name || 'regra'}${x.auto ? L(' (automática)') : ''}`),
      h('small.muted', null, L('{0} arquivo(s){1}', x.moves.length, x.errors?.length ? L(', {0} erro(s)', x.errors.length) : '')),
      x.moves.length ? h('button.btn.sm', { onclick: async () => { const r = await api('/api/arrumar/undo', { run: x.id }); toast(L('{0} arquivo(s) voltaram{1}', r.back, r.errors.length ? L(', {0} não', r.errors.length) : '')); drawArr(); } }, L('Desfazer')) : null))));
  }
}
async function arrPreview(r) {
  let p;
  try { p = await api('/api/arrumar/plan', { rule: r }); } catch (e) { toast(e.message, 'err'); return; }
  const rel = (x) => String(x).replace(r.src.replace(/[\\/]+$/, ''), '…');
  const m = modal({ title: L('Prévia: {0}', r.name), wide: true, body: h('div.form', null,
    h('p.muted', { style: { margin: 0 } }, p.count ? L('{0} arquivo(s) seriam movidos agora.', p.count) : L('Nada para mover agora.')),
    p.count ? h('div.arr-moves', null, p.moves.map(([a, b]) => h('div', null, h('span', null, basename(a)), h('span.muted', null, ' → '), h('code', null, rel(b).replace(/[\\/][^\\/]*$/, '')))), p.count > p.moves.length ? h('div.muted', null, L('... e mais {0}', p.count - p.moves.length)) : null) : null),
  foot: [h('button.btn', { onclick: () => m.close() }, L('Fechar')), p.count ? h('button.btn.primary', { onclick: async () => { const x = await api('/api/arrumar/apply', { rule: r }); m.close(); toast(L('{0} arquivo(s) movidos{1}. Dá para desfazer em Últimas execuções.', x.moves.length, x.errors.length ? L(', {0} erro(s)', x.errors.length) : '')); drawArr(); } }, L('Mover {0}', p.count)) : null] });
}
function arrEdit(r, rules, saveRules) {
  const isNew = !r; r = r || { id: uid(), enabled: true, auto: false };
  const desc = h('textarea.textarea', { rows: 2, placeholder: L('Ex.: capturas de tela da pasta Imagens vão para Capturas, separadas por ano e mês') });
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
    if (!desc.value.trim()) { toast(L('Descreva a regra.')); return; }
    ask.disabled = true; ask.textContent = 'Montando...';
    try {
      const out = await sideAsk(null, L('Converta o pedido do usuário numa regra para mover arquivos. Responda só JSON: {"name": "nome curto", "src": "pasta de origem (caminho absoluto do Windows)", "patterns": "curingas separados por ;", "contains": "texto no nome ou vazio", "minAgeDays": número, "dest": "destino relativo à origem ou absoluto; pode usar {ano} {mes} {mesnome} {dia} {ext}"}.'),
        L('Pasta do usuário: {0}\nPastas comuns: Downloads, Documents (Documentos), Pictures (Imagens), Desktop (Área de Trabalho), Videos, Music.\nPedido: {1}', S.info.home, desc.value.trim()), { maxTokens: 160 });
      const j = JSON.parse(out.match(/\{[\s\S]*\}/)?.[0] || '{}');
      for (const k of Object.keys(f)) if (j[k] != null && j[k] !== '') f[k].value = j[k];
    } catch (e) { toast(L('Não consegui montar: ') + e.message, 'err'); }
    ask.disabled = false; ask.textContent = L('Montar com o modelo');
  } }, L('Montar com o modelo'));
  const m = modal({ title: isNew ? L('Nova regra') : L('Editar regra'), wide: true, body: h('div.form', null,
    h('div.field', null, h('label', null, L('Descreva (opcional)')), desc, h('div', { style: { marginTop: '6px' } }, ask)),
    h('div.field', null, h('label', null, L('Nome')), f.name),
    h('div.field', null, h('label', null, L('Pasta de origem')), h('div', { style: { display: 'flex', gap: '8px' } }, f.src, h('button.btn', { type: 'button', onclick: async () => { const p = await pickPath({ title: L('Pasta de origem'), mode: 'dir', start: f.src.value || S.info.home }); if (p) f.src.value = p; } }, L('Procurar')))),
    h('div.row', null, h('div.field', null, h('label', null, L('Arquivos')), f.patterns), h('div.field', null, h('label', null, L('Nome contém')), f.contains), h('div.field', null, h('label', null, L('Idade mínima (dias)')), f.minAgeDays)),
    h('div.field', null, h('label', null, L('Destino')), f.dest, h('small', null, L('Relativo à origem ou caminho completo. {ano}, {mes}, {mesnome}, {dia} e {ext} vêm da data e do tipo do arquivo. Só a própria pasta é lida (sem subpastas).'))),
    h('label.tcard', null, h('span.tc-main', null, h('span.tc-title', null, L('Automática')), h('span.tc-desc', null, L('Roda sozinha a cada 5 minutos enquanto o studio estiver aberto.'))), h('span.switch', null, auto, h('span')))),
  foot: [h('button.btn', { onclick: () => m.close() }, L('Cancelar')), h('button.btn.primary', { onclick: async () => {
    for (const k of Object.keys(f)) r[k] = k === 'minAgeDays' ? Number(f[k].value) || 0 : f[k].value.trim();
    r.auto = auto.checked;
    if (!r.src || !r.dest) { toast(L('Preencha a origem e o destino.'), 'err'); return; }
    if (!r.name) r.name = basename(r.src) + ' → ' + r.dest;
    if (isNew) rules.push(r);
    m.close(); await saveRules(); arrPreview(r);
  } }, L('Salvar e ver prévia'))] });
}

/* ------------------------------------------------------------ calendário de conteúdo */
// Posts guardados no servidor (mesma estrutura do caderno, chave "calendario").
// O modelo só entra quando você pede: escrever um post (na conversa dele) ou sugerir temas.
const CAL_KEY = 'calendario';
const CAL_ST = [['ideia', L('Ideia')], ['rascunho', L('Rascunho')], ['pronto', L('Pronto')], ['publicado', L('Publicado')]];
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
    h('b.cal-month', null, ((t) => t[0].toUpperCase() + t.slice(1))(mo.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }))),
    h('button.btn', { onclick: () => { S.calMonth = new Date(mo.getFullYear(), mo.getMonth() + 1, 1); renderCalendar(); } }, '›'),
    h('button.btn', { onclick: (e) => calSuggest(e.currentTarget) }, ic('sparkles'), L('Sugerir temas')));
  box.innerHTML = '';
  const grid = h('div.cal-grid');
  for (const d of [L('Dom'), L('Seg'), L('Ter'), L('Qua'), L('Qui'), L('Sex'), L('Sáb')]) grid.append(h('div.cal-dow', null, d));
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
  box.append(grid, h('div.cal-legend', null, CAL_ST.map(([v, l]) => h('span.cal-post.st-' + v, null, l)), h('span.muted', null, L('Clique num dia para criar um post.'))));
}
async function editPost(p, date) {
  const nb = await calData();
  const isNew = !p; p = p || { id: nb.next++, date, status: 'ideia', at: Date.now() };
  const title = h('input.input', { value: p.title || '', placeholder: L('Tema do post') });
  const day = h('input.input', { type: 'date', value: p.date || isoDay(new Date()) });
  const st = h('select.select', null, CAL_ST.map(([v, l]) => h('option', { value: v }, l))); st.value = p.status || 'ideia';
  const cap = h('textarea.textarea', { rows: 6, value: p.caption || '', placeholder: L('Legenda') });
  const tags = h('input.input', { value: p.hashtags || '', placeholder: '#hashtags' });
  const img = h('input.input.mono', { value: p.image || '', placeholder: L('Caminho da imagem') });
  const good = h('input', { type: 'checkbox', checked: !!p.good });
  const thumb = h('div.cal-thumb');
  const showThumb = async () => { thumb.innerHTML = ''; const v = img.value.trim(); if (!v || !IMG_RE.test(v)) return; const d = await loadImg(v); if (d) thumb.append(h('img', { src: d })); };
  img.addEventListener('change', showThumb);
  const conv = p.conv && S.convs.find((c) => c.id === p.conv);
  const lastAnswer = conv && [...conv.messages].reverse().find((m) => m.role === 'assistant' && splitThink(m.content || '').text.trim());
  const collect = () => Object.assign(p, { title: title.value.trim() || L('Post'), date: day.value, status: st.value, caption: cap.value, hashtags: tags.value.trim(), image: img.value.trim(), good: good.checked, at: Date.now() });
  const persist = async () => { collect(); if (isNew && !nb.cards.includes(p)) nb.cards.push(p); await calSave(); };
  const m = modal({ title: isNew ? L('Novo post') : p.title, wide: true, body: h('div.form', null,
    h('div.row', null, h('div.field', null, h('label', null, L('Tema')), title), h('div.field', null, h('label', null, L('Dia')), day), h('div.field', null, h('label', null, L('Situação')), st)),
    h('div.field', null, h('label', null, L('Legenda')), cap, lastAnswer ? h('div', { style: { marginTop: '6px' } }, h('button.btn.sm', { type: 'button', onclick: () => { cap.value = splitThink(lastAnswer.content).text.trim(); if (st.value === 'ideia') st.value = 'rascunho'; } }, ic('download'), L('Usar a última resposta da conversa'))) : null),
    h('div.field', null, h('label', null, L('Hashtags')), tags),
    h('div.field', null, h('label', null, L('Imagem')), h('div', { style: { display: 'flex', gap: '8px' } }, img, h('button.btn', { type: 'button', onclick: async () => { const x = await pickPath({ title: L('Imagem do post'), mode: 'file', start: img.value ? img.value.replace(/[\\/][^\\/]*$/, '') : S.info.home }); if (x) { img.value = x; showThumb(); } } }, L('Procurar'))), thumb),
    h('label.tcard', null, h('span.tc-main', null, h('span.tc-title', null, L('★ Foi bem')), h('span.tc-desc', null, L('As sugestões de temas se baseiam nos posts marcados.'))), h('span.switch', null, good, h('span')))),
  foot: [
    !isNew ? h('button.btn.danger', { style: { marginRight: 'auto' }, onclick: async () => { nb.cards = nb.cards.filter((x) => x !== p); m.close(); await calSave(); } }, L('Apagar')) : null,
    h('button.btn', { onclick: async () => { await persist(); m.close(); writePost(p); } }, ic('chat'), conv ? L('Abrir a conversa') : L('Escrever com o modelo')),
    h('button.btn', { onclick: () => m.close() }, L('Cancelar')),
    h('button.btn.primary', { onclick: async () => { await persist(); m.close(); } }, L('Salvar'))] });
  showThumb();
}
async function writePost(p) {
  const old = p.conv && S.convs.find((c) => c.id === p.conv);
  if (old) { selectConv(old.id); setView('chat'); return; }
  const c = newConv(null);
  c.title = L('Post {0}: {1}', p.date.split('-').reverse().slice(0, 2).join('/'), p.title).slice(0, 60);
  p.conv = c.id; await calSave();
  setView('chat');
  const good = (await calData()).cards.filter((x) => x.good && x.caption).slice(-2);
  const text = [L('Escreva a legenda de um post de Instagram sobre: {0} (para {1}).', p.title, p.date.split('-').reverse().join('/')),
    p.caption ? L('Rascunho atual:\n{0}', p.caption) : '',
    good.length ? L('Posts que foram bem, como referência de tom:\n{0}', good.map((x) => '- ' + clipText(x.caption, 280)).join('\n')) : '',
    L('Entregue só a legenda pronta e, na última linha, até 8 hashtags.')].filter(Boolean).join('\n\n');
  const refs = p.image ? [{ name: basename(p.image), path: p.image, dir: false }] : [];
  await submit(c, { content: text, parts: [{ t: 'text', v: text }, ...refs.map((r) => ({ t: 'pill', kind: 'file', ...r }))], refs });
}
async function calSuggest(btn) {
  const nb = await calData();
  const today = new Date(); const days = [];
  for (let i = 0; i < 21 && days.length < 7; i++) { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i); const k = isoDay(d); if (!nb.cards.some((p) => p.date === k)) days.push(k); }
  if (!days.length) { toast(L('As próximas três semanas já têm posts.')); return; }
  const recent = nb.cards.slice(-30).map((p) => `- ${p.date} ${p.good ? '★ ' : ''}${p.title}`).join('\n') || L('(nenhum ainda)');
  btn.disabled = true;
  try {
    const out = await sideAsk(null, L('Você sugere temas de posts para o Instagram do usuário. Mantenha o assunto e o tom dos posts anteriores (os com ★ foram bem), sem repetir temas. Responda uma linha por dia, no formato AAAA-MM-DD | tema curto. Nada além disso.'),
      L('Posts anteriores:\n{0}\n\nDias sem post: {1}', recent, days.join(', ')), { maxTokens: 220, temperature: 0.7 });
    let n = 0;
    for (const line of out.split('\n')) {
      const mm = line.match(/(\d{4}-\d{2}-\d{2})\s*\|\s*(.+)/);
      if (mm && days.includes(mm[1]) && !nb.cards.some((p) => p.date === mm[1])) { nb.cards.push({ id: nb.next++, date: mm[1], title: mm[2].trim().slice(0, 120), status: 'ideia', at: Date.now(), suggested: true }); n++; }
    }
    await calSave(); toast(n ? L('{0} temas sugeridos', n) : L('O modelo não sugeriu nada utilizável.'));
  } catch (e) { toast(L('Não consegui sugerir: ') + e.message, 'err'); }
  btn.disabled = false;
}

function drawBins() {
  const grid = $('#bins-grid'); if (!grid) return;
  grid.innerHTML = '';
  if (!S.bins) { grid.append(h('div.empty-card', null, 'Carregando...')); return; }
  for (const b of S.bins.items) {
    const busy = S.binsBusy.has(b.id);
    const tags = [];
    const vv = (x) => (b.kind === 'pack' ? x : 'v' + x);
    if (b.version) tags.push(h('span.tag', { title: b.kind === 'pack' ? L('Commit do repositório') : '' }, vv(b.version)));
    if (b.source === 'system') tags.push(h('span.tag', { title: L('Encontrado no PATH do Windows') }, L('do sistema')));
    if (b.source === 'studio') tags.push(h('span.tag.ok', null, L('instalado')));
    if (b.size) tags.push(h('span.tag', null, fmtBytes(b.size)));
    if (b.update) tags.push(h('span.tag.new', null, vv(b.latest) + L(' disponível')));
    const act = busy ? h('button.btn.sm', { disabled: true }, ic('loader'), b.source === 'studio' ? 'Atualizando...' : 'Baixando...')
      : b.source === 'studio' ? h('div.bin-acts', null,
          b.update ? h('button.btn.sm.primary', { onclick: () => binInstall(b) }, ic('download'), L('Atualizar')) : null,
          h('button.icon-btn.sm', { title: L('Reinstalar'), 'aria-label': L('Reinstalar'), html: svg('refresh'), onclick: () => binInstall(b) }),
          h('button.icon-btn.sm', { title: L('Remover'), 'aria-label': L('Remover'), html: svg('trash'), onclick: () => binRemove(b) }))
      : h('button.btn.sm' + (b.source ? '' : '.primary'), { onclick: () => binInstall(b), title: b.source === 'system' ? L('Baixa uma cópia própria do studio, que passa a ter preferência') : '' }, ic('download'), b.source === 'system' ? L('Instalar cópia') : L('Instalar') + (b.latest && b.kind !== 'pack' ? ' v' + b.latest : ''));
    grid.append(h('div.skill.bin' + (b.source ? '.on' : ''), null,
      h('div.skill-top', null, h('div.skill-ico.bin-ico', { html: svg(BIN_ICONS[b.id] || 'terminal') }),
        h('div.skill-name', null, b.name, h('span.bin-cmd', null, b.cmd)), b.tag === 'contexto' ? h('span.tag.ctx', null, L('economiza contexto')) : null),
      h('div.bin-tags', null, tags.length ? tags : h('span.tag.off', null, L('não instalado'))),
      h('div.skill-desc', null, b.desc),
      b.kind === 'pack' && b.source === 'studio' && PACK_LEVELS[b.id] ? packLevel(b) : null,
      h('div.skill-foot', null,
        h('a.bin-link', { href: 'https://github.com/' + b.repo, target: '_blank', rel: 'noopener', title: b.repo }, ic('external'), L('GitHub')),
        b.site ? h('a.bin-link', { href: b.site, target: '_blank', rel: 'noopener' }, ic('globe'), 'site') : null,
        h('span.spacer'), act)));
  }
  grid.append(h('div.bin-dir', null, ic('folder'), L('Pasta: '), h('code', null, S.bins.dir)));
}

function packLevel(b) {
  const levels = PACK_LEVELS[b.id];
  const cur0 = packLevels()[b.id] || 'off';
  const desc = h('div.pt-desc');
  const show = (v) => { desc.textContent = (levels.find((x) => x[0] === v) || levels[0])[2]; };
  const el = h('div.seg.sm', null, levels.map(([v, l]) => h('button', { type: 'button', class: cur0 === v ? 'on' : '', onclick: () => {
    setPackLevel(b.id, v); show(v);
    $$('button', el).forEach((x, i) => x.classList.toggle('on', levels[i][0] === v));
    toast(v === 'off' ? L('{0} fora do prompt', b.name) : L('{0} no nível {1}: vale a partir da próxima conversa', b.name, levels.find((x) => x[0] === v)[1]));
  } }, l)));
  show(cur0);
  return h('div.pt-level', null, h('span.pt-label', null, L('Nível no prompt')), el, desc);
}

async function binInstall(b) {
  S.binsBusy.add(b.id); drawBins();
  try {
    const r = await api('/api/bins/install', { id: b.id });
    toast(L('{0} {1}instalado', b.name, r.version ? (b.kind === 'pack' ? r.version : 'v' + r.version) + ' ' : ''));
    if (b.kind === 'pack') { if (!packLevels()[b.id]) setPackLevel(b.id, PACK_DEFAULT[b.id] || 'off'); loadSkills().catch(() => {}); }
  }
  catch (e) { toast(`${b.name}: ${e.message}`, 'err'); }
  S.binsBusy.delete(b.id); await loadBins(true);
}

async function binRemove(b) {
  if (!(await confirmBox(L('Remover {0} da pasta do studio?', b.name), L('Remover'), true))) return;
  try { await api('/api/bins/remove', { id: b.id }); toast(L('{0} removido', b.name)); if (b.kind === 'pack') { const p = packLevels(); delete p[b.id]; S.settings.packs = p; delete S.settings.ponytail; store.set('settings', S.settings); loadSkills().catch(() => {}); } } catch (e) { toast(e.message, 'err'); }
  await loadBins(true);
}
