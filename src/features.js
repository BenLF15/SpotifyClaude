// Zusatzfunktionen: Jahresrückblick, Suche & Details, Meilensteine, Freunde & Vergleich,
// Playlist aus der Statistik, „Aktuell läuft“ und Datenexport.
import { config } from './config.js';
import { query, withTransaction } from './db.js';
import { bestImage, missingScopes, spotifyGet, spotifyPost } from './spotify.js';
import { ARTIST_LOOKUP, genres as genreStats, overview, topArtists, topTracks } from './stats.js';
import { todayLocal } from './sync.js';
import { UserError } from './users.js';

const TZ = () => config.timezone;
const minutes = (ms) => Math.round((ms || 0) / 60000);

// ================================================================ Jahresrückblick

export async function wrappedYears(userId) {
  const { rows } = await query(
    `SELECT DISTINCT extract(year FROM played_at AT TIME ZONE $1)::int AS y FROM plays WHERE user_id = $2 ORDER BY y DESC`,
    [TZ(), userId],
  );
  return rows.map((r) => r.y);
}

// Plays eines Kalenderjahres (lokale Zeit)
const YEAR_CTE = `
  p AS (
    SELECT pl.played_at, pl.ms_played, pl.track_id, (pl.played_at AT TIME ZONE $1) AS lt,
           t.artist_names[1] AS artist, t.artist_ids[1] AS artist_id
      FROM plays pl JOIN tracks t ON t.id = pl.track_id
     WHERE pl.user_id = $2
       AND pl.played_at >= (make_date($3::int, 1, 1)::timestamp AT TIME ZONE $1)
       AND pl.played_at <  (make_date($3::int + 1, 1, 1)::timestamp AT TIME ZONE $1)
  )`;

/** Längste Serie aufeinanderfolgender Tage (Liste von 'YYYY-MM-DD', sortiert). */
function streaks(days) {
  let best = { len: 0, from: null, to: null };
  let cur = { len: 0, from: null, to: null };
  let prev = null;
  for (const d of days) {
    const t = Date.parse(`${d}T12:00:00Z`);
    if (prev !== null && Math.round((t - prev) / 864e5) === 1) cur = { ...cur, len: cur.len + 1, to: d };
    else cur = { len: 1, from: d, to: d };
    if (cur.len > best.len) best = { ...cur };
    prev = t;
  }
  return best;
}

export async function wrapped(userId, year) {
  const args = [TZ(), userId, year];
  const [tot, arts, trks, months, hours, dows, daily, fresh, gen, first, prev] = await Promise.all([
    query(
      `WITH ${YEAR_CTE}
       SELECT COALESCE(sum(ms_played), 0) AS ms, count(*) AS plays, count(DISTINCT track_id) AS tracks,
              count(DISTINCT lower(artist)) AS artists, count(DISTINCT lt::date) AS days FROM p`,
      args,
    ),
    query(
      `WITH ${YEAR_CTE},
       agg AS (SELECT min(artist) AS name, (array_agg(artist_id) FILTER (WHERE artist_id IS NOT NULL))[1] AS id,
                      sum(ms_played) AS ms, count(*) AS plays
                 FROM p GROUP BY lower(artist) ORDER BY ms DESC LIMIT 5)
       SELECT agg.name, round(agg.ms / 60000.0)::int AS minutes, agg.plays, ai.image_url AS image
         FROM agg ${ARTIST_LOOKUP('agg.name', 'agg.id')} ORDER BY agg.ms DESC`,
      args,
    ),
    query(
      `WITH ${YEAR_CTE},
       agg AS (SELECT track_id, count(*) AS plays, sum(ms_played) AS ms FROM p GROUP BY track_id ORDER BY plays DESC, ms DESC LIMIT 5)
       SELECT t.id, t.name, array_to_string(t.artist_names, ', ') AS artists, t.album_image AS image,
              agg.plays, round(agg.ms / 60000.0)::int AS minutes
         FROM agg JOIN tracks t ON t.id = agg.track_id ORDER BY agg.plays DESC, agg.ms DESC`,
      args,
    ),
    query(`WITH ${YEAR_CTE} SELECT extract(month FROM lt)::int AS m, sum(ms_played) AS ms FROM p GROUP BY 1`, args),
    query(`WITH ${YEAR_CTE} SELECT extract(hour FROM lt)::int AS h, sum(ms_played) AS ms FROM p GROUP BY 1`, args),
    query(`WITH ${YEAR_CTE} SELECT extract(isodow FROM lt)::int AS d, sum(ms_played) AS ms FROM p GROUP BY 1`, args),
    query(`WITH ${YEAR_CTE} SELECT to_char(lt::date, 'YYYY-MM-DD') AS day, sum(ms_played) AS ms FROM p GROUP BY 1 ORDER BY 1`, args),
    // Künstler, die in diesem Jahr zum ersten Mal überhaupt gehört wurden
    query(
      `WITH ${YEAR_CTE},
       firsts AS (
         SELECT lower(t.artist_names[1]) AS k, min(pl.played_at) AS first
           FROM plays pl JOIN tracks t ON t.id = pl.track_id WHERE pl.user_id = $2 GROUP BY 1
       ),
       yr AS (SELECT lower(artist) AS k, min(artist) AS name,
                     (array_agg(artist_id) FILTER (WHERE artist_id IS NOT NULL))[1] AS id,
                     min(played_at) AS first_in_year, sum(ms_played) AS ms FROM p GROUP BY 1),
       fresh AS (SELECT yr.* FROM yr JOIN firsts f ON f.k = yr.k WHERE f.first = yr.first_in_year)
       SELECT (SELECT count(*) FROM fresh) AS n, b.name, round(b.ms / 60000.0)::int AS minutes, ai.image_url AS image
         FROM (SELECT * FROM fresh ORDER BY ms DESC LIMIT 1) b ${ARTIST_LOOKUP('b.name', 'b.id')}
       UNION ALL SELECT 0, NULL, NULL, NULL WHERE NOT EXISTS (SELECT 1 FROM fresh)`,
      args,
    ),
    query(
      `WITH ${YEAR_CTE}
       SELECT g.main_genre AS genre, sum(p.ms_played) AS ms
         FROM p JOIN artist_genres g ON g.name_key = lower(p.artist)
        WHERE g.main_genre IS NOT NULL GROUP BY 1 ORDER BY ms DESC`,
      args,
    ),
    query(
      `WITH ${YEAR_CTE}
       SELECT p.played_at, to_char(p.lt, 'YYYY-MM-DD"T"HH24:MI:SS') AS local_time, t.id, t.name, array_to_string(t.artist_names, ', ') AS artists, t.album_image AS image
         FROM p JOIN tracks t ON t.id = p.track_id ORDER BY p.played_at LIMIT 1`,
      args,
    ),
    query(`WITH ${YEAR_CTE.replace(/\$3::int/g, '($3::int - 1)')} SELECT COALESCE(sum(ms_played), 0) AS ms FROM p`, args),
  ]);
  const t = tot.rows[0];
  if (!t.plays) return { year, empty: true };
  const monthly = Array(12).fill(0);
  for (const r of months.rows) monthly[r.m - 1] = minutes(r.ms);
  const hourArr = Array(24).fill(0);
  for (const r of hours.rows) hourArr[r.h] = minutes(r.ms);
  const dowArr = Array(7).fill(0);
  for (const r of dows.rows) dowArr[r.d - 1] = minutes(r.ms);
  const bestDay = daily.rows.reduce((a, r) => (r.ms > (a?.ms ?? -1) ? r : a), null);
  const streak = streaks(daily.rows.map((r) => r.day));
  const genreTotal = gen.rows.reduce((a, r) => a + r.ms, 0);
  const f = fresh.rows[0];
  const prevMin = minutes(prev.rows[0].ms);
  return {
    year,
    empty: false,
    minutes: minutes(t.ms),
    plays: t.plays,
    tracks: t.tracks,
    artists: t.artists,
    activeDays: t.days,
    previousYearMinutes: prevMin || null,
    topArtists: arts.rows,
    topTracks: trks.rows,
    monthly,
    topMonth: monthly.indexOf(Math.max(...monthly)) + 1,
    peakHour: hourArr.indexOf(Math.max(...hourArr)),
    peakWeekday: dowArr.indexOf(Math.max(...dowArr)),
    bestDay: bestDay ? { day: bestDay.day, minutes: minutes(bestDay.ms) } : null,
    streak,
    newArtists: f.n,
    topDiscovery: f.name ? { name: f.name, minutes: f.minutes, image: f.image } : null,
    genres: gen.rows.slice(0, 5).map((r) => ({ genre: r.genre, share: genreTotal ? r.ms / genreTotal : 0, minutes: minutes(r.ms) })),
    firstSong: first.rows[0] || null,
  };
}

// ================================================================ Suche & Details

const likePattern = (q) => `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function search(userId, q) {
  const term = String(q || '').trim().slice(0, 80);
  if (term.length < 2) return { tracks: [], artists: [] };
  const like = likePattern(term);
  const [tracks, artists] = await Promise.all([
    query(
      `SELECT t.id, t.name, array_to_string(t.artist_names, ', ') AS artists, t.album_image AS image,
              count(*) AS plays, round(sum(pl.ms_played) / 60000.0)::int AS minutes,
              min(pl.played_at) AS first, max(pl.played_at) AS last
         FROM plays pl JOIN tracks t ON t.id = pl.track_id
        WHERE pl.user_id = $1
          AND (t.name ILIKE $2 OR array_to_string(t.artist_names, ' ') ILIKE $2 OR t.album_name ILIKE $2)
        GROUP BY t.id ORDER BY plays DESC, minutes DESC LIMIT 25`,
      [userId, like],
    ),
    query(
      `WITH agg AS (
         SELECT min(t.artist_names[1]) AS name, (array_agg(t.artist_ids[1]) FILTER (WHERE t.artist_ids[1] IS NOT NULL))[1] AS id,
                count(*) AS plays, sum(pl.ms_played) AS ms, count(DISTINCT t.id) AS tracks
           FROM plays pl JOIN tracks t ON t.id = pl.track_id
          WHERE pl.user_id = $1 AND t.artist_names[1] ILIKE $2
          GROUP BY lower(t.artist_names[1]) ORDER BY ms DESC LIMIT 8
       )
       SELECT agg.name, agg.plays, round(agg.ms / 60000.0)::int AS minutes, agg.tracks, ai.image_url AS image
         FROM agg ${ARTIST_LOOKUP('agg.name', 'agg.id')} ORDER BY agg.ms DESC`,
      [userId, like],
    ),
  ]);
  return { tracks: tracks.rows, artists: artists.rows };
}

async function favourites(userId, filterSql, params) {
  const { rows } = await query(
    `SELECT extract(hour FROM pl.played_at AT TIME ZONE $1)::int AS h, extract(isodow FROM pl.played_at AT TIME ZONE $1)::int AS d,
            count(*) AS n
       FROM plays pl JOIN tracks t ON t.id = pl.track_id WHERE pl.user_id = $2 AND ${filterSql} GROUP BY 1, 2`,
    [TZ(), userId, ...params],
  );
  const h = Array(24).fill(0);
  const d = Array(7).fill(0);
  for (const r of rows) { h[r.h] += r.n; d[r.d - 1] += r.n; }
  return { hour: rows.length ? h.indexOf(Math.max(...h)) : null, weekday: rows.length ? d.indexOf(Math.max(...d)) : null };
}

async function monthlySeries(userId, filterSql, params) {
  const { rows } = await query(
    `SELECT to_char(date_trunc('month', pl.played_at AT TIME ZONE $1), 'YYYY-MM') AS month, count(*) AS plays,
            round(sum(pl.ms_played) / 60000.0)::int AS minutes
       FROM plays pl JOIN tracks t ON t.id = pl.track_id WHERE pl.user_id = $2 AND ${filterSql}
      GROUP BY 1 ORDER BY 1`,
    [TZ(), userId, ...params],
  );
  return rows;
}

export async function trackDetail(userId, trackId) {
  const { rows } = await query(
    `SELECT t.id, t.name, array_to_string(t.artist_names, ', ') AS artists, t.artist_names[1] AS artist, t.album_name AS album,
            t.album_image AS image, t.duration_ms,
            count(pl.*) AS plays, round(COALESCE(sum(pl.ms_played), 0) / 60000.0)::int AS minutes,
            min(pl.played_at) AS first, max(pl.played_at) AS last
       FROM tracks t LEFT JOIN plays pl ON pl.track_id = t.id AND pl.user_id = $1
      WHERE t.id = $2 GROUP BY t.id`,
    [userId, trackId],
  );
  const tr = rows[0];
  if (!tr || !tr.plays) throw new UserError('Nicht gefunden.', 404, 'notFound');
  const [rank, fav, monthly, recent] = await Promise.all([
    query(
      `SELECT count(*) + 1 AS rank FROM (SELECT count(*) AS c FROM plays WHERE user_id = $1 GROUP BY track_id) x WHERE c > $2`,
      [userId, tr.plays],
    ),
    favourites(userId, 't.id = $3', [trackId]),
    monthlySeries(userId, 't.id = $3', [trackId]),
    query('SELECT played_at FROM plays WHERE user_id = $1 AND track_id = $2 ORDER BY played_at DESC LIMIT 8', [userId, trackId]),
  ]);
  return {
    type: 'track',
    ...tr,
    rank: rank.rows[0].rank,
    favourite: fav,
    monthly,
    recent: recent.rows.map((r) => r.played_at),
    url: `https://open.spotify.com/track/${encodeURIComponent(tr.id)}`,
  };
}

export async function artistDetail(userId, name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) throw new UserError('Nicht gefunden.', 404, 'notFound');
  const { rows } = await query(
    `WITH agg AS (
       SELECT min(t.artist_names[1]) AS name, (array_agg(t.artist_ids[1]) FILTER (WHERE t.artist_ids[1] IS NOT NULL))[1] AS id,
              count(*) AS plays, sum(pl.ms_played) AS ms, count(DISTINCT t.id) AS tracks,
              min(pl.played_at) AS first, max(pl.played_at) AS last
         FROM plays pl JOIN tracks t ON t.id = pl.track_id
        WHERE pl.user_id = $1 AND lower(t.artist_names[1]) = $2
     )
     SELECT agg.*, round(agg.ms / 60000.0)::int AS minutes, ai.image_url AS image,
            g.main_genre, COALESCE(g.styles, '{}') AS styles
       FROM agg ${ARTIST_LOOKUP('agg.name', 'agg.id')}
       LEFT JOIN artist_genres g ON g.name_key = $2
      WHERE agg.plays > 0`,
    [userId, key],
  );
  const a = rows[0];
  if (!a) throw new UserError('Nicht gefunden.', 404, 'notFound');
  const [rank, fav, monthly, top] = await Promise.all([
    query(
      `SELECT count(*) + 1 AS rank FROM (
         SELECT sum(pl.ms_played) AS ms FROM plays pl JOIN tracks t ON t.id = pl.track_id
          WHERE pl.user_id = $1 GROUP BY lower(t.artist_names[1])) x WHERE ms > $2`,
      [userId, a.ms],
    ),
    favourites(userId, 'lower(t.artist_names[1]) = $3', [key]),
    monthlySeries(userId, 'lower(t.artist_names[1]) = $3', [key]),
    query(
      `SELECT t.id, t.name, t.album_image AS image, count(*) AS plays, round(sum(pl.ms_played) / 60000.0)::int AS minutes
         FROM plays pl JOIN tracks t ON t.id = pl.track_id
        WHERE pl.user_id = $1 AND lower(t.artist_names[1]) = $2
        GROUP BY t.id ORDER BY plays DESC LIMIT 10`,
      [userId, key],
    ),
  ]);
  delete a.ms;
  return {
    type: 'artist',
    ...a,
    rank: rank.rows[0].rank,
    favourite: fav,
    monthly,
    topTracks: top.rows,
    url: a.id ? `https://open.spotify.com/artist/${encodeURIComponent(a.id)}` : null,
  };
}

// ================================================================ Meilensteine (Hörminuten & Tagesserie)

export const MINUTE_STEPS = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];
export const STREAK_STEPS = [3, 7, 14, 30, 50, 100, 200, 365];

export async function milestones(userId, seen = []) {
  const { rows } = await query(
    `SELECT to_char((played_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day, sum(ms_played) AS ms
       FROM plays WHERE user_id = $2 GROUP BY 1 ORDER BY 1`,
    [TZ(), userId],
  );
  const items = [];
  // Hörminuten: Datum, an dem die Summe die Schwelle überschritten hat
  let cum = 0;
  const minuteAt = new Map();
  for (const r of rows) {
    cum += r.ms / 60000;
    for (const m of MINUTE_STEPS) if (cum >= m && !minuteAt.has(m)) minuteAt.set(m, r.day);
  }
  const totalMinutes = Math.round(cum);
  for (const m of MINUTE_STEPS) items.push({ id: `min-${m}`, kind: 'minutes', value: m, achieved: minuteAt.has(m), at: minuteAt.get(m) || null });

  // Tagesserien
  let run = 0;
  let prev = null;
  let best = 0;
  const streakAt = new Map();
  for (const r of rows) {
    const t = Date.parse(`${r.day}T12:00:00Z`);
    run = prev !== null && Math.round((t - prev) / 864e5) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    for (const s of STREAK_STEPS) if (run >= s && !streakAt.has(s)) streakAt.set(s, r.day);
    prev = t;
  }
  const today = todayLocal();
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
  const lastDay = rows.at(-1)?.day;
  const current = lastDay === today || lastDay === yesterday ? run : 0;
  for (const s of STREAK_STEPS) items.push({ id: `streak-${s}`, kind: 'streak', value: s, achieved: streakAt.has(s), at: streakAt.get(s) || null });

  const nextOf = (steps, val) => {
    const next = steps.find((s) => s > val);
    const prevStep = [...steps].reverse().find((s) => s <= val) || 0;
    return next ? { value: next, progress: (val - prevStep) / (next - prevStep) } : null;
  };
  return {
    totalMinutes,
    currentStreak: current,
    activeToday: lastDay === today,
    bestStreak: best,
    items,
    next: { minutes: nextOf(MINUTE_STEPS, totalMinutes), streak: nextOf(STREAK_STEPS, current) },
    seen,
  };
}

