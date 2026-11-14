// Confere o verificador determinístico antes de concluir (#5): as duas checagens (comando do projeto
// que não rodou depois da edição, e caminho citado como criado que não existe no disco) e a extração
// de caminhos citados. Uso: node tests/preflight/run.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(dir, '../../ui/js/07-agente.js'), 'utf8');

const start = src.indexOf('const PREFLIGHT_CMDS');
const end = src.indexOf('\n}', src.indexOf('return notes.join')) + 2;
if (start < 0 || end <= start) { console.error('não achei o bloco preflight no 07-agente.js'); process.exit(1); }
const block = src.slice(start, end);

const L = (s, ...a) => s.replace(/\{(\d+)\}/g, (m, i) => (a[i] !== undefined ? a[i] : m));
const splitThink = (c) => ({ text: String(c || '') });
const wsOf = () => 'C:\\analise\\llama-studio';
const exists = new Map([
  ['cargo.toml', true],
  ['src/real.rs', true],
  ['src/ghost.rs', false],
  ['out/relatorio.md', false],
]);
const api = async (url, body) => {
  if (url === '/api/stat') return { exists: !!exists.get(String(body.path).replace(/\\/g, '/').toLowerCase()) };
  throw new Error('api inesperada: ' + url);
};
const { preflight, preflightPaths } = new Function('api', 'L', 'splitThink', 'wsOf', block + '\nreturn { preflight, preflightPaths };')(api, L, splitThink, wsOf);

let fails = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log('ok  ' + name);
  else { fails++; console.error('FALHOU ' + name + '\n  esperado: ' + w + '\n  veio:     ' + g); }
};
const has = (name, text, want) => {
  if (String(text).includes(want)) console.log('ok  ' + name);
  else { fails++; console.error('FALHOU ' + name + '\n  nota não contém: ' + want + '\n  nota: ' + text); }
};

// extração de caminhos citados
eq('paths: criei/alterei', preflightPaths('Criei o arquivo src/foo.rs e alterei src/bar.rs.'), ['src/foo.rs', 'src/bar.rs']);
eq('paths: só leitura', preflightPaths('Li o README.md e não mudei nada.'), []);
eq('paths: verbo depois do caminho', preflightPaths('o arquivo src/ghost.rs foi criado'), ['src/ghost.rs']);
eq('paths: sem extensão', preflightPaths('alterei o código e deixei em src'), []);
eq('paths: negação', preflightPaths('Não criei nada de novo.'), []);

// preflight: mudou arquivos, nada rodou depois, e citou arquivo que não existe
const g1 = { writes: 2, lastRun: -1, lastWrite: 3, files: new Map([['src/real.rs', 1]]) };
const n1 = await preflight({}, g1, { content: 'Criei o arquivo src/ghost.rs e alterei src/real.rs.' });
has('nota 1: comando do projeto', n1, 'cargo build');
has('nota 1: arquivo alterado', n1, 'src/real.rs');
has('nota 2: caminho inexistente', n1, 'src/ghost.rs');
has('nota 2: aviso de inexistência', n1, 'não existe');

// rodou depois da edição e citou só arquivo real (gravado pela ferramenta): sem nota
const g2 = { writes: 2, lastRun: 5, lastWrite: 3, files: new Map([['src/real.rs', 1]]) };
eq('sem nota: rodou depois e caminho real', await preflight({}, g2, { content: 'Alterei src/real.rs.' }), '');

// citou arquivo inexistente mas nada foi editado: só a nota 2
const g3 = { writes: 0, lastRun: -1, lastWrite: -1, files: new Map() };
const n3 = await preflight({}, g3, { content: 'O resultado está em out/relatorio.md.' });
has('nota 2 isolada', n3, 'out/relatorio.md');
if (n3.includes('cargo build')) { fails++; console.error('FALHOU: nota 1 veio sem ter havido edição\n  nota: ' + n3); }
else console.log('ok  nota 1 não veio sem edição');

console.log(fails ? `\n${fails} falha(s)` : '\ntudo passou');
process.exit(fails ? 1 : 0);