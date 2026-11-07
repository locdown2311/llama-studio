/* llama studio - habilidades e conectores (MCP) */
'use strict';

/* ============================================================ skills */
async function loadSkills() {
  try { S.skills = (await api('/api/skills')).skills; } catch { S.skills = []; }
  S.sel.skills = S.sel.skills.filter((id) => S.skills.some((s) => s.id === id));
  updatePickers();
}

async function renderSkillsPage() {
  await loadSkills();
  const grid = $('#skill-grid'); grid.innerHTML = '';
  if (!S.skills.length) grid.append(h('div.empty-card', null, 'Nenhuma habilidade ainda. Crie uma ou importe um pacote acima.'));
  for (const s of S.skills) {
    const active = S.sel.skills.includes(s.id);
    grid.append(h('div.skill' + (active ? '.on' : ''), null,
      h('div.skill-top', null, h('div.skill-ico', { html: svg('sparkles') }), h('div.skill-name', { title: s.name }, s.name), !s.editable ? h('span.tag', { title: s.source }, 'externa') : null,
        h('label.switch', { title: active ? 'Ativa no chat' : 'Ativar no chat' }, (() => {
          const i = h('input', { type: 'checkbox', checked: active });
          i.addEventListener('change', () => { S.sel.skills = i.checked ? [...new Set([...S.sel.skills, s.id])] : S.sel.skills.filter((x) => x !== s.id); saveSel(); updatePickers(); renderSkillsPage(); });
          return i;
        })(), h('span'))),
      h('div.skill-desc', null, s.description || 'Sem descrição.'),
      h('div.skill-foot', null,
        h('span', null, s.files.length ? `${s.files.length} ${s.files.length === 1 ? 'arquivo extra' : 'arquivos extras'}` : 'só SKILL.md'),
        h('span.spacer'),
        h('button.icon-btn.sm', { title: 'Abrir pasta', 'aria-label': 'Abrir pasta', html: svg('external'), onclick: () => api('/api/skills/open', { id: s.id }) }),
        s.editable ? h('button.icon-btn.sm', { title: 'Editar', 'aria-label': 'Editar', html: svg('edit'), onclick: () => editSkill(s.id) }) : null,
        s.editable ? h('button.icon-btn.sm', { title: 'Remover', 'aria-label': 'Remover', html: svg('trash'), onclick: async () => {
          if (!(await confirmBox(`Remover a habilidade "${s.name}"? A pasta dela será apagada.`, 'Remover', true))) return;
          try { await api('/api/skills/delete', { id: s.id }); toast('Habilidade removida'); renderSkillsPage(); } catch (e) { toast(e.message, 'err'); }
        } }) : null)));
  }
  const ed = $('#extra-dirs'); ed.innerHTML = '';
  for (const d of S.info.extraSkillsDirs || []) {
    ed.append(h('div.dirrow', null, ic('folder'), h('span', { title: d }, d), h('button.icon-btn.sm', { title: 'Remover', 'aria-label': 'Remover', html: svg('x'), onclick: async () => {
      S.info.extraSkillsDirs = S.info.extraSkillsDirs.filter((x) => x !== d);
      await api('/api/config', { extraSkillsDirs: S.info.extraSkillsDirs }); renderSkillsPage();
    } })));
  }
}

