/* llama studio - habilidades e conectores (MCP) */
'use strict';

/* ============================================================ skills */
async function loadSkills() {
  try { S.skills = (await api('/api/skills')).skills; } catch { S.skills = []; }
  S.sel.skills = S.sel.skills.filter((id) => S.skills.some((s) => s.id === id));
  updatePickers();
}

async function renderSkillsPage() {
  await loadSkills();
  const grid = $('#skill-grid'); grid.innerHTML = '';
  if (!S.skills.length) grid.append(h('div.empty-card', null, L('Nenhuma habilidade ainda. Crie uma ou importe um pacote acima.')));
  for (const s of S.skills) {
    const active = S.sel.skills.includes(s.id);
    grid.append(h('div.skill' + (active ? '.on' : ''), null,
      h('div.skill-top', null, h('div.skill-ico', { html: svg('sparkles') }), h('div.skill-name', { title: s.name }, s.name), !s.editable ? h('span.tag', { title: s.source }, L('externa')) : null,
        h('label.switch', { title: active ? L('Ativa no chat') : L('Ativar no chat') }, (() => {
          const i = h('input', { type: 'checkbox', checked: active });
          i.addEventListener('change', () => { S.sel.skills = i.checked ? [...new Set([...S.sel.skills, s.id])] : S.sel.skills.filter((x) => x !== s.id); saveSel(); updatePickers(); renderSkillsPage(); });
          return i;
        })(), h('span'))),
      h('div.skill-desc', null, s.description || L('Sem descrição.')),
      s.triggers?.length ? h('div.skill-trig.small.muted', { title: L('Sinais que indicam a skill') }, ic('signpost'), s.triggers.join(', ')) : null,
      s.tools?.length ? h('div.skill-trig.small', { title: L('Ferramentas que a skill traz (tools.json)') }, ic('wrench'), s.tools.map((t) => t.name).join(', ')) : null,
      s.tools_error ? h('div.skill-trig.small.err', null, ic('alert'), s.tools_error) : null,
      h('div.skill-foot', null,
        h('span', null, s.files.length ? `${s.files.length} ${s.files.length === 1 ? L('arquivo extra') : L('arquivos extras')}` : L('só SKILL.md')),
        h('span.spacer'),
        h('button.icon-btn.sm', { title: L('Abrir pasta'), 'aria-label': L('Abrir pasta'), html: svg('external'), onclick: () => api('/api/skills/open', { id: s.id }) }),
        s.editable ? h('button.icon-btn.sm', { title: L('Editar'), 'aria-label': L('Editar'), html: svg('edit'), onclick: () => editSkill(s.id) }) : null,
        s.editable ? h('button.icon-btn.sm', { title: L('Remover'), 'aria-label': L('Remover'), html: svg('trash'), onclick: async () => {
          if (!(await confirmBox(L('Remover a habilidade "{0}"? A pasta dela será apagada.', s.name), L('Remover'), true))) return;
          try { await api('/api/skills/delete', { id: s.id }); toast(L('Habilidade removida')); renderSkillsPage(); } catch (e) { toast(e.message, 'err'); }
        } }) : null)));
  }
  const ed = $('#extra-dirs'); ed.innerHTML = '';
  for (const d of S.info.extraSkillsDirs || []) {
    ed.append(h('div.dirrow', null, ic('folder'), h('span', { title: d }, d), h('button.icon-btn.sm', { title: L('Remover'), 'aria-label': L('Remover'), html: svg('x'), onclick: async () => {
      S.info.extraSkillsDirs = S.info.extraSkillsDirs.filter((x) => x !== d);
      await api('/api/config', { extraSkillsDirs: S.info.extraSkillsDirs }); renderSkillsPage();
    } })));
  }
}

async function editSkill(id, prefill) {
  // id muda depois do primeiro "Salvar e testar" de uma skill nova
  let data = { name: '', description: '', body: '', ...(prefill || {}) };
  if (id) { try { data = await api('/api/skills/get?id=' + encodeURIComponent(id)); } catch (e) { toast(e.message, 'err'); return; } }
  const name = h('input.input', { value: data.name || data.meta?.name || '', placeholder: L('Ex.: relatorios-em-pt') });
  const desc = h('textarea.textarea', { rows: 2, value: data.description || '', placeholder: L('Quando o modelo deve usar esta skill. Ex.: Use ao escrever relatórios técnicos em português.') });
  desc.style.minHeight = '60px';
  const body = h('textarea.textarea.mono', { rows: 14, value: (data.body || '').trim(), placeholder: L('# Instruções\n\nDescreva o passo a passo, regras de estilo, exemplos...') });
  body.style.minHeight = '280px';
  const trig = h('input.input', { value: (data.triggers || []).join(', ') || data.meta?.triggers || '', placeholder: L('Ex.: relatório técnico, laudo, parecer') });
  const te = skillToolsEditor(data, () => save(false));
  const m = modal({
    title: id ? L('Editar habilidade') : L('Nova habilidade'), wide: true,
    body: h('div.form', null,
      h('div.field', null, h('label', null, L('Nome')), name),
      h('div.field', null, h('label', null, L('Descrição')), desc, h('small', null, L('O modelo lê isto para entender quando aplicar a habilidade.'))),
      h('div.field', null, h('label', null, L('Sinais (quando usar)')), trig, h('small', null, L('Palavras ou frases separadas por vírgula. Se o pedido tiver uma delas, a skill entra sozinha.'))),
      h('div.field', null, h('label', null, L('Instruções (Markdown)')), body),
      te.el),
    foot: [h('button.btn', { onclick: () => m.close() }, L('Cancelar')), h('button.btn.primary', { onclick: () => save(true) }, id ? L('Salvar habilidade') : L('Criar habilidade'))],
  });
  // salva; close=false é o "Salvar e testar" das ferramentas (o editor continua aberto). Devolve o id.
  async function save(close) {
    const created = !id;
    try {
      const t = te.collect();
      const r = await api('/api/skills/save', { id, name: name.value.trim(), description: desc.value.trim(), body: body.value, triggers: trig.value.trim(), tools: t.toolsText, scripts: t.scripts });
      id = r.id; te.saved();
      if (created) { S.sel.skills = [...new Set([...S.sel.skills, r.id])]; saveSel(); }
      if (close) { m.close(); toast(created ? L('Habilidade criada') : L('Habilidade salva')); }
      renderSkillsPage();
      return id;
    } catch (e) { toast(e.message, 'err'); throw e; }
  }
}

