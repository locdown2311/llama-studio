/* llama studio - recursos dos projetos: base de conhecimento e conversa entre as conversas do projeto */
'use strict';

/* ============================================================ base de conhecimento
   As fontes (a pasta do projeto e/ou outras pastas e arquivos) viram trechos pesquisáveis no servidor
   (src/kb.rs). O modelo procura com search_knowledge; o índice se atualiza sozinho a cada busca. */
function kbSources(p) {
  if (!p?.kb?.on) return [];
  return [...new Set([...(p.kb.dir !== false && p.dir ? [p.dir] : []), ...(p.kb.paths || [])])];
}
function kbOn(conv) { return kbSources(projectOf(conv)).length > 0; }

async function runSearchKnowledge(tctx, args) {
  const p = projectOf(tctx.conv);
  const sources = kbSources(p);
  if (!sources.length) return { content: L('Este projeto não tem base de conhecimento ligada.'), isError: true };
  const query = String(args?.query || '').trim();
  if (!query) return { content: L('Passe query com as palavras a procurar.'), isError: true };
  const r = await api('/api/kb/search', { id: p.id, sources, query, k: Number(args?.k) || 6, path: String(args?.path || '') }, { signal: tctx.signal });
  const tr = r.stats.transcribing ? L(' ({0} gravação(ões) ainda sendo transcrita(s): tente de novo daqui a pouco)', r.stats.transcribing) : '';
  if (!r.hits.length) return { content: L('Nada encontrado na base para "{0}" ({1} documentos, {2} trechos). Tente outras palavras, sinônimos ou termos mais específicos.', query, r.stats.files, r.stats.chunks) + tr };
  const out = r.hits.map((x, i) => {
    const src = x.url || x.path;
    const where = x.url ? src : x.line ? L('{0}, linha {1}', src, x.line) : L('{0}, parte {1} de {2}', src, x.part, x.of);
    return `[${i + 1}] ${where}\n${x.text}`;
  });
  return { content: L('{0} trecho(s) da base de conhecimento para "{1}":\n\n', r.hits.length, query) + out.join('\n\n---\n\n') + tr };
}

/** Parte "Base de conhecimento" do formulário do projeto. Devolve o elemento e um leitor do estado. */
function kbEditor(p) {
  const st = { on: !!p?.kb?.on, dir: p?.kb?.dir !== false, paths: [...(p?.kb?.paths || [])] };
  const box = h('div.kb-ed');
  const info = h('div.kb-info.small.muted');
  const draw = () => {
    box.innerHTML = '';
    const sw = h('input', { type: 'checkbox', checked: st.on });
    sw.addEventListener('change', () => { st.on = sw.checked; draw(); });
    box.append(h('label.kb-on', null, sw, h('span', null, L('Ligar a base de conhecimento'))),
      h('small.muted', null, L('O modelo procura nos documentos das fontes abaixo e cita de onde tirou: texto, Markdown, código, HTML, Word, PDF, áudio e vídeo (transcritos pelo Whisper) e links (sites, repositórios do GitHub e vídeos do YouTube). O índice se atualiza sozinho quando os arquivos mudam.')));
    if (!st.on) return;
    const dirSw = h('input', { type: 'checkbox', checked: st.dir });
    dirSw.addEventListener('change', () => { st.dir = dirSw.checked; });
    box.append(h('label.kb-src', null, dirSw, h('span', null, L('A pasta do projeto'))));
    for (const x of st.paths) {
      const web = /^https?:\/\//i.test(x);
      box.append(h('div.kb-src', null, ic(web ? 'globe' : 'file'), h('span.mono', { title: x }, x),
        h('button.icon-btn.sm', { type: 'button', title: L('Remover'), 'aria-label': L('Remover'), html: svg('x'), onclick: () => { st.paths = st.paths.filter((y) => y !== x); draw(); } })));
    }
    box.append(h('div.kb-actions', null,
      h('button.btn.sm', { type: 'button', onclick: async () => {
        const r = await pickPath({ title: L('Pasta ou arquivo da base'), mode: 'any', start: st.paths.at(-1) || p?.dir || S.info.workspace });
        if (r && !st.paths.includes(r)) { st.paths.push(r); draw(); }
      } }, ic('plus'), L('Adicionar pasta ou arquivo')),
      h('button.btn.sm', { type: 'button', onclick: () => {
        const inp = h('input.input', { placeholder: L('https://... (site, github.com/dono/repo ou vídeo do YouTube)') });
        const add = () => {
          const v = inp.value.trim();
          if (!/^https?:\/\/\S+\.\S+/i.test(v)) { toast(L('Cole um link começando com https://'), 'err'); return; }
          if (!st.paths.includes(v)) st.paths.push(v);
          draw();
          if (p?.id) kbIndexNow(p.id, read(), info);
        };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
        const row = h('div.kb-link', null, inp, h('button.btn.sm.primary', { type: 'button', onclick: add }, L('Adicionar')));
        box.querySelector('.kb-link')?.remove();
        box.querySelector('.kb-actions').after(row);
        inp.focus();
      } }, ic('globe'), L('Adicionar link')),
      p?.id ? h('button.btn.sm', { type: 'button', onclick: () => kbIndexNow(p.id, read(), info, false, true) }, ic('refresh'), L('Indexar agora')) : null),
    info);
  };
  const read = () => ({ on: st.on, dir: st.dir, paths: st.paths });
  draw();
  if (p?.kb?.on) kbIndexNow(p.id, read(), info, true);
  return { el: box, read };
}

