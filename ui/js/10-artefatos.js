/* llama studio - artefatos: entregas que o modelo cria fora do texto (página HTML, documento, SVG, diagrama
   Mermaid, código), com versões. Aparecem num painel ao lado da conversa (aba Artefato) e na página Artefatos.
   O servidor guarda em dados/artefatos (src/artefatos.rs). */
'use strict';

S.art = { id: null, v: null, data: null };
const ART_ICON = { html: 'globe', markdown: 'fileText', svg: 'image', mermaid: 'branch', code: 'fileCode' };
const ART_KIND = () => ({ html: L('Página'), markdown: L('Documento'), svg: L('Imagem SVG'), mermaid: L('Diagrama'), code: L('Código') });

/** O documento para o iframe de um artefato (página, SVG ou diagrama). */
function artDoc(kind, src) {
  if (kind === 'html') return prevDoc(src, 'html');
  if (kind === 'svg') return prevDoc(src, 'svg');
  if (kind === 'mermaid') {
    const esc2 = src.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return prevDoc(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:16px;font-family:system-ui;background:#fff}</style></head><body><pre class="mermaid">${esc2}</pre><script type="module">import m from 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.esm.min.mjs';m.initialize({startOnLoad:true});</script></body></html>`, 'html');
  }
  return '';
}

/** O corpo de um artefato (dentro do painel ou da página). */
function artBody(d) {
  const kind = d.meta.kind;
  if (kind === 'markdown') return h('div.art-md.md', { html: md(d.content) });
  if (kind === 'code') return h('div.art-md.md', { html: md('```' + (d.meta.lang || '') + '\n' + d.content + '\n```') });
  const f = prevFrame(artDoc(kind, d.content), false);
  f.classList.add('art-frame');
  return f;
}

async function openArtifact(id, v, { quiet } = {}) {
  try {
    const d = await api(`/api/artifacts/get?id=${encodeURIComponent(id)}${v ? '&v=' + v : ''}`);
    S.art = { id, v: d.v, data: d };
    // celular na nuvem: o painel lateral não aparece; abre em tela cheia
    if (!quiet && document.documentElement.classList.contains('cloud') && innerWidth <= 640) {
      modal({ title: d.meta.title, wide: true, body: h('div.art-modal', null, artBody(d)) });
      return;
    }
    if (!quiet) { if (MQ_WS.matches) S.wsDrawer = true; else store.set('wsHidden', false); applyLayout(); }
    setWsTab('artifact');
  } catch (e) { toast(e.message, 'err'); }
}

function artFileName(d) {
  const ext = { html: 'html', markdown: 'md', svg: 'svg', mermaid: 'mmd' }[d.meta.kind] || (d.meta.lang || 'txt');
  return (d.meta.title || 'artefato').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) + '.' + ext;
}

function artDownload(d) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([d.content], { type: 'text/plain' }));
  a.download = artFileName(d);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** A aba Artefato do painel lateral. */
function drawArtifactTab() {
  const box = $('#ws-artifact');
  if (!box) return;
  box.innerHTML = '';
  const d = S.art.data;
  if (!d) {
    box.append(h('div.art-empty.muted', null, L('Quando o modelo criar uma página, um documento ou um diagrama, ele aparece aqui.')),
      h('button.btn.sm', { type: 'button', onclick: () => setView('artifacts') }, ic('layers'), L('Todos os artefatos')));
    return;
  }
  const m = d.meta;
  const vsel = h('select.select.sm', { title: L('Versão') }, (m.versions || []).slice().reverse().map((x) => h('option', { value: x.v }, L('v{0}', x.v) + (x.note ? ' · ' + x.note.slice(0, 40) : ''))));
  vsel.value = String(d.v);
  vsel.addEventListener('change', () => openArtifact(m.id, Number(vsel.value), { quiet: true }));
  const btn = (icon, title, fn) => h('button.icon-btn.sm', { type: 'button', title, 'aria-label': title, html: svg(icon), onclick: fn });
  box.append(
    h('div.art-head', null,
      ic(ART_ICON[m.kind] || 'file'),
      h('div.art-title', null, h('b', { title: m.title }, m.title), h('span.muted', null, ART_KIND()[m.kind] || m.kind)),
      vsel,
      ['html', 'svg', 'mermaid'].includes(m.kind) ? btn('expand', L('Tela cheia'), () => prevFull(artDoc(m.kind, d.content), m.title)) : null,
      btn('copy', L('Copiar'), () => { navigator.clipboard?.writeText(d.content); toast(L('Copiado')); }),
      btn('download', L('Baixar'), () => artDownload(d)),
      btn('layers', L('Todos os artefatos'), () => setView('artifacts'))),
    ...(d.v === m.v ? [] : [h('div.art-old', null, L('Você está vendo a versão {0} de {1}.', d.v, m.v), h('button.btn.sm', { type: 'button', onclick: () => openArtifact(m.id, null, { quiet: true }) }, L('Ver a mais nova')))]),
    h('div.art-body', null, artBody(d)));
}

