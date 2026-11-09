// Teste DeepSeek com parâmetros do exemplo original
// Uso: node scripts/test-deepseek.mjs

const API_KEY = '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';
const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

console.log('=== Teste DeepSeek V4.1 Flash ===\n');

// Teste 1: parâmetros exatos do exemplo (stream: false, max_tokens: 262144)
console.log('🧪 Teste 1: stream=false, max_tokens=262144');
let start = Date.now();
try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'deepseek-ai/deepseek-v4.1-flash',
      max_tokens: 262144,
      stream: false,
      temperature: 1,
      top_p: 0.95,
      messages: [{ role: 'user', content: 'boa tarde' }]
    }),
    signal: controller.signal
  });
  
  clearTimeout(timer);
  const elapsed = Date.now() - start;
  
  if (res.ok) {
    const data = await res.json();
    console.log(`   ✅ ${elapsed}ms`);
    console.log(`   Response: ${data.choices?.[0]?.message?.content?.slice(0, 100)}`);
  } else {
    const text = await res.text();
    console.log(`   ❌ ${elapsed}ms | HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
} catch (err) {
  console.log(`   ❌ ${Date.now() - start}ms | ${err.name}: ${err.message}`);
}

// Teste 2: stream=true (pode responder mais rápido com primeiro chunk)
console.log('\n🧪 Teste 2: stream=true, max_tokens=100');
start = Date.now();
try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'deepseek-ai/deepseek-v4.1-flash',
      max_tokens: 100,
      stream: true,
      temperature: 0,
      messages: [{ role: 'user', content: 'ping' }]
    }),
    signal: controller.signal
  });
  
  clearTimeout(timer);
  const elapsed = Date.now() - start;
  
  if (res.ok) {
    console.log(`   ✅ ${elapsed}ms (primeiro chunk)`);
    const reader = res.body.getReader();
    const { value } = await reader.read();
    console.log(`   First chunk: ${new TextDecoder().decode(value).slice(0, 200)}`);
    reader.cancel();
  } else {
    const text = await res.text();
    console.log(`   ❌ ${elapsed}ms | HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
} catch (err) {
  console.log(`   ❌ ${Date.now() - start}ms | ${err.name}: ${err.message}`);
}