async function kbIndexNow(id, kb, info, quiet, force) {
  const sources = kbSources({ dir: S.projects.find((x) => x.id === id)?.dir, kb });
  if (!sources.length) { info.textContent = L('Nenhuma fonte escolhida.'); return; }
  info.textContent = quiet ? L('Conferindo o índice...') : L('Indexando... (links e PDFs grandes podem levar um tempo)');
  try {
    const r = await api('/api/kb/status', { id, sources, force: !!force });
    info.textContent = (r.chars >= 1000 ? L('{0} documento(s), {1} trechos (~{2} mil caracteres).', r.files, r.chunks, Math.round(r.chars / 1000)) : L('{0} documento(s), {1} trechos.', r.files, r.chunks))
      + (r.changed ? ' ' + L('{0} lido(s) agora.', r.changed) : '')
      + (r.errors.length ? ' ' + L('{0} ficaram de fora (ex.: {1}: {2}).', r.errors.length, basename(r.errors[0].path), r.errors[0].error) : '')
      + (r.missing.length ? ' ' + L('Não achei: {0}.', r.missing.join(', ')) : '')
      + (r.capped ? ' ' + L('Parou em 6000 arquivos: escolha pastas mais específicas.') : '')
      + (r.transcribing ? ' ' + L('Transcrevendo {0} gravação(ões){1}: elas entram na base quando terminar.', r.transcribing, r.media?.current ? ` (${r.media.current})` : '') : '');
    for (const w of r.web || []) {
      info.append(h('div.kb-web' + (w.error ? '.err' : ''), null, ic(w.kind === 'youtube' ? 'play' in ICONS ? 'play' : 'globe' : 'globe'),
        h('span', null, w.error ? L('{0}: {1}', w.url, w.error) : L('{0}: {1} arquivo(s){2}', w.title || w.url, w.files, w.kind === 'site' ? L(' (páginas do site)') : w.kind === 'github' ? L(' (do repositório)') : L(' (transcrição)')))));
    }
    // transcrição em andamento: confere de novo daqui a pouco
    if (r.transcribing && info.isConnected) setTimeout(() => { if (info.isConnected) kbIndexNow(id, kb, info, true); }, 15000);
  } catch (e) { info.textContent = e.message; }
}

/* ============================================================ conversas do projeto falando entre si
   Uma conversa manda um pedido para outra do mesmo projeto; a outra responde com o modelo e o contexto dela,
   e a resposta volta como resultado da ferramenta. Para não travar: no máximo 2 saltos (A→B→C), e quem está
   esperando uma resposta não é esperado de volta. */
S.peerWait = new Map(); // conversa que espera → conversa esperada

function peersOf(conv) {
  const p = projectOf(conv);
  return p ? S.convs.filter((c) => c.projectId === p.id && c.id !== conv.id) : [];
}
function peersOn(conv) { return peersOf(conv).length > 0; }

function chatState(c) {
  if (running(c)) return L('respondendo agora');
  if (c.bg) return L('em segundo plano');
  if (c.queue?.length) return L('{0} na fila', c.queue.length);
  return L('parada');
}
const clip = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

