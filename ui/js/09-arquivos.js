/* llama studio - pasta de trabalho, árvore e "Em uso agora" */
'use strict';

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

/* ---- em uso agora ----
   Comandos longos que copiam/movem pastas: a origem fica "somente leitura" até o comando terminar
   (nada do studio escreve nela) e o destino aparece como recebendo. Tudo sai dos argumentos das
   ferramentas em execução, sem perguntar nada ao sistema. */
const COPY_VERBS = /^(copy-item|cpi|cp|copy|xcopy|robocopy|move-item|mi|mv|move|compress-archive|expand-archive)$/;
const MOVE_VERBS = /^(move-item|mi|mv|move)$/;
const VAL_FLAGS = /^-(filter|include|exclude|credential|compressionlevel|encoding)$/i;
function cmdTokens(s) { const out = []; const re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m; while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]); return out; }
function isAbs(p) { return /^[a-z]:[\\/]/i.test(p) || /^[\\/]{2}/.test(p); }
function joinPath(base, p) {
  p = String(p).replace(/^\.[\\/]/, '');
  if (p === '.' || p === '') return base;
  if (isAbs(p)) return p;
  return base ? base.replace(/[\\/]+$/, '') + '\\' + p.replace(/\//g, '\\') : p;
}
/** Tira o curinga do fim: C:\fotos\*.jpg vira C:\fotos. */
function stripGlob(p) { const parts = p.split(/[\\/]/); while (parts.length > 1 && /[*?]/.test(parts[parts.length - 1])) parts.pop(); return parts.join('\\'); }
function busyFromCommand(cmd, base) {
  const out = [];
  let piped = null; // Get-ChildItem origem | Copy-Item -Destination x: a origem vem do lado esquerdo
  for (const part of String(cmd || '').split(/(;|&&|\|\||\|)/)) {
    if (/^(;|&&|\|\|)$/.test(part)) { piped = null; continue; }
    if (part === '|') continue;
    const t = cmdTokens(part.trim()); if (!t.length) continue;
    const verb = t[0].replace(/\.exe$/i, '').toLowerCase();
    if (/^(get-childitem|gci|ls|dir|get-item|gi)$/.test(verb)) {
      const p0 = t.slice(1).find((a, i, arr) => !/^-/.test(a) && !/^-(filter|include|exclude|depth)$/i.test(arr[i - 1] || ''));
      const pi = t.findIndex((a) => /^-(path|literalpath)$/i.test(a));
      piped = pi > 0 ? t[pi + 1] : p0 || '.';
      continue;
    }
    if (!COPY_VERBS.test(verb)) { piped = null; continue; }
    const src = []; let dst = null; const pos = [];
    for (let i = 1; i < t.length; i++) {
      const a = t[i];
      if (/^-(path|literalpath|source|sourcepath)$/i.test(a)) { if (t[i + 1]) src.push(...t[++i].split(',')); continue; }
      if (/^-(destination|destinationpath)$/i.test(a)) { dst = t[++i]; continue; }
      if (VAL_FLAGS.test(a)) { i++; continue; }
      if (/^-/.test(a) || /^\/[a-z0-9:]{1,12}$/i.test(a) || a.startsWith('$') || a === '`') continue;
      pos.push(a);
    }
    if (verb === 'robocopy') { if (pos[0]) src.push(pos[0]); if (pos[1]) dst = pos[1]; }
    else if (pos.length) { if (!dst && (pos.length > 1 || piped)) dst = pos.pop(); src.push(...pos.flatMap((x) => x.split(','))); }
    if (!src.length && piped) src.push(piped);
    piped = null;
    const clean = src.map((x) => x.trim()).filter(Boolean); src.length = 0; src.push(...clean);
    const move = MOVE_VERBS.test(verb);
    for (const x of src.map((x) => x.trim()).filter(Boolean)) out.push({ path: joinPath(base, stripGlob(x)), mode: move ? 'w' : 'r', what: move ? 'sendo movido' : 'sendo copiado', other: dst ? joinPath(base, dst) : '' });
    if (dst) out.push({ path: joinPath(base, stripGlob(dst)), mode: 'w', what: move ? 'recebendo o que é movido' : 'recebendo a cópia', other: src[0] ? joinPath(base, src[0]) : '', more: src.length - 1 });
  }
  return out;
}
const normP = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const underP = (a, b) => { const x = normP(a); const y = normP(b); return x === y || x.startsWith(y + '\\'); };
/** O que está em uso agora, em todas as conversas rodando. */
function busyPaths() {
  const out = [];
  for (const c of S.convs) {
    if (!S.runs.has(c.id)) continue;
    const calls = new Map();
    for (const m of c.messages) if (m.role === 'assistant') for (const tc of m.tool_calls || []) calls.set(tc.id, tc);
    for (const m of c.messages) {
      if (m.role !== 'tool' || m.status !== 'running') continue;
      const tc = calls.get(m.tool_call_id);
      if (tc?.function?.name !== 'run_command') continue;
      const a = parseArgs(tc.function.arguments) || {};
      const base = a.cwd ? joinPath(wsOf(c), a.cwd) : wsOf(c);
      for (const b of busyFromCommand(a.command, base)) out.push({ ...b, conv: c, id: tc.id });
    }
  }
  return out;
}
let busySig = '';
let busyNow = [];
function busyMark(abs) {
  for (const b of busyNow) if (underP(abs, b.path)) return { cls: 'busy-' + b.mode, b };
  for (const b of busyNow) if (underP(b.path, abs)) return { cls: 'busy-in', b };
  return null;
}
/** Chamado a cada atualização da conversa; só mexe na tela quando o conjunto muda. */
function updateBusy() {
  const now = busyPaths();
  const sig = now.map((b) => b.mode + b.path).join('|');
  if (sig === busySig) return;
  const ended = busySig && now.length < busyNow.length;
  busySig = sig; busyNow = now;
  drawBusy();
  if (ended) refreshTree(); else applyBusyMarks();
}
function drawBusy() {
  const box = $('#ws-busy'); box.innerHTML = '';
  box.hidden = !busyNow.length;
  if (!busyNow.length) return;
  box.append(h('div.ws-busy-head', null, ic('lock'), 'Em uso agora'));
  for (const b of busyNow) {
    box.append(h('button.busy-row.' + b.mode, { title: b.path, onclick: () => revealInTree(b.path) },
      ic(b.mode === 'r' ? 'lock' : 'download'),
      h('span.busy-main', null, h('b', null, basename(b.path) || b.path),
        h('small', null, (b.mode === 'r' ? 'Somente leitura: ' : '') + b.what + (b.other ? (b.mode === 'r' ? ' para ' : ' de ') + basename(b.other) + (b.more > 0 ? ` e mais ${b.more}` : '') : '') + (S.convs.length > 1 && b.conv.id !== S.curId ? ` · ${b.conv.title}` : '')))));
  }
}
function applyBusyMarks() {
  for (const n of $$('#ws-tree .node')) {
    const m = n.dataset.abs ? busyMark(n.dataset.abs) : null;
    n.classList.remove('busy-r', 'busy-w', 'busy-in');
    n.querySelector('.lk')?.remove();
    if (!m) continue;
    n.classList.add(m.cls);
    if (m.cls !== 'busy-in') n.querySelector('.nm').after(h('span.lk', { title: m.cls === 'busy-r' ? `Somente leitura: ${m.b.what}` : m.b.what, html: svg(m.cls === 'busy-r' ? 'lock' : 'download') }));
  }
}
function revealInTree(abs) {
  if (S.wsTab !== 'files') setWsTab('files');
  const rel = relOf(abs);
  if (isAbs(rel)) { api('/api/reveal', { path: abs, ws: S.ws.path }).catch(() => {}); return; }
  const parts = rel.split('/'); let acc = '';
  for (const part of parts.slice(0, -1)) { acc = acc ? acc + '/' + part : part; S.ws.expanded.add(acc); }
  renderTree().then(() => $(`#ws-tree .node[data-rel="${CSS.escape(rel)}"]`)?.scrollIntoView({ block: 'center' }));
}
/** Escrita do studio dentro de algo que outra tarefa está copiando: espera o fim. */
function busyBlock(conv, tcId, target) {
  for (const b of busyPaths()) if (b.id !== tcId && b.mode === 'r' && underP(target, b.path)) return `${b.path} está ${b.what}${b.other ? ' para ' + b.other : ''} (somente leitura até o comando terminar). Espere ele acabar e tente de novo.`;
  return '';
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
    applyBusyMarks();
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
      { style: { paddingLeft: 6 + depth * 14 + 'px' }, title: it.path, dataset: { rel: r, abs: it.path } },
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
