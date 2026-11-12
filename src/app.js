import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import express from 'express';
import { config } from './config.js';
import { migrate } from './db.js';
import { importHistory } from './importer.js';
import { authorizeUrl, exchangeCode } from './spotify.js';
import * as users from './users.js';
import * as stats from './stats.js';
import { startScheduler, syncAllDue, triggerSync } from './scheduler.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(compression());

// ---------------------------------------------------------------- Sicherheit

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data: https://i.scdn.co https://*.scdn.co https://*.spotifycdn.com",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self' https://accounts.spotify.com",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
  next();
});

const COOKIE = 'sd_session';
const sign = (value) => crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}

function setCookie(res, name, value, maxAgeSec) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (config.isProduction) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

// Session-Cookie: "<kontoId>.<ablauf>.<hmac>" – signiert, HttpOnly, SameSite=Lax.
function sessionAccountId(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  if (!/^\d+$/.test(id) || Number(exp) < Date.now()) return null;
  const expected = sign(`session:${id}:${exp}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return Number(id);
}

function startSession(res, accountId) {
  const exp = Date.now() + config.sessionDays * 864e5;
  setCookie(res, COOKIE, `${accountId}.${exp}.${sign(`session:${accountId}:${exp}`)}`, config.sessionDays * 86400);
}

async function requireAuth(req, res, next) {
  try {
    const id = sessionAccountId(req);
    const account = id ? await users.getAccount(id) : null;
    if (account) {
      req.account = account;
      users.touchAccount(account.id);
      return next();
    }
    if (id) setCookie(res, COOKIE, '', 0); // Konto gelöscht → Session beenden
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
      return req.path.startsWith('/api/') ? res.status(401).json({ error: 'unauthorized' }) : res.redirect('/login');
    }
    return res.redirect('/login');
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (req.account?.is_admin) return next();
  return res.status(403).json({ error: 'Nur für Admins.' });
}

// Daten-Endpunkte brauchen ein verbundenes Spotify-Konto.
function requireSpotify(req, res, next) {
  if (req.account?.spotify_user_id) {
    req.sid = req.account.spotify_user_id;
    return next();
  }
  return res.status(409).json({ error: 'Bitte verbinde zuerst dein Spotify-Konto.', code: 'NOT_CONNECTED' });
}

// Brute-Force-Bremse: max. 10 Fehlversuche pro IP bzw. Benutzername in 15 Minuten.
const attempts = new Map();
const WINDOW = 15 * 60_000;
function blocked(...keys) {
  const now = Date.now();
  return keys.some((k) => {
    const r = attempts.get(k);
    return r && now - r.since < WINDOW && r.count >= 10;
  });
}
function fail(...keys) {
  const now = Date.now();
  for (const k of keys) {
    const r = attempts.get(k);
    if (!r || now - r.since > WINDOW) attempts.set(k, { since: now, count: 1 });
    else r.count++;
  }
  if (attempts.size > 10_000) attempts.clear();
}

// ---------------------------------------------------------------- Öffentliche Routen

app.get('/healthz', (_req, res) => res.json({ ok: true }));
// Eigene JS/CSS-Dateien: Browser fragt bei jedem Laden per ETag nach, ob es eine neue Version gibt
// (verhindert, dass nach einem Update veraltete Skripte aus dem Cache laufen).
const revalidate = { maxAge: 0, setHeaders: (res) => res.set('Cache-Control', 'no-cache') };
app.use('/assets', express.static(path.join(publicDir, 'assets'), revalidate));
app.get('/vendor/chart.umd.min.js', (_req, res) =>
  res.sendFile(path.join(root, 'node_modules/chart.js/dist/chart.umd.min.js'), { maxAge: '7d' }),
);
app.use('/vendor/fonts', express.static(path.join(root, 'node_modules/@fontsource-variable/inter/files'), { maxAge: '30d' }));

// Optional: externer Trigger (z. B. cron-job.org), falls der interne Zeitplan nicht reicht.
// Aufruf: GET /cron/run?key=<CRON_SECRET>
app.get('/cron/run', async (req, res) => {
  const key = String(req.query.key || req.get('x-cron-key') || '');
  const ok =
    config.cronSecret &&
    key.length === config.cronSecret.length &&
    crypto.timingSafeEqual(Buffer.from(key), Buffer.from(config.cronSecret));
  if (!ok) return res.status(404).end();
  try {
    res.json(await syncAllDue());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/login', (req, res) => {
  if (sessionAccountId(req)) return res.redirect('/');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'login.html'));
});

app.get('/api/auth/config', (_req, res) => res.json({ allowRegistration: config.allowRegistration }));

app.post(
  '/api/auth/login',
  express.json({ limit: '5kb' }),
  async (req, res, next) => {
    try {
      const username = String(req.body?.username || '').trim();
      const keys = [`ip:${req.ip}`, `u:${username.toLowerCase()}`];
      if (blocked(...keys)) {
        return res.status(429).json({ error: 'Zu viele Fehlversuche – bitte in 15 Minuten erneut versuchen.' });
      }
      const account = await users.authenticate(username, req.body?.password);
      if (!account) {
        fail(...keys);
        return res.status(401).json({ error: 'Benutzername oder Passwort ist falsch.' });
      }
      await users.recordLogin(account.id, req.get('user-agent'));
      startSession(res, account.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

app.post(
  '/api/auth/register',
  express.json({ limit: '5kb' }),
  async (req, res, next) => {
    try {
      if (blocked(`reg:${req.ip}`)) {
        return res.status(429).json({ error: 'Zu viele Registrierungen – bitte später erneut versuchen.' });
      }
      const account = await users.registerAccount(req.body?.username, req.body?.password);
      fail(`reg:${req.ip}`); // zählt Registrierungen pro IP (max. 10 / 15 Min.)
      await users.recordLogin(account.id, req.get('user-agent'));
      startSession(res, account.id);
      res.status(201).json({ ok: true, isAdmin: account.is_admin });
    } catch (err) {
      if (err instanceof users.UserError) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  },
);

app.post('/logout', (_req, res) => {
  setCookie(res, COOKIE, '', 0);
  res.redirect('/login');
});

// ---------------------------------------------------------------- Geschützter Bereich

app.use(requireAuth);

app.get('/', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'index.html'));
});
app.use(express.static(publicDir, { index: false, ...revalidate }));

// Spotify verbinden (nur für eingeloggte Spotlfy-Konten)
app.get('/auth/login', (_req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, 'sd_oauth_state', state, 600);
  res.redirect(authorizeUrl(state));
});

app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expected = parseCookies(req).sd_oauth_state;
  setCookie(res, 'sd_oauth_state', '', 0);
  if (error) return res.redirect(`/?spotify_error=${encodeURIComponent(error)}`);
  if (!code || !state || state !== expected) return res.redirect('/?spotify_error=state_mismatch');
  try {
    const result = await exchangeCode(String(code));
    const { spotifyUserId } = await users.connectSpotify(req.account.id, result);
    // Erster Sync im Hintergrund (inkl. Top-Snapshot), damit das Dashboard sofort Daten hat.
    triggerSync(spotifyUserId, { forceSnapshot: true }).catch((err) => console.error('[sync]', spotifyUserId, err.message));
    res.redirect('/?connected=1');
  } catch (err) {
    console.error('[oauth]', err.message);
    const code = err instanceof users.UserError ? 'already_linked' : err.spotifyError || 'token_exchange_failed';
    res.redirect(`/?spotify_error=${encodeURIComponent(code)}`);
  }
});

const api = express.Router();
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    if (err instanceof users.UserError) return res.status(err.status).json({ error: err.message });
    console.error('[api]', req.path, err);
    res.status(err.code === 'AUTH_EXPIRED' ? 409 : 500).json({ error: err.message, code: err.code });
  });
const rangeDays = (req) => stats.RANGE_DAYS[req.query.range] ?? 30;

api.get(
  '/status',
  wrap(async (req, res) => {
    const a = req.account;
    const base = {
      account: { id: a.id, username: a.username, is_admin: a.is_admin },
      spotify: a.spotify_user_id
        ? {
            id: a.spotify_user_id,
            display_name: a.display_name,
            email: a.email,
            avatar_url: a.avatar_url,
            auth_expired: Boolean(a.auth_error),
          }
        : null,
    };
    if (!a.spotify_user_id) return res.json(base);
    const s = await stats.status(a.spotify_user_id);
    res.json({ ...base, counts: s.counts, jobs: s.jobs, snapshots: s.snapshots });
  }),
);

// Eigenes Passwort ändern
api.post(
  '/me/password',
  express.json({ limit: '5kb' }),
  wrap(async (req, res) => {
    await users.changePassword(req.account.id, req.body?.current, req.body?.next);
    res.json({ ok: true });
  }),
);

// Spotify-Verbindung lösen
api.post(
  '/me/disconnect',
  wrap(async (req, res) => {
    await users.disconnectSpotify(req.account.id);
    res.json({ ok: true });
  }),
);

// Eigenes Konto inkl. aller Hördaten löschen
api.delete(
  '/me',
  wrap(async (req, res) => {
    await users.deleteAccount(req.account.id);
    setCookie(res, COOKIE, '', 0);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- Admin
const admin = express.Router();
admin.use(requireAdmin);

admin.get('/accounts', wrap(async (_req, res) => res.json(await users.adminOverview())));
admin.get('/system', wrap(async (_req, res) => res.json(await users.adminSystem())));

admin.get(
  '/accounts.csv',
  wrap(async (_req, res) => {
    const date = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="spotlfy-konten-${date}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.send(await users.accountsCsv());
  }),
);

const accountParam = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new users.UserError('Ungültige Konto-ID.');
  return id;
};

admin.post(
  '/accounts/:id/sync',
  wrap(async (req, res) => {
    const acc = await users.getAccount(accountParam(req));
    if (!acc?.spotify_user_id) throw new users.UserError('Dieses Konto hat kein Spotify verbunden.');
    res.json(await triggerSync(acc.spotify_user_id));
  }),
);

admin.post(
  '/accounts/:id/admin',
  express.json({ limit: '1kb' }),
  wrap(async (req, res) => {
    await users.setAdmin(accountParam(req), Boolean(req.body?.admin));
    res.json({ ok: true });
  }),
);

admin.post(
  '/accounts/:id/reset-password',
  wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await users.resetPassword(accountParam(req)));
  }),
);

admin.delete(
  '/accounts/:id',
  wrap(async (req, res) => {
    const id = accountParam(req);
    if (id === req.account.id) throw new users.UserError('Dein eigenes Konto löschst du unten im Dashboard.');
    await users.deleteAccount(id);
    res.json({ ok: true });
  }),
);

api.use('/admin', admin);

// ---------------------------------------------------------------- Statistik (braucht Spotify)
api.use(requireSpotify);

api.get(
  '/dashboard',
  wrap(async (req, res) => {
    const uid = req.sid;
    const days = rangeDays(req);
    const [overview, timeline, topArtists, topTracks, heatmap, genres, recent] = await Promise.all([
      stats.overview(uid, days),
      stats.timeline(uid, days),
      stats.topArtists(uid, days),
      stats.topTracks(uid, days),
      stats.heatmap(uid, days),
      stats.genres(uid, days),
      stats.recentPlays(uid, 40),
    ]);
    res.json({ range: req.query.range || '30d', overview, timeline, topArtists, topTracks, heatmap, genres, recent });
  }),
);

api.get(
  '/trends',
  wrap(async (req, res) => res.json({ monthly: await stats.monthly(req.sid) })),
);

api.get(
  '/spotify-top',
  wrap(async (req, res) => {
    const kind = req.query.kind === 'tracks' ? 'tracks' : 'artists';
    const range = ['short_term', 'medium_term', 'long_term'].includes(req.query.range) ? req.query.range : 'short_term';
    res.json(await stats.spotifyTop(req.sid, kind, range));
  }),
);

api.post(
  '/sync',
  wrap(async (req, res) => res.json(await triggerSync(req.sid))),
);

api.post(
  '/import',
  express.json({ limit: '80mb' }),
  wrap(async (req, res) => {
    if (!Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Erwartet wird der Inhalt einer Streaming_History_Audio_*.json (JSON-Array).' });
    }
    res.json(await importHistory(req.sid, req.body));
  }),
);

app.use('/api', api);

// ---------------------------------------------------------------- Start

await migrate();
app.listen(config.port, () => {
  console.log(`Spotlfy läuft auf Port ${config.port} (Redirect URI: ${config.spotify.redirectUri})`);
  startScheduler();
});
