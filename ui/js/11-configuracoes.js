/* llama studio - painel de configurações */
'use strict';

/* ============================================================ configurações */
function renderSettings() {
  const st = S.settings;
  // tudo salva sozinho ao mudar; um aviso discreto confirma
  let saveT = 0;
  const saved = () => { clearTimeout(saveT); saveT = setTimeout(() => toast('Salvo'), 250); };
  const put = (patch) => { Object.assign(S.settings, patch); store.set('settings', S.settings); saved(); };
  const input = (cls, attrs, onSave) => { const x = h(cls, attrs); x.addEventListener('change', () => onSave(x)); return x; };
  const seg = (opts, cur0, set) => {
    let cur1 = cur0;
    const el = h('div.seg', null, opts.map(([v, l]) => h('button', { type: 'button', class: cur1 === v ? 'on' : '', onclick: () => { cur1 = v; set(v); $$('button', el).forEach((b, i) => b.classList.toggle('on', opts[i][0] === v)); } }, l)));
    return el;
  };
  const sw = (title, desc, checked, onChange) => {
    const i = h('input', { type: 'checkbox', checked: !!checked });
    i.addEventListener('change', () => onChange(i.checked));
    return h('label.tcard', null, h('span.tc-main', null, h('span.tc-title', null, title), desc ? h('span.tc-desc', { title: desc }, desc) : null), h('span.switch', null, i, h('span')));
  };
  const field = (label, ctl, hint) => h('div.field', null, h('label', null, label), ctl, hint ? h('small', null, hint) : null);
  // cada seção é uma subpágina: o menu à esquerda troca qual aparece
  const pages = [];
  const section = (id, title, icon, desc, ...body) => { pages.push({ id, title, icon, desc, body: body.flat().filter(Boolean) }); };
  const group = (title, ...body) => h('div.set-group', null, h('div.set-group-title', null, title), ...body.flat().filter(Boolean));

  // ferramentas
  const groupsBySec = {};
  for (const g of ['browser', 'computer', 'read', 'edit', 'write', 'shell', 'code', 'history', 'toolsearch', 'explore', 'todo', 'notebook']) (groupsBySec[TOOL_INFO[g].sec] ||= []).push(g);
  const toolGrid = h('div.tgrid', null, Object.values(groupsBySec).flat().map((g) => sw(TOOL_INFO[g].title, TOOL_INFO[g].desc, S.settings.tools[g], (v) => { S.settings.tools[g] = v; store.set('settings', S.settings); saveKit(); updatePickers(); saved(); })));

  section('model', 'Modelo', 'cpu', 'Como o modelo responde em todas as conversas.',
    field('Prompt de sistema', input('textarea.textarea', { rows: 5, value: st.systemPrompt, placeholder: 'Ex.: Responda sempre em português do Brasil, de forma direta.' }, (x) => put({ systemPrompt: x.value })), 'Vai antes das informações do espaço de trabalho e das habilidades.'),
    group('Amostragem',
      h('div.row', null,
        field('Temperatura', input('input.input', { value: st.temperature, placeholder: 'padrão do servidor', inputmode: 'decimal' }, (x) => put({ temperature: x.value.trim() }))),
        field('Top P', input('input.input', { value: st.topP, placeholder: 'padrão do servidor', inputmode: 'decimal' }, (x) => put({ topP: x.value.trim() }))),
        field('Máximo de tokens', input('input.input', { value: st.maxTokens, placeholder: 'sem limite', inputmode: 'numeric' }, (x) => put({ maxTokens: x.value.trim() }))))),
    field('Enviar imagens ao modelo', seg([['auto', `Automático (${S.vision ? 'tem visão' : 'sem visão'})`], ['on', 'Sempre'], ['off', 'Nunca']], st.vision, (v) => put({ vision: v })), 'Capturas de tela e imagens coladas na mensagem.'));

  section('tools', 'Ferramentas', 'hammer', 'O que o modelo pode usar. Também dá para ligar e desligar pela barra do chat.',
    toolGrid,
    group('Limites',
      h('div.row', null,
        field('Passos com ferramentas por resposta', input('input.input', { value: st.maxSteps, inputmode: 'numeric' }, (x) => put({ maxSteps: Number(x.value) || 30 })), 'O modelo para depois disso e pede para continuar.'),
        field('Passos de cada subagente', input('input.input', { value: st.explorerSteps, inputmode: 'numeric' }, (x) => put({ explorerSteps: Number(x.value) || 20 }))))));

  const autoCur = st.autoRoute === false ? 'desligado' : (st.autoLevel || 'equilibrado');
  const autoList = h('div.set-choices', null, AUTO_LEVELS.map(([v, l, d]) => {
    const r = h('input', { type: 'radio', name: 'autoLevel', value: v, checked: v === autoCur });
    r.addEventListener('change', () => put({ autoLevel: v, autoRoute: v !== 'desligado' }));
    return h('label.set-choice', null, r, h('span', null, h('b', null, l), h('small', null, d)));
  }));
  section('auto', 'Recursos automáticos', 'signpost', 'Pelo pedido, o studio liga sozinho ferramentas, conectores, habilidades e o raciocínio da conversa, sem gastar tokens. Este é o padrão das conversas novas; cada conversa pode mudar pelo botão de placa na barra do chat.',
    autoList);

  section('safety', 'Segurança', 'shield', 'Quando o studio pede sua permissão antes de agir.',
    field('Pedir confirmação antes de', seg([['writes', 'O que altera algo'], ['all', 'Qualquer ferramenta'], ['never', 'Nunca perguntar']], st.approval, (v) => put({ approval: v })), 'Arquivos, comandos e ações de conectores que alteram algo. Conectores marcados como confiáveis (escudo no cartão do conector) não perguntam.'),
    h('button.btn.sm', { type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => setView('mcp') }, ic('plug'), 'Confiança e carregamento de cada conector'));

  section('auditor', 'Auditor', 'eye', 'Um subagente que lê cada ação, avalia o risco e aprova sozinho o que é seguro. Funciona até em "Nunca perguntar".',
    auditorSection());

  section('context', 'Contexto', 'brain', 'O que o modelo recebe no começo e o que fazer quando a conversa fica longa demais.',
    group('Pré-leitura',
      sw('Pré-leitura da pasta de trabalho', 'O modelo recebe um mapa curto da pasta (estrutura, tipos de arquivo, README) no começo da conversa, sem gastar chamadas de ferramenta. Montado sem o modelo.', st.projMap === true, (v) => put({ projMap: v })),
      sw('Resumir a pasta com o modelo', 'Uma vez por pasta, quando o servidor estiver livre, o modelo escreve um resumo de 6 linhas que vai junto com o mapa.', st.projSummary === true, (v) => put({ projSummary: v }))),
    group('Compactação',
      sw('Compactar automaticamente', `Resume a conversa quando passar do limite abaixo${S.nCtx ? ` (contexto de ${S.nCtx.toLocaleString('pt-BR')} tokens)` : ''}.`, st.autoCompact, (v) => put({ autoCompact: v })),
      h('div.row', null,
        field('Compactar ao chegar em', (() => { const sl = slider({ min: 30, max: 95, step: 5, fmt: (v) => v + '% do contexto' }, st.compactAt, { optional: false }); sl.el.addEventListener('change', () => put({ compactAt: Number(sl.get()) })); return sl.el; })()),
        field('O que resumir', (() => { const x = h('select.select', null, h('option', { value: 'meio' }, 'O meio (guarda início e fim)'), h('option', { value: 'inicio' }, 'O começo (guarda só o fim)')); x.value = st.compactMode || 'meio'; x.addEventListener('change', () => put({ compactMode: x.value })); return x; })()))));

  section('look', 'Aparência', 'palette', null,
    field('Tema', seg([['auto', 'Automático'], ['dark', 'Escuro'], ['light', 'Claro']], st.theme, (v) => { put({ theme: v }); applyTheme(); })),
    sw('Mostrar o raciocínio do modelo', 'Os blocos de "pensando" aparecem na conversa, recolhidos.', st.showThinking, (v) => { put({ showThinking: v }); renderMessages(); }));

  if (S.info.native) section('window', 'Janela', 'monitor', 'Como a janela do studio usa o sistema.',
    sw('Usar a placa de vídeo para desenhar a janela', 'Desligado, a janela não ocupa VRAM do modelo. Vale na próxima vez que a janela abrir.', S.info.windowGpu, async (v) => { await api('/api/config', { windowGpu: v }); S.info.windowGpu = v; saved(); }),
    sw('Fechar a janela deixa o studio na bandeja', 'A janela é destruída e a memória dela volta para o sistema.', S.info.closeToTray !== false, async (v) => { await api('/api/config', { closeToTray: v }); S.info.closeToTray = v; saved(); }));

  section('share', 'Compartilhar', 'share', 'Exporte suas configurações num arquivo para outra pessoa (ou outro PC) importar. Tokens e chaves dos conectores nunca saem: quem importa preenche os dele.',
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
      h('button.btn', { type: 'button', onclick: exportDialog }, ic('download'), 'Exportar configurações'),
      h('button.btn', { type: 'button', onclick: () => importDialog() }, ic('folderOpen'), 'Importar um pacote')));

  section('updates', 'Atualizações', 'refresh', null, updateSection());

  if (st.advanced) {
    const esc = st.escalate || {};
    const putEsc = (o) => put({ escalate: { ...(S.settings.escalate || {}), ...o } });
    const msel = h('select.select', null, h('option', { value: '' }, 'Escolha o modelo maior'), (S.models.models || []).map((m) => h('option', { value: m.id }, `${m.name} · contexto ${fmtK(m.context)}`)));
    msel.value = esc.model || '';
    msel.addEventListener('change', () => putEsc({ model: msel.value }));
    section('tests', 'Testes', 'flask', 'Funções em teste. Podem mudar ou sair nas próximas versões.',
      group('Escalar para um modelo maior',
        sw('Escalar quando o modelo travar', 'Depois de falhas seguidas de ferramenta, ou da mesma chamada falhando de novo, o studio troca o modelo carregado por um maior e ele continua a tarefa de onde parou.', esc.on === true, (v) => putEsc({ on: v })),
        field('Modelo maior', msel, 'Carregar leva de segundos a minutos, conforme o tamanho. Não escala se outra conversa estiver usando o servidor.'),
        h('div.row', null,
          field('Escalar depois de', seg([['2', '2 falhas'], ['3', '3 falhas'], ['4', '4 falhas']], String(esc.after || 3), (v) => putEsc({ after: Number(v) }))),
          field('Depois da tarefa', seg([['voltar', 'Volta ao modelo da conversa'], ['ficar', 'Fica no maior']], esc.then || 'voltar', (v) => putEsc({ then: v })), 'Voltar troca de novo no próximo pedido.'))));
  }

  section('advanced', 'Avançado', 'sliders', null,
    sw('Modo avançado', 'Mostra a subpágina Testes, com funções experimentais.', st.advanced === true, (v) => { put({ advanced: v }); renderSettings(); }),
    field('Endereço do llama-server', input('input.input.mono', { value: S.info.llamaUrl || '' }, async (x) => {
      const v = x.value.trim(); if (!v || v === S.info.llamaUrl) return;
      await api('/api/config', { llamaUrl: v }); S.info.llamaUrl = v; checkHealth(); saved();
    }), 'Muda sozinho quando você salva a página Servidor. Ajuste só se o llama-server roda em outro lugar.'));

  SET_PAGES = pages;
  let cur0 = setPage && pages.some((p) => p.id === setPage) ? setPage : (store.get('setPage') || 'model');
  setPage = null;
  if (!pages.some((p) => p.id === cur0)) cur0 = 'model';
  showSetPage(cur0);
}

