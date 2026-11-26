/* llama studio - /meta (/goal): o agente trabalha, confere se chegou no objetivo e continua melhorando até chegar.
   "/meta <objetivo>" na caixa de mensagem liga; opcional "--conferir <comando>" (ex.: npm test) e "--rodadas N".
   A cada fim de resposta: roda o comando de conferência (se houver) e um juiz (API de segundo plano, a da conversa
   ou o modelo local) decide se o objetivo foi alcançado. Se não, manda a próxima rodada com o que falta.
   Para quando chega, quando bate o limite de rodadas, quando você aperta Parar ou quando não há progresso. */
'use strict';

const GOAL_MAX = 10;

/** "/meta ..." ou "/goal ...": devolve { text, check, max } ou null (não é um comando de meta). */
function parseGoal(raw) {
  const m = String(raw || '').trim().match(/^\/(?:goal|meta)(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  let text = (m[1] || '').trim();
  let check = '', max = 0;
  text = text.replace(/--(?:conferir|check)\s+("([^"]+)"|'([^']+)'|(\S+))/i, (_, a, b, c, d) => { check = b || c || d || ''; return ''; });
  text = text.replace(/--(?:rodadas|max|rounds)\s+(\d+)/i, (_, n) => { max = Number(n); return ''; });
  return { text: text.trim(), check: check.trim(), max: Math.max(1, Math.min(50, max || S.settings.goalMax || GOAL_MAX)) };
}

/** Comandos sobre a meta atual: "/meta" (mostra), "/meta parar", "/meta continuar". true se tratou. */
function goalCommand(conv, raw) {
  const g = parseGoal(raw);
  if (!g) return false;
  const word = g.text.toLowerCase();
  if (!g.text) {
    if (conv?.goal) toast(L('Meta: {0} · {1}', conv.goal.text, goalState(conv.goal)));
    else toast(L('Use /meta seguido do objetivo. Ex.: /meta todos os testes passando --conferir "npm test"'));
    return true;
  }
  if (['parar', 'stop', 'cancelar'].includes(word)) { if (conv?.goal) goalEnd(conv, 'stopped', L('Parada por você.')); return true; }
  if (['continuar', 'continue', 'retomar'].includes(word)) { if (conv?.goal) { conv.goal.status = 'active'; conv.goal.round = Math.min(conv.goal.round, conv.goal.max - 1); saveConvs(); drawGoalBar(); goalNext(conv, L('Retomada por você.'), ''); } return true; }
  return false;
}

function goalState(g) {
  return { active: L('rodada {0} de {1}', g.round + 1, g.max), done: L('alcançada'), stopped: L('parada'), limit: L('limite de rodadas'), stuck: L('sem progresso') }[g.status] || g.status;
}

/** Começa uma meta: a primeira rodada é a própria mensagem (com o objetivo dito de forma explícita). */
function goalStart(conv, g) {
  conv.goal = { text: g.text, check: g.check, max: g.max, round: 0, status: 'active', at: Date.now(), log: [] };
  saveConvs();
  drawGoalBar();
  const text = L('Objetivo (trabalhe até alcançar): {0}', g.text)
    + (g.check ? '\n' + L('Conferência: o comando `{0}` precisa terminar sem erro.', g.check) : '')
    + '\n\n' + L('Faça o que for preciso, confira o resultado e diga no fim o que falta, se faltar algo. O studio vai conferir e, se não estiver pronto, pedir a próxima rodada.');
  return { content: text, parts: [{ t: 'text', v: text }], refs: [], goal: true };
}

/** Fim de uma resposta (chamado no fim do runAgent): confere e decide a próxima rodada. */
async function goalAfterTurn(conv, aborted) {
  const g = conv.goal;
  if (!g || g.status !== 'active') return;
  if (aborted) { goalEnd(conv, 'stopped', L('Parada pelo botão Parar. Para seguir: /meta continuar')); return; }
  const last = conv.messages.at(-1);
  if (last?.role === 'error' && !last.limit && !last.loop) { goalEnd(conv, 'stopped', L('A resposta terminou com erro: {0}', clipText(last.content, 200))); return; }
  g.checking = true; drawGoalBar();
  try {
    let checkOut = null;
    if (g.check) {
      try {
        const r = await api('/api/tools/call', { name: 'run_command', ws: wsOf(conv), arguments: { command: g.check, timeout: 300 } });
        // só passa com código de saída 0 (a primeira linha do run_command diz qual foi)
        const code = /\[(?:exit code|código de saída) (\S+)/i.exec(r.content || '')?.[1];
        checkOut = { ok: !r.isError && code === '0', text: clipText(r.content || '', 3000) };
      } catch (e) { checkOut = { ok: false, text: e.message }; }
    }
    const verdict = await goalJudge(conv, g, checkOut);
    g.log.push({ round: g.round + 1, done: verdict.done, reason: verdict.reason, check: checkOut ? checkOut.ok : null, t: Date.now() });
    if (verdict.done && (!checkOut || checkOut.ok)) { goalEnd(conv, 'done', verdict.reason); return; }
    // sem progresso: duas rodadas seguidas com o mesmo motivo
    const prev = g.log.at(-2);
    if (prev && !prev.done && prev.reason && prev.reason === verdict.reason && g.round >= 2) { goalEnd(conv, 'stuck', L('Duas rodadas seguidas sem avanço: {0}', verdict.reason)); return; }
    g.round++;
    if (g.round >= g.max) { goalEnd(conv, 'limit', L('Chegou ao limite de {0} rodadas. Falta: {1}', g.max, verdict.reason)); return; }
    goalNext(conv, verdict.reason, verdict.next, checkOut);
  } catch (e) {
    goalEnd(conv, 'stopped', L('Não consegui conferir a meta: {0}', e.message));
  } finally {
    delete g.checking; saveConvs(); drawGoalBar();
  }
}

/** O juiz: compara o objetivo com o que foi feito. Resposta curta em JSON. */
async function goalJudge(conv, g, checkOut) {
  const recent = conv.messages.slice(-14).map((m) => {
    if (m.role === 'user') return 'USUÁRIO: ' + clipText(userContent(m), 800);
    if (m.role === 'assistant') return 'ASSISTENTE: ' + clipText(splitThink(typeof m.content === 'string' ? m.content : '').text, 1500) + ((m.tool_calls || []).length ? ' [ferramentas: ' + m.tool_calls.map((t) => t.function?.name).join(', ') + ']' : '');
    if (m.role === 'tool') return 'RESULTADO (' + (m.name || 'ferramenta') + '): ' + clipText(m.content, 400);
    if (m.role === 'error') return 'ERRO: ' + clipText(m.content, 300);
    return '';
  }).filter(Boolean).join('\n');
  const sys = L('Você é o juiz de uma meta. Diga se o OBJETIVO já foi alcançado, olhando o que o assistente fez e o resultado da conferência (se houver). Seja exigente: só "done": true se o objetivo inteiro estiver cumprido e verificado, não só planejado ou prometido. Responda só com JSON: {"done": true|false, "reason": "o que falta (ou por que está pronto), em uma frase", "next": "o próximo passo concreto, em uma frase"}');
  const user = L('OBJETIVO:\n{0}\n\nRODADA: {1} de {2}\n\n{3}O QUE ACONTECEU (fim da conversa):\n{4}', g.text, g.round + 1, g.max,
    checkOut ? L('CONFERÊNCIA (`{0}`): {1}\n{2}\n\n', g.check, checkOut.ok ? L('passou') : L('falhou'), checkOut.text) : '', recent);
  let out = '';
  const p = apiFor('background') || mainApiForChat(conv)?.id;
  if (p) {
    const m = { content: '', reasoning: '', tool_calls: [] };
    await streamApi([{ role: 'system', content: sys }, { role: 'user', content: user }], [], m, new AbortController().signal, () => {}, { _p: p, temperature: 0, max_tokens: 400, _timeout: 90000, _bg: true });
    out = splitThink(m.content || '').text;
  } else {
    out = await sideAsk(conv, sys, user, { maxTokens: 300 });
  }
  let j = {};
  try { j = JSON.parse((out.match(/\{[\s\S]*\}/) || ['{}'])[0]); } catch { /* resposta torta */ }
  return { done: j.done === true, reason: String(j.reason || (checkOut && !checkOut.ok ? L('a conferência falhou') : L('não ficou claro se terminou'))).slice(0, 300), next: String(j.next || '').slice(0, 300) };
}

/** Manda a próxima rodada (como mensagem do usuário marcada). */
function goalNext(conv, reason, next, checkOut) {
  const g = conv.goal;
  const text = L('(Meta, rodada {0} de {1}) Ainda não está pronto: {2}', g.round + 1, g.max, reason)
    + (next ? '\n' + L('Próximo passo sugerido: {0}', next) : '')
    + (checkOut && !checkOut.ok ? '\n\n' + L('Saída da conferência `{0}`:\n{1}', g.check, checkOut.text) : '')
    + '\n\n' + L('Continue melhorando até alcançar o objetivo: {0}', g.text);
  saveConvs(); drawGoalBar();
  setTimeout(() => { if (conv.goal?.status === 'active' && !running(conv)) submit(conv, { content: text, parts: [{ t: 'text', v: text }], refs: [], goal: true }); }, 400);
}

function goalEnd(conv, status, why) {
  const g = conv.goal;
  if (!g) return;
  g.status = status; g.endedAt = Date.now(); g.why = why;
  conv.messages.push({ role: 'notice', icon: status === 'done' ? 'check' : 'alert', goalEnd: status, content: (status === 'done' ? L('Meta alcançada em {0} rodada(s): {1}', g.round + 1, why) : L('Meta parada ({0}): {1}', goalState(g), why)) });
  saveConvs(); drawGoalBar();
  if (conv.id === S.curId) scheduleRender();
  if (status === 'done') toast(L('Meta alcançada: {0}', g.text));
}

/** "/meta" no menu da barra: entra como comando (o usuário completa o objetivo). */
function goalItems(f) {
  if (f && !'meta'.startsWith(f) && !'goal'.startsWith(f)) return [];
  const text = '/meta ';
  return [{ kind: 'prompt', id: 'meta', name: L('Meta: trabalhar até alcançar um objetivo'), desc: L('/meta <objetivo> [--conferir "comando"] [--rodadas N]'), prompt: { id: 'meta', title: 'meta', text } }];
}

/** A faixa da meta, acima da caixa de mensagem. */
function drawGoalBar() {
  let bar = $('#goalbar');
  const c = cur();
  const g = c?.goal;
  if (!g || g.status !== 'active') { bar?.remove(); return; }
  if (!bar) { bar = h('div.bgbar.goalbar#goalbar'); $('.composer-wrap')?.prepend(bar); }
  bar.innerHTML = '';
  bar.append(ic('target' in ICONS ? 'target' : 'flag' in ICONS ? 'flag' : 'sparkles'),
    h('span.bg-text', { title: g.text }, (g.checking ? L('Conferindo a meta...') : L('Meta · {0}', goalState(g))) + ' · ' + g.text),
    h('span.spacer'),
    h('button.btn.sm', { type: 'button', onclick: () => { goalEnd(c, 'stopped', L('Parada por você.')); if (running(c)) stop(); } }, L('Parar a meta')));
}
