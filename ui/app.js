/* llama studio - interface */
'use strict';

/* ============================================================ ícones */
const ICONS = {
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
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  git: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  memory: '<path d="M6 19v-3M10 19v-3M14 19v-3M18 19v-3M8 11V9M16 11V9M12 11V9"/><rect x="2" y="5" width="20" height="11" rx="2"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  server: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
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

function h(tag, attrs, ...kids) {
  const [t, ...cls] = tag.split('.');
  const el = document.createElement(t || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
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
function fmtMs(ms) { return ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

const store = {
  get(k, d) { try { const v = localStorage.getItem('studio.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('studio.' + k, JSON.stringify(v)); } catch (e) { console.warn('localStorage', e); } },
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

function toast(msg, kind = '') {
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
    h('div.modal-head', null, h('h3', null, title), h('button.icon-btn', { onclick: close, 'aria-label': 'Fechar', html: svg('x') })),
    h('div.modal-body', null, body),
    foot ? h('div.modal-foot', null, foot) : null);
  back.append(m);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $('#modal-root').append(back);
  setTimeout(() => m.querySelector('input, textarea, select')?.focus(), 30);
  return { close, el: m };
}

function confirmBox(text, okLabel = 'Confirmar', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title: 'Confirmar', body: h('p', null, text),
      foot: [
        h('button.btn', { onclick: () => { done = true; m.close(); resolve(false); } }, 'Cancelar'),
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
      foot: [h('button.btn', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.primary', { onclick: ok }, okLabel)],
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
const LANG_NAME = { javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', bash: 'Bash', powershell: 'PowerShell', json: 'JSON', yaml: 'YAML', xml: 'HTML', css: 'CSS', markdown: 'Markdown', cpp: 'C++', c: 'C', csharp: 'C#', java: 'Java', go: 'Go', rust: 'Rust', sql: 'SQL', dos: 'Batch', plaintext: 'Texto', php: 'PHP', ruby: 'Ruby' };
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
  const label = title || LANG_NAME[r.lang] || r.lang || 'Texto';
  const lines = text.split('\n').length;
  const col = collapse && lines > 18;
  return `<div class="code${col ? ' collapsed' : ''}"><div class="code-head"><span class="code-lang" style="--lang:${LANG_COLOR[r.lang] || 'var(--muted)'}"><i></i>${esc(label)}</span><span class="spacer"></span><span class="code-lines">${lines} ${lines === 1 ? 'linha' : 'linhas'}</span><button class="copy-btn" data-copy="1">${svg('copy')}<span>Copiar</span></button></div><pre><code class="hljs">${r.html}</code></pre>${col ? '<button class="code-more" data-expand="1">Mostrar tudo</button>' : ''}</div>`;
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

document.addEventListener('click', (e) => {
  const cb = e.target.closest('.copy-btn');
  if (cb) {
    const code = cb.closest('.code')?.querySelector('pre')?.innerText ?? cb.dataset.text ?? '';
    navigator.clipboard.writeText(code).then(() => {
      cb.classList.add('done'); const s = cb.querySelector('span'); if (s) s.textContent = 'Copiado';
      setTimeout(() => { cb.classList.remove('done'); if (s) s.textContent = 'Copiar'; }, 1400);
    });
    return;
  }
  const ex = e.target.closest('[data-expand]');
  if (ex) { ex.closest('.code').classList.remove('collapsed'); ex.remove(); }
});

/* ============================================================ estado */
const TOOL_GROUPS = ['read', 'write', 'edit', 'shell', 'code', 'browser', 'computer', 'history', 'toolsearch', 'explore'];
const DEFAULT_SETTINGS = { systemPrompt: '', temperature: '', topP: '', maxTokens: '', maxSteps: 30, approval: 'writes', theme: 'light', showThinking: true, vision: 'auto', explorerSteps: 20, autoCompact: true, compactAt: 75, tools: Object.fromEntries(TOOL_GROUPS.map((g) => [g, true])) };
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
  draftPersona: undefined,
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
  // campos que começam com _ (imagens, progresso) não vão para o disco
  const strip = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith('_')));
  store.set('convs', S.convs.map((c) => ({ ...c, messages: c.messages.map(strip) })));
  store.set('cur', S.curId);
}, 400);
function saveSel() { store.set('sel', S.sel); }

function applyTheme() {
  let t = S.settings.theme;
  if (t === 'auto') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
}

/* ============================================================ navegação */
function setView(v) {
  S.view = v;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === v && v !== 'chat'));
  $$('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
  if (v === 'skills') renderSkillsPage();
  if (v === 'mcp') renderMcpPage();
  if (v === 'settings') renderSettings();
  if (v === 'personas') renderPersonasPage();
  if (v === 'server') renderServerPage();
  if (v === 'chat') { renderConvList(); setTimeout(() => focusEditor(), 20); }
}

/* ============================================================ projetos e personalidades */
const DEFAULT_PERSONAS = [
  { id: 'programador', name: 'Programador', color: '#5b5bd6', prompt: 'Você é um engenheiro de software sênior. Leia o código antes de mudar, prefira mudanças pequenas e corretas, explique o porquê em poucas linhas e mostre o código final completo quando for curto. Rode testes ou comandos para confirmar quando puder.' },
  { id: 'engenheiro-reverso', name: 'Engenheiro reverso', color: '#c2410c', prompt: 'Você é um engenheiro reverso experiente (binários nativos, .NET, Electron/JavaScript, APKs). Use as ferramentas de análise disponíveis antes de concluir. Registre achados com nomes de classes, métodos, assinaturas, offsets e endereços exatos. Separe o que foi confirmado do que é hipótese.' },
  { id: 'revisor', name: 'Revisor de texto', color: '#2f9e58', prompt: 'Você revisa textos em português do Brasil: corrige gramática, clareza e tom sem mudar o sentido. Mostre o texto revisado e, depois, uma lista curta das mudanças mais importantes.' },
];
if (!Array.isArray(S.personas)) S.personas = DEFAULT_PERSONAS.map((p) => ({ ...p }));
const PERSONA_COLORS = ['#5b5bd6', '#c2410c', '#2f9e58', '#b4366b', '#0e7490', '#7c4dcc', '#a16207', '#475569'];

function saveProjects() { store.set('projects', S.projects); }
function savePersonas() { store.set('personas', S.personas); }
function projectOf(c) { return c?.projectId ? S.projects.find((p) => p.id === c.projectId) || null : null; }
function personaOf(c) {
  const id = c ? c.personaId : (S.draftPersona !== undefined ? S.draftPersona : S.settings.defaultPersona);
  return id ? S.personas.find((p) => p.id === id) || null : null;
}
/** Pasta de trabalho da conversa: a do projeto ou a geral. */
function wsOf(c) { return projectOf(c)?.dir || S.info.workspace || ''; }

/** Painel de arquivos acompanha a pasta da conversa aberta. */
function syncWsRoot(force) {
  const w = wsOf(cur());
  if (!w || (w === S.ws.path && !force)) return;
  S.ws.path = w;
  S.ws.cache.clear(); S.ws.fresh.clear();
  S.ws.expanded = new Set(store.get('wsExp:' + w, []));
  $('#ws-preview')?.classList.remove('open');
  renderWsPath(); renderTree(); updatePickers();
}

/* ============================================================ conversas */
function newConv(projectId) {
  const proj = projectId ? S.projects.find((p) => p.id === projectId) : null;
  const personaId = S.draftPersona !== undefined ? S.draftPersona : (proj?.personaId || S.settings.defaultPersona || null);
  S.draftPersona = undefined;
  const c = { id: uid(), title: 'Nova conversa', messages: [], createdAt: Date.now(), updatedAt: Date.now(), autoApprove: false, projectId: proj ? proj.id : null, personaId };
  if (proj) { proj.open = true; saveProjects(); }
  S.convs.unshift(c);
  S.curId = c.id;
  saveConvs();
  renderConvList(); renderChat();
  return c;
}

function selectConv(id) {
  S.curId = id; saveConvs(); closeMention?.();
  if (S.view !== 'chat') setView('chat');
  renderConvList(); renderChat();
}

async function deleteConv(c) {
  if (!(await confirmBox(`Apagar a conversa "${c.title}"?`, 'Apagar', true))) return;
  S.runs.get(c.id)?.abort();
  S.convs = S.convs.filter((x) => x.id !== c.id);
  if (S.curId === c.id) S.curId = S.convs[0]?.id || null;
  saveConvs(); renderConvList(); renderChat();
}

function convRow(c, nested) {
  const active = c.id === S.curId && S.view === 'chat';
  const row = h('div.conv' + (active ? '.active' : '') + (nested ? '.nested' : ''), { onclick: () => selectConv(c.id), title: c.title },
    h('span.conv-name', null, c.title),
    S.waiting.has(c.id) ? h('span.wait-dot', { title: 'Esperando sua permissão' }) : running(c) ? h('span.run-dot', { title: 'Respondendo em segundo plano' }) : null,
    h('button.icon-btn', { title: 'Apagar', 'aria-label': 'Apagar', html: svg('trash'), onclick: (e) => { e.stopPropagation(); deleteConv(c); } }));
  row.addEventListener('dblclick', () => renameConv(c, row));
  return row;
}

function secHead(key, label, extra) {
  const open = store.get('sec:' + key, true);
  return [h('div.sec-row', null,
    h('button.sec-head', { 'aria-expanded': String(open), onclick: () => { store.set('sec:' + key, !open); renderConvList(); } }, h('span', { html: svg('chev'), style: { display: 'contents' } }), h('span', null, label)),
    extra || null), open];
}

function renderConvList() {
  const box = $('#conv-list'); box.innerHTML = '';
  const q = ($('#search').value || '').trim().toLowerCase();
  const match = (c) => !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => m.role === 'user' && (m.content || '').toLowerCase().includes(q));
  const curProj = projectOf(cur());

  // projetos
  const [phead, popen] = secHead('projects', 'Projetos', h('button.icon-btn.sm', { title: 'Novo projeto', 'aria-label': 'Novo projeto', html: svg('plus'), onclick: () => editProject(null) }));
  box.append(phead);
  if (popen || q) {
    if (!S.projects.length && !q) box.append(h('div.side-empty', null, 'Projetos agrupam conversas que trabalham na mesma pasta.'));
    for (const p of [...S.projects].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))) {
      const convs = S.convs.filter((c) => c.projectId === p.id && match(c)).sort((a, b) => b.updatedAt - a.updatedAt);
      if (q && !convs.length && !p.name.toLowerCase().includes(q)) continue;
      const busy = convs.some((c) => running(c));
      box.append(h('div.proj' + (curProj?.id === p.id ? '.active' : ''), { onclick: () => { p.open = !p.open; saveProjects(); renderConvList(); }, title: p.dir },
        h('span', { html: svg(p.open || q ? 'folderOpen' : 'folder'), style: { display: 'contents' } }),
        h('span.conv-name', null, p.name),
        busy ? h('span.run-dot', { title: 'Alguma conversa está respondendo' }) : h('span.proj-count', null, S.convs.filter((c) => c.projectId === p.id).length || ''),
        h('button.icon-btn', { title: 'Nova conversa neste projeto', 'aria-label': 'Nova conversa neste projeto', html: svg('plus'), onclick: (e) => { e.stopPropagation(); newConv(p.id); setView('chat'); } }),
        h('button.icon-btn', { title: 'Configurar projeto', 'aria-label': 'Configurar projeto', html: svg('gear'), onclick: (e) => { e.stopPropagation(); editProject(p); } })));
      if (p.open || q) {
        for (const c of convs) box.append(convRow(c, true));
        if (!convs.length && !q) box.append(h('button.side-empty.nested.link', { onclick: () => { newConv(p.id); setView('chat'); } }, '+ Começar uma conversa aqui'));
      }
    }
  }

  // conversas sem projeto
  const [rhead, ropen] = secHead('recent', 'Conversas');
  box.append(rhead);
  if (!ropen && !q) return;
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups = [['Hoje', (t) => t >= today], ['Ontem', (t) => t >= today - 864e5 && t < today], ['Últimos 7 dias', (t) => t >= today - 7 * 864e5 && t < today - 864e5], ['Mais antigas', (t) => t < today - 7 * 864e5]];
  const sorted = S.convs.filter((c) => !projectOf(c) && match(c)).sort((a, b) => b.updatedAt - a.updatedAt);
  for (const [label, test] of groups) {
    const items = sorted.filter((c) => test(c.updatedAt));
    if (!items.length) continue;
    box.append(h('div.conv-group', null, label));
    for (const c of items) box.append(convRow(c, false));
  }
  if (!sorted.length) box.append(h('div.side-empty', null, q ? 'Nada encontrado.' : 'Suas conversas aparecem aqui.'));
}

/** Criar ou configurar um projeto. */
async function editProject(p) {
  const isNew = !p;
  const name = h('input.input', { value: p?.name || '', placeholder: 'Ex.: Decompilar dll' });
  const dir = h('input.input.mono', { value: p?.dir || '', placeholder: 'Pasta onde as conversas do projeto trabalham' });
  const instr = h('textarea.textarea', { rows: 5, value: p?.instructions || '', placeholder: 'Contexto que vale para todas as conversas do projeto. Ex.: o alvo é o arquivo app.dll; registre os achados em notas.md.' });
  const persona = h('select.select', null, h('option', { value: '' }, 'Nenhuma (usa a padrão)'), S.personas.map((x) => h('option', { value: x.id }, x.name)));
  persona.value = p?.personaId || '';
  const browse = h('button.btn', { type: 'button', onclick: async () => { const r = await pickPath({ title: 'Pasta do projeto', mode: 'dir', start: dir.value || S.info.workspace }); if (r) { dir.value = r; if (!name.value.trim()) name.value = basename(r); } } }, 'Procurar');
  let m;
  const save = async () => {
    const n = name.value.trim(); const d = dir.value.trim().replace(/^"|"$/g, '');
    if (!n) { toast('Dê um nome ao projeto.', 'err'); return; }
    if (!d) { toast('Escolha a pasta do projeto.', 'err'); return; }
    const st = await api('/api/stat', { path: d }).catch(() => ({}));
    if (!st.exists || !st.dir) { toast('Essa pasta não existe.', 'err'); return; }
    if (isNew) {
      const np = { id: uid(), name: n, dir: st.path, instructions: instr.value.trim(), personaId: persona.value || null, createdAt: Date.now(), open: true };
      S.projects.push(np); saveProjects(); m.close();
      newConv(np.id); setView('chat');
      toast(`Projeto "${n}" criado`);
    } else {
      Object.assign(p, { name: n, dir: st.path, instructions: instr.value.trim(), personaId: persona.value || null });
      saveProjects(); m.close(); renderConvList(); renderChatTitle(); syncWsRoot(true);
      toast('Projeto salvo');
    }
  };
  m = modal({
    title: isNew ? 'Novo projeto' : `Projeto: ${p.name}`,
    body: h('div.form', null,
      h('div.field', null, h('label', null, 'Nome'), name),
      h('div.field', null, h('label', null, 'Pasta do projeto'), h('div.inline', null, dir, browse), h('small', null, 'Todas as conversas do projeto leem e escrevem aqui.')),
      h('div.field', null, h('label', null, 'Instruções do projeto'), instr),
      h('div.field', null, h('label', null, 'Personalidade das conversas novas'), persona)),
    foot: [
      !isNew ? h('button.btn.danger', { style: { marginRight: 'auto' }, onclick: async () => {
        const n = S.convs.filter((c) => c.projectId === p.id).length;
        if (!(await confirmBox(`Apagar o projeto "${p.name}"? ${n ? `As ${n} conversas dele continuam, como conversas avulsas.` : ''} A pasta não é apagada.`, 'Apagar projeto', true))) return;
        S.convs.forEach((c) => { if (c.projectId === p.id) c.projectId = null; });
        S.projects = S.projects.filter((x) => x.id !== p.id);
        saveProjects(); saveConvs(); m.close(); renderConvList(); renderChat();
      } }, 'Apagar projeto') : null,
      h('button.btn', { onclick: () => m.close() }, 'Cancelar'),
      h('button.btn.primary', { onclick: save }, isNew ? 'Criar projeto' : 'Salvar'),
    ],
  });
}

/* ------------------------------------------------------------ personalidades */
function renderPersonasPage() {
  const grid = $('#persona-grid'); grid.innerHTML = '';
  if (!S.personas.length) grid.append(h('div.empty-card', null, 'Nenhuma personalidade. Crie uma para mudar o jeito de o modelo trabalhar.'));
  for (const p of S.personas) {
    const isDef = S.settings.defaultPersona === p.id;
    grid.append(h('div.skill.persona', null,
      h('div.skill-top', null, h('div.p-avatar', { style: { background: p.color } }, (p.name[0] || '?').toUpperCase()), h('div.skill-name', null, p.name), isDef ? h('span.tag', null, 'padrão') : null),
      h('div.skill-desc', null, p.prompt || 'Sem instruções.'),
      h('div.skill-foot', null,
        h('span', null, `${p.prompt.length} caracteres`), h('span.spacer'),
        !isDef ? h('button.btn.ghost.sm', { onclick: () => { S.settings.defaultPersona = p.id; store.set('settings', S.settings); renderPersonasPage(); updatePickers(); toast(`${p.name} é a personalidade padrão`); } }, 'Usar como padrão')
          : h('button.btn.ghost.sm', { onclick: () => { S.settings.defaultPersona = null; store.set('settings', S.settings); renderPersonasPage(); updatePickers(); } }, 'Tirar padrão'),
        h('button.icon-btn.sm', { title: 'Editar', 'aria-label': 'Editar', html: svg('edit'), onclick: () => editPersona(p) }),
        h('button.icon-btn.sm', { title: 'Apagar', 'aria-label': 'Apagar', html: svg('trash'), onclick: async () => {
          if (!(await confirmBox(`Apagar a personalidade "${p.name}"?`, 'Apagar', true))) return;
          S.personas = S.personas.filter((x) => x.id !== p.id);
          if (S.settings.defaultPersona === p.id) { S.settings.defaultPersona = null; store.set('settings', S.settings); }
          savePersonas(); renderPersonasPage(); updatePickers();
        } }))));
  }
}

function editPersona(p) {
  const isNew = !p;
  let color = p?.color || PERSONA_COLORS[S.personas.length % PERSONA_COLORS.length];
  const name = h('input.input', { value: p?.name || '', placeholder: 'Ex.: Commander' });
  const prompt = h('textarea.textarea', { rows: 12, value: p?.prompt || '', placeholder: 'Quem o modelo é, como deve pensar, falar e trabalhar. Ex.: Você é um analista de segurança. Responda em tópicos, cite as evidências...' });
  prompt.style.minHeight = '260px';
  const swatches = h('div.swatches', null, PERSONA_COLORS.map((c) => {
    const b = h('button.swatch' + (c === color ? '.on' : ''), { type: 'button', style: { background: c }, 'aria-label': 'Cor', onclick: () => { color = c; $$('.swatch', swatches).forEach((x) => x.classList.toggle('on', x === b)); } });
    return b;
  }));
  let m;
  m = modal({
    title: isNew ? 'Nova personalidade' : `Editar ${p.name}`, wide: true,
    body: h('div.form', null,
      h('div.row', null, h('div.field', null, h('label', null, 'Nome'), name), h('div.field', null, h('label', null, 'Cor'), swatches)),
      h('div.field', null, h('label', null, 'Prompt de sistema'), prompt, h('small', null, 'Entra depois do prompt geral das configurações e antes das instruções do projeto.'))),
    foot: [h('button.btn', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.primary', { onclick: () => {
      const n = name.value.trim();
      if (!n) { toast('Dê um nome à personalidade.', 'err'); return; }
      if (isNew) S.personas.push({ id: uid(), name: n, color, prompt: prompt.value.trim() });
      else Object.assign(p, { name: n, color, prompt: prompt.value.trim() });
      savePersonas(); m.close(); renderPersonasPage(); updatePickers(); renderMessages(false);
      toast(isNew ? 'Personalidade criada' : 'Personalidade salva');
    } }, isNew ? 'Criar' : 'Salvar')],
  });
}

function fillPersonaPop() {
  const pop = $('#pop-persona'); pop.innerHTML = '';
  const c = cur(); const curP = personaOf(c);
  const pick = (id) => {
    if (c) { c.personaId = id; saveConvs(); } else S.draftPersona = id;
    closePops(); updatePickers(); renderMessages(false);
  };
  pop.append(h('div.pop-head', null, h('span', null, c ? 'Personalidade desta conversa' : 'Personalidade da próxima conversa')));
  pop.append(h('button.menu-item' + (!curP ? '.hl' : ''), { onclick: () => pick(null) }, h('span.p-dot', { style: { background: 'var(--line-2)' } }), h('span.mi-main', null, 'Sem personalidade', h('span.mi-sub', null, 'Só o prompt geral das configurações'))));
  for (const p of S.personas) {
    pop.append(h('button.menu-item' + (curP?.id === p.id ? '.hl' : ''), { onclick: () => pick(p.id) }, h('span.p-dot', { style: { background: p.color } }), h('span.mi-main', null, p.name, h('span.mi-sub', null, p.prompt.split('\n')[0]))));
  }
  pop.append(h('div.pop-foot', null, h('button.btn.ghost.sm.wide', { onclick: () => { closePops(); setView('personas'); } }, ic('gear'), 'Gerenciar personalidades')));
}

function renameConv(c, row) {
  const name = row.querySelector('.conv-name');
  const inp = h('input', { value: c.title });
  name.replaceWith(inp); inp.focus(); inp.select();
  let finished = false;
  const done = () => { if (finished) return; finished = true; c.title = inp.value.trim() || c.title; saveConvs(); renderConvList(); renderChatTitle(); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') { finished = true; renderConvList(); } });
  inp.addEventListener('blur', done);
  inp.addEventListener('click', (e) => e.stopPropagation());
}

function renderChatTitle() {
  const c = cur();
  $('#chat-title').textContent = c ? c.title : 'Nova conversa';
  document.title = c && c.messages.length ? `${c.title} - llama studio` : 'llama studio';
  const sub = $('#chat-sub'); sub.innerHTML = '';
  const proj = projectOf(c);
  if (proj) sub.append(h('span.proj-chip', { title: proj.dir, onclick: () => editProject(proj) }, ic('folder'), proj.name), h('span.sep'));
  sub.append(h('span.sq'), h('span', { title: S.ws.path }, basename(wsOf(c)) || 'sem pasta'));
  const pers = personaOf(c);
  if (pers) sub.append(h('span.sep'), h('span', { style: { color: pers.color } }, pers.name));
  if (S.model) sub.append(h('span.sep'), h('span.model', null, shortModel(S.model)));
  const act = activeSel(c);
  if (act.skills.length) sub.append(h('span.sep'), h('span', { style: { color: 'var(--skill)' } }, `${act.skills.length} ${act.skills.length === 1 ? 'habilidade' : 'habilidades'}`));
  if (act.mcp.length) sub.append(h('span.sep'), h('span', { style: { color: 'var(--mcp)' } }, `${act.mcp.length} ${act.mcp.length === 1 ? 'conector' : 'conectores'}`));
}

function fillConvMenu() {
  const pop = $('#pop-conv'); pop.innerHTML = '';
  const c = cur();
  if (!c) { pop.append(h('div.pop-empty', null, 'Nenhuma conversa aberta.')); return; }
  pop.append(
    h('button.menu-item', { onclick: async () => { closePops(); const t = await promptBox('Renomear conversa', 'Título', c.title, 'Renomear'); if (t) { c.title = t; saveConvs(); renderConvList(); renderChatTitle(); } } }, ic('edit'), 'Renomear'),
    h('button.menu-item', { onclick: () => { closePops(); exportConv(c); } }, ic('download'), 'Exportar como Markdown'),
    h('button.menu-item', { onclick: () => { closePops(); compactNow(c); } }, ic('archive'), 'Compactar agora'),
    h('button.menu-item', { onclick: () => { closePops(); c.autoApprove = !c.autoApprove; saveConvs(); toast(c.autoApprove ? 'Ferramentas liberadas nesta conversa' : 'Confirmação reativada'); } }, ic('check'), c.autoApprove ? 'Voltar a pedir confirmação' : 'Permitir ferramentas sem perguntar'),
    h('div.menu-sep'),
    h('button.menu-item.danger', { onclick: () => { closePops(); deleteConv(c); } }, ic('trash'), 'Apagar conversa'));
}

function exportConv(c) {
  const lines = [`# ${c.title}`, ''];
  for (const m of c.messages) {
    if (m.role === 'user') lines.push('## Você', '', userContent(m), '');
    else if (m.role === 'assistant') {
      const t = splitThink(m.content).text.trim();
      if (t) lines.push('## llama', '', t, '');
      for (const tc of m.tool_calls || []) lines.push(`> Ferramenta \`${tc.function.name}\` ${tc.function.arguments}`, '');
    }
  }
  api('/api/export', { name: c.title, text: lines.join('\n'), ws: wsOf(c) })
    .then((r) => { toast('Conversa salva em ' + r.path); api('/api/reveal', { path: r.path, ws: wsOf(c) }).catch(() => {}); refreshTree(); })
    .catch((e) => toast(e.message, 'err'));
}

/* ============================================================ mensagens */
function splitThink(content) {
  const c = content || '';
  const open = c.indexOf('<think>');
  const close = c.indexOf('</think>');
  if (open >= 0 && (open === 0 || !c.slice(0, open).trim())) {
    if (close < 0) return { think: c.slice(open + 7), text: '', thinking: true };
    return { think: c.slice(open + 7, close), text: c.slice(close + 8) };
  }
  if (open < 0 && close >= 0) return { think: c.slice(0, close), text: c.slice(close + 8) };
  return { think: '', text: c };
}

function blocksOf(conv) {
  const out = []; let ai = null;
  conv.messages.forEach((m, i) => {
    if (m.hidden) return;
    if (m.role === 'user' || m.role === 'error') { out.push({ type: m.role, msgs: [m], start: i }); ai = null; }
    else { if (!ai) { ai = { type: 'ai', msgs: [], start: i }; out.push(ai); } ai.msgs.push(m); }
  });
  return out;
}

function nearBottom() { const el = $('#messages'); return el.scrollHeight - el.scrollTop - el.clientHeight < 140; }
function toBottom() { const el = $('#messages'); el.scrollTop = el.scrollHeight; }

let rafPending = false;
function scheduleRender() {
  if (S.runs.size) renderConvListSoon();
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; renderMessages(true); });
}

const renderConvListSoon = debounce(() => renderConvList(), 300);

function renderChat() { syncWsRoot(); renderChatTitle(); renderMessages(false); renderComposer(); }

function renderMessages(onlyLast) {
  const box = $('#messages');
  const conv = cur();
  const stick = nearBottom();
  if (!conv || !conv.messages.length) { box.innerHTML = ''; box.append(renderEmpty()); return; }
  const blocks = blocksOf(conv);
  if (onlyLast && box.lastElementChild?.dataset.start == blocks[blocks.length - 1].start && box.children.length === blocks.length) {
    box.lastElementChild.replaceWith(renderBlock(blocks[blocks.length - 1], conv, true));
  } else {
    box.innerHTML = '';
    const cut = conv.compactCut || 0; let marked = false;
    blocks.forEach((b, i) => {
      if (cut && !marked && b.start >= cut) { marked = true; box.append(compactMark(conv)); }
      box.append(renderBlock(b, conv, i === blocks.length - 1));
    });
  }
  if (stick || !onlyLast) toBottom();
}

function renderEmpty() {
  const starters = [
    ['folderOpen', 'Liste o que tem no espaço de trabalho e resuma do que se trata'],
    ['fileCode', 'Crie um script Python que renomeia fotos pela data'],
    ['eye', 'Leia o README desta pasta e sugira melhorias'],
    ['pin', 'Arraste um arquivo para cá e peça para explicar o que ele faz'],
  ];
  return h('div.empty', null,
    h('div.empty-mark', null, 'L'),
    h('h2', null, 'O que vamos fazer hoje?'),
    h('p', null, 'O modelo roda no seu computador. Ele pode ler e escrever no espaço de trabalho, seguir as habilidades que você ativar e usar os conectores MCP.'),
    h('div.starters', null, starters.map(([icon, s]) => h('button.starter', { onclick: () => { setEditorText(s); focusEditor(); } }, ic(icon), h('span', null, s)))));
}

function compactMark(conv) {
  const d = h('details.compact-mark', null,
    h('summary', null, ic('archive'), h('span', null, `Conversa compactada${conv.compactions > 1 ? ` ${conv.compactions} vezes` : ''}: o que vem antes daqui foi resumido para o modelo`), h('span.cm-see', null, 'ver resumo')),
    h('div.md', { html: md(conv.summary || '') }));
  return d;
}

function fmtStamp(t) {
  if (!t) return '';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderBlock(b, conv, isLast) {
  if (b.type === 'user') return renderUser(b.msgs[0], b.start, conv);
  if (b.type === 'error') {
    return h('div.err-box', { dataset: { start: b.start } }, ic('alert'), h('div', null, b.msgs[0].content),
      isLast && !running(conv) ? h('button.btn.sm', { onclick: () => { conv.messages.splice(b.start, 1); runAgent(conv); } }, ic('refresh'), 'Tentar de novo') : null);
  }
  return renderAI(b, conv, isLast);
}

function pillEl(p) {
  const kind = p.kind;
  const label = kind === 'skill' ? 'Habilidade' : kind === 'mcp' ? 'Conector' : 'Arquivo';
  const name = kind === 'file' ? (p.name || basename(p.path)) : p.name;
  const el = h('span.pill.pill-' + kind, { title: kind === 'file' ? p.path : `${label}: ${name}` }, h('span.k', null, label + ':'), name);
  if (kind === 'file' && p.path) el.addEventListener('click', () => api('/api/reveal', { path: p.path, ws: S.ws.path }).catch((e) => toast(e.message, 'err')));
  return el;
}

function renderUser(m, idx, conv) {
  const bubble = h('div.bubble');
  if (m.parts?.length) {
    for (const p of m.parts) {
      if (p.t === 'text') bubble.append(p.v);
      else if (p.t === 'br') bubble.append('\n');
      else bubble.append(pillEl(p));
    }
  } else bubble.append(m.content || '');
  return h('div.msg.msg-user', { dataset: { start: idx } },
    h('div.stamp', null, fmtStamp(m.ts)),
    bubble,
    h('div.chips', null,
      h('button.chip', { onclick: () => navigator.clipboard.writeText(m.content || '').then(() => toast('Copiado')) }, ic('copy'), 'Copiar'),
      h('button.chip', { onclick: () => editFrom(conv, idx) }, ic('edit'), 'Editar')));
}

function editFrom(conv, idx) {
  if (running(conv)) return;
  const m = conv.messages[idx];
  conv.messages.splice(idx);
  loadEditorParts(m.parts || [{ t: 'text', v: m.content || '' }]);
  saveConvs(); renderChat(); focusEditor(true);
}

function renderAI(b, conv, isLast) {
  const live = isLast && running(conv);
  const results = new Map(b.msgs.filter((m) => m.role === 'tool').map((m) => [m.tool_call_id, m]));
  const assistants = b.msgs.filter((m) => m.role === 'assistant');
  const last = assistants[assistants.length - 1];
  const toolMsgs = b.msgs.filter((m) => m.role === 'tool');
  const toolCount = assistants.reduce((n, m) => n + (m.tool_calls?.length || 0), 0);
  const reads = toolMsgs.filter((m) => ['read_file', 'list_directory', 'search_files', 'read_skill_file'].includes(m.name)).length;
  const writes = toolMsgs.filter((m) => ['write_file', 'edit_file', 'create_directory'].includes(m.name) && m.status === 'ok').length;
  const t0 = b.msgs[0]?.t0; const t1 = last?.t1;
  const aborted = !live && b.aborted;

  const card = h('div.ai-card');
  if (!live && t0 && t1 && t1 - t0 > 1500) {
    card.append(h('div.ai-status', null, h('span', null, 'Duração'), h('b', null, fmtMs(t1 - t0)), last?.tps ? h('span.muted', null, `${last.tps.toFixed(1)} tok/s`) : null));
  }
  assistants.forEach((m, ai) => {
    const sp = splitThink(m.content);
    const think = (m.reasoning || '') + (sp.think || '');
    const thinkingNow = live && m === last && !sp.text && !m.tool_calls?.length && (m.reasoning || sp.thinking);
    if (think.trim() && S.settings.showThinking) {
      const key = `think-${b.start}-${ai}`;
      const d = h('details.think' + (thinkingNow ? '.live' : ''), { open: thinkingNow || S.openTools.has(key) },
        h('summary', null, h('span', { html: svg('chev', 'chev'), style: { display: 'contents' } }), ic('brain'), h('span.lbl', null, thinkingNow ? 'Pensando...' : `Raciocínio (${think.trim().split(/\s+/).length} palavras)`)),
        h('div.think-body', null, think.trim()));
      d.addEventListener('toggle', () => { if (d.open) S.openTools.add(key); else S.openTools.delete(key); });
      card.append(d);
    }
    if (sp.text.trim()) card.append(h('div.md', { html: md(sp.text) }));
    if (m.tool_calls?.length) card.append(h('div.trace', null, m.tool_calls.map((tc) => renderTool(tc, results.get(tc.id), live))));
  });
  if (live && conv._waitingModel) card.append(h('div.ai-status', null, h('span', { html: svg('loader', 'spin'), style: { display: 'grid' } }), 'Esperando o modelo terminar de carregar. A resposta começa sozinha.'));
  if (live && conv._compacting) card.append(h('div.ai-status', null, h('span', { html: svg('loader', 'spin'), style: { display: 'grid' } }), 'Compactando a conversa para caber no contexto...'));
  const waiting = live && !conv._compacting && !conv._waitingModel && (!card.childElementCount || (last && !last.content && !last.reasoning && !last.tool_calls?.length && toolMsgs.length));
  if (waiting) card.append(h('div.typing', null, h('i'), h('i'), h('i')));
  if (!live && !assistants.some((m) => splitThink(m.content).text.trim() || m.tool_calls?.length)) card.append(h('div.muted', null, 'Execução interrompida.'));

  if (!live && toolCount) {
    const parts = [h('span', null, 'Este turno executou ', h('b', null, `${toolCount} ${toolCount === 1 ? 'chamada' : 'chamadas'} de ferramenta`))];
    if (reads) parts.push(h('span', null, `${reads} ${reads === 1 ? 'leitura' : 'leituras'}`));
    if (writes) parts.push(h('span', null, `${writes} ${writes === 1 ? 'alteração de arquivo' : 'alterações de arquivo'}`));
    card.append(h('div.ai-foot', null, parts));
  }

  const finalText = assistants.map((m) => splitThink(m.content).text).filter((t) => t.trim()).join('\n\n');
  return h('div.msg.msg-ai', { dataset: { start: b.start } },
    (() => { const pp = personaOf(conv); return h('div.ai-head', null, h('div.ai-avatar', { style: pp ? { background: pp.color, color: '#fff', borderColor: pp.color } : null }, pp ? (pp.name[0] || 'L').toUpperCase() : 'L'), h('span.ai-name', null, pp ? pp.name : 'llama'), h('span.stamp', null, fmtStamp(t0))); })(),
    card,
    !live ? h('div.chips', null,
      h('button.chip', { onclick: () => navigator.clipboard.writeText(finalText).then(() => toast('Resposta copiada')) }, ic('copy'), 'Copiar'),
      isLast ? h('button.chip', { onclick: () => { conv.messages.splice(b.start); runAgent(conv); } }, ic('refresh'), 'Tentar novamente') : null,
      isLast && toolCount ? h('button.chip', { onclick: () => { $$('.tool', card).forEach((t) => { t.classList.add('open'); }); } }, ic('list'), 'Expandir ferramentas') : null) : null);
}

function shortModel(p) { return basename(p).replace(/\.gguf$/i, ''); }

/* ------------------------------------------------------------ cartões de ferramenta */
function parseArgs(s) {
  if (s && typeof s === 'object') return s;
  try { return JSON.parse(s || '{}'); } catch { return null; }
}

const TOOL_ICON = { list_directory: 'list', read_file: 'eye', write_file: 'filePen', edit_file: 'edit', create_directory: 'folderPlus', search_files: 'search', read_skill_file: 'book', run_command: 'terminal', execute_code: 'code', recall_history: 'history', search_tools: 'search', explore: 'compass' };
function toolIcon(name, source) {
  if (source === 'mcp') return 'plug';
  if (name.startsWith('browser_')) return 'globe';
  if (name.startsWith('computer_')) return 'monitor';
  return TOOL_ICON[name] || 'wrench';
}

function toolSummary(name, args) {
  if (!args) return '';
  const pick = args.task || args.path || args.file_path || args.url || args.query || args.name || args.command || args.keys || args.text || args.window || args.pattern || args.skill || (args.id != null ? `#${args.id}` : '');
  if (typeof pick === 'string') return pick;
  const first = Object.values(args).find((v) => typeof v === 'string');
  return first ? first.slice(0, 120) : '';
}

function renderTool(tc, res, live) {
  const name = tc.function?.name || '...';
  const meta = res || {};
  const source = meta.source || (name.includes('__') ? 'mcp' : 'builtin');
  const args = parseArgs(tc.function?.arguments);
  const status = res ? res.status || (res.isError ? 'error' : 'ok') : (live ? 'pending' : 'error');
  const key = tc.id;
  const open = S.openTools.has(key);
  const el = h('div.tool.s-' + status + '.src-' + source + (open ? '.open' : ''));

  let displayName = name; let server = '';
  if (source === 'mcp') {
    const i = name.indexOf('__');
    if (i > 0) { server = meta.server || name.slice(0, i); displayName = name.slice(i + 2); }
  }
  const stateEl = {
    pending: [h('span', { html: svg('loader', 'spin') }), 'preparando'],
    approval: [h('span', { html: svg('alert') }), 'aguardando você'],
    running: [h('span', { html: svg('loader', 'spin') }), 'executando'],
    ok: [h('span', { html: svg('check') }), meta.ms != null ? fmtMs(meta.ms) : 'ok'],
    error: [h('span', { html: svg('alert') }), res ? 'erro' : 'interrompida'],
    denied: [h('span', { html: svg('ban') }), 'negada'],
  }[status];

  const head = h('button.tool-head', { onclick: () => { el.classList.toggle('open'); if (el.classList.contains('open')) S.openTools.add(key); else S.openTools.delete(key); } },
    h('span.tool-ico', { html: svg(toolIcon(name, source)) }),
    h('span.tool-name', null, displayName),
    server ? h('span.tool-server', null, server) : null,
    h('span.tool-sub', null, toolSummary(name, args)),
    h('span.tool-state', null, stateEl),
    h('span', { html: svg('chev', 'chev'), style: { display: 'contents' } }));

  const bodyEl = h('div.tool-body');
  if (name === 'run_command' && args) {
    bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, args.cwd ? `Comando (em ${args.cwd})` : 'Comando'), h('div', { html: codeHTML(String(args.command || ''), 'powershell', { title: 'PowerShell' }) })));
  } else if ((name === 'execute_code' || name === 'browser_eval') && args) {
    bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, 'Código'), h('div', { html: codeHTML(String(args.code || ''), 'javascript', { title: 'JavaScript', collapse: true }) })));
  } else if (name === 'explore' && args) {
    bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, 'Tarefa do subagente'), h('div.md', { html: md(args.task + (args.where ? `\n\n**Começar por:** ${args.where}` : '')) })));
  } else if (name === 'write_file' && args) {
    bodyEl.append(h('div.tool-sec', null,
      h('div.tool-sec-label', null, `Conteúdo escrito em ${args.path || ''}`),
      h('div', { html: codeHTML(String(args.content ?? ''), ftype(args.path || '').lang, { title: basename(args.path || 'arquivo'), collapse: true }) })));
  } else if (name === 'edit_file' && args) {
    const diff = h('div.diff');
    String(args.old_text ?? '').split('\n').forEach((l) => diff.append(h('div.del', null, l || ' ')));
    String(args.new_text ?? '').split('\n').forEach((l) => diff.append(h('div.add', null, l || ' ')));
    bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, `Alteração em ${args.path || ''}${args.replace_all ? ' (todas as ocorrências)' : ''}`), diff));
  } else if (args && Object.keys(args).length) {
    const vals = Object.values(args);
    const simple = vals.every((v) => v == null || ['string', 'number', 'boolean'].includes(typeof v)) && vals.every((v) => String(v).length < 600);
    if (simple) {
      const dl = h('dl.kv');
      for (const [k, v] of Object.entries(args)) dl.append(h('dt', null, k), h('dd', null, String(v)));
      bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, 'Argumentos'), dl));
    } else {
      bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, 'Argumentos'), h('div', { html: codeHTML(JSON.stringify(args, null, 2), 'json', { collapse: true }) })));
    }
  } else if (!args && tc.function?.arguments) {
    bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, 'Argumentos'), h('pre.result-text', null, tc.function.arguments)));
  }

  if (res?._sub?.length) {
    const steps = h('div.substeps');
    for (const st of res._sub) {
      steps.append(h('div.substep.s-' + st.status, null,
        h('span', { html: svg(st.status === 'running' ? 'loader' : st.status === 'error' ? 'alert' : 'check', st.status === 'running' ? 'spin' : '') }),
        h('span.ss-name', null, st.name), h('span.ss-sub', null, st.summary || '')));
    }
    bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, name === 'explore' ? `Passos do subagente (${res._sub.length})` : `Ferramentas chamadas pelo código (${res._sub.length})`), steps));
  }
  if (res?._images?.length) {
    bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, 'Imagem'), ...res._images.map((src) => h('img.tool-img', { src, alt: 'Captura', onclick: () => window.open(src) }))));
  }
  if (res && res.content && status !== 'approval') {
    const content = res.content;
    let inner; let parsed = null;
    if (/^\s*[[{]/.test(content)) { try { parsed = JSON.parse(content); } catch { /* texto */ } }
    if (parsed && !res.isError) inner = h('div', { html: codeHTML(JSON.stringify(parsed, null, 2), 'json', { collapse: true }) });
    else if (name === 'read_file' && !res.isError && args?.path && ftype(args.path).lang) inner = h('div', { html: codeHTML(content, ftype(args.path).lang, { title: basename(args.path), collapse: true }) });
    else if (name === 'explore' && !res.isError) inner = h('div.md.report', { html: md(content) });
    else if (name === 'run_command') inner = h('pre.term', null, content);
    else inner = h('pre.result-text', null, content);
    bodyEl.append(h('div.tool-sec', null, h('div.tool-sec-label', null, res.isError ? 'Erro' : 'Resultado', h('span', { style: { marginLeft: 'auto', fontWeight: 400 } }, content.length > 1000 ? fmtSize(content.length) : '')), inner));
  }

  if (status === 'approval') {
    const answer = (a) => { const fn = S.approvals.get(tc.id); if (fn) { S.approvals.delete(tc.id); fn(a); } };
    bodyEl.append(h('div.approval', null,
      h('span', null, source === 'mcp' ? `Permitir que o modelo use ${displayName} (${server})?`
        : name === 'run_command' ? 'Permitir que o modelo execute este comando no seu computador?'
        : name === 'execute_code' ? 'Permitir que o modelo execute este código? Ele pode chamar outras ferramentas sem pedir de novo.'
        : name.startsWith('computer_') ? 'Permitir que o modelo use o mouse e o teclado do seu computador?'
        : name.startsWith('browser_') ? 'Permitir que o modelo execute código na página aberta?'
        : 'Permitir que o modelo altere arquivos no espaço de trabalho?'),
      h('button.btn.sm.danger', { onclick: () => answer('deny') }, 'Negar'),
      h('button.btn.sm', { onclick: () => answer('always') }, 'Sempre nesta conversa'),
      h('button.btn.sm.primary', { onclick: () => answer('allow') }, 'Permitir')));
  }

  el.append(h('div.tool-card', null, head, bodyEl));
  return el;
}

/* ============================================================ editor com etiquetas */
const editor = () => $('#input');
let savedRange = null;

function focusEditor(toEnd) {
  const ed = editor();
  ed.focus();
  if (toEnd || !savedRange) {
    const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); savedRange = r.cloneRange();
  }
}