async function editSkill(id, prefill) {
  let data = { name: '', description: '', body: '', ...(prefill || {}) };
  if (id) { try { data = await api('/api/skills/get?id=' + encodeURIComponent(id)); } catch (e) { toast(e.message, 'err'); return; } }
  const name = h('input.input', { value: data.name || data.meta?.name || '', placeholder: 'Ex.: relatorios-em-pt' });
  const desc = h('textarea.textarea', { rows: 2, value: data.description || '', placeholder: 'Quando o modelo deve usar esta skill. Ex.: Use ao escrever relatórios técnicos em português.' });
  desc.style.minHeight = '60px';
  const body = h('textarea.textarea.mono', { rows: 14, value: (data.body || '').trim(), placeholder: '# Instruções\n\nDescreva o passo a passo, regras de estilo, exemplos...' });
  body.style.minHeight = '280px';
  const m = modal({
    title: id ? 'Editar habilidade' : 'Nova habilidade', wide: true,
    body: h('div.form', null,
      h('div.field', null, h('label', null, 'Nome'), name),
      h('div.field', null, h('label', null, 'Descrição'), desc, h('small', null, 'O modelo lê isto para entender quando aplicar a habilidade.')),
      h('div.field', null, h('label', null, 'Instruções (Markdown)'), body)),
    foot: [h('button.btn', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.primary', { onclick: async () => {
      try {
        const r = await api('/api/skills/save', { id, name: name.value.trim(), description: desc.value.trim(), body: body.value });
        m.close(); toast(id ? 'Habilidade salva' : 'Habilidade criada');
        if (!id) { S.sel.skills = [...new Set([...S.sel.skills, r.id])]; saveSel(); }
        renderSkillsPage();
      } catch (e) { toast(e.message, 'err'); }
    } }, id ? 'Salvar habilidade' : 'Criar habilidade')],
  });
}

async function importSkillFiles(files) {
  for (const f of files) {
    try {
      const r = await api('/api/skills/import-zip?name=' + encodeURIComponent(f.name), f);
      toast(`Importada: ${r.imported.join(', ')}`);
    } catch (e) { toast(`${f.name}: ${e.message}`, 'err'); }
  }
  renderSkillsPage();
}

async function importSkillPath(p) {
  try {
    const r = await api('/api/skills/import-path', { path: p });
    toast(`Importada${r.imported.length > 1 ? 's' : ''}: ${r.imported.join(', ')}`);
    renderSkillsPage();
  } catch (e) { toast(e.message, 'err'); }
}

function setupSkillsPage() {
  $('#skill-new').append(ic('plus'), 'Nova skill');
  $('#skill-new').addEventListener('click', () => editSkill(null));
  $('#skill-open-dir').append(ic('external'), 'Abrir pasta');
  $('#skill-open-dir').addEventListener('click', () => api('/api/skills/open', {}));
  $('.iz-icon').innerHTML = svg('download');
  $('#skill-import-path').addEventListener('click', async () => {
    const p = await pickPath({ title: 'Importar habilidade: escolha uma pasta, .zip ou .md', mode: 'any', start: S.info.home });
    if (p) importSkillPath(p);
  });
  $('#skill-zip').addEventListener('change', (e) => { importSkillFiles([...e.target.files]); e.target.value = ''; });
  $('#extra-add').addEventListener('click', async () => {
    const p = await pickPath({ title: 'Pasta com habilidades', mode: 'dir', start: S.info.home });
    if (!p) return;
    S.info.extraSkillsDirs = [...new Set([...(S.info.extraSkillsDirs || []), p])];
    await api('/api/config', { extraSkillsDirs: S.info.extraSkillsDirs });
    renderSkillsPage();
  });
  const dz = $('#skill-drop');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', async (e) => {
    e.preventDefault(); dz.classList.remove('over');
    const items = [...e.dataTransfer.items].filter((i) => i.kind === 'file');
    const files = [];
    for (const it of items) {
      const entry = it.webkitGetAsEntry?.();
      const f = it.getAsFile();
      if (entry?.isDirectory) {
        toast(`Localizando a pasta ${f.name}...`);
        const r = await api('/api/locate', { name: f.name, isDir: true });
        if (r.matches.length === 1) await importSkillPath(r.matches[0].path);
        else {
          const p = await pickPath({ title: r.matches.length ? `Várias pastas "${f.name}": escolha qual importar` : `Não achei "${f.name}": escolha a pasta`, mode: 'dir', start: r.matches[0] ? r.matches[0].path : S.info.home });
          if (p) await importSkillPath(p);
        }
      } else if (f) files.push(f);
    }
    if (files.length) importSkillFiles(files);
  });
}

