// Confere a razão de tokens por caractere: a medida que o servidor devolve, guardada em conv.tokR,
// devolvida ao estimador tem de reproduzir o número medido. Se alguém mudar um lado da conta e não o
// outro, a razão fica calada e errada — é isso que este teste pega.
// Uso: node tests/tokens/run.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const js = path.join(dir, '../../ui/js');
const read = (f) => fs.readFileSync(path.join(js, f), 'utf8');

const src = read('06-modelo.js');
const a = src.indexOf('const TOK_R = 1 / 3.2;');
const b = src.indexOf('\n', src.indexOf('const tokR = (conv) =>'));
const tokSrc = src.slice(a, b);

const ag = read('07-agente.js');
const c = ag.indexOf('function estimateTokens(');
const estSrc = ag.slice(c, ag.indexOf('\n}', c) + 2);

let bad = 0;
const chk = (name, got, exp, tol = 1e-9) => {
  if (!(Math.abs(got - exp) <= tol)) { bad++; console.log(`FALHOU ${name}: ${got} (esperado ${exp})`); }
};

// o mesmo apiMessages do app, reduzido ao que o estimador olha
const apiMessages = (conv, system) => {
  const out = system ? [{ role: 'system', content: system }] : [];
  for (const m of conv.messages) out.push({ role: m.role, content: m.content });
  return out;
};
const { tokR, estimateTokens } = new Function('apiMessages', tokSrc + '\n' + estSrc + '\nreturn { tokR, estimateTokens };')(apiMessages);

// banda: dentro usa a medida, fora volta ao palpite (uma amostra ruim não pode envenenar a conta)
chk('sem medida usa 1/3.2', tokR({}), 1 / 3.2);
chk('aceita 0,42', tokR({ tokR: 0.42 }), 0.42);
chk('recusa 0,05 (abaixo da banda)', tokR({ tokR: 0.05 }), 1 / 3.2);
chk('recusa 1,5 (acima da banda)', tokR({ tokR: 1.5 }), 1 / 3.2);
chk('conversa nula', tokR(null), 1 / 3.2);

// ida e volta: o servidor mediu `sent` tokens para `chars` caracteres enviados; com essa razão o
// estimador tem de chegar no mesmo `sent`
const conv = { messages: [{ role: 'user', content: 'x'.repeat(3000) }, { role: 'assistant', content: 'y'.repeat(2000) }] };
const tools = [{ type: 'function', function: { name: 'read_file', description: 'lê um arquivo', parameters: {} } }];
const system = 'instruções do studio '.repeat(50);
const chars = JSON.stringify(apiMessages(conv, system)).length + JSON.stringify(tools).length;
const sent = 1200;
conv.tokR = sent / chars;
chk('ida e volta (medido -> estimado)', estimateTokens(conv, system, tools), sent, 1);

// código tokeniza mais denso que o palpite: a medida tem de mexer no resultado
const comMedida = estimateTokens(conv, system, tools);
delete conv.tokR;
const semMedida = estimateTokens(conv, system, tools);
if (!(comMedida < semMedida)) { bad++; console.log(`FALHOU a medida não mudou nada: ${comMedida} vs ${semMedida}`); }

// a resposta (predicted_n) não está no texto enviado: não pode entrar na razão
if (/conv\.tokR\s*=[^\n]*predicted_n/.test(read('04-envio.js'))) { bad++; console.log('FALHOU a razão inclui a resposta (predicted_n)'); }

console.log(bad ? `${bad} problema(s) na razão de tokens.` : 'Razão de tokens: ok.');
process.exit(bad ? 1 : 0);