function saveRange() {
  const s = getSelection();
  if (s.rangeCount && editor().contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange();
}

function setEditorText(text) { editor().textContent = text; focusEditor(true); }

function makePill(p) {
  const kind = p.kind;
  const label = kind === 'skill' ? 'Habilidade' : kind === 'mcp' ? 'Conector' : 'Arquivo';
  const el = h('span.pill.pill-' + kind, { contenteditable: 'false', dataset: { kind, id: p.id || '', name: p.name || '' } }, h('span.k', null, label + ':'), h('span.v', null, p.name || ''));
  if (kind === 'file') {
    el.dataset.ref = p.ref;
    el.addEventListener('click', () => { const r = S.refs.find((x) => x.id === p.ref); if (r) refAction(r); });
  }
  return el;
}

/** Ponto de inserção no texto a partir de coordenadas, sempre fora das etiquetas. */
function rangeAtPoint(x, y) {
  if (!document.caretRangeFromPoint) return null;
  const r = document.caretRangeFromPoint(x, y);
  if (!r || !editor().contains(r.startContainer)) return null;
  return outsidePill(r);
}
function outsidePill(r) {
  const n = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
  const pill = n?.closest?.('.pill');
  if (pill && editor().contains(pill)) { r.setStartAfter(pill); r.collapse(true); }
  return r;
}

function insertNodeAtCaret(node) {
  const ed = editor();
  let r = savedRange;
  if (!r || !ed.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); }
  outsidePill(r);
  r.deleteContents();
  const space = document.createTextNode(' ');
  r.insertNode(space);
  r.insertNode(node);
  r.setStartAfter(space); r.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  savedRange = r.cloneRange();
  ed.focus();
}

