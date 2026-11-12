// Einstiegspunkt (npm start).
// Fehlen Umgebungsvariablen oder ist die Datenbank nicht erreichbar, startet statt eines
// Absturzes eine Setup-Seite, die genau sagt, was noch zu tun ist.
import http from 'node:http';
import { config, missingEnv } from './config.js';

const HINTS = {
  DATABASE_URL: 'Render → deine Postgres-Datenbank → „Internal Database URL“ kopieren',
  SPOTIFY_CLIENT_ID: 'developer.spotify.com/dashboard → deine App → Settings',
  SPOTIFY_CLIENT_SECRET: 'developer.spotify.com/dashboard → deine App → Settings → „View client secret“',
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function startSetupServer({ missing = [], error = null }) {
  const rows = missing
    .map((n) => `<li><code>${n}</code><span>${esc(HINTS[n] || '')}</span></li>`)
    .join('');
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Einrichtung · Spotlfy</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:#0a0c0b;color:#f0f2f0;font:15px/1.55 system-ui,sans-serif}
main{width:min(640px,100%);background:#141916;border:1px solid #ffffff14;border-radius:20px;padding:28px}
h1{margin:0 0 6px;font-size:1.4rem}p{color:#b4bcb6}ul{list-style:none;padding:0;display:flex;flex-direction:column;gap:10px}
li{display:flex;flex-direction:column;gap:2px;background:#1c221e;border-radius:12px;padding:12px 14px}li span{color:#7d877f;font-size:.85rem}
code{color:#1ed760;font-weight:600}.err{background:#2a1515;border:1px solid #e6676755;border-radius:12px;padding:12px 14px;color:#f3b3b3;white-space:pre-wrap;word-break:break-word}
</style></head><body><main>
<h1>Fast geschafft – Einrichtung unvollständig</h1>
${missing.length ? `<p>Trage in Render unter <strong>Environment</strong> diese Variablen ein und speichere (der Service startet dann neu):</p><ul>${rows}</ul>` : ''}
${error ? `<p>Beim Start ist ein Fehler aufgetreten:</p><div class="err">${esc(error)}</div>` : ''}
<p>Redirect URI für die Spotify-App:<br><code>${esc(config.spotify.redirectUri)}</code></p>
</main></body></html>`;
  http
    .createServer((req, res) => {
      if (req.url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"ok":true,"setup":true}');
      }
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    })
    .listen(config.port, () => console.log(`[setup] Setup-Seite auf Port ${config.port}`));
}

const missing = missingEnv();
if (missing.length) {
  console.error(`[setup] Fehlende Umgebungsvariablen: ${missing.join(', ')}`);
  startSetupServer({ missing });
} else {
  try {
    await import('./app.js');
  } catch (err) {
    console.error('[setup] Start fehlgeschlagen:', err);
    // AggregateError (mehrere fehlgeschlagene Verbindungsversuche) hat keine eigene Message.
    const parts = Array.isArray(err.errors) && err.errors.length ? err.errors : [err];
    let msg = [...new Set(parts.map((e) => [e.code, e.message].filter(Boolean).join(': ') || String(e)))].join('\n');
    let dbHost = '';
    try {
      const u = new URL(process.env.DATABASE_URL);
      dbHost = `${u.hostname}${u.port ? `:${u.port}` : ''}`;
      msg += `\n\nDATABASE_URL zeigt auf Host: ${dbHost}`;
    } catch {
      msg += '\n\nDATABASE_URL ist keine gültige URL (erwartet: postgresql://user:passwort@host/datenbank).';
    }
    if (/^(localhost|127\.|::1)/.test(dbHost)) {
      msg += '\nDas ist „localhost“ – auf Render gibt es dort keine Datenbank. Trage die „Internal Database URL“ deiner Render-Postgres ein.';
    }
    if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|password authentication|does not exist|timeout|ETIMEDOUT/i.test(msg)) {
      msg += '\n\nDie Datenbank ist nicht erreichbar. Prüfe DATABASE_URL (in Render die „Internal Database URL“ verwenden, Datenbank und Web Service in derselben Region).';
    }
    startSetupServer({ error: msg });
  }
}