/* ============================================================ MCP */
const PRESETS = [
  { name: 'arquivos', title: 'Sistema de arquivos', desc: 'Lê e escreve arquivos numa pasta permitida.', tag: 'npx', icon: 'folder',
    config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '{pasta}'] }, ask: [{ key: '{pasta}', label: 'Pasta permitida', kind: 'dir' }] },
  { name: 'navegador', title: 'Navegador (Playwright)', desc: 'Abre páginas, clica, preenche e lê sites.', tag: 'npx', icon: 'globe',
    config: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] } },
  { name: 'fetch', title: 'Buscar páginas', desc: 'Baixa uma URL e converte em texto para o modelo.', tag: 'uvx', icon: 'download',
    config: { command: 'uvx', args: ['mcp-server-fetch'] } },
  { name: 'memoria', title: 'Memória', desc: 'Grafo de conhecimento persistente entre conversas.', tag: 'npx', icon: 'memory',
    config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] } },
  { name: 'pensamento', title: 'Pensamento sequencial', desc: 'Ajuda o modelo a resolver problemas passo a passo.', tag: 'npx', icon: 'brain',
    config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] } },
  { name: 'git', title: 'Git', desc: 'Status, diff, log e commits de um repositório.', tag: 'uvx', icon: 'git',
    config: { command: 'uvx', args: ['mcp-server-git', '--repository', '{repo}'] }, ask: [{ key: '{repo}', label: 'Pasta do repositório', kind: 'dir' }] },
  { name: 'hora', title: 'Hora e fuso', desc: 'Hora atual e conversão entre fusos horários.', tag: 'uvx', icon: 'clock',
    config: { command: 'uvx', args: ['mcp-server-time', '--local-timezone', 'America/Sao_Paulo'] } },
  { name: 'context7', title: 'Context7', desc: 'Documentação atualizada de bibliotecas e frameworks.', tag: 'remoto', icon: 'book',
    config: { url: 'https://mcp.context7.com/mcp', type: 'http' } },
  { name: 'deepwiki', title: 'DeepWiki', desc: 'Pergunte sobre qualquer repositório público do GitHub.', tag: 'remoto', icon: 'book',
    config: { url: 'https://mcp.deepwiki.com/mcp', type: 'http' } },
  { name: 'github', title: 'GitHub', desc: 'Issues, PRs e código. Pede um token pessoal.', tag: 'remoto', icon: 'git',
    config: { url: 'https://api.githubcopilot.com/mcp/', type: 'http', headers: { Authorization: 'Bearer {token}' } }, ask: [{ key: '{token}', label: 'Token pessoal do GitHub', kind: 'secret' }] },
];

function statusInfo(st) {
  return {
    connected: { dot: 'ok', label: 'conectado' },
    connecting: { dot: 'busy', label: 'conectando...' },
    error: { dot: 'err', label: 'falhou' },
    disconnected: { dot: 'err', label: 'desconectado' },
    disabled: { dot: '', label: 'desligado' },
  }[st] || { dot: '', label: st };
}

let mcpPoll = null;
async function loadMcp() {
  try { S.mcp = (await api('/api/mcp')).servers; } catch { S.mcp = []; }
  updatePickers();
  if ($('#pop-mcp').classList.contains('open')) fillMcpPop();
  if (S.view === 'mcp') drawMcpList();
  clearTimeout(mcpPoll);
  if (S.mcp.some((s) => s.status === 'connecting')) mcpPoll = setTimeout(loadMcp, 1500);
}

function cmdLine(c) {
  if (c.url) return c.url;
  return [c.command, ...(c.args || [])].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
}

