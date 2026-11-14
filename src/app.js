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
import * as features from './features.js';
import { lastBackup, restoreBackup, streamBackup } from './backup.js';
import * as records from './records.js';
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
  return res.status(403).json({ error: 'Nur für Admins.', key: 'adminOnly' });
}

// Daten-Endpunkte brauchen ein verbundenes Spotify-Konto.
function requireSpotify(req, res, next) {
  if (req.account?.spotify_user_id) {
    req.sid = req.account.spotify_user_id;
    return next();
  }
  return res.status(409).json({ error: 'Bitte verbinde zuerst dein Spotify-Konto.', code: 'NOT_CONNECTED', key: 'notConnected' });
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
// Service Worker muss öffentlich und unter "/" liegen, damit er die ganze App steuert (Installierbarkeit).
app.get('/sw.js', (_req, res) => {
  res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
  res.sendFile(path.join(publicDir, 'sw.js'));
});
// Eigene JS/CSS-Dateien: Browser fragt bei jedem Laden per ETag nach, ob es eine neue Version gibt
// (verhindert, dass nach einem Update veraltete Skripte aus dem Cache laufen).
const revalidate = { maxAge: 0, setHeaders: (res) => res.set('Cache-Control', 'no-cache') };
app.use('/assets', express.static(path.join(publicDir, 'assets'), revalidate));
app.get('/vendor/chart.umd.min.js', (_req, res) =>
  res.sendFile(path.join(root, 'node_modules/chart.js/dist/chart.umd.min.js'), { maxAge: '7d' }),
);
app.use('/vendor/fonts', express.static(path.join(root, 'node_modules/@fontsource-variable/inter/files'), { maxAge: '30d' }));
// Handschrift-Schriften für die Autogramme auf legendären Platten und CDs
const SIGN_FONTS = {
  'permanent-marker.woff2': '@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff2',
  'rock-salt.woff2': '@fontsource/rock-salt/files/rock-salt-latin-400-normal.woff2',
  'mrs-saint-delafield.woff2': '@fontsource/mrs-saint-delafield/files/mrs-saint-delafield-latin-400-normal.woff2',
  'homemade-apple.woff2': '@fontsource/homemade-apple/files/homemade-apple-latin-400-normal.woff2',
  'caveat.woff2': '@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2',
  'caveat-ext.woff2': '@fontsource-variable/caveat/files/caveat-latin-ext-wght-normal.woff2',
};
app.get('/vendor/sign/:file', (req, res) => {
  const rel = SIGN_FONTS[req.params.file];
  if (!rel) return res.status(404).end();
  res.sendFile(path.join(root, 'node_modules', rel), { maxAge: '30d' });
});

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

// Datenschutz: öffentlich erreichbar (auch ohne Login)
app.get('/datenschutz', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(publicDir, 'legal.html'));
});
app.get('/api/legal', (_req, res) => {
  const L = config.legal;
  const host = (() => { try { return new URL(config.databaseUrl).hostname; } catch { return ''; } })();
  const database = L.database
    || (/neon\.tech$/.test(host) ? 'Neon (Databricks, Inc.), USA'
      : /render\.com$/.test(host) ? 'Render Services, Inc., USA'
      : null);
  res.json({
    name: L.name || null,
    address: L.address ? L.address.split(/\s*(?:\||\\n|\n)\s*/).filter(Boolean) : [],
    email: L.email || null,
    phone: L.phone || null,
    hosting: L.hosting,
    database,
    configured: Boolean(L.name && L.address && L.email),
  });
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
        return res.status(429).json({ error: 'Zu viele Fehlversuche – bitte in 15 Minuten erneut versuchen.', key: 'tooMany' });
      }
      const account = await users.authenticate(username, req.body?.password);
      if (!account) {
        fail(...keys);
        return res.status(401).json({ error: 'Benutzername oder Passwort ist falsch.', key: 'badCredentials' });
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
        return res.status(429).json({ error: 'Zu viele Registrierungen – bitte später erneut versuchen.', key: 'tooManyRegs' });
      }
      const account = await users.registerAccount(req.body?.username, req.body?.password, { privacy: req.body?.privacy === true });
      if (users.LANGS.includes(req.body?.lang)) await users.updateSettings(account.id, { lang: req.body.lang });
      fail(`reg:${req.ip}`); // zählt Registrierungen pro IP (max. 10 / 15 Min.)
      await users.recordLogin(account.id, req.get('user-agent'));
      startSession(res, account.id);
      res.status(201).json({ ok: true, isAdmin: account.is_admin });
    } catch (err) {
      if (err instanceof users.UserError) return res.status(err.status).json({ error: err.message, key: err.key });
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
    if (err instanceof users.UserError) return res.status(err.status).json({ error: err.message, key: err.key });
    console.error('[api]', req.path, err);
    res.status(err.code === 'AUTH_EXPIRED' ? 409 : 500).json({ error: err.message, code: err.code });
  });
