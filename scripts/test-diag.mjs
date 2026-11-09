// Teste diagnóstico NVIDIA NIM - stream vs non-stream
// Uso: node scripts/test-diag.mjs

const API_KEY = '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';
const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

async function testWithTimeout(model, stream, timeoutMs = 15000) {
  const label = `${model} (stream=${stream})`;
  console.log(`\n🧪 ${label}`);
  const start = Date.now();
  
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 10,
        temperature: 0,
        stream
      }),
      signal: controller.signal
    });
    
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    
    if (stream) {
      const reader = res.body.getReader();
      const { value } = await reader.read();
      reader.cancel();
      console.log(`   ✅ ${elapsed}ms | Chunk: ${new TextDecoder().decode(value).slice(0, 150)}`);
    } else {
      const text = await res.text();
      console.log(`   ✅ ${elapsed}ms | HTTP ${res.status} | ${text.slice(0, 200)}`);
    }
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    console.log(`   ❌ ${elapsed}ms | ${err.name}`);
  }
}

console.log('=== Diagnóstico stream vs non-stream ===');
await testWithTimeout('google/gemma-4-31b-it', false);
await testWithTimeout('google/gemma-4-31b-it', true);
