/* Spotlfy Service Worker – macht die Seite als App installierbar (Vollbild ohne Browserleiste).
   Bewusst kein Caching von Seiten oder API-Daten: Statistiken sollen immer aktuell sein.
   Nur wenn das Netz fehlt, wird eine kleine Offline-Seite angezeigt. */
const OFFLINE_HTML = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Spotlfy – offline</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0c0b;color:#f0f2f0;
font:16px system-ui,sans-serif;text-align:center;padding:24px}p{color:#7d877f}</style></head>
<body><div><h1>Keine Verbindung</h1><p>Spotlfy braucht eine Internetverbindung. Versuche es gleich noch einmal.</p></div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return; // alles andere geht direkt ans Netz
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    ),
  );
});