/* ---- editor visual das ferramentas de uma skill (tools.json + scripts) ----
   Cada ferramenta é um cartão: nome, o que faz, parâmetros numa tabela, o tipo (script Python/PowerShell/Node ou
   um comando qualquer) e, para script, o próprio código, que fica em scripts/ na pasta da skill. O comando é montado
   sozinho para os scripts; o script recebe todos os argumentos num JSON (o primeiro argumento). Dá para testar com
   valores de exemplo e, para quem prefere, editar tudo como JSON. */
const TOOL_KINDS = {
  py: { label: 'Script Python', ext: 'py', cmd: (f) => `python "{skill_dir}/${f}" {args_file}`,
    tpl: (t) => `import json, sys\n\n# os argumentos chegam num arquivo JSON (o primeiro argumento)\nargs = json.load(open(sys.argv[1], encoding="utf-8"))\n${t.params.map((p) => `${p.name} = args.get(${JSON.stringify(p.name)})`).join('\n')}\n\n# o que for impresso volta para o modelo\nprint("ok")\n` },
  ps1: { label: 'Script PowerShell', ext: 'ps1', cmd: (f) => `powershell -NoProfile -ExecutionPolicy Bypass -File "{skill_dir}/${f}" {args_file}`,
    tpl: (t) => `param([string]$ArgsFile)\n# os argumentos chegam num arquivo JSON\n$a = Get-Content -Raw -Encoding UTF8 $ArgsFile | ConvertFrom-Json\n${t.params.map((p) => `$${p.name.replace(/\W/g, '_')} = $a.${p.name}`).join('\n')}\n\n# o que for escrito volta para o modelo\nWrite-Output "ok"\n` },
  js: { label: 'Script Node', ext: 'js', cmd: (f) => `node "{skill_dir}/${f}" {args_file}`,
    tpl: (t) => `// os argumentos chegam num arquivo JSON (o primeiro argumento)\nconst args = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));\n${t.params.map((p) => `const ${p.name.replace(/\W/g, '_')} = args[${JSON.stringify(p.name)}];`).join('\n')}\n\n// o que for impresso volta para o modelo\nconsole.log('ok');\n` },
  cmd: { label: 'Comando', ext: '', cmd: () => '', tpl: () => '' },
};
const PARAM_TYPES = [['string', 'texto'], ['integer', 'inteiro'], ['number', 'número'], ['boolean', 'sim/não'], ['array', 'lista']];
const toolSlug = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

