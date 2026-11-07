/* llama studio - atividade, pedidos laterais, regras, habilidade da conversa, pré-leitura */
'use strict';

/* ============================================================ início */
/* ------------------------------------------------------------ aba Atividade (linha do tempo da conversa) */
function setWsTab(tab) {
  S.wsTab = tab; store.set('wsTab', tab);
  const ws = $('#ws');
  ws.classList.toggle('tab-activity', tab !== 'files');
  $$('.ws-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('#ws-activity').hidden = tab !== 'activity';
  $('#ws-notebook').hidden = tab !== 'notebook';
  if (tab === 'activity') drawActivity();
  if (tab === 'notebook') drawNotebook();
}

let actTimer = 0;
function drawActivitySoon() {
  if (S.wsTab !== 'activity' || actTimer) return;
  actTimer = setTimeout(() => { actTimer = 0; drawActivity(); }, 300);
}

function jumpTo(start, toolId) {
  if (toolId) S.openTools.add(toolId);
  if (toolId && $$('.tl-more').length) S.openTools.add('tl-all-' + start);
  renderMessages(false);
  const el = $(`#messages [data-start="${start}"]`);
  if (!el) return;
  const target = toolId ? $$('.tool', el).find((t) => t.dataset.id === toolId) || el : el;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('flash'); setTimeout(() => target.classList.remove('flash'), 1400);
}

/* ------------------------------------------------------------ pedidos laterais ao modelo */
/** Uma pergunta curta ao modelo, sem ferramentas nem raciocínio, num slot que não estraga o cache da conversa. */
async function sideAsk(conv, system, user, { maxTokens = 300, temperature = 0, signal } = {}) {
  const extra = { chat_template_kwargs: { enable_thinking: false }, reasoning_budget: 0, temperature, max_tokens: maxTokens, _fixed: true };
  const m = { content: '', reasoning: '', tool_calls: [] };
  await sideRun(conv, extra, () => streamRaw([{ role: 'system', content: system }, { role: 'user', content: user }], [], m, signal || new AbortController().signal, null, extra));
  return splitThink(m.content || '').text.trim();
}
const clipText = (t, n) => { t = String(t ?? ''); return t.length > n ? t.slice(0, n) + ` [... +${t.length - n}]` : t; };

/* ------------------------------------------------------------ correções viram regras */
// Negou uma ação ou desfez uma alteração: o studio propõe uma regra curta e você escolhe onde ela vale.
// Só chama o modelo quando você clica (custa uma resposta curta).
async function ruleFrom(conv, res, tc, what) {
  const args = parseArgs(tc.function?.arguments) ?? tc.function?.arguments;
  const proj = projectOf(conv);
  const ta = h('textarea.textarea', { rows: 3, placeholder: 'Escrevendo uma sugestão...' });
  const dests = [['system', 'Todas as conversas (prompt de sistema)'], ...(proj ? [['project', `Só o projeto "${proj.name}"`]] : []), ['auditor', 'Política do auditor' + (S.settings.auditor ? '' : ' (desligado)')]];
  const dest = h('select.select', null, dests.map(([v, l]) => h('option', { value: v }, l)));
  dest.value = proj ? 'project' : 'system';
  let m;
  const save = () => {
    const rule = ta.value.trim().replace(/^[-*]\s*/, '');
    if (!rule) { toast('Escreva a regra.', 'err'); return; }
    const add = (txt) => {
      const head = 'Regras aprendidas com o usuário:';
      txt = (txt || '').trimEnd();
      return txt.includes(head) ? `${txt}\n- ${rule}` : `${txt}${txt ? '\n\n' : ''}${head}\n- ${rule}`;
    };
    if (dest.value === 'project' && proj) { proj.instructions = add(proj.instructions); saveProjects(); }
    else if (dest.value === 'auditor') { S.settings.auditPolicy = add(S.settings.auditPolicy?.trim() || AUDIT_POLICY); store.set('settings', S.settings); }
    else { S.settings.systemPrompt = add(S.settings.systemPrompt); store.set('settings', S.settings); }
    m.close(); toast('Regra salva. Vale a partir da próxima mensagem.');
  };
  m = modal({ title: 'Transformar em regra', body: h('div.form', null,
    h('p.muted', { style: { margin: 0 } }, `Você ${what === 'negou' ? 'negou' : 'desfez'} ${tc.function?.name} (${clipText(toolSummary(tc.function?.name, args), 80)}). Uma regra curta evita que isso se repita.`),
    h('div.field', null, h('label', null, 'Regra'), ta),
    h('div.field', null, h('label', null, 'Onde vale'), dest, h('small', null, 'No prompt ou no projeto, o modelo evita a ação. No auditor, ela passa a exigir sua aprovação.'))),
  foot: [h('button.btn', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.primary', { onclick: save }, 'Salvar regra')] });
  const lastUser = [...conv.messages].reverse().find((x) => x.role === 'user' && !x.hidden);
  const fallback = `Não use ${tc.function?.name} para "${clipText(toolSummary(tc.function?.name, args), 60)}" sem perguntar antes.`;
  try {
    const r = await sideAsk(conv, 'Você transforma uma correção do usuário numa regra curta para um agente de IA. Escreva UMA regra no imperativo, em português, com no máximo 25 palavras, generalizando o que o usuário não quer (não cite valores únicos se uma regra geral servir). Responda só com a regra, sem aspas.',
      `Pedido do usuário: ${clipText(lastUser ? plainOf(lastUser) : '', 600)}\nAção do agente: ${tc.function?.name} ${clipText(JSON.stringify(args), 1200)}\nO usuário ${what === 'negou' ? 'negou a execução' : 'desfez o resultado'} dessa ação.`, { maxTokens: 80 });
    if (!ta.value) ta.value = r.split('\n')[0].replace(/^["'“]|["'”]$/g, '') || fallback;
  } catch { if (!ta.value) ta.value = fallback; }
  ta.placeholder = '';
}

/* ------------------------------------------------------------ habilidade a partir da conversa */
function transcriptOf(c, limit = 14000) {
  const out = [];
  for (const m of c.messages) {
    if (m.hidden) continue;
    if (m.role === 'user') out.push(`USUÁRIO: ${clipText(plainOf(m), 1500)}`);
    else if (m.role === 'assistant') {
      const t = splitThink(m.content || '').text.trim();
      if (t) out.push(`AGENTE: ${clipText(t, 700)}`);
      for (const tc of m.tool_calls || []) {
        const r = c.messages.find((x) => x.role === 'tool' && x.tool_call_id === tc.id);
        const st = !r ? '?' : r.status === 'denied' ? 'negada' : r.isError ? 'erro: ' + clipText(r.content, 160) : 'ok';
        out.push(`  → ${tc.function?.name}(${clipText(tc.function?.arguments, 160)}) = ${st}`);
      }
    } else if (m.role === 'error') out.push(`ERRO: ${clipText(m.content, 200)}`);
  }
  let t = out.join('\n');
  if (t.length > limit) t = t.slice(0, limit * 0.35) + '\n[... meio omitido ...]\n' + t.slice(-limit * 0.65);
  return t;
}
async function skillFromConv(c) {
  if (!c.messages.some((m) => m.role === 'assistant')) { toast('A conversa ainda não tem trabalho para virar habilidade.'); return; }
  const ac = new AbortController();
  const m = modal({ title: 'Criar habilidade', body: h('div.gen-wait', null, h('span', { html: svg('loader', 'spin') }), 'Lendo a conversa e escrevendo a habilidade...'), foot: [h('button.btn', { onclick: () => { ac.abort(); m.close(); } }, 'Cancelar')] });
  try {
    const out = await sideAsk(c, 'Você escreve habilidades (SKILL.md) para um agente de IA local a partir de uma conversa que deu certo. Extraia o procedimento reutilizável: quando usar, passos na ordem, ferramentas e comandos que funcionaram, armadilhas e erros que apareceram e como foram resolvidos, e como verificar o resultado. Generalize (troque nomes de arquivos e valores específicos por descrições). Seja conciso. Responda exatamente neste formato:\nNOME: nome-em-kebab-case\nDESCRIÇÃO: uma frase dizendo quando usar\n---\n# Título\n(corpo em Markdown)',
      `Conversa "${c.title}":\n\n${transcriptOf(c)}`, { maxTokens: 1600, temperature: 0.2, signal: ac.signal });
    m.close();
    const name = (out.match(/^\s*NOME:\s*(.+)$/mi)?.[1] || c.title).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    const description = (out.match(/^\s*DESCRI[CÇ][AÃ]O:\s*(.+)$/mi)?.[1] || '').trim();
    const i = out.indexOf('\n---');
    const body = (i >= 0 ? out.slice(i + 4) : out.replace(/^\s*(NOME|DESCRI[CÇ][AÃ]O):.*$/gmi, '')).trim();
    editSkill(null, { name, description, body });
  } catch (e) { if (!ac.signal.aborted) { m.close(); toast('Não consegui gerar: ' + e.message, 'err'); } }
}

/* ------------------------------------------------------------ pré-leitura do projeto */
// Mapa da pasta montado pelo servidor sem o modelo (milissegundos, em cache por 7 dias).
// O resumo em linguagem natural é opcional: uma resposta curta, só com o servidor parado à toa.
S.maps = new Map(); const mapTried = new Set();
async function ensureMap(conv, refresh) {
  const ws = wsOf(conv); if (!ws) return null;
  if (!refresh && S.maps.has(ws)) return S.maps.get(ws);
  try { const m = await api('/api/projmap', { ws, refresh: !!refresh }); S.maps.set(ws, m); return m; } catch { return null; }
}
async function maybeSummarizeMap(conv, force) {
  if (!conv || (!force && S.settings.projSummary !== true) || S.settings.projMap !== true && !force) return;
  const ws = wsOf(conv);
  if (!force && (mapTried.has(ws) || S.runs.size || S.health.status !== 'ok')) return;
  mapTried.add(ws);
  const map = await ensureMap(conv);
  if (!map || (map.summary && !force) || map.files === 0) return;
  try {
    const sum = await sideAsk(conv, 'Você recebe o mapa de uma pasta de trabalho (estrutura, tipos de arquivo e o começo de arquivos-chave). Escreva em português, em no máximo 6 linhas curtas: do que se trata, linguagem e ferramentas, onde fica o código principal, como rodar ou compilar se der para saber, e o que parecer importante. Não invente o que o mapa não mostra.',
      map.text, { maxTokens: 260 });
    if (sum) { const r = await api('/api/projmap/summary', { ws, summary: sum }); S.maps.set(ws, r); }
  } catch { /* tenta de novo na próxima abertura */ }
}
async function showMap(conv) {
  const box = h('pre.map-text', null, 'Carregando...');
  const sum = h('div.map-sum');
  const fill = (m) => { box.textContent = m?.text || 'Sem mapa.'; sum.textContent = m?.summary || 'Sem resumo ainda.'; meta.textContent = m ? `${m.files} arquivos lidos em ${m.ms} ms · ${new Date(m.built).toLocaleString('pt-BR')}` : ''; };
  const meta = h('small.muted');
  const m = modal({ title: 'Mapa da pasta', wide: true, body: h('div.form', null,
    h('p.muted', { style: { margin: 0 } }, 'O que o modelo recebe sobre esta pasta no começo de cada conversa. Montado sem o modelo; o resumo é opcional.'),
    h('div.field', null, h('label', null, 'Resumo'), sum), h('div.field', null, h('label', null, 'Estrutura'), box), meta),
  foot: [
    h('button.btn', { onclick: async () => { fill(await ensureMap(conv, true)); toast('Mapa atualizado'); } }, ic('refresh'), 'Ler de novo'),
    h('button.btn', { onclick: async (e) => { e.currentTarget.disabled = true; sum.textContent = 'Resumindo...'; await maybeSummarizeMap(conv, true); fill(S.maps.get(wsOf(conv))); e.currentTarget.disabled = false; } }, ic('sparkles'), 'Resumir com o modelo'),
    h('button.btn.primary', { onclick: () => m.close() }, 'Fechar')] });
  fill(await ensureMap(conv));
}
