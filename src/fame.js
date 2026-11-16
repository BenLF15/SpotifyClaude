// Bekanntheit & Status von Alben und Songs → bestimmt die Seltenheit im Plattenladen.
// Echte Verkaufszahlen gibt es nicht frei abrufbar. Spotlfy kombiniert deshalb alles, was frei verfügbar ist:
//   1. Beliebtheit des Stücks:  Deezer (Album-Fans, „Rank“ 0–1.000.000), Spotify-Popularität (falls geliefert),
//                               Last.fm-Hörer (nur mit LASTFM_API_KEY)
//   2. Status des Künstlers:    Deezer-Fans, Wikidata (Wikipedia-Sprachen, Auszeichnungen), Last.fm-Hörer
//   3. Kultureller Status:      Wikidata – in wie vielen Wikipedia-Sprachen es einen Artikel gibt und wie viele
//                               Auszeichnungen/Zertifizierungen (Grammy, Gold, Platin …) eingetragen sind
//   4. Aktuell in den Charts:   Deezer-Weltcharts (Top 100 Songs/Alben) → Bonus
// Gewichtung (nur vorhandene Werte zählen): Stück 50 %, Künstler 20 %, Kultur 30 %, + Charts-Bonus.
// An die Dienste gehen nur Künstler- und Titelnamen, keine Nutzerdaten.
import { getJSON as getJSONShared } from './apiclient.js';
import { query } from './db.js';
import { norm } from './covers.js';

export const FAME_VERSION = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fameKey = (kind, artist, title) => `${kind === 'cd' ? 'cd' : 'record'}|${norm(artist)}|${norm(title)}`;
const artistKey = (artist) => `artist|${norm(artist)}|`;

// Schwellen: so gut wie jeder kennt es → mythisch … Geheimtipp → gewöhnlich
const STEPS = [['mythic', 95], ['legendary', 85], ['epic', 70], ['rare', 50]];
export function fameRarity(score) {
  if (score == null) return null;
  for (const [r, min] of STEPS) if (score >= min) return r;
  return 'common';
}

const clamp = (v) => Math.max(0, Math.min(100, v));
const logScore = (n, zeroAt, hundredAt) => (n == null ? null : clamp(((Math.log10(Number(n) + 1) - Math.log10(zeroAt)) / (Math.log10(hundredAt) - Math.log10(zeroAt))) * 100));
const avg = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const wikiScore = (links, awards) => (links == null ? null : clamp(links * 2.2 + Math.min(awards || 0, 10) * 6)); // ~45 Sprachen → 100

// Titel aufräumen: „(Deluxe Edition)“, „- Remastered 2011“ usw. stören beim Nachschlagen
const cleanTitle = (s) => String(s || '').replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s+-\s+.*$/, '').trim();