function skillToolsEditor(data, saveFn) {
  const orig = new Set(Object.keys(data.scripts || {}));
  let list = [];
  try { list = JSON.parse(data.toolsText || '[]'); } catch { list = []; }
  // modelo interno: um objeto simples por ferramenta
  const fromDecl = (t) => {
    const ext = (t.script || '').split('.').pop();
    const kind = t.script && TOOL_KINDS[ext] ? ext : 'cmd';
    const props = t.parameters?.properties || {};
    const req = t.parameters?.required || [];
    const params = Object.entries(props).map(([n, p]) => ({ name: n, type: (Array.isArray(p.type) ? p.type[0] : p.type) || 'string', desc: p.description || '', req: req.includes(n) }));
    const auto = kind !== 'cmd' && t.command === TOOL_KINDS[kind].cmd(t.script);
    return { name: t.name || '', desc: t.description || '', kind, params, command: t.command || '', auto, ro: t.mutating === false, timeout: t.timeout || '', script: t.script || '', code: (data.scripts || {})[t.script] ?? '', test: {}, out: null, open: false };
  };
  let tools = list.map(fromDecl);
  let jsonMode = false;
  const scriptPath = (t) => (t.kind === 'cmd' ? '' : `scripts/${toolSlug(t.name) || 'ferramenta'}.${TOOL_KINDS[t.kind].ext}`);
  const syncCmd = (t) => { if (t.kind !== 'cmd' && t.auto) t.command = TOOL_KINDS[t.kind].cmd(scriptPath(t)); };
  const toDecl = (t) => {
    const props = {};
    for (const p of t.params) if (p.name.trim()) props[p.name.trim()] = { type: p.type, ...(p.type === 'array' ? { items: { type: 'string' } } : {}), ...(p.desc.trim() ? { description: p.desc.trim() } : {}) };
    const d = { name: t.name.trim(), description: t.desc.trim(), command: t.command.trim(), parameters: { type: 'object', properties: props, required: t.params.filter((p) => p.req && p.name.trim()).map((p) => p.name.trim()) } };
    if (t.ro) d.mutating = false;
    if (Number(t.timeout) > 0) d.timeout = Number(t.timeout);
    if (t.kind !== 'cmd') d.script = scriptPath(t);
    return d;
  };
  const wrap = h('div.field.stools');
  const listEl = h('div.stools-list');
  const jsonTa = h('textarea.textarea.mono', { rows: 14 });

  function render() {
    listEl.replaceChildren();
    if (jsonMode) {
      listEl.append(h('small', null, L('Edição direta do tools.json (os scripts continuam no modo visual).')), jsonTa);
      return;
    }
    if (!tools.length) listEl.append(h('div.stools-empty.small.muted', null, L('Nenhuma ferramenta. Uma ferramenta deixa o modelo rodar um script ou comando seu com os argumentos que ele escolher, como se fosse uma ferramenta nativa.')));
    tools.forEach((t, i) => listEl.append(card(t, i)));
  }

  function card(t, i) {
    const nameIn = h('input.input.mono', { value: t.name, placeholder: L('nome_da_ferramenta'), oninput: () => { t.name = nameIn.value; syncCmd(t); cmdIn.value = t.command; pathEl.textContent = scriptPath(t); } });
    const descIn = h('input.input', { value: t.desc, placeholder: L('O que ela faz e quando usar (o modelo lê isto)'), oninput: () => { t.desc = descIn.value; } });
    const kindSel = h('select.input', { onchange: () => {
      const was = t.kind; t.kind = kindSel.value;
      if (t.kind !== 'cmd') { t.auto = true; syncCmd(t); if (!t.code.trim() || t.code === TOOL_KINDS[was]?.tpl(t)) t.code = TOOL_KINDS[t.kind].tpl(t); }
      else if (t.auto) { t.command = ''; t.auto = false; }
      render();
    } }, Object.entries(TOOL_KINDS).map(([k, v]) => h('option', { value: k, selected: t.kind === k }, L(v.label))));
    const ro = h('label.stools-ro', { title: L('Ferramentas que só leem não pedem permissão antes de rodar') }, h('input', { type: 'checkbox', checked: t.ro, onchange: (e) => { t.ro = e.target.checked; } }), L('Só lê'));
    const del = h('button.icon-btn.sm', { title: L('Remover ferramenta'), 'aria-label': L('Remover ferramenta'), html: svg('trash'), onclick: () => { tools.splice(i, 1); render(); } });

    // parâmetros
    const ptab = h('div.stools-params');
    const drawParams = () => {
      ptab.replaceChildren();
      if (t.params.length) ptab.append(h('div.sp-row.sp-head.small.muted', null, h('span', null, L('Parâmetro')), h('span', null, L('Tipo')), h('span', null, L('Descrição')), h('span', null, L('Obrig.')), h('span')));
      t.params.forEach((p, j) => {
        const n = h('input.input.mono', { value: p.name, placeholder: 'entrada', oninput: () => { p.name = n.value.replace(/[^\w-]/g, ''); if (n.value !== p.name) n.value = p.name; refreshChips(); } });
        const ty = h('select.input', { onchange: () => { p.type = ty.value; } }, PARAM_TYPES.map(([v, l]) => h('option', { value: v, selected: p.type === v }, L(l))));
        const d = h('input.input', { value: p.desc, placeholder: L('o que é (ajuda o modelo)'), oninput: () => { p.desc = d.value; } });
        const rq = h('input', { type: 'checkbox', checked: p.req, onchange: () => { p.req = rq.checked; } });
        ptab.append(h('div.sp-row', null, n, ty, d, h('label.sp-req', null, rq), h('button.icon-btn.sm', { title: L('Remover parâmetro'), 'aria-label': L('Remover parâmetro'), html: svg('x'), onclick: () => { t.params.splice(j, 1); drawParams(); refreshChips(); } })));
      });
      ptab.append(h('button.link.small', { type: 'button', onclick: () => { t.params.push({ name: '', type: 'string', desc: '', req: true }); drawParams(); ptab.querySelectorAll('.sp-row:not(.sp-head) input.mono')[t.params.length - 1]?.focus(); } }, '+ ', L('Parâmetro')));
    };
    drawParams();

    // comando: montado sozinho para scripts; para "Comando", {param} digitado vira parâmetro
    const cmdIn = h('input.input.mono', { value: t.command, placeholder: t.kind === 'cmd' ? L('ex.: ffmpeg -i {entrada} -vn {saida}') : '', oninput: () => { t.command = cmdIn.value; t.auto = false; }, onchange: () => {
      const known = new Set(['skill_dir', 'ws', 'args_file', ...t.params.map((p) => p.name)]);
      let added = false;
      for (const m of t.command.matchAll(/\{([A-Za-z_][\w-]*)\}/g)) if (!known.has(m[1])) { known.add(m[1]); t.params.push({ name: m[1], type: 'string', desc: '', req: true }); added = true; }
      if (added) { drawParams(); refreshChips(); toast(L('Parâmetros novos a partir do comando')); }
    } });
    const chips = h('div.stools-chips');
    const refreshChips = () => {
      chips.replaceChildren(h('small.muted', null, L('Inserir:')), ...['skill_dir', 'ws', 'args_file', ...t.params.map((p) => p.name).filter(Boolean)].map((k) => h('button.chip', { type: 'button', title: k === 'skill_dir' ? L('Pasta da skill') : k === 'ws' ? L('Pasta de trabalho da conversa') : k === 'args_file' ? L('Arquivo JSON com todos os argumentos') : L('Valor do parâmetro (já entre aspas)'), onclick: () => {
        const a = cmdIn.selectionStart ?? cmdIn.value.length;
        cmdIn.value = cmdIn.value.slice(0, a) + `{${k}}` + cmdIn.value.slice(cmdIn.selectionEnd ?? a);
        t.command = cmdIn.value; t.auto = false; cmdIn.focus();
      } }, `{${k}}`)));
      if (t.kind !== 'cmd' && !t.auto) chips.append(h('button.link.small', { type: 'button', onclick: () => { t.auto = true; syncCmd(t); cmdIn.value = t.command; } }, L('Voltar ao automático')));
    };
    refreshChips();

    // script
    const pathEl = h('code.small', null, scriptPath(t));
    const code = h('textarea.textarea.mono.stools-code', { rows: 12, value: t.code, spellcheck: false, oninput: () => { t.code = code.value; }, onkeydown: (e) => {
      if (e.key === 'Tab') { e.preventDefault(); const a = code.selectionStart; code.setRangeText('    ', a, code.selectionEnd, 'end'); t.code = code.value; }
    } });
    const scriptBox = t.kind === 'cmd' ? null : h('div.stools-script', null,
      h('div.stools-sub', null, h('span', null, L('Script'), ' ', pathEl), h('span.spacer'),
        h('button.link.small', { type: 'button', title: L('Troca o código pelo modelo, com os parâmetros atuais'), onclick: async () => { if (!t.code.trim() || await confirmBox(L('Trocar o código pelo modelo?'), L('Trocar'), true)) { t.code = TOOL_KINDS[t.kind].tpl(t); code.value = t.code; } } }, L('Gerar modelo'))),
      code);

    // teste
    const outEl = h('pre.stools-out', { hidden: !t.out }, t.out?.text || '');
    if (t.out?.err) outEl.classList.add('err');
    const testBox = h('details.stools-test', { open: t.open, ontoggle: (e) => { t.open = e.target.open; } }, h('summary', null, ic('play'), L('Testar')),
      h('div.stools-test-in', null, t.params.filter((p) => p.name).map((p) => {
        const inp = h('input.input', { value: t.test[p.name] ?? '', placeholder: p.name, oninput: () => { t.test[p.name] = inp.value; } });
        return h('label.small', null, h('span.mono', null, p.name), inp);
      })),
      h('div.stools-test-act', null, h('button.btn.sm', { type: 'button', onclick: async (e) => {
        const btn = e.currentTarget; btn.disabled = true; outEl.hidden = false; outEl.classList.remove('err'); outEl.textContent = L('Salvando e rodando...');
        try {
          const sid = await saveFn();
          const args = {};
          for (const p of t.params) {
            const v = t.test[p.name];
            if (v == null || v === '') continue;
            args[p.name] = p.type === 'integer' || p.type === 'number' ? Number(v) : p.type === 'boolean' ? /^(true|sim|1|yes)$/i.test(v) : p.type === 'array' ? v.split(',').map((x) => x.trim()) : v;
          }
          const conv = S.convs?.find?.((c) => c.id === S.curId);
          const r = await api('/api/skills/test-tool', { id: sid, name: t.name.trim(), args, ws: conv ? wsOf(conv) : '' });
          t.out = { text: `${r.content}\n\n(${(r.ms / 1000).toFixed(1)} s)`, err: r.isError };
        } catch (er) { t.out = { text: er.message, err: true }; }
        outEl.textContent = t.out.text; outEl.classList.toggle('err', !!t.out.err); btn.disabled = false;
      } }, L('Salvar e testar')), h('small.muted', null, L('Roda de verdade, na pasta de trabalho da conversa aberta.'))),
      outEl);

    return h('div.stools-card', null,
      h('div.stools-top', null, nameIn, kindSel, ro, del),
      descIn,
      h('div.stools-sub', null, L('Parâmetros')), ptab,
      scriptBox,
      h('div.stools-sub', null, L('Comando'), t.kind !== 'cmd' && t.auto ? h('small.muted', null, ' · ', L('automático')) : null), cmdIn, chips,
      h('div.stools-adv', null, h('label.small', null, L('Tempo limite (s)'), h('input.input', { value: t.timeout, placeholder: '120', inputmode: 'numeric', oninput: (e) => { t.timeout = e.target.value.replace(/\D/g, ''); } }))),
      testBox);
  }

  const add = (kind) => {
    const t = { name: '', desc: '', kind, params: [{ name: 'entrada', type: 'string', desc: '', req: true }], command: '', auto: kind !== 'cmd', ro: false, timeout: '', script: '', code: '', test: {}, out: null, open: false };
    t.name = 'ferramenta' + (tools.length ? tools.length + 1 : '');
    syncCmd(t);
    if (kind !== 'cmd') t.code = TOOL_KINDS[kind].tpl(t);
    else { t.command = 'echo {entrada}'; }
    tools.push(t); render();
    listEl.lastElementChild?.querySelector('input')?.select();
  };
  const toggleJson = h('button.link.small', { type: 'button', onclick: () => {
    if (!jsonMode) { jsonTa.value = JSON.stringify(tools.map(toDecl), null, 2); jsonMode = true; }
    else {
      try {
        const keep = Object.fromEntries(tools.map((t) => [scriptPath(t), t.code]));
        tools = JSON.parse(jsonTa.value || '[]').map((d) => { const t = fromDecl(d); if (t.script && keep[t.script] != null) t.code = keep[t.script]; return t; });
        jsonMode = false;
      } catch (e) { toast(L('JSON inválido: {0}', e.message), 'err'); return; }
    }
    toggleJson.textContent = jsonMode ? L('Voltar ao editor visual') : L('Editar como JSON');
    render();
  } }, L('Editar como JSON'));
  wrap.append(
    h('div.stools-head', null, h('label', null, L('Ferramentas da skill')), h('span.spacer'), toggleJson),
    h('small', null, L('Scripts e comandos que viram ferramentas de verdade para o modelo quando a skill está em uso. O script recebe os argumentos num arquivo JSON; o que ele imprimir volta como resultado.')),
    listEl,
    h('div.stools-add', null, h('small.muted', null, L('Adicionar:')), Object.entries(TOOL_KINDS).map(([k, v]) => h('button.chip', { type: 'button', onclick: () => add(k) }, ic('plus'), L(v.label)))));
  render();

  return {
    el: wrap,
    collect() {
      if (jsonMode) {
        let arr;
        try { arr = JSON.parse(jsonTa.value || '[]'); } catch (e) { throw new Error(L('Ferramentas: JSON inválido ({0})', e.message)); }
        return { toolsText: arr.length ? JSON.stringify(arr, null, 2) : '', scripts: {} };
      }
      const names = new Set();
      for (const t of tools) {
        const n = t.name.trim();
        if (!/^[\w-]+$/.test(n)) throw new Error(L('Ferramenta "{0}": use só letras, números, _ ou - no nome.', n));
        if (names.has(n)) throw new Error(L('Duas ferramentas com o nome {0}.', n));
        names.add(n);
        if (!t.command.trim()) throw new Error(L('Ferramenta {0}: falta o comando.', n));
        const ps = t.params.map((p) => p.name.trim()).filter(Boolean);
        if (new Set(ps).size !== ps.length) throw new Error(L('Ferramenta {0}: parâmetro repetido.', n));
      }
      const scripts = {};
      for (const t of tools) if (t.kind !== 'cmd') scripts[scriptPath(t)] = t.code;
      // script de ferramenta removida ou renomeada: apaga
      for (const p of orig) if (!(p in scripts)) scripts[p] = null;
      return { toolsText: tools.length ? JSON.stringify(tools.map(toDecl), null, 2) : '', scripts };
    },
    saved() { orig.clear(); for (const t of tools) if (t.kind !== 'cmd') orig.add(scriptPath(t)); },
  };
}

