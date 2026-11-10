/* llama studio - ícones, utilitários, tipos de arquivo, markdown, estado e navegação */
'use strict';

/* ============================================================ ícones */
const ICONS = {
  flask: '<path d="M9 3h6M10 3v6.5L4.6 18.4A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.4-2.6L14 9.5V3"/><path d="M7.5 15h9"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  hammer: '<path d="m15 12-8.5 8.5a2.12 2.12 0 0 1-3-3L12 9"/><path d="M17.64 15 22 10.64"/><path d="m20.91 11.7-1.25-1.25a1.5 1.5 0 0 1-.44-1.06V7.5l-2.6-2.6A5.5 5.5 0 0 0 12.69 3.3H10l.92.83A6.18 6.18 0 0 1 13 8.73V10l2 2h1.17a1.5 1.5 0 0 1 1.06.44l1.25 1.25"/>',
  palette: '<path d="M12 22a10 10 0 1 1 10-10c0 2.2-1.8 3.5-4 3.5h-2a2 2 0 0 0-1.5 3.3c.5.6.4 1.6-.3 2.2-.6.4-1.4 1-2.2 1z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7" r="1"/><circle cx="16.5" cy="10.5" r="1"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M17 5h4M5 17v4M3 19h4"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"/>',
  folderOpen: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  folderPlus: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"/><path d="M12 10v6M9 13h6"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/>',
  fileCode: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/><path d="m10 13-2 2 2 2M14 17l2-2-2-2"/>',
  fileText: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  filePen: '<path d="M12 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8.5L20 7.5V11"/><path d="M14 2v6h6"/><path d="M18.4 14.6a1.9 1.9 0 0 1 2.7 2.7L16 22.4l-3.5.8.8-3.5z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8"/>',
  captions: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 15h5M13 15h5M6 11h12"/>',
  film: '<rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  send: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  edit: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
  brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 21h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  signpost: '<path d="M12 3v18"/><path d="M5 5h11l3 3-3 3H5z"/><path d="M19 13H8l-3 3 3 3h11z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  git: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  memory: '<path d="M6 19v-3M10 19v-3M14 19v-3M18 19v-3M8 11V9M16 11V9M12 11V9"/><rect x="2" y="5" width="20" height="11" rx="2"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  server: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  branch: '<circle cx="6" cy="5" r="2.2"/><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="8" r="2.2"/><path d="M6 7.2v9.6M18 10.2c0 4-6 3.5-11.2 6.6"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  scale: '<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3.5 3.5 0 0 0 6 0zM19 7l-3 7a3.5 3.5 0 0 0 6 0z"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.5-8.97A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  pin: '<path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
};
function svg(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* ============================================================ utilitários */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'draggable', 'open', 'type', 'rows', 'placeholder', 'title', 'spellcheck']);

// eventos via um despachante por elemento: o morph() pode trocar a função sem recriar o elemento
function listen(el, ev, fn) {
  const hs = (el._h ||= {});
  if (!hs[ev]) el.addEventListener(ev, (e) => el._h[ev]?.(e));
  hs[ev] = fn;
}