function insertPill(p) { insertNodeAtCaret(makePill(p)); updatePickers(); }

function editorPills() {
  return $$('.pill', editor()).map((el) => ({ kind: el.dataset.kind, id: el.dataset.id, name: el.dataset.name, ref: el.dataset.ref }));
}

function readEditor() {
  const parts = [];
  const push = (t) => { if (!t) return; const last = parts[parts.length - 1]; if (last?.t === 'text') last.v += t; else parts.push({ t: 'text', v: t }); };
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) push(n.textContent.replace(/ /g, ' '));
      else if (n.nodeName === 'BR') push('\n');
      else if (n.classList?.contains('pill')) {
        const kind = n.dataset.kind;
        if (kind === 'file') {
          const r = S.refs.find((x) => x.id === n.dataset.ref);
          if (r && r.path && r.status !== 'missing') parts.push({ t: 'pill', kind, name: r.name || basename(r.path), path: r.path, dir: !!r.dir });
        } else parts.push({ t: 'pill', kind, id: n.dataset.id, name: n.dataset.name });
      } else if (n.nodeName === 'DIV' || n.nodeName === 'P') { if (parts.length) push('\n'); walk(n); }
      else walk(n);
    }
  };
  walk(editor());
  // apara espaços nas pontas
  if (parts[0]?.t === 'text') parts[0].v = parts[0].v.replace(/^\s+/, '');
  const lastP = parts[parts.length - 1];
  if (lastP?.t === 'text') lastP.v = lastP.v.replace(/\s+$/, '');
  return parts.filter((p) => p.t !== 'text' || p.v);
}

function partsToContent(parts) {
  return parts.map((p) => {
    if (p.t === 'text') return p.v;
    if (p.kind === 'skill') return `Habilidade:${p.name}`;
    if (p.kind === 'mcp') return `Conector:${p.name}`;
    return `"${p.path}"`;
  }).join('');
}

function loadEditorParts(parts) {
  const ed = editor(); ed.innerHTML = ''; S.refs = [];
  for (const p of parts) {
    if (p.t === 'text') ed.append(document.createTextNode(p.v));
    else if (p.kind === 'file') {
      const r = { id: uid(), name: p.name, path: p.path, dir: p.dir, status: 'ok' };
      S.refs.push(r);
      ed.append(makePill({ kind: 'file', name: p.name, ref: r.id }), document.createTextNode(' '));
    } else ed.append(makePill(p), document.createTextNode(' '));
  }
}

/* ------------------------------------------------------------ menção com @ */
let mention = null; // { items, index, node, start }

function mentionItems(q) {
  q = q.toLowerCase();
  const items = [];
  for (const s of S.skills) if (!q || s.name.toLowerCase().includes(q) || s.id.includes(q)) items.push({ kind: 'skill', id: s.id, name: s.name, desc: s.description });
  for (const s of S.mcp) if (!q || s.name.toLowerCase().includes(q)) items.push({ kind: 'mcp', id: s.name, name: s.name, desc: s.status === 'connected' ? `${s.tools.length} ferramentas` : statusInfo(s.status).label });
  for (const it of S.ws.cache.get('') || []) if (q && it.name.toLowerCase().includes(q)) items.push({ kind: 'file', name: it.name, path: it.path, dir: it.dir, desc: it.dir ? 'pasta do espaço de trabalho' : fmtSize(it.size) });
  return items.slice(0, 12);
}

function checkMention() {
  const s = getSelection();
  if (!s.rangeCount || !s.isCollapsed) return closeMention();
  const node = s.anchorNode;
  if (node?.nodeType !== 3 || !editor().contains(node)) return closeMention();
  const before = node.textContent.slice(0, s.anchorOffset);
  const m = before.match(/(?:^|[\s ])@([^\s@ ]{0,40})$/);
  if (!m) return closeMention();
  const items = mentionItems(m[1]);
  mention = { items, index: 0, node, start: s.anchorOffset - m[1].length - 1, end: s.anchorOffset };
  drawMention();
}

function drawMention() {
  const pop = $('#pop-mention');
  pop.innerHTML = '';
  pop.classList.add('open');
  if (!mention.items.length) { pop.append(h('div.pop-empty', null, 'Nada encontrado. Crie habilidades e conectores no menu à esquerda.')); return; }
  pop.append(h('div.pop-head', null, h('span', null, 'Inserir na mensagem')));
  mention.items.forEach((it, i) => {
    const kindLbl = { skill: 'habilidade', mcp: 'conector', file: 'arquivo' }[it.kind];
    pop.append(h('button.menu-item' + (i === mention.index ? '.hl' : ''), { onmousedown: (e) => { e.preventDefault(); chooseMention(i); } },
      ic(it.kind === 'skill' ? 'sparkles' : it.kind === 'mcp' ? 'plug' : it.dir ? 'folder' : ftype(it.name).icon),
      h('span.mi-main', null, h('b', null, it.name), it.desc ? h('span.mi-sub', null, it.desc) : null),
      h('span.kind.' + it.kind, null, kindLbl)));
  });
}

function closeMention() { mention = null; $('#pop-mention').classList.remove('open'); }

function chooseMention(i) {
  const it = mention?.items[i];
  if (!it) return;
  const { node, start, end } = mention;
  const r = document.createRange();
  r.setStart(node, Math.max(0, start)); r.setEnd(node, end);
  r.deleteContents();
  savedRange = r;
  closeMention();
  if (it.kind === 'file') {
    const ref = { id: uid(), name: it.name, path: it.path, dir: it.dir, status: 'ok' };
    S.refs.push(ref);
    insertPill({ kind: 'file', name: it.name, ref: ref.id });
  } else insertPill({ kind: it.kind, id: it.id, name: it.name });
}

/* ------------------------------------------------------------ barra inferior */
function closePops() { $$('.popover').forEach((p) => p.classList.remove('open')); }
function togglePop(id, fill) {
  const pop = $(id);
  const wasOpen = pop.classList.contains('open');
  closePops();
  if (wasOpen) return;
  fill();
  pop.classList.add('open');
}
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.pick-wrap') && !e.target.closest('#pop-mention')) closePops();
});

function renderComposer() {
  const send = $('#send');
  const busy = running(cur());
  send.innerHTML = svg(busy ? 'stop' : 'send');
  send.classList.toggle('stop', busy);
  send.title = busy ? 'Parar (Esc)' : 'Enviar (Enter)';
  send.setAttribute('aria-label', send.title);
  updatePickers();
}

function activeSel(conv) {
  const skills = new Set(S.sel.skills); const mcpS = new Set(S.sel.mcp);
  for (const m of conv?.messages || []) for (const p of m.parts || []) {
    if (p.kind === 'skill') skills.add(p.id);
    if (p.kind === 'mcp') mcpS.add(p.id);
  }
  return {
    skills: [...skills].filter((id) => S.skills.some((s) => s.id === id)),
    mcp: [...mcpS].filter((n) => S.mcp.some((s) => s.name === n)),
  };
}

