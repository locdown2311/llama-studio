/* llama studio - prévia de HTML e SVG na própria conversa (blocos de código, páginas que o agente escreve e o painel
   de arquivos).

   Segurança: a página roda num iframe com sandbox SEM allow-same-origin, ou seja, numa origem opaca. Ela executa
   JavaScript, mas não enxerga o studio (nem cookies, nem /api, nem a sessão da central), não navega a janela de cima
   e não lê os arquivos: o que ela precisa da pasta (CSS, JS, imagens) entra embutido no documento. */
'use strict';

const PREV = { code: new Set(), view: new Set() }; // blocos em que a pessoa escolheu ver o código / a prévia
const PREV_SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-pointer-lock';
const PREV_LANGS = { html: 'html', htm: 'html', xhtml: 'html', svg: 'svg' };

/** O bloco é HTML/SVG que dá para ver? ('' quando não). */
function prevLang(text, lang) {
  const l = PREV_LANGS[lang];
  if (l) return l;
  if (lang === 'xml' && /^\s*<svg[\s>]/i.test(text)) return 'svg';
  if ((lang === 'xml' || !lang) && /^\s*<!doctype html/i.test(text)) return 'html';
  return '';
}

/** Já abre mostrando a página? Páginas completas, com estilo/script ou maiores; trechos curtos ficam no código. */
function prevShows(key, text, lang) {
  if (PREV.code.has(key)) return false;
  if (PREV.view.has(key)) return true;
  if (lang === 'svg') return /<svg[\s>]/i.test(text);
  return /<(!doctype|html|body|head)[\s>]/i.test(text) || /<(style|script|canvas)[\s>]/i.test(text) || text.split('\n').length >= 15;
}

/** Botões e caixa da prévia que entram no bloco de código (o HTML passa pelo DOMPurify: só data-* conhecidos). */
function prevCodeParts(key, text, lang) {
  const pl = prevLang(text, lang);
  if (!pl) return null;
  const shows = prevShows(key, text, pl);
  return {
    cls: ' has-prev' + (shows ? ' show-prev' : ''),
    tabs: `<span class="prev-tabs"><button type="button" data-prevact="view"${shows ? ' class="on"' : ''}>${L('Visualizar')}</button><button type="button" data-prevact="code"${shows ? '' : ' class="on"'}>${L('Código')}</button></span>`,
    tools: `<button type="button" class="prev-tool prev-pick" data-prevact="pick" title="${esc(L('Comentar um elemento'))}" aria-label="${esc(L('Comentar um elemento'))}">${svg('chat')}</button><button type="button" class="prev-tool" data-prevact="full" title="${esc(L('Tela cheia'))}" aria-label="${esc(L('Tela cheia'))}">${svg('expand')}</button><button type="button" class="prev-tool" data-prevact="tab" title="${esc(L('Abrir numa aba'))}" aria-label="${esc(L('Abrir numa aba'))}">${svg('external')}</button>`,
    box: `<div class="html-prev" data-keep="${key}" data-lang="${pl}"></div>`,
  };
}

