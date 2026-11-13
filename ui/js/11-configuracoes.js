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
    sw(L('Comparar respostas de vez em quando'), L('Com outra API pronta, 1 em cada ~15 respostas sem ferramentas também é gerada por ela e você escolhe a melhor (no máximo uma vez a cada 10 minutos). O placar fica no menu da conversa.'), st.abAuto !== false, (v) => put({ abAuto: v })),
    field(L('Enviar imagens ao modelo'), seg([['auto', L('Automático ({0})', S.vision ? L('tem visão') : L('sem visão'))], ['on', L('Sempre')], ['off', L('Nunca')]], st.vision, (v) => put({ vision: v })), L('Capturas de tela e imagens coladas na mensagem.')));

  section('tools', L('Ferramentas'), 'hammer', L('O que o modelo pode usar. Também dá para ligar e desligar pela barra do chat.'),
    toolGrid,
    group(L('Limites'),
      h('div.row', null,
        field(L('Passos com ferramentas por resposta'), input('input.input', { value: st.maxSteps, inputmode: 'numeric' }, (x) => put({ maxSteps: Number(x.value) || 40 })), L('Limite base. Se a tarefa está avançando (lista de tarefas, arquivos alterados), o studio dá mais passos sozinho, até 3 vezes isso. Repetições sem resultado novo são interrompidas antes.')),
        field(L('Passos de cada subagente'), input('input.input', { value: st.explorerSteps, inputmode: 'numeric' }, (x) => put({ explorerSteps: Number(x.value) || 20 })))),
      h('div.row', null,
        field(L('Exploradores em paralelo'), input('input.input', { value: st.maxConcurrentExplorers ?? '', placeholder: '3', inputmode: 'numeric' }, (x) => put({ maxConcurrentExplorers: Number(x.value) || 0 })))),
      sw(L('Subagentes podem escrever'), L('O modelo pode dar a um subagente arquivos ou pastas para criar e editar (só eles; dois subagentes não dividem arquivo). Cada alteração passa pelo auditor e pelas suas permissões, com ponto de restauração. Desligado, os subagentes só leem.'), st.subWrite !== false, (v) => put({ subWrite: v }))));

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

  const sb = h('div.backup-box', null, h('div.muted', null, L('Carregando...')));
  drawSandbox(sb);
  section('sandbox', L('Isolamento'), 'box', L('Opcional: os comandos dos agentes rodam num Linux próprio de cada pasta de trabalho (WSL2), que só enxerga essa pasta. O resto do disco e os programas do Windows ficam de fora. Os comandos comuns já vêm instalados, e o que faltar o agente baixa com apk add.'), sb);

  const bk = h('div.backup-box', null, h('div.muted', null, L('Carregando...')));
  drawBackup(bk);
  section('backup', L('Backup'), 'archive', L('Uma cópia das conversas, personalidades, projetos, prompts, configurações, habilidades e conectores numa pasta. Use a pasta do Google Drive para computador e ela vai para a nuvem sozinha.'), bk);

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
const SET_GROUPS = [[L('Geral'), ['set:model', 'set:tools', 'set:auto', 'set:context', 'set:api']], [L('Recursos'), ['v:server', 'v:mcp', 'v:skills', 'v:personas', 'v:tools']], [L('Segurança'), ['set:safety', 'set:auditor', 'set:sandbox']], [L('Sistema'), ['set:look', 'set:window', 'set:backup', 'set:share', 'set:updates', 'set:advanced', 'set:tests']]];
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
  ['cloudflare', 'Cloudflare Workers AI', 'https://api.cloudflare.com/client/v4/accounts/ID_DA_CONTA/ai/v1', 'https://dash.cloudflare.com/profile/api-tokens'],
  ['custom', L('Outro (compatível com OpenAI)'), '', ''],
];
const API_ROLES = [
  ['auditor', L('Auditor'), L('Manda o seu pedido, o que o agente disse e os argumentos da ação (comandos, caminhos).')],
  ['explorer', L('Subagentes exploradores'), L('Manda a tarefa e o que eles leem: trechos de arquivos e páginas.')],
  ['background', L('Tarefas de fundo'), L('Resumo do mapa da pasta, regras aprendidas, habilidades geradas, regras de arrumar pastas e temas de posts.')],
  ['compact', L('Resumo da compactação'), L('Manda a conversa inteira para resumir. Rápido, mas é o que mais expõe e mais gasta.')],
];
/** Cartões de API abertos (o resto fica numa linha só). */
const API_OPEN = new Set(store.get('apiOpen', []));
const API_ROLE_SHORT = { auditor: L('Auditor'), explorer: L('Exploradores'), background: L('Fundo'), compact: L('Resumo') };
/** Cloudflare: o endereço leva o ID da conta (https://api.cloudflare.com/client/v4/accounts/<ID>/ai/v1). */
const CF_RE = /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/([^/]*)\/ai\/v1\/?$/;
const CF_MODELS = ['@cf/moonshotai/kimi-k2.6', '@cf/zai-org/glm-4.7-flash', '@cf/meta/llama-3.1-8b-instruct'];
const presetOf = (base) => CF_RE.test(base || '') ? API_PRESETS.find((p) => p[0] === 'cloudflare') : API_PRESETS.find((p) => p[2] && base && base.replace(/\/+$/, '') === p[2]);
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
    const nome = h('input.input', { value: a.name || '', placeholder: L('ex.: Groq rápido') });
    nome.addEventListener('change', () => save({ apiProvider: { id: a.id, name: nome.value.trim() } }));
    const dl = h('datalist', { id: 'api-models-' + a.id });
    const model = h('input.input.mono', { value: a.model || '', placeholder: L('ex.: o id do modelo'), list: 'api-models-' + a.id });
    model.addEventListener('change', () => save({ apiProvider: { id: a.id, model: model.value.trim() } }));
    const fallbackModel = h('input.input.mono', { value: a.fallbackModel || '', placeholder: L('ex.: modelo reserva se o principal falhar'), list: 'api-models-' + a.id });
    fallbackModel.addEventListener('change', () => save({ apiProvider: { id: a.id, fallbackModel: fallbackModel.value.trim() } }));
    const retries = h('input.input.mono', { type: 'number', min: '0', max: '10', value: a.retries != null ? a.retries : '', placeholder: L('1 (padrão)') });
    const ctxIn = h('input.input.mono', { type: 'number', min: '1024', step: '1024', value: a.contextSet ? a.context : '', placeholder: L('131072 (padrão)') });
    ctxIn.addEventListener('change', () => { const n = parseInt(ctxIn.value, 10); save({ apiProvider: { id: a.id, context: n >= 1024 ? n : 0 } }); });
    // limites da conta: o NIM já vem com 40 por minuto; as outras só com o que a pessoa puser
    const rpmIn = h('input.input.mono', { type: 'number', min: '0', value: a.rpm || '', placeholder: a.nim ? L('40 (NIM)') : L('sem limite') });
    rpmIn.addEventListener('change', () => save({ apiProvider: { id: a.id, rpm: Math.max(0, parseInt(rpmIn.value, 10) || 0) } }));
    const rpdIn = h('input.input.mono', { type: 'number', min: '0', value: a.rpd || '', placeholder: L('sem limite') });
    rpdIn.addEventListener('change', () => save({ apiProvider: { id: a.id, rpd: Math.max(0, parseInt(rpdIn.value, 10) || 0) } }));
    retries.addEventListener('change', () => {
      const v = retries.value.trim();
      save({ apiProvider: { id: a.id, retries: v === '' ? null : Math.max(0, Math.min(10, parseInt(v, 10) || 0)) } });
    });
    const cf = (a.base || '').match(CF_RE);
    const cfAcc = cf ? h('input.input.mono', { value: cf[1] === 'ID_DA_CONTA' ? '' : cf[1], placeholder: L('ex.: 0123456789abcdef0123456789abcdef'), spellcheck: false }) : null;
    cfAcc?.addEventListener('change', () => { const id = cfAcc.value.trim().replace(/[^A-Za-z0-9]/g, ''); if (id) save({ apiProvider: { id: a.id, base: `https://api.cloudflare.com/client/v4/accounts/${id}/ai/v1` } }); });
    if (cf) CF_MODELS.forEach((m) => dl.append(h('option', { value: m })));
    const listBtn = h('button.btn.sm', { type: 'button', onclick: async () => {
      // a Cloudflare não lista modelos pela API: as sugestões já estão no campo, o catálogo tem o resto
      if (cf) { model.focus(); toast(L('A Cloudflare não lista modelos pela API: escolha uma das sugestões no campo ou veja o catálogo em developers.cloudflare.com/workers-ai/models.')); return; }
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
      let settled = false;
      const onDelta = () => {
        if (!first && (m.content || m.reasoning)) first = performance.now() - t0;
        if (!settled && m.content.trim().length >= 2) { settled = true; mine = true; ac.abort(); }
      };
      try {
        await streamApi([{ role: 'user', content: L('Responda só: ok') }], [], m, ac.signal, onDelta, { _p: a.id, _fixed: true, max_tokens: 300, temperature: 0, _timeout: 45000 });
      } catch (e) {
        if (!mine) { testOut.textContent = e.message; testOut.classList.add('err'); }
      } finally {
        settled = true;
        clearInterval(tick);
        show();
        test.disabled = false;
      }
    } }, ic('zap'), L('Testar'));
    const del = h('button.icon-btn.sm', { type: 'button', title: L('Remover'), 'aria-label': L('Remover'), html: svg('trash'), onclick: async () => {
      if (!(await confirmBox(L('Remover a API {0}? As funções que usam ela voltam para o modelo local.', apiLabel(a)), L('Remover'), true))) return;
      const roles = { ...(S.settings.apiRoles || {}) };
      for (const k in roles) {
        if (roles[k] === a.id) roles[k] = '';
        if (Array.isArray(roles[k])) roles[k] = roles[k].filter((x) => x !== a.id);
      }
      put({ apiRoles: roles }); save({ apiProviderDelete: a.id });
    } });
    // parâmetros deste provedor: vão em todo pedido e ganham dos do studio (temperatura 0 do auditor etc.)
    const prm = { ...(a.params || {}) };
    const num = (k, ph, step) => {
      const i = h('input.input.mono', { type: 'number', step, value: prm[k] ?? '', placeholder: ph });
      i.addEventListener('change', () => { const v = i.value.trim(); if (v === '') delete prm[k]; else prm[k] = Number(v); saveParams(); });
      return i;
    };
    const known = ['temperature', 'top_p', 'max_tokens', 'reasoning_effort', 'reasoning_tokens'];
    const others = Object.fromEntries(Object.entries(prm).filter(([k]) => !known.includes(k)));
    const extra = h('textarea.input.mono', { rows: 3, spellcheck: false, placeholder: '{"seed": 42}' }, Object.keys(others).length ? JSON.stringify(others, null, 2) : '');
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
      h('div.api-params-row', null,
        field(L('Esforço de raciocínio'), (() => {
          const sel = h('select.select', null, h('option', { value: '' }, L('automático')), h('option', { value: 'low' }, L('baixo')), h('option', { value: 'medium' }, L('médio')), h('option', { value: 'high' }, L('alto')));
          sel.value = prm.reasoning_effort || '';
          sel.addEventListener('change', () => { const v = sel.value.trim(); if (v === '') delete prm.reasoning_effort; else prm.reasoning_effort = v; saveParams(); });
          return sel;
        })(), L('Quanto o modelo pensa antes de responder (OpenAI, DeepSeek).')),
        field(L('Limite de raciocínio (tokens)'), num('reasoning_tokens', L('sem limite'), '1'))),
      field(L('Outros parâmetros (JSON)'), extra, L('Vão em todo pedido para esta API, por cima dos do studio. Ex.: reasoning_effort, chat_template_kwargs, top_k. Vazio = o studio decide (o auditor usa temperatura 0, por exemplo).')));
    const u = apiUse(null, a.id);
    const pingBtn = h('button.icon-btn.sm', { type: 'button', title: L('Verificar se a API responde'), 'aria-label': L('Ping'), html: svg('refresh'), onclick: async () => {
      pingBtn.classList.add('spinning');
      try {
        const r = await api('/api/remote/ping?p=' + encodeURIComponent(a.id));
        if (r.ok) { toast(L('API online')); pingBtn.classList.remove('err'); pingBtn.classList.add('ok'); }
        else { toast(r.error || L('API offline'), 'err'); pingBtn.classList.remove('ok'); pingBtn.classList.add('err'); }
      } catch (e) { toast(e.message, 'err'); pingBtn.classList.remove('ok'); pingBtn.classList.add('err'); }
      setTimeout(() => pingBtn.classList.remove('spinning', 'ok', 'err'), 3000);
    } });
    // fechado: uma linha com o essencial (nome, modelo, para que serve, uso de hoje); incompleta abre sozinha
    const open = API_OPEN.has(a.id) || !a.ready;
    const toggle = () => { API_OPEN.has(a.id) || !a.ready ? API_OPEN.delete(a.id) : API_OPEN.add(a.id); store.set('apiOpen', [...API_OPEN]); draw(); };
    const roles = Object.keys(API_ROLE_SHORT).filter((r) => apiForAll(r).includes(a.id)).map((r) => API_ROLE_SHORT[r]);
    if (mainApiForChat() && mainApiForChat().id === a.id) roles.unshift(L('Conversa'));
    const head = h('div.api-head', { onclick: (e) => { if (!e.target.closest('button, a, input, select, label')) toggle(); } },
      h('span.api-chev' + (open ? '.open' : ''), { html: svg('chev') }),
      h('div.api-title', null,
        h('div.api-name', null, h('b', null, apiLabel(a)), a.ready ? null : h('span.tag.off', null, L('incompleta'))),
        h('small.muted.mono', { title: a.model || '' }, a.model || L('sem modelo'))),
      h('div.api-badges', null,
        ...roles.map((r) => h('span.tag.role', null, r)),
        a.vision ? h('span.tag', { title: L('Aceita imagens') }, ic('image'), L('imagens')) : null,
        isNimApi(a) ? h('span.tag', { title: L('Fila do NVIDIA NIM (40 pedidos por minuto)') }, 'NIM') : null,
        !isNimApi(a) && a.limited ? h('span.tag', { title: L('Limite configurado: a fila segura os pedidos antes do limite') }, [a.rpm ? L('{0}/min', a.rpm) : '', a.rpd ? L('{0}/dia', a.rpd) : ''].filter(Boolean).join(' · ') || L('limite da conta')) : null,
        u.calls ? h('span.tag.use', { title: L('Hoje: {0} pedidos, {1} tokens, {2} falhas (voltaram para o modelo local).', u.calls, u.tokens.toLocaleString(LOCALE), u.fails) }, L('{0} hoje', u.calls) + (u.fails ? ` · ${u.fails}×` : '')) : null),
      h('div.api-acts', null, pingBtn, del));
    if (!open) return h('div.api-card.closed', null, head);
    return h('div.api-card', null,
      head,
      h('div.api-body', null,
        h('div.api-grid', null,
          field(L('Nome'), nome, L('Como aparece na lista de modelos. Vazio = id do modelo.')),
          field(L('Chave'), key, pre?.[3] ? h('a.bin-link', { href: pre[3], target: '_blank', rel: 'noopener' }, ic('external'), L('Pegar uma chave grátis')) : null)),
        cf ? field(L('ID da conta'), cfAcc, L('No painel da Cloudflare: Workers AI › Use REST API (ou a barra lateral da conta). O token precisa da permissão Workers AI.')) : pre ? null : field(L('Endereço'), base, L('O que vem antes de /chat/completions.')),
        field(L('Modelo'), h('div.api-model-row', null, model, dl, listBtn, test)),
        testOut,
        h('div.api-grid.three', null,
          field(L('Modelo de fallback'), fallbackModel, L('Se o principal falhar ou a API cair.')),
          field(L('Tentativas'), retries, L('Reenvios em falha temporária (0 a 10).')),
          field(L('Contexto (tokens)'), ctxIn, L('Janela do modelo, para o medidor e a compactação.'))),
        h('div.api-grid', null,
          field(L('Pedidos por minuto'), rpmIn, L('O studio segura a fila antes de bater no limite e mostra o medidor na conversa. Vale para todas as APIs com o mesmo endereço e chave (a mesma conta).')),
          field(L('Pedidos por dia'), rpdIn, L('Ao acabar, a API para até a meia-noite UTC e o pedido vai para outra API ou para o modelo local. Ex.: OpenRouter grátis, 50 por dia (1000 com créditos).'))),
        h('label.tcard.wrap', null, h('span.tc-main', null, h('span.tc-title', null, L('Aceita imagens')),
          h('span.tc-desc', null, L('Marque se o modelo enxerga imagens (Gemini, GPT-4o, Llama 4, Qwen-VL...). Aí ele recebe fotos anexadas, capturas de tela e os quadros dos vídeos.'))),
          h('span.switch', null, h('input', { type: 'checkbox', checked: a.vision === true, onchange: (e) => save({ apiProvider: { id: a.id, vision: e.target.checked } }) }), h('span'))),
        params,
        h('small.muted', null, L('Hoje: {0} pedidos, {1} tokens, {2} falhas (voltaram para o modelo local).', u.calls, u.tokens.toLocaleString(LOCALE), u.fails))));
  };
  const draw = () => {
    box.innerHTML = '';
    const apis = S.info.apis || [];
    const add = h('select.select', null, h('option', { value: '' }, L('Adicionar uma API...')), API_PRESETS.map(([id, name]) => h('option', { value: id }, name)));
    add.addEventListener('change', () => {
      const p = API_PRESETS.find((x) => x[0] === add.value); if (!p) return;
      let n = 1; while (apis.some((a) => a.id === 'p' + n)) n++;
      const patch = { id: 'p' + n, base: p[2], name: p[0] === 'custom' ? '' : '' };
      API_OPEN.add(patch.id); store.set('apiOpen', [...API_OPEN]);
      if (p[0] === 'cloudflare') { patch.name = 'Cloudflare'; patch.model = CF_MODELS[0]; patch.context = 262144; }
      save({ apiProvider: patch });
    });
    // por função: modelo local ou uma das APIs (só as prontas)
    const roles = S.settings.apiRoles || {};
    const ready = apis.filter((a) => a.ready);
    const roleRows = API_ROLES.map(([id, title, desc]) => {
      if (id === 'explorer') {
        // o explorer aceita várias APIs: as subtarefas do multi_explore se distribuem entre as marcadas
        const setRole = (ids) => { put({ apiRoles: { ...(S.settings.apiRoles || {}), explorer: ids } }); draw(); };
        const picked = apiForAll('explorer');
        // lista na ordem de preferência: a primeira atende o explore simples e assume quando outra falha
        const move = (i, d) => { const ids = [...picked]; const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; setRole(ids); };
        const rows = picked.map((pid, i) => {
          const a = apiById(pid);
          const conc = h('input.input.mono.team-conc', { type: 'number', min: '1', max: '8', value: explorerConc(pid), title: L('Exploradores ao mesmo tempo nesta API'), 'aria-label': L('Exploradores ao mesmo tempo nesta API') });
          conc.addEventListener('change', () => { const n = Math.max(1, Math.min(8, parseInt(conc.value, 10) || 2)); conc.value = n; put({ explorerConc: { ...(S.settings.explorerConc || {}), [pid]: n } }); });
          return h('div.team-row', null,
            h('span.team-n', null, String(i + 1)),
            h('div.team-name', null, h('b', null, apiLabel(a)), h('small.muted', null, a.model + (isNimApi(a) ? ' · ' + L('fila do NIM') : ''))),
            h('label.team-conc-wrap', { title: L('Exploradores ao mesmo tempo nesta API') }, conc, h('small.muted', null, L('ao mesmo tempo'))),
            h('button.icon-btn.sm', { type: 'button', disabled: i === 0, title: L('Subir'), 'aria-label': L('Subir'), html: svg('chev', 'up'), onclick: () => move(i, -1) }),
            h('button.icon-btn.sm', { type: 'button', disabled: i === picked.length - 1, title: L('Descer'), 'aria-label': L('Descer'), html: svg('chev', 'down'), onclick: () => move(i, 1) }),
            h('button.icon-btn.sm', { type: 'button', title: L('Tirar da equipe'), 'aria-label': L('Tirar da equipe'), html: svg('x'), onclick: () => setRole(picked.filter((x) => x !== pid)) }));
        });
        const rest = ready.filter((a) => !picked.includes(a.id));
        const add = h('select.select', null, h('option', { value: '' }, L('Adicionar uma API à equipe...')), rest.map((a) => h('option', { value: a.id }, `${apiLabel(a)} · ${a.model}`)));
        add.addEventListener('change', () => { if (add.value) setRole([...picked, add.value]); });
        const seats = picked.reduce((n, pid) => n + explorerConc(pid), 0);
        return h('div.api-role.team', null, h('div.api-role-main', null, h('b', null, title),
          h('small.muted', null, desc + ' ' + L('As marcadas formam uma equipe: no multi_explore (e nas cenas do app Vídeos) cada uma puxa a próxima tarefa ao terminar a dela, e se uma falhar outra assume do ponto em que parou. O modelo local só entra quando nenhuma responde.'))),
          h('div.team', null,
            picked.length ? rows : h('div.muted.small', null, L('Nenhuma API na equipe: os exploradores usam o modelo local.')),
            rest.length ? add : null,
            picked.length ? h('small.muted', null, L('Até {0} exploradores ao mesmo tempo.', seats)) : null));
      }
      const cur0 = roles[id] === true ? ready[0]?.id || '' : roles[id] || '';
      const sel = h('select.select', null, h('option', { value: '' }, L('Modelo local')), ready.map((a) => h('option', { value: a.id }, `${apiLabel(a)} · ${a.model}`)));
      sel.value = ready.some((a) => a.id === cur0) ? cur0 : '';
      sel.addEventListener('change', () => put({ apiRoles: { ...(S.settings.apiRoles || {}), [id]: sel.value } }));
      return h('div.api-role', null, h('div.api-role-main', null, h('b', null, title), h('small.muted', null, desc)), sel);
    });
    const allOpen = apis.length && apis.every((a) => API_OPEN.has(a.id) || !a.ready);
    box.append(
      apis.length > 1 ? h('div.api-list-head', null, h('small.muted', null, L('{0} APIs · clique numa para editar', apis.length)), h('span.spacer'),
        h('button.btn.sm.ghost', { type: 'button', onclick: () => { if (allOpen) API_OPEN.clear(); else apis.forEach((a) => API_OPEN.add(a.id)); store.set('apiOpen', [...API_OPEN]); draw(); } }, allOpen ? L('Fechar todas') : L('Abrir todas'))) : null,
      ...apis.map(card),
      field(apis.length ? L('Outra API') : L('Provedor'), add, apis.length ? L('Dá para ter várias e mandar cada função para uma, espalhando os limites dos planos grátis.') : null),
      h('div.field', null, h('label', null, L('Quem faz cada função')), ...roleRows,
        apiFor('explorer')
          ? h(
              'label.tcard',
              null,
              h('span.tc-main', null,
                h('span.tc-title', null, L('Delegar mais aos exploradores')),
                h('span.tc-desc', null, L('Com os exploradores numa API, o modelo é orientado a mandar a investigação para eles (vários em paralelo) em vez de ler tudo sozinho.'))),
              h('span.switch', null, h('input', { type: 'checkbox', checked: S.settings.exploreMore !== false, onchange: (e) => put({ exploreMore: e.target.checked }) }), h('span'))
            )
          : null,
        h('label.tcard', null,
          h('span.tc-main', null,
            h('span.tc-title', null, L('Oferecer as APIs como ferramentas')),
            h('span.tc-desc', null, L('O modelo da conversa ganha uma ferramenta por API pronta (remote_api_...) para mandar um prompt a ela. Cada uma ocupa contexto em todo pedido; deixe desligado se não usa.'))),
          h('span.switch', null, h('input', { type: 'checkbox', checked: S.settings.apiTools === true, onchange: (e) => put({ apiTools: e.target.checked }) }), h('span'))),
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
/* ------------------------------------------------------------ backup */
async function drawBackup(box) {
  let r;
  try { r = await api('/api/backup'); } catch (e) { box.innerHTML = ''; box.append(h('div.err', null, e.message)); return; }
  const s = r.settings;
  box.innerHTML = '';
  const set = async (patch) => { try { r = await api('/api/backup/settings', patch); drawBackup(box); } catch (e) { toast(e.message, 'err'); } };
  const folder = h('input.input.mono', { value: s.folder, placeholder: r.detected[0] || L('Escolha uma pasta') });
  folder.addEventListener('change', () => set({ folder: folder.value.trim() }));
  const pick = h('button.btn', { type: 'button', onclick: async () => { const p = await pickPath({ title: L('Pasta do backup'), mode: 'dir', start: s.folder || S.info.home }); if (p) set({ folder: p }); } }, L('Procurar'));
  const drive = r.detected.length && r.detected[0] !== s.folder
    ? h('button.btn.sm', { type: 'button', onclick: () => set({ folder: r.detected[0] }) }, ic('cloud'), L('Usar o Google Drive ({0})', r.detected[0])) : null;
  const every = h('select.select', null, [[0, L('Só quando eu pedir')], [6, L('A cada 6 horas')], [12, L('A cada 12 horas')], [24, L('Uma vez por dia')], [168, L('Uma vez por semana')]].map(([v, l]) => h('option', { value: v }, l)));
  every.value = String(s.everyHours);
  every.addEventListener('change', () => set({ everyHours: Number(every.value) }));
  const keep = h('input.input', { value: s.keep, inputmode: 'numeric', style: { maxWidth: '90px' } });
  keep.addEventListener('change', () => set({ keep: Number(keep.value) || 10 }));
  const keys = h('input', { type: 'checkbox', checked: s.includeKeys });
  keys.addEventListener('change', () => set({ includeKeys: keys.checked }));
  const now = h('button.btn.primary', { type: 'button', disabled: !s.folder, onclick: async () => {
    now.disabled = true; now.textContent = L('Fazendo o backup...');
    try { const x = await api('/api/backup/now', {}); toast(L('Backup feito: {0} ({1} arquivos)', x.file, x.files)); } catch (e) { toast(e.message, 'err'); }
    drawBackup(box);
  } }, ic('archive'), L('Fazer backup agora'));
  const last = s.last ? new Date(s.last * 1000).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' }) : L('nunca');
  box.append(
    h('div.field', null, h('label', null, L('Pasta')), h('div', { style: { display: 'flex', gap: '8px' } }, folder, pick),
      h('small', null, L('Se o Google Drive para computador está instalado, use uma pasta dentro de "Meu Drive" (ex.: G:\\Meu Drive\\Llama Studio).')), drive),
    h('div.row', null, h('div.field', null, h('label', null, L('Automático')), every), h('div.field', null, h('label', null, L('Manter os últimos')), keep)),
    h('label.tcard', null, h('span.tc-main', null, h('span.tc-title', null, L('Incluir as chaves das APIs e os segredos dos conectores')), h('span.tc-desc', null, L('Desligado, o backup sai sem chaves (mais seguro na nuvem); ao restaurar, as chaves atuais continuam.'))), h('span.switch', null, keys, h('span'))),
    h('div.backup-now', null, now, h('small.muted', null, L('Último backup: {0}', last)), s.lastError ? h('small.err', null, s.lastError) : null));
  if (r.backups.length) {
    box.append(h('div.set-group-title', null, L('Backups na pasta')), h('div.backup-list', null, r.backups.map((b) => h('div.backup-row', null,
      ic('archive'), h('div.br-main', null, h('b', null, b.file), h('small.muted', null, `${fmtSize(b.size)} · ${new Date(b.mtime * 1000).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' })}`)),
      h('button.btn.sm', { type: 'button', onclick: async () => {
        if (!(await confirmBox(L('Restaurar {0}? As conversas, personalidades, prompts e configurações voltam para como estavam nesse backup. Antes, o studio guarda uma cópia do estado atual em dados\\backups.', b.file), L('Restaurar'), true))) return;
        try {
          await uiFlush();
          const x = await api('/api/backup/restore', { file: b.file });
          toast(L('Restaurado ({0} arquivos). Recarregando...', x.restored));
          setTimeout(() => location.reload(), 900);
        } catch (e) { toast(e.message, 'err'); }
      } }, L('Restaurar'))))));
  }
}

/* ------------------------------------------------------------ isolamento (Linux no WSL) */
let SANDBOX_POLL = 0;
async function drawSandbox(box) {
  let r;
  try { r = await api('/api/sandbox'); } catch (e) { box.innerHTML = ''; box.append(h('div.err', null, e.message)); return; }
  if (!box.isConnected && box.dataset.drawn) return;
  box.dataset.drawn = '1';
  box.innerHTML = '';
  const set = async (patch) => { try { await api('/api/sandbox/settings', patch); drawSandbox(box); } catch (e) { toast(e.message, 'err'); } };
  const job = r.job || {};
  clearTimeout(SANDBOX_POLL);
  if (job.running) SANDBOX_POLL = setTimeout(() => { if (box.isConnected) drawSandbox(box); }, 2000);
  const tcard = (title, desc, checked, onchange, disabled) => {
    const cb = h('input', { type: 'checkbox', checked, disabled: !!disabled });
    cb.addEventListener('change', () => onchange(cb.checked));
    return h('label.tcard', null, h('span.tc-main', null, h('span.tc-title', null, title), h('span.tc-desc', null, desc)), h('span.switch', null, cb, h('span')));
  };
  if (!r.windows) { box.append(h('p.muted', null, L('O isolamento usa o WSL2 e só existe no Windows.'))); return; }
  if (!r.wsl) {
    box.append(h('div.vid-warn', null, ic('alert'), h('div', null,
      h('b', null, L('O WSL2 não está instalado.')), ' ',
      L('Abra o PowerShell como administrador, rode o comando abaixo e reinicie o PC. Depois volte aqui.'),
      h('pre.term', null, 'wsl --install --no-distribution'))));
    return;
  }
  const steps = h('div.sb-state', null,
    h('div.sb-line', null, ic('check'), L('WSL: {0}', r.wslVersion || L('instalado'))),
    h('div.sb-line', null, r.ready ? ic('check') : ic('x'), r.ready ? L('Linux base pronto: um arquivo ({0}, {1}), não uma distro do WSL. Cada pasta ganha a sua distro a partir dele no primeiro comando.', r.basePath, fmtSize(r.baseSize)) : L('Linux base ainda não preparado')));
  const distro = h('select.select', null, (r.distros_available || []).map((d) => h('option', { value: d.id }, d.name)));
  distro.value = r.distro || 'alpine';
  distro.addEventListener('change', () => set({ distro: distro.value }));
  const sel = (r.distros_available || []).find((d) => d.id === distro.value);
  const apt = sel?.pm === 'apt';
  const differs = r.ready && (r.baseDistro || 'alpine') !== distro.value;
  const pkgs = h('input.input.mono', { value: r.packages || '', placeholder: distro.value === 'kali-linux' ? L('ex.: kali-linux-headless (as ferramentas do Kali, alguns GB) nmap sqlmap') : apt ? L('ex.: build-essential default-jdk ffmpeg') : L('ex.: gcc g++ make openjdk17 dotnet8-sdk') });
  pkgs.addEventListener('change', () => set({ packages: pkgs.value }));
  const prep = h('button.btn' + (r.ready ? '' : '.primary'), { type: 'button', disabled: job.running, onclick: async () => {
    if (r.ready && !(await confirmBox(L('Preparar de novo o Linux base? As pastas que já têm o Linux delas continuam com o antigo; para usar o novo, apague-as abaixo.'), L('Preparar')))) return;
    try { await api('/api/sandbox/prepare', {}); drawSandbox(box); } catch (e) { toast(e.message, 'err'); }
  } }, ic('download'), r.ready ? L('Preparar de novo') : L('Preparar (baixa ~150 MB)'));
  box.append(...[
    steps,
    job.running ? h('div.sb-job', null, h('span.spin', { html: svg('loader') }), h('span', null, job.step)) : null,
    !job.running && job.error ? h('div.err.small', null, L('A preparação falhou: {0}', job.error)) : null,
    h('div.field', null, h('label', null, L('Distribuição')), distro,
      h('small', null, distro.value === 'alpine' ? L('Alpine: a mais leve (~150 MB com os comandos).') : distro.value === 'kali-linux' ? L('Kali Linux: base Debian com os repositórios do Kali; as ferramentas de segurança vêm pelos pacotes (ex.: kali-linux-headless).') : L('{0}: maior (algumas centenas de MB), com apt e os pacotes do Debian/Ubuntu.', sel?.name || distro.value)),
      differs ? h('small.err', null, L('A base pronta é {0}. Clique em Preparar de novo para usar {1}; as pastas que já têm Linux continuam com o antigo até você apagá-las.', (r.distros_available || []).find((d) => d.id === r.baseDistro)?.name || r.baseDistro, sel?.name || distro.value)) : null),
    h('div.field', null, h('label', null, L('Pacotes a mais na preparação')), pkgs,
      h('small', null, apt ? L('Já vêm: {0}. Nomes do apt (packages.debian.org, packages.ubuntu.com, pkg.kali.org).', r.aptPackages) : L('Já vêm: {0}. Os nomes são os do Alpine (pkgs.alpinelinux.org).', r.defaultPackages))),
    h('div.backup-now', null, prep),
    tcard(L('Rodar os comandos dos agentes no Linux isolado'), L('Cada pasta de trabalho ganha o Linux dela na primeira vez que um comando roda (alguns segundos). O agente passa a usar comandos Linux, e a pasta aparece como /workspace. As ferramentas de arquivo continuam como estão.'), r.enabled, (v) => set({ enabled: v }), !r.ready && !r.enabled),
    tcard(L('Sem internet nos comandos'), L('Os comandos não acessam a rede (nem o apk add). As APIs e o navegador do studio não mudam.'), r.noNet, (v) => set({ noNet: v }))].filter(Boolean));
  // pastas: as que têm Linux, as desligadas e a pasta de trabalho atual
  const key = (f) => String(f || '').replace(/[\\/]+$/, '').toLowerCase();
  const rows = new Map();
  for (const d of r.distros || []) rows.set(key(d.folder) || d.name, { folder: d.folder, name: d.name });
  for (const f of r.off || []) if (!rows.has(key(f))) rows.set(key(f), { folder: f });
  for (const f of [S.info.workspace, ...(S.projects || []).map((p) => p.dir)]) if (f && !rows.has(key(f))) rows.set(key(f), { folder: f });
  const offSet = new Set((r.off || []).map(key));
  if (rows.size) {
    box.append(h('div.set-group-title', null, L('Pastas de trabalho')), h('div.backup-list', null, [...rows.values()].map((d) => {
      const isOff = d.folder && offSet.has(key(d.folder));
      const sw = h('input', { type: 'checkbox', checked: !isOff, disabled: !d.folder, title: L('Isolamento nesta pasta') });
      sw.addEventListener('change', () => set({ folder: d.folder, off: !sw.checked }));
      return h('div.backup-row', null,
        ic('box'),
        h('div.br-main', null, h('b', null, d.folder || d.name),
          h('small.muted', null, isOff ? L('isolamento desligado: os comandos rodam no PowerShell') : d.name ? d.name : L('o Linux é criado no primeiro comando'))),
        d.name ? h('button.btn.sm', { type: 'button', onclick: () => sandboxPackages(d) }, ic('download'), L('Pacotes')) : null,
        d.name ? h('button.btn.sm', { type: 'button', onclick: async () => {
          if (!(await confirmBox(L('Apagar o Linux de {0}? O que foi instalado lá dentro se perde (a pasta de trabalho não muda). Ele é recriado no próximo comando.', d.folder || d.name), L('Apagar'), true))) return;
          try { await api('/api/sandbox/remove', { name: d.name }); drawSandbox(box); } catch (e) { toast(e.message, 'err'); }
        } }, L('Apagar')) : null,
        h('label.switch', { title: L('Isolamento nesta pasta') }, sw, h('span')));
    })));
  }
}

/** Pacotes do Linux de uma pasta: os pedidos (com remover) e a busca no Alpine (com instalar). */
async function sandboxPackages(d) {
  const list = h('div.pkg-list', null, h('div.muted', null, L('Carregando...')));
  const results = h('div.pkg-list');
  const log = h('pre.term.pkg-log', { hidden: true });
  const qIn = h('input.input', { type: 'search', placeholder: L('Procurar pacote (ex.: gcc, openjdk, ffmpeg)') });
  let busy = false;
  const run = async (add, del) => {
    if (busy) return; busy = true;
    log.hidden = false; log.textContent = (add.length ? 'apk add ' + add.join(' ') : 'apk del ' + del.join(' ')) + '\n' + L('rodando...');
    try { const x = await api('/api/sandbox/packages', { name: d.name, add, del }); log.textContent = x.log || 'ok'; toast(add.length ? L('Instalado: {0}', add.join(', ')) : L('Removido: {0}', del.join(', '))); await load(); }
    catch (e) { log.textContent += '\n' + e.message; toast(e.message, 'err'); }
    finally { busy = false; }
  };
  const load = async () => {
    try {
      const x = await api('/api/sandbox/packages', { name: d.name });
      list.innerHTML = '';
      list.append(h('small.muted', null, L('{0} pacotes instalados no total; estes foram pedidos (o resto são dependências):', x.installed)));
      list.append(h('div.pkg-chips', null, x.world.map((p) => h('span.pkg-chip', null, p, h('button.icon-btn.sm', { title: L('Remover {0}', p), 'aria-label': L('Remover {0}', p), html: svg('x'), onclick: async () => { if (await confirmBox(L('Remover {0} deste Linux?', p), L('Remover'), true)) run([], [p]); } })))));
    } catch (e) { list.innerHTML = ''; list.append(h('div.err', null, e.message)); }
  };
  let t = 0;
  qIn.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = qIn.value.trim();
      results.innerHTML = '';
      if (q.length < 2) return;
      results.append(h('div.muted', null, L('Procurando...')));
      try {
        const x = await api('/api/sandbox/packages', { name: d.name, q });
        results.innerHTML = '';
        if (!x.items.length) results.append(h('div.muted', null, L('Nada encontrado (sem internet, o índice pode estar velho).')));
        for (const it of x.items) results.append(h('div.pkg-row', null, h('div.pr-main', null, h('b', null, it.name), h('small.muted', null, `${it.version} · ${it.desc}`)), h('button.btn.sm', { onclick: () => run([it.name], []) }, ic('plus'), L('Instalar'))));
      } catch (e) { results.innerHTML = ''; results.append(h('div.err', null, e.message)); }
    }, 350);
  });
  const m = modal({
    title: L('Pacotes · {0}', d.folder || d.name), wide: true,
    body: h('div.pkg-box', null, list, qIn, results, log),
    foot: [h('span.spacer'), h('button.btn', { onclick: () => m.close() }, L('Fechar'))],
  });
  load();
}
