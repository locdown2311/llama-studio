/* llama studio - início (init) */
'use strict';

async function init() {
  translateStatic();
  applyTheme();
  for (const [v] of SET_EMBED) {
    const sec = $('#view-' + v); const page = sec?.querySelector('.page');
    if (!page) continue;
    $('#set-pane').append(h('div.set-embed', { dataset: { v }, hidden: true }, page));
    sec.remove();
  }
  const navIcons = { chat: 'chat', skills: 'sparkles', mcp: 'plug', personas: 'user', tools: 'wrench', server: 'server', settings: 'gear', calendar: 'calendar', videos: 'film' };
  const navLabels = { chat: L('Nova conversa'), skills: L('Habilidades'), mcp: L('Conectores'), personas: L('Personalidades'), tools: L('Utilitários'), server: L('Servidor'), settings: L('Configurações'), calendar: L('Calendário'), videos: L('Vídeos') };
  $$('.nav-item').forEach((b) => {
    b.innerHTML = svg(navIcons[b.dataset.view]) + `<span>${navLabels[b.dataset.view]}</span>`;
    b.addEventListener('click', () => {
      if (b.dataset.view === 'chat') { const c = cur(); if (!c || c.messages.length) newConv(); setView('chat'); }
      else setView(b.dataset.view);
    });
  });
  applyVideosNav();
  $('.search-ico').innerHTML = svg('search');
  $('#search').addEventListener('input', () => { if (S.view !== 'chat') setView('chat'); renderConvList(); });
  $('#bins-check').append(ic('refresh'), L('Procurar versões novas'));
  $('#bins-check').addEventListener('click', () => loadBins(true, true));
  $('#persona-new').append(ic('plus'), L('Nova personalidade'));
  $('#persona-new').addEventListener('click', () => editPersona(null));
  $('#pick-persona').addEventListener('click', () => togglePop('#pop-persona', fillPersonaPop));
  $('#conv-menu-btn').innerHTML = svg('more');
  $('#conv-menu-btn').addEventListener('click', () => togglePop('#pop-conv', fillConvMenu));
  $('#toggle-ws').innerHTML = svg('panel');
  $('#ws-refresh').innerHTML = svg('refresh');
  $('#ws-open').innerHTML = svg('external');
  $('.drop-icon').innerHTML = svg('pin');
  $('#plus-btn').innerHTML = svg('plus');
  initWsTabs();
  applyLayout();
  MQ_WS.addEventListener('change', applyLayout); MQ_SIDE.addEventListener('change', applyLayout);
  $('#scrim').addEventListener('click', closeDrawers);
  $('#side-btn').innerHTML = svg('menu');
  $('#side-btn').addEventListener('click', () => toggleSide());
  $('#ws-close').innerHTML = svg('x');
  $('#ws-close').addEventListener('click', closeDrawers);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (S.sideDrawer || S.wsDrawer) && !$('.modal-back')) closeDrawers(); });
  $('#toggle-ws').addEventListener('click', toggleWs);
  $('#ws-refresh').addEventListener('click', () => { S.ws.fresh.clear(); refreshTree(); });
  $('#ws-open').addEventListener('click', () => api('/api/reveal', { path: '.', ws: S.ws.path }));
  $('#ws-path').addEventListener('click', chooseWorkspace);

  const ed = editor();
  ed.addEventListener('keydown', (e) => {
    if (mention && $('#pop-mention').classList.contains('open') && mention.items.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); mention.index = (mention.index + 1) % mention.items.length; drawMention(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); mention.index = (mention.index - 1 + mention.items.length) % mention.items.length; drawMention(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); chooseMention(mention.index); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeMention(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(e.ctrlKey || e.metaKey); return; }
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); }
  });
  ed.addEventListener('input', () => {
    if (!ed.textContent.trim() && !ed.querySelector('.pill')) ed.innerHTML = '';
    saveRange(); checkMention(); updatePickers(); updateSendBtn();
  });
  ed.addEventListener('keyup', saveRange);
  ed.addEventListener('mouseup', saveRange);
  ed.addEventListener('blur', () => { saveRange(); setTimeout(closeMention, 150); });
  ed.addEventListener('paste', (e) => {
    e.preventDefault();
    const imgs = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
    if (imgs.length) { saveRange(); imgs.forEach(pasteImage); return; }
    if (e.clipboardData?.files?.length) { saveRange(); handleDrop(e.clipboardData); return; }
    const text = e.clipboardData.getData('text/plain');
    if (text) document.execCommand('insertText', false, text);
  });
  ed.addEventListener('drop', (e) => e.preventDefault());

  $('#send').addEventListener('click', send);
  initDictation();
  $('#plus-btn').addEventListener('click', () => togglePop('#pop-plus', fillPlusPop));
  $('#pick-model').addEventListener('click', () => togglePop('#pop-model', fillModelPop));
  $('#pick-skills').addEventListener('click', () => togglePop('#pop-skills', fillSkillsPop));
  $('#pick-mcp').addEventListener('click', () => togglePop('#pop-mcp', fillMcpPop));
  $('#pick-ws').addEventListener('click', () => togglePop('#pop-ws', fillWsPop));
  $('#ctx-meter').addEventListener('click', () => togglePop('#pop-ctx', fillCtxPop));
  $('#pick-think').addEventListener('click', () => togglePop('#pop-think', fillThinkPop));
  $('#pick-auto').addEventListener('click', () => togglePop('#pop-auto', fillAutoPop));
  $('#pick-plan').addEventListener('click', togglePlan);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && running(cur()) && S.view === 'chat' && !$('#modal-root').childElementCount && !mention) stop();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search').focus(); $('#search').select(); }
  });

  setupDrop();
  setupSkillsPage();
  setupMcpPage();

  try {
    S.info = await api('/api/state');
    // idioma: o programa guarda o escolhido (instalador ou menu); a interface segue, e o programa aprende o da interface
    if (S.info.lang && S.info.lang !== LANG && !S.settings.lang) { setLang(S.info.lang); return; }
    if (!S.info.lang || (S.settings.lang && S.info.lang !== S.settings.lang)) api('/api/config', { lang: LANG }).catch(() => {});
    S.ws.path = wsOf(cur()) || S.info.workspace;
    $('#app-ver').textContent = 'v' + (S.info.uiVersion || S.info.version || '');
    $('#app-ver').title = L('Programa {0}, interface {1}', S.info.version, S.info.uiVersion);
  } catch (e) {
    toast(L('Não consegui falar com o auxiliar: ') + e.message, 'err');
  }
  renderWsPath();
  if (S.convs.length && !cur()) S.curId = S.convs[0].id;
  renderConvList();
  renderChat();
  renderTree();
  await Promise.all([loadSkills(), loadMcp(), checkHealth(), loadModels()]);
  setTimeout(() => maybeOnboard(), 600);
  // tela de abertura enquanto o modelo carrega (o servidor pode estar subindo agora)
  for (let i = 0; i < 4 && S.llama && S.llama.state === 'stopped' && S.llama.config?.AutoStart; i++) { await new Promise((r) => setTimeout(r, 400)); await checkHealth(); }
  if (S.llama && ['loading', 'external-loading'].includes(S.llama.state)) showSplash();
  $('#sp-skip').addEventListener('click', () => hideSplash(false));
  $('#sp-logbtn').addEventListener('click', () => { hideSplash(false); setView('server'); });
  renderComposer(); renderChatTitle();
  setInterval(checkHealth, 5000);
  // ping periódico das APIs remotas (a cada 30s)
  setInterval(pingApis, 30000);
  setTimeout(() => pingApis(), 2000);
  setTimeout(uiMigrate, 2500);
  setTimeout(() => checkUpdates(), 4000);
  setInterval(() => checkUpdates(), 6 * 3600 * 1000);
  focusEditor(true);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}