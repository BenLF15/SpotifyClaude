// Auswertungen fürs Dashboard. Alle Zeitangaben werden in config.timezone gerechnet.
import { config } from './config.js';
import { query } from './db.js';

export const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90, '365d': 365, all: 0 };

// Plays im gewählten Zeitraum, mit lokaler Zeit (lt) und primärem Künstler.
const PLAYS_CTE = `
  p AS (
    SELECT pl.played_at, pl.ms_played, pl.track_id,
           (pl.played_at AT TIME ZONE $1) AS lt,
           t.artist_names[1] AS artist, t.artist_ids[1] AS artist_id
      FROM plays pl JOIN tracks t ON t.id = pl.track_id
     WHERE pl.user_id = $3
       AND ($2::int = 0 OR pl.played_at >= now() - make_interval(days => $2::int))
  )`;

// Bild/Genres eines Künstlers: zuerst über die ID, sonst über den Namen (Import-Daten).
const ARTIST_LOOKUP = (nameCol, idCol) => `
  LEFT JOIN LATERAL (
    SELECT * FROM (
      SELECT a.image_url, a.genres, 0 AS prio FROM artists a WHERE a.id = ${idCol}
      UNION ALL
      SELECT a.image_url, a.genres, 1 AS prio FROM artists a WHERE lower(a.name) = lower(${nameCol})
    ) x ORDER BY prio LIMIT 1
  ) ai ON true`;

export async function overview(userId, days) {
  const tz = config.timezone;
  const [cur, prev, first, fresh] = await Promise.all([
    query(
      `WITH ${PLAYS_CTE}
       SELECT COALESCE(sum(ms_played), 0) AS ms, count(*) AS plays,
              count(DISTINCT track_id) AS tracks, count(DISTINCT lower(artist)) AS artists,
              count(DISTINCT lt::date) AS active_days, min(played_at) AS first_play
         FROM p`,
      [tz, days, userId],
    ),
    days
      ? query(
          `SELECT COALESCE(sum(ms_played), 0) AS ms, count(*) AS plays FROM plays
            WHERE user_id = $2
              AND played_at >= now() - make_interval(days => $1::int * 2)
              AND played_at <  now() - make_interval(days => $1::int)`,
          [days, userId],
        )
      : Promise.resolve({ rows: [null] }),
    query('SELECT min(played_at) AS first, max(played_at) AS last, count(*) AS total FROM plays WHERE user_id = $1', [userId]),
    // Künstler, die im Zeitraum zum ersten Mal überhaupt gehört wurden
    query(
      `SELECT count(*) AS n FROM (
         SELECT lower(t.artist_names[1]) AS a, min(pl.played_at) AS first
           FROM plays pl JOIN tracks t ON t.id = pl.track_id
          WHERE pl.user_id = $1 GROUP BY 1
       ) x WHERE $2::int > 0 AND first >= now() - make_interval(days => $2::int)`,
      [userId, days],
    ),
  ]);
  const c = cur.rows[0];
  const spanDays = days || Math.max(1, Math.ceil((Date.now() - new Date(first.rows[0].first || Date.now())) / 864e5));
  return {
    minutes: Math.round(c.ms / 60000),
    plays: c.plays,
    tracks: c.tracks,
    artists: c.artists,
    activeDays: c.active_days,
    avgMinutesPerDay: Math.round(c.ms / 60000 / spanDays),
    previousMinutes: prev.rows[0] ? Math.round(prev.rows[0].ms / 60000) : null,
    firstPlay: first.rows[0].first,
    lastPlay: first.rows[0].last,
    totalPlays: first.rows[0].total,
    newArtists: days ? fresh.rows[0].n : null,
  };
}

/** Hörminuten pro Tag (lückenlos) und pro Woche. */
export async function timeline(userId, days) {
  const tz = config.timezone;
  const dailyDays = days || 365;
  const daily = await query(
    `WITH d AS (
       SELECT generate_series((now() AT TIME ZONE $1)::date - ($2::int - 1), (now() AT TIME ZONE $1)::date, interval '1 day')::date AS day
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(round(sum(pl.ms_played) / 60000.0), 0)::int AS minutes
       FROM d LEFT JOIN plays pl ON pl.user_id = $3 AND (pl.played_at AT TIME ZONE $1)::date = d.day
      GROUP BY d.day ORDER BY d.day`,
    [tz, dailyDays, userId],
  );
  const weekly = await query(
    `WITH ${PLAYS_CTE},
     bounds AS (SELECT date_trunc('week', COALESCE(min(lt), now() AT TIME ZONE $1)) AS lo,
                       date_trunc('week', now() AT TIME ZONE $1) AS hi FROM p),
     w AS (SELECT generate_series(lo, hi, interval '1 week') AS wk FROM bounds)
     SELECT to_char(w.wk, 'YYYY-MM-DD') AS week, COALESCE(round(sum(p.ms_played) / 60000.0), 0)::int AS minutes
       FROM w LEFT JOIN p ON date_trunc('week', p.lt) = w.wk
      GROUP BY w.wk ORDER BY w.wk`,
    [tz, days, userId],
  );
  return { daily: daily.rows, weekly: weekly.rows };
}