function updatePickers() {
  const c = cur();
  const act = activeSel(c);
  const pills = editorPills();
  const nSk = new Set([...act.skills, ...pills.filter((p) => p.kind === 'skill').map((p) => p.id)]).size;
  const nMcp = new Set([...act.mcp, ...pills.filter((p) => p.kind === 'mcp').map((p) => p.id)]).size;

  const pm = $('#pick-model'); pm.innerHTML = '';
  pm.append(h('span.dot.' + ({ ok: 'ok', loading: 'busy', offline: 'err' }[S.health.status] || '')), h('b', null, S.model ? shortModel(S.model) : (S.health.status === 'loading' ? 'carregando...' : 'llama-server')), h('span', { html: svg('chev', 'caret'), style: { display: 'contents' } }));
  pm.title = S.model || S.info.llamaUrl || '';
  pm.querySelector('.caret').style.transform = 'rotate(90deg)';

  const pr = $('#pick-persona'); pr.innerHTML = '';
  const pers = personaOf(c);
  pr.append(pers ? h('span.p-dot', { style: { background: pers.color } }) : ic('user'), h('span.lbl', null, 'Personalidade:'), h('b', { style: pers ? { color: pers.color } : null }, pers ? pers.name : 'nenhuma'));
  pr.title = pers ? pers.prompt.slice(0, 300) : 'Escolher personalidade';
  const ps = $('#pick-skills'); ps.innerHTML = ''; ps.classList.toggle('has-skill', nSk > 0);
  ps.append(ic('sparkles'), h('span.lbl', null, 'Habilidades:'), h('b', null, nSk || 'nenhuma'));
  const pc = $('#pick-mcp'); pc.innerHTML = ''; pc.classList.toggle('has-mcp', nMcp > 0);
  pc.append(ic('plug'), h('span.lbl', null, 'Conectores:'), h('b', null, nMcp || 'nenhum'));
  pc.title = act.mcp.join(', ') || 'Nenhum conector MCP ativo';
  const pw = $('#pick-ws'); pw.innerHTML = '';
  pw.append(h('span.lbl', null, projectOf(c) ? 'Projeto:' : 'Espaço de trabalho:'), h('code', null, projectOf(c)?.name || basename(S.ws.path) || '...'), h('span', { html: svg('chev', 'caret'), style: { display: 'contents' } }));
  pw.querySelector('.caret').style.transform = 'rotate(90deg)';
  pw.title = S.ws.path;
}

function checkRow({ checked, title, desc, extra, disabled, onchange }) {
  const input = h('input', { type: 'checkbox', checked, disabled });
  input.addEventListener('change', () => onchange(input.checked));
  return h('label.opt', null, input, h('span.check', { html: svg('check') }),
    h('span.opt-main', null, h('span.opt-title', null, title, extra), desc ? h('span.opt-desc', null, desc) : null));
}

function fillSkillsPop() {
  const pop = $('#pop-skills'); pop.className = 'popover pop-skills'; pop.innerHTML = '';
  pop.append(h('div.pop-head', null, h('span', null, 'Habilidades ativas em todas as mensagens'), S.sel.skills.length ? h('button', { onclick: () => { S.sel.skills = []; saveSel(); fillSkillsPop(); updatePickers(); renderChatTitle(); } }, 'Limpar') : null));
  if (!S.skills.length) pop.append(h('div.pop-empty', null, 'Nenhuma habilidade ainda. Crie ou importe no menu Habilidades.'));
  for (const s of S.skills) {
    pop.append(checkRow({
      checked: S.sel.skills.includes(s.id), title: s.name, desc: s.description,
      onchange: (on) => { S.sel.skills = on ? [...new Set([...S.sel.skills, s.id])] : S.sel.skills.filter((x) => x !== s.id); saveSel(); updatePickers(); renderChatTitle(); },
    }));
  }
  pop.append(h('div.pop-foot', null, h('button.btn.ghost.sm.wide', { onclick: () => { closePops(); setView('skills'); } }, ic('gear'), 'Gerenciar habilidades')));
}

function fillMcpPop() {
  const pop = $('#pop-mcp'); pop.className = 'popover pop-mcp'; pop.innerHTML = '';
  pop.append(h('div.pop-head', null, h('span', null, 'Ferramentas disponíveis ao modelo')));
  const on = enabledGroups();
  pop.append(h('button.menu-item', { onclick: () => { closePops(); setView('settings'); setTimeout(() => $('#tools-section')?.scrollIntoView({ behavior: 'smooth' }), 80); } },
    ic('wrench'), h('span.mi-main', null, `Ferramentas internas: ${on.length} de ${TOOL_GROUPS.length} ativas`, h('span.mi-sub', null, on.map((g) => TOOL_INFO[g].short).join(', ') || 'nenhuma')), h('span.tag', null, 'Configurar')));
  pop.append(h('div.menu-sep'));
  if (!S.mcp.length) pop.append(h('div.pop-empty', null, 'Nenhum conector MCP configurado.'));
  for (const s of S.mcp) {
    const st = statusInfo(s.status);
    pop.append(checkRow({
      checked: S.sel.mcp.includes(s.name), title: s.name,
      extra: h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto', fontSize: '12px', color: 'var(--muted)', fontWeight: 400 } }, h('span.dot.' + st.dot), s.status === 'connected' ? `${s.tools.length} ferramentas` : st.label),
      desc: s.error || s.tools.slice(0, 6).map((t) => t.name).join(', '),
      onchange: (on) => { S.sel.mcp = on ? [...new Set([...S.sel.mcp, s.name])] : S.sel.mcp.filter((x) => x !== s.name); saveSel(); updatePickers(); renderChatTitle(); },
    }));
  }
  pop.append(h('div.pop-foot', null, h('button.btn.ghost.sm.wide', { onclick: () => { closePops(); setView('mcp'); } }, ic('gear'), 'Gerenciar conectores')));
}

function fillModelPop() {
  const pop = $('#pop-model'); pop.innerHTML = '';
  const st = { ok: 'Pronto', loading: 'Carregando o modelo', offline: 'Desligado ou inacessível' }[S.health.status] || 'Verificando';
  pop.append(h('div.pop-head', null, h('span', null, 'Modelo no llama-server')),
    h('div.pop-path', null, S.model || 'Nenhum modelo carregado'),
    h('div.menu-item', { style: { cursor: 'default' } }, h('span.dot.' + ({ ok: 'ok', loading: 'busy', offline: 'err' }[S.health.status] || '')), h('span.mi-main', null, st, h('span.mi-sub', null, S.info.llamaUrl))),
    h('div.menu-sep'),
    S.llama && !S.llama.running && S.health.status === 'offline' ? h('button.menu-item', { onclick: () => { closePops(); startLlama(); } }, ic('play'), 'Iniciar o servidor') : null,
    S.llama?.running ? h('button.menu-item', { onclick: () => { closePops(); stopLlama(); } }, ic('stop'), 'Parar o servidor') : null,
    h('button.menu-item', { onclick: () => { closePops(); setView('server'); } }, ic('server'), 'Servidor e log'),
    h('button.menu-item', { onclick: () => { closePops(); setView('settings'); } }, ic('gear'), 'Parâmetros e prompt de sistema'));
}

function fillWsPop() {
  const pop = $('#pop-ws'); pop.innerHTML = '';
  const proj = projectOf(cur());
  pop.append(h('div.pop-head', null, h('span', null, proj ? `Pasta do projeto ${proj.name}` : 'Espaço de trabalho')), h('div.pop-path', null, S.ws.path));
  if (proj) pop.append(h('button.menu-item', { onclick: () => { closePops(); editProject(proj); } }, ic('gear'), 'Configurar o projeto'));
  for (const p of proj ? [] : (S.info.recentWorkspaces || []).filter((x) => x !== S.ws.path).slice(0, 5)) {
    pop.append(h('button.menu-item', { onclick: () => { closePops(); setWorkspace(p); } }, ic('folder'), h('span.mi-main', null, basename(p), h('span.mi-sub', null, p))));
  }
  pop.append(h('div.menu-sep'),
    h('button.menu-item', { onclick: () => { closePops(); chooseWorkspace(); } }, ic('folderOpen'), 'Escolher outra pasta...'),
    h('button.menu-item', { onclick: () => { closePops(); api('/api/reveal', { path: '.', ws: S.ws.path }); } }, ic('external'), 'Abrir no Explorer'),
    h('button.menu-item', { onclick: () => { closePops(); toggleWs(); } }, ic('panel'), $('#ws').classList.contains('hidden') ? 'Mostrar painel de arquivos' : 'Ocultar painel de arquivos'));
}

function fillPlusPop() {
  const pop = $('#pop-plus'); pop.innerHTML = '';
  pop.append(h('div.pop-head', null, h('span', null, 'Inserir na mensagem')),
    h('button.menu-item', { onclick: async () => {
      closePops();
      const p = await pickPath({ title: 'Referenciar arquivo ou pasta', mode: 'any', start: S.ws.path });
      if (p) { const st = await api('/api/stat', { path: p, ws: S.ws.path }); addRef({ name: basename(p), path: st.path, dir: st.dir }); }
    } }, ic('pin'), h('span.mi-main', null, 'Arquivo ou pasta do computador', h('span.mi-sub', null, 'Entra o caminho completo, sem enviar o arquivo'))),
    h('button.menu-item', { onclick: () => { closePops(); focusEditor(); document.execCommand('insertText', false, '@'); checkMention(); } }, ic('sparkles'), h('span.mi-main', null, 'Habilidade ou conector', h('span.mi-sub', null, 'O mesmo que digitar @'))),
    h('div.menu-sep'),
    h('button.menu-item', { onclick: () => { closePops(); setView('skills'); } }, ic('download'), 'Importar habilidades'),
    h('button.menu-item', { onclick: () => { closePops(); setView('mcp'); } }, ic('plus'), 'Adicionar conector MCP'));
}

/* ------------------------------------------------------------ arquivos arrastados */
function locKey(r) { return `${r.name}|${r.size}|${r.lastModified}`; }

function refPillEls(r) { return $$(`.pill[data-ref="${r.id}"]`, editor()); }

function updateRefPill(r) {
  for (const el of refPillEls(r)) {
    el.classList.remove('loading', 'missing', 'choose');
    if (r.status !== 'ok') el.classList.add(r.status);
    el.querySelector('.v').textContent = r.name || basename(r.path);
    el.dataset.name = r.name || '';
    el.title = r.status === 'loading' ? 'Localizando no computador...' : r.status === 'missing' ? 'Não encontrei este arquivo. Clique para resolver.' : r.status === 'choose' ? 'Há mais de um arquivo com este nome. Clique para escolher.' : r.path;
  }
}

function addRef(r) {
  const ref = { id: uid(), status: 'ok', ...r };
  S.refs.push(ref);
  insertPill({ kind: 'file', name: ref.name || basename(ref.path), ref: ref.id });
  updateRefPill(ref);
  return ref;
}

async function remember(r) {
  if (!r.path) return;
  const cache = store.get('loc', {});
  if (r.size != null) { cache[locKey(r)] = r.path; store.set('loc', cache); }
  api('/api/remember', { path: r.path }).catch(() => {});
}

async function locateRef(r) {
  try {
    const cached = store.get('loc', {})[locKey(r)];
    if (cached && !r.dir) {
      const st = await api('/api/stat', { path: cached, ws: S.ws.path });
      if (st.exists && st.size === r.size) { r.path = cached; r.status = 'ok'; updateRefPill(r); return; }
    }
    const res = await api('/api/locate', { name: r.name, size: r.size, lastModified: r.lastModified, isDir: r.dir });
    const exact = res.matches.filter((m) => m.exact);
    if (exact.length === 1 || (res.matches.length === 1 && (r.dir || res.matches[0].score >= 3))) {
      r.path = (exact[0] || res.matches[0]).path; r.status = 'ok'; remember(r);
    } else if (res.matches.length) {
      r.options = res.matches; r.path = res.matches[0].path; r.status = 'choose';
    } else r.status = 'missing';
  } catch (e) { r.status = 'missing'; console.warn(e); }
  updateRefPill(r);
}

function refAction(r) {
  if (r.status === 'loading') return;
  let m;
  const done = () => { m.close(); updateRefPill(r); };
  const list = h('div.choose-list');
  if (r.status === 'choose' || (r.options && r.options.length > 1)) {
    for (const o of r.options || []) {
      list.append(h('button', { onclick: () => { r.path = o.path; r.status = 'ok'; remember(r); done(); } }, o.path,
        h('small', null, [o.exact ? 'mesmo tamanho e data' : 'mesmo nome', o.size != null && !r.dir ? fmtSize(o.size) : null, o.mtime ? new Date(o.mtime).toLocaleString('pt-BR') : null].filter(Boolean).join(', '))));
    }
  }
  const body = [
    h('p', { style: { marginTop: 0, color: 'var(--text-2)' } },
      r.status === 'missing' ? `Não encontrei "${r.name}" nas pastas comuns nem no índice de pesquisa do Windows.`
        : r.status === 'choose' ? `Há mais de um "${r.name}" no computador. Qual deles?` : r.path),
    list.childElementCount ? list : null,
  ];
  const foot = [
    h('button.btn.danger', { style: { marginRight: 'auto' }, onclick: () => { refPillEls(r).forEach((el) => el.remove()); S.refs = S.refs.filter((x) => x !== r); m.close(); updatePickers(); } }, 'Remover da mensagem'),
    h('button.btn', { onclick: async () => {
      const p = await promptBox('Caminho do arquivo', `Cole o caminho completo de "${r.name}"`, r.path || '', 'Usar');
      if (!p) return;
      const st = await api('/api/stat', { path: p.replace(/^"|"$/g, ''), ws: S.ws.path });
      if (!st.exists) { toast('Esse caminho não existe.', 'err'); return; }
      r.path = st.path; r.dir = st.dir; r.status = 'ok'; r.name = basename(st.path); remember(r); done();
    } }, 'Informar caminho'),
    r.file && r.status !== 'ok' ? h('button.btn.primary', { onclick: async () => {
      try {
        r.status = 'loading'; done();
        const res = await api('/api/ws/upload?name=' + encodeURIComponent(r.name) + '&ws=' + encodeURIComponent(S.ws.path), r.file);
        r.path = res.path; r.status = 'ok'; r.file = null; updateRefPill(r); refreshTree();
        toast('Copiado para a pasta anexos do espaço de trabalho');
      } catch (e) { r.status = 'missing'; updateRefPill(r); toast(e.message, 'err'); }
    } }, 'Copiar para o espaço de trabalho') : null,
  ];
  m = modal({ title: r.name || 'Arquivo', body, foot });
}

function fileUriToPath(u) {
  try {
    const url = new URL(u.trim());
    if (url.protocol !== 'file:') return null;
    let p = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1).replace(/\//g, '\\');
    if (url.host) p = `\\\\${url.host}${p.replace(/\//g, '\\')}`;
    return p;
  } catch { return null; }
}

function statRef(p) {
  const r = addRef({ name: basename(p), path: p, status: 'loading' });
  api('/api/stat', { path: p, ws: S.ws.path }).then((st) => { r.dir = st.dir; r.path = st.path; r.status = st.exists ? 'ok' : 'missing'; updateRefPill(r); });
}

function handleDrop(dt) {
  const internal = dt.getData('application/x-studio-path');
  if (internal) { try { addRef(JSON.parse(internal)); } catch { /* ok */ } return; }
  const uris = (dt.getData('text/uri-list') || '').split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const fromUri = uris.map(fileUriToPath).filter(Boolean);
  if (fromUri.length) { fromUri.forEach(statRef); return; }
  const items = [...(dt.items || [])].filter((i) => i.kind === 'file');
  if (items.length) {
    for (const it of items) {
      const entry = it.webkitGetAsEntry?.();
      const f = it.getAsFile();
      if (!f) continue;
      const isDir = !!entry?.isDirectory;
      const r = addRef({ name: f.name, size: isDir ? undefined : f.size, lastModified: f.lastModified, dir: isDir, status: 'loading', file: isDir ? null : f });
      locateRef(r);
    }
    return;
  }
  const text = dt.getData('text/plain');
  if (text && /^"?([A-Za-z]:\\|\\\\|\/)/.test(text.trim())) statRef(text.trim().replace(/^"|"$/g, ''));
}

function setupDrop() {
  const chat = $('#chat'); const comp = $('#composer');
  let depth = 0;
  const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].some((t) => t === 'Files' || t === 'application/x-studio-path' || t === 'text/uri-list');
  chat.addEventListener('dragenter', (e) => { if (!isFileDrag(e)) return; e.preventDefault(); depth++; comp.classList.add('dragging'); });
  chat.addEventListener('dragover', (e) => { if (!isFileDrag(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'link'; });
  chat.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) comp.classList.remove('dragging'); });
  chat.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault(); depth = 0; comp.classList.remove('dragging');
    // posiciona o cursor onde o arquivo caiu, se foi dentro do texto
    const r = rangeAtPoint(e.clientX, e.clientY);
    if (r) savedRange = r;
    handleDrop(e.dataTransfer);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}

/* ============================================================ envio e ciclo do agente */
async function send() {
  if (running(cur())) { stop(); return; }
  if (S.refs.some((r) => r.status === 'loading' && refPillEls(r).length)) { toast('Aguarde: ainda localizando os arquivos arrastados.'); return; }
  const parts = readEditor();
  if (!parts.length) return;
  const content = partsToContent(parts);
  const refs = parts.filter((p) => p.kind === 'file').map((p) => ({ name: p.name, path: p.path, dir: p.dir }));
  if (S.refs.some((r) => r.status === 'missing' && refPillEls(r).length)) toast('Arquivos não localizados ficaram de fora.');
  const conv = cur() || newConv();
  conv.messages.push({ role: 'user', content, parts, refs, ts: Date.now() });
  if (conv.title === 'Nova conversa') {
    const plain = parts.filter((p) => p.t === 'text').map((p) => p.v).join(' ').replace(/\s+/g, ' ').trim();
    conv.title = (plain || parts.map((p) => p.name).filter(Boolean).join(', ')).slice(0, 60);
  }
  conv.updatedAt = Date.now();
  editor().innerHTML = ''; S.refs = []; savedRange = null;
  saveConvs(); renderConvList(); renderChatTitle();
  renderMessages(false);
  await runAgent(conv);
}

function stop() {
  const c = cur();
  const ac = c && S.runs.get(c.id);
  if (!ac) return;
  ac.abort();
}

function collectRefs(conv) {
  return [...new Set(conv.messages.flatMap((m) => (m.refs || []).map((r) => r.path)))];
}

function userContent(m) {
  let c = m.content || '';
  if (m.refs?.length) c += `${c ? '\n\n' : ''}[Caminhos referenciados]\n` + m.refs.map((r) => `- ${r.path}${r.dir ? ' (pasta)' : ''}`).join('\n');
  return c;
}

