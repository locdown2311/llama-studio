// Testes dos recursos automáticos: confere que cada frase liga exatamente o esperado.
// Uso: node tests/rotas/run.mjs   (sai com erro se alguma frase ligar algo a mais ou a menos)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(dir, '../../ui/app.js'), 'utf8');
const a = src.indexOf('const ROUTES = ['); const b = src.indexOf('async function autoRoute', a);
const { routeProfiles, routeExtras } = new Function(src.slice(a, b) + '; return { routeProfiles, routeExtras };')();
const diff = (got, exp) => [got.filter((x) => !exp.includes(x)), exp.filter((x) => !got.includes(x))];
let total = 0, ok = 0, extra = 0, miss = 0;
for (const f of ['treino', 'validacao1', 'validacao2', 'validacao4', 'extras']) {
  const mod = await import('./' + f + '.mjs');
  const { skills = [], mcps = [] } = mod;
  for (const [t, ep, em, es] of mod.default) {
    total++;
    const prof = routeProfiles(t);
    const d = [diff(prof.map((r) => r.id), ep)];
    if (em) {
      const ex = routeExtras(t, skills, mcps);
      const sk = [...new Set([...prof.flatMap((r) => (r.skills ? skills.filter((s) => r.skills.test(s.name + ' ' + s.id)).map((s) => s.id) : [])), ...ex.skills])];
      d.push(diff(ex.mcp, em), diff(sk, es));
    }
    const e = d.flatMap((x) => x[0]), m = d.flatMap((x) => x[1]);
    extra += e.length; miss += m.length;
    if (!e.length && !m.length) ok++; else console.log(`${f}: ${e.length ? '+' + e : ''} ${m.length ? '-' + m : ''} | ${t}`);
  }
}
console.log(`${ok}/${total} frases certas · ligou a mais: ${extra} · faltou: ${miss}`);
process.exit(ok === total ? 0 : 1);
