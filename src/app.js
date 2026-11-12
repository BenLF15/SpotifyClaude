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

// Session-Cookie: "<userId>.<ablauf>.<hmac>" – signiert, HttpOnly, SameSite=Lax.
function sessionUserId(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [uid64, exp, sig] = parts;
  if (Number(exp) < Date.now()) return null;
  const expected = sign(`session:${uid64}:${exp}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return Buffer.from(uid64, 'base64url').toString('utf8');
}

function startSession(res, userId) {
  const exp = Date.now() + config.sessionDays * 864e5;
  const uid64 = Buffer.from(userId, 'utf8').toString('base64url');
  setCookie(res, COOKIE, `${uid64}.${exp}.${sign(`session:${uid64}:${exp}`)}`, config.sessionDays * 86400);
}

async function requireAuth(req, res, next) {
  try {
    const id = sessionUserId(req);
    const user = id ? await users.getUser(id) : null;
    if (user) {
      req.user = user;
      users.touchUser(user.id);
      return next();
    }
    if (id) setCookie(res, COOKIE, '', 0); // Konto gelöscht → Session beenden
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
    return res.redirect('/login');
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.is_admin) return next();
  return res.status(403).json({ error: 'Nur für Admins.' });
}

// ---------------------------------------------------------------- Öffentliche Routen

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use('/assets', express.static(path.join(publicDir, 'assets'), { maxAge: '1h' }));
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
  if (sessionUserId(req)) return res.redirect('/');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'login.html'));
});

// Anmeldung = Spotify-Login (Authorization Code Flow)
app.get('/auth/login', (_req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, 'sd_oauth_state', state, 600);
  res.redirect(authorizeUrl(state));
});

app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expected = parseCookies(req).sd_oauth_state;
  setCookie(res, 'sd_oauth_state', '', 0);
  if (error) return res.redirect(`/login?error=${encodeURIComponent(error)}`);
  if (!code || !state || state !== expected) return res.redirect('/login?error=state_mismatch');
  try {
    const result = await exchangeCode(String(code));
    const user = await users.upsertUserFromLogin(result, { userAgent: req.get('user-agent') });
    startSession(res, user.id);
    // Erster Sync im Hintergrund (inkl. Top-Snapshot), damit das Dashboard sofort Daten hat.
    triggerSync(user.id, { forceSnapshot: true }).catch((err) => console.error('[sync]', user.id, err.message));
    res.redirect(user.created ? '/?welcome=1' : '/');
  } catch (err) {
    console.error('[oauth]', err.message);
    res.redirect(`/login?error=${encodeURIComponent(err.spotifyError || 'token_exchange_failed')}`);
  }
});

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
app.use(express.static(publicDir, { index: false, maxAge: '1h' }));

const api = express.Router();
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error('[api]', req.path, err);
    res.status(err.code === 'AUTH_EXPIRED' ? 409 : 500).json({ error: err.message, code: err.code });
  });
const rangeDays = (req) => stats.RANGE_DAYS[req.query.range] ?? 30;

api.get(
  '/status',
  wrap(async (req, res) => {
    const s = await stats.status(req.user.id);
    // is_admin inkl. ADMIN_SPOTIFY_IDS (siehe users.getUser)
    res.json({ ...s, user: s.user && { ...s.user, is_admin: req.user.is_admin } });
  }),
);

api.get(
  '/dashboard',
  wrap(async (req, res) => {
    const uid = req.user.id;
    const days = rangeDays(req);
    const [overview, timeline, topArtists, topTracks, heatmap, genres, recent] = await Promise.all([
      stats.overview(uid, days),
      stats.timeline(uid, days),
      stats.topArtists(uid, days),
      stats.topTracks(uid, days),
      stats.heatmap(uid, days),
      stats.genres(uid, days),
      stats.recentPlays(uid, 12),
    ]);
    res.json({ range: req.query.range || '30d', overview, timeline, topArtists, topTracks, heatmap, genres, recent });
  }),
);

api.get(
  '/trends',
  wrap(async (req, res) => res.json({ monthly: await stats.monthly(req.user.id) })),
);

api.get(
  '/spotify-top',
  wrap(async (req, res) => {
    const kind = req.query.kind === 'tracks' ? 'tracks' : 'artists';
    const range = ['short_term', 'medium_term', 'long_term'].includes(req.query.range) ? req.query.range : 'short_term';
    res.json(await stats.spotifyTop(req.user.id, kind, range));
  }),
);

api.post(
  '/sync',
  wrap(async (req, res) => res.json(await triggerSync(req.user.id))),
);

api.post(
  '/import',
  express.json({ limit: '80mb' }),
  wrap(async (req, res) => {
    if (!Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Erwartet wird der Inhalt einer Streaming_History_Audio_*.json (JSON-Array).' });
    }
    res.json(await importHistory(req.user.id, req.body));
  }),
);

// Eigenes Konto inkl. aller Hördaten löschen
api.delete(
  '/me',
  wrap(async (req, res) => {
    await users.deleteUser(req.user.id);
    setCookie(res, COOKIE, '', 0);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- Admin
const admin = express.Router();
admin.use(requireAdmin);

admin.get('/users', wrap(async (_req, res) => res.json(await users.adminOverview())));
admin.get('/system', wrap(async (_req, res) => res.json(await users.adminSystem())));

admin.get(
  '/users.csv',
  wrap(async (_req, res) => {
    const date = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="spotlfy-nutzer-${date}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.send(await users.usersCsv());
  }),
);

// Sync für einen Nutzer sofort starten
admin.post(
  '/users/:id/sync',
  wrap(async (req, res) => res.json(await triggerSync(req.params.id, { forceSnapshot: req.query.snapshot === '1' }))),
);

// Admin-Rechte geben/entziehen
admin.post(
  '/users/:id/admin',
  express.json({ limit: '1kb' }),
  wrap(async (req, res) => {
    try {
      await users.setAdmin(req.params.id, Boolean(req.body?.admin));
      res.json({ ok: true });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  }),
);

// Nutzer samt Daten löschen (das eigene Konto geht über DELETE /api/me)
admin.delete(
  '/users/:id',
  wrap(async (req, res) => {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Dein eigenes Konto löschst du unten im Dashboard.' });
    await users.deleteUser(req.params.id);
    res.json({ ok: true });
  }),
);

api.use('/admin', admin);

app.use('/api', api);

// ---------------------------------------------------------------- Start

await migrate();
app.listen(config.port, () => {
  console.log(`Spotify-Dashboard läuft auf Port ${config.port} (Redirect URI: ${config.spotify.redirectUri})`);
  startScheduler();
});
