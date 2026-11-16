// Bekanntheit von Alben und Songs → bestimmt die Seltenheit im Plattenladen.
// Echte Verkaufszahlen oder Gold-/Platin-Auszeichnungen gibt es nicht frei abrufbar. Als bestes freies Maß
// für Bekanntheit/Erfolg nimmt Spotlfy:
//   • Deezer: Fans eines Albums, „Rank“ (Beliebtheitswert 0–1.000.000) eines Songs bzw. des stärksten Album-Songs
//   • Spotify-Popularität (0–100), soweit Spotify sie für die App liefert
// Daraus wird ein Wert 0–100. Ergebnisse werden in `fame` gespeichert (nach 60 Tagen aufgefrischt).
import { query } from './db.js';
import { norm } from './covers.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fameKey = (kind, artist, title) => `${kind === 'cd' ? 'cd' : 'record'}|${norm(artist)}|${norm(title)}`;

// Schwellen: so gut wie jeder kennt es → mythisch … Geheimtipp → gewöhnlich
const STEPS = [['mythic', 95], ['legendary', 85], ['epic', 70], ['rare', 50]];
export function fameRarity(score) {
  if (score == null) return null;
  for (const [r, min] of STEPS) if (score >= min) return r;
  return 'common';
}

const clamp = (v) => Math.max(0, Math.min(100, v));
const fansScore = (fans) => clamp((Math.log10((fans || 0) + 1) - 2) * 25); // 100 Fans → 0, 1 Mio. → 100
const rankScore = (rank) => clamp((rank || 0) / 10000); // Deezer-Rank 1.000.000 → 100

async function getJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
  if (res.status === 429) { const e = new Error('Rate-Limit'); e.status = 429; throw e; }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  if (d?.error?.code === 4) { const e = new Error('Quota'); e.status = 429; throw e; } // Deezer: zu viele Anfragen
  return d;
}

const sameText = (a, b) => { const x = norm(a); const y = norm(b); return x && y && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `)); };

async function deezerAlbum(artist, album) {
  const d = await getJSON(`https://api.deezer.com/search/album?limit=10&q=${encodeURIComponent(`artist:"${artist}" album:"${album}"`)}`);
  const hit = (d.data || []).find((x) => norm(x.artist?.name) === norm(artist) && sameText(x.title, album));
  if (!hit) return null;
  const full = await getJSON(`https://api.deezer.com/album/${hit.id}`);
  const ranks = (full.tracks?.data || []).map((t) => t.rank || 0);
  return { fans: full.fans || 0, rank: ranks.length ? Math.max(...ranks) : 0 };
}

async function deezerTrack(artist, title) {
  const d = await getJSON(`https://api.deezer.com/search?limit=10&q=${encodeURIComponent(`artist:"${artist}" track:"${title}"`)}`);
  const hit = (d.data || []).find((x) => norm(x.artist?.name) === norm(artist) && sameText(x.title, title));
  return hit ? { rank: hit.rank || 0 } : null;
}

/** Bekanntheit nachschlagen und berechnen (null, wenn nirgends gefunden). */
async function measure(kind, artist, title) {
  let deezer = null;
  try { deezer = kind === 'cd' ? await deezerTrack(artist, title) : await deezerAlbum(artist, title); } catch (err) { if (err.status === 429) throw err; }
  // Spotify-Popularität aus der eigenen Datenbank (falls Spotify sie liefert)
  const { rows } = await query(
    kind === 'cd'
      ? 'SELECT max(popularity) AS pop FROM tracks WHERE lower(name) = lower($2) AND lower(artist_names[1]) = lower($1)'
      : 'SELECT max(popularity) AS pop FROM tracks WHERE lower(album_name) = lower($2) AND lower(artist_names[1]) = lower($1)',
    [artist, title],
  );
  const pop = rows[0]?.pop ?? null;
  let score = null;
  if (deezer) {
    const dz = kind === 'cd' ? rankScore(deezer.rank) : 0.6 * fansScore(deezer.fans) + 0.4 * rankScore(deezer.rank);
    score = pop != null ? 0.6 * dz + 0.4 * pop : dz;
  } else if (pop != null) score = pop;
  return { score: score == null ? null : Math.round(score), fans: deezer?.fans ?? null, rank: deezer?.rank ?? null, pop };
}

/** Gespeicherte Bekanntheit für viele Schlüssel auf einmal. */
export async function fameMap(keys) {
  const list = [...new Set(keys)];
  if (!list.length) return new Map();
  const { rows } = await query('SELECT key, score, fans, rank, pop FROM fame WHERE key = ANY($1)', [list]);
  return new Map(rows.map((r) => [r.key, r]));
}