function h(tag, attrs, ...kids) {
  // "tag.classe#id" (o #id pode vir em qualquer ponto)
  let id = '';
  tag = tag.replace(/#([\w-]+)/, (_, x) => { id = x; return ''; });
  const [t, ...cls] = tag.split('.');
  const el = document.createElement(t || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (id) el.id = id;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') listen(el, k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'class') el.className = (el.className + ' ' + v).trim();
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
function ic(name, cls) { const t = document.createElement('template'); t.innerHTML = svg(name, cls); return t.content.firstChild; }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
function basename(p) { return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p; }
function extOf(p) { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; }
function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
function fmtMs(ms) { return ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : L('{0} min {1} s', Math.floor(ms / 60000), Math.round((ms % 60000) / 1000)); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* O que a interface guarda vai para o localStorage E para o servidor (dados\ui\<chave>.json). O localStorage do
   WebView2 grava no disco com atraso (fechar o app logo depois perde a mudança), tem limite de uns 10 MB (as
   conversas passam disso e a gravação falha) e é separado por porta e por navegador. Ao abrir, vale a cópia mais
   nova; se o navegador não conseguiu gravar uma chave, vale a do servidor. */
const UI = { srv: {}, t: {}, timers: new Map(), loaded: false };
try { UI.t = JSON.parse(localStorage.getItem('studio.__t') || '{}') || {}; } catch { UI.t = {}; }
try {
  // síncrono de propósito: o estado (S) é montado logo abaixo a partir do que está guardado
  const x = new XMLHttpRequest();
  x.open('GET', '/api/ui', false);
  x.setRequestHeader('X-Studio', '1');
  x.send();
  if (x.status === 200) { UI.srv = JSON.parse(x.responseText).items || {}; UI.loaded = true; }
} catch { /* servidor fora: só o navegador */ }
function uiSaveT() { try { localStorage.setItem('studio.__t', JSON.stringify(UI.t)); } catch { /* cheio */ } }
function uiSend(k, keepalive) {
  const it = UI.srv[k]; if (!it) return Promise.resolve();
  const body = JSON.stringify({ key: k, t: it.t, v: it.v });
  return fetch('/api/ui', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio': '1' }, body, keepalive: keepalive && body.length < 60000 })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); })
    .catch(() => { if (!UI.timers.has(k)) UI.timers.set(k, setTimeout(() => { UI.timers.delete(k); uiSend(k); }, 5000)); });
}
function uiPush(k) {
  clearTimeout(UI.timers.get(k));
  // conversas mudam a cada pedaço de resposta: espera um pouco mais para juntar
  UI.timers.set(k, setTimeout(() => { UI.timers.delete(k); uiSend(k); }, k === 'convs' ? 1200 : 150));
}
/** Manda já o que está pendente (o app chama antes de fechar a janela). */
function uiFlush() {
  const keys = [...UI.timers.keys()];
  for (const k of keys) { clearTimeout(UI.timers.get(k)); UI.timers.delete(k); }
  return Promise.all(keys.map((k) => uiSend(k, true)));
}
window.uiFlush = uiFlush;
/** Primeira vez com a cópia no servidor: manda o que só existe no navegador. */
function uiMigrate() {
  if (!UI.loaded) return;
  for (let i = 0; i < localStorage.length; i++) {
    const full = localStorage.key(i);
    if (!full || !full.startsWith('studio.') || full === 'studio.__t') continue;
    const k = full.slice(7);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(k) || UI.srv[k]) continue;
    try { UI.srv[k] = { t: UI.t[k] || Date.now(), v: JSON.parse(localStorage.getItem(full)) }; uiSend(k); } catch { /* valor estranho: fica só no navegador */ }
  }
}
addEventListener('pagehide', () => { uiFlush(); });

const store = {
  get(k, d) {
    let lv = null;
    try { lv = localStorage.getItem('studio.' + k); } catch { /* sem acesso */ }
    const sv = UI.srv[k];
    if (sv && (lv == null || (sv.t || 0) > (UI.t[k] || 0))) return sv.v ?? d;
    if (lv == null) return d;
    try { return JSON.parse(lv); } catch { return sv ? sv.v ?? d : d; }
  },
  set(k, v) {
    const t = Math.max(Date.now(), (UI.srv[k]?.t || 0) + 1);
    let ok = true;
    try { localStorage.setItem('studio.' + k, JSON.stringify(v)); } catch (e) { ok = false; console.warn('localStorage', k, e); }
    // gravou no navegador: vale a mesma hora do servidor; não gravou (cheio): na próxima abertura vale o servidor
    UI.t[k] = ok ? t : 0; uiSaveT();
    UI.srv[k] = { t, v };
    uiPush(k);
  },
};

async function api(path, body, { raw } = {}) {
  const isBin = body instanceof Blob || body instanceof ArrayBuffer;
  const r = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Studio': '1', ...(body !== undefined && !isBin ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : isBin ? body : JSON.stringify(body),
  });
  if (raw) return r;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || j.error || `${r.status} ${r.statusText}`);
  return j;
}

// histórico dos avisos (Configurações › Avançado): o que apareceu e de onde veio, para ver depois
const TOAST_LOG_KEY = 'studio.toasts';
function toastLog() { try { return JSON.parse(localStorage.getItem(TOAST_LOG_KEY) || '[]'); } catch { return []; } }
function toast(msg, kind = '') {
  try {
    // quem chamou: a primeira linha da pilha fora deste arquivo (arquivo:linha função)
    const from = (new Error().stack || '').split('\n').slice(2).map((l) => /at (?:(\S+) \()?.*\/js\/([\w-]+\.js):(\d+)/.exec(l)).find(Boolean);
    const log = toastLog();
    log.push({ t: Date.now(), msg: String(msg).slice(0, 500), kind, from: from ? `${from[2]}:${from[3]}${from[1] ? ' ' + from[1] : ''}` : '' });
    localStorage.setItem(TOAST_LOG_KEY, JSON.stringify(log.slice(-60)));
  } catch { /* sem armazenamento: só não guarda */ }
  const t = h('div.toast' + (kind ? '.' + kind : ''), null, ic(kind === 'err' ? 'alert' : 'check'), msg);
  $('#toasts').append(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, kind === 'err' ? 5000 : 2600);
}

function modal({ title, body, foot, wide, onClose }) {
  const back = h('div.modal-back');
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const m = h('div.modal' + (wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.modal-head', null, h('h3', null, title), h('button.icon-btn', { onclick: close, 'aria-label': L('Fechar'), html: svg('x') })),
    h('div.modal-body', null, body),
    foot ? h('div.modal-foot', null, foot) : null);
  back.append(m);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $('#modal-root').append(back);
  setTimeout(() => m.querySelector('input, textarea, select')?.focus(), 30);
  return { close, el: m };
}

function confirmBox(text, okLabel = L('Confirmar'), danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title: L('Confirmar'), body: h('p', null, text),
      foot: [
        h('button.btn', { onclick: () => { done = true; m.close(); resolve(false); } }, L('Cancelar')),
        h('button.btn' + (danger ? '.danger' : '.primary'), { onclick: () => { done = true; m.close(); resolve(true); } }, okLabel),
      ],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

function promptBox(title, label, value = '', okLabel = 'OK') {
  return new Promise((resolve) => {
    let done = false;
    const inp = h('input.input.mono', { value });
    const ok = () => { done = true; m.close(); resolve(inp.value.trim()); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    const m = modal({
      title, body: h('div.field', null, h('label', null, label), inp),
      foot: [h('button.btn', { onclick: () => m.close() }, L('Cancelar')), h('button.btn.primary', { onclick: ok }, okLabel)],
      onClose: () => { if (!done) resolve(null); },
    });
  });
}

/* ============================================================ tipos de arquivo */
const FT = [
  [/^(js|mjs|cjs|jsx)$/, '#e5c07b', 'fileCode', 'javascript'], [/^(ts|tsx)$/, '#6aa5e8', 'fileCode', 'typescript'],
  [/^py$/, '#5fa8d3', 'fileCode', 'python'], [/^(c|h)$/, '#8fa3c0', 'fileCode', 'c'], [/^(cpp|cc|hpp|cxx)$/, '#6c8fd8', 'fileCode', 'cpp'],
  [/^cs$/, '#9b7fe0', 'fileCode', 'csharp'], [/^java$/, '#e0875f', 'fileCode', 'java'], [/^go$/, '#5fc4d6', 'fileCode', 'go'],
  [/^rs$/, '#d98b5f', 'fileCode', 'rust'], [/^(rb)$/, '#d65f5f', 'fileCode', 'ruby'], [/^php$/, '#8f8fd6', 'fileCode', 'php'],
  [/^(sh|bash|zsh)$/, '#8cc497', 'terminal', 'bash'], [/^(ps1|psm1)$/, '#5f9fd6', 'terminal', 'powershell'], [/^(bat|cmd)$/, '#8cc497', 'terminal', 'dos'],
  [/^(html|htm)$/, '#e57d5f', 'fileCode', 'xml'], [/^(css|scss|less)$/, '#6a9fe8', 'fileCode', 'css'], [/^(vue|svelte)$/, '#6cc490', 'fileCode', 'xml'],
  [/^(json|jsonc)$/, '#d4a84b', 'braces', 'json'], [/^(yml|yaml|toml|ini|cfg|conf|env)$/, '#b39ddb', 'fileText', 'yaml'],
  [/^(xml|svg)$/, '#e57d5f', 'fileCode', 'xml'], [/^(md|markdown|mdx)$/, '#9fb3c8', 'fileText', 'markdown'], [/^(txt|log|rtf)$/, '#9aa3b5', 'fileText', 'plaintext'],
  [/^sql$/, '#e5c07b', 'table', 'sql'], [/^(csv|tsv|xls|xlsx|ods)$/, '#6cc490', 'table', ''],
  [/^(doc|docx|odt)$/, '#5f8fe0', 'fileText', ''], [/^pdf$/, '#e06666', 'fileText', ''], [/^(ppt|pptx|odp)$/, '#e0875f', 'fileText', ''],
  [/^(png|jpe?g|gif|webp|bmp|ico|tiff?|heic|avif)$/, '#c48fe0', 'image', ''], [/^(mp4|mkv|mov|avi|webm|wmv)$/, '#e08fb3', 'film', ''],
  [/^(mp3|wav|flac|ogg|m4a|aac)$/, '#e08fb3', 'music', ''], [/^(zip|rar|7z|tar|gz|bz2|xz)$/, '#c9a77a', 'archive', ''],
  [/^(gguf|bin|safetensors|pt|onnx)$/, '#d4a84b', 'memory', ''], [/^(exe|dll|msi|so)$/, '#9aa3b5', 'gear', ''],
];
function ftype(name, isDir) {
  if (isDir) return { color: 'var(--brass)', icon: 'folder', lang: '' };
  const e = extOf(name);
  for (const [re, color, icon, lang] of FT) if (re.test(e)) return { color, icon, lang };
  return { color: 'var(--muted)', icon: 'file', lang: '' };
}
const LANG_ALIAS = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', ps1: 'powershell', ps: 'powershell', yml: 'yaml', html: 'xml', vue: 'xml', md: 'markdown', 'c++': 'cpp', 'c#': 'csharp', cs: 'csharp', rs: 'rust', bat: 'dos', cmd: 'dos', text: 'plaintext', txt: 'plaintext', jsonc: 'json' };
const LANG_NAME = { javascript: L('JavaScript'), typescript: L('TypeScript'), python: L('Python'), bash: L('Bash'), powershell: L('PowerShell'), json: 'JSON', yaml: 'YAML', xml: 'HTML', css: 'CSS', markdown: L('Markdown'), cpp: 'C++', c: 'C', csharp: 'C#', java: L('Java'), go: L('Go'), rust: L('Rust'), sql: 'SQL', dos: L('Batch'), plaintext: L('Texto'), php: 'PHP', ruby: L('Ruby') };
const LANG_COLOR = { javascript: '#e5c07b', typescript: '#6aa5e8', python: '#5fa8d3', bash: '#8cc497', powershell: '#5f9fd6', json: '#d4a84b', yaml: '#b39ddb', xml: '#e57d5f', css: '#6a9fe8', markdown: '#9fb3c8', cpp: '#6c8fd8', c: '#8fa3c0', csharp: '#9b7fe0', java: '#e0875f', go: '#5fc4d6', rust: '#d98b5f', sql: '#e5c07b', dos: '#8cc497' };

/* ============================================================ código e markdown */
function highlight(text, lang) {
  lang = LANG_ALIAS[lang] || lang;
  try {
    if (lang && window.hljs?.getLanguage(lang)) return { html: hljs.highlight(text, { language: lang, ignoreIllegals: true }).value, lang };
    if (!lang && window.hljs && text.length < 15000) {
      const r = hljs.highlightAuto(text, ['javascript', 'typescript', 'python', 'bash', 'powershell', 'json', 'xml', 'css', 'cpp', 'csharp', 'java', 'go', 'rust', 'sql', 'yaml', 'markdown']);
      if (r.relevance > 6) return { html: r.value, lang: r.language };
    }
  } catch { /* cai para texto puro */ }
  return { html: esc(text), lang: lang || '' };
}

function codeHTML(text, lang, { title, collapse } = {}) {
  const r = highlight(text.replace(/\n$/, ''), (lang || '').toLowerCase());
  const label = title || LANG_NAME[r.lang] || r.lang || L('Texto');
  const lines = text.split('\n').length;
  const col = collapse && lines > 18;
  return `<div class="code${col ? ' collapsed' : ''}"><div class="code-head"><span class="code-lang" style="--lang:${LANG_COLOR[r.lang] || 'var(--muted)'}"><i></i>${esc(label)}</span><span class="spacer"></span><span class="code-lines">${lines} ${lines === 1 ? L('linha') : L('linhas')}</span><button class="copy-btn" data-copy="1">${svg('copy')}<span>${L('Copiar')}</span></button></div><pre><code class="hljs">${r.html}</code></pre>${col ? `<button class="code-more" data-expand="1">${L('Mostrar tudo')}</button>` : ''}</div>`;
}

if (window.marked) {
  marked.use({
    gfm: true,
    breaks: false,
    renderer: { code(tok) { return codeHTML(tok.text || '', String(tok.lang || '').split(/\s/)[0]); } },
  });
}
const mdCache = new Map();
function md(text) {
  if (!text) return '';
  const hit = mdCache.get(text);
  if (hit) return hit;
  let html;
  try { html = DOMPurify.sanitize(marked.parse(text), { ADD_ATTR: ['data-copy', 'data-expand'] }); }
  catch { html = `<p>${esc(text)}</p>`; }
  if (mdCache.size > 400) mdCache.clear();
  mdCache.set(text, html);
  return html;
}

/**
 * Markdown de um texto que ainda está chegando: os parágrafos já completos são
 * convertidos uma vez só (cache); a cada atualização só o trecho final é refeito.
 * Bloco de código ainda aberto vai como texto simples (sem colorir) até fechar.
 */
function mdLive(text) {
  if (!text) return '';
  let inFence = false; let cut = 0; let i = 0;
  const re = /^(```|~~~)|\n\n/gm;
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) inFence = !inFence;
    else if (!inFence) cut = m.index + 2;
    i = re.lastIndex;
  }
  const head = cut > 0 ? md(text.slice(0, cut)) : '';
  const tail = text.slice(cut);
  if (!tail) return head;
  const fenceOpen = /^(```|~~~)/m.test(tail) && (tail.match(/^(```|~~~)/gm) || []).length % 2 === 1;
  if (fenceOpen) {
    const at = tail.search(/^(```|~~~)/m);
    const before = tail.slice(0, at);
    const code = tail.slice(at).replace(/^(```|~~~)[^\n]*\n?/, '');
    return head + (before.trim() ? md(before) : '') + `<div class="code live"><pre><code>${esc(code)}</code></pre></div>`;
  }
  return head + md(tail);
}

document.addEventListener('click', (e) => {
  const cb = e.target.closest('.copy-btn');
  if (cb) {
    const code = cb.closest('.code')?.querySelector('pre')?.innerText ?? cb.dataset.text ?? '';
    navigator.clipboard.writeText(code).then(() => {
      cb.classList.add('done'); const s = cb.querySelector('span'); if (s) s.textContent = L('Copiado');
      setTimeout(() => { cb.classList.remove('done'); if (s) s.textContent = L('Copiar'); }, 1400);
    });
    return;
  }
  const ex = e.target.closest('[data-expand]');
  if (ex) { ex.closest('.code').classList.remove('collapsed'); ex.remove(); }
});

/* ============================================================ estado */
const TOOL_GROUPS = ['read', 'write', 'edit', 'shell', 'code', 'browser', 'computer', 'history', 'toolsearch', 'explore', 'todo', 'notebook', 'interface', 'video'];
const DEFAULT_SETTINGS = { systemPrompt: '', temperature: '', topP: '', maxTokens: '', maxSteps: 40, approval: 'writes', auditor: false, auditMax: 'baixo', auditMcp: false, auditPolicy: '', theme: 'light', showThinking: true, vision: 'auto', explorerSteps: 20, maxConcurrentExplorers: 0, autoCompact: true, compactAt: 75, compactMode: 'meio', lazyLoad: true, autoRoute: true, autoLevel: 'equilibrado', projMap: false, projSummary: false, tools: Object.fromEntries(TOOL_GROUPS.map((g) => [g, g !== 'interface'])) };
const S = {
  view: 'chat',
  convs: store.get('convs', []),
  curId: store.get('cur', null),
  sel: { skills: [], mcp: [], builtin: true, ...store.get('sel', {}) },
  settings: (() => { const s = { ...DEFAULT_SETTINGS, ...store.get('settings', {}) }; s.tools = { ...DEFAULT_SETTINGS.tools, ...(s.tools || {}) }; return s; })(),
  vision: false,
  nCtx: 0,
  refs: [],
  projects: store.get('projects', []),
  personas: store.get('personas', null),
  tags: store.get('tags', []),
  tagFilter: store.get('tagFilter', null),
  draftPersona: undefined,
  draftModel: undefined,
  models: { models: [], active: null, found: [] },
  runs: new Map(), // id da conversa -> AbortController
  waiting: new Set(), // conversas esperando permissão
  approvals: new Map(),
  openTools: new Set(),
  skills: [],
  mcp: [],
  info: {},
  health: { status: 'unknown' },
  model: '',
  ws: { path: '', expanded: new Set(store.get('wsExpanded', [])), fresh: new Set(), cache: new Map(), selected: null },
};

function running(c) { return !!c && S.runs.has(c.id); }
function cur() { return S.convs.find((c) => c.id === S.curId) || null; }
const saveConvs = debounce(() => {
  // campos que começam com _ (imagens, progresso, estado da sessão) não vão para o disco,
  // nem nas mensagens nem na conversa (um Map salvo vira {} e quebra ao recarregar)
  const strip = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith('_')));
  store.set('convs', S.convs.map((c) => ({ ...strip(c), messages: c.messages.map(strip) })));
  store.set('cur', S.curId);
}, 400);
function saveSel() { store.set('sel', S.sel); saveKit(); }

/* ------------------------------------------------------------ seleção salva por modelo */
// Cada modelo guarda as habilidades, conectores e ferramentas internas que estavam marcados.
// Trocar o modelo de uma conversa (ou abrir uma conversa de outro modelo) traz a seleção dele.
function kitModelId() { return convModel(cur())?.id || null; }
function saveKit(id = kitModelId()) {
  if (!id) return;
  const kits = store.get('modelKits', {});
  kits[id] = { skills: [...S.sel.skills], mcp: [...S.sel.mcp], builtin: S.sel.builtin, tools: { ...S.settings.tools } };
  store.set('modelKits', kits);
}
function applyKit(id, announce) {
  const k = id && store.get('modelKits', {})[id];
  if (!k) return false;
  const same = JSON.stringify([k.skills, k.mcp, k.tools]) === JSON.stringify([S.sel.skills, S.sel.mcp, S.settings.tools]);
  S.sel.skills = [...(k.skills || [])]; S.sel.mcp = [...(k.mcp || [])];
  if (k.builtin !== undefined) S.sel.builtin = k.builtin;
  if (k.tools) S.settings.tools = { ...S.settings.tools, ...k.tools };
  store.set('sel', S.sel); store.set('settings', S.settings);
  updatePickers();
  if (announce && !same) {
    const n = S.sel.skills.length; const m = S.sel.mcp.length;
    toast(L('Seleção de {0}: {1} habilidade{2}, {3} conector{4}', modelById(id)?.name || L('modelo'), n, n === 1 ? '' : 's', m, m === 1 ? '' : 'es'));
  }
  return true;
}

function applyTheme() {
  let t = S.settings.theme;
  if (t === 'auto') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
}

/* ============================================================ navegação */
function setView(v) {
  S.view = v;
  if (S.sideDrawer) toggleSide(false);
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === v && v !== 'chat'));
  const inSet = v === 'settings' || SET_EMBED.some(([id]) => id === v);
  $$('.view').forEach((s) => s.classList.toggle('active', s.id === (inSet ? 'view-settings' : 'view-' + v)));
  if (inSet) {
    $('#settings-form').hidden = v !== 'settings';
    $$('.set-embed').forEach((e) => { e.hidden = e.dataset.v !== v; });
    if (v !== 'settings') { if (!SET_PAGES.length) renderSettings(); drawSetNav('v:' + v); }
    $('#set-pane').scrollTop = 0;
  }
  if (v === 'skills') renderSkillsPage();
  if (v === 'mcp') renderMcpPage();
  if (v === 'settings') renderSettings();
  if (v === 'personas') renderPersonasPage();
  if (v === 'tools') renderToolsPage();
  if (v === 'server') renderServerPage();
  if (v === 'calendar') renderCalendar();
  if (v === 'videos') renderVideos();
  if (v === 'chat') { renderConvList(); setTimeout(() => focusEditor(), 20); }
}