const rangeDays = (req) => stats.RANGE_DAYS[req.query.range] ?? 30;

api.get(
  '/status',
  wrap(async (req, res) => {
    const a = req.account;
    const base = {
      account: {
        id: a.id, username: a.username, is_admin: a.is_admin, created_at: a.created_at,
        theme: a.theme, lang: a.lang, festive: a.festive, birthday: a.birthday,
        privacy_accepted: Boolean(a.privacy_accepted_at),
      },
      spotify: a.spotify_user_id
        ? {
            id: a.spotify_user_id,
            display_name: a.display_name,
            email: a.email,
            avatar_url: a.avatar_url,
            country: a.country,
            product: a.product,
            auth_expired: Boolean(a.auth_error),
            missing_scopes: a.spotify_user_id ? features.missingScopesFor(a.scope) : [],
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

// Darstellung (Hell/Dunkel/System/Jahreszeit) speichern
api.post(
  '/me/settings',
  express.json({ limit: '2kb' }),
  wrap(async (req, res) => {
    const { theme, lang, festive, birthday } = req.body || {};
    await users.updateSettings(req.account.id, { theme, lang, festive, birthday });
    res.json({ ok: true });
  }),
);

// Datenschutzerklärung bestätigen (bestehende Konten)
api.post(
  '/me/privacy',
  wrap(async (req, res) => {
    await users.acceptPrivacy(req.account.id);
    res.json({ ok: true });
  }),
);

// Eigene Daten exportieren (DSGVO Art. 15/20)
api.get(
  '/me/export',
  wrap(async (req, res) => {
    const date = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="spotlfy-export-${date}.json"`,
      'Cache-Control': 'no-store',
    });
    res.send(JSON.stringify(await features.exportData(req.account.id), null, 1));
  }),
);

// ---------------------------------------------------------------- Freunde (Kontoebene)
const idParam = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new users.UserError('Ungültige ID.', 400, 'notFound');
  return id;
};
api.get('/friends', wrap(async (req, res) => res.json(await features.listFriends(req.account.id))));
api.post(
  '/friends',
  express.json({ limit: '1kb' }),
  wrap(async (req, res) => res.json(await features.requestFriend(req.account.id, req.body?.username))),
);
api.get('/friends/:id/collection', wrap(async (req, res) => res.json(await features.friendCollection(req.account, idParam(req)))));
api.post(
  '/friends/:id/accept',
  wrap(async (req, res) => {
    await features.acceptFriend(req.account.id, idParam(req));
    res.json({ ok: true });
  }),
);
api.delete(
  '/friends/:id',
  wrap(async (req, res) => {
    await features.removeFriend(req.account.id, idParam(req));
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
    if (!acc?.spotify_user_id) throw new users.UserError('Dieses Konto hat kein Spotify verbunden.', 400, 'noSpotify');
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
    if (id === req.account.id) throw new users.UserError('Dein eigenes Konto löschst du im Profil.', 400, 'ownAccount');
    await users.deleteAccount(id);
    res.json({ ok: true });
  }),
);

// Backup (gzip-JSON, enthält Passwort-Hashes und Spotify-Tokens → sicher aufbewahren)
admin.get('/backup', async (req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Type': 'application/gzip',
    'Content-Disposition': `attachment; filename="spotlfy-backup-${date}.json.gz"`,
    'Cache-Control': 'no-store',
  });
  try {
    await streamBackup(res);
    console.log(`[backup] von ${req.account.username} heruntergeladen`);
  } catch (err) {
    console.error('[backup]', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.destroy(err);
  }
});
// Plattenladen: alles kostenlos (nur für das eigene Admin-Konto)
admin.post(
  '/free-shop',
  express.json({ limit: '1kb' }),
  wrap(async (req, res) => {
    await records.setFreeShop(req.account.id, req.body?.on === true);
    res.json({ ok: true, on: req.body?.on === true });
  }),
);
admin.get('/backup/info', wrap(async (_req, res) => res.json({ last: await lastBackup() })));
admin.post(
  '/restore',
  express.raw({ type: () => true, limit: '300mb' }),
  wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new users.UserError('Leere Datei.', 400, 'backupInvalid');
    const r = await restoreBackup(req.body);
    console.log(`[backup] Wiederherstellung durch ${req.account.username}:`, JSON.stringify(r.tables));
    res.json(r);
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
      stats.recentPlays(uid, 5),
    ]);
    res.json({ range: req.query.range || '30d', overview, timeline, topArtists, topTracks, heatmap, genres, recent });
  }),
);

api.get(
  '/history',
  wrap(async (req, res) => {
    const before = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.before || '')) ? req.query.before : null;
    res.json(await stats.historyDays(req.sid, { before, days: 7 }));
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

// ---------------------------------------------------------------- Rückblick, Suche, Meilensteine, Vergleich, Playlist
const yearParam = (v) => {
  const y = Number(v);
  return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : null;
};
api.get(
  '/wrapped',
  wrap(async (req, res) => {
    const years = await features.wrappedYears(req.sid);
    const year = yearParam(req.query.year) || years[0] || new Date().getFullYear();
    res.json({ years, ...(await features.wrapped(req.sid, year)) });
  }),
);
api.get('/search', wrap(async (req, res) => res.json(await features.search(req.sid, req.query.q))));
api.get('/track/:id', wrap(async (req, res) => res.json(await features.trackDetail(req.sid, String(req.params.id).slice(0, 64)))));
api.get('/artist', wrap(async (req, res) => res.json(await features.artistDetail(req.sid, String(req.query.name || '').slice(0, 200)))));
api.get('/milestones', wrap(async (req, res) => res.json(await features.milestones(req.sid, req.account.milestones_seen || []))));
api.post(
  '/milestones/seen',
  express.json({ limit: '4kb' }),
  wrap(async (req, res) => {
    await features.markMilestonesSeen(req.account.id, req.body?.ids);
    res.json({ ok: true });
  }),
);
api.get('/friends/:id/compare', wrap(async (req, res) => res.json(await features.compare(req.account, idParam(req), rangeDays(req)))));
api.get('/now-playing', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await features.nowPlaying(req.sid));
}));
api.get('/playlists', wrap(async (req, res) => res.json({ items: await features.recentPlaylists(req.account.id) })));
api.post(
  '/playlists',
  express.json({ limit: '2kb' }),
  wrap(async (req, res) => {
    const days = stats.RANGE_DAYS[req.body?.range] ?? 30;
    res.json(await features.createPlaylist(req.account, { days, size: req.body?.size, name: req.body?.name, description: req.body?.description }));
  }),
);

// ---------------------------------------------------------------- Plattensammlung
api.get('/records', wrap(async (req, res) => res.json(await records.overviewFor(req.account))));
api.post(
  '/records/buy',
  express.json({ limit: '1kb' }),
  wrap(async (req, res) => res.json(await records.buy(req.account, req.body?.id))),
);
api.post(
  '/records/exchange',
  express.json({ limit: '1kb' }),
  wrap(async (req, res) => res.json(await records.exchange(req.account, req.body?.from))),
);
api.post(
  '/records/egg',
  express.json({ limit: '1kb' }),
  wrap(async (req, res) => res.json(await records.openEgg(req.account, req.body?.id))),
);
api.post(
  '/records/quiz',
  express.json({ limit: '1kb' }),
  wrap(async (req, res) => res.json(await records.answerQuiz(req.account, req.body?.answer))),
);
api.post(
  '/records/event',
  express.json({ limit: '1kb' }),
  wrap(async (req, res) => res.json(await records.event(req.account, req.body || {}))),
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