function runListChats(tctx) {
  const list = peersOf(tctx.conv).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!list.length) return { content: L('Não há outras conversas neste projeto.') };
  return { content: list.map((c) => {
    const firstU = c.messages.find((m) => m.role === 'user' && !m.hidden)?.content;
    const lastA = [...c.messages].reverse().find((m) => m.role === 'assistant' && m.content?.trim())?.content;
    return `- id ${c.id} · "${c.title}" · ${chatState(c)} · ${L('atualizada em {0}', fmtStamp(c.updatedAt))}`
      + (firstU ? `\n  ${L('pedido inicial')}: ${clip(firstU, 160)}` : '')
      + (lastA ? `\n  ${L('última resposta')}: ${clip(lastA, 200)}` : '');
  }).join('\n') };
}

function findPeer(conv, key) {
  const list = peersOf(conv);
  const k = String(key || '').trim().replace(/^id\s+/i, '');
  const low = k.toLowerCase();
  return list.find((c) => c.id === k) || list.find((c) => c.title.toLowerCase() === low)
    || (() => { const m = list.filter((c) => c.title.toLowerCase().includes(low)); return m.length === 1 ? m[0] : null; })();
}

async function runSendToChat(tctx, tmsg, args) {
  const conv = tctx.conv;
  const target = findPeer(conv, args?.chat);
  if (!target) return { content: L('Não achei a conversa "{0}" neste projeto. Use list_chats para ver os ids.', args?.chat || ''), isError: true };
  const text0 = String(args?.message || '').trim();
  if (!text0) return { content: L('A mensagem está vazia.'), isError: true };
  const lastU = [...conv.messages].reverse().find((m) => m.role === 'user' && !m.hidden);
  const hop = lastU?.peer?.hop || 0;
  let wait = args?.wait_reply !== false;
  let why = '';
  if (wait && hop >= 2) { wait = false; why = L(' (sem esperar: esta conversa já está respondendo a um pedido de outra, e a corrente para aqui)'); }
  if (wait && S.peerWait.get(target.id) === conv.id) { wait = false; why = L(' (sem esperar: "{0}" está esperando a sua resposta)', target.title); }
  const req = uid();
  const text = L('[Mensagem da conversa "{0}" (id {1}), do mesmo projeto]\n\n{2}', conv.title, conv.id, text0)
    + (wait ? L('\n\n(Ela espera a sua resposta: responda direto ao que foi pedido; a sua resposta final volta para ela.)') : L('\n\n(Ela não espera resposta.)'));
  const item = { content: text, parts: [{ t: 'text', v: text }], refs: [], peer: { id: conv.id, title: conv.title, hop: hop + 1, req }, noBg: true };
  if (running(target) || target.bg) enqueue(target, item);
  else submit(target, item).catch((e) => console.warn('peer', e));
  if (!wait) return { content: L('Entregue para "{0}"{1}.', target.title, why) };
  if (tmsg) { tmsg._peerWait = target.title; scheduleRender(); }
  S.peerWait.set(conv.id, target.id);
  const t0 = Date.now();
  let seen = false;
  try {
    for (;;) {
      if (tctx.signal?.aborted) return { content: L('Cancelado pelo usuário.'), isError: true };
      if (running(target)) seen = true;
      const i = target.messages.findIndex((m) => m.peer?.req === req);
      const queued = (target.queue || []).some((q) => q.peer?.req === req);
      if (i >= 0 && !queued && !running(target) && !target.bg) {
        const after = target.messages.slice(i + 1).filter((m) => m.role === 'assistant' && m.content?.trim());
        if (seen || after.length) {
          const reply = after.at(-1)?.content?.trim();
          return { content: reply ? L('Resposta de "{0}":\n\n{1}', target.title, reply) : L('"{0}" terminou sem responder em texto.', target.title) };
        }
      }
      if (Date.now() - t0 > 600000) return { content: L('"{0}" não respondeu em 10 minutos. A mensagem ficou lá; siga sem a resposta ou pergunte de novo depois.', target.title) };
      await new Promise((ok) => setTimeout(ok, 700));
    }
  } finally {
    S.peerWait.delete(conv.id);
    if (tmsg) delete tmsg._peerWait;
  }
}