/** O cartão do artefato no resultado da ferramenta. */
function artCard(a) {
  return h('button.art-card', { type: 'button', onclick: (e) => { e.stopPropagation(); openArtifact(a.id, a.v); } },
    h('span.art-card-ico', { html: svg(ART_ICON[a.kind] || 'file') }),
    h('span.art-card-main', null, h('b', null, a.title), h('span.muted', null, (ART_KIND()[a.kind] || a.kind) + ' · ' + L('v{0}', a.v))),
    h('span.art-card-open', null, L('Abrir')));
}

/** Resultado novo de artifact na conversa aberta: mostra no painel. */
function artAfterTool(conv, tmsg) {
  const a = tmsg?.data?.artifact;
  if (!a || EXECUTOR || conv.id !== S.curId) return;
  openArtifact(a.id, a.v);
}

/** Página Artefatos: todos, com busca. */
async function renderArtifactsPage() {
  const page = $('#view-artifacts .page');
  if (!page) return;
  page.innerHTML = '';
  const q = h('input.input', { type: 'search', placeholder: L('Buscar artefatos'), style: { maxWidth: '320px' } });
  const grid = h('div.art-grid');
  page.append(h('header.page-head', null, h('div', null, h('h1', null, L('Artefatos')), h('p.lead', null, L('Páginas, documentos, diagramas e códigos que o modelo criou, com as versões.'))), h('div.page-actions', null, q)), grid);
  let list = [];
  try { list = (await api('/api/artifacts')).artifacts || []; } catch (e) { grid.append(h('p.muted', null, e.message)); return; }
  const draw = () => {
    grid.innerHTML = '';
    const f = q.value.trim().toLowerCase();
    const show = list.filter((a) => !f || String(a.title).toLowerCase().includes(f));
    if (!show.length) { grid.append(h('p.muted', null, list.length ? L('Nada com esse nome.') : L('Nenhum artefato ainda. Peça numa conversa: "faça uma página...", "escreva um relatório...", "desenhe um diagrama...".'))); return; }
    for (const a of show) {
      const conv = S.convs.find((c) => c.id === a.conv);
      grid.append(h('div.art-tile', null,
        h('button.art-tile-main', { type: 'button', onclick: () => { if (conv) { selectConv(conv.id); setView('chat'); } openArtifact(a.id); } },
          h('span.art-card-ico', { html: svg(ART_ICON[a.kind] || 'file') }),
          h('b', null, a.title),
          h('span.muted', null, (ART_KIND()[a.kind] || a.kind) + ' · ' + L('v{0}', a.v) + ' · ' + fmtStamp(a.updated)),
          conv ? h('span.muted.small', null, L('Conversa: {0}', conv.title)) : null),
        h('div.art-tile-acts', null,
          h('button.icon-btn.sm', { type: 'button', title: L('Renomear'), 'aria-label': L('Renomear'), html: svg('edit'), onclick: async () => {
            const t = prompt(L('Novo nome'), a.title); if (!t?.trim()) return;
            try { await api('/api/artifacts/rename', { id: a.id, title: t.trim() }); a.title = t.trim(); draw(); } catch (e) { toast(e.message, 'err'); }
          } }),
          h('button.icon-btn.sm', { type: 'button', title: L('Apagar'), 'aria-label': L('Apagar'), html: svg('trash'), onclick: async () => {
            if (!(await confirmBox(L('Apagar o artefato "{0}" e todas as versões?', a.title), L('Apagar'), true))) return;
            try { await api('/api/artifacts/delete', { id: a.id }); list = list.filter((x) => x !== a); if (S.art.id === a.id) S.art = { id: null, v: null, data: null }; draw(); } catch (e) { toast(e.message, 'err'); }
          } }))));
    }
  };
  q.addEventListener('input', draw);
  draw();
}
