/* llama studio - plugins no formato do Claude Code (skills, comandos /, agentes, ganchos e conectores) */
'use strict';

let PLUG = { plugins: [], markets: [], commands: [], agents: [], events: {} };

const PLUG_SUGGEST = [
  ['anthropics/claude-plugins-official', L('Oficial da Anthropic (centenas de plugins)')],
  ['anthropics/claude-code', L('Exemplos do Claude Code')],
];

async function loadPlugins() {
  try { PLUG = await api('/api/plugins'); } catch { /* sem plugins */ }
  return PLUG;
}
function plugSet(r) { if (r?.plugins) PLUG = r; }
function plugHas(ev) { return !!PLUG.events?.[ev]; }
function plugAsync() { return Object.values(PLUG.events || {}).some((e) => e.async); }

/** Agentes dos plugins ligados viram personalidades (só leitura). */
function plugPersonas() {
  return (PLUG.agents || []).map((a) => ({ id: a.id, name: a.name, color: '#64748b', prompt: a.prompt || '', description: a.description, plugin: a.plugin, readonly: true }));
}
function allPersonas() { return [...S.personas, ...plugPersonas()]; }

/** Roda os ganchos de um evento (só vai ao servidor se algum plugin ligado tiver gancho nele). */
async function plugHook(event, conv, extra = {}) {
  if (!plugHas(event)) return null;
  try {
    const r = await api('/api/plugins/hook', { event, session: conv?.id || '', ws: conv ? wsOf(conv) : '', plan: !!conv?.plan, ...extra });
    for (const m of r.messages || []) toast(m);
    if (r.errors?.length) console.warn('[plugins]', event, r.errors);
    return r;
  } catch (e) { console.warn('[plugins]', event, e); return null; }
}

/** A conversa no formato que os ganchos leem (transcript_path). */
function plugTranscript(conv) {
  return conv.messages
    .filter((m) => (m.role === 'user' && !m.hidden) || m.role === 'assistant')
    .slice(-200)
    .map((m) => ({
      role: m.role,
      content: String(m.role === 'user' ? userContent(m) : splitThink(m.content || '').text).slice(0, 20000),
      tool_calls: (m.tool_calls || []).map((t) => ({ id: t.id, name: t.function?.name, input: parseArgs(t.function?.arguments) || {} })),
    }));
}

/** Notas de ganchos assíncronos que terminaram enquanto o agente seguia. */
async function plugPending(conv) {
  if (!plugAsync()) return [];
  try { return (await api('/api/plugins/pending?session=' + encodeURIComponent(conv.id))).notes || []; } catch { return []; }
}

/** Itens de comando de plugin no menu "/". */
function plugCommandItems(f) {
  return (PLUG.commands || [])
    .filter((c) => !f || promptSlug(c.name).includes(f))
    .map((c) => ({ kind: 'prompt', id: c.name, name: c.name, desc: c.description || '', prompt: { plugin: c } }));
}

/** Comando de barra de um plugin: pede os argumentos, o servidor monta o texto (com os trechos !`cmd`). */
async function usePluginCommand(c) {
  let args = '';
  if (c.args) {
    args = await promptBox('/' + c.name, c.hint || L('Argumentos'), '', L('Usar'));
    if (args === null) return;
  }
  let text;
  try { text = (await api('/api/plugins/command', { id: c.id, args, ws: wsOf(cur()), session: cur()?.id || '' })).text; }
  catch (e) { toast(e.message, 'err'); return; }
  if (!editor().textContent.trim()) setEditorText(text);
  else { focusEditor(true); document.execCommand('insertText', false, text); }
  updateSendBtn();
}

/* ============================================================ página */

function plugChips(p) {
  const n = (a, one, many) => (a?.length ? h('span.tag', null, a.length + ' ' + (a.length === 1 ? one : many)) : null);
  return h('div.plug-chips', null,
    n(p.skills, L('skill'), L('skills')),
    n(p.commands, L('comando'), L('comandos')),
    n(p.agents, L('agente'), L('agentes')),
    n(p.hooks, L('gancho'), L('ganchos')),
    n(p.mcp, L('conector'), L('conectores')),
    p.bin ? h('span.tag', null, 'bin/') : null);
}

/** O que o plugin executa no computador: mostrado antes de ligar. */
function plugRunsList(p) {
  const rows = [];
  for (const k of p.hooks || []) rows.push([k.event + (k.matcher ? ` (${k.matcher})` : ''), k.type === 'command' ? k.command : `${k.type}: ${k.command}`]);
  for (const m of p.mcp || []) if (m.command) rows.push([L('Conector {0}', m.name), [m.command, ...(m.args || [])].join(' ')]);
  if (p.bin) rows.push(['bin/', L('Programas da pasta bin/ entram no PATH dos comandos')]);
  return h('div.plug-runs', null, rows.map(([a, b]) => h('div.plug-run', null, h('b', null, a), h('code', null, b))));
}

