// Datenabgleich: Recently Played, tägliche Top-Snapshots, Anreicherung (Cover, Genres).
import { config } from './config.js';
import { query, withTransaction } from './db.js';
import { bestImage, spotifyGet } from './spotify.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RANGES = ['short_term', 'medium_term', 'long_term'];

/** Heutiges Datum (YYYY-MM-DD) in der konfigurierten Zeitzone. */
export function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());
}

// ---------------------------------------------------------------- Upserts

export async function upsertArtists(db, artists) {
  const items = [...new Map(artists.filter((a) => a?.id && a?.name).map((a) => [a.id, a])).values()];
  if (!items.length) return;
  await db.query(
    `INSERT INTO artists (id, name, image_url, genres)
     SELECT v.id, v.name, v.image_url, ARRAY(SELECT jsonb_array_elements_text(v.genres::jsonb))
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS v(id, name, image_url, genres)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       image_url = COALESCE(EXCLUDED.image_url, artists.image_url),
       genres = CASE WHEN cardinality(EXCLUDED.genres) > 0 THEN EXCLUDED.genres ELSE artists.genres END,
       updated_at = now()`,
    [
      items.map((a) => a.id),
      items.map((a) => a.name),
      items.map((a) => bestImage(a.images)),
      items.map((a) => JSON.stringify(Array.isArray(a.genres) ? a.genres : [])),
    ],
  );
}

/** Speichert vollständige Track-Objekte der Web API (inkl. Album-Cover). */
export async function upsertTracks(db, tracks) {
  const list = [...new Map(tracks.filter((t) => t?.id).map((t) => [t.id, t])).values()];
  if (!list.length) return;
  await upsertArtists(db, list.flatMap((t) => t.artists || []));
  await db.query(
    `INSERT INTO tracks (id, name, artist_ids, artist_names, album_id, album_name, album_image, duration_ms, enriched_at)
     SELECT v.id, v.name,
            ARRAY(SELECT jsonb_array_elements_text(v.aids::jsonb)),
            ARRAY(SELECT jsonb_array_elements_text(v.anames::jsonb)),
            v.album_id, v.album_name, v.album_image, v.duration_ms, now()
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[])
            AS v(id, name, aids, anames, album_id, album_name, album_image, duration_ms)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, artist_ids = EXCLUDED.artist_ids, artist_names = EXCLUDED.artist_names,
       album_id = EXCLUDED.album_id, album_name = EXCLUDED.album_name,
       album_image = COALESCE(EXCLUDED.album_image, tracks.album_image),
       duration_ms = EXCLUDED.duration_ms, enriched_at = now(), updated_at = now()`,
    [
      list.map((t) => t.id),
      list.map((t) => t.name),
      list.map((t) => JSON.stringify((t.artists || []).map((a) => a.id).filter(Boolean))),
      list.map((t) => JSON.stringify((t.artists || []).map((a) => a.name))),
      list.map((t) => t.album?.id || null),
      list.map((t) => t.album?.name || null),
      list.map((t) => bestImage(t.album?.images)),
      list.map((t) => t.duration_ms ?? null),
    ],
  );
}

/**
 * Fügt Plays ohne Duplikate ein. Ein Play gilt als Duplikat, wenn derselbe Track
 * innerhalb von ±90 s schon gespeichert ist – so überschneiden sich API-Daten und
 * History-Import nicht (die Zeitstempel beider Quellen weichen leicht ab).
 */