const getJSON = (url, headers = {}) => getJSONShared(url, { headers, timeout: 10_000 });
const sameText = (a, b) => { const x = norm(a); const y = norm(b); return x && y && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `)); };

// ---------------------------------------------------------------- Deezer
async function deezerAlbum(artist, album) {
  const d = await getJSON(`https://api.deezer.com/search/album?limit=10&q=${encodeURIComponent(`artist:"${artist}" album:"${cleanTitle(album)}"`)}`);
  const hit = (d.data || []).find((x) => norm(x.artist?.name) === norm(artist) && sameText(x.title, album));
  if (!hit) return null;
  const full = await getJSON(`https://api.deezer.com/album/${hit.id}`);
  const ranks = (full.tracks?.data || []).map((t) => t.rank || 0);
  return { id: hit.id, artistId: hit.artist?.id, fans: full.fans || 0, rank: ranks.length ? Math.max(...ranks) : 0 };
}
async function deezerTrack(artist, title) {
  const d = await getJSON(`https://api.deezer.com/search?limit=10&q=${encodeURIComponent(`artist:"${artist}" track:"${cleanTitle(title)}"`)}`);
  const hit = (d.data || []).find((x) => norm(x.artist?.name) === norm(artist) && sameText(x.title, title));
  return hit ? { id: hit.id, artistId: hit.artist?.id, rank: hit.rank || 0 } : null;
}
async function deezerArtistFans(artistId, artist) {
  let id = artistId;
  if (!id) {
    const d = await getJSON(`https://api.deezer.com/search/artist?limit=5&q=${encodeURIComponent(artist)}`);
    id = (d.data || []).find((x) => norm(x.name) === norm(artist))?.id;
  }
  if (!id) return null;
  const a = await getJSON(`https://api.deezer.com/artist/${id}`);
  return a?.nb_fan ?? null;
}
// Weltcharts (Top 100), 12 h zwischengespeichert
const charts = { at: 0, tracks: new Set(), albums: new Set() };
async function deezerCharts() {
  if (Date.now() - charts.at < 12 * 3600_000) return charts;
  try {
    const [t, a] = await Promise.all([getJSON('https://api.deezer.com/chart/0/tracks?limit=100'), getJSON('https://api.deezer.com/chart/0/albums?limit=100')]);
    charts.tracks = new Set((t.data || []).map((x) => x.id));
    charts.albums = new Set((a.data || []).map((x) => x.id));
    charts.at = Date.now();
  } catch { /* ohne Charts weiter */ }
  return charts;
}

