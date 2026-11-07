/* llama studio - idioma da interface (português ou inglês) */
'use strict';

/* O texto em português é a própria chave: L('Salvar') devolve 'Save' em inglês.
   Variáveis entram como {0}, {1}...: L('Lendo {0} de {1}', a, b).
   (L e não t: muito código usa t como variável local, ex.: tags.map((t) => ...).)
   Sem tradução, fica o português (nada quebra se faltar uma). */
const LANG = (() => {
  try {
    const s = JSON.parse(localStorage.getItem('studio.settings') || '{}');
    if (s.lang) return s.lang === 'en' ? 'en' : 'pt';
  } catch { /* sem armazenamento */ }
  return /^pt/i.test(navigator.language || '') ? 'pt' : 'en';
})();
const LOCALE = LANG === 'en' ? 'en-US' : 'pt-BR';
const DICT = LANG === 'en' && typeof I18N_EN === 'object' ? I18N_EN : null;
document.documentElement.lang = LANG === 'en' ? 'en' : 'pt-BR';

function L(s, ...args) {
  let out = (DICT && DICT[s]) || s;
  if (args.length) out = out.replace(/\{(\d+)\}/g, (m, i) => (args[i] ?? ''));
  return out;
}

/** Textos fixos do index.html (rodapés, rótulos, dicas). */
function translateStatic(root = document.body) {
  if (!DICT) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const raw = n.nodeValue; const k = raw.trim();
    if (k && DICT[k]) n.nodeValue = raw.replace(k, DICT[k]);
  }
  for (const el of root.querySelectorAll('[title],[placeholder],[aria-label],[data-placeholder]')) {
    for (const a of ['title', 'placeholder', 'aria-label', 'data-placeholder']) {
      const v = el.getAttribute(a); if (v && DICT[v.trim()]) el.setAttribute(a, DICT[v.trim()]);
    }
  }
  document.title = L(document.title);
}

/** Troca o idioma: guarda, avisa o programa (o modelo também muda) e recarrega a interface. */
async function setLang(lang) {
  try {
    const s = JSON.parse(localStorage.getItem('studio.settings') || '{}');
    s.lang = lang; localStorage.setItem('studio.settings', JSON.stringify(s));
  } catch { /* sem armazenamento */ }
  try { await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio': '1' }, body: JSON.stringify({ lang }) }); } catch { /* reabre igual */ }
  location.reload();
}