/** O documento que vai no iframe: localStorage de mentira (a origem opaca não tem) e o aviso de altura. */
function prevDoc(src, lang) {
  const shim = '<script>(()=>{try{localStorage.length}catch(e){const m=()=>{const d=new Map();return{getItem:k=>d.has(String(k))?d.get(String(k)):null,setItem:(k,v)=>{d.set(String(k),String(v))},removeItem:k=>{d.delete(String(k))},clear:()=>d.clear(),key:i=>[...d.keys()][i]??null,get length(){return d.size}}};for(const n of["localStorage","sessionStorage"])try{Object.defineProperty(window,n,{value:m(),configurable:true})}catch(_){}}})()<\/script>';
  const size = '<script>(()=>{const s=()=>{try{parent.postMessage({studioPrev:1,h:Math.ceil(Math.max(document.documentElement.getBoundingClientRect().height,document.body?document.body.getBoundingClientRect().bottom+parseFloat(getComputedStyle(document.body).marginBottom||0):0))},"*")}catch(_){}};addEventListener("load",s);try{new ResizeObserver(s).observe(document.documentElement)}catch(_){}setTimeout(s,60);setTimeout(s,700)})()<\/script>';
  // modo comentar: o studio liga por mensagem; um clique na página devolve qual elemento foi (seletor, tag, texto)
  const pick = '<script>(()=>{let on=0,box=null;const sel=el=>{const p=[];for(let e=el;e&&e.nodeType===1&&e!==document.documentElement&&e!==document.body&&p.length<5;e=e.parentElement){if(e.id){p.unshift("#"+CSS.escape(e.id));break}let s=e.tagName.toLowerCase();const c=[...e.classList].slice(0,2);if(c.length)s+="."+c.map(x=>CSS.escape(x)).join(".");const par=e.parentElement;if(par){const sib=[...par.children].filter(x=>x.tagName===e.tagName);if(sib.length>1)s+=":nth-of-type("+(sib.indexOf(e)+1)+")"}p.unshift(s)}return p.join(" > ")||el.tagName.toLowerCase()};const mark=el=>{if(!box){box=document.createElement("div");box.style.cssText="position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #0f9d7a;background:rgba(15,157,122,.14);border-radius:3px"}if(!box.isConnected)document.documentElement.appendChild(box);const r=el.getBoundingClientRect();Object.assign(box.style,{left:r.left+"px",top:r.top+"px",width:r.width+"px",height:r.height+"px",display:"block"})};addEventListener("mouseover",e=>{if(on===1)mark(e.target)},true);const stop=e=>{if(on===1){e.preventDefault();e.stopPropagation()}};addEventListener("mousedown",stop,true);addEventListener("pointerdown",stop,true);addEventListener("submit",stop,true);addEventListener("click",e=>{if(on!==1)return;e.preventDefault();e.stopPropagation();const el=e.target;mark(el);on=2;const r=el.getBoundingClientRect();const h=el.outerHTML.replace(/\\s+/g," ");parent.postMessage({studioPick:1,sel:sel(el),tag:el.tagName.toLowerCase(),text:(el.innerText||el.textContent||"").trim().replace(/\\s+/g," ").slice(0,120),html:h.length>240?h.slice(0,240)+"…":h,r:{x:r.left,y:r.top,w:r.width,h:r.height}},"*")},true);addEventListener("keydown",e=>{if(on&&e.key==="Escape")parent.postMessage({studioPick:1,off:1},"*")},true);addEventListener("message",e=>{if(e.source!==parent||!e.data||e.data.studioPick!==1)return;on=e.data.on?1:0;document.documentElement.style.cursor=on?"crosshair":"";if(!on&&box)box.style.display="none"})})()<\/script>';
  let html = lang === 'svg'
    ? `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}body{display:grid;place-items:center;padding:12px}body>svg{max-width:100%;height:auto}</style></head><body>${src}</body></html>`
    : src;
  if (!/<html[\s>]/i.test(html) && !/<!doctype/i.test(html)) html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + shim) : html.replace(/<html[^>]*>/i, (m) => m + shim);
  if (!html.includes(shim)) html = shim + html;
  const at = html.toLowerCase().lastIndexOf('</body>');
  return at >= 0 ? html.slice(0, at) + size + pick + html.slice(at) : html + size + pick;
}

function prevFrame(doc, inline) {
  const f = document.createElement('iframe');
  f.className = 'prev-frame';
  f.setAttribute('sandbox', PREV_SANDBOX);
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.setAttribute('allow', 'fullscreen; clipboard-write; autoplay');
  f.title = L('Prévia');
  if (inline) f.dataset.inline = '1';
  f.srcdoc = doc;
  return f;
}

