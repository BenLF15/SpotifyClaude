import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import express from 'express';
import { config } from './config.js';
import { migrate } from './db.js';
import { importHistory } from './importer.js';
import { authorizeUrl, exchangeCode } from './spotify.js';
import * as stats from './stats.js';
import { startScheduler, triggerSync } from './scheduler.js';

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

function isAuthed(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = sign(`session:${exp}`);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  return res.redirect('/login');
}

const passwordMatches = (input) => {
  const a = crypto.createHash('sha256').update(String(input ?? '')).digest();
  const b = crypto.createHash('sha256').update(config.appPassword).digest();
  return crypto.timingSafeEqual(a, b);
};

// Einfache Brute-Force-Bremse: max. 10 Fehlversuche pro IP in 15 Minuten.
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.since > 15 * 60_000) return false;
  return rec.count >= 10;
}
function recordFailure(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.since > 15 * 60_000) attempts.set(ip, { since: now, count: 1 });
  else rec.count++;
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
    res.json(await triggerSync());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/login', (req, res) => {
  if (isAuthed(req)) return res.redirect('/');
  res.sendFile(path.join(publicDir, 'login.html'));
});

app.post('/login', express.urlencoded({ extended: false, limit: '10kb' }), (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) return res.redirect('/login?error=locked');
  if (!passwordMatches(req.body?.password)) {
    recordFailure(ip);
    return res.redirect('/login?error=1');
  }
  attempts.delete(ip);
  const exp = Date.now() + config.sessionDays * 864e5;
  setCookie(res, COOKIE, `${exp}.${sign(`session:${exp}`)}`, config.sessionDays * 86400);
  res.redirect('/');
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

// Spotify OAuth – nur für eingeloggte Nutzer, damit niemand Fremdes sein Konto verknüpft.
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
    await exchangeCode(String(code));
    triggerSync({ forceSnapshot: true }).catch(() => {});
    res.redirect('/?connected=1');
  } catch (err) {
    console.error('[oauth]', err.message);
    res.redirect(`/?spotify_error=${encodeURIComponent(err.spotifyError || 'token_exchange_failed')}`);
  }
});

const api = express.Router();
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error('[api]', req.path, err);
    res.status(err.code === 'NOT_CONNECTED' ? 409 : 500).json({ error: err.message });
  });
const rangeDays = (req) => stats.RANGE_DAYS[req.query.range] ?? 30;

api.get('/status', wrap(async (_req, res) => res.json(await stats.status())));

api.get(
  '/dashboard',
  wrap(async (req, res) => {
    const days = rangeDays(req);
    const [overview, timeline, topArtists, topTracks, heatmap, genres, recent] = await Promise.all([
      stats.overview(days),
      stats.timeline(days),
      stats.topArtists(days),
      stats.topTracks(days),
      stats.heatmap(days),
      stats.genres(days),
      stats.recentPlays(12),
    ]);
    res.json({ range: req.query.range || '30d', overview, timeline, topArtists, topTracks, heatmap, genres, recent });
  }),
);

api.get('/trends', wrap(async (_req, res) => res.json({ monthly: await stats.monthly() })));

api.get(
  '/spotify-top',
  wrap(async (req, res) => {
    const kind = req.query.kind === 'tracks' ? 'tracks' : 'artists';
    const range = ['short_term', 'medium_term', 'long_term'].includes(req.query.range) ? req.query.range : 'short_term';
    res.json(await stats.spotifyTop(kind, range));
  }),
);

api.post(
  '/sync',
  wrap(async (_req, res) => res.json(await triggerSync({ forceSnapshot: false }))),
);

api.post(
  '/import',
  express.json({ limit: '80mb' }),
  wrap(async (req, res) => {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Erwartet wird der Inhalt einer Streaming_History_Audio_*.json (JSON-Array).' });
    res.json(await importHistory(req.body));
  }),
);

app.use('/api', api);

// ---------------------------------------------------------------- Start

await migrate();
app.listen(config.port, () => {
  console.log(`Spotify-Dashboard läuft auf Port ${config.port} (Redirect URI: ${config.spotify.redirectUri})`);
  startScheduler();
});