/* As configurações são um painel só: as subpáginas de ajuste e as páginas de recursos (servidor,
   conectores, habilidades...) ficam no mesmo menu. Os itens da barra lateral são atalhos para elas. */
const SET_EMBED = [['server', 'Servidor', 'server'], ['mcp', 'Conectores', 'plug'], ['skills', 'Habilidades', 'sparkles'], ['personas', 'Personalidades', 'user'], ['tools', 'Utilitários', 'wrench']];
const SET_GROUPS = [['Geral', ['set:model', 'set:tools', 'set:auto', 'set:context']], ['Recursos', ['v:server', 'v:mcp', 'v:skills', 'v:personas', 'v:tools']], ['Segurança', ['set:safety', 'set:auditor']], ['Sistema', ['set:look', 'set:window', 'set:share', 'set:updates', 'set:advanced', 'set:tests']]];
let SET_PAGES = [];
let setPage = null;
function openSettings(page) { setPage = page; setView('settings'); }
function showSetPage(id) {
  const p = SET_PAGES.find((x) => x.id === id); if (!p) return;
  store.set('setPage', id);
  const f = $('#settings-form'); f.innerHTML = '';
  f.append(h('section.set-sec', { id: 'set-' + id }, h('h2.set-title', null, p.title), p.desc ? h('p.set-desc', null, p.desc) : null, ...p.body));
  $('#set-pane').scrollTop = 0;
  drawSetNav('set:' + id);
}
function drawSetNav(active) {
  const nav = $('#set-nav'); nav.innerHTML = '';
  for (const [title, keys] of SET_GROUPS) {
    const items = keys.map((key) => {
      const [kind, id] = key.split(':');
      if (kind === 'v') { const [, t, icon] = SET_EMBED.find(([v]) => v === id); return { key, t, icon, go: () => setView(id) }; }
      const p = SET_PAGES.find((x) => x.id === id);
      return p && { key, t: p.title, icon: p.icon, go: () => { if (S.view !== 'settings') openSettings(id); else showSetPage(id); } };
    }).filter(Boolean);
    if (!items.length) continue;
    nav.append(h('div.set-nav-group', null, title));
    for (const it of items) nav.append(h('button', { type: 'button', class: it.key === active ? 'on' : '', dataset: { id: it.key }, onclick: it.go }, ic(it.icon), h('span', null, it.t)));
  }
  $('button.on', nav)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