function apiMessages(conv, system) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  const msgs = conv.messages;
  // imagens só vão na requisição logo depois de serem geradas (economiza contexto)
  let lastAssistant = -1;
  msgs.forEach((m, i) => { if (m.role === 'assistant') lastAssistant = i; });
  msgs.forEach((m, i) => { m.__i = i; });
  const cut = conv.compactCut || 0;
  if (cut && conv.summary) out.push({ role: 'user', content: '[Resumo automático da conversa anterior, gerado para caber no contexto]\n\n' + conv.summary });
  for (const m of msgs) {
    if (m.__i < cut) continue;
    if (m.role === 'user' && m.hidden) {
      if (m._images?.length && m.__i > lastAssistant) out.push({ role: 'user', content: [{ type: 'text', text: m.content }, ...m._images.map((url) => ({ type: 'image_url', image_url: { url } }))] });
      else out.push({ role: 'user', content: m.content + ' [imagem omitida do histórico]' });
      continue;
    }
    if (m.role === 'user') out.push({ role: 'user', content: userContent(m) });
    else if (m.role === 'assistant') {
      const text = splitThink(m.content).text;
      const calls = (m.tool_calls || []).filter((t) => t.function?.name);
      if (!text.trim() && !calls.length) continue;
      const o = { role: 'assistant', content: text };
      if (calls.length) o.tool_calls = calls.map((t) => ({ id: t.id, type: 'function', function: { name: t.function.name, arguments: t.function.arguments || '{}' } }));
      out.push(o);
      for (const t of calls) {
        const r = msgs.find((x) => x.role === 'tool' && x.tool_call_id === t.id);
        let c = r && r.content ? r.content : 'Execução cancelada pelo usuário.';
        if (r?.short && c.length > 1500) c = c.slice(0, 1500) + '\n[... resultado antigo encurtado pela compactação]';
        out.push({ role: 'tool', tool_call_id: t.id, content: c });
      }
    }
  }
  return out;
}

async function streamCompletion(conv, system, tools, msg, signal) {
  return streamRaw(apiMessages(conv, system), tools, msg, signal, scheduleRender);
}

async function streamRaw(messages, tools, msg, signal, onDelta) {
  const body = { messages, stream: true };
  if (tools.length) body.tools = tools;
  const st = S.settings;
  if (st.temperature !== '' && st.temperature != null) body.temperature = Number(st.temperature);
  if (st.topP !== '' && st.topP != null) body.top_p = Number(st.topP);
  if (st.maxTokens !== '' && st.maxTokens != null) body.max_tokens = Number(st.maxTokens);

  const res = await fetch('/v1/chat/completions', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Studio': '1' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    let m = t; try { const j = JSON.parse(t); m = j.error?.message || j.error || t; } catch { /* texto */ }
    throw new Error(`llama-server respondeu ${res.status}: ${String(m).slice(0, 600)}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
      const d = j.choices?.[0]?.delta;
      if (d) {
        if (d.reasoning_content) msg.reasoning += d.reasoning_content;
        if (d.content) msg.content += d.content;
        for (const tc of d.tool_calls || []) {
          const idx = tc.index ?? 0;
          const slot = msg.tool_calls[idx] || (msg.tool_calls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name && !slot.function.name) slot.function.name = tc.function.name;
          if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
        }
      }
      if (j.timings) { msg.tps = j.timings.predicted_per_second; msg.tokens = j.timings.predicted_n; }
      onDelta?.();
    }
  }
}

function needsApproval(info, conv) {
  const mode = S.settings.approval;
  if (mode === 'never' || conv.autoApprove) return false;
  if (mode === 'all') return true;
  return (info.source === 'builtin' || info.source === 'client') && info.mutating;
}

function waitApproval(id, signal) {
  return new Promise((resolve) => {
    S.approvals.set(id, resolve);
    signal.addEventListener('abort', () => resolve('deny'), { once: true });
  });
}

async function runAgent(conv) {
  const ac = new AbortController();
  S.runs.set(conv.id, ac);
  renderComposer(); renderConvList();
  const t0 = Date.now();
  try {
    const act = activeSel(conv);
    const groups = enabledGroups();
    const sel = { groups, mcp: act.mcp.filter((n) => S.mcp.some((s) => s.name === n && s.status === 'connected')), skills: act.skills };
    const refs = collectRefs(conv);
    const fetchTools = () => api('/api/tools', { ...sel, extra: conv.extraTools || [] });
    let [{ tools, meta }, ctx] = await Promise.all([
      fetchTools(),
      api('/api/context', { ws: wsOf(conv), skills: sel.skills, groups, refs, now: new Date().toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' }) }),
    ]);
    const tctx = { signal: ac.signal, conv, refs, groups, ctxText: ctx.text, ws: wsOf(conv) };
    const persona = personaOf(conv); const proj = projectOf(conv);
    const system = [
      S.settings.systemPrompt.trim(),
      persona?.prompt?.trim() ? `# Personalidade: ${persona.name}\n${persona.prompt.trim()}` : '',
      proj?.instructions?.trim() ? `# Instruções do projeto "${proj.name}"\n${proj.instructions.trim()}` : '',
      ctx.text,
    ].filter(Boolean).join('\n\n');
    const maxSteps = Math.max(1, Number(S.settings.maxSteps) || 30);

    for (let step = 0; step < maxSteps; step++) {
      const msg = { role: 'assistant', content: '', reasoning: '', tool_calls: [], t0: step === 0 ? t0 : Date.now() };
      conv.messages.push(msg);
      scheduleRender();
      if (step === 0) await waitModel(conv, ac.signal);
      if (ac.signal.aborted) throw new DOMException('abort', 'AbortError');
      await maybeCompact(conv, system, tools, ac.signal);
      try {
        await streamCompletion(conv, system, tools, msg, ac.signal);
      } finally {
        msg.t1 = Date.now();
        msg.tool_calls = msg.tool_calls.filter((t) => t && t.function?.name);
        msg.tool_calls.forEach((t) => { if (!t.id) t.id = 'call_' + uid(); });
        if (!msg.tool_calls.length) delete msg.tool_calls;
        conv.updatedAt = Date.now(); saveConvs();
      }
      if (!msg.tool_calls?.length) break;

      const parallel = [];
      const images = [];
      let refetch = false;
      for (const tc of msg.tool_calls) {
        if (ac.signal.aborted) throw new DOMException('abort', 'AbortError');
        const info = meta[tc.function.name] || { source: tc.function.name.includes('__') ? 'mcp' : 'builtin', mutating: true };
        const tmsg = { role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: '', status: 'pending', source: info.source, server: info.server };
        conv.messages.push(tmsg);
        if (tc.function.name === 'explore') {
          // subagentes rodam em paralelo (o llama-server atende vários slots)
          tmsg.status = 'running'; scheduleRender();
          const ts = performance.now();
          parallel.push(runExplorer(parseArgs(tc.function.arguments) || {}, tctx, tmsg).then((r) => {
            tmsg.ms = performance.now() - ts; tmsg.content = r.content; tmsg.isError = r.isError; tmsg.status = r.isError ? 'error' : 'ok'; saveConvs(); scheduleRender();
          }));
          continue;
        }
        if (needsApproval(info, conv)) {
          tmsg.status = 'approval'; scheduleRender();
          S.waiting.add(conv.id); renderConvList();
          if (conv.id !== S.curId || S.view !== 'chat') toast(`"${conv.title}" está esperando sua permissão`);
          const ans = await waitApproval(tc.id, ac.signal);
          S.waiting.delete(conv.id); renderConvList();
          if (ac.signal.aborted) { tmsg.status = 'denied'; tmsg.content = 'Cancelado pelo usuário.'; throw new DOMException('abort', 'AbortError'); }
          if (ans === 'deny') { tmsg.status = 'denied'; tmsg.isError = true; tmsg.content = 'O usuário negou a execução desta ferramenta. Pergunte como ele prefere seguir.'; scheduleRender(); continue; }
          if (ans === 'always') conv.autoApprove = true;
        }
        tmsg.status = 'running'; scheduleRender();
        const ts = performance.now();
        const r = await execTool(tc.function.name, parseArgs(tc.function.arguments) ?? tc.function.arguments, info, tctx, tmsg);
        tmsg.ms = performance.now() - ts;
        tmsg.content = r.content; tmsg.isError = r.isError; tmsg.status = r.isError ? 'error' : 'ok';
        if (r.images?.length) { tmsg._images = r.images; images.push({ name: tc.function.name, images: r.images }); }
        if (tc.function.name === 'search_tools') refetch = true;
        if (info.source === 'builtin' && info.mutating && !r.isError) {
          const a = parseArgs(tc.function.arguments);
          if (a?.path && wsOf(conv) === S.ws.path) markFresh(a.path);
        }
        saveConvs(); scheduleRender();
      }
      if (parallel.length) await Promise.all(parallel);
      if (images.length && visionOn()) {
        for (const im of images) conv.messages.push({ role: 'user', hidden: true, content: `[Imagem devolvida pela ferramenta ${im.name}]`, _images: im.images });
      }
      if (refetch) ({ tools, meta } = await fetchTools());
      if (step === maxSteps - 1) conv.messages.push({ role: 'error', content: `Parei depois de ${maxSteps} rodadas de ferramentas. Envie "continue" para seguir ou aumente o limite nas configurações.` });
    }
  } catch (e) {
    if (!(e.name === 'AbortError' || ac.signal.aborted)) conv.messages.push({ role: 'error', content: e.message || String(e) });
  } finally {
    for (const m of conv.messages) if (m.role === 'tool' && ['pending', 'running', 'approval'].includes(m.status)) { m.status = 'denied'; m.content = m.content || 'Cancelado pelo usuário.'; }
    const last = conv.messages[conv.messages.length - 1];
    if (last?.role === 'assistant' && !last.content && !last.reasoning && !last.tool_calls?.length) conv.messages.pop();
    S.runs.delete(conv.id); S.waiting.delete(conv.id);
    conv.updatedAt = Date.now();
    saveConvs(); renderConvList();
    if (conv.id === S.curId) { renderMessages(false); renderComposer(); renderChatTitle(); }
    else if (!conv.messages.some((m) => m.role === 'error' && m === conv.messages[conv.messages.length - 1])) toast(`"${conv.title}" terminou de responder`);
  }
}

/* ============================================================ compactação automática */
const SUMMARY_PROMPT = 'Você resume conversas de trabalho para que um assistente continue a tarefa sem o histórico completo. '
  + 'Escreva em português, em tópicos curtos: objetivo do usuário; decisões e preferências; arquivos, pastas, URLs e comandos importantes (com caminhos exatos); '
  + 'o que já foi feito e o resultado; estado atual e próximos passos pendentes. Não invente nada. Seja completo nos fatos e breve no texto.';

function estimateTokens(conv, system, tools) {
  return Math.ceil((JSON.stringify(apiMessages(conv, system)).length + JSON.stringify(tools || []).length) / 3.2);
}

/** Mantém a conversa abaixo do limite: 1) encurta resultados antigos; 2) resume o começo. */
async function maybeCompact(conv, system, tools, signal, force = false) {
  const nCtx = S.nCtx || 32768;
  const limit = nCtx * (Number(S.settings.compactAt) || 75) / 100;
  if (!force && (!S.settings.autoCompact || estimateTokens(conv, system, tools) < limit)) return false;
  const msgs = conv.messages;
  let lastUser = msgs.length - 1;
  while (lastUser > 0 && !(msgs[lastUser].role === 'user' && !msgs[lastUser].hidden)) lastUser--;
  // etapa 1: resultados de ferramenta antigos ficam curtos
  let shortened = 0;
  msgs.forEach((m, i) => { if (m.role === 'tool' && i < lastUser && !m.short && (m.content || '').length > 1500) { m.short = true; shortened++; } });
  if (!force && estimateTokens(conv, system, tools) < limit) { if (shortened) saveConvs(); return true; }

  // etapa 2: resume o começo e guarda só o final (cerca de 35% do limite)
  const from = conv.compactCut || 0;
  const budget = limit * 0.35 * 3.2;
  let acc = 0; let cut = msgs.length;
  for (let i = msgs.length - 1; i > from; i--) {
    acc += JSON.stringify(msgs[i]).length;
    if (acc > budget) break;
    if ((msgs[i].role === 'user' && !msgs[i].hidden) || msgs[i].role === 'assistant') cut = i;
  }
  if (cut >= msgs.length - 1) {
    // o final sozinho já é grande: guarda pelo menos o último passo
    for (let i = msgs.length - 1; i > from; i--) if (msgs[i].role === 'assistant' || (msgs[i].role === 'user' && !msgs[i].hidden)) { cut = i; break; }
  }
  if (cut <= from) return false;

  const lines = [];
  if (conv.summary) lines.push('RESUMO ANTERIOR:\n' + conv.summary);
  for (let i = from; i < cut; i++) {
    const m = msgs[i];
    if (m.hidden) continue;
    if (m.role === 'user') lines.push('USUÁRIO: ' + userContent(m));
    else if (m.role === 'assistant') {
      const t = splitThink(m.content).text.trim();
      if (t) lines.push('ASSISTENTE: ' + t);
      for (const tc of m.tool_calls || []) lines.push(`FERRAMENTA ${tc.function.name}(${String(tc.function.arguments).slice(0, 400)})`);
    } else if (m.role === 'tool') lines.push('RESULTADO: ' + String(m.content || '').slice(0, 1200));
  }
  let transcript = lines.join('\n\n');
  const maxChars = Math.floor(nCtx * 0.6 * 3.2);
  if (transcript.length > maxChars) transcript = transcript.slice(0, maxChars * 0.3) + '\n\n[... trecho do meio omitido ...]\n\n' + transcript.slice(-maxChars * 0.7);

  toast('Compactando a conversa para caber no contexto...');
  conv._compacting = true; scheduleRender();
  try {
    const m = { content: '', reasoning: '', tool_calls: [] };
    await streamRaw([{ role: 'system', content: SUMMARY_PROMPT }, { role: 'user', content: transcript }], [], m, signal, null);
    const summary = splitThink(m.content).text.trim();
    if (!summary) return false;
    conv.summary = summary;
    conv.compactCut = cut;
    conv.compactions = (conv.compactions || 0) + 1;
    saveConvs();
    return true;
  } finally {
    conv._compacting = false; scheduleRender();
  }
}

async function compactNow(conv) {
  if (running(conv)) { toast('Espere a resposta terminar.'); return; }
  const ac = new AbortController(); S.runs.set(conv.id, ac); renderComposer();
  try {
    const { tools } = await api('/api/tools', { groups: enabledGroups(), mcp: [], skills: [] });
    const ok = await maybeCompact(conv, '', tools, ac.signal, true);
    toast(ok ? 'Conversa compactada' : 'Não havia o que compactar');
  } catch (e) { toast(e.message, 'err'); }
  finally { S.runs.delete(conv.id); renderComposer(); renderMessages(false); }
}

/* ============================================================ ferramentas internas */
const TOOL_INFO = {
  browser: { sec: 'Navegador', title: 'Controlar o navegador', short: 'navegador', desc: 'Abrir sites, ler páginas, clicar e preencher numa janela própria do Edge.' },
  computer: { sec: 'Computador', title: 'Controlar o computador', short: 'computador', desc: 'Ver janelas e elementos da tela, clicar, digitar e atalhos. Sempre pede permissão.' },
  read: { sec: 'Arquivos', title: 'Ler arquivos', short: 'ler', desc: 'Listar pastas, ler e procurar arquivos.' },
  edit: { sec: 'Arquivos', title: 'Editar arquivos', short: 'editar', desc: 'Trocar trechos de arquivos existentes.' },
  write: { sec: 'Arquivos', title: 'Escrever arquivos', short: 'escrever', desc: 'Criar arquivos e pastas.' },
  shell: { sec: 'Shell', title: 'Executar comandos', short: 'comandos', desc: 'Rodar comandos no PowerShell dentro da pasta de trabalho.' },
  code: { sec: 'Shell', title: 'Executar código de ferramentas', short: 'código', desc: 'JavaScript que chama várias ferramentas e combina os resultados.' },
  history: { sec: 'Busca', title: 'Lembrar conversas', short: 'histórico', desc: 'Procurar no histórico desta e das outras conversas.' },
  toolsearch: { sec: 'Busca', title: 'Buscar ferramentas', short: 'buscar ferramentas', desc: 'Achar e ativar ferramentas de conectores sob demanda.' },
  explore: { sec: 'Subagentes', title: 'Subagentes exploradores', short: 'exploradores', desc: 'Investigação só de leitura com contexto próprio, vários em paralelo.' },
};
function enabledGroups() { return TOOL_GROUPS.filter((g) => S.settings.tools[g]); }
function visionOn() { return S.settings.vision === 'on' || (S.settings.vision === 'auto' && S.vision); }

/** Executa uma ferramenta: as da interface aqui, as outras no servidor. */
async function execTool(name, args, info, tctx, tmsg) {
  try {
    if (name === 'execute_code') return await runCode(args?.code ?? '', tctx, tmsg);
    if (name === 'recall_history') return recallHistory(args || {}, tctx.conv);
    if (name === 'search_tools') {
      const r = await api('/api/tools/search', { query: args?.query || '' });
      if (!r.tools.length) return { content: 'Nenhuma ferramenta encontrada para essa busca.', isError: false };
      tctx.conv.extraTools = [...new Set([...(tctx.conv.extraTools || []), ...r.tools.map((t) => t.name)])];
      return { content: 'Ferramentas ativadas para os próximos passos:\n' + r.tools.map((t) => `- ${t.name} (${t.server}): ${t.description}`).join('\n'), isError: false };
    }
    const r = await api('/api/tools/call', { name, arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}), allow: tctx.refs, ws: tctx.ws });
    return r;
  } catch (e) { return { content: 'Erro: ' + e.message, isError: true }; }
}

