// Confere a ordem dos arquivos da interface (ui/js): código que roda ao carregar só pode usar
// o que foi declarado num arquivo anterior. Funções só chamadas depois (eventos, init) podem usar qualquer um.
// Uso (dentro de tests/ordem): npm ci && node run.cjs
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const dir = path.join(__dirname, '../../ui/js');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
const asts = files.map((f) => acorn.parse(fs.readFileSync(path.join(dir, f), 'utf8'), { ecmaVersion: 'latest', sourceType: 'script', locations: true }));

function names(p, out) {
  if (!p) return;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach((q) => names(q.value || q.argument, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach((q) => names(q, out));
  else if (p.type === 'AssignmentPattern') names(p.left, out);
  else if (p.type === 'RestElement') names(p.argument, out);
}

let bad = 0;
const declIn = new Map();
asts.forEach((ast, i) => {
  for (const st of ast.body) {
    const ids = [];
    if (st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') ids.push(st.id.name);
    if (st.type === 'VariableDeclaration') st.declarations.forEach((d) => names(d.id, ids));
    for (const n of ids) {
      if (declIn.has(n) && declIn.get(n) !== i) { bad++; console.log(`${files[i]}: ${n} já foi declarado em ${files[declIn.get(n)]}`); }
      declIn.set(n, i);
    }
  }
});

asts.forEach((ast, i) => {
  for (const st of ast.body) {
    if (st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') continue;
    const used = new Set();
    walk.recursive(st, null, {
      Function() {}, // o corpo só roda quando a função for chamada
      CallExpression(node, s, c) {
        // função chamada na hora (IIFE): o corpo roda agora
        if (node.callee.type === 'FunctionExpression' || node.callee.type === 'ArrowFunctionExpression') c(node.callee.body, s);
        else c(node.callee, s);
        node.arguments.forEach((a) => c(a, s));
      },
      Identifier(node) { used.add(node.name); },
      MemberExpression(node, s, c) { c(node.object, s); if (node.computed) c(node.property, s); },
      Property(node, s, c) { if (node.computed) c(node.key, s); c(node.value, s); },
    });
    for (const n of used) {
      const j = declIn.get(n);
      if (j !== undefined && j > i) { bad++; console.log(`${files[i]}:${st.loc.start.line} usa ${n} ao carregar, mas ele só existe em ${files[j]}`); }
    }
  }
});

console.log(bad ? `${bad} problema(s) de ordem nos arquivos da interface.` : `Ordem dos ${files.length} arquivos da interface: ok.`);
process.exit(bad ? 1 : 0);