function drawMcpList() {
  const list = $('#mcp-list'); list.innerHTML = '';
  if (!S.mcp.length) { list.append(h('div.empty-card', null, 'Nenhum conector ainda. Escolha um da lista acima ou adicione o seu.')); return; }
  for (const s of S.mcp) {
    const st = statusInfo(s.status);
    const sw = h('input', { type: 'checkbox', checked: s.status !== 'disabled' });
    sw.addEventListener('change', async () => { try { S.mcp = (await api('/api/mcp/toggle', { name: s.name, disabled: !sw.checked })).servers; loadMcp(); } catch (e) { toast(e.message, 'err'); } });
    const card = h('div.srv', null,
      h('div.srv-head', null,
        h('div.srv-ico', { html: svg(s.config?.url ? 'globe' : 'terminal') }),
        h('div.srv-main', null,
          h('div.srv-name', null, s.name, h('span.tag', null, s.kind === 'stdio' ? 'local' : s.kind === 'sse' ? 'SSE' : 'HTTP')),
          h('div.srv-cmd', { title: cmdLine(s.config || {}) }, cmdLine(s.config || {}))),
        h('div.srv-status', null, h('span.dot.' + st.dot), s.status === 'connected' ? (s.hidden?.length ? `${s.tools.length - s.tools.filter((t) => s.hidden.includes(t.name)).length} de ${s.tools.length} ferramentas` : `${s.tools.length} ferramentas`) : s.status === 'connecting' && s.since ? `conectando... ${Math.max(0, Math.round((Date.now() - s.since) / 1000))} s` : st.label),
        h('div.srv-actions', null,
          (() => { const on = (S.settings.trustedMcp || []).includes(s.name); return h('button.icon-btn.sm' + (on ? '.on' : ''), { title: on ? 'Confiável: as ferramentas que alteram algo rodam sem pedir confirmação. Clique para voltar a pedir.' : 'Pede confirmação antes das ferramentas que alteram algo. Clique para confiar neste conector.', 'aria-label': 'Confiar no conector', html: svg('shield'), onclick: () => { trustMcp(s.name, !on); drawMcpList(); toast(on ? `${s.name}: volta a pedir confirmação` : `${s.name}: confiável`); } }); })(),
          h('button.icon-btn.sm', { title: 'Reconectar', 'aria-label': 'Reconectar', html: svg('refresh'), onclick: async () => { s.status = 'connecting'; drawMcpList(); try { await api('/api/mcp/reconnect', { name: s.name }); } catch (e) { toast(e.message, 'err'); } loadMcp(); } }),
          h('button.icon-btn.sm', { title: 'Editar', 'aria-label': 'Editar', html: svg('edit'), onclick: () => editServer(s.name, s.config) }),
          h('button.icon-btn.sm', { title: 'Remover', 'aria-label': 'Remover', html: svg('trash'), onclick: async () => {
            if (!(await confirmBox(`Remover o conector "${s.name}"?`, 'Remover', true))) return;
            await api('/api/mcp/delete', { name: s.name }); S.sel.mcp = S.sel.mcp.filter((x) => x !== s.name); saveSel(); loadMcp();
          } })),
        h('label.switch', { title: 'Ligar/desligar' }, sw, h('span'))),
      s.error ? h('div.srv-err', null, s.error.length > 300 ? s.error.slice(0, 300) + '...' : s.error) : null,
      (() => {
        const sel = h('select.select.sm', { title: 'Como as ferramentas deste conector chegam ao modelo' }, MCP_LOAD.map(([v, l]) => h('option', { value: v }, l)));
        sel.value = mcpLoadOf(s.name);
        const hint = h('small.muted', null, MCP_LOAD.find((x) => x[0] === sel.value)[2] + (s.tools.length ? ` (${visibleToolCount(s.name)} visíveis)` : ''));
        sel.addEventListener('change', () => { setMcpLoad(s.name, sel.value); hint.textContent = MCP_LOAD.find((x) => x[0] === sel.value)[2] + (s.tools.length ? ` (${visibleToolCount(s.name)} visíveis)` : ''); toast(`${s.name}: ${MCP_LOAD.find((x) => x[0] === sel.value)[1].toLowerCase()}`); });
        return h('div.srv-load', null, h('span', null, 'Carregar ferramentas'), sel, hint);
      })());
    const keep = (d, key) => { d.open = S.mcpOpen?.has(key) || false; d.addEventListener('toggle', () => { (S.mcpOpen ||= new Set())[d.open ? 'add' : 'delete'](key); }); return d; };
    if (s.tools.length) card.append(keep(toolsBox(s), s.name + ':tools'));
    // log sempre recolhido; só abre se a pessoa clicar
    if (s.log?.trim()) card.append(keep(h('details', null, h('summary', null, ic('chev'), `Log do servidor (${s.log.trim().split('\n').length} linhas)`), h('pre.srv-log', null, s.log.trim().split('\n').slice(-80).join('\n'))), s.name + ':log'));
    list.append(card);
  }
}

