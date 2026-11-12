// Konten & Nutzer:
// - accounts: Spotlfy-Konto mit Benutzername + Passwort (scrypt-Hash), Admin-Flag, verknüpftes Spotify-Konto
// - users:    verbundenes Spotify-Konto (Tokens, Profil); daran hängen plays/top_snapshots/sync_log
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { query, withTransaction } from './db.js';
import { bestImage } from './spotify.js';

const scrypt = promisify(crypto.scrypt);

export class UserError extends Error {
  // key = Übersetzungsschlüssel fürs Frontend (err.<key>)
  constructor(message, status = 400, key = null) {
    super(message);
    this.status = status;
    this.key = key;
  }
}

// ---------------------------------------------------------------- Passwörter

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password).normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [algo, saltB64, hashB64] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Gleiche Rechenzeit für unbekannte Benutzernamen (verhindert Ausspähen per Timing).
let dummyHash;
const getDummyHash = async () => (dummyHash ||= await hashPassword('dummy-password-for-timing'));

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;

function validateCredentials(username, password) {
  const u = String(username || '').trim();
  if (!USERNAME_RE.test(u)) {
    throw new UserError('Der Benutzername muss 3–24 Zeichen lang sein (Buchstaben, Zahlen, _ . -).', 400, 'usernameInvalid');
  }
  if (String(password || '').length < 8) throw new UserError('Das Passwort muss mindestens 8 Zeichen lang sein.', 400, 'passwordShort');
  if (String(password).length > 200) throw new UserError('Das Passwort ist zu lang.', 400, 'passwordLong');
  return u;
}

// ---------------------------------------------------------------- Konten

/**
 * Registriert ein neues Konto. Gibt es noch keinen Admin (frische Installation oder nach dem
 * Admin-Reset), wird das neue Konto automatisch Admin mit allen Funktionen.
 */
export async function registerAccount(username, password) {
  if (!config.allowRegistration) throw new UserError('Neue Registrierungen sind derzeit deaktiviert.', 403, 'registrationClosed');
  const u = validateCredentials(username, password);
  const passwordHash = await hashPassword(password);
  try {
    return await withTransaction(async (db) => {
      // Sperre, damit bei gleichzeitigen Registrierungen nur einer Admin wird.
      await db.query('SELECT pg_advisory_xact_lock(424242)');
      const { rows: admins } = await db.query('SELECT 1 FROM accounts WHERE is_admin LIMIT 1');
      const { rows } = await db.query(
        'INSERT INTO accounts (username, password_hash, is_admin) VALUES ($1, $2, $3) RETURNING id, username, is_admin',
        [u, passwordHash, admins.length === 0],
      );
      if (rows[0].is_admin) console.log(`[admin] „${rows[0].username}“ ist als erster Nutzer Admin geworden.`);
      return rows[0];
    });
  } catch (err) {
    if (err.code === '23505') throw new UserError('Dieser Benutzername ist bereits vergeben.', 409, 'usernameTaken');
    throw err;
  }
}

/** Prüft Benutzername + Passwort. Gibt das Konto zurück oder null. */
export async function authenticate(username, password) {
  const { rows } = await query('SELECT id, username, password_hash, is_admin FROM accounts WHERE lower(username) = lower($1)', [
    String(username || '').trim(),
  ]);
  const acc = rows[0];
  const ok = await verifyPassword(password, acc ? acc.password_hash : await getDummyHash());
  if (!acc || !ok) return null;
  return { id: acc.id, username: acc.username, is_admin: acc.is_admin };
}

export async function recordLogin(accountId, userAgent) {
  await query(
    'UPDATE accounts SET login_count = login_count + 1, last_login_at = now(), last_seen_at = now() WHERE id = $1',
    [accountId],
  );
  await query('INSERT INTO login_events (account_id, user_id, user_agent) VALUES ($1, (SELECT spotify_user_id FROM accounts WHERE id = $1), $2)', [
    accountId,
    userAgent ? String(userAgent).slice(0, 300) : null,
  ]);
}