async function importSkillFiles(files) {
  for (const f of files) {
    try {
      const r = await api('/api/skills/import-zip?name=' + encodeURIComponent(f.name), f);
      toast(L('Importada: {0}', r.imported.join(', ')));
    } catch (e) { toast(`${f.name}: ${e.message}`, 'err'); }
  }
  renderSkillsPage();
}

async function importSkillPath(p) {
  try {
    const r = await api('/api/skills/import-path', { path: p });
    toast(L('Importada{0}: {1}', r.imported.length > 1 ? 's' : '', r.imported.join(', ')));
    renderSkillsPage();
  } catch (e) { toast(e.message, 'err'); }
}

function setupSkillsPage() {
  $('#skill-new').append(ic('plus'), L('Nova skill'));
  $('#skill-new').addEventListener('click', () => editSkill(null));
  $('#skill-open-dir').append(ic('external'), L('Abrir pasta'));
  $('#skill-open-dir').addEventListener('click', () => api('/api/skills/open', {}));
  $('.iz-icon').innerHTML = svg('download');
  $('#skill-import-path').addEventListener('click', async () => {
    const p = await pickPath({ title: L('Importar habilidade: escolha uma pasta, .zip ou .md'), mode: 'any', start: S.info.home });
    if (p) importSkillPath(p);
  });
  $('#skill-zip').addEventListener('change', (e) => { importSkillFiles([...e.target.files]); e.target.value = ''; });
  $('#extra-add').addEventListener('click', async () => {
    const p = await pickPath({ title: L('Pasta com habilidades'), mode: 'dir', start: S.info.home });
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
        toast(L('Localizando a pasta {0}...', f.name));
        const r = await api('/api/locate', { name: f.name, isDir: true });
        if (r.matches.length === 1) await importSkillPath(r.matches[0].path);
        else {
          const p = await pickPath({ title: r.matches.length ? L('Várias pastas "{0}": escolha qual importar', f.name) : L('Não achei "{0}": escolha a pasta', f.name), mode: 'dir', start: r.matches[0] ? r.matches[0].path : S.info.home });
          if (p) await importSkillPath(p);
        }
      } else if (f) files.push(f);
    }
    if (files.length) importSkillFiles(files);
  });
}