/** Lista de ferramentas de um conector com chave para esconder cada uma do modelo. */
function toolsBox(s) {
  const hidden = new Set(s.hidden || []);
  const total = s.tools.length;
  const sumTxt = () => hidden.size ? `Ferramentas (${total - hidden.size} de ${total} visíveis para o modelo)` : `Ferramentas (${total})`;
  const sumLbl = h('span', null, sumTxt());
  let filter = S.mcpFilter?.[s.name] || '';
  let timer = 0;
  const save = () => {
    sumLbl.textContent = sumTxt();
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try { const r = await api('/api/mcp/hide', { name: s.name, hidden: [...hidden] }); S.mcp = r.servers; updatePickers(); if (!document.activeElement?.closest('.st-q')) drawMcpList(); }
      catch (e) { toast(e.message, 'err'); }
    }, 350);
  };
  const list = h('div.srv-tools');
  const matches = (t) => !filter || (t.name + ' ' + (t.description || '')).toLowerCase().includes(filter.toLowerCase());
  const draw = () => {
    list.innerHTML = '';
    const shown = s.tools.filter(matches);
    for (const t of shown) {
      const on = !hidden.has(t.name);
      const i = h('input', { type: 'checkbox', checked: on, onchange: () => { if (i.checked) hidden.delete(t.name); else hidden.add(t.name); row.classList.toggle('off', !i.checked); save(); } });
      const row = h('label.srv-tool.tg' + (on ? '' : '.off'), null,
        h('span.st-main', null, h('b', null, t.name), t.description ? h('div', null, t.description.length > 220 ? t.description.slice(0, 220) + '...' : t.description) : null),
        h('span.switch.sm', null, i, h('span')));
      list.append(row);
    }
    if (!shown.length) list.append(h('div.muted', { style: { padding: '8px 2px', fontSize: '13px' } }, 'Nenhuma ferramenta com esse filtro.'));
    cnt.textContent = filter ? `${shown.length} encontradas` : '';
  };
  const cnt = h('span.muted.st-cnt');
  const q = h('input.input.sm', { value: filter, placeholder: 'Filtrar (ex.: jeb)', oninput: () => { filter = q.value.trim(); (S.mcpFilter ||= {})[s.name] = filter; draw(); } });
  const bulk = (show) => { for (const t of s.tools.filter(matches)) show ? hidden.delete(t.name) : hidden.add(t.name); draw(); save(); };
  const tools = h('div.st-bar', null, h('span.st-q', null, ic('search'), q), cnt, h('span.spacer'),
    h('button.btn.ghost.sm', { onclick: () => bulk(true), title: 'Mostra ao modelo todas as ferramentas da lista (respeita o filtro)' }, 'Mostrar todas'),
    h('button.btn.ghost.sm', { onclick: () => bulk(false), title: 'Esconde do modelo todas as ferramentas da lista (respeita o filtro)' }, 'Esconder todas'));
  draw();
  return h('details', null, h('summary', null, ic('chev'), sumLbl),
    h('div.st-hint', null, 'Ferramentas desligadas não aparecem para o modelo nem no catálogo, e economizam contexto.'), tools, list);
}

async function renderMcpPage() {
  const pre = $('#mcp-presets'); pre.innerHTML = '';
  for (const p of PRESETS) {
    pre.append(h('button.preset', { onclick: () => usePreset(p) },
      h('div.preset-top', null, ic(p.icon), p.title, h('span.tag', null, p.tag)),
      h('span.desc', null, p.desc)));
  }
  drawMcpList();
  loadMcp();
}

async function usePreset(p) {
  const cfg = JSON.parse(JSON.stringify(p.config));
  for (const a of p.ask || []) {
    let v;
    if (a.kind === 'dir') v = await pickPath({ title: a.label, mode: 'dir', start: S.ws.path });
    else v = await promptBox(p.title, a.label, '', 'Continuar');
    if (!v) return;
    const fill = (x) => (typeof x === 'string' ? x.split(a.key).join(v) : x);
    if (cfg.args) cfg.args = cfg.args.map(fill);
    if (cfg.headers) for (const k of Object.keys(cfg.headers)) cfg.headers[k] = fill(cfg.headers[k]);
  }
  let name = p.name; let i = 2;
  while (S.mcp.some((s) => s.name === name)) name = `${p.name}-${i++}`;
  editServer(null, cfg, name);
}

