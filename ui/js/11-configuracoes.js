/* llama studio - painel de configurações */
'use strict';

/* ============================================================ configurações */
function renderSettings() {
  const st = S.settings;
  // tudo salva sozinho ao mudar; um aviso discreto confirma
  let saveT = 0;
  const saved = () => { clearTimeout(saveT); saveT = setTimeout(() => toast(L('Salvo')), 250); };
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
  for (const g of ['browser', 'computer', 'read', 'edit', 'write', 'shell', 'code', 'history', 'toolsearch', 'explore', 'todo', 'notebook', 'interface']) (groupsBySec[TOOL_INFO[g].sec] ||= []).push(g);
  const toolGrid = h('div.tgrid', null, Object.values(groupsBySec).flat().map((g) => sw(TOOL_INFO[g].title, TOOL_INFO[g].desc, S.settings.tools[g], (v) => { S.settings.tools[g] = v; store.set('settings', S.settings); saveKit(); updatePickers(); saved(); })));

  section('model', L('Modelo'), 'cpu', L('Como o modelo responde em todas as conversas.'),
    field(L('Prompt de sistema'), input('textarea.textarea', { rows: 5, value: st.systemPrompt, placeholder: L('Ex.: Responda sempre em português do Brasil, de forma direta.') }, (x) => put({ systemPrompt: x.value })), L('Vai antes das informações do espaço de trabalho e das habilidades.')),
    group(L('Amostragem'),
      h('div.row', null,
        field(L('Temperatura'), input('input.input', { value: st.temperature, placeholder: L('padrão do servidor'), inputmode: 'decimal' }, (x) => put({ temperature: x.value.trim() }))),
        field(L('Top P'), input('input.input', { value: st.topP, placeholder: L('padrão do servidor'), inputmode: 'decimal' }, (x) => put({ topP: x.value.trim() }))),
        field(L('Máximo de tokens'), input('input.input', { value: st.maxTokens, placeholder: L('sem limite'), inputmode: 'numeric' }, (x) => put({ maxTokens: x.value.trim() }))))),
    group(L('Economia de tokens'),
      field(L('Raciocínio nas conversas novas'), (() => { const x = h('select.select', null, THINK_OPTS.map(([v, l]) => h('option', { value: v }, l))); x.value = thinkDefault(); x.addEventListener('change', () => { put({ thinkDefault: x.value }); updatePickers(); }); return x; })(), L('Econômico: o modelo pensa no começo de cada pedido e quando algo falha; nos passos seguintes (ler, editar, rodar) age direto. Cada conversa pode mudar pelo botão de raciocínio.')),
      sw(L('Respostas enxutas'), L('Pede ao modelo para ir direto ao ponto, sem repetir o pedido nem resumir no fim o que já está na conversa.'), st.concise !== false, (v) => put({ concise: v }))),
    field(L('Enviar imagens ao modelo'), seg([['auto', L('Automático ({0})', S.vision ? L('tem visão') : L('sem visão'))], ['on', L('Sempre')], ['off', L('Nunca')]], st.vision, (v) => put({ vision: v })), L('Capturas de tela e imagens coladas na mensagem.')));

  section('tools', L('Ferramentas'), 'hammer', L('O que o modelo pode usar. Também dá para ligar e desligar pela barra do chat.'),
    toolGrid,
    group(L('Limites'),
      h('div.row', null,
        field(L('Passos com ferramentas por resposta'), input('input.input', { value: st.maxSteps, inputmode: 'numeric' }, (x) => put({ maxSteps: Number(x.value) || 40 })), L('Limite base. Se a tarefa está avançando (lista de tarefas, arquivos alterados), o studio dá mais passos sozinho, até 3 vezes isso. Repetições sem resultado novo são interrompidas antes.')),
        field(L('Passos de cada subagente'), input('input.input', { value: st.explorerSteps, inputmode: 'numeric' }, (x) => put({ explorerSteps: Number(x.value) || 20 }))))));

  const autoCur = st.autoRoute === false ? 'desligado' : (st.autoLevel || 'equilibrado');
  const autoList = h('div.set-choices', null, AUTO_LEVELS.map(([v, l, d]) => {
    const r = h('input', { type: 'radio', name: 'autoLevel', value: v, checked: v === autoCur });
    r.addEventListener('change', () => put({ autoLevel: v, autoRoute: v !== 'desligado' }));
    return h('label.set-choice', null, r, h('span', null, h('b', null, l), h('small', null, d)));
  }));
  section('auto', L('Recursos automáticos'), 'signpost', L('Pelo pedido, o studio liga sozinho ferramentas, conectores, habilidades e o raciocínio da conversa, sem gastar tokens. Este é o padrão das conversas novas; cada conversa pode mudar pelo botão de placa na barra do chat.'),
    autoList);

  section('safety', L('Segurança'), 'shield', L('Quando o studio pede sua permissão antes de agir.'),
    field(L('Pedir confirmação antes de'), seg([['writes', L('O que altera algo')], ['all', L('Qualquer ferramenta')], ['never', L('Nunca perguntar')]], st.approval, (v) => put({ approval: v })), L('Arquivos, comandos e ações de conectores que alteram algo. Conectores marcados como confiáveis (escudo no cartão do conector) não perguntam.')),
    h('button.btn.sm', { type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => setView('mcp') }, ic('plug'), L('Confiança e carregamento de cada conector')));

  section('auditor', L('Auditor'), 'eye', L('Um subagente que lê cada ação, avalia o risco e aprova sozinho o que é seguro. Funciona até em "Nunca perguntar".'),
    auditorSection());

  section('context', L('Contexto'), 'brain', L('O que o modelo recebe no começo e o que fazer quando a conversa fica longa demais.'),
    group(L('Pré-leitura'),
      sw(L('Pré-leitura da pasta de trabalho'), L('O modelo recebe um mapa curto da pasta (estrutura, tipos de arquivo, README) no começo da conversa, sem gastar chamadas de ferramenta. Montado sem o modelo.'), st.projMap === true, (v) => put({ projMap: v })),
      sw(L('Resumir a pasta com o modelo'), L('Uma vez por pasta, quando o servidor estiver livre, o modelo escreve um resumo de 6 linhas que vai junto com o mapa.'), st.projSummary === true, (v) => put({ projSummary: v }))),
    group(L('Compactação'),
      sw(L('Compactar automaticamente'), L('Resume a conversa quando passar do limite abaixo{0}.', S.nCtx ? L(' (contexto de {0} tokens)', S.nCtx.toLocaleString(LOCALE)) : ''), st.autoCompact, (v) => put({ autoCompact: v })),
      h('div.row', null,
        field(L('Compactar ao chegar em'), (() => { const sl = slider({ min: 30, max: 95, step: 5, fmt: (v) => v + L('% do contexto') }, st.compactAt, { optional: false }); sl.el.addEventListener('change', () => put({ compactAt: Number(sl.get()) })); return sl.el; })()),
        field(L('O que resumir'), (() => { const x = h('select.select', null, h('option', { value: 'meio' }, L('O meio (guarda início e fim)')), h('option', { value: 'inicio' }, L('O começo (guarda só o fim)'))); x.value = st.compactMode || 'meio'; x.addEventListener('change', () => put({ compactMode: x.value })); return x; })()))));

  section('look', L('Aparência e idioma'), 'palette', null,
    field(L('Idioma'), seg([['pt', 'Português (Brasil)'], ['en', 'English']], LANG, (v) => { if (v !== LANG) setLang(v); }), L('Vale para a interface e para o que o modelo recebe (instruções e ferramentas). A tela recarrega.')),
    field(L('Tema'), seg([['auto', L('Automático')], ['dark', L('Escuro')], ['light', L('Claro')]], st.theme, (v) => { put({ theme: v }); applyTheme(); })),
    sw(L('Mostrar o raciocínio do modelo'), L('Os blocos de "pensando" aparecem na conversa, recolhidos.'), st.showThinking, (v) => { put({ showThinking: v }); renderMessages(); }));

  if (S.info.native) section('window', L('Janela'), 'monitor', L('Como a janela do studio usa o sistema.'),
    sw(L('Usar a placa de vídeo para desenhar a janela'), L('Desligado, a janela não ocupa VRAM do modelo. Vale na próxima vez que a janela abrir.'), S.info.windowGpu, async (v) => { await api('/api/config', { windowGpu: v }); S.info.windowGpu = v; saved(); }),
    sw(L('Fechar a janela deixa o studio na bandeja'), L('A janela é destruída e a memória dela volta para o sistema.'), S.info.closeToTray !== false, async (v) => { await api('/api/config', { closeToTray: v }); S.info.closeToTray = v; saved(); }));

  section('api', L('API externa'), 'globe', L('Provedores de IA na internet para tirar trabalho do modelo local, cada função no que você escolher. Auditor e exploradores pela API não ocupam slot do llama-server, então a conversa nunca perde o cache por causa deles. Se a API falhar (sem internet, limite do plano grátis), volta para o modelo local.'), apiSection(put, field, saved));

  section('share', L('Compartilhar'), 'share', L('Exporte suas configurações num arquivo para outra pessoa (ou outro PC) importar. Tokens e chaves dos conectores nunca saem: quem importa preenche os dele.'),
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
      h('button.btn', { type: 'button', onclick: exportDialog }, ic('download'), L('Exportar configurações')),
      h('button.btn', { type: 'button', onclick: () => importDialog() }, ic('folderOpen'), L('Importar um pacote'))));

  section('updates', L('Atualizações'), 'refresh', null, updateSection());

  if (st.advanced) {
    const esc = st.escalate || {};
    const putEsc = (o) => put({ escalate: { ...(S.settings.escalate || {}), ...o } });
    const msel = h('select.select', null, h('option', { value: '' }, L('Escolha o modelo maior')), (S.models.models || []).map((m) => h('option', { value: m.id }, L('{0} · contexto {1}', m.name, fmtK(m.context)))));
    msel.value = esc.model || '';
    msel.addEventListener('change', () => putEsc({ model: msel.value }));
    section('tests', L('Testes'), 'flask', L('Funções em teste. Podem mudar ou sair nas próximas versões.'),
      group(L('Escalar para um modelo maior'),
        sw(L('Escalar quando o modelo travar'), L('Depois de falhas seguidas de ferramenta, ou da mesma chamada falhando de novo, o studio troca o modelo carregado por um maior e ele continua a tarefa de onde parou.'), esc.on === true, (v) => putEsc({ on: v })),
        field(L('Modelo maior'), msel, L('Carregar leva de segundos a minutos, conforme o tamanho. Não escala se outra conversa estiver usando o servidor.')),
        h('div.row', null,
          field(L('Escalar depois de'), seg([['2', L('2 falhas')], ['3', L('3 falhas')], ['4', L('4 falhas')]], String(esc.after || 3), (v) => putEsc({ after: Number(v) }))),
          field(L('Depois da tarefa'), seg([['voltar', L('Volta ao modelo da conversa')], ['ficar', L('Fica no maior')]], esc.then || 'voltar', (v) => putEsc({ then: v })), L('Voltar troca de novo no próximo pedido.')))));
  }

  section('advanced', L('Avançado'), 'sliders', null,
    sw(L('Modo avançado'), L('Mostra a subpágina Testes, com funções experimentais.'), st.advanced === true, (v) => { put({ advanced: v }); renderSettings(); }),
    field(L('Endereço do llama-server'), input('input.input.mono', { value: S.info.llamaUrl || '' }, async (x) => {
      const v = x.value.trim(); if (!v || v === S.info.llamaUrl) return;
      await api('/api/config', { llamaUrl: v }); S.info.llamaUrl = v; checkHealth(); saved();
    }), L('Muda sozinho quando você salva a página Servidor. Ajuste só se o llama-server roda em outro lugar.')),
    toastHistory());

  SET_PAGES = pages;
  let cur0 = setPage && pages.some((p) => p.id === setPage) ? setPage : (store.get('setPage') || 'model');
  setPage = null;
  if (!pages.some((p) => p.id === cur0)) cur0 = 'model';
  showSetPage(cur0);
}