/* ============================================================ MCP */
const PRESETS = [
  { name: 'arquivos', title: L('Sistema de arquivos'), desc: L('Lê e escreve arquivos numa pasta permitida.'), tag: 'npx', icon: 'folder',
    config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '{pasta}'] }, ask: [{ key: '{pasta}', label: L('Pasta permitida'), kind: 'dir' }] },
  { name: 'navegador', title: L('Navegador (Playwright)'), desc: L('Abre páginas, clica, preenche e lê sites.'), tag: 'npx', icon: 'globe',
    config: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] } },
  { name: 'fetch', title: L('Buscar páginas'), desc: L('Baixa uma URL e converte em texto para o modelo.'), tag: 'uvx', icon: 'download',
    config: { command: 'uvx', args: ['mcp-server-fetch'] } },
  { name: 'memoria', title: L('Memória'), desc: L('Grafo de conhecimento persistente entre conversas.'), tag: 'npx', icon: 'memory',
    config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] } },
  { name: 'pensamento', title: L('Pensamento sequencial'), desc: L('Ajuda o modelo a resolver problemas passo a passo.'), tag: 'npx', icon: 'brain',
    config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] } },
  { name: 'git', title: L('Git'), desc: L('Status, diff, log e commits de um repositório.'), tag: 'uvx', icon: 'git',
    config: { command: 'uvx', args: ['mcp-server-git', '--repository', '{repo}'] }, ask: [{ key: '{repo}', label: L('Pasta do repositório'), kind: 'dir' }] },
  { name: 'hora', title: L('Hora e fuso'), desc: L('Hora atual e conversão entre fusos horários.'), tag: 'uvx', icon: 'clock',
    config: { command: 'uvx', args: ['mcp-server-time', '--local-timezone', 'America/Sao_Paulo'] } },
  { name: 'context7', title: L('Context7'), desc: L('Documentação atualizada de bibliotecas e frameworks.'), tag: 'remoto', icon: 'book',
    config: { url: 'https://mcp.context7.com/mcp', type: 'http' } },
  { name: 'deepwiki', title: L('DeepWiki'), desc: L('Pergunte sobre qualquer repositório público do GitHub.'), tag: 'remoto', icon: 'book',
    config: { url: 'https://mcp.deepwiki.com/mcp', type: 'http' } },
  { name: 'github', title: L('GitHub'), desc: L('Issues, PRs e código. Pede um token pessoal.'), tag: 'remoto', icon: 'git',
    config: { url: 'https://api.githubcopilot.com/mcp/', type: 'http', headers: { Authorization: L('Bearer {token}') } }, ask: [{ key: '{token}', label: L('Token pessoal do GitHub'), kind: 'secret' }] },
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
  if (!S.mcp.length) { list.append(h('div.empty-card', null, L('Nenhum conector ainda. Escolha um da lista acima ou adicione o seu.'))); return; }
  const local = S.mcp.filter((s) => s.mem);
  if (local.length) list.append(h('div.srv-memsum', null, ic('cpu'), L('Conectores locais rodando: {0}, usando {1} de RAM no total.', local.length, fmtBytes(local.reduce((n, s) => n + s.mem, 0)))));
  for (const s of S.mcp) {
    const st = statusInfo(s.status);
    const sw = h('input', { type: 'checkbox', checked: s.status !== 'disabled' });
    sw.addEventListener('change', async () => { try { S.mcp = (await api('/api/mcp/toggle', { name: s.name, disabled: !sw.checked })).servers; loadMcp(); } catch (e) { toast(e.message, 'err'); } });
    const card = h('div.srv', null,
      h('div.srv-head', null,
        h('div.srv-ico', { html: svg(s.config?.url ? 'globe' : 'terminal') }),
        h('div.srv-main', null,
          h('div.srv-name', null, s.name, h('span.tag', null, s.kind === 'stdio' ? 'local' : s.kind === 'sse' ? 'SSE' : 'HTTP'),
            s.mem ? h('span.tag', { title: L('Memória em uso pelo processo do conector e pelos que ele abriu') }, L('{0} de RAM', fmtBytes(s.mem))) : null),
          h('div.srv-cmd', { title: cmdLine(s.config || {}) }, cmdLine(s.config || {}))),
        h('div.srv-status', null, h('span.dot.' + st.dot), s.status === 'connected' ? (s.hidden?.length ? L('{0} de {1} ferramentas', s.tools.length - s.tools.filter((t) => s.hidden.includes(t.name)).length, s.tools.length) : L('{0} ferramentas', s.tools.length)) : s.status === 'connecting' && s.since ? L('conectando... {0} s', Math.max(0, Math.round((Date.now() - s.since) / 1000))) : st.label),
        h('div.srv-actions', null,
          (() => { const on = (S.settings.trustedMcp || []).includes(s.name); return h('button.icon-btn.sm' + (on ? '.on' : ''), { title: on ? L('Confiável: as ferramentas que alteram algo rodam sem pedir confirmação. Clique para voltar a pedir.') : L('Pede confirmação antes das ferramentas que alteram algo. Clique para confiar neste conector.'), 'aria-label': L('Confiar no conector'), html: svg('shield'), onclick: () => { trustMcp(s.name, !on); drawMcpList(); toast(on ? L('{0}: volta a pedir confirmação', s.name) : L('{0}: confiável', s.name)); } }); })(),
          h('button.icon-btn.sm', { title: L('Reconectar'), 'aria-label': L('Reconectar'), html: svg('refresh'), onclick: async () => { s.status = 'connecting'; drawMcpList(); try { await api('/api/mcp/reconnect', { name: s.name }); } catch (e) { toast(e.message, 'err'); } loadMcp(); } }),
          h('button.icon-btn.sm', { title: L('Editar'), 'aria-label': L('Editar'), html: svg('edit'), onclick: () => editServer(s.name, s.config) }),
          h('button.icon-btn.sm', { title: L('Remover'), 'aria-label': L('Remover'), html: svg('trash'), onclick: async () => {
            if (!(await confirmBox(L('Remover o conector "{0}"?', s.name), L('Remover'), true))) return;
            await api('/api/mcp/delete', { name: s.name }); S.sel.mcp = S.sel.mcp.filter((x) => x !== s.name); saveSel(); loadMcp();
          } })),
        h('label.switch', { title: 'Ligar/desligar' }, sw, h('span'))),
      s.error ? h('div.srv-err', null, s.error.length > 300 ? s.error.slice(0, 300) + '...' : s.error) : null,
      (() => {
        const sel = h('select.select.sm', { title: L('Como as ferramentas deste conector chegam ao modelo') }, MCP_LOAD.map(([v, l]) => h('option', { value: v }, l)));
        sel.value = mcpLoadOf(s.name);
        const hint = h('small.muted', null, MCP_LOAD.find((x) => x[0] === sel.value)[2] + (s.tools.length ? L(' ({0} visíveis)', visibleToolCount(s.name)) : ''));
        sel.addEventListener('change', () => { setMcpLoad(s.name, sel.value); hint.textContent = MCP_LOAD.find((x) => x[0] === sel.value)[2] + (s.tools.length ? L(' ({0} visíveis)', visibleToolCount(s.name)) : ''); toast(`${s.name}: ${MCP_LOAD.find((x) => x[0] === sel.value)[1].toLowerCase()}`); });
        return h('div.srv-load', null, h('span', null, L('Carregar ferramentas')), sel, hint);
      })());
    const keep = (d, key) => { d.open = S.mcpOpen?.has(key) || false; d.addEventListener('toggle', () => { (S.mcpOpen ||= new Set())[d.open ? 'add' : 'delete'](key); }); return d; };
    if (s.tools.length) card.append(keep(toolsBox(s), s.name + ':tools'));
    // log sempre recolhido; só abre se a pessoa clicar
    if (s.log?.trim()) card.append(keep(h('details', null, h('summary', null, ic('chev'), L('Log do servidor ({0} linhas)', s.log.trim().split('\n').length)), h('pre.srv-log', null, s.log.trim().split('\n').slice(-80).join('\n'))), s.name + ':log'));
    list.append(card);
  }
}

