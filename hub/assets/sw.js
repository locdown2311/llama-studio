// Service worker do app: sem cache (o studio é sempre o da hora, PC ou nuvem); recebe as notificações.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Llama Studio', {
    body: d.body || '', icon: '/hub/icon-192.png', badge: '/hub/icon-192.png', data: { url: d.url || '/' }, tag: d.url || 'studio',
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (new URL(c.url).origin === self.location.origin) { await c.focus(); c.navigate(url).catch(() => {}); return; } }
    await self.clients.openWindow(url);
  })());
});