async function plugTrust(p) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title: L('Ligar {0}?', p.name), wide: true,
      body: h('div', null,
        h('p', null, L('Este plugin executa comandos no seu computador (ganchos, conectores ou programas). Ligue só se confiar na origem: {0}.', p.market === 'local' ? L('instalado direto') : p.market)),
        plugRunsList(p)),
      foot: [h('button.btn', { onclick: () => m.close() }, L('Deixar desligado')), h('button.btn.primary', { onclick: () => { done = true; m.close(); resolve(true); } }, L('Ligar'))],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

async function plugEnable(p, on) {
  if (on && (p.hooks?.length || p.mcp?.some((m) => m.command) || p.bin) && !(await plugTrust(p))) { renderPluginsPage(); return; }
  try { plugSet(await api('/api/plugins/enable', { id: p.id, on })); toast(on ? L('{0} ligado', p.name) : L('{0} desligado', p.name)); }
  catch (e) { toast(e.message, 'err'); }
  plugAfter();
}

/** Depois de mudar plugins: skills, conectores e a página. */
function plugAfter() {
  loadSkills(); loadMcp(); renderPluginsPage(false);
}

async function plugAfterInstall(r) {
  plugSet(r);
  const res = r.result || {};
  if (res.market) toast(L('Loja {0} adicionada ({1} plugins)', res.market, res.plugins));
  const id = res.installed?.id || res.id;
  const p = PLUG.plugins.find((x) => x.id === id);
  if (p) {
    toast(L('{0} instalado', p.name));
    if ((res.installed || res).needsTrust) await plugEnable(p, true);
  }
  plugAfter();
  if (res.market) plugCatalog(res.market);
}

async function plugAdd(src) {
  src = (src || '').trim();
  if (!src) return;
  const t = toastWait(L('Baixando {0}...', src));
  try { await plugAfterInstall(await api('/api/plugins/add', { source: src })); }
  catch (e) { toast(e.message, 'err'); }
  finally { t(); }
}

/** Aviso que fica na tela enquanto algo demora (devolve a função que fecha). */
function toastWait(msg) {
  const t = h('div.toast', null, h('span.spin', { html: svg('refresh') }), msg);
  $('#toasts').append(t);
  return () => t.remove();
}

async function plugCatalog(name) {
  let data;
  try { data = await api('/api/plugins/catalog?market=' + encodeURIComponent(name)); } catch (e) { toast(e.message, 'err'); return; }
  const q = h('input.input', { placeholder: L('Procurar plugin') });
  const list = h('div.plug-cat');
  const draw = () => {
    list.innerHTML = '';
    const f = q.value.trim().toLowerCase();
    const items = data.plugins.filter((p) => !f || (p.name + ' ' + (p.description || '') + ' ' + (p.category || '') + ' ' + (p.keywords || []).join(' ')).toLowerCase().includes(f));
    if (!items.length) list.append(h('div.muted', null, L('Nada encontrado.')));
    for (const p of items.slice(0, 200)) {
      const btn = h('button.btn.sm' + (p.installed ? '' : '.primary'), {
        onclick: async () => {
          btn.disabled = true; btn.textContent = L('Instalando...');
          try { const r = await api('/api/plugins/install', { market: name, name: p.name }); p.installed = true; await plugAfterInstall(r); }
          catch (e) { toast(e.message, 'err'); }
          draw();
        },
      }, p.installed ? L('Reinstalar') : L('Instalar'));
      list.append(h('div.plug-item', null,
        h('div.plug-item-main', null,
          h('div', null, h('b', null, p.name), p.version ? h('span.muted.small', null, ' ' + p.version) : null, p.category ? h('span.tag', null, p.category) : null, p.installed ? h('span.tag.ok', null, L('instalado')) : null),
          p.description ? h('div.small.muted', null, p.description) : null),
        btn));
    }
    if (items.length > 200) list.append(h('div.muted.small', null, L('Mostrando 200 de {0}. Refine a busca.', items.length)));
  };
  q.addEventListener('input', draw);
  draw();
  const m = modal({ title: L('Loja {0}', name), wide: true, body: h('div.form', null, q, list), foot: [h('button.btn', { onclick: () => m.close() }, L('Fechar'))] });
}