export async function topArtists(userId, days, limit = 20) {
  const { rows } = await query(
    `WITH ${PLAYS_CTE},
     agg AS (
       SELECT min(artist) AS name, (array_agg(artist_id) FILTER (WHERE artist_id IS NOT NULL))[1] AS id,
              sum(ms_played) AS ms, count(*) AS plays, count(DISTINCT track_id) AS tracks
         FROM p GROUP BY lower(artist) ORDER BY ms DESC LIMIT $4
     )
     SELECT agg.name, agg.id, round(agg.ms / 60000.0)::int AS minutes, agg.plays, agg.tracks,
            ai.image_url AS image, COALESCE(ai.genres, '{}') AS genres
       FROM agg ${ARTIST_LOOKUP('agg.name', 'agg.id')}
      ORDER BY agg.ms DESC`,
    [config.timezone, days, userId, limit],
  );
  return rows;
}

export async function topTracks(userId, days, limit = 20) {
  const { rows } = await query(
    `WITH ${PLAYS_CTE},
     agg AS (SELECT track_id, sum(ms_played) AS ms, count(*) AS plays FROM p GROUP BY track_id ORDER BY plays DESC, ms DESC LIMIT $4)
     SELECT t.id, t.name, array_to_string(t.artist_names, ', ') AS artists, t.album_name AS album,
            t.album_image AS image, agg.plays, round(agg.ms / 60000.0)::int AS minutes
       FROM agg JOIN tracks t ON t.id = agg.track_id
      ORDER BY agg.plays DESC, agg.ms DESC`,
    [config.timezone, days, userId, limit],
  );
  return rows;
}

/** 7×24-Matrix: Hörminuten nach Wochentag (1 = Mo) und Stunde. */
export async function heatmap(userId, days) {
  const { rows } = await query(
    `WITH ${PLAYS_CTE}
     SELECT extract(isodow FROM lt)::int AS dow, extract(hour FROM lt)::int AS hour,
            round(sum(ms_played) / 60000.0)::int AS minutes
       FROM p GROUP BY 1, 2`,
    [config.timezone, days, userId],
  );
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of rows) grid[r.dow - 1][r.hour] = r.minutes;
  return grid;
}

/**
 * Genre-Verteilung als echte Anteile (summieren sich zu 100 %): Die Hörzeit eines Künstlers wird
 * gleichmäßig auf seine Genres verteilt. coverage = Anteil der Hörzeit mit bekannten Genres.
 */
export async function genres(userId, days, limit = 12) {
  const { rows } = await query(
    `WITH ${PLAYS_CTE},
     per_artist AS (
       SELECT min(artist) AS name, (array_agg(artist_id) FILTER (WHERE artist_id IS NOT NULL))[1] AS id, sum(ms_played) AS ms
         FROM p GROUP BY lower(artist)
     ),
     tagged AS (
       SELECT pa.ms, COALESCE(ai.genres, '{}') AS genres FROM per_artist pa ${ARTIST_LOOKUP('pa.name', 'pa.id')}
     ),
     weighted AS (
       SELECT g.genre, t.ms::float8 / cardinality(t.genres) AS ms
         FROM tagged t CROSS JOIN LATERAL unnest(t.genres) AS g(genre)
        WHERE cardinality(t.genres) > 0
     ),
     totals AS (
       SELECT COALESCE(sum(ms), 0) AS all_ms,
              COALESCE(sum(ms) FILTER (WHERE cardinality(genres) > 0), 0) AS tagged_ms FROM tagged
     )
     SELECT w.genre, round(sum(w.ms) / 60000.0)::int AS minutes, sum(w.ms) AS ms,
            (SELECT tagged_ms FROM totals) AS tagged_ms, (SELECT all_ms FROM totals) AS all_ms,
            count(*) OVER () AS total_genres
       FROM weighted w GROUP BY w.genre ORDER BY sum(w.ms) DESC LIMIT $4`,
    [config.timezone, days, userId, limit],
  );
  const tagged = rows[0]?.tagged_ms || 0;
  const all = rows[0]?.all_ms || 0;
  const items = rows.map((r) => ({ genre: r.genre, minutes: r.minutes, share: tagged ? r.ms / tagged : 0 }));
  const shown = items.reduce((a, i) => a + i.share, 0);
  return {
    coverage: all ? tagged / all : 0,
    totalGenres: rows[0]?.total_genres || 0,
    other: Math.max(0, 1 - shown),
    items,
  };
}

