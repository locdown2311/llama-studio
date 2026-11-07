// Testes dos recursos automáticos: confere que cada frase liga exatamente o esperado.
// Uso: node tests/rotas/run.mjs   (sai com erro se alguma frase ligar algo a mais ou a menos)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const js = path.join(dir, '../../ui/js');
const src = fs.readdirSync(js).filter((f) => f.endsWith('.js')).sort().map((f) => fs.readFileSync(path.join(js, f), 'utf8')).join('\n');
const a = src.indexOf('const ROUTES = ['); const b = src.indexOf('async function autoRoute', a);
// L(): textos de tela (idioma); aqui basta o português
const { routeProfiles, routeExtras } = new Function('const L = (s, ...a) => s.replace(/\\{(\\d+)\\}/g, (m, i) => a[i] ?? "");\n' + src.slice(a, b) + '; return { routeProfiles, routeExtras };')();
const diff = (got, exp) => [got.filter((x) => !exp.includes(x)), exp.filter((x) => !got.includes(x))];
let total = 0, ok = 0, extra = 0, miss = 0;
for (const f of ['treino', 'validacao1', 'validacao2', 'validacao4', 'extras', 'ingles']) {
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
console.log(`equilibrado: ${ok}/${total} frases certas · ligou a mais: ${extra} · faltou: ${miss}`);

// os outros níveis: cauteloso nunca pode ligar algo que o equilibrado não ligaria; liberal só mede
let cautExtra = 0, cautMiss = 0, libExtra = 0, libMiss = 0, n = 0;
for (const f of ['treino', 'validacao1', 'validacao2', 'validacao4', 'extras', 'ingles']) {
  const mod = await import('./' + f + '.mjs');
  for (const [t, ep] of mod.default) {
    n++;
    const c = routeProfiles(t, 'cauteloso').map((r) => r.id); const l = routeProfiles(t, 'liberal').map((r) => r.id);
    cautExtra += c.filter((x) => !ep.includes(x)).length; cautMiss += ep.filter((x) => !c.includes(x)).length;
    libExtra += l.filter((x) => !ep.includes(x)).length; libMiss += ep.filter((x) => !l.includes(x)).length;
  }
}
console.log(`cauteloso: ligou a mais ${cautExtra}, faltou ${cautMiss} · liberal: ligou a mais ${libExtra}, faltou ${libMiss} (em ${n} frases)`);
if (routeProfiles('investigue a função em 0x401000 no x64dbg', 'desligado').length) { console.log('desligado ligou algo'); process.exit(1); }
process.exit(ok === total && cautExtra === 0 ? 0 : 1);
