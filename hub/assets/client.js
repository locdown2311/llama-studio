// Parte da central dentro da interface do studio: mostra onde ele está rodando (PC ou nuvem), avisa quando o
// PC conecta ou cai e deixa trocar ou sair. Isolado num Shadow DOM para não brigar com o CSS do studio.
(() => {
  if (window.__hub) return;
  window.__hub = true;
  const en = !/^pt/i.test(document.documentElement.lang || navigator.language || '');
  const T = en
    ? { pc: 'PC', cloud: 'Cloud', onPc: 'Running on your PC', onCloud: 'Running in the cloud', pcBack: 'Your PC is online.', openPc: 'Open on PC', pcGone: 'Your PC disconnected.', goCloud: 'Continue in the cloud', useCloud: 'Use the cloud instead', logout: 'Sign out', devices: 'Linked PCs', none: 'No PC linked yet. On your PC: Settings → Cloud.', remove: 'Unlink', since: 'connected', cloudStop: 'Turn off cloud studio', disk: 'Cloud folder', account: 'Account and security', admin: 'Administration', close: 'Close',
      twofa: 'Two-step verification', twofaOn: 'On. Signing in asks for a code from your authenticator app.', twofaOff: 'Off. Turn it on: your account can control your PC.', enable: 'Turn on', disable: 'Turn off', newRec: 'New recovery codes', left: '{0} recovery codes left',
      scan: '1. Scan with an authenticator app (Google Authenticator, Authy, 1Password, Aegis...) or type the key:', type: '2. Type the 6-digit code it shows:', confirm: 'Confirm', saveRec: 'Save these recovery codes somewhere safe. Each works once if you lose your phone. They won\'t be shown again.', copy: 'Copy', copied: 'Copied',
      pass: 'Account password', code: 'Code (or recovery code)', changePass: 'Change password', cur: 'Current password', newPass: 'New password (min. 8)', save: 'Save', ok: 'Done', notif: 'Notifications on this device', notifOn: 'On', notifOff: 'Turn on', notifNo: 'Blocked in the browser settings', notifIos: 'On iPhone: add the studio to the home screen first.' }
    : { pc: 'PC', cloud: 'Nuvem', onPc: 'Rodando no seu PC', onCloud: 'Rodando na nuvem', pcBack: 'Seu PC está online.', openPc: 'Abrir no PC', pcGone: 'O PC desconectou.', goCloud: 'Continuar na nuvem', useCloud: 'Usar a nuvem', logout: 'Sair', devices: 'PCs vinculados', none: 'Nenhum PC vinculado ainda. No PC: Configurações → Nuvem.', remove: 'Desvincular', since: 'conectado', cloudStop: 'Desligar o studio na nuvem', disk: 'Pasta na nuvem', account: 'Conta e segurança', admin: 'Administração', close: 'Fechar',
      twofa: 'Duas etapas', twofaOn: 'Ligada. Entrar pede o código do app autenticador.', twofaOff: 'Desligada. Ligue: sua conta controla o seu PC.', enable: 'Ligar', disable: 'Desligar', newRec: 'Novos códigos de recuperação', left: 'Restam {0} códigos de recuperação',
      scan: '1. Leia com um app autenticador (Google Authenticator, Authy, 1Password, Aegis...) ou digite a chave:', type: '2. Digite o código de 6 dígitos que ele mostra:', confirm: 'Confirmar', saveRec: 'Guarde estes códigos de recuperação num lugar seguro. Cada um vale uma vez se você perder o celular. Eles não aparecem de novo.', copy: 'Copiar', copied: 'Copiado',
      pass: 'Senha da conta', code: 'Código (ou de recuperação)', changePass: 'Trocar a senha', cur: 'Senha atual', newPass: 'Senha nova (mín. 8)', save: 'Salvar', ok: 'Feito', notif: 'Notificações neste aparelho', notifOn: 'Ligadas', notifOff: 'Ligar', notifNo: 'Bloqueadas nas configurações do navegador', notifIos: 'No iPhone: adicione o studio à tela inicial antes.' };
  const host = document.createElement('div');
  // no celular fica à direita, logo abaixo do cabeçalho (no meio, cobria o título)
  const narrow = matchMedia('(max-width: 860px)');
  const place = () => { host.style.cssText = narrow.matches
    ? 'position:fixed;z-index:2147483000;right:10px;top:calc(64px + env(safe-area-inset-top));pointer-events:none'
    : 'position:fixed;z-index:2147483000;left:50%;top:max(8px, env(safe-area-inset-top));transform:translateX(-50%);pointer-events:none'; };
  place(); narrow.addEventListener('change', place);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host { all: initial; }
    @media (max-width: 860px) { .wrap { align-items: flex-end; } }
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
    .sheet-back { position:fixed; inset:0; background:rgba(0,0,0,.45); display:none; align-items:center; justify-content:center; padding:16px; pointer-events:auto; }
    .sheet-back.on { display:flex; }
    .sheet { background:#1f2025; color:#eee; border:1px solid rgba(255,255,255,.12); border-radius:14px; width:min(440px, 100%); max-height:90vh; overflow:auto; padding:16px; box-shadow:0 10px 40px rgba(0,0,0,.5); }
    .sheet * { font-size:13.5px; }
    .sheet h3 { margin:0 0 12px; font-size:16px; font-weight:650; }
    .sheet h5 { margin:14px 0 6px; font-size:14px; font-weight:600; }
    .sheet p { margin:6px 0; color:#bbb; }
    .sheet input { width:100%; padding:9px 11px; border-radius:8px; border:1px solid rgba(255,255,255,.18); background:#16171b; color:#eee; margin:4px 0; }
    .sheet button { min-height:36px; margin:4px 4px 0 0; }
    .sheet .qr { background:#fff; border-radius:10px; padding:8px; width:200px; margin:8px 0; }
    .sheet .qr svg { width:100%; height:auto; display:block; }
    .sheet code, .sheet .codes { font-family: ui-monospace, Consolas, monospace; }
    .sheet .codes { display:grid; grid-template-columns:1fr 1fr; gap:4px 12px; background:#16171b; border-radius:8px; padding:10px; margin:8px 0; letter-spacing:1px; }
    .sheet .err { color:#ff7b6b; min-height:18px; }
    .sheet .key { word-break:break-all; background:#16171b; padding:6px 8px; border-radius:6px; display:block; }
  </style>
  <div class="wrap">
    <div class="menu" id="menu"></div>
    <div class="bar" id="bar"><span id="barText"></span><button id="barGo"></button><button class="ghost" id="barX">×</button></div>
    <div class="pill" id="pill"><span class="dot" id="dot"></span><span id="where"></span></div>
  </div>`;
  // a janela da conta fica num elemento próprio (o da etiqueta tem transform, que prenderia o position:fixed)
  const sheetHost = document.createElement('div');
  sheetHost.style.cssText = 'position:fixed;inset:0;z-index:2147483001;pointer-events:none';
  const sroot = sheetHost.attachShadow({ mode: 'open' });
  sroot.innerHTML = root.innerHTML.split('</style>')[0] + '</style><div class="sheet-back" id="sheetBack"><div class="sheet" id="sheet"></div></div>';
  const $ = (id) => root.getElementById(id) || sroot.getElementById(id);
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
    const acc = add(`<div class="row"><button class="ghost" id="acc">${T.account}${me?.user?.twofa ? '' : ' ⚠'}</button>${me?.user?.admin ? `<button class="ghost" id="adm">${T.admin}</button>` : ''}</div>`);
    acc.querySelector('#acc').onclick = () => { m.classList.remove('on'); account(); };
    acc.querySelector('#adm')?.addEventListener('click', () => { location.href = '/hub/admin'; });
    const ps = await pushState().catch(() => 'no');
    if (ps !== 'no') {
      const n = add(`<div class="row"><span>${T.notif}</span>${ps === 'on' ? `<span class="muted">${T.notifOn}</span>` : ps === 'denied' ? `<span class="muted">${T.notifNo}</span>` : ps === 'ios' ? `<span class="muted">${T.notifIos}</span>` : `<button id="nt">${T.notifOff}</button>`}</div>`);
      n.querySelector('#nt')?.addEventListener('click', async (e) => { e.target.disabled = true; await enablePush().catch(() => false); m.classList.remove('on'); menu(); });
    }
    const f = add(`<div class="row"><button class="ghost" id="stop">${T.cloudStop}</button><button class="ghost" id="out">${T.logout}</button></div>`);
    f.querySelector('#out').onclick = async () => { await post('/hub/api/logout'); location.href = '/hub/login'; };
    f.querySelector('#stop').onclick = async () => { await post('/hub/api/cloud/stop'); m.classList.remove('on'); };
    m.classList.add('on');
  }
  /* notificações (Web Push): o fim das tarefas em segundo plano chega aqui */
  const b64u = (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
  async function pushState() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return /iPhone|iPad/.test(navigator.userAgent) ? 'ios' : 'no';
    if (Notification.permission === 'denied') return 'denied';
    const reg = await navigator.serviceWorker.getRegistration('/');
    return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
  }
  async function enablePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    if ((await Notification.requestPermission()) !== 'granted') return false;
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const { key } = await (await fetch('/hub/api/push/key')).json();
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(key) }));
    const r = await post('/hub/api/push/subscribe', sub.toJSON());
    return r.ok;
  }
  // a interface do studio pede ao mandar uma tarefa para o segundo plano (no toque do botão)
  window.__hubPush = async () => { try { return (await pushState()) === 'on' || await enablePush(); } catch { return false; } };

  /* conta: duas etapas e senha */
  const escH = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const call = async (u, b) => { const r = await post(u, b); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; };
  function showCodes(box, codes) {
    box.innerHTML = `<p>${T.saveRec}</p><div class="codes">${codes.map((c) => `<span>${escH(c)}</span>`).join('')}</div><button id="cp">${T.copy}</button><button class="ghost" id="dn">${T.ok}</button>`;
    box.querySelector('#cp').onclick = async (e) => { try { await navigator.clipboard.writeText(codes.join('\n')); e.target.textContent = T.copied; } catch { /* sem permissão */ } };
    box.querySelector('#dn').onclick = () => account();
  }
  async function account() {
    try { const r = await fetch('/hub/api/me', { cache: 'no-store' }); if (r.ok) me = await r.json(); } catch { /* ok */ }
    const back = $('sheetBack'), sh = $('sheet');
    back.classList.add('on');
    back.onclick = (e) => { if (e.target === back) back.classList.remove('on'); };
    const on = !!me?.user?.twofa;
    sh.innerHTML = `<h3>${T.account}</h3><p>${escH(me?.user?.email || '')}</p>
      <h5>${T.twofa}</h5><p>${on ? T.twofaOn : T.twofaOff}</p>${on ? `<p>${T.left.replace('{0}', me.user.recoveryLeft)}</p>` : ''}
      <div id="tf"></div><div class="err" id="tfErr"></div>
      <h5>${T.changePass}</h5>
      <input type="password" id="pc" placeholder="${T.cur}" autocomplete="current-password"><input type="password" id="pn" placeholder="${T.newPass}" autocomplete="new-password">
      <button id="ps">${T.save}</button><div class="err" id="psErr"></div>
      <div class="sep"></div><button class="ghost" id="cl">${T.close}</button>`;
    sh.querySelector('#cl').onclick = () => back.classList.remove('on');
    sh.querySelector('#ps').onclick = async () => {
      try { await call('/hub/api/password', { current: sh.querySelector('#pc').value, password: sh.querySelector('#pn').value }); sh.querySelector('#psErr').textContent = ''; sh.querySelector('#pn').value = sh.querySelector('#pc').value = ''; sh.querySelector('#ps').textContent = T.ok; }
      catch (e) { sh.querySelector('#psErr').textContent = e.message; }
    };
    const tf = sh.querySelector('#tf'), tfErr = sh.querySelector('#tfErr');
    if (!on) {
      tf.innerHTML = `<button id="en">${T.enable}</button>`;
      tf.querySelector('#en').onclick = async () => {
        try {
          const s = await call('/hub/api/2fa/setup');
          tf.innerHTML = `<p>${T.scan}</p><div class="qr">${s.qr}</div><code class="key">${escH(s.secret.replace(/(.{4})/g, '$1 ').trim())}</code>
            <p>${T.type}</p><input id="cd" inputmode="numeric" autocomplete="one-time-code" maxlength="6"><button id="ok">${T.confirm}</button>`;
          tf.querySelector('#cd').focus();
          tf.querySelector('#ok').onclick = async () => {
            try { const r = await call('/hub/api/2fa/enable', { code: tf.querySelector('#cd').value }); tfErr.textContent = ''; showCodes(tf, r.recovery); }
            catch (e) { tfErr.textContent = e.message; }
          };
        } catch (e) { tfErr.textContent = e.message; }
      };
    } else {
      tf.innerHTML = `<input type="password" id="dp" placeholder="${T.pass}" autocomplete="current-password"><input id="dc" placeholder="${T.code}" autocomplete="one-time-code">
        <button class="ghost" id="nr">${T.newRec}</button><button class="ghost" id="ds">${T.disable}</button>`;
      tf.querySelector('#ds').onclick = async () => {
        try { await call('/hub/api/2fa/disable', { password: tf.querySelector('#dp').value, code: tf.querySelector('#dc').value }); account(); }
        catch (e) { tfErr.textContent = e.message; }
      };
      tf.querySelector('#nr').onclick = async () => {
        try { const r = await call('/hub/api/2fa/recovery', { code: tf.querySelector('#dc').value }); tfErr.textContent = ''; showCodes(tf, r.recovery); }
        catch (e) { tfErr.textContent = e.message; }
      };
    }
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
    document.body.append(host, sheetHost);
    mark();
    $('pill').onclick = menu;
    poll();
    setInterval(poll, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