// a página avisa a altura dela: o iframe na conversa acompanha (com limite)
addEventListener('message', (e) => {
  if (!e.data || e.data.studioPrev !== 1) return;
  for (const f of document.querySelectorAll('iframe.prev-frame[data-inline]')) {
    if (f.contentWindow !== e.source) continue;
    const h0 = Math.ceil(Number(e.data.h) || 0);
    f.style.height = Math.max(60, Math.min(h0 || 320, Math.round(innerHeight * 0.7), 720)) + 'px';
  }
});

/* ------------------------------------------------------------ comentar um elemento da prévia
   Liga o modo comentar: passar o mouse destaca, um clique escolhe o elemento e abre uma caixa para escrever o pedido.
   O pedido vai para a mensagem com o seletor e o trecho do elemento, para o modelo saber exatamente o que mudar.
   O que vem da página (seletor, texto, HTML) entra só como texto na mensagem. */
function prevPickBtn(box) {
  const code = box.closest('.code');
  return code ? code.querySelector('[data-prevact="pick"]') : box.closest('.prev-card')?.querySelector('.prev-pick');
}
function prevPick(box, on) {
  const f = box?.querySelector('iframe.prev-frame');
  if (!f) { toast(L('A prévia ainda está montando.')); return; }
  on = on ?? !box.classList.contains('picking');
  box.classList.toggle('picking', on);
  prevPickBtn(box)?.classList.toggle('on', on);
  box.querySelector('.prev-pop')?.remove();
  try { f.contentWindow.postMessage({ studioPick: 1, on }, '*'); } catch { /* a prévia foi trocada */ }
  if (on) toast(L('Toque ou clique num elemento da prévia para comentar. Esc sai.'));
}
function prevPickText(box, d, note) {
  const path = box.dataset.path;
  const where = path ? L('Na página {0}', path) : L('Na prévia do HTML acima');
  const what = d.text ? `<${d.tag}> "${d.text.slice(0, 80)}"` : `<${d.tag}>`;
  const html = String(d.html || '').replace(/`/g, "'");
  return L('{0}, no elemento `{1}` ({2}; HTML: `{3}`): {4}', where, String(d.sel).replace(/`/g, "'"), what, html, note.trim());
}
function prevPickAdd(text) {
  const ed = editor();
  if (!editorEmpty()) ed.append(document.createElement('br'));
  ed.append(document.createTextNode(text));
  focusEditor(true); updateSendBtn();
}
function prevPickPop(box, d) {
  box.querySelector('.prev-pop')?.remove();
  const ta = h('textarea.textarea', { rows: 2, placeholder: L('O que mudar neste elemento?') });
  const go = (now) => {
    const t = ta.value.trim();
    if (!t) { ta.focus(); return; }
    prevPickAdd(prevPickText(box, d, t));
    if (now) { prevPick(box, false); send(); return; }
    pop.remove();
    try { box.querySelector('iframe.prev-frame').contentWindow.postMessage({ studioPick: 1, on: true }, '*'); } catch { /* trocada */ }
    toast(L('Comentário adicionado à mensagem. Escolha outro elemento ou envie.'));
  };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(e.ctrlKey || e.metaKey); }
    if (e.key === 'Escape') { e.preventDefault(); prevPick(box, false); }
  });
  const pop = h('div.prev-pop', null,
    h('div.prev-pop-el', { title: d.sel }, h('code', null, '<' + d.tag + '>'), d.text ? h('span', null, d.text.slice(0, 60)) : null),
    ta,
    h('div.prev-pop-foot', null,
      h('button.btn.sm', { type: 'button', onclick: () => prevPick(box, false) }, L('Sair')),
      h('button.btn.sm', { type: 'button', onclick: () => go(false) }, L('Adicionar')),
      h('button.btn.sm.primary', { type: 'button', onclick: () => go(true) }, L('Enviar'))));
  const f = box.querySelector('iframe.prev-frame');
  const fh = f.getBoundingClientRect().height;
  const r = d.r || { x: 0, y: 0, w: 0, h: 0 };
  box.append(pop);
  const ph = pop.offsetHeight || 130, pw = pop.offsetWidth || 280, bw = box.clientWidth;
  let top = r.y + r.h + 6;
  if (top + ph > fh) top = Math.max(4, r.y - ph - 6);
  pop.style.top = Math.max(4, Math.min(top, fh - ph - 4)) + 'px';
  pop.style.left = Math.max(4, Math.min(r.x, bw - pw - 4)) + 'px';
  ta.focus();
}
addEventListener('message', (e) => {
  if (!e.data || e.data.studioPick !== 1) return;
  const f = [...document.querySelectorAll('iframe.prev-frame[data-inline]')].find((x) => x.contentWindow === e.source);
  const box = f?.closest('.html-prev');
  if (!box || !box.classList.contains('picking')) return;
  if (e.data.off) { prevPick(box, false); return; }
  const s = (v, n) => String(v ?? '').slice(0, n);
  const r = e.data.r || {};
  prevPickPop(box, { sel: s(e.data.sel, 300), tag: s(e.data.tag, 20).replace(/[^a-z0-9-]/gi, ''), text: s(e.data.text, 120), html: s(e.data.html, 260), r: { x: +r.x || 0, y: +r.y || 0, w: +r.w || 0, h: +r.h || 0 } });
});