export async function markMilestonesSeen(accountId, ids) {
  const clean = (Array.isArray(ids) ? ids : []).filter((x) => /^(min|streak)-\d{1,7}$/.test(String(x))).slice(0, 50);
  if (!clean.length) return;
  await query(
    `UPDATE accounts SET milestones_seen = ARRAY(SELECT DISTINCT x FROM unnest(milestones_seen || $2::text[]) x) WHERE id = $1`,
    [accountId, clean],
  );
}

// ================================================================ Freunde

const other = (me) => `CASE WHEN f.requester_id = ${me} THEN f.addressee_id ELSE f.requester_id END`;

export async function listFriends(accountId) {
  const { rows } = await query(
    `SELECT f.status, f.requester_id = $1 AS outgoing, f.created_at, f.accepted_at,
            a.id, a.username, a.spotify_user_id IS NOT NULL AS connected, u.avatar_url, u.display_name
       FROM friendships f
       JOIN accounts a ON a.id = ${other('$1')}
       LEFT JOIN users u ON u.id = a.spotify_user_id
      WHERE f.requester_id = $1 OR f.addressee_id = $1
      ORDER BY f.accepted_at DESC NULLS LAST, f.created_at DESC`,
    [accountId],
  );
  const pick = ({ id, username, connected, avatar_url, display_name, created_at, accepted_at }) =>
    ({ id, username, connected, avatar_url, display_name, created_at, accepted_at });
  return {
    friends: rows.filter((r) => r.status === 'accepted').map(pick),
    incoming: rows.filter((r) => r.status === 'pending' && !r.outgoing).map(pick),
    outgoing: rows.filter((r) => r.status === 'pending' && r.outgoing).map(pick),
  };
}

