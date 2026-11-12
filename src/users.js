// Nutzerverwaltung: Anlegen/Aktualisieren beim Spotify-Login, Admin-Übersicht, Konto löschen.
import { config } from './config.js';
import { query, withTransaction } from './db.js';
import { bestImage } from './spotify.js';

/** Speichert bzw. aktualisiert den Nutzer nach erfolgreichem Spotify-Login. */
export async function upsertUserFromLogin({ profile, tokens }, { userAgent } = {}) {
  return withTransaction(async (db) => {
    const { rows: countRows } = await db.query('SELECT count(*) AS n FROM users');
    const isFirstUser = countRows[0].n === 0;
    const isConfiguredAdmin = config.adminIds.includes(profile.id);

    const { rows } = await db.query(
      `INSERT INTO users (id, display_name, email, avatar_url, country, product,
                          access_token, refresh_token, expires_at, scope, is_admin,
                          login_count, last_login_at, last_seen_at, auth_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, now(), now(), NULL)
       ON CONFLICT (id) DO UPDATE SET
         display_name = EXCLUDED.display_name, email = EXCLUDED.email, avatar_url = EXCLUDED.avatar_url,
         country = EXCLUDED.country, product = EXCLUDED.product,
         access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at, scope = EXCLUDED.scope,
         is_admin = users.is_admin OR EXCLUDED.is_admin,
         login_count = users.login_count + 1, last_login_at = now(), last_seen_at = now(),
         auth_error = NULL, updated_at = now()
       RETURNING id, display_name, is_admin, (xmax = 0) AS created`,
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
        isFirstUser || isConfiguredAdmin,
      ],
    );
    const user = rows[0];

    // Daten aus der Einzelnutzer-Version (noch ohne Besitzer) übernimmt der erste Nutzer.
    if (isFirstUser) {
      await db.query('UPDATE plays SET user_id = $1 WHERE user_id IS NULL', [user.id]);
      await db.query('UPDATE top_snapshots SET user_id = $1 WHERE user_id IS NULL', [user.id]);
    }
    await db.query('INSERT INTO login_events (user_id, user_agent) VALUES ($1, $2)', [
      user.id,
      userAgent ? String(userAgent).slice(0, 300) : null,
    ]);
    return user;
  });
}

export async function getUser(id) {
  const { rows } = await query(
    `SELECT id, display_name, email, avatar_url, country, product, is_admin, auth_error, created_at, last_login_at
       FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** Aktualisiert last_seen_at höchstens alle 5 Minuten (spart Schreibzugriffe). */
export function touchUser(id) {
  return query(
    `UPDATE users SET last_seen_at = now() WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < now() - interval '5 minutes')`,
    [id],
  ).catch(() => {});
}

export async function allUserIds() {
  const { rows } = await query('SELECT id FROM users WHERE auth_error IS NULL ORDER BY created_at');
  return rows.map((r) => r.id);
}

/** Admin: alle Nutzer mit Kennzahlen + letzte Logins. */
export async function adminOverview() {
  const [users, logins] = await Promise.all([
    query(
      `SELECT u.id, u.display_name, u.email, u.avatar_url, u.country, u.product, u.is_admin,
              u.auth_error IS NOT NULL AS auth_expired, u.login_count,
              u.created_at, u.last_login_at, u.last_seen_at,
              COALESCE(p.plays, 0) AS plays, COALESCE(p.minutes, 0) AS minutes, p.last_play,
              s.last_sync, s.last_sync_ok
         FROM users u
         LEFT JOIN LATERAL (
           SELECT count(*) AS plays, round(sum(ms_played) / 60000.0)::int AS minutes, max(played_at) AS last_play
             FROM plays WHERE user_id = u.id
         ) p ON true
         LEFT JOIN LATERAL (
           SELECT finished_at AS last_sync, ok AS last_sync_ok FROM sync_log
            WHERE user_id = u.id AND job = 'recently_played' ORDER BY id DESC LIMIT 1
         ) s ON true
        ORDER BY u.last_login_at DESC NULLS LAST`,
    ),
    query(
      `SELECT l.at, l.user_agent, u.id AS user_id, u.display_name, u.email, u.avatar_url
         FROM login_events l JOIN users u ON u.id = l.user_id
        ORDER BY l.at DESC LIMIT 50`,
    ),
  ]);
  return { users: users.rows, logins: logins.rows };
}

/** Löscht ein Konto samt aller Hördaten (Tracks/Künstler bleiben als gemeinsamer Katalog). */
export async function deleteUser(id) {
  await withTransaction(async (db) => {
    await db.query('DELETE FROM plays WHERE user_id = $1', [id]);
    await db.query('DELETE FROM top_snapshots WHERE user_id = $1', [id]);
    await db.query('DELETE FROM sync_log WHERE user_id = $1', [id]);
    await db.query('DELETE FROM users WHERE id = $1', [id]);
  });
}