/** Konto inkl. verbundenem Spotify-Profil. */
export async function getAccount(id) {
  const { rows } = await query(
    `SELECT a.id, a.username, a.is_admin, a.spotify_user_id, a.created_at, a.theme, a.lang, a.festive,
            to_char(a.birthday, 'YYYY-MM-DD') AS birthday,
            u.display_name, u.email, u.avatar_url, u.country, u.product, u.auth_error
       FROM accounts a LEFT JOIN users u ON u.id = a.spotify_user_id
      WHERE a.id = $1`,
    [id],
  );
  return rows[0] || null;
}

export function touchAccount(id) {
  return query(
    `UPDATE accounts SET last_seen_at = now() WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < now() - interval '5 minutes')`,
    [id],
  ).catch(() => {});
}

export async function changePassword(accountId, currentPassword, newPassword) {
  const { rows } = await query('SELECT username, password_hash FROM accounts WHERE id = $1', [accountId]);
  if (!rows.length) throw new UserError('Konto nicht gefunden.', 404, 'accountNotFound');
  if (!(await verifyPassword(currentPassword, rows[0].password_hash))) throw new UserError('Das aktuelle Passwort stimmt nicht.', 400, 'wrongPassword');
  validateCredentials(rows[0].username, newPassword);
  await query('UPDATE accounts SET password_hash = $2, updated_at = now() WHERE id = $1', [accountId, await hashPassword(newPassword)]);
}

export const THEMES = ['system', 'dark', 'light', 'season'];

export const LANGS = ['de', 'en', 'fr', 'es', 'it', 'sv', 'da'];