/** Lista de ferramentas de um conector com chave para esconder cada uma do modelo. */
function toolsBox(s) {
  const hidden = new Set(s.hidden || []);
  const total = s.tools.length;
  const sumTxt = () => hidden.size ? L('Ferramentas ({0} de {1} visíveis para o modelo)', total - hidden.size, total) : L('Ferramentas ({0})', total);
  const sumLbl = h('span', null, sumTxt());
  let filter = S.mcpFilter?.[s.name] || '';
  let timer = 0;
  const save = () => {
    sumLbl.textContent = sumTxt();
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try { const r = await api('/api/mcp/hide', { name: s.name, hidden: [...hidden] }); S.mcp = r.servers; updatePickers(); if (!document.activeElement?.closest('.st-q')) drawMcpList(); }
      catch (e) { toast(e.message, 'err'); }
    }, 350);
  };
  const list = h('div.srv-tools');
  const matches = (t) => !filter || (t.name + ' ' + (t.description || '')).toLowerCase().includes(filter.toLowerCase());
  const draw = () => {
    list.innerHTML = '';
    const shown = s.tools.filter(matches);
    for (const t of shown) {
      const on = !hidden.has(t.name);
      const i = h('input', { type: 'checkbox', checked: on, onchange: () => { if (i.checked) hidden.delete(t.name); else hidden.add(t.name); row.classList.toggle('off', !i.checked); save(); } });
      const row = h('label.srv-tool.tg' + (on ? '' : '.off'), null,
        h('span.st-main', null, h('b', null, t.name), t.description ? h('div', null, t.description.length > 220 ? t.description.slice(0, 220) + '...' : t.description) : null),
        h('span.switch.sm', null, i, h('span')));
      list.append(row);
    }
    if (!shown.length) list.append(h('div.muted', { style: { padding: '8px 2px', fontSize: '13px' } }, L('Nenhuma ferramenta com esse filtro.')));
    cnt.textContent = filter ? L('{0} encontradas', shown.length) : '';
  };
  const cnt = h('span.muted.st-cnt');
  const q = h('input.input.sm', { value: filter, placeholder: L('Filtrar (ex.: jeb)'), oninput: () => { filter = q.value.trim(); (S.mcpFilter ||= {})[s.name] = filter; draw(); } });
  const bulk = (show) => { for (const t of s.tools.filter(matches)) show ? hidden.delete(t.name) : hidden.add(t.name); draw(); save(); };
  const tools = h('div.st-bar', null, h('span.st-q', null, ic('search'), q), cnt, h('span.spacer'),
    h('button.btn.ghost.sm', { onclick: () => bulk(true), title: L('Mostra ao modelo todas as ferramentas da lista (respeita o filtro)') }, L('Mostrar todas')),
    h('button.btn.ghost.sm', { onclick: () => bulk(false), title: L('Esconde do modelo todas as ferramentas da lista (respeita o filtro)') }, L('Esconder todas')));
  draw();
  return h('details', null, h('summary', null, ic('chev'), sumLbl),
    h('div.st-hint', null, L('Ferramentas desligadas não aparecem para o modelo nem no catálogo, e economizam contexto.')), tools, list);
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
    else v = await promptBox(p.title, a.label, '', L('Continuar'));
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
  const name = h('input.input', { value: oldName || suggestedName, placeholder: L('ex.: navegador') });
  const command = h('input.input.mono', { value: config.command || '', placeholder: L('npx, uvx, python, node, caminho\\do\\programa.exe') });
  const args = h('textarea.textarea.mono', { rows: 4, value: (config.args || []).join('\n'), placeholder: L('Um argumento por linha\n-y\n@pacote/servidor-mcp') });
  const env = h('textarea.textarea.mono', { rows: 3, value: Object.entries(config.env || {}).map(([k, v]) => `${k}=${v}`).join('\n'), placeholder: L('CHAVE=valor (uma por linha)') });
  const cwd = h('input.input.mono', { value: config.cwd || '', placeholder: L('Opcional') });
  const url = h('input.input.mono', { value: config.url || '', placeholder: L('https://exemplo.com/mcp') });
  const transport = h('select.select', null, h('option', { value: '' }, L('Automático (HTTP, depois SSE)')), h('option', { value: 'http' }, L('Streamable HTTP')), h('option', { value: 'sse' }, L('SSE (antigo)')));
  transport.value = (config.type || '').toLowerCase() === 'sse' ? 'sse' : (config.type ? 'http' : '');
  const headers = h('textarea.textarea.mono', { rows: 3, value: Object.entries(config.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n'), placeholder: L('Authorization: Bearer seu-token') });
  const json = h('textarea.textarea.mono', { rows: 14, placeholder: '{\n  "mcpServers": {\n    "meu-servidor": {\n      "command": "npx",\n      "args": ["-y", "pacote"]\n    }\n  }\n}' });
  json.style.minHeight = '300px';

  const localBox = h('div.form', null,
    h('div.field', null, h('label', null, L('Comando')), command),
    h('div.field', null, h('label', null, L('Argumentos')), args),
    h('div.row', null, h('div.field', null, h('label', null, L('Variáveis de ambiente')), env), h('div.field', null, h('label', null, L('Pasta de execução')), cwd)));
  const remoteBox = h('div.form', null,
    h('div.field', null, h('label', null, 'URL'), url),
    h('div.field', null, h('label', null, L('Transporte')), transport),
    h('div.field', null, h('label', null, L('Cabeçalhos')), headers));
  const kindSeg = h('div.seg', null,
    h('button', { type: 'button', onclick: () => { kind = 'local'; sync(); } }, L('Local (comando)')),
    h('button', { type: 'button', onclick: () => { kind = 'remote'; sync(); } }, L('Remoto (URL)')));
  const formBox = h('div.form', null, h('div.field', null, h('label', null, L('Nome')), name), h('div.field', null, h('label', null, L('Tipo')), kindSeg), localBox, remoteBox);
  const jsonBox = h('div.form', null, h('p.muted', { style: { margin: 0, fontSize: '13.5px' } }, L('Cole a configuração de outro app (Claude Desktop, Cherry Studio, Cursor...). Aceita o bloco "mcpServers" inteiro ou só um servidor.')), json);
  const tabs = !oldName ? h('div.seg', { style: { marginBottom: '16px' } },
    h('button', { type: 'button', onclick: () => { tab = 'form'; sync(); } }, L('Formulário')),
    h('button', { type: 'button', onclick: () => { tab = 'json'; sync(); } }, L('Colar JSON'))) : null;

  function sync() {
    kindSeg.children[0].classList.toggle('on', kind === 'local');
    kindSeg.children[1].classList.toggle('on', kind === 'remote');
    localBox.style.display = kind === 'local' ? '' : 'none';
    remoteBox.style.display = kind === 'remote' ? '' : 'none';
    if (tabs) { tabs.children[0].classList.toggle('on', tab === 'form'); tabs.children[1].classList.toggle('on', tab === 'json'); }
    formBox.style.display = tab === 'form' ? '' : 'none';
    jsonBox.style.display = tab === 'json' ? '' : 'none';
    saveBtn.textContent = tab === 'json' ? L('Importar') : (oldName ? L('Salvar e reconectar') : L('Adicionar e conectar'));
  }

  const saveBtn = h('button.btn.primary', { onclick: async () => {
    saveBtn.disabled = true;
    try {
      if (tab === 'json') {
        const r = await api('/api/mcp/import', { text: json.value });
        S.sel.mcp = [...new Set([...S.sel.mcp, ...r.added])]; saveSel();
        toast(L('Adicionado: {0}', r.added.join(', ')));
      } else {
        const n = name.value.trim();
        if (!n) throw new Error(L('Dê um nome ao servidor.'));
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
        if (config.disabledTools?.length) cfg.disabledTools = config.disabledTools;
        toast(L('Conectando a ') + n + '...');
        m.close();
        const r = await api('/api/mcp/upsert', { name: n, oldName, config: cfg });
        S.mcp = r.servers;
        const st = r.servers.find((s) => s.name === n);
        if (st?.status === 'connected') {
          S.sel.mcp = [...new Set([...S.sel.mcp.filter((x) => x !== oldName), n])]; saveSel();
          toast(L('{0}: {1} ferramentas disponíveis', n, st.tools.length));
        } else if (st?.status === 'error') toast(`${n}: ${st.error}`, 'err');
      }
      m.close();
      loadMcp();
    } catch (e) { toast(e.message, 'err'); } finally { saveBtn.disabled = false; }
  } });

  const m = modal({
    title: oldName ? L('Editar {0}', oldName) : L('Adicionar conector MCP'), wide: true,
    body: [tabs, formBox, jsonBox],
    foot: [h('button.btn', { onclick: () => m.close() }, L('Cancelar')), saveBtn],
  });
  sync();
}

async function editMcpJson() {
  const { text } = await api('/api/mcp/config');
  const ta = h('textarea.textarea.mono', { value: text, rows: 22 });
  ta.style.minHeight = '420px';
  const m = modal({
    title: 'mcp.json', wide: true,
    body: [h('p.muted', { style: { marginTop: 0, fontSize: '13.5px' } }, L('Mesmo formato do Claude Desktop. Use "disabled": true para desligar um servidor sem apagar.')), ta],
    foot: [h('button.btn', { onclick: () => m.close() }, L('Cancelar')), h('button.btn.primary', { onclick: async () => {
      try { await api('/api/mcp/config', { text: ta.value }); m.close(); toast(L('Configuração salva')); loadMcp(); } catch (e) { toast(e.message, 'err'); }
    } }, L('Salvar e reconectar'))],
  });
}

function setupMcpPage() {
  $('#mcp-new').append(ic('plus'), L('Adicionar conector'));
  $('#mcp-new').addEventListener('click', () => editServer(null, {}));
  $('#mcp-json').append(ic('braces'), L('Editar JSON'));
  $('#mcp-json').addEventListener('click', editMcpJson);
  $('#mcp-reconnect').append(ic('refresh'), L('Reconectar todos'));
  $('#mcp-reconnect').addEventListener('click', async () => {
    S.mcp.forEach((s) => { if (s.status !== 'disabled') s.status = 'connecting'; }); drawMcpList();
    try { await api('/api/mcp/reconnect', {}); } catch (e) { toast(e.message, 'err'); }
    loadMcp();
  });
}