function recallHistory(args, conv) {
  const words = String(args.query || '').toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return { content: 'Informe o que procurar.', isError: true };
  const convs = args.scope === 'atual' ? [conv] : S.convs;
  const hits = [];
  for (const c of convs) {
    c.messages.forEach((m, i) => {
      if (m.hidden) return;
      const text = m.role === 'user' ? m.content : m.role === 'assistant' ? splitThink(m.content).text : m.role === 'tool' ? m.content : '';
      if (!text) return;
      const low = text.toLowerCase();
      const score = words.filter((w) => low.includes(w)).length;
      if (!score) return;
      const at = Math.max(0, low.indexOf(words.find((w) => low.includes(w))) - 160);
      hits.push({ score, c, i, role: m.role, t: m.ts || c.updatedAt, snip: (at ? '...' : '') + text.slice(at, at + 420).replace(/\s+/g, ' ') + (text.length > at + 420 ? '...' : '') });
    });
  }
  hits.sort((a, b) => b.score - a.score || b.t - a.t);
  const top = hits.slice(0, Math.min(20, Number(args.limit) || 8));
  if (!top.length) return { content: 'Nada encontrado no histórico.', isError: false };
  const role = { user: 'usuário', assistant: 'assistente', tool: 'ferramenta' };
  return { content: top.map((h) => `### ${h.c.title} (${fmtStamp(h.t)}, ${role[h.role]})\n${h.snip}`).join('\n\n'), isError: false };
}

/** Executa JavaScript num Worker isolado; tool() chama as ferramentas de verdade. */
function runCode(code, tctx, tmsg) {
  const src = `
    const pending = new Map(); let seq = 0;
    self.tool = (name, args = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); postMessage({ t: 'call', id, name, args }); });
    const fmt = (a) => a.map((x) => typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()).join(' ');
    console.log = console.info = console.warn = console.error = (...a) => postMessage({ t: 'log', s: fmt(a) });
    onmessage = async (e) => {
      const m = e.data;
      if (m.t === 'run') {
        try {
          const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
          const v = await new AsyncFn(m.code)();
          postMessage({ t: 'done', v: v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v, null, 2) });
        } catch (err) { postMessage({ t: 'error', s: String((err && err.stack) || err) }); }
      } else if (m.t === 'result') {
        const p = pending.get(m.id); pending.delete(m.id);
        if (m.error) p.rej(new Error(m.error)); else p.res(m.content);
      }
    };`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const w = new Worker(url);
  const logs = []; let calls = 0;
  tmsg._sub = [];
  return new Promise((resolve) => {
    let done = false;
    const logText = () => (logs.length ? '[console]\n' + logs.join('\n').slice(-20000) : '');
    const finish = (content, isError) => { if (done) return; done = true; clearTimeout(timer); w.terminate(); URL.revokeObjectURL(url); resolve({ content: content || '(sem saída)', isError }); };
    const timer = setTimeout(() => finish([logText(), 'Tempo esgotado (120 s).'].filter(Boolean).join('\n\n'), true), 120000);
    tctx.signal.addEventListener('abort', () => finish('Cancelado.', true), { once: true });
    w.onmessage = async (e) => {
      const m = e.data;
      if (m.t === 'log') logs.push(m.s);
      else if (m.t === 'call') {
        let r;
        if (++calls > 200) r = { content: 'Limite de 200 chamadas por execução.', isError: true };
        else if (['execute_code', 'explore'].includes(m.name)) r = { content: `${m.name} não pode ser chamada de dentro do código.`, isError: true };
        else {
          const step = { name: m.name, summary: toolSummary(m.name, m.args), status: 'running' };
          tmsg._sub.push(step); scheduleRender();
          r = await execTool(m.name, m.args, {}, tctx, {});
          step.status = r.isError ? 'error' : 'ok'; scheduleRender();
        }
        if (!done) w.postMessage({ t: 'result', id: m.id, content: r.content, error: r.isError ? r.content : null });
      } else if (m.t === 'done') finish([logText(), m.v != null ? '[retorno]\n' + m.v : ''].filter(Boolean).join('\n\n'), false);
      else if (m.t === 'error') finish([logText(), '[erro]\n' + m.s].filter(Boolean).join('\n\n'), true);
    };
    w.onerror = (e) => finish('[erro]\n' + (e.message || 'falha ao executar o código'), true);
    w.postMessage({ t: 'run', code });
  });
}

/** Subagente explorador: ciclo próprio, só ferramentas de leitura, devolve um relatório. */
async function runExplorer(args, tctx, tmsg) {
  const only = ['list_directory', 'read_file', 'search_files'];
  if (tctx.groups.includes('browser')) only.push('browser_navigate', 'browser_read', 'browser_click', 'browser_back');
  if (tctx.groups.includes('history')) only.push('recall_history');
  const { tools } = await api('/api/tools', { groups: ['read', 'browser', 'history'], mcp: [], skills: [], only });
  const sys = 'Você é um subagente explorador do llama studio. Investigue a tarefa usando só as ferramentas de leitura disponíveis. '
    + 'Seja eficiente: procure antes de ler, leia só o necessário. Não faça perguntas. Quando terminar, responda com um relatório objetivo em português: '
    + 'o que encontrou, com caminhos de arquivo, trechos curtos relevantes e URLs. Se algo não existir, diga.\n\n' + tctx.ctxText.split('\n\n').filter((p) => !p.startsWith('O usuário ativou as skills')).join('\n\n');
  const msgs = [{ role: 'system', content: sys }, { role: 'user', content: args.task + (args.where ? `\n\nComece por: ${args.where}` : '') }];
  tmsg._sub = [];
  const max = Math.max(3, Number(S.settings.explorerSteps) || 20);
  for (let step = 0; step <= max; step++) {
    if (tctx.signal.aborted) return { content: 'Cancelado.', isError: true };
    const last = step === max;
    if (last) msgs.push({ role: 'user', content: 'Limite de passos atingido. Escreva agora o relatório final com o que já encontrou.' });
    const m = { content: '', reasoning: '', tool_calls: [] };
    await streamRaw(msgs, last ? [] : tools, m, tctx.signal, null);
    const calls = m.tool_calls.filter((t) => t && t.function?.name);
    calls.forEach((t) => { if (!t.id) t.id = 'call_' + uid(); });
    const text = splitThink(m.content).text;
    if (!calls.length) return { content: text.trim() || 'O subagente terminou sem relatório.', isError: false };
    msgs.push({ role: 'assistant', content: text, tool_calls: calls.map((t) => ({ id: t.id, type: 'function', function: { name: t.function.name, arguments: t.function.arguments || '{}' } })) });
    for (const t of calls) {
      const a = parseArgs(t.function.arguments) || {};
      const st = { name: t.function.name, summary: toolSummary(t.function.name, a), status: 'running' };
      tmsg._sub.push(st); scheduleRender();
      const r = only.includes(t.function.name) ? await execTool(t.function.name, a, {}, tctx, {}) : { content: 'Ferramenta não permitida para o explorador.', isError: true };
      st.status = r.isError ? 'error' : 'ok'; scheduleRender();
      msgs.push({ role: 'tool', tool_call_id: t.id, content: String(r.content).slice(0, 24000) });
    }
  }
  return { content: 'O subagente não concluiu.', isError: true };
}