/** Tela cheia (janela do studio). */
function prevFull(doc, title) {
  const m = modal({ title: title || L('Prévia'), wide: true, body: h('div.prev-full', null, prevFrame(doc, false)),
    foot: [h('button.btn', { onclick: () => prevTab(doc, title) }, ic('external'), L('Abrir numa aba')), h('button.btn.primary', { onclick: () => m.close() }, L('Fechar'))] });
  m.el?.classList?.add('prev-modal');
}

/** Numa aba nova: uma página mínima do studio que só contém o iframe isolado (a página nunca roda na origem do studio). */
function prevTab(doc, title) {
  const wrap = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title || L('Prévia'))}</title><style>html,body{margin:0;height:100%;background:#fff}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><iframe sandbox="${PREV_SANDBOX}" referrerpolicy="no-referrer" allow="fullscreen; clipboard-write; autoplay" srcdoc="${esc(doc)}"></iframe></body></html>`;
  const url = URL.createObjectURL(new Blob([wrap], { type: 'text/html' }));
  const w = window.open(url, '_blank');
  if (!w) toast(L('O navegador bloqueou a aba nova.'), 'err');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ------------------------------------------------------------ páginas da pasta de trabalho */

function prevJoin(dir, rel) {
  const parts = (dir ? dir.replace(/\\/g, '/').split('/') : []).concat(rel.replace(/\\/g, '/').split('/'));
  const out = [];
  for (const p of parts) {
    if (p === '..') { if (out.length && out[out.length - 1] !== '' && !/^[a-z]:$/i.test(out[out.length - 1])) out.pop(); }
    else if (p !== '.' && !(p === '' && out.length)) out.push(p);
  }
  return out.join('/');
}

const prevLocal = (u) => u && !/^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(u.trim());

/** Lê uma página da pasta e embute o que ela usa da pasta (CSS, JS, imagens, fontes): a prévia não lê arquivos. */
async function prevFromWorkspace(path, ws) {
  const read = (p, b64) => api('/api/ws/read?path=' + encodeURIComponent(p) + '&ws=' + encodeURIComponent(ws) + (b64 ? '&b64=1' : ''));
  const r = await read(path);
  if (r.tooBig) throw new Error(L('Página grande demais para a prévia ({0}).', fmtSize(r.size)));
  if (r.binary) throw new Error(L('Não é um arquivo de texto.'));
  if (/\.svg$/i.test(path)) return prevDoc(r.text, 'svg');
  const dir = path.replace(/\\/g, '/').replace(/\/[^/]*$/, '');
  const base = path.includes('/') || path.includes('\\') ? dir : '';
  let budget = 60; // arquivos embutidos no máximo
  const data = async (p) => { if (budget-- <= 0) return null; try { return (await read(p, true)).dataUrl || null; } catch { return null; } };
  const text = async (p) => { if (budget-- <= 0) return null; try { const x = await read(p); return x.text ?? null; } catch { return null; } };
  // url(...) de um CSS: relativo à pasta do próprio CSS
  const cssUrls = async (css, from) => {
    const found = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)].map((m) => m[2]).filter(prevLocal);
    for (const u of [...new Set(found)]) {
      const d = await data(prevJoin(from, u.split(/[?#]/)[0]));
      if (d) css = css.split(u).join(d);
    }
    return css;
  };
  const doc = new DOMParser().parseFromString(r.text, 'text/html');
  for (const el of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
    const href = el.getAttribute('href');
    if (!prevLocal(href)) continue;
    const p = prevJoin(base, href.split(/[?#]/)[0]);
    const css = await text(p);
    if (css == null) continue;
    const st = doc.createElement('style');
    st.textContent = await cssUrls(css, p.replace(/\/[^/]*$/, '').includes('/') || p.includes('/') ? p.replace(/\/[^/]*$/, '') : '');
    el.replaceWith(st);
  }
  for (const st of doc.querySelectorAll('style')) st.textContent = await cssUrls(st.textContent, base);
  for (const el of doc.querySelectorAll('script[src]')) {
    const src = el.getAttribute('src');
    if (!prevLocal(src)) continue;
    const js = await text(prevJoin(base, src.split(/[?#]/)[0]));
    if (js == null) continue;
    el.removeAttribute('src');
    el.textContent = js.replace(/<\/script/gi, '<\\/script');
  }
  for (const el of doc.querySelectorAll('img[src], source[src], video[src], audio[src], input[type="image"][src], link[rel~="icon"][href], video[poster]')) {
    for (const at of ['src', 'href', 'poster']) {
      const v = el.getAttribute(at);
      if (!prevLocal(v)) continue;
      const d = await data(prevJoin(base, v.split(/[?#]/)[0]));
      if (d) el.setAttribute(at, d);
    }
  }
  for (const el of doc.querySelectorAll('[style*="url("]')) el.setAttribute('style', await cssUrls(el.getAttribute('style'), base));
  return prevDoc('<!doctype html>\n' + doc.documentElement.outerHTML, 'html');
}

/** Página que o agente escreveu: só a última vez que a conversa mexeu no arquivo ganha a prévia. */
function prevToolPath(name, args, res) {
  if (!['write_file', 'edit_file', 'apply_edit'].includes(name) || res?.status !== 'ok' || res?.isError) return '';
  const p = String(args?.path || '');
  return /\.(html?|svg)$/i.test(p) ? p : '';
}
function prevIsLastTouch(conv, toolCallId, path) {
  if (!conv) return false;
  const norm = (x) => String(x || '').replace(/\\/g, '/').toLowerCase();
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const m = conv.messages[i];
    if (m.role !== 'assistant' || !m.tool_calls) continue;
    for (const tc of [...m.tool_calls].reverse()) {
      const a = parseArgs(tc.function?.arguments) || {};
      if (!['write_file', 'edit_file', 'apply_edit'].includes(tc.function?.name) || norm(a.path) !== norm(path)) continue;
      return tc.id === toolCallId;
    }
  }
  return false;
}

/** O cartão de prévia embaixo da ferramenta que escreveu a página. */
function prevToolCard(tc, path, conv) {
  const ws = wsOf(conv);
  const key = 'ws:' + tc.id;
  const view = !PREV.code.has(key);
  const card = h('div.prev-card' + (view ? '' : '.closed'), null,
    h('div.prev-card-head', null,
      h('span.prev-card-ico', { html: svg('eye') }),
      h('span.prev-card-name', { title: path }, basename(path)),
      h('span.spacer'),
      view ? h('button.prev-tool.prev-pick', { type: 'button', title: L('Comentar um elemento'), 'aria-label': L('Comentar um elemento'), html: svg('chat'), onclick: (e) => prevPick(e.currentTarget.closest('.prev-card').querySelector('.html-prev')) }) : null,
      h('button.prev-tool', { type: 'button', title: L('Atualizar'), 'aria-label': L('Atualizar'), html: svg('refresh'), onclick: (e) => { const b = e.currentTarget.closest('.prev-card').querySelector('.html-prev'); if (b) { delete b.dataset.mounted; b.innerHTML = ''; mountPreviews(); } } }),
      h('button.prev-tool', { type: 'button', title: L('Tela cheia'), 'aria-label': L('Tela cheia'), html: svg('expand'), onclick: async () => { try { prevFull(await prevFromWorkspace(path, ws), basename(path)); } catch (x) { toast(x.message, 'err'); } } }),
      h('button.prev-tool', { type: 'button', title: L('Abrir numa aba'), 'aria-label': L('Abrir numa aba'), html: svg('external'), onclick: async () => { try { prevTab(await prevFromWorkspace(path, ws), basename(path)); } catch (x) { toast(x.message, 'err'); } } }),
      h('button.prev-tool', {
        type: 'button', title: view ? L('Esconder a prévia') : L('Mostrar a prévia'), 'aria-label': L('Prévia'), html: svg(view ? 'up' : 'down'),
        onclick: () => { if (PREV.code.has(key)) PREV.code.delete(key); else PREV.code.add(key); scheduleRender(); },
      })),
    view ? h('div.html-prev', { dataset: { keep: key, ws: ws, path } }) : '');
  return card;
}

/** Monta os iframes das prévias visíveis que ainda não têm (depois de cada redesenho). */
function mountPreviews() {
  for (const box of document.querySelectorAll('.html-prev:not([data-mounted])')) {
    const code = box.closest('.code');
    if (code && !code.classList.contains('show-prev')) continue;
    box.dataset.mounted = '1';
    if (box.dataset.path) {
      box.append(h('div.prev-wait.muted.small', null, L('Montando a prévia...')));
      prevFromWorkspace(box.dataset.path, box.dataset.ws)
        .then((doc) => { box.innerHTML = ''; box.append(prevFrame(doc, true)); })
        .catch((e) => { box.innerHTML = ''; box.append(h('div.prev-wait.small', null, e.message)); });
      continue;
    }
    const src = code?.querySelector('pre code')?.textContent || '';
    box.append(prevFrame(prevDoc(src, box.dataset.lang), true));
  }
}
let prevQueued = false;
new MutationObserver(() => {
  if (prevQueued) return;
  prevQueued = true;
  requestAnimationFrame(() => { prevQueued = false; mountPreviews(); });
}).observe(document.documentElement, { childList: true, subtree: true });

// Visualizar / Código / tela cheia / aba nos blocos de código
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-prevact]');
  if (!b) return;
  const code = b.closest('.code');
  if (!code) return;
  e.preventDefault();
  const key = code.dataset.code;
  const box = code.querySelector('.html-prev');
  const src = code.querySelector('pre code')?.textContent || '';
  const lang = box?.dataset.lang || 'html';
  const act = b.dataset.prevact;
  if (act === 'view' || act === 'code') {
    const view = act === 'view';
    (view ? PREV.view : PREV.code).add(key);
    (view ? PREV.code : PREV.view).delete(key);
    mdCache.clear(); // o HTML dos blocos sai do cache já com o modo escolhido
    code.classList.toggle('show-prev', view);
    code.querySelectorAll('.prev-tabs button').forEach((x) => x.classList.toggle('on', x.dataset.prevact === act));
    mountPreviews();
  } else if (act === 'pick') { if (!code.classList.contains('show-prev')) code.querySelector('[data-prevact="view"]')?.click(); prevPick(box); }
  else if (act === 'full') prevFull(prevDoc(src, lang));
  else if (act === 'tab') prevTab(prevDoc(src, lang));
});
