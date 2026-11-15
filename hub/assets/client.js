// Parte da central dentro da interface do studio: mostra onde ele está rodando (PC ou nuvem), avisa quando o
// PC conecta ou cai e deixa trocar ou sair. Isolado num Shadow DOM para não brigar com o CSS do studio.
(() => {
  if (window.__hub) return;
  window.__hub = true;
  const en = !/^pt/i.test(document.documentElement.lang || navigator.language || '');
  const T = en
    ? { pc: 'PC', cloud: 'Cloud', onPc: 'Running on your PC', onCloud: 'Running in the cloud', pcBack: 'Your PC is online.', openPc: 'Open on PC', pcGone: 'Your PC disconnected.', goCloud: 'Continue in the cloud', useCloud: 'Use the cloud instead', logout: 'Sign out', devices: 'Linked PCs', none: 'No PC linked yet. On your PC: Settings → Cloud.', remove: 'Unlink', since: 'connected', cloudStop: 'Turn off cloud studio', disk: 'Cloud folder' }
    : { pc: 'PC', cloud: 'Nuvem', onPc: 'Rodando no seu PC', onCloud: 'Rodando na nuvem', pcBack: 'Seu PC está online.', openPc: 'Abrir no PC', pcGone: 'O PC desconectou.', goCloud: 'Continuar na nuvem', useCloud: 'Usar a nuvem', logout: 'Sair', devices: 'PCs vinculados', none: 'Nenhum PC vinculado ainda. No PC: Configurações → Nuvem.', remove: 'Desvincular', since: 'conectado', cloudStop: 'Desligar o studio na nuvem', disk: 'Pasta na nuvem' };
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483000;left:50%;top:max(8px, env(safe-area-inset-top));transform:translateX(-50%);pointer-events:none';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
    .wrap { display:flex; flex-direction:column-reverse; align-items:center; gap:6px; pointer-events:none; }
    .pill, .bar, .menu { pointer-events:auto; background:rgba(30,31,36,.92); color:#eee; border:1px solid rgba(255,255,255,.12); backdrop-filter: blur(6px); }
    .pill { border-radius:99px; padding:3px 10px; cursor:pointer; display:flex; gap:6px; align-items:center; opacity:.55; transition:opacity .2s; }
    .pill:hover { opacity:1; }
    .dot { width:7px; height:7px; border-radius:50%; background:#7ad; }
    .dot.pc { background:#6c6; }
    .bar { border-radius:10px; padding:8px 10px; display:none; gap:10px; align-items:center; box-shadow:0 4px 18px rgba(0,0,0,.3); }
    .bar.on { display:flex; }
    button { border:0; border-radius:7px; padding:5px 10px; cursor:pointer; background:#5b5bd6; color:#fff; }
    button.ghost { background:transparent; color:#bbb; border:1px solid rgba(255,255,255,.2); }
    .menu { display:none; border-radius:10px; padding:10px; min-width:260px; max-width:min(92vw,360px); box-shadow:0 6px 24px rgba(0,0,0,.35); }
    .menu.on { display:block; }
    .menu h4 { margin:0 0 6px; font-weight:600; color:#aaa; }
    .row { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:4px 0; }
    .muted { color:#999; }
    .sep { height:1px; background:rgba(255,255,255,.1); margin:8px 0; }
  </style>
  <div class="wrap">
    <div class="menu" id="menu"></div>
    <div class="bar" id="bar"><span id="barText"></span><button id="barGo"></button><button class="ghost" id="barX">×</button></div>
    <div class="pill" id="pill"><span class="dot" id="dot"></span><span id="where"></span></div>
  </div>`;
  const $ = (id) => root.getElementById(id);
  const mark = () => {
    $('dot').className = 'dot' + (TARGET === 'pc' ? ' pc' : '');
    $('where').textContent = TARGET === 'pc' ? T.pc : T.cloud;
    $('pill').title = TARGET === 'pc' ? T.onPc : T.onCloud;
  };
  const TARGET = window.__hubTarget === 'pc' ? 'pc' : 'cloud';
  let dismissed = '';
  const go = (t) => { location.href = '/?t=' + t; };
  function bar(kind) {
    if (!kind || dismissed === kind) { $('bar').classList.remove('on'); return; }
    $('barText').textContent = kind === 'pc' ? T.pcBack : T.pcGone;
    $('barGo').textContent = kind === 'pc' ? T.openPc : T.goCloud;
    $('barGo').onclick = () => go(kind === 'pc' ? 'pc' : 'cloud');
    $('barX').onclick = () => { dismissed = kind; bar(null); };
    $('bar').classList.add('on');
  }
  const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub': '1' }, body: JSON.stringify(b || {}) });
  let me = null;
  async function poll() {
    try {
      const r = await fetch('/hub/api/me', { cache: 'no-store' });
      if (r.ok) me = await r.json();
      if (me && !me.user) { location.href = '/hub/login'; return; }
      if (TARGET === 'cloud' && me?.pc) bar('pc');
      else if (TARGET === 'pc' && !me?.pc) bar('gone');
      else bar(null);
    } catch { /* sem rede */ }
  }
  async function menu() {
    const m = $('menu');
    if (m.classList.contains('on')) { m.classList.remove('on'); return; }
    m.innerHTML = '';
    const add = (html) => { const d = document.createElement('div'); d.innerHTML = html; m.append(d); return d; };
    add(`<div class="row"><b>${TARGET === 'pc' ? T.onPc : T.onCloud}</b><span class="muted">${me?.user?.email || ''}</span></div>`);
    if (TARGET === 'pc') { const r = add(`<div class="row"><span></span><button class="ghost">${T.useCloud}</button></div>`); r.querySelector('button').onclick = () => go('cloud'); }
    else if (me?.pc) { const r = add(`<div class="row"><span>${T.pcBack}</span><button>${T.openPc}</button></div>`); r.querySelector('button').onclick = () => go('pc'); }
    if (me?.cloud?.diskMb != null) add(`<div class="row muted"><span>${T.disk}</span><span>${me.cloud.diskMb} MB</span></div>`);
    add('<div class="sep"></div>');
    add(`<h4>${T.devices}</h4>`);
    try {
      const d = await (await fetch('/hub/api/devices')).json();
      if (!d.devices?.length) add(`<div class="muted">${T.none}</div>`);
      for (const x of d.devices || []) {
        const r = add(`<div class="row"><span>${x.online ? '● ' : ''}${x.name.replace(/[<>&]/g, '')}</span><button class="ghost">${T.remove}</button></div>`);
        r.querySelector('button').onclick = async () => { await post('/hub/api/devices/remove', { id: x.id }); m.classList.remove('on'); menu(); };
      }
    } catch { /* ok */ }
    add('<div class="sep"></div>');
    const f = add(`<div class="row"><button class="ghost" id="stop">${T.cloudStop}</button><button class="ghost" id="out">${T.logout}</button></div>`);
    f.querySelector('#out').onclick = async () => { await post('/hub/api/logout'); location.href = '/hub/login'; };
    f.querySelector('#stop').onclick = async () => { await post('/hub/api/cloud/stop'); m.classList.remove('on'); };
    m.classList.add('on');
  }
  // um pedido que volta dizendo que o PC caiu mostra o aviso na hora
  const f0 = window.fetch;
  window.fetch = async (...a) => {
    const r = await f0(...a);
    if (r.headers.get('x-hub-switch')) bar('gone');
    if (r.status === 401 && String(a[0]).startsWith('/') && !String(a[0]).startsWith('/hub/')) poll();
    return r;
  };
  const start = () => {
    document.body.append(host);
    mark();
    $('pill').onclick = menu;
    poll();
    setInterval(poll, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