/** Langfristige Entwicklung: Hörminuten, Künstlervielfalt und neue Künstler pro Monat. */
export async function monthly(userId) {
  const { rows } = await query(
    `WITH p AS (
       SELECT date_trunc('month', pl.played_at AT TIME ZONE $1) AS m, pl.ms_played, lower(t.artist_names[1]) AS artist
         FROM plays pl JOIN tracks t ON t.id = pl.track_id
        WHERE pl.user_id = $2
     ),
     firsts AS (SELECT artist, min(m) AS first_m FROM p GROUP BY artist)
     SELECT to_char(p.m, 'YYYY-MM') AS month,
            round(sum(p.ms_played) / 60000.0)::int AS minutes,
            count(DISTINCT p.artist) AS artists,
            (SELECT count(*) FROM firsts f WHERE f.first_m = p.m) AS new_artists
       FROM p GROUP BY p.m ORDER BY p.m`,
    [config.timezone, userId],
  );
  return rows;
}

export async function recentPlays(userId, limit = 20) {
  const { rows } = await query(
    `SELECT pl.played_at, t.id, t.name, array_to_string(t.artist_names, ', ') AS artists, t.album_image AS image
       FROM plays pl JOIN tracks t ON t.id = pl.track_id
      WHERE pl.user_id = $1
      ORDER BY pl.played_at DESC LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

/** Neuester Spotify-Top-Snapshot + Rangverlauf der aktuellen Top 5 + Veränderung zur Vorwoche. */
export async function spotifyTop(userId, kind, range) {
  const latest = await query(
    'SELECT max(snapshot_date) AS d FROM top_snapshots WHERE user_id = $3 AND kind = $1 AND time_range = $2',
    [kind, range, userId],
  );
  const date = latest.rows[0]?.d;
  if (!date) return { date: null, items: [], history: { dates: [], series: [] } };

  const { rows: items } = await query(
    `SELECT s.rank, s.item_id AS id, s.name, s.subtitle, s.image_url AS image, prev.rank AS prev_rank
       FROM top_snapshots s
       LEFT JOIN LATERAL (
         SELECT o.rank FROM top_snapshots o
          WHERE o.user_id = s.user_id AND o.kind = s.kind AND o.time_range = s.time_range AND o.item_id = s.item_id
            AND o.snapshot_date = (
              SELECT max(snapshot_date) FROM top_snapshots
               WHERE user_id = s.user_id AND kind = s.kind AND time_range = s.time_range
                 AND snapshot_date <= s.snapshot_date - 7)
       ) prev ON true
      WHERE s.user_id = $4 AND s.kind = $1 AND s.time_range = $2 AND s.snapshot_date = $3
      ORDER BY s.rank`,
    [kind, range, date, userId],
  );

  const topIds = items.slice(0, 5).map((i) => i.id);
  const { rows: hist } = await query(
    `SELECT to_char(snapshot_date, 'YYYY-MM-DD') AS d, item_id, rank FROM top_snapshots
      WHERE user_id = $5 AND kind = $1 AND time_range = $2 AND item_id = ANY($3) AND snapshot_date >= $4::date - 180
      ORDER BY snapshot_date`,
    [kind, range, topIds, date, userId],
  );
  const dates = [...new Set(hist.map((h) => h.d))];
  const series = topIds.map((id) => {
    const byDate = new Map(hist.filter((h) => h.item_id === id).map((h) => [h.d, h.rank]));
    return { id, name: items.find((i) => i.id === id).name, ranks: dates.map((d) => byDate.get(d) ?? null) };
  });
  return { date, items, history: { dates, series } };
}

export async function status(userId) {
  const [user, counts, lastSync, snaps] = await Promise.all([
    query('SELECT id, display_name, avatar_url, is_admin, auth_error IS NOT NULL AS auth_expired FROM users WHERE id = $1', [
      userId,
    ]),
    query(
      `SELECT (SELECT count(*) FROM plays WHERE user_id = $1) AS plays,
              (SELECT count(*) FROM plays WHERE user_id = $1 AND source = 'import') AS imported,
              (SELECT count(DISTINCT p.track_id) FROM plays p JOIN tracks t ON t.id = p.track_id
                WHERE p.user_id = $1 AND t.enriched_at IS NULL) AS tracks_pending`,
      [userId],
    ),
    query(
      `SELECT DISTINCT ON (job) job, finished_at, ok, message FROM sync_log
        WHERE user_id = $1 ORDER BY job, id DESC`,
      [userId],
    ),
    query('SELECT count(DISTINCT snapshot_date) AS days, max(snapshot_date) AS last FROM top_snapshots WHERE user_id = $1', [
      userId,
    ]),
  ]);
  return {
    user: user.rows[0] || null,
    counts: counts.rows[0],
    jobs: Object.fromEntries(lastSync.rows.map((r) => [r.job, r])),
    snapshots: snaps.rows[0],
  };
}