/** Hängt Bekanntheit + daraus folgende Seltenheit an Laden-/Sammlungsstücke (kind, artist, album). */
export async function attachFame(items) {
  const map = await fameMap(items.map((it) => fameKey(it.kind, it.artist, it.album)));
  for (const it of items) {
    const f = map.get(fameKey(it.kind, it.artist, it.album));
    it.fameRarity = f?.score != null ? fameRarity(f.score) : null;
    it.fame = f ? { score: f.score, fans: f.fans != null ? Number(f.fans) : null, rank: f.rank } : null;
  }
  return items;
}

/**
 * Hintergrund-Job: misst die Bekanntheit der meistgehörten Alben und Songs, die noch keinen (aktuellen) Wert haben.
 * Wird beim Nachladen der Cover mit ausgeführt; schont Deezer (3 parallel, kleine Pausen, Abbruch bei Rate-Limit).
 */
export async function fameJob({ limit = 400 } = {}) {
  const [albums, tracks] = await Promise.all([
    query(
      `SELECT min(t.artist_names[1]) AS artist, min(t.album_name) AS title, count(*) AS n
         FROM plays p JOIN tracks t ON t.id = p.track_id
        WHERE t.album_name IS NOT NULL AND t.album_name <> '' AND cardinality(t.artist_names) > 0
        GROUP BY lower(t.artist_names[1]), lower(t.album_name) ORDER BY n DESC LIMIT 3000`,
    ),
    query(
      `SELECT min(t.artist_names[1]) AS artist, min(t.name) AS title, count(*) AS n
         FROM plays p JOIN tracks t ON t.id = p.track_id
        WHERE cardinality(t.artist_names) > 0
        GROUP BY lower(t.artist_names[1]), lower(t.name) ORDER BY n DESC LIMIT 6000`,
    ),
  ]);
  const cands = [
    ...albums.rows.map((r) => ({ kind: 'record', artist: r.artist, title: r.title, n: Number(r.n) })),
    ...tracks.rows.map((r) => ({ kind: 'cd', artist: r.artist, title: r.title, n: Number(r.n) })),
  ];
  // auch die „Höranstoß“-Stücke (noch nie gehört) aus dem Wochen-Cache
  try {
    const { rows } = await query(`SELECT items FROM discover_cache WHERE fetched_at > now() - interval '14 days'`);
    for (const r of rows) {
      for (const a of r.items?.albums || []) if (a.artist && a.name) cands.push({ kind: 'record', artist: a.artist, title: a.name, n: 0 });
      for (const t of r.items?.tracks || []) if (t.artist && t.name) cands.push({ kind: 'cd', artist: t.artist, title: t.name, n: 0 });
    }
  } catch { /* Tabelle evtl. leer */ }
  const keys = cands.map((c) => fameKey(c.kind, c.artist, c.title));
  const { rows: known } = await query(
    `SELECT key FROM fame WHERE key = ANY($1) AND checked_at > now() - CASE WHEN score IS NULL THEN interval '14 days' ELSE interval '60 days' END`,
    [keys],
  );
  const have = new Set(known.map((r) => r.key));
  const seen = new Set();
  const todo = [];
  cands.forEach((c, i) => {
    const k = keys[i];
    if (have.has(k) || seen.has(k)) return;
    seen.add(k);
    todo.push({ ...c, key: k });
  });
  // Alben und Songs abwechselnd, meistgehörte zuerst
  todo.sort((a, b) => b.n - a.n);
  const batch = todo.slice(0, limit);
  let done = 0;
  let i = 0;
  let stop = false;
  const worker = async () => {
    while (!stop && i < batch.length) {
      const c = batch[i++];
      try {
        const m = await measure(c.kind, c.artist, c.title);
        await query(
          `INSERT INTO fame (key, kind, artist, title, score, fans, rank, pop, checked_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
           ON CONFLICT (key) DO UPDATE SET score = EXCLUDED.score, fans = EXCLUDED.fans, rank = EXCLUDED.rank, pop = EXCLUDED.pop, checked_at = now()`,
          [c.key, c.kind, c.artist, c.title, m.score, m.fans, m.rank, m.pop],
        );
        done++;
      } catch (err) {
        if (err.status === 429) { stop = true; console.warn('[fame] Deezer bremst – Rest beim nächsten Lauf'); }
      }
      await sleep(180);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { measured: done, open: Math.max(0, todo.length - done) };
}