/* ============================================================ pasta de trabalho */
function relOf(p) {
  const ws = S.ws.path;
  if (!ws) return p;
  const a = p.replace(/\//g, '\\').toLowerCase(); const b = ws.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '');
  if (a.startsWith(b + '\\')) return p.slice(b.length + 1).replace(/\\/g, '/');
  return p.replace(/\\/g, '/');
}

function markFresh(p) {
  const rel = relOf(p).replace(/^\.\//, '').replace(/\\/g, '/');
  S.ws.fresh.add(rel);
  // expande as pastas até o arquivo
  const parts = rel.split('/'); parts.pop();
  let acc = '';
  for (const part of parts) { acc = acc ? acc + '/' + part : part; S.ws.expanded.add(acc); }
  refreshTree();
}

function renderWsPath() {
  const b = $('#ws-path');
  b.innerHTML = '';
  b.append(ic('folderOpen'), h('div.ws-path-main', null, h('div.ws-path-name', null, basename(S.ws.path) || S.ws.path), h('div.ws-path-full', null, S.ws.path)), h('span.swap', null, 'Trocar'));
}

async function loadDir(rel) {
  const r = await api('/api/ws/list?path=' + encodeURIComponent(rel || '.') + '&ws=' + encodeURIComponent(S.ws.path));
  S.ws.cache.set(rel, r.items);
  return r.items;
}

const refreshTree = debounce(async () => {
  S.ws.cache.clear();
  await renderTree();
}, 150);

async function renderTree() {
  const box = $('#ws-tree');
  try {
    const frag = document.createDocumentFragment();
    await buildLevel(frag, '', 0);
    box.innerHTML = '';
    box.append(frag);
    if (!box.childElementCount) box.append(h('div.tree-empty', null, 'Pasta vazia. Peça ao modelo para criar algo aqui.'));
  } catch (e) {
    box.innerHTML = '';
    box.append(h('div.tree-empty', null, 'Não consegui ler a pasta: ' + e.message));
  }
}

async function buildLevel(parent, rel, depth) {
  const items = S.ws.cache.get(rel) || await loadDir(rel);
  for (const it of items) {
    const r = it.rel;
    const open = it.dir && S.ws.expanded.has(r);
    const ft = ftype(it.name, it.dir);
    const node = h('div.node' + (it.dir ? '.dir' : '') + (open ? '.open' : '') + (S.ws.fresh.has(r) ? '.fresh' : '') + (S.ws.selected === r ? '.sel' : ''),
      { style: { paddingLeft: 6 + depth * 14 + 'px' }, title: it.path },
      h('span', { html: svg('chev', 'tw' + (it.dir ? '' : ' blank')), style: { display: 'contents' } }),
      h('span', { html: svg(it.dir ? (open ? 'folderOpen' : 'folder') : ft.icon, 'fi'), style: { display: 'contents', '--c': ft.color } }),
      h('span.nm', null, it.name),
      !it.dir ? h('span.sz', null, fmtSize(it.size)) : null);
    node.style.setProperty('--c', ft.color);
    node.addEventListener('pointerdown', (e) => startTreeDrag(e, it));
    node.addEventListener('click', async () => {
      if (treeDragJustEnded) return;
      if (it.dir) {
        if (S.ws.expanded.has(r)) S.ws.expanded.delete(r); else S.ws.expanded.add(r);
        store.set('wsExp:' + S.ws.path, [...S.ws.expanded]);
        renderTree();
      } else { S.ws.selected = r; $$('.node.sel').forEach((n) => n.classList.remove('sel')); node.classList.add('sel'); previewFile(it); }
    });
    node.addEventListener('dblclick', () => { if (!it.dir) addRef({ name: it.name, path: it.path, dir: false }); });
    parent.append(node);
    if (open) await buildLevel(parent, r, depth + 1);
  }
}

let treeDragJustEnded = false;
function startTreeDrag(e, it) {
  if (e.button !== 0) return;
  const sx = e.clientX; const sy = e.clientY;
  let ghost = null;
  const overChat = (x, y) => { const el = document.elementFromPoint(x, y); return el && $('#chat').contains(el) ? el : null; };
  const move = (ev) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      const ft = ftype(it.name, it.dir);
      ghost = h('div.drag-ghost', null, h('span', { html: svg(ft.icon), style: { color: ft.color, display: 'grid' } }), it.name);
      document.body.append(ghost);
      document.body.classList.add('tree-dragging');
    }
    ghost.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 10}px)`;
    $('#composer').classList.toggle('dragging', !!overChat(ev.clientX, ev.clientY));
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    if (!ghost) return;
    ghost.remove();
    document.body.classList.remove('tree-dragging');
    $('#composer').classList.remove('dragging');
    treeDragJustEnded = true; setTimeout(() => { treeDragJustEnded = false; }, 50);
    const el = overChat(ev.clientX, ev.clientY);
    if (!el) return;
    const r = rangeAtPoint(ev.clientX, ev.clientY);
    if (r) savedRange = r;
    addRef({ name: it.name, path: it.path, dir: it.dir });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, { once: true });
}

/* arquivos soltos na janela própria: o caminho real vem do sistema */
window.studioNativeDrag = (on) => {
  if (S.view === 'skills') $('#skill-drop').classList.toggle('over', on);
  else $('#composer').classList.toggle('dragging', on && S.view === 'chat');
};
window.studioNativeDrop = async (paths, x, y) => {
  window.studioNativeDrag(false);
  if (S.view === 'skills') { for (const p of paths) await importSkillPath(p); return; }
  if (S.view !== 'chat') setView('chat');
  const dpr = window.devicePixelRatio || 1;
  const cx = x / dpr; const cy = y / dpr;
  const el = document.elementFromPoint(cx, cy);
  const r = rangeAtPoint(cx, cy);
  if (r) savedRange = r;
  for (const p of paths) statRef(p);
};

async function previewFile(it) {
  const box = $('#ws-preview');
  box.classList.add('open');
  box.innerHTML = '';
  const body = h('div.wp-body', null, h('div.wp-note', null, 'Carregando...'));
  box.append(h('div.wp-head', null,
    h('span', { html: svg(ftype(it.name).icon), style: { width: '15px', color: ftype(it.name).color, display: 'grid' } }),
    h('span.wp-name', { title: it.path }, it.name),
    h('button.icon-btn.sm', { title: 'Referenciar no chat', 'aria-label': 'Referenciar no chat', html: svg('pin'), onclick: () => { addRef({ name: it.name, path: it.path, dir: false }); toast('Arquivo referenciado no chat'); } }),
    h('button.icon-btn.sm', { title: 'Mostrar no Explorer', 'aria-label': 'Mostrar no Explorer', html: svg('external'), onclick: () => api('/api/reveal', { path: it.path, ws: S.ws.path }) }),
    h('button.icon-btn.sm', { title: 'Fechar', 'aria-label': 'Fechar', html: svg('x'), onclick: () => { box.classList.remove('open'); S.ws.selected = null; $$('.node.sel').forEach((n) => n.classList.remove('sel')); } })),
  body);
  try {
    const r = await api('/api/ws/read?path=' + encodeURIComponent(it.rel) + '&ws=' + encodeURIComponent(S.ws.path));
    body.innerHTML = '';
    if (r.tooBig) body.append(h('div.wp-note', null, `Arquivo grande (${fmtSize(r.size)}). Abra no Explorer para ver.`));
    else if (r.binary) body.append(h('div.wp-note', null, `Arquivo binário (${fmtSize(r.size)}). O modelo recebe só o caminho.`));
    else {
      const hl = highlight(r.text.slice(0, 200000), ftype(it.name).lang);
      body.append(h('pre', null, h('code.hljs', { html: hl.html })));
    }
  } catch (e) { body.innerHTML = ''; body.append(h('div.wp-note', null, e.message)); }
}

async function chooseWorkspace() {
  const proj = projectOf(cur());
  const p = await pickPath({ title: proj ? `Pasta do projeto ${proj.name}` : 'Escolher o espaço de trabalho', mode: 'dir', start: S.ws.path });
  if (!p) return;
  if (proj) {
    const st = await api('/api/stat', { path: p }).catch(() => ({}));
    if (!st.exists || !st.dir) { toast('Essa pasta não existe.', 'err'); return; }
    proj.dir = st.path; saveProjects(); syncWsRoot(true); renderChatTitle();
    toast(`Pasta do projeto: ${basename(st.path)}`);
    return;
  }
  setWorkspace(p);
}

async function setWorkspace(p) {
  try {
    const r = await api('/api/workspace', { path: p });
    S.info.workspace = r.workspace;
    S.ws.path = r.workspace; S.ws.expanded.clear(); S.ws.fresh.clear(); S.ws.cache.clear();
    store.set('wsExp:' + S.ws.path, []);
    S.info.recentWorkspaces = [r.workspace, ...(S.info.recentWorkspaces || []).filter((x) => x !== r.workspace)];
    renderWsPath(); renderTree();
    $('#ws-preview').classList.remove('open');
    if (!cur()?.messages.length) renderMessages(false);
    updatePickers(); renderChatTitle();
    toast('Espaço de trabalho: ' + basename(r.workspace));
  } catch (e) { toast(e.message, 'err'); }
}

/* ------------------------------------------------------------ seletor de caminhos */
function pickPath({ title, mode = 'dir', start }) {
  return new Promise((resolve) => {
    let curPath = start || ''; let selected = null; let done = false;
    const sep = S.info.sep || '\\';
    const home = S.info.home || '';
    const list = h('div.picker-list');
    const crumbs = h('div.crumbs');
    const input = h('input.input.mono', { value: curPath, placeholder: 'Cole um caminho e tecle Enter' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(input.value.trim().replace(/^"|"$/g, '')); });
    const places = h('div.picker-places', null,
      h('button', { onclick: () => go(home) }, 'Início'),
      h('button', { onclick: () => go(home + sep + 'Desktop') }, 'Área de trabalho'),
      h('button', { onclick: () => go(home + sep + 'Downloads') }, 'Downloads'),
      h('button', { onclick: () => go(home + sep + 'Documents') }, 'Documentos'),
      h('button', { onclick: () => go('') }, 'Unidades'),
      (S.info.recentWorkspaces || []).slice(0, 4).map((p) => h('button', { onclick: () => go(p), title: p }, basename(p))));

    const okBtn = h('button.btn.primary', { onclick: () => finish(mode === 'dir' ? (selected || curPath) : selected) }, mode === 'dir' ? 'Usar esta pasta' : 'Selecionar');

    async function go(p) {
      try {
        const r = await api('/api/browse?files=' + (mode === 'dir' ? '0' : '1') + '&path=' + encodeURIComponent(p || ''));
        curPath = r.path; selected = null; input.value = r.path;
        crumbs.innerHTML = '';
        if (r.path) {
          const parts = r.path.split(/[\\/]/).filter(Boolean);
          let acc = r.path.startsWith('/') ? '' : '';
          crumbs.append(h('button', { onclick: () => go('') }, 'Unidades'));
          parts.forEach((part, i) => {
            acc = i === 0 ? (r.path.startsWith('/') ? '/' + part : part + sep) : acc + (acc.endsWith(sep) ? '' : sep) + part;
            const target = acc;
            crumbs.append(h('i', null, '/'), h('button', { onclick: () => go(target) }, part));
          });
        }
        list.innerHTML = '';
        if (r.parent !== null && r.path) list.append(h('div.pk.d', { ondblclick: () => go(r.parent), onclick: () => go(r.parent) }, ic('up'), '..'));
        for (const it of r.items) {
          const row = h('div.pk' + (it.dir ? '.d' : ''), null, ic(it.dir ? 'folder' : ftype(it.name).icon), h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.name), !it.dir ? h('span', { style: { fontSize: '12px', color: 'var(--muted)' } }, fmtSize(it.size)) : null);
          row.addEventListener('click', () => {
            $$('.pk.sel', list).forEach((x) => x.classList.remove('sel'));
            row.classList.add('sel'); selected = it.path;
            if (!it.dir && mode === 'file') okBtn.textContent = 'Selecionar';
          });
          row.addEventListener('dblclick', () => { if (it.dir) go(it.path); else finish(it.path); });
          list.append(row);
        }
        if (!r.items.length) list.append(h('div.tree-empty', null, mode === 'dir' ? 'Sem subpastas aqui.' : 'Pasta vazia.'));
      } catch (e) { toast(e.message, 'err'); }
    }
    function finish(p) { if (!p) { toast('Selecione um item.'); return; } done = true; m.close(); resolve(p); }
    const m = modal({
      title, wide: true,
      body: [places, input, crumbs, list],
      foot: [h('span.muted', { style: { marginRight: 'auto', fontSize: '13px' } }, mode === 'dir' ? 'Clique duas vezes para entrar numa pasta.' : 'Clique duas vezes para escolher.'), h('button.btn', { onclick: () => m.close() }, 'Cancelar'), okBtn],
      onClose: () => { if (!done) resolve(null); },
    });
    go(curPath);
  });
}

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

async function editSkill(id) {
  let data = { name: '', description: '', body: '' };
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
        h('div.srv-status', null, h('span.dot.' + st.dot), s.status === 'connected' ? `${s.tools.length} ferramentas` : s.status === 'connecting' && s.since ? `conectando... ${Math.max(0, Math.round((Date.now() - s.since) / 1000))} s` : st.label),
        h('div.srv-actions', null,
          h('button.icon-btn.sm', { title: 'Reconectar', 'aria-label': 'Reconectar', html: svg('refresh'), onclick: async () => { s.status = 'connecting'; drawMcpList(); try { await api('/api/mcp/reconnect', { name: s.name }); } catch (e) { toast(e.message, 'err'); } loadMcp(); } }),
          h('button.icon-btn.sm', { title: 'Editar', 'aria-label': 'Editar', html: svg('edit'), onclick: () => editServer(s.name, s.config) }),
          h('button.icon-btn.sm', { title: 'Remover', 'aria-label': 'Remover', html: svg('trash'), onclick: async () => {
            if (!(await confirmBox(`Remover o conector "${s.name}"?`, 'Remover', true))) return;
            await api('/api/mcp/delete', { name: s.name }); S.sel.mcp = S.sel.mcp.filter((x) => x !== s.name); saveSel(); loadMcp();
          } })),
        h('label.switch', { title: 'Ligar/desligar' }, sw, h('span'))),
      s.error ? h('div.srv-err', null, s.error.length > 300 ? s.error.slice(0, 300) + '...' : s.error) : null);
    const keep = (d, key) => { d.open = S.mcpOpen?.has(key) || false; d.addEventListener('toggle', () => { (S.mcpOpen ||= new Set())[d.open ? 'add' : 'delete'](key); }); return d; };
    if (s.tools.length) {
      const d = keep(h('details', null, h('summary', null, ic('chev'), `Ferramentas (${s.tools.length})`),
        h('div.srv-tools', null, s.tools.map((t) => h('div.srv-tool', null, h('b', null, t.name), t.description ? h('div', null, t.description) : null)))), s.name + ':tools');
      card.append(d);
    }
    // log sempre recolhido; só abre se a pessoa clicar
    if (s.log?.trim()) card.append(keep(h('details', null, h('summary', null, ic('chev'), `Log do servidor (${s.log.trim().split('\n').length} linhas)`), h('pre.srv-log', null, s.log.trim().split('\n').slice(-80).join('\n'))), s.name + ':log'));
    list.append(card);
  }
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

/* ============================================================ configurações */
function renderSettings() {
  const f = $('#settings-form'); f.innerHTML = '';
  const st = S.settings;
  const llama = h('input.input.mono', { value: S.info.llamaUrl || '' });
  const sys = h('textarea.textarea', { rows: 5, value: st.systemPrompt, placeholder: 'Ex.: Responda sempre em português do Brasil, de forma direta.' });
  const temp = h('input.input', { value: st.temperature, placeholder: 'padrão do servidor', inputmode: 'decimal' });
  const topP = h('input.input', { value: st.topP, placeholder: 'padrão do servidor', inputmode: 'decimal' });
  const maxT = h('input.input', { value: st.maxTokens, placeholder: 'sem limite', inputmode: 'numeric' });
  const steps = h('input.input', { value: st.maxSteps, inputmode: 'numeric' });
  let approval = st.approval; let theme = st.theme;
  const seg = (opts, get, set) => {
    const el = h('div.seg', null, opts.map(([v, l]) => h('button', { type: 'button', class: get() === v ? 'on' : '', onclick: () => { set(v); $$('button', el).forEach((b, i) => b.classList.toggle('on', opts[i][0] === v)); } }, l)));
    return el;
  };
  const think = h('input', { type: 'checkbox', checked: st.showThinking });
  const gpu = h('input', { type: 'checkbox', checked: !!S.info.windowGpu });
  const tray = h('input', { type: 'checkbox', checked: S.info.closeToTray !== false });
  for (const c of [gpu, tray]) c.addEventListener('change', () => { c.nextElementSibling.style.background = c.checked ? 'var(--accent)' : ''; });

  const groupsBySec = {};
  for (const g of ['browser', 'computer', 'read', 'edit', 'write', 'shell', 'code', 'history', 'toolsearch', 'explore']) (groupsBySec[TOOL_INFO[g].sec] ||= []).push(g);
  const toolCards = Object.entries(groupsBySec).map(([sec, gs]) => [
    h('div.tsec', null, sec),
    h('div.tgrid', null, gs.map((g) => {
      const i = h('input', { type: 'checkbox', checked: !!S.settings.tools[g] });
      i.addEventListener('change', () => { S.settings.tools[g] = i.checked; store.set('settings', S.settings); updatePickers(); });
      return h('label.tcard', { title: TOOL_INFO[g].desc }, h('span.tc-main', null, h('span.tc-title', null, TOOL_INFO[g].title), h('span.tc-desc', null, TOOL_INFO[g].desc)), h('span.switch', null, i, h('span')));
    })),
  ]);
  let vision = st.vision;
  f.append(
    h('div.section-title#tools-section', null, 'Ferramentas'),
    h('p.muted', { style: { margin: '-4px 0 0', fontSize: '13px' } }, 'O que o modelo pode usar. Ações que mudam algo pedem permissão, conforme a opção mais abaixo.'),
    ...toolCards.flat(),
    h('div.field', null, h('label', null, 'Enviar imagens (capturas) ao modelo'), seg([['auto', `Automático (${S.vision ? 'o modelo tem visão' : 'sem visão detectada'})`], ['on', 'Sempre'], ['off', 'Nunca']], () => vision, (v) => { vision = v; S.settings.vision = v; store.set('settings', S.settings); })),
    h('div.field', null, h('label', null, 'Passos de cada subagente'), (() => { const x = h('input.input', { value: st.explorerSteps, inputmode: 'numeric', style: { maxWidth: '120px' } }); x.addEventListener('change', () => { S.settings.explorerSteps = Number(x.value) || 20; store.set('settings', S.settings); }); return x; })()),
    h('div.section-title', null, 'Atualizações'),
    updateSection(),
    h('div.section-title', null, 'Contexto'),
    (() => {
      const i = h('input', { type: 'checkbox', checked: !!st.autoCompact });
      i.addEventListener('change', () => { S.settings.autoCompact = i.checked; store.set('settings', S.settings); });
      return h('label.tcard', null, h('span.tc-main', null, h('span.tc-title', null, 'Compactar automaticamente'), h('span.tc-desc', null, `Resume o começo da conversa quando passar de ${st.compactAt}% do contexto${S.nCtx ? ` (${S.nCtx.toLocaleString('pt-BR')} tokens)` : ''}.`)), h('span.switch', null, i, h('span')));
    })(),
    h('div.field', null, h('label', null, 'Compactar ao chegar em (% do contexto)'), (() => { const x = h('input.input', { value: st.compactAt, inputmode: 'numeric', style: { maxWidth: '120px' } }); x.addEventListener('change', () => { S.settings.compactAt = Math.min(95, Math.max(30, Number(x.value) || 75)); x.value = S.settings.compactAt; store.set('settings', S.settings); }); return x; })()),
    h('div.section-title', null, 'Servidor'),
    h('div.field', null, h('label', null, 'Endereço do llama-server'), llama, h('small', null, 'Muda sozinho quando você salva a página Servidor. Ajuste aqui só se o llama-server roda em outro lugar.')),
    h('div.section-title', null, 'Modelo'),
    h('div.field', null, h('label', null, 'Prompt de sistema'), sys, h('small', null, 'Vai antes das informações do espaço de trabalho e das habilidades.')),
    h('div.row', null,
      h('div.field', null, h('label', null, 'Temperatura'), temp),
      h('div.field', null, h('label', null, 'Top P'), topP),
      h('div.field', null, h('label', null, 'Máximo de tokens'), maxT)),
    h('div.section-title', null, 'Ferramentas'),
    h('div.field', null, h('label', null, 'Pedir confirmação antes de'), seg([['writes', 'Alterar arquivos'], ['all', 'Qualquer ferramenta'], ['never', 'Nunca perguntar']], () => approval, (v) => { approval = v; })),
    h('div.field', null, h('label', null, 'Passos com ferramentas por resposta'), steps, h('small', null, 'Limite de rodadas de ferramenta antes de o modelo parar.')),
    S.info.native ? h('div.section-title', null, 'Janela') : null,
    S.info.native ? h('label.opt', { style: { padding: '4px 0' } }, gpu, h('span.check', { html: svg('check'), style: { background: gpu.checked ? 'var(--accent)' : '' } }), h('span.opt-main', null, h('span.opt-title', null, 'Usar a placa de vídeo para desenhar a janela'), h('span.opt-desc', null, 'Desligado, a janela não ocupa VRAM do modelo. Vale na próxima vez que a janela abrir.'))) : null,
    S.info.native ? h('label.opt', { style: { padding: '4px 0' } }, tray, h('span.check', { html: svg('check'), style: { background: tray.checked ? 'var(--accent)' : '' } }), h('span.opt-main', null, h('span.opt-title', null, 'Fechar a janela deixa o studio na bandeja'), h('span.opt-desc', null, 'A janela é destruída e a memória dela volta para o sistema.'))) : null,
    h('div.section-title', null, 'Aparência'),
    h('div.field', null, h('label', null, 'Tema'), seg([['auto', 'Automático'], ['dark', 'Escuro'], ['light', 'Claro']], () => theme, (v) => { theme = v; S.settings.theme = v; applyTheme(); })),
    h('label.opt', { style: { padding: '4px 0' } }, think, h('span.check', { html: svg('check'), style: { background: think.checked ? 'var(--accent)' : '' } }), h('span.opt-main', null, h('span.opt-title', null, 'Mostrar o raciocínio do modelo'))),
    h('div.form-foot', null, h('button.btn.primary', { type: 'button', onclick: async () => {
      Object.assign(S.settings, { systemPrompt: sys.value, temperature: temp.value.trim(), topP: topP.value.trim(), maxTokens: maxT.value.trim(), maxSteps: Number(steps.value) || 30, approval, theme, showThinking: think.checked });
      store.set('settings', S.settings);
      if (S.info.native) { await api('/api/config', { windowGpu: gpu.checked, closeToTray: tray.checked }); S.info.windowGpu = gpu.checked; S.info.closeToTray = tray.checked; }
      if (llama.value.trim() && llama.value.trim() !== S.info.llamaUrl) {
        await api('/api/config', { llamaUrl: llama.value.trim() }); S.info.llamaUrl = llama.value.trim(); checkHealth();
      }
      applyTheme(); toast('Configurações salvas');
    } }, 'Salvar configurações')));
  think.addEventListener('change', () => { think.nextElementSibling.style.background = think.checked ? 'var(--accent)' : ''; });
}

/* ============================================================ servidor (llama-server) */
async function startLlama() {
  try { S.llama = await api('/api/llama/start', {}); showSplash(); }
  catch (e) { toast(e.message, 'err'); setView('server'); }
  lastHealth = ''; checkHealth(); if (S.view === 'server') drawServerStatus();
}
async function stopLlama() {
  try { S.llama = await api('/api/llama/stop', {}); toast('Servidor parado'); } catch (e) { toast(e.message, 'err'); }
  lastHealth = ''; checkHealth(); if (S.view === 'server') drawServerStatus();
}

let srvTimer = null; let logNext = 0;
async function renderServerPage() {
  try { S.llama = await api('/api/llama'); } catch (e) { toast(e.message, 'err'); return; }
  drawServerStatus(); drawServerForm();
  $('#srv-log').textContent = ''; logNext = 0;
  await pollLog();
  clearInterval(srvTimer);
  srvTimer = setInterval(async () => {
    if (S.view !== 'server') { clearInterval(srvTimer); return; }
    await pollLog();
    try { const n = await api('/api/llama'); const changed = n.state !== S.llama.state || n.running !== S.llama.running; S.llama = n; if (changed) drawServerStatus(); } catch { /* ok */ }
  }, 1000);
}

function drawServerStatus() {
  const l = S.llama; const box = $('#srv-status'); box.innerHTML = '';
  const info = {
    ready: ['ok', 'Pronto', `Respondendo em ${l.url}`],
    external: ['ok', 'Rodando fora do studio', `Alguém já iniciou um llama-server em ${l.url} (start.bat ou llama-gui).`],
    loading: ['busy', 'Carregando o modelo...', 'Isso pode levar alguns minutos na primeira vez.'],
    'external-loading': ['busy', 'Carregando o modelo (fora do studio)...', `Um llama-server iniciado fora do studio está carregando em ${l.url}.`],
    stopped: ['err', 'Parado', l.config.Model ? 'Pronto para iniciar.' : 'Escolha o modelo abaixo para poder iniciar.'],
  }[l.state] || ['', l.state, ''];
  box.append(
    h('span.dot.big.' + info[0]),
    h('div.srv-st-main', null, h('div.srv-st-title', null, info[1]), h('div.srv-st-sub', null, info[2], l.pid ? `  (PID ${l.pid})` : '')),
    h('div.page-actions', null,
      !l.running && l.state === 'stopped' ? h('button.btn.primary', { onclick: startLlama }, ic('play'), 'Iniciar') : null,
      l.running ? h('button.btn', { onclick: async () => { try { S.llama = await api('/api/llama/restart', {}); toast('Reiniciando...'); drawServerStatus(); } catch (e) { toast(e.message, 'err'); } } }, ic('refresh'), 'Reiniciar') : null,
      l.running ? h('button.btn.danger', { onclick: stopLlama }, ic('stop'), 'Parar') : null,
      h('button.btn', { onclick: () => navigator.clipboard.writeText(l.command).then(() => toast('Comando copiado')) }, ic('copy'), 'Copiar comando')));
}

function drawServerForm() {
  const c = S.llama.config; const f = $('#srv-form'); f.innerHTML = '';
  const inp = (v, mono = true, extra = {}) => h('input.input' + (mono ? '.mono' : ''), { value: v ?? '', ...extra });
  const exe = inp(c.ServerExe); const model = inp(c.Model);
  const host = inp(c.BindHost); const port = inp(c.Port, true, { inputmode: 'numeric' });
  const ctx = inp(c.Context, true, { inputmode: 'numeric' }); const moe = inp(c.CpuMoe, true, { inputmode: 'numeric' });
  const thr = inp(c.Threads, true, { inputmode: 'numeric' }); const hip = inp(c.HipDevices);
  const extra = h('textarea.textarea.mono', { rows: 5, value: c.ExtraArgs || '' });
  const auto = h('input', { type: 'checkbox', checked: !!c.AutoStart });
  const browse = (target, title, mode) => h('button.btn', { type: 'button', onclick: async () => {
    const start = target.value ? target.value.replace(/[\\/][^\\/]*$/, '') : S.info.home;
    const p = await pickPath({ title, mode, start }); if (p) target.value = p;
  } }, 'Procurar');
  const row = (label, input, btn, small) => h('div.field', null, h('label', null, label), btn ? h('div.inline', null, input, btn) : input, small ? h('small', null, small) : null);
  f.append(
    row('Modelo (.gguf)', model, browse(model, 'Escolher o modelo (.gguf)', 'file')),
    row('llama-server', exe, browse(exe, 'Escolher o llama-server', 'file')),
    h('div.row', null, row('Host', host), row('Porta', port), row('Contexto', ctx)),
    h('div.row', null, row('Camadas MoE na CPU', moe, null, '0 = nenhuma'), row('Threads', thr, null, '0 = automático'), row('HIP_VISIBLE_DEVICES', hip)),
    row('Argumentos extras', extra),
    h('label.opt', { style: { padding: '2px 0' } }, auto, h('span.check', { html: svg('check'), style: { background: auto.checked ? 'var(--accent)' : '' } }), h('span.opt-main', null, h('span.opt-title', null, 'Iniciar o servidor quando o studio abrir'))),
    h('div.form-foot', null, h('button.btn.primary', { type: 'button', onclick: async () => {
      const num = (x) => Math.max(0, parseInt(x.value, 10) || 0);
      try {
        S.llama = await api('/api/llama/config', { config: { ServerExe: exe.value.trim().replace(/^"|"$/g, ''), Model: model.value.trim().replace(/^"|"$/g, ''), BindHost: host.value.trim() || '127.0.0.1', Port: num(port) || 1235, Context: num(ctx), CpuMoe: num(moe), Threads: num(thr), HipDevices: hip.value.trim(), ExtraArgs: extra.value.trim(), AutoStart: auto.checked } });
        S.info.llamaUrl = S.llama.url; lastHealth = '';
        toast(S.llama.running ? 'Salvo. Reinicie o servidor para aplicar.' : 'Configuração salva');
        drawServerStatus(); checkHealth();
      } catch (e) { toast(e.message, 'err'); }
    } }, 'Salvar')));
  auto.addEventListener('change', () => { auto.nextElementSibling.style.background = auto.checked ? 'var(--accent)' : ''; });
}

async function pollLog() {
  let r; try { r = await api('/api/llama/log?since=' + logNext); } catch { return; }
  if (!r.lines.length) { logNext = r.next; return; }
  const pre = $('#srv-log');
  const stick = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
  if (r.from > logNext && logNext) pre.append('[... linhas antigas descartadas]\n');
  pre.append(r.lines.join('\n') + '\n');
  logNext = r.next;
  // mantém o DOM leve
  if (pre.textContent.length > 400000) pre.textContent = pre.textContent.slice(-300000);
  if (stick) pre.scrollTop = pre.scrollHeight;
  $('#srv-log-count').textContent = `${logNext} linhas`;
}

/* ============================================================ tela de abertura */
// Etapas reconhecidas no log do llama-server e onde cada uma começa na barra (%)
const LOAD_STEPS = [
  { re: /llama_model_loader|print_info|loading model/i, pct: 5, label: 'Lendo o modelo' },
  { re: /load_tensors|offload|model buffer size/i, pct: 20, label: 'Carregando os pesos na memória e na GPU' },
  { re: /llama_context|llama_kv_cache|KV self size|kv_unified|n_ctx/i, pct: 80, label: 'Preparando o contexto' },
  { re: /warming up|warmup/i, pct: 92, label: 'Aquecendo o modelo' },
  { re: /server is listening|all slots are idle|main: model loaded/i, pct: 99, label: 'Abrindo o servidor' },
];
const splash = { on: false, step: -1, logNext: 0, timer: null, t0: 0, last: '' };

function splashFmt(ms) { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; }

function showSplash() {
  if (splash.on) return;
  const l = S.llama || {};
  splash.on = true; splash.step = -1; splash.logNext = 0; splash.last = '';
  splash.t0 = l.startedAt || Date.now();
  $('#sp-model').textContent = l.config?.Model ? shortModel(l.config.Model) : `llama-server em ${l.url || S.info.llamaUrl}`;
  $('#sp-steps').innerHTML = '';
  if (l.state !== 'external-loading') for (const st of LOAD_STEPS.slice(0, 4)) $('#sp-steps').append(h('li', null, st.label));
  $('#splash').hidden = false;
  requestAnimationFrame(() => $('#splash').classList.add('show'));
  tickSplash();
  splash.timer = setInterval(tickSplash, 700);
}

function hideSplash(done) {
  if (!splash.on) return;
  splash.on = false; clearInterval(splash.timer);
  if (done) {
    $('#sp-fill').style.width = '100%'; $('#sp-stage').textContent = 'Pronto';
    $$('#sp-steps li').forEach((li) => { li.className = 'ok'; });
  }
  setTimeout(() => { $('#splash').classList.remove('show'); setTimeout(() => { $('#splash').hidden = true; }, 350); }, done ? 450 : 0);
}

async function tickSplash() {
  let l;
  try { l = S.llama = noteLlama(await api('/api/llama')); } catch { return; }
  if (l.state === 'ready' || l.state === 'external') {
    lastHealth = ''; checkHealth();
    return hideSplash(true);
  }
  if (l.state === 'stopped') { toast('O llama-server parou durante a carga. Veja o log.', 'err'); hideSplash(false); setView('server'); return; }
  // log: etapa e última linha
  if (l.running) {
    try {
      const r = await api('/api/llama/log?since=' + splash.logNext);
      splash.logNext = r.next;
      for (const line of r.lines) {
        LOAD_STEPS.forEach((st, i) => { if (i > splash.step && st.re.test(line)) splash.step = i; });
        if (line.trim()) splash.last = line.trim();
      }
    } catch { /* ok */ }
  }
  const elapsed = Date.now() - splash.t0;
  const prev = store.get('loadMs', 0);
  const stage = LOAD_STEPS[splash.step];
  const floor = stage ? stage.pct : 2;
  const ceil = LOAD_STEPS[splash.step + 1]?.pct ?? 99;
  let pct = floor;
  if (prev) pct = Math.max(floor, Math.min(ceil - 1, (elapsed / prev) * 100));
  else if (stage) pct = Math.min(ceil - 1, floor + Math.log1p(elapsed / 4000) * 6);
  const known = l.running;
  $('#splash').classList.toggle('indet', !known);
  $('#sp-fill').style.width = known ? `${Math.min(99, pct).toFixed(1)}%` : '35%';
  $('#sp-stage').textContent = known ? (stage ? stage.label + '...' : 'Iniciando o servidor...') : 'Carregando o modelo (servidor iniciado fora do studio)...';
  $('#sp-time').textContent = splashFmt(elapsed) + (prev && known ? ` de ~${splashFmt(prev)}` : '');
  $$('#sp-steps li').forEach((li, i) => { li.className = i < splash.step ? 'ok' : i === splash.step ? 'now' : ''; });
  $('#sp-log').textContent = splash.last;
}

/** Guarda quanto a última carga do modelo levou (estimativa da barra). */
function noteLlama(l) {
  if (!l) return l;
  if (l.state === 'loading' && l.running && l.startedAt) S._loadingSince = l.startedAt;
  else if (l.state === 'ready' && S._loadingSince && l.startedAt === S._loadingSince) {
    const took = Date.now() - l.startedAt;
    if (took > 3000) store.set('loadMs', took);
    S._loadingSince = 0;
  }
  return l;
}

/** Espera o modelo terminar de carregar antes de responder (sem dar erro). */
async function waitModel(conv, signal) {
  const loading = () => S.llama && ['loading', 'external-loading'].includes(S.llama.state);
  if (!loading()) return;
  conv._waitingModel = true; scheduleRender();
  const t0 = Date.now();
  try {
    while (loading() && !signal.aborted && Date.now() - t0 < 20 * 60 * 1000) {
      await new Promise((r) => setTimeout(r, 1000));
      try { S.llama = noteLlama(await api('/api/llama')); } catch { /* ok */ }
    }
  } finally { conv._waitingModel = false; scheduleRender(); }
}

/* ============================================================ atualizações */
async function checkUpdates(force = false) {
  try { S.update = await api('/api/update' + (force ? '?force=1' : '')); } catch { return null; }
  drawUpdateBadge();
  return S.update;
}

function drawUpdateBadge() {
  const u = S.update;
  let el = $('#update-badge');
  if (!(u && (u.uiUpdate || u.exeUpdate))) { el?.remove(); return; }
  if (!el) { el = h('button.update-badge#update-badge', { onclick: openUpdate }); $('#server-status').before(el); }
  el.innerHTML = '';
  el.append(ic('download'), h('span.ub-main', null, h('b', null, `Versão ${u.latest} disponível`), h('span', null, u.exeUpdate ? 'Programa e interface' : 'Interface nova')), h('span.ub-go', null, 'Ver'));
}

function openUpdate() {
  const u = S.update; if (!u) return;
  const running = S.llama?.running;
  let m;
  const busy = (b, label) => { b.disabled = true; b.textContent = label; };
  const uiBtn = u.uiUpdate ? h('button.btn' + (u.exeUpdate ? '' : '.primary'), { onclick: async (e) => {
    busy(e.currentTarget, 'Baixando...');
    try { const r = await api('/api/update/ui', {}); toast(`Interface ${r.version} instalada. Recarregando...`); setTimeout(() => location.reload(), 700); }
    catch (err) { toast(err.message, 'err'); m.close(); }
  } }, u.exeUpdate ? 'Só a interface' : 'Atualizar interface') : null;
  const exeBtn = u.exeUpdate ? h('button.btn.primary', { onclick: async (e) => {
    busy(e.currentTarget, 'Baixando...');
    try {
      await api('/api/update/exe', {});
      m.close();
      modal({ title: 'Reiniciando', body: h('p', null, 'A versão nova está abrindo. Esta janela vai fechar sozinha.') });
      if (!S.info.native) {
        // no navegador: espera a versão nova responder e recarrega
        const t0 = Date.now();
        const wait = async () => { try { const a = await api('/api/app'); if (a.version !== u.exe) return location.reload(); } catch { /* ainda reiniciando */ } if (Date.now() - t0 < 60000) setTimeout(wait, 1000); };
        setTimeout(wait, 2500);
      }
    } catch (err) { toast(err.message, 'err'); m.close(); }
  } }, 'Atualizar e reiniciar') : null;
  m = modal({
    title: `Atualização ${u.latest}`,
    body: [
      h('p.muted', { style: { marginTop: 0 } }, `Você usa o programa ${u.exe} com a interface ${u.ui}.`),
      u.notes ? h('div.md.update-notes', { html: md(u.notes) }) : null,
      u.exeUpdate && running ? h('p', { style: { color: 'var(--warn)', fontSize: '13.5px' } }, 'O llama-server reinicia junto e vai recarregar o modelo.') : null,
    ],
    foot: [h('a.btn.ghost', { href: u.url, target: '_blank', style: { marginRight: 'auto' } }, 'Ver no GitHub'), h('button.btn', { onclick: () => m.close() }, 'Depois'), uiBtn, exeBtn],
  });
}

function updateSection() {
  const box = h('div.form', { style: { gap: '10px' } });
  const info = h('p.muted', { style: { margin: 0, fontSize: '13.5px' } }, `Programa ${S.info.version || '?'}, interface ${S.info.uiVersion || '?'}. Atualizações vêm de github.com/${S.info.repo || ''}.`);
  const btn = h('button.btn', { type: 'button', onclick: async () => {
    btn.disabled = true; btn.textContent = 'Procurando...';
    const u = await checkUpdates(true);
    btn.disabled = false; btn.textContent = 'Procurar atualizações';
    if (!u) toast('Não consegui verificar agora.', 'err');
    else if (u.error) toast(u.error, 'err');
    else if (u.uiUpdate || u.exeUpdate) openUpdate();
    else toast(`Você já está na versão mais nova (${u.latest}).`);
  } }, 'Procurar atualizações');
  const reset = S.info.uiVersion && S.info.uiVersion !== S.info.version ? h('button.btn.ghost', { type: 'button', onclick: async () => {
    if (!(await confirmBox('Voltar para a interface que veio com o programa?', 'Voltar'))) return;
    await api('/api/update/reset-ui', {}); location.reload();
  } }, 'Voltar à interface original') : null;
  box.append(info, h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, btn, reset));
  return box;
}

/* ============================================================ status do servidor */
let lastHealth = '';
async function checkHealth() {
  let status = 'offline';
  try {
    S.llama = noteLlama(await api('/api/llama'));
    status = { ready: 'ok', external: 'ok', loading: 'loading', 'external-loading': 'loading' }[S.llama.state] || 'offline';
  } catch {
    try { const r = await fetch('/health'); status = r.ok ? 'ok' : r.status === 503 ? 'loading' : 'offline'; } catch { status = 'offline'; }
  }
  if (status === 'ok' && !S.model) {
    try { const p = await (await fetch('/props')).json(); S.model = p.model_path || p.model_alias || ''; S.vision = !!(p.modalities?.vision); S.nCtx = p.default_generation_settings?.n_ctx || p.n_ctx || 0; } catch { /* ok */ }
    if (!S.model) { try { const m = await (await fetch('/v1/models')).json(); S.model = m.data?.[0]?.id || ''; } catch { /* ok */ } }
  }
  if (status !== 'ok') S.model = '';
  S.health.status = status;
  const canStart = status === 'offline' && S.llama && !S.llama.running && S.llama.config?.Model;
  const sig = status + S.model + S.info.llamaUrl + canStart;
  if (sig === lastHealth) return;
  lastHealth = sig;
  const el = $('#server-status'); el.innerHTML = '';
  el.append(h('span.dot.' + { ok: 'ok', loading: 'busy', offline: 'err' }[status]), h('div.ss-main', null,
    h('div.ss-title', null, { ok: 'llama-server pronto', loading: 'Carregando o modelo...', offline: 'llama-server desligado' }[status]),
    h('div.ss-sub', { title: S.model || S.info.llamaUrl }, S.model ? shortModel(S.model) : S.info.llamaUrl || '')),
    ...(canStart ? [h('button.btn.sm', { onclick: startLlama, title: 'Iniciar o llama-server' }, ic('play'), 'Iniciar')] : []));
  el.style.cursor = 'pointer';
  el.onclick = (e) => { if (!e.target.closest('button')) setView('server'); };
  updatePickers(); renderChatTitle();
}

/* ============================================================ início */
function toggleWs() {
  const hid = $('#ws').classList.toggle('hidden');
  $('#toggle-ws').classList.toggle('on', !hid);
  store.set('wsHidden', hid);
}

async function init() {
  applyTheme();
  const navIcons = { chat: 'chat', skills: 'sparkles', mcp: 'plug', personas: 'user', server: 'server', settings: 'gear' };
  const navLabels = { chat: 'Nova conversa', skills: 'Habilidades', mcp: 'Conectores', personas: 'Personalidades', server: 'Servidor', settings: 'Configurações' };
  $$('.nav-item').forEach((b) => {
    b.innerHTML = svg(navIcons[b.dataset.view]) + `<span>${navLabels[b.dataset.view]}</span>`;
    b.addEventListener('click', () => {
      if (b.dataset.view === 'chat') { const c = cur(); if (!c || c.messages.length) newConv(); setView('chat'); }
      else setView(b.dataset.view);
    });
  });
  $('.search-ico').innerHTML = svg('search');
  $('#search').addEventListener('input', () => { if (S.view !== 'chat') setView('chat'); renderConvList(); });
  $('#persona-new').append(ic('plus'), 'Nova personalidade');
  $('#persona-new').addEventListener('click', () => editPersona(null));
  $('#pick-persona').addEventListener('click', () => togglePop('#pop-persona', fillPersonaPop));
  $('#conv-menu-btn').innerHTML = svg('more');
  $('#conv-menu-btn').addEventListener('click', () => togglePop('#pop-conv', fillConvMenu));
  $('#toggle-ws').innerHTML = svg('panel');
  $('#ws-refresh').innerHTML = svg('refresh');
  $('#ws-open').innerHTML = svg('external');
  $('.drop-icon').innerHTML = svg('pin');
  $('#plus-btn').innerHTML = svg('plus');
  const wsHidden = store.get('wsHidden', false);
  $('#ws').classList.toggle('hidden', wsHidden);
  $('#toggle-ws').classList.toggle('on', !wsHidden);
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
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); return; }
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); }
  });
  ed.addEventListener('input', () => {
    if (!ed.textContent.trim() && !ed.querySelector('.pill')) ed.innerHTML = '';
    saveRange(); checkMention(); updatePickers();
  });
  ed.addEventListener('keyup', saveRange);
  ed.addEventListener('mouseup', saveRange);
  ed.addEventListener('blur', () => { saveRange(); setTimeout(closeMention, 150); });
  ed.addEventListener('paste', (e) => {
    e.preventDefault();
    if (e.clipboardData?.files?.length) { saveRange(); handleDrop(e.clipboardData); return; }
    const text = e.clipboardData.getData('text/plain');
    if (text) document.execCommand('insertText', false, text);
  });
  ed.addEventListener('drop', (e) => e.preventDefault());

  $('#send').addEventListener('click', send);
  $('#plus-btn').addEventListener('click', () => togglePop('#pop-plus', fillPlusPop));
  $('#pick-model').addEventListener('click', () => togglePop('#pop-model', fillModelPop));
  $('#pick-skills').addEventListener('click', () => togglePop('#pop-skills', fillSkillsPop));
  $('#pick-mcp').addEventListener('click', () => togglePop('#pop-mcp', fillMcpPop));
  $('#pick-ws').addEventListener('click', () => togglePop('#pop-ws', fillWsPop));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && running(cur()) && S.view === 'chat' && !$('#modal-root').childElementCount && !mention) stop();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search').focus(); $('#search').select(); }
  });

  setupDrop();
  setupSkillsPage();
  setupMcpPage();

  try {
    S.info = await api('/api/state');
    S.ws.path = wsOf(cur()) || S.info.workspace;
    $('#app-ver').textContent = 'v' + (S.info.uiVersion || S.info.version || '');
    $('#app-ver').title = `Programa ${S.info.version}, interface ${S.info.uiVersion}`;
  } catch (e) {
    toast('Não consegui falar com o auxiliar: ' + e.message, 'err');
  }
  renderWsPath();
  if (S.convs.length && !cur()) S.curId = S.convs[0].id;
  renderConvList();
  renderChat();
  renderTree();
  await Promise.all([loadSkills(), loadMcp(), checkHealth()]);
  // tela de abertura enquanto o modelo carrega (o servidor pode estar subindo agora)
  for (let i = 0; i < 4 && S.llama && S.llama.state === 'stopped' && S.llama.config?.AutoStart; i++) { await new Promise((r) => setTimeout(r, 400)); await checkHealth(); }
  if (S.llama && ['loading', 'external-loading'].includes(S.llama.state)) showSplash();
  $('#sp-skip').addEventListener('click', () => hideSplash(false));
  $('#sp-logbtn').addEventListener('click', () => { hideSplash(false); setView('server'); });
  renderComposer(); renderChatTitle();
  setInterval(checkHealth, 5000);
  setTimeout(() => checkUpdates(), 4000);
  setInterval(() => checkUpdates(), 6 * 3600 * 1000);
  focusEditor(true);
}

init();
