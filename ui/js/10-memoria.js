/* llama studio - memória entre conversas: fatos sobre você (valem em todas) e sobre cada projeto (só nas dele).
   O modelo guarda com a ferramenta memory (sozinho, se você deixar, ou quando você pede) e você revisa em
   Configurações → Memória. A lista entra no prompt de sistema da conversa no começo e fica congelada nela
   (assim o cache do servidor não se perde quando outra conversa guarda algo). */
'use strict';

S.memory = store.get('memory', []);
function saveMemory() { store.set('memory', S.memory); }
function memOn() { return S.settings.memory !== false; }
function memAuto() { return S.settings.memoryAuto !== false; }
function memFor(conv) {
  const pid = projectOf(conv)?.id;
  return S.memory.filter((m) => m.scope === 'global' || (pid && m.scope === pid));
}

/** O bloco de memória do prompt de sistema (congelado na conversa). */
function memNote(conv) {
  if (!memOn()) return '';
  if (typeof conv.memNote === 'string') return conv.memNote;
  const list = memFor(conv);
  const rule = memAuto()
    ? L('Guarde com memory (action "save") o que valer para conversas futuras: preferências e fatos duradouros que o usuário contar sobre ele, como ele gosta das respostas, decisões do projeto. Uma frase curta e completa por item. Não guarde o que só vale para esta tarefa, nem senhas, chaves ou dados sensíveis. Quando ele pedir para esquecer, use action "forget" com o id.')
    : L('Só guarde com memory (action "save") quando o usuário pedir para lembrar de algo; para esquecer, action "forget" com o id.');
  const items = list.map((m) => `- [${m.id}] ${m.text}${m.scope !== 'global' ? L(' (projeto)') : ''}`).join('\n');
  conv.memNote = L('# Memória\nO que você sabe do usuário e deste projeto, de conversas anteriores. Use sem dizer que está usando.\n{0}\n\n{1}', items || L('(vazia)'), rule);
  return conv.memNote;
}

function runMemory(tctx, args) {
  const a = String(args?.action || '').toLowerCase();
  const conv = tctx.conv;
  if (a === 'list') {
    const list = memFor(conv);
    return { content: list.length ? list.map((m) => `- [${m.id}] ${m.text}${m.scope !== 'global' ? L(' (projeto)') : ''}`).join('\n') : L('A memória está vazia.') };
  }
  if (a === 'forget') {
    const ids = [].concat(args?.id || args?.ids || []).map(String);
    const before = S.memory.length;
    S.memory = S.memory.filter((m) => !ids.includes(m.id));
    if (S.memory.length === before) return { content: L('Nenhum item com esse id: {0}.', ids.join(', ')), isError: true };
    saveMemory();
    return { content: L('Esquecido ({0}).', before - S.memory.length) };
  }
  if (a === 'save') {
    const text = String(args?.text || '').trim().replace(/\s+/g, ' ');
    if (!text) return { content: L('Passe text com o que guardar.'), isError: true };
    if (text.length > 400) return { content: L('Longo demais: até 400 caracteres por item.'), isError: true };
    const proj = projectOf(conv);
    const scope = args?.scope === 'project' && proj ? proj.id : 'global';
    const dup = S.memory.find((m) => m.scope === scope && m.text.toLowerCase() === text.toLowerCase());
    if (dup) return { content: L('Já estava guardado [{0}].', dup.id) };
    // corrige em vez de duplicar: replaces troca um item antigo
    const old = args?.replaces ? S.memory.find((m) => m.id === String(args.replaces)) : null;
    if (old) { old.text = text; old.ts = Date.now(); saveMemory(); return { content: L('Atualizado [{0}].', old.id) }; }
    const id = 'm' + uid().slice(0, 6);
    S.memory.push({ id, text, scope, ts: Date.now(), conv: conv?.id || null });
    if (S.memory.length > 300) S.memory = S.memory.slice(-300);
    saveMemory();
    toast(L('Guardado na memória: {0}', text.slice(0, 80)));
    return { content: L('Guardado [{0}]{1}.', id, scope === 'global' ? '' : L(' (só neste projeto)')) };
  }
  return { content: L('action deve ser save, forget ou list.'), isError: true };
}

/** Página Memória das configurações. */
function memoryPage(put) {
  const box = h('div.mem-list');
  const draw = () => {
    box.innerHTML = '';
    if (!S.memory.length) { box.append(h('div.muted.small', null, L('Nada guardado ainda. Diga numa conversa "lembre que..." ou deixe o modelo guardar sozinho.'))); return; }
    const groups = new Map();
    for (const m of [...S.memory].sort((a, b) => b.ts - a.ts)) {
      const k = m.scope === 'global' ? L('Sobre você (todas as conversas)') : L('Projeto: {0}', S.projects.find((p) => p.id === m.scope)?.name || L('apagado'));
      (groups.get(k) || groups.set(k, []).get(k)).push(m);
    }
    for (const [k, list] of groups) {
      box.append(h('div.set-group-title', null, k));
      for (const m of list) {
        const t = h('input.input', { value: m.text });
        t.addEventListener('change', () => { const v = t.value.trim(); if (!v) return; m.text = v; m.ts = Date.now(); saveMemory(); toast(L('Salvo')); });
        box.append(h('div.mem-item', null, t,
          h('span.mem-when.muted', { title: new Date(m.ts).toLocaleString() }, fmtStamp(m.ts).slice(0, 10)),
          h('button.icon-btn.sm', { type: 'button', title: L('Esquecer'), 'aria-label': L('Esquecer'), html: svg('trash'), onclick: () => { S.memory = S.memory.filter((x) => x !== m); saveMemory(); draw(); } })));
      }
    }
  };
  const add = h('input.input', { placeholder: L('Ex.: Prefiro respostas curtas e em tópicos.') });
  const addBtn = h('button.btn', { type: 'button', onclick: () => {
    const v = add.value.trim(); if (!v) return;
    S.memory.push({ id: 'm' + uid().slice(0, 6), text: v, scope: 'global', ts: Date.now(), conv: null }); saveMemory(); add.value = ''; draw();
  } }, ic('plus'), L('Adicionar'));
  add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); } });
  draw();
  return [
    h('label.tcard', null, h('span.tc-main', null, h('span.tc-title', null, L('Usar a memória')), h('span.tc-desc', null, L('O que está guardado entra nas conversas novas.'))),
      h('span.switch', null, (() => { const i = h('input', { type: 'checkbox', checked: memOn() }); i.addEventListener('change', () => put({ memory: i.checked })); return i; })(), h('span'))),
    h('label.tcard', null, h('span.tc-main', null, h('span.tc-title', null, L('O modelo guarda sozinho')), h('span.tc-desc', null, L('Preferências e fatos duradouros que você contar. Desligado: só quando você pedir ("lembre que...").'))),
      h('span.switch', null, (() => { const i = h('input', { type: 'checkbox', checked: memAuto() }); i.addEventListener('change', () => put({ memoryAuto: i.checked })); return i; })(), h('span'))),
    h('div.mem-add', null, add, addBtn),
    box,
  ];
}