function linesToObj(text, sepRe) {
  const o = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const m = t.match(sepRe); if (!m) continue;
    o[m[1].trim()] = m[2].trim();
  }
  return o;
}

function editServer(oldName, config = {}, suggestedName = '') {
  let kind = config.url ? 'remote' : 'local';
  let tab = 'form';
  const name = h('input.input', { value: oldName || suggestedName, placeholder: 'ex.: navegador' });
  const command = h('input.input.mono', { value: config.command || '', placeholder: 'npx, uvx, python, node, caminho\\do\\programa.exe' });
  const args = h('textarea.textarea.mono', { rows: 4, value: (config.args || []).join('\n'), placeholder: 'Um argumento por linha\n-y\n@pacote/servidor-mcp' });
  const env = h('textarea.textarea.mono', { rows: 3, value: Object.entries(config.env || {}).map(([k, v]) => `${k}=${v}`).join('\n'), placeholder: 'CHAVE=valor (uma por linha)' });
  const cwd = h('input.input.mono', { value: config.cwd || '', placeholder: 'Opcional' });
  const url = h('input.input.mono', { value: config.url || '', placeholder: 'https://exemplo.com/mcp' });
  const transport = h('select.select', null, h('option', { value: '' }, 'Automático (HTTP, depois SSE)'), h('option', { value: 'http' }, 'Streamable HTTP'), h('option', { value: 'sse' }, 'SSE (antigo)'));
  transport.value = (config.type || '').toLowerCase() === 'sse' ? 'sse' : (config.type ? 'http' : '');
  const headers = h('textarea.textarea.mono', { rows: 3, value: Object.entries(config.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n'), placeholder: 'Authorization: Bearer seu-token' });
  const json = h('textarea.textarea.mono', { rows: 14, placeholder: '{\n  "mcpServers": {\n    "meu-servidor": {\n      "command": "npx",\n      "args": ["-y", "pacote"]\n    }\n  }\n}' });
  json.style.minHeight = '300px';

  const localBox = h('div.form', null,
    h('div.field', null, h('label', null, 'Comando'), command),
    h('div.field', null, h('label', null, 'Argumentos'), args),
    h('div.row', null, h('div.field', null, h('label', null, 'Variáveis de ambiente'), env), h('div.field', null, h('label', null, 'Pasta de execução'), cwd)));
  const remoteBox = h('div.form', null,
    h('div.field', null, h('label', null, 'URL'), url),
    h('div.field', null, h('label', null, 'Transporte'), transport),
    h('div.field', null, h('label', null, 'Cabeçalhos'), headers));
  const kindSeg = h('div.seg', null,
    h('button', { type: 'button', onclick: () => { kind = 'local'; sync(); } }, 'Local (comando)'),
    h('button', { type: 'button', onclick: () => { kind = 'remote'; sync(); } }, 'Remoto (URL)'));
  const formBox = h('div.form', null, h('div.field', null, h('label', null, 'Nome'), name), h('div.field', null, h('label', null, 'Tipo'), kindSeg), localBox, remoteBox);
  const jsonBox = h('div.form', null, h('p.muted', { style: { margin: 0, fontSize: '13.5px' } }, 'Cole a configuração de outro app (Claude Desktop, Cherry Studio, Cursor...). Aceita o bloco "mcpServers" inteiro ou só um servidor.'), json);
  const tabs = !oldName ? h('div.seg', { style: { marginBottom: '16px' } },
    h('button', { type: 'button', onclick: () => { tab = 'form'; sync(); } }, 'Formulário'),
    h('button', { type: 'button', onclick: () => { tab = 'json'; sync(); } }, 'Colar JSON')) : null;

  function sync() {
    kindSeg.children[0].classList.toggle('on', kind === 'local');
    kindSeg.children[1].classList.toggle('on', kind === 'remote');
    localBox.style.display = kind === 'local' ? '' : 'none';
    remoteBox.style.display = kind === 'remote' ? '' : 'none';
    if (tabs) { tabs.children[0].classList.toggle('on', tab === 'form'); tabs.children[1].classList.toggle('on', tab === 'json'); }
    formBox.style.display = tab === 'form' ? '' : 'none';
    jsonBox.style.display = tab === 'json' ? '' : 'none';
    saveBtn.textContent = tab === 'json' ? 'Importar' : (oldName ? 'Salvar e reconectar' : 'Adicionar e conectar');
  }

  const saveBtn = h('button.btn.primary', { onclick: async () => {
    saveBtn.disabled = true;
    try {
      if (tab === 'json') {
        const r = await api('/api/mcp/import', { text: json.value });
        S.sel.mcp = [...new Set([...S.sel.mcp, ...r.added])]; saveSel();
        toast(`Adicionado: ${r.added.join(', ')}`);
      } else {
        const n = name.value.trim();
        if (!n) throw new Error('Dê um nome ao servidor.');
        let cfg;
        if (kind === 'local') {
          if (!command.value.trim()) throw new Error('Informe o comando.');
          cfg = { command: command.value.trim(), args: args.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) };
          const e = linesToObj(env.value, /^([^=]+)=(.*)$/); if (Object.keys(e).length) cfg.env = e;
          if (cwd.value.trim()) cfg.cwd = cwd.value.trim();
        } else {
          if (!url.value.trim()) throw new Error('Informe a URL.');
          cfg = { url: url.value.trim() };
          if (transport.value) cfg.type = transport.value;
          const hd = linesToObj(headers.value, /^([^:]+):(.*)$/); if (Object.keys(hd).length) cfg.headers = hd;
        }
        if (config.disabled) cfg.disabled = true;
        if (config.disabledTools?.length) cfg.disabledTools = config.disabledTools;
        toast('Conectando a ' + n + '...');
        m.close();
        const r = await api('/api/mcp/upsert', { name: n, oldName, config: cfg });
        S.mcp = r.servers;
        const st = r.servers.find((s) => s.name === n);
        if (st?.status === 'connected') {
          S.sel.mcp = [...new Set([...S.sel.mcp.filter((x) => x !== oldName), n])]; saveSel();
          toast(`${n}: ${st.tools.length} ferramentas disponíveis`);
        } else if (st?.status === 'error') toast(`${n}: ${st.error}`, 'err');
      }
      m.close();
      loadMcp();
    } catch (e) { toast(e.message, 'err'); } finally { saveBtn.disabled = false; }
  } });

  const m = modal({
    title: oldName ? `Editar ${oldName}` : 'Adicionar conector MCP', wide: true,
    body: [tabs, formBox, jsonBox],
    foot: [h('button.btn', { onclick: () => m.close() }, 'Cancelar'), saveBtn],
  });
  sync();
}

async function editMcpJson() {
  const { text } = await api('/api/mcp/config');
  const ta = h('textarea.textarea.mono', { value: text, rows: 22 });
  ta.style.minHeight = '420px';
  const m = modal({
    title: 'mcp.json', wide: true,
    body: [h('p.muted', { style: { marginTop: 0, fontSize: '13.5px' } }, 'Mesmo formato do Claude Desktop. Use "disabled": true para desligar um servidor sem apagar.'), ta],
    foot: [h('button.btn', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.primary', { onclick: async () => {
      try { await api('/api/mcp/config', { text: ta.value }); m.close(); toast('Configuração salva'); loadMcp(); } catch (e) { toast(e.message, 'err'); }
    } }, 'Salvar e reconectar')],
  });
}

function setupMcpPage() {
  $('#mcp-new').append(ic('plus'), 'Adicionar conector');
  $('#mcp-new').addEventListener('click', () => editServer(null, {}));
  $('#mcp-json').append(ic('braces'), 'Editar JSON');
  $('#mcp-json').addEventListener('click', editMcpJson);
  $('#mcp-reconnect').append(ic('refresh'), 'Reconectar todos');
  $('#mcp-reconnect').addEventListener('click', async () => {
    S.mcp.forEach((s) => { if (s.status !== 'disabled') s.status = 'connecting'; }); drawMcpList();
    try { await api('/api/mcp/reconnect', {}); } catch (e) { toast(e.message, 'err'); }
    loadMcp();
  });
}
