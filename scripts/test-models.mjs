// Teste comparativo NVIDIA NIM
// Uso: node scripts/test-models.mjs

const API_KEY = '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';
const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

const models = [
  'deepseek-ai/deepseek-v4.1-flash',
  'google/gemma-4-31b-it'
];

function fetchWithTimeout(url, opts, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function testModel(model) {
  console.log(`\n🧪 ${model}`);
  const start = Date.now();
  
  // stream=true para ver se responde mais rápido
  try {
    const res = await fetchWithTimeout(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 20,
        temperature: 0,
        stream: true
      })
    }, 20000);
    
    const elapsed = Date.now() - start;
    if (res.ok) {
      const reader = res.body.getReader();
      const { value } = await reader.read();
      const chunk = new TextDecoder().decode(value);
      reader.cancel();
      console.log(`   ✅ ${elapsed}ms | ${chunk.slice(0, 200).replace(/\n/g, ' ')}`);
    } else {
      const text = await res.text();
      console.log(`   ❌ ${elapsed}ms | HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`   ❌ ${elapsed}ms | ${err.name}: ${err.message}`);
  }
}

console.log('=== Teste NVIDIA NIM (stream=true, timeout 20s) ===');
for (const model of models) {
  await testModel(model);
}