/* As configurações são um painel só: as subpáginas de ajuste e as páginas de recursos (servidor,
   conectores, habilidades...) ficam no mesmo menu. Os itens da barra lateral são atalhos para elas. */
const SET_EMBED = [['server', L('Servidor'), 'server'], ['mcp', L('Conectores'), 'plug'], ['skills', L('Habilidades'), 'sparkles'], ['personas', L('Personalidades'), 'user'], ['tools', L('Utilitários'), 'wrench']];
const SET_GROUPS = [[L('Geral'), ['set:model', 'set:tools', 'set:auto', 'set:context', 'set:api']], [L('Recursos'), ['v:server', 'v:mcp', 'v:skills', 'v:personas', 'v:tools']], [L('Segurança'), ['set:safety', 'set:auditor']], [L('Sistema'), ['set:look', 'set:window', 'set:share', 'set:updates', 'set:advanced', 'set:tests']]];
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

/* ------------------------------------------------------------ API externa */
// Provedores compatíveis com OpenAI com plano grátis; o endereço vem pronto e o modelo sai da lista do provedor
const API_PRESETS = [
  ['groq', 'Groq', 'https://api.groq.com/openai/v1', 'https://console.groq.com/keys'],
  ['gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'https://aistudio.google.com/apikey'],
  ['cerebras', 'Cerebras', 'https://api.cerebras.ai/v1', 'https://cloud.cerebras.ai'],
  ['openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 'https://openrouter.ai/keys'],
  ['nvidia', 'NVIDIA NIM', 'https://integrate.api.nvidia.com/v1', 'https://build.nvidia.com/settings/api-keys'],
  ['custom', L('Outro (compatível com OpenAI)'), '', ''],
];
const API_ROLES = [
  ['auditor', L('Auditor'), L('Manda o seu pedido, o que o agente disse e os argumentos da ação (comandos, caminhos).')],
  ['explorer', L('Subagentes exploradores'), L('Manda a tarefa e o que eles leem: trechos de arquivos e páginas.')],
  ['background', L('Tarefas de fundo'), L('Resumo do mapa da pasta, regras aprendidas, habilidades geradas, regras de arrumar pastas e temas de posts.')],
  ['compact', L('Resumo da compactação'), L('Manda a conversa inteira para resumir. Rápido, mas é o que mais expõe e mais gasta.')],
];
const presetOf = (base) => API_PRESETS.find((p) => p[2] && base && base.replace(/\/+$/, '') === p[2]);
const apiLabel = (a) => a.name || presetOf(a.base)?.[1] || a.base || L('API');

function apiSection(put, field, saved) {
  const box = h('div');
  const save = async (patch) => {
    try { await api('/api/config', patch); S.info = await api('/api/state'); saved(); draw(); } catch (e) { toast(e.message, 'err'); }
  };
  const card = (a) => {
    const pre = presetOf(a.base);
    const key = h('input.input.mono', { type: 'password', autocomplete: 'off', placeholder: a.hasKey ? L('Chave salva (digite para trocar)') : L('Cole a chave da API') });
    key.addEventListener('change', () => { if (key.value.trim()) save({ apiProvider: { id: a.id, key: key.value.trim() } }); });
    const base = h('input.input.mono', { value: a.base || '', placeholder: 'https://.../v1' });
    base.addEventListener('change', () => save({ apiProvider: { id: a.id, base: base.value.trim() } }));
    const dl = h('datalist', { id: 'api-models-' + a.id });
    const model = h('input.input.mono', { value: a.model || '', placeholder: L('ex.: o id do modelo'), list: 'api-models-' + a.id });
    model.addEventListener('change', () => save({ apiProvider: { id: a.id, model: model.value.trim() } }));
    const listBtn = h('button.btn.sm', { type: 'button', onclick: async () => {
      listBtn.disabled = true;
      try { const r = await api('/api/remote/models?p=' + encodeURIComponent(a.id)); dl.innerHTML = ''; r.models.forEach((m) => dl.append(h('option', { value: m }))); toast(L('{0} modelos', r.models.length)); model.focus(); }
      catch (e) { toast(e.message, 'err'); }
      listBtn.disabled = false;
    } }, ic('list'), L('Listar modelos'));
    // teste em stream: mostra o tempo correndo, quando chega o primeiro sinal (o modelo pode pensar antes)
    // e para assim que vem a resposta, sem esperar o provedor terminar
    const testOut = h('div.api-test', { hidden: true });
    const test = h('button.btn.sm', { type: 'button', disabled: !a.ready, onclick: async () => {
      test.disabled = true; testOut.hidden = false; testOut.className = 'api-test';
      const t0 = performance.now(); let first = 0, mine = false;
      const m = { content: '', reasoning: '', tool_calls: [] };
      const ac = new AbortController();
      const show = () => {
        const s = ((performance.now() - t0) / 1000).toFixed(1);
        testOut.textContent = !first ? L('Esperando o primeiro sinal... {0} s', s)
          : m.content ? L('Respondeu: "{0}" · primeiro sinal em {1} s · total {2} s', m.content.trim().slice(0, 40), (first / 1000).toFixed(1), s)
          : L('Pensando ({0} caracteres de raciocínio) · primeiro sinal em {1} s · {2} s', m.reasoning.length, (first / 1000).toFixed(1), s);
      };
      const tick = setInterval(show, 250); show();
      const onDelta = () => {
        if (!first && (m.content || m.reasoning)) first = performance.now() - t0;
        if (m.content.trim().length >= 2) { mine = true; ac.abort(); }
      };
      try {
        await streamApi([{ role: 'user', content: L('Responda só: ok') }], [], m, ac.signal, onDelta, { _p: a.id, max_tokens: 300, temperature: 0, _timeout: 45000 });
        show();
      } catch (e) {
        if (mine) show();
        else { testOut.textContent = e.message; testOut.classList.add('err'); }
      }
      clearInterval(tick);
      test.disabled = false;
    } }, ic('zap'), L('Testar'));
    const del = h('button.icon-btn.sm', { type: 'button', title: L('Remover'), 'aria-label': L('Remover'), html: svg('trash'), onclick: async () => {
      if (!(await confirmBox(L('Remover a API {0}? As funções que usam ela voltam para o modelo local.', apiLabel(a)), L('Remover'), true))) return;
      const roles = { ...(S.settings.apiRoles || {}) }; for (const k in roles) if (roles[k] === a.id) roles[k] = '';
      put({ apiRoles: roles }); save({ apiProviderDelete: a.id });
    } });
    // parâmetros deste provedor: vão em todo pedido e ganham dos do studio (temperatura 0 do auditor etc.)
    const prm = { ...(a.params || {}) };
    const num = (k, ph, step) => {
      const i = h('input.input.mono', { type: 'number', step, value: prm[k] ?? '', placeholder: ph });
      i.addEventListener('change', () => { const v = i.value.trim(); if (v === '') delete prm[k]; else prm[k] = Number(v); saveParams(); });
      return i;
    };
    const known = ['temperature', 'top_p', 'max_tokens'];
    const others = Object.fromEntries(Object.entries(prm).filter(([k]) => !known.includes(k)));
    const extra = h('textarea.input.mono', { rows: 3, spellcheck: false, placeholder: '{"reasoning_effort": "low"}' }, Object.keys(others).length ? JSON.stringify(others, null, 2) : '');
    extra.addEventListener('change', () => {
      let o = {};
      if (extra.value.trim()) { try { o = JSON.parse(extra.value); if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error(); } catch { toast(L('Os outros parâmetros precisam ser um objeto JSON.'), 'err'); return; } }
      for (const k of Object.keys(prm)) if (!known.includes(k)) delete prm[k];
      Object.assign(prm, o); saveParams();
    });
    const saveParams = () => save({ apiProvider: { id: a.id, params: prm } });
    const nParams = Object.keys(prm).length;
    const params = h('details.api-params', nParams ? { open: true } : null,
      h('summary', null, L('Parâmetros') + (nParams ? ` (${nParams})` : '')),
      h('div.api-params-row', null,
        field(L('Temperatura'), num('temperature', L('do studio'), '0.05')),
        field(L('Top P'), num('top_p', L('do studio'), '0.01')),
        field(L('Máx. de tokens'), num('max_tokens', L('do studio'), '1'))),
      field(L('Outros parâmetros (JSON)'), extra, L('Vão em todo pedido para esta API, por cima dos do studio. Ex.: reasoning_effort, chat_template_kwargs, top_k. Vazio = o studio decide (o auditor usa temperatura 0, por exemplo).')));
    const u = apiUse(null, a.id);
    return h('div.api-card', null,
      h('div.api-head', null, h('b', null, apiLabel(a)), a.ready ? h('span.tag.ok', null, L('pronta')) : h('span.tag.off', null, L('incompleta')),
        h('span.spacer'), pre?.[3] ? h('a.bin-link', { href: pre[3], target: '_blank', rel: 'noopener' }, ic('external'), L('Pegar uma chave grátis')) : null, del),
      pre ? null : field(L('Endereço'), base, L('O que vem antes de /chat/completions.')),
      field(L('Chave'), key),
      field(L('Modelo'), h('div.row', null, model, dl, listBtn, test)),
      testOut,
      params,
      h('small.muted', null, L('Hoje: {0} pedidos, {1} tokens, {2} falhas (voltaram para o modelo local).', u.calls, u.tokens.toLocaleString(LOCALE), u.fails)));
  };
  const draw = () => {
    box.innerHTML = '';
    const apis = S.info.apis || [];
    const add = h('select.select', null, h('option', { value: '' }, L('Adicionar uma API...')), API_PRESETS.map(([id, name]) => h('option', { value: id }, name)));
    add.addEventListener('change', () => {
      const p = API_PRESETS.find((x) => x[0] === add.value); if (!p) return;
      let n = 1; while (apis.some((a) => a.id === 'p' + n)) n++;
      save({ apiProvider: { id: 'p' + n, base: p[2], name: p[0] === 'custom' ? '' : '' } });
    });
    // por função: modelo local ou uma das APIs (só as prontas)
    const roles = S.settings.apiRoles || {};
    const ready = apis.filter((a) => a.ready);
    const roleRows = API_ROLES.map(([id, title, desc]) => {
      const cur0 = roles[id] === true ? ready[0]?.id || '' : roles[id] || '';
      const sel = h('select.select', null, h('option', { value: '' }, L('Modelo local')), ready.map((a) => h('option', { value: a.id }, `${apiLabel(a)} · ${a.model}`)));
      sel.value = ready.some((a) => a.id === cur0) ? cur0 : '';
      sel.addEventListener('change', () => put({ apiRoles: { ...(S.settings.apiRoles || {}), [id]: sel.value } }));
      return h('div.api-role', null, h('div.api-role-main', null, h('b', null, title), h('small.muted', null, desc)), sel);
    });
    box.append(
      ...apis.map(card),
      field(apis.length ? L('Outra API') : L('Provedor'), add, apis.length ? L('Dá para ter várias e mandar cada função para uma, espalhando os limites dos planos grátis.') : null),
      h('div.field', null, h('label', null, L('Quem faz cada função')), ...roleRows,
        h('small', null, L('Planos grátis costumam poder usar o que você manda para treinar modelos (o Gemini grátis avisa isso). Deixe no modelo local o que tiver dado sensível.'))));
  };
  draw();
  return box;
}

/* ------------------------------------------------------------ avisos recentes */
function toastHistory() {
  const box = h('div.field');
  const draw = () => {
    const errsOnly = box.querySelector('input')?.checked ?? true;
    const log = toastLog().filter((x) => !errsOnly || x.kind === 'err').reverse();
    box.innerHTML = '';
    const only = h('input', { type: 'checkbox', checked: errsOnly, onchange: draw });
    const copy = h('button.btn.sm', { type: 'button', onclick: () => { navigator.clipboard?.writeText(log.map((x) => `${new Date(x.t).toLocaleString(LOCALE)} [${x.kind || 'ok'}] ${x.msg}${x.from ? '  (' + x.from + ')' : ''}`).join('\n')); toast(L('Copiado')); } }, ic('copy'), L('Copiar'));
    const clear = h('button.btn.sm', { type: 'button', onclick: () => { try { localStorage.removeItem(TOAST_LOG_KEY); } catch {} draw(); } }, ic('trash'), L('Limpar'));
    box.append(h('label', null, L('Avisos recentes')),
      h('div.row', null, h('label.chk', null, only, L('Só erros')), h('span.spacer'), copy, clear),
      log.length ? h('div.toast-log', null, log.slice(0, 40).map((x) => h('div.toast-log-item' + (x.kind === 'err' ? '.err' : ''), null,
        h('span.tl-time', null, new Date(x.t).toLocaleTimeString(LOCALE)), h('span.tl-msg', null, x.msg), x.from ? h('span.tl-from', null, x.from) : null)))
        : h('small.muted', null, L('Nenhum aviso guardado.')),
      h('small', null, L('Os últimos 60 avisos que apareceram no canto da tela, com a parte do studio que mostrou cada um.')));
  };
  draw();
  return box;
}