export async function requestFriend(accountId, username) {
  const name = String(username || '').trim();
  return withTransaction(async (db) => {
    const { rows } = await db.query('SELECT id, username FROM accounts WHERE lower(username) = lower($1)', [name]);
    const target = rows[0];
    if (!target) throw new UserError('Benutzer nicht gefunden.', 404, 'friendNotFound');
    if (target.id === accountId) throw new UserError('Das bist du selbst.', 400, 'friendSelf');
    const { rows: ex } = await db.query(
      `SELECT requester_id, status FROM friendships
        WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
      [accountId, target.id],
    );
    if (ex[0]?.status === 'accepted') throw new UserError('Ihr seid schon befreundet.', 409, 'friendAlready');
    if (ex[0] && ex[0].requester_id === accountId) throw new UserError('Anfrage wurde schon gesendet.', 409, 'friendPending');
    if (ex[0]) {
      // Gegenseitige Anfrage → direkt bestätigen
      await db.query(
        `UPDATE friendships SET status = 'accepted', accepted_at = now() WHERE requester_id = $1 AND addressee_id = $2`,
        [target.id, accountId],
      );
      return { status: 'accepted', username: target.username };
    }
    const { rows: cnt } = await db.query(
      'SELECT count(*) AS n FROM friendships WHERE requester_id = $1 OR addressee_id = $1',
      [accountId],
    );
    if (cnt[0].n >= 100) throw new UserError('Zu viele Freunde.', 400, 'friendLimit');
    await db.query('INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2)', [accountId, target.id]);
    return { status: 'pending', username: target.username };
  });
}

export async function acceptFriend(accountId, otherId) {
  const r = await query(
    `UPDATE friendships SET status = 'accepted', accepted_at = now()
      WHERE requester_id = $2 AND addressee_id = $1 AND status = 'pending'`,
    [accountId, otherId],
  );
  if (!r.rowCount) throw new UserError('Anfrage nicht gefunden.', 404, 'notFound');
}

export async function removeFriend(accountId, otherId) {
  await query(
    `DELETE FROM friendships WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
    [accountId, otherId],
  );
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(k) || 0;
    const y = b.get(k) || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

async function tasteOf(userId, days) {
  const [ov, artists, tracks, g, albums, hours] = await Promise.all([
    overview(userId, days),
    topArtists(userId, days, 50),
    topTracks(userId, days, 50),
    genreStats(userId, days),
    query(
      `SELECT min(t.album_name) AS name, min(t.artist_names[1]) AS artist,
              (array_agg(t.album_image) FILTER (WHERE t.album_image IS NOT NULL))[1] AS image,
              round(sum(pl.ms_played) / 60000.0)::int AS minutes
         FROM plays pl JOIN tracks t ON t.id = pl.track_id
        WHERE pl.user_id = $1 AND t.album_name IS NOT NULL
          AND ($2::int = 0 OR pl.played_at >= now() - make_interval(days => $2::int))
        GROUP BY lower(t.artist_names[1]), lower(t.album_name) ORDER BY sum(pl.ms_played) DESC LIMIT 5`,
      [userId, days],
    ),
    query(
      `SELECT extract(hour FROM pl.played_at AT TIME ZONE $3)::int AS hour, round(sum(pl.ms_played) / 60000.0)::int AS minutes
         FROM plays pl WHERE pl.user_id = $1 AND ($2::int = 0 OR pl.played_at >= now() - make_interval(days => $2::int))
        GROUP BY 1 ORDER BY sum(pl.ms_played) DESC LIMIT 5`,
      [userId, days, config.timezone],
    ),
  ]);
  return { ov, artists, tracks, genres: g.items, albums: albums.rows, hours: hours.rows };
}

/** Musikgeschmack mit einem Freund vergleichen (nur bei bestätigter Freundschaft). */
export async function compare(account, friendId, days) {
  const { rows } = await query(
    `SELECT a.id, a.username, a.spotify_user_id, u.avatar_url, u.display_name
       FROM friendships f JOIN accounts a ON a.id = $2
       LEFT JOIN users u ON u.id = a.spotify_user_id
      WHERE f.status = 'accepted'
        AND ((f.requester_id = $1 AND f.addressee_id = $2) OR (f.requester_id = $2 AND f.addressee_id = $1))`,
    [account.id, friendId],
  );
  const friend = rows[0];
  if (!friend) throw new UserError('Keine bestätigte Freundschaft.', 404, 'notFriends');
  if (!friend.spotify_user_id) throw new UserError('Dein Freund hat Spotify noch nicht verbunden.', 409, 'friendNoSpotify');
  const [me, fr] = await Promise.all([tasteOf(account.spotify_user_id, days), tasteOf(friend.spotify_user_id, days)]);

  const aMap = (list) => new Map(list.map((x) => [x.name.toLowerCase(), x.minutes]));
  const gMap = (list) => new Map(list.map((x) => [x.genre, x.share]));
  const artistSim = cosine(aMap(me.artists), aMap(fr.artists));
  const genreSim = cosine(gMap(me.genres), gMap(fr.genres));
  const hasGenres = me.genres.length && fr.genres.length;
  const match = Math.round(100 * (hasGenres ? 0.55 * Math.sqrt(artistSim) + 0.45 * genreSim : Math.sqrt(artistSim)));

  const frArtists = new Map(fr.artists.map((x, i) => [x.name.toLowerCase(), { ...x, rank: i + 1 }]));
  const sharedArtists = me.artists
    .map((x, i) => ({ x, i, f: frArtists.get(x.name.toLowerCase()) }))
    .filter((r) => r.f)
    .sort((a, b) => a.i + a.f.rank - (b.i + b.f.rank))
    .slice(0, 10)
    .map(({ x, i, f }) => ({ name: x.name, image: x.image || f.image, me: { minutes: x.minutes, rank: i + 1 }, friend: { minutes: f.minutes, rank: f.rank } }));
  const frTracks = new Map(fr.tracks.map((x, i) => [x.id, { ...x, rank: i + 1 }]));
  const sharedTracks = me.tracks
    .map((x, i) => ({ x, i, f: frTracks.get(x.id) }))
    .filter((r) => r.f)
    .sort((a, b) => a.i + a.f.rank - (b.i + b.f.rank))
    .slice(0, 10)
    .map(({ x, i, f }) => ({ id: x.id, name: x.name, artists: x.artists, image: x.image, me: { plays: x.plays, rank: i + 1 }, friend: { plays: f.plays, rank: f.rank } }));

  const allGenres = [...new Set([...me.genres.slice(0, 6), ...fr.genres.slice(0, 6)].map((g) => g.genre))];
  const side = (t) => ({
    minutes: t.ov.minutes,
    plays: t.ov.plays,
    artists: t.ov.artists,
    tracks: t.ov.tracks,
    topArtists: t.artists.slice(0, 5).map(({ name, image, minutes: m }) => ({ name, image, minutes: m })),
    topTracks: t.tracks.slice(0, 5).map(({ id, name, artists, image, plays }) => ({ id, name, artists, image, plays })),
    topAlbums: t.albums,
    topGenres: t.genres.slice(0, 5).map(({ genre, share }) => ({ genre, share })),
    topHours: t.hours,
    topGenre: t.genres[0]?.genre || null,
  });
  return {
    friend: { id: friend.id, username: friend.username, avatar_url: friend.avatar_url },
    match,
    artistSimilarity: artistSim,
    genreSimilarity: hasGenres ? genreSim : null,
    me: side(me),
    them: side(fr),
    sharedArtists,
    sharedArtistCount: me.artists.filter((x) => frArtists.has(x.name.toLowerCase())).length,
    sharedTracks,
    genres: allGenres.map((g) => ({
      genre: g,
      me: me.genres.find((x) => x.genre === g)?.share || 0,
      them: fr.genres.find((x) => x.genre === g)?.share || 0,
    })),
  };
}

// ================================================================ Playlist aus der Statistik

export const PLAYLIST_SCOPES = ['playlist-modify-private'];
export const NOW_PLAYING_SCOPES = ['user-read-currently-playing'];

async function userScope(userId) {
  const { rows } = await query('SELECT scope FROM users WHERE id = $1', [userId]);
  return rows[0]?.scope || '';
}

export const missingScopesFor = (scope) => missingScopes(scope, [...NOW_PLAYING_SCOPES, ...PLAYLIST_SCOPES]);

// Spotify hat im Feb. 2026 Pfade umbenannt – neue Pfade zuerst, alte als Rückfall.
async function postWithFallback(userId, paths, body) {
  let lastErr;
  for (const p of paths) {
    try {
      return await spotifyPost(userId, p, body);
    } catch (err) {
      lastErr = err;
      if (![404, 405].includes(err.status)) throw err;
    }
  }
  throw lastErr;
}

export async function createPlaylist(account, { days, size, name, description }) {
  const uid = account.spotify_user_id;
  if (missingScopes(await userScope(uid), PLAYLIST_SCOPES).length) {
    throw new UserError('Für Playlists muss Spotify neu verbunden werden.', 409, 'needsReauth');
  }
  const n = [10, 25, 50, 100].includes(Number(size)) ? Number(size) : 25;
  const top = (await topTracks(uid, days, n)).filter((t) => /^[0-9A-Za-z]{22}$/.test(t.id));
  if (!top.length) throw new UserError('Keine Songs im Zeitraum.', 400, 'playlistEmpty');
  const title = String(name || 'Spotlfy').trim().slice(0, 100) || 'Spotlfy';
  let pl;
  try {
    pl = await postWithFallback(uid, ['/me/playlists', `/users/${encodeURIComponent(uid)}/playlists`], {
      name: title,
      description: String(description || '').slice(0, 300),
      public: false,
    });
    const uris = top.map((t) => `spotify:track:${t.id}`);
    for (let i = 0; i < uris.length; i += 100) {
      await postWithFallback(uid, [`/playlists/${pl.id}/items`, `/playlists/${pl.id}/tracks`], { uris: uris.slice(i, i + 100) });
    }
  } catch (err) {
    if (err.code === 'AUTH_EXPIRED') throw err;
    console.error('[playlist]', err.message);
    if (err.status === 403) throw new UserError('Spotify erlaubt das Anlegen nicht.', 403, 'playlistForbidden');
    throw new UserError('Playlist konnte nicht erstellt werden.', 502, 'playlistFailed');
  }
  const url = pl.external_urls?.spotify || `https://open.spotify.com/playlist/${pl.id}`;
  await query(
    'INSERT INTO created_playlists (account_id, spotify_playlist_id, name, url, track_count) VALUES ($1, $2, $3, $4, $5)',
    [account.id, pl.id, title, url, top.length],
  );
  return { id: pl.id, name: title, url, count: top.length, image: top[0]?.image || null };
}

export async function recentPlaylists(accountId) {
  const { rows } = await query(
    'SELECT spotify_playlist_id AS id, name, url, track_count, created_at FROM created_playlists WHERE account_id = $1 ORDER BY created_at DESC LIMIT 5',
    [accountId],
  );
  return rows;
}

// ================================================================ Aktuell läuft

const nowCache = new Map();

export async function nowPlaying(userId) {
  const hit = nowCache.get(userId);
  if (hit && Date.now() - hit.at < 10_000) return hit.data;
  if (missingScopes(await userScope(userId), NOW_PLAYING_SCOPES).length) return { needsReauth: true, playing: false };
  let data = { playing: false };
  try {
    const r = await spotifyGet(userId, '/me/player/currently-playing?market=from_token', { retries: 1 });
    const it = r?.item;
    if (it && r.currently_playing_type === 'track') {
      const { rows } = await query('SELECT count(*) AS n FROM plays WHERE user_id = $1 AND track_id = $2', [userId, it.id]);
      data = {
        playing: true,
        is_playing: Boolean(r.is_playing),
        progress_ms: r.progress_ms || 0,
        duration_ms: it.duration_ms || 0,
        track: {
          id: it.id,
          name: it.name,
          artists: (it.artists || []).map((a) => a.name).join(', '),
          album: it.album?.name || null,
          image: bestImage(it.album?.images),
          url: it.external_urls?.spotify || `https://open.spotify.com/track/${it.id}`,
        },
        timesPlayed: rows[0].n,
      };
    }
  } catch (err) {
    if (err.code === 'AUTH_EXPIRED') throw err;
    if (err.status === 401 || err.status === 403) data = { needsReauth: true, playing: false };
    else console.warn('[now-playing]', err.message);
  }
  nowCache.set(userId, { at: Date.now(), data });
  if (nowCache.size > 500) nowCache.clear();
  return data;
}

// ================================================================ Datenexport (DSGVO Art. 15/20)

export async function exportData(accountId) {
  const { rows: acc } = await query(
    `SELECT a.id, a.username, a.is_admin, a.created_at, a.last_login_at, a.login_count, a.theme, a.lang, a.festive,
            to_char(a.birthday, 'YYYY-MM-DD') AS birthday, a.privacy_accepted_at, a.milestones_seen, a.spotify_user_id
       FROM accounts a WHERE a.id = $1`,
    [accountId],
  );
  const a = acc[0];
  if (!a) throw new UserError('Konto nicht gefunden.', 404, 'accountNotFound');
  const sid = a.spotify_user_id;
  const [sp, plays, snaps, friends, playlists, logins, notes, records] = await Promise.all([
    sid
      ? query('SELECT id, display_name, email, country, product, avatar_url, scope, created_at, last_login_at FROM users WHERE id = $1', [sid])
      : { rows: [] },
    sid
      ? query(
          `SELECT pl.played_at, pl.ms_played, pl.source, pl.track_id, t.name AS track, t.artist_names AS artists, t.album_name AS album
             FROM plays pl JOIN tracks t ON t.id = pl.track_id WHERE pl.user_id = $1 ORDER BY pl.played_at`,
          [sid],
        )
      : { rows: [] },
    sid
      ? query(
          `SELECT snapshot_date, kind, time_range, rank, item_id, name, subtitle FROM top_snapshots
            WHERE user_id = $1 ORDER BY snapshot_date, kind, time_range, rank`,
          [sid],
        )
      : { rows: [] },
    listFriends(accountId),
    query('SELECT spotify_playlist_id, name, url, track_count, created_at FROM created_playlists WHERE account_id = $1', [accountId]),
    query('SELECT at, user_agent FROM login_events WHERE account_id = $1 ORDER BY at DESC', [accountId]),
    query('SELECT key, bronze, silver, gold, platinum, created_at FROM note_ledger WHERE account_id = $1 ORDER BY id', [accountId]),
    query('SELECT record_id, rarity, artist, album, acquired_at FROM record_collection WHERE account_id = $1 ORDER BY acquired_at', [accountId]),
  ]);
  delete a.spotify_user_id;
  return {
    format: 'spotlfy-export',
    exported_at: new Date().toISOString(),
    account: a,
    spotify: sp.rows[0] || null,
    friends: {
      friends: friends.friends.map((f) => f.username),
      incoming: friends.incoming.map((f) => f.username),
      outgoing: friends.outgoing.map((f) => f.username),
    },
    created_playlists: playlists.rows,
    logins: logins.rows,
    music_notes: notes.rows,
    record_collection: records.rows,
    top_snapshots: snaps.rows,
    plays: plays.rows,
  };
}


/** Sammlung (Platten & CD-Singles) eines bestätigten Freundes – nur ansehen. */
export async function friendCollection(account, friendId) {
  const { rows } = await query(
    `SELECT a.id, a.username FROM friendships f JOIN accounts a ON a.id = $2
      WHERE f.status = 'accepted'
        AND ((f.requester_id = $1 AND f.addressee_id = $2) OR (f.requester_id = $2 AND f.addressee_id = $1))`,
    [account.id, friendId],
  );
  if (!rows[0]) throw new UserError('Keine bestätigte Freundschaft.', 404, 'notFriends');
  const { rows: items } = await query(
    `SELECT record_id AS id, kind, rarity, artist, album, album_id, image, hue, price, acquired_at
       FROM record_collection WHERE account_id = $1 ORDER BY acquired_at DESC`,
    [friendId],
  );
  return { friend: rows[0], collection: items };
}