async function renderPluginsPage(reload = true) {
  const root = $('#plugins-root');
  if (!root) return;
  if (reload) await loadPlugins();
  root.innerHTML = '';
  const inp = h('input.input', { placeholder: L('owner/repo, URL git, URL de um marketplace.json ou pasta') });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') plugAdd(inp.value); });
  root.append(
    h('div.plug-add', null, inp, h('button.btn.primary', { onclick: () => plugAdd(inp.value) }, ic('plus'), L('Adicionar'))),
    h('div.plug-sugg', null, h('span.muted.small', null, L('Sugestões:')), PLUG_SUGGEST.filter(([s]) => !PLUG.markets.some((m) => m.source === s)).map(([s, d]) => h('button.chip', { title: d, onclick: () => plugAdd(s) }, s))));

  root.append(h('h2.h-small', null, L('Instalados')));
  if (!PLUG.plugins.length) root.append(h('div.empty-card', null, L('Nenhum plugin ainda. Adicione uma loja (como a oficial da Anthropic) e escolha os plugins, ou instale um direto pelo repositório.')));
  for (const p of PLUG.plugins) {
    const sw = h('input', { type: 'checkbox', checked: p.enabled });
    sw.addEventListener('change', () => plugEnable(p, sw.checked));
    const details = h('details.plug-det', null, h('summary', null, ic('chev'), L('Detalhes')),
      p.commands?.length ? h('div.small', null, h('b', null, L('Comandos: ')), p.commands.map((c) => '/' + c).join(', ')) : null,
      p.skills?.length ? h('div.small', null, h('b', null, L('Skills: ')), p.skills.join(', ')) : null,
      p.agents?.length ? h('div.small', null, h('b', null, L('Agentes (em Personalidades): ')), p.agents.join(', ')) : null,
      (p.hooks?.length || p.mcp?.length || p.bin) ? plugRunsList(p) : null,
      h('div.small.muted', null, p.path));
    root.append(h('div.srv.plug' + (p.enabled ? '' : '.off'), null,
      h('div.srv-head', null,
        h('div.srv-ico', { html: svg('puzzle') }),
        h('div.srv-main', null,
          h('div.srv-name', null, p.name, p.version ? h('span.muted.small', null, ' ' + p.version) : null, h('span.tag', { title: L('Loja') }, p.market)),
          h('div.small.muted', null, p.description || ''),
          plugChips(p)),
        h('div.srv-actions', null,
          p.homepage ? h('button.icon-btn.sm', { title: L('Página do plugin'), 'aria-label': L('Página do plugin'), html: svg('external'), onclick: () => window.open(p.homepage, '_blank') }) : null,
          h('button.icon-btn.sm', { title: L('Atualizar'), 'aria-label': L('Atualizar'), html: svg('refresh'), onclick: async () => {
            const t = toastWait(L('Atualizando {0}...', p.name));
            try { plugSet(await api('/api/plugins/update', { id: p.id })); toast(L('{0} atualizado', p.name)); plugAfter(); } catch (e) { toast(e.message, 'err'); } finally { t(); }
          } }),
          h('button.icon-btn.sm', { title: L('Remover'), 'aria-label': L('Remover'), html: svg('trash'), onclick: async () => {
            if (!(await confirmBox(L('Remover o plugin "{0}"? A pasta e os dados dele serão apagados.', p.name), L('Remover'), true))) return;
            try { plugSet(await api('/api/plugins/uninstall', { id: p.id })); toast(L('Plugin removido')); plugAfter(); } catch (e) { toast(e.message, 'err'); }
          } })),
        h('label.switch', { title: p.enabled ? L('Ligado') : L('Desligado') }, sw, h('span'))),
      p.errors?.length ? h('div.srv-err', null, p.errors.join('\n')) : null,
      details));
  }

  root.append(h('h2.h-small', null, L('Lojas')));
  if (!PLUG.markets.length) root.append(h('div.empty-card', null, L('Nenhuma loja. Uma loja é um repositório com .claude-plugin/marketplace.json.')));
  for (const m of PLUG.markets) {
    root.append(h('div.srv', null,
      h('div.srv-head', null,
        h('div.srv-ico', { html: svg('box') }),
        h('div.srv-main', null,
          h('div.srv-name', null, m.name, m.owner ? h('span.tag', null, m.owner) : null),
          h('div.small.muted', null, m.description || m.source)),
        h('div.srv-actions', null,
          h('button.btn.sm.primary', { onclick: () => plugCatalog(m.name) }, L('Ver plugins')),
          h('button.icon-btn.sm', { title: L('Atualizar a lista'), 'aria-label': L('Atualizar a lista'), html: svg('refresh'), onclick: () => plugAdd(m.source) }),
          h('button.icon-btn.sm', { title: L('Remover loja'), 'aria-label': L('Remover loja'), html: svg('trash'), onclick: async () => {
            if (!(await confirmBox(L('Remover a loja "{0}"? Os plugins instalados dela continuam.', m.name), L('Remover'), true))) return;
            try { plugSet(await api('/api/plugins/market/remove', { name: m.name })); renderPluginsPage(false); } catch (e) { toast(e.message, 'err'); }
          } })))));
  }
  root.append(h('p.small.muted', null, L('Compatível com o formato de plugins do Claude Code: skills/, commands/, agents/, hooks/hooks.json, .mcp.json e bin/. Ganchos rodam no bash (Git Bash no Windows) com CLAUDE_PLUGIN_ROOT, CLAUDE_PLUGIN_DATA e CLAUDE_PROJECT_DIR. Ganchos do tipo prompt/agent e servidores LSP ainda não são suportados.')));
}