/** Speichert Einstellungen des Kontos (nur übergebene Felder). */
export async function updateSettings(accountId, { theme, lang, festive, birthday } = {}) {
  const sets = [];
  const vals = [accountId];
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  const bad = () => new UserError('Ungültige Einstellung.', 400, 'invalidSetting');
  if (theme !== undefined) { if (!THEMES.includes(theme)) throw bad(); add('theme', theme); }
  if (lang !== undefined) { if (!LANGS.includes(lang)) throw bad(); add('lang', lang); }
  if (festive !== undefined) add('festive', Boolean(festive));
  if (birthday !== undefined) {
    if (birthday === null || birthday === '') add('birthday', null);
    else {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthday));
      const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      if (!d || d.getUTCMonth() !== +m[2] - 1 || +m[1] < 1900 || d > new Date()) throw bad();
      add('birthday', birthday);
    }
  }
  if (!sets.length) return;
  await query(`UPDATE accounts SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
}

// ---------------------------------------------------------------- Spotify verbinden

/**
 * Speichert das Spotify-Konto (Tokens + Profil) und verknüpft es mit dem Spotlfy-Konto.
 * Ein Spotify-Konto kann nur mit einem Spotlfy-Konto verbunden sein.
 */
export async function connectSpotify(accountId, { profile, tokens }) {
  return withTransaction(async (db) => {
    const { rows: taken } = await db.query('SELECT id FROM accounts WHERE spotify_user_id = $1 AND id <> $2', [
      profile.id,
      accountId,
    ]);
    if (taken.length) throw new UserError('Dieses Spotify-Konto ist bereits mit einem anderen Spotlfy-Konto verbunden.', 409, 'alreadyLinked');

    const { rows: countRows } = await db.query('SELECT count(*) AS n FROM users');
    await db.query(
      `INSERT INTO users (id, display_name, email, avatar_url, country, product,
                          access_token, refresh_token, expires_at, scope, auth_error, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, now())
       ON CONFLICT (id) DO UPDATE SET
         display_name = EXCLUDED.display_name, email = EXCLUDED.email, avatar_url = EXCLUDED.avatar_url,
         country = EXCLUDED.country, product = EXCLUDED.product,
         access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at, scope = EXCLUDED.scope,
         auth_error = NULL, last_login_at = now(), updated_at = now()`,
      [
        profile.id,
        profile.display_name || profile.id,
        profile.email || null,
        bestImage(profile.images),
        profile.country || null,
        profile.product || null,
        tokens.accessToken,
        tokens.refreshToken,
        tokens.expiresAt,
        tokens.scope || null,
      ],
    );
    // Bisher verknüpftes (anderes) Spotify-Konto wird gelöst, das neue verknüpft.
    await db.query('UPDATE accounts SET spotify_user_id = $2, updated_at = now() WHERE id = $1', [accountId, profile.id]);
    // Daten aus der Einzelnutzer-Version ohne Besitzer übernimmt das erste verbundene Spotify-Konto.
    if (countRows[0].n === 0) {
      await db.query('UPDATE plays SET user_id = $1 WHERE user_id IS NULL', [profile.id]);
      await db.query('UPDATE top_snapshots SET user_id = $1 WHERE user_id IS NULL', [profile.id]);
    }
    return { spotifyUserId: profile.id };
  });
}

/** Spotify-Verbindung lösen; Hördaten bleiben erhalten und kommen beim erneuten Verbinden zurück. */
export async function disconnectSpotify(accountId) {
  await query('UPDATE accounts SET spotify_user_id = NULL, updated_at = now() WHERE id = $1', [accountId]);
}

// ---------------------------------------------------------------- Sync-Ziele

export async function allUserIds() {
  const { rows } = await query('SELECT id FROM users WHERE auth_error IS NULL ORDER BY created_at');
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------- Admin

/** Admin: alle Konten mit Spotify-Profil und Kennzahlen + letzte Logins. */
export async function adminOverview() {
  const [accounts, logins] = await Promise.all([
    query(
      `SELECT a.id, a.username, a.is_admin, a.login_count, a.created_at, a.last_login_at, a.last_seen_at,
              a.spotify_user_id, u.display_name, u.email, u.avatar_url, u.country, u.product,
              u.auth_error IS NOT NULL AS auth_expired,
              COALESCE(p.plays, 0) AS plays, COALESCE(p.minutes, 0) AS minutes, p.last_play,
              s.last_sync, s.last_sync_ok
         FROM accounts a
         LEFT JOIN users u ON u.id = a.spotify_user_id
         LEFT JOIN LATERAL (
           SELECT count(*) AS plays, round(sum(ms_played) / 60000.0)::int AS minutes, max(played_at) AS last_play
             FROM plays WHERE user_id = a.spotify_user_id
         ) p ON true
         LEFT JOIN LATERAL (
           SELECT finished_at AS last_sync, ok AS last_sync_ok FROM sync_log
            WHERE user_id = a.spotify_user_id AND job = 'recently_played' ORDER BY id DESC LIMIT 1
         ) s ON true
        ORDER BY a.last_login_at DESC NULLS LAST, a.created_at DESC`,
    ),
    query(
      `SELECT l.at, l.user_agent, a.id AS account_id, a.username, u.display_name, u.email, u.avatar_url
         FROM login_events l
         JOIN accounts a ON a.id = l.account_id
         LEFT JOIN users u ON u.id = a.spotify_user_id
        ORDER BY l.at DESC LIMIT 50`,
    ),
  ]);
  return { accounts: accounts.rows, logins: logins.rows };
}

/** Admin-Rechte setzen/entziehen. Der letzte Admin bleibt geschützt. */
export async function setAdmin(accountId, isAdmin) {
  return withTransaction(async (db) => {
    const { rows } = await db.query('SELECT username FROM accounts WHERE id = $1', [accountId]);
    if (!rows.length) throw new UserError('Konto nicht gefunden.', 404, 'accountNotFound');
    if (!isAdmin) {
      const { rows: others } = await db.query('SELECT count(*) AS n FROM accounts WHERE is_admin AND id <> $1', [accountId]);
      if (others[0].n === 0) throw new UserError('Der letzte Admin kann nicht entfernt werden.', 400, 'lastAdmin');
    }
    await db.query('UPDATE accounts SET is_admin = $2, updated_at = now() WHERE id = $1', [accountId, isAdmin]);
  });
}

/** Admin: setzt ein zufälliges neues Passwort und gibt es einmalig zurück. */
export async function resetPassword(accountId) {
  const { rows } = await query('SELECT username FROM accounts WHERE id = $1', [accountId]);
  if (!rows.length) throw new UserError('Konto nicht gefunden.', 404, 'accountNotFound');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const password = Array.from(crypto.randomBytes(12), (b) => alphabet[b % alphabet.length]).join('');
  await query('UPDATE accounts SET password_hash = $2, updated_at = now() WHERE id = $1', [accountId, await hashPassword(password)]);
  return { username: rows[0].username, password };
}

/** Löscht ein Spotlfy-Konto samt aller Hördaten des verbundenen Spotify-Kontos. */
export async function deleteAccount(accountId) {
  await withTransaction(async (db) => {
    const { rows } = await db.query('SELECT username, spotify_user_id, is_admin FROM accounts WHERE id = $1', [accountId]);
    if (!rows.length) return;
    if (rows[0].is_admin) {
      const { rows: others } = await db.query('SELECT count(*) AS n FROM accounts WHERE is_admin AND id <> $1', [accountId]);
      if (others[0].n === 0) throw new UserError('Der letzte Admin kann nicht gelöscht werden. Ernenne vorher einen anderen Admin.', 400, 'lastAdminDelete');
    }
    const sid = rows[0].spotify_user_id;
    await db.query('DELETE FROM accounts WHERE id = $1', [accountId]);
    if (sid) {
      await db.query('DELETE FROM plays WHERE user_id = $1', [sid]);
      await db.query('DELETE FROM top_snapshots WHERE user_id = $1', [sid]);
      await db.query('DELETE FROM sync_log WHERE user_id = $1', [sid]);
      await db.query('DELETE FROM login_events WHERE user_id = $1', [sid]);
      await db.query('DELETE FROM users WHERE id = $1', [sid]);
    }
  });
}

/** Admin: Systemübersicht (Datenbankgröße, Katalog, Sync-Fehler). */
export async function adminSystem() {
  const [db, catalog, errors, jobs] = await Promise.all([
    query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size, version() AS version`),
    query(
      `SELECT (SELECT count(*) FROM tracks) AS tracks, (SELECT count(*) FROM artists) AS artists,
              (SELECT count(*) FROM tracks WHERE enriched_at IS NULL) AS tracks_pending,
              (SELECT count(*) FROM artists WHERE enriched_at IS NULL) AS artists_pending,
              (SELECT count(*) FROM plays) AS plays,
              (SELECT count(DISTINCT (user_id, snapshot_date)) FROM top_snapshots) AS snapshots`,
    ),
    query(
      `SELECT l.id, l.job, l.started_at, l.message, l.user_id, u.display_name, a.username
         FROM sync_log l
         LEFT JOIN users u ON u.id = l.user_id
         LEFT JOIN accounts a ON a.spotify_user_id = l.user_id
        WHERE l.ok = false ORDER BY l.id DESC LIMIT 20`,
    ),
    query(
      `SELECT count(*) FILTER (WHERE started_at > now() - interval '24 hours') AS runs_24h,
              count(*) FILTER (WHERE started_at > now() - interval '24 hours' AND ok = false) AS errors_24h,
              max(finished_at) AS last_run
         FROM sync_log WHERE job = 'recently_played'`,
    ),
  ]);
  return {
    database: { size: db.rows[0].size, version: db.rows[0].version.split(' ').slice(0, 2).join(' ') },
    catalog: catalog.rows[0],
    jobs: jobs.rows[0],
    errors: errors.rows,
    config: {
      timezone: config.timezone,
      syncIntervalMinutes: config.syncIntervalMinutes,
      internalScheduler: config.internalScheduler,
      keepAlive: Boolean(config.keepAliveUrl),
      allowRegistration: config.allowRegistration,
    },
  };
}

/** CSV-Export aller Konten (für Excel: Semikolon + BOM). */
export async function accountsCsv() {
  const { accounts } = await adminOverview();
  const cols = [
    ['username', 'Benutzername'], ['is_admin', 'Admin'], ['display_name', 'Spotify-Name'], ['email', 'E-Mail'],
    ['spotify_user_id', 'Spotify-ID'], ['country', 'Land'], ['product', 'Abo'], ['created_at', 'Registriert'],
    ['last_login_at', 'Letzter Login'], ['login_count', 'Logins'], ['plays', 'Plays'], ['minutes', 'Minuten'],
    ['last_sync', 'Letzter Sync'],
  ];
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const str = v instanceof Date ? v.toISOString() : String(v);
    return /[";\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [cols.map((c) => c[1]).join(';'), ...accounts.map((u) => cols.map(([k]) => cell(u[k])).join(';'))];
  return '﻿' + lines.join('\r\n');
}