// ---------------------------------------------------------------- Wikidata (Wikipedia-Sprachen, Auszeichnungen)
const WD_HEADERS = { Accept: 'application/sparql-results+json', 'User-Agent': 'Spotlfy/1.0 (private music statistics app)' };
const lit = (s) => JSON.stringify(String(s)).slice(1, -1).replace(/'/g, "\\'");
const labels = (s) => ['en', 'de', 'fr', 'es', 'it', 'sv', 'da', 'pt'].map((l) => `"${lit(s)}"@${l}`).join(' ');
async function sparql(q) {
  const d = await getJSON(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, WD_HEADERS);
  return d?.results?.bindings || [];
}
async function wikiWork(kind, artist, title) {
  const t = cleanTitle(title);
  const types = kind === 'cd' ? 'wd:Q7366 wd:Q134556 wd:Q105543609 wd:Q2188189' : 'wd:Q482994 wd:Q208569 wd:Q169930 wd:Q222910';
  const rows = await sparql(`SELECT ?item (COUNT(DISTINCT ?sl) AS ?links) (COUNT(DISTINCT ?aw) AS ?awards) WHERE {
    VALUES ?l { ${labels(t)} } VALUES ?type { ${types} }
    ?item rdfs:label ?l ; wdt:P31 ?type ; wdt:P175 ?p .
    ?p rdfs:label ?pl . FILTER(LCASE(STR(?pl)) = "${lit(String(artist).toLowerCase())}")
    OPTIONAL { ?sl schema:about ?item ; schema:isPartOf/wikibase:wikiGroup "wikipedia" . }
    OPTIONAL { ?item wdt:P166 ?aw . }
  } GROUP BY ?item ORDER BY DESC(?links) LIMIT 1`);
  const r = rows[0];
  return r ? { links: Number(r.links.value), awards: Number(r.awards.value) } : null;
}
async function wikiArtist(artist) {
  const rows = await sparql(`SELECT ?p (COUNT(DISTINCT ?sl) AS ?links) (COUNT(DISTINCT ?aw) AS ?awards) WHERE {
    VALUES ?l { ${labels(artist)} }
    ?p rdfs:label ?l . ?w wdt:P175 ?p .
    OPTIONAL { ?sl schema:about ?p ; schema:isPartOf/wikibase:wikiGroup "wikipedia" . }
    OPTIONAL { ?p wdt:P166 ?aw . }
  } GROUP BY ?p ORDER BY DESC(?links) LIMIT 1`);
  const r = rows[0];
  return r ? { links: Number(r.links.value), awards: Number(r.awards.value) } : null;
}

// ---------------------------------------------------------------- Last.fm (optional, nur mit Schlüssel)
async function lastfm(method, params) {
  const key = process.env.LASTFM_API_KEY;
  if (!key) return null;
  const qs = new URLSearchParams({ method, api_key: key, format: 'json', autocorrect: '1', ...params });
  try { return await getJSON(`https://ws.audioscrobbler.com/2.0/?${qs}`); } catch (err) { if (err.status === 429) throw err; return null; }
}

// ---------------------------------------------------------------- Künstler-Status (pro Künstler einmal, gespeichert)
async function artistStatus(artist, deezerArtistId) {
  const key = artistKey(artist);
  const { rows } = await query(`SELECT score, fans, parts FROM fame WHERE key = $1 AND v >= $2 AND checked_at > now() - interval '60 days'`, [key, FAME_VERSION]);
  if (rows[0]) return rows[0];
  const [fans, wiki, lf, sp] = await Promise.all([
    deezerArtistFans(deezerArtistId, artist).catch((e) => { if (e.status === 429) throw e; return null; }),
    wikiArtist(artist).catch(() => null),
    lastfm('artist.getinfo', { artist }),
    query('SELECT max(popularity) AS pop FROM tracks WHERE lower(artist_names[1]) = lower($1)', [artist]).then((r) => r.rows[0]?.pop ?? null),
  ]);
  const listeners = lf?.artist?.stats?.listeners != null ? Number(lf.artist.stats.listeners) : null;
  const parts = { fans, links: wiki?.links ?? null, awards: wiki?.awards ?? null, listeners };
  const score = avg([logScore(fans, 1e3, 2e7), wikiScore(wiki?.links, wiki?.awards), logScore(listeners, 1e3, 1e7), sp]);
  const s = score == null ? null : Math.round(score);
  await query(
    `INSERT INTO fame (key, kind, artist, title, score, fans, parts, v, checked_at) VALUES ($1, 'artist', $2, '', $3, $4, $5, $6, now())
     ON CONFLICT (key) DO UPDATE SET score = EXCLUDED.score, fans = EXCLUDED.fans, parts = EXCLUDED.parts, v = EXCLUDED.v, checked_at = now()`,
    [key, artist, s, fans, JSON.stringify(parts), FAME_VERSION],
  );
  return { score: s, fans, parts };
}

/** Bekanntheit & Status eines Albums oder Songs messen. */
async function measure(kind, artist, title) {
  const dz = await (kind === 'cd' ? deezerTrack(artist, title) : deezerAlbum(artist, title)).catch((e) => { if (e.status === 429) throw e; return null; });
  const [wiki, lf, popRow, ch, art] = await Promise.all([
    wikiWork(kind, artist, title).catch(() => null),
    kind === 'cd' ? lastfm('track.getinfo', { artist, track: cleanTitle(title) }) : lastfm('album.getinfo', { artist, album: cleanTitle(title) }),
    query(
      kind === 'cd'
        ? 'SELECT max(popularity) AS pop FROM tracks WHERE lower(name) = lower($2) AND lower(artist_names[1]) = lower($1)'
        : 'SELECT max(popularity) AS pop FROM tracks WHERE lower(album_name) = lower($2) AND lower(artist_names[1]) = lower($1)',
      [artist, title],
    ),
    deezerCharts(),
    artistStatus(artist, dz?.artistId),
  ]);
  const pop = popRow.rows[0]?.pop ?? null;
  const listeners = Number((kind === 'cd' ? lf?.track?.listeners : lf?.album?.listeners) ?? NaN);
  const itemScore = avg([
    dz ? (kind === 'cd' ? clamp(dz.rank / 10000) : 0.6 * logScore(dz.fans, 100, 1e6) + 0.4 * clamp(dz.rank / 10000)) : null,
    pop,
    Number.isFinite(listeners) ? logScore(listeners, 1e3, 5e6) : null,
  ]);
  const culture = wikiScore(wiki?.links, wiki?.awards);
  const charted = Boolean(dz && (kind === 'cd' ? ch.tracks.has(dz.id) : ch.albums.has(dz.id)));
  const parts = {
    item: itemScore == null ? null : Math.round(itemScore), artist: art?.score ?? null, culture: culture == null ? null : Math.round(culture),
    links: wiki?.links ?? null, awards: wiki?.awards ?? null, artistFans: art?.fans != null ? Number(art.fans) : null,
    listeners: Number.isFinite(listeners) ? listeners : null, charted,
  };
  const W = [[parts.item, 0.5], [parts.artist, 0.2], [parts.culture, 0.3]].filter(([v]) => v != null);
  let score = W.length ? W.reduce((a, [v, w]) => a + v * w, 0) / W.reduce((a, [, w]) => a + w, 0) : null;
  if (score != null && charted) score = clamp(score + 8);
  return { score: score == null ? null : Math.round(score), fans: dz?.fans ?? null, rank: dz?.rank ?? null, pop, parts };
}

/** Gespeicherte Bekanntheit für viele Schlüssel auf einmal. */
export async function fameMap(keys) {
  const list = [...new Set(keys)];
  if (!list.length) return new Map();
  const { rows } = await query('SELECT key, score, fans, rank, parts FROM fame WHERE key = ANY($1)', [list]);
  return new Map(rows.map((r) => [r.key, r]));
}

/** Hängt Bekanntheit + daraus folgende Seltenheit an Laden-/Sammlungsstücke (kind, artist, album). */
export async function attachFame(items) {
  const map = await fameMap(items.map((it) => fameKey(it.kind, it.artist, it.album)));
  for (const it of items) {
    const f = map.get(fameKey(it.kind, it.artist, it.album));
    it.fameRarity = f?.score != null ? fameRarity(f.score) : null;
    it.fame = f ? { score: f.score, fans: f.fans != null ? Number(f.fans) : null, rank: f.rank, parts: f.parts || null } : null;
  }
  return items;
}

/**
 * Hintergrund-Job: misst Bekanntheit & Status der meistgehörten Alben und Songs ohne (aktuellen) Wert.
 * Läuft beim Nachladen der Cover mit; schont die Dienste (2 parallel, Pausen, Abbruch bei Rate-Limit).
 */
export async function fameJob({ limit = 250 } = {}) {
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
  try {
    const { rows } = await query(`SELECT items FROM discover_cache WHERE fetched_at > now() - interval '14 days'`);
    for (const r of rows) {
      for (const a of r.items?.albums || []) if (a.artist && a.name) cands.push({ kind: 'record', artist: a.artist, title: a.name, n: 0 });
      for (const t of r.items?.tracks || []) if (t.artist && t.name) cands.push({ kind: 'cd', artist: t.artist, title: t.name, n: 0 });
    }
  } catch { /* Tabelle evtl. leer */ }
  const keys = cands.map((c) => fameKey(c.kind, c.artist, c.title));
  const { rows: known } = await query(
    `SELECT key FROM fame WHERE key = ANY($1) AND v >= $2
        AND checked_at > now() - CASE WHEN score IS NULL THEN interval '14 days' ELSE interval '60 days' END`,
    [keys, FAME_VERSION],
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
          `INSERT INTO fame (key, kind, artist, title, score, fans, rank, pop, parts, v, checked_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
           ON CONFLICT (key) DO UPDATE SET score = EXCLUDED.score, fans = EXCLUDED.fans, rank = EXCLUDED.rank, pop = EXCLUDED.pop,
             parts = EXCLUDED.parts, v = EXCLUDED.v, checked_at = now()`,
          [c.key, c.kind, c.artist, c.title, m.score, m.fans, m.rank, m.pop, JSON.stringify(m.parts), FAME_VERSION],
        );
        done++;
      } catch (err) {
        if (err.status === 429) { stop = true; console.warn('[fame] ein Dienst bremst – Rest beim nächsten Lauf'); }
      }
      await sleep(250);
    }
  };
  await Promise.all([worker(), worker()]);
  return { measured: done, open: Math.max(0, todo.length - done) };
}