export async function insertPlays(db, userId, plays, source) {
  if (!plays.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO plays (user_id, played_at, track_id, ms_played, source, context_uri)
     SELECT $6, v.played_at, v.track_id, v.ms_played, $5, v.context_uri
       FROM unnest($1::timestamptz[], $2::text[], $3::int[], $4::text[]) AS v(played_at, track_id, ms_played, context_uri)
      WHERE NOT EXISTS (
        SELECT 1 FROM plays p
         WHERE p.user_id = $6 AND p.track_id = v.track_id
           AND p.played_at BETWEEN v.played_at - interval '90 seconds' AND v.played_at + interval '90 seconds')
     ON CONFLICT (user_id, track_id, played_at) DO NOTHING`,
    [
      plays.map((p) => p.playedAt),
      plays.map((p) => p.trackId),
      plays.map((p) => p.msPlayed),
      plays.map((p) => p.contextUri || null),
      source,
      userId,
    ],
  );
  return rowCount;
}

// ---------------------------------------------------------------- Jobs

async function logJob(userId, job, fn) {
  const { rows } = await query('INSERT INTO sync_log (user_id, job) VALUES ($1, $2) RETURNING id', [userId, job]);
  try {
    const result = await fn();
    await query('UPDATE sync_log SET finished_at = now(), ok = true, message = $2 WHERE id = $1', [
      rows[0].id,
      JSON.stringify(result ?? null),
    ]);
    return result;
  } catch (err) {
    await query('UPDATE sync_log SET finished_at = now(), ok = false, message = $2 WHERE id = $1', [
      rows[0].id,
      String(err.message || err).slice(0, 1000),
    ]);
    throw err;
  }
}

/** Holt die letzten 50 gehörten Tracks und speichert neue Plays. */
export function syncRecentlyPlayed(userId) {
  return logJob(userId, 'recently_played', async () => {
    const data = await spotifyGet(userId, '/me/player/recently-played?limit=50');
    const items = (data?.items || []).filter((i) => i.track?.id && i.played_at);
    if (!items.length) return { fetched: 0, inserted: 0 };
    const inserted = await withTransaction(async (db) => {
      await upsertTracks(db, items.map((i) => i.track));
      return insertPlays(
        db,
        userId,
        items.map((i) => ({
          playedAt: i.played_at,
          trackId: i.track.id,
          // Die API liefert keine tatsächliche Hördauer – wir nehmen die Track-Länge an.
          msPlayed: i.track.duration_ms || 0,
          contextUri: i.context?.uri,
        })),
        'api',
      );
    });
    return { fetched: items.length, inserted };
  });
}

export async function hasSnapshot(userId, date = todayLocal()) {
  const { rows } = await query('SELECT 1 FROM top_snapshots WHERE user_id = $1 AND snapshot_date = $2 LIMIT 1', [
    userId,
    date,
  ]);
  return rows.length > 0;
}

/** Speichert Top-Artists und -Tracks (short/medium/long term) als Snapshot des heutigen Tages. */
export function takeTopSnapshot(userId, date = todayLocal()) {
  return logJob(userId, 'top_snapshot', async () => {
    const results = {};
    for (const kind of ['artists', 'tracks']) {
      for (const range of RANGES) {
        const data = await spotifyGet(userId, `/me/top/${kind}?time_range=${range}&limit=50`);
        results[`${kind}:${range}`] = data?.items || [];
      }
    }
    await withTransaction(async (db) => {
      await db.query('DELETE FROM top_snapshots WHERE user_id = $1 AND snapshot_date = $2', [userId, date]);
      for (const [key, items] of Object.entries(results)) {
        const [kind, range] = key.split(':');
        if (kind === 'artists') await upsertArtists(db, items);
        else await upsertTracks(db, items);
        if (!items.length) continue;
        await db.query(
          `INSERT INTO top_snapshots (user_id, snapshot_date, kind, time_range, rank, item_id, name, subtitle, image_url)
           SELECT $9, $1, $2, $3, v.rank, v.id, v.name, v.subtitle, v.image
             FROM unnest($4::int[], $5::text[], $6::text[], $7::text[], $8::text[]) AS v(rank, id, name, subtitle, image)`,
          [
            date,
            kind,
            range,
            items.map((_, i) => i + 1),
            items.map((it) => it.id),
            items.map((it) => it.name),
            items.map((it) =>
              kind === 'tracks' ? (it.artists || []).map((a) => a.name).join(', ') : (it.genres || []).slice(0, 3).join(', ') || null,
            ),
            items.map((it) => bestImage(kind === 'tracks' ? it.album?.images : it.images)),
            userId,
          ],
        );
      }
    });
    return Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.length]));
  });
}

/**
 * Reichert Tracks aus dem History-Import (ohne Cover/Artist-IDs) und Künstler
 * (Bild, Genres) schrittweise an. Seit Feb. 2026 gibt es im Development Mode
 * keine Batch-Endpunkte mehr, daher Einzelabrufe mit Limit pro Lauf.
 */
export function enrichMetadata(userId, { limit = config.enrichLimit } = {}) {
  return logJob(userId, 'enrich', async () => {
    let tracks = 0;
    let artists = 0;
    const { rows: trackRows } = await query(
      `SELECT t.id FROM tracks t
         LEFT JOIN plays p ON p.track_id = t.id
        WHERE t.enriched_at IS NULL
        GROUP BY t.id ORDER BY count(p.id) DESC LIMIT $1`,
      [limit],
    );
    for (const { id } of trackRows) {
      try {
        const t = await spotifyGet(userId, `/tracks/${id}`);
        await upsertTracks({ query }, [t]);
        tracks++;
      } catch (err) {
        if (err.status === 404 || err.status === 400 || err.status === 403) {
          await query('UPDATE tracks SET enriched_at = now() WHERE id = $1', [id]);
        } else throw err;
      }
      await sleep(120);
    }

    const { rows: artistRows } = await query(
      `SELECT id FROM artists
        WHERE enriched_at IS NULL OR enriched_at < now() - interval '45 days'
        ORDER BY enriched_at NULLS FIRST LIMIT $1`,
      [limit],
    );
    for (const { id } of artistRows) {
      try {
        const a = await spotifyGet(userId, `/artists/${id}`);
        await query(
          `UPDATE artists SET name = $2, image_url = COALESCE($3, image_url),
             genres = CASE WHEN cardinality($4::text[]) > 0 THEN $4::text[] ELSE genres END,
             enriched_at = now(), updated_at = now() WHERE id = $1`,
          [id, a.name, bestImage(a.images), Array.isArray(a.genres) ? a.genres : []],
        );
        artists++;
      } catch (err) {
        if (err.status === 404 || err.status === 400 || err.status === 403) {
          await query('UPDATE artists SET enriched_at = now() WHERE id = $1', [id]);
        } else throw err;
      }
      await sleep(120);
    }
    return { tracks, artists };
  });
}

/** Ein kompletter Sync-Lauf für einen Nutzer. */
export async function runCron(userId, { forceSnapshot = false, enrich = true } = {}) {
  const summary = {};
  summary.recent = await syncRecentlyPlayed(userId);
  if (forceSnapshot || !(await hasSnapshot(userId))) {
    summary.snapshot = await takeTopSnapshot(userId);
  }
  if (!enrich) return summary;
  try {
    summary.enrich = await enrichMetadata(userId);
  } catch (err) {
    // Anreicherung ist "nice to have" – sie darf den Lauf nicht scheitern lassen.
    summary.enrichError = err.message;
  }
  return summary;
}
