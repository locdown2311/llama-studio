// Diagnóstico NVIDIA NIM - DeepSeek
// Uso: node scripts/test-nim.mjs

const API_KEY = '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';
const BASE = 'https://integrate.api.nvidia.com';

function fetchWithTimeout(url, opts, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function test(name, url, opts = {}, timeoutMs = 15000) {
  console.log(`\n🧪 ${name}`);
  console.log(`   URL: ${url}`);
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(url, opts, timeoutMs);
    const elapsed = Date.now() - start;
    console.log(`   ⏱️  ${elapsed}ms | Status: ${res.status} ${res.statusText}`);
    const text = await res.text();
    if (text.length < 500) console.log(`   📄 ${text}`);
    else console.log(`   📄 (${text.length} bytes) ${text.slice(0, 300)}...`);
    return res.status;
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`   ❌ ${elapsed}ms | ${err.name}: ${err.message}`);
    return -1;
  }
}

async function main() {
  console.log('=== Diagnóstico NVIDIA NIM ===\n');
  
  const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'User-Agent': 'llama-studio-test/1.0',
    'Content-Type': 'application/json'
  };
  
  // Teste 1: conectividade básica (DNS/TLS)
  await test('1. HEAD na raiz', `${BASE}/`, { method: 'HEAD', headers }, 10000);
  
  // Teste 2: listar modelos
  await test('2. GET /v1/models', `${BASE}/v1/models`, { method: 'GET', headers }, 15000);
  
  // Teste 3: chat mínimo
  await test('3. Chat completions (ping)', `${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'deepseek-ai/deepseek-v4.1-flash',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
      temperature: 0,
      stream: false
    })
  }, 20000);
}

main();
