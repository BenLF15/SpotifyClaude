// Eigene Genre-Einordnung (unabhängig von Spotify):
// 1. Für jeden Künstler werden die offenen Genre-Tags aus MusicBrainz geholt (frei, ohne API-Key).
// 2. Spotlfy ordnet diese Tags selbst einer festen Liste offizieller Hauptgenres zu (Klassifizierer unten).
// 3. Jeder Song erbt das Hauptgenre seines Hauptkünstlers.
import { config } from './config.js';
import { query } from './db.js';

// ---------------------------------------------------------------- Taxonomie
// Reihenfolge = feste Farbzuordnung im Frontend (Farbe folgt dem Genre, nicht dem Rang).
export const MAIN_GENRES = [
  'Pop',
  'Hip-Hop & Rap',
  'Rock',
  'Electronic & Dance',
  'R&B & Soul',
  'Indie & Alternative',
  'Jazz',
  'Klassik',
  'Country & Folk',
  'Metal',
  'Latin',
  'Reggae & Dancehall',
  'Blues',
  'Schlager & Volksmusik',
  'Soundtrack',
];

// Muster je Hauptgenre. Längere/spezifischere Muster werden zuerst geprüft
// (z. B. „trip hop“ → Electronic, bevor „hip hop“ greift; „pop rock“ → Rock).
const RULES = {
  'Hip-Hop & Rap': ['hip hop', 'hip-hop', 'hiphop', 'rap', 'trap', 'drill', 'grime', 'boom bap', 'gangsta', 'deutschrap', 'cloud rap', 'horrorcore', 'crunk', 'g-funk'],
  'Electronic & Dance': [
    'trip hop', 'trip-hop', 'electronic', 'electronica', 'electro', 'house', 'techno', 'trance', 'edm', 'dance', 'dubstep',
    'drum and bass', 'drum & bass', 'dnb', 'jungle', 'uk garage', 'garage house', 'ambient', 'downtempo', 'idm', 'synthwave',
    'chillwave', 'breakbeat', 'big beat', 'hardstyle', 'eurodance', 'disco', 'nu-disco', 'future bass', 'bass music', 'chillout', 'lounge',
  ],
  Rock: [
    'pop rock', 'soft rock', 'rock', 'punk', 'grunge', 'post-punk', 'emo', 'shoegaze', 'psychedelic', 'new wave', 'krautrock',
    'britpop', 'garage rock', 'surf', 'rockabilly', 'rock and roll', "rock 'n' roll", 'glam',
  ],
  Metal: ['metal', 'metalcore', 'deathcore', 'thrash', 'djent', 'nu metal', 'grindcore'],
  'Indie & Alternative': ['indie', 'alternative', 'lo-fi', 'lofi', 'dream pop', 'bedroom pop', 'art pop', 'slowcore', 'math rock', 'post-rock', 'noise pop'],
  'R&B & Soul': ['contemporary r&b', 'r&b', 'rnb', 'rhythm and blues', 'soul', 'neo soul', 'funk', 'motown', 'gospel', 'quiet storm', 'new jack swing'],
  Pop: [
    'pop', 'dance-pop', 'synth-pop', 'synthpop', 'electropop', 'teen pop', 'europop', 'k-pop', 'j-pop', 'c-pop', 'boy band',
    'girl group', 'adult contemporary', 'traditional pop', 'easy listening', 'christmas', 'holiday', 'pop soul',
  ],
  Jazz: ['jazz', 'swing', 'bebop', 'big band', 'vocal jazz', 'bossa nova', 'smooth jazz', 'jazz fusion', 'crooner', 'ragtime', 'dixieland'],
  Klassik: [
    'classical', 'klassik', 'baroque', 'opera', 'orchestral', 'symphony', 'symphonic', 'romantic', 'chamber music', 'choral',
    'contemporary classical', 'neoclassical', 'minimalism', 'modern classical', 'early music', 'renaissance',
  ],
  'Country & Folk': ['country', 'folk', 'americana', 'bluegrass', 'singer-songwriter', 'singer/songwriter', 'acoustic', 'chanson', 'liedermacher'],
  Latin: ['latin', 'reggaeton', 'salsa', 'bachata', 'cumbia', 'flamenco', 'urbano', 'dembow', 'bolero', 'tango', 'samba', 'mpb', 'corridos', 'mariachi'],
  'Reggae & Dancehall': ['reggae', 'dancehall', 'ska', 'dub', 'rocksteady', 'afrobeats', 'afrobeat', 'soca'],
  Blues: ['blues', 'delta blues', 'electric blues'],
  'Schlager & Volksmusik': ['schlager', 'volksmusik', 'volkstümlich', 'deutscher schlager', 'neue deutsche welle', 'ndw', 'oktoberfest', 'après-ski'],
  Soundtrack: ['soundtrack', 'film score', 'score', 'video game music', 'musical', 'show tunes', 'film music', 'anime'],
};

// Flache, nach Musterlänge sortierte Regel-Liste
const PATTERNS = Object.entries(RULES)
  .flatMap(([genre, pats]) => pats.map((p) => ({ genre, p, re: new RegExp(`(^|[^a-z])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`) })))
  .sort((a, b) => b.p.length - a.p.length);

// Tags ohne Genre-Aussage (Jahrzehnte, Sprachen, Länder, Bewertungen …)
const NOISE = /^(\d{4}s?|\d0s|english|german|deutsch|french|american|british|uk|usa|seen live|favorites?|male vocalists?|female vocalists?|vocalist|singer|composer|producer|cover|live|instrumental)$/;

/** Ordnet eine Tag-Liste [{name, count}] einem Hauptgenre zu. */
export function classify(tags) {
  const scores = new Map();
  const styles = [];
  for (const t of tags || []) {
    const name = String(t.name || '').toLowerCase().trim();
    if (!name || NOISE.test(name)) continue;
    const hit = PATTERNS.find(({ re }) => re.test(name));
    if (!hit) continue;
    const weight = Math.max(1, Number(t.count) || 0);
    scores.set(hit.genre, (scores.get(hit.genre) || 0) + weight);
    styles.push({ name, weight });
  }
  if (!scores.size) return { main: null, styles: [] };
  const main = [...scores.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return {
    main,
    styles: styles.sort((a, b) => b.weight - a.weight).slice(0, 4).map((s) => s.name),
  };
}

// ---------------------------------------------------------------- MusicBrainz
const MB = 'https://musicbrainz.org/ws/2';
const userAgent = () =>
  `Spotlfy/1.0 ( ${config.spotify.redirectUri.replace(/\/auth\/callback$/, '') || 'https://github.com'} )`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

let lastCall = 0;
async function mbFetch(url, attempt = 0) {
  // MusicBrainz erlaubt ca. 1 Anfrage pro Sekunde; etwas Abstand lassen.
  const wait = lastCall + 1500 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': userAgent(), Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 503 || res.status === 429) {
    // Überlastet/Rate-Limit: kurz warten und bis zu 3× erneut versuchen
    if (attempt < 3) {
      await sleep(2000 * (attempt + 1));
      return mbFetch(url, attempt + 1);
    }
    throw Object.assign(new Error('MusicBrainz überlastet'), { retry: true });
  }
  if (!res.ok) throw new Error(`MusicBrainz ${res.status}`);
  return res.json();
}

/** Sucht den Künstler bei MusicBrainz und liefert {mbid, tags}. */
export async function lookupArtist(name) {
  const q = encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`);
  const data = await mbFetch(`${MB}/artist/?query=${q}&limit=5&fmt=json`);
  const want = norm(name);
  const candidates = (data.artists || []).filter((a) => a.score >= 85);
  const best =
    candidates.find((a) => norm(a.name) === want && (a.tags || []).length) ||
    candidates.find((a) => norm(a.name) === want) ||
    candidates.find((a) => (a.aliases || []).some((al) => norm(al.name) === want)) ||
    null;
  if (!best) return { mbid: null, tags: [] };
  return { mbid: best.id, tags: (best.tags || []).map((t) => ({ name: t.name, count: t.count })) };
}

// ---------------------------------------------------------------- Hintergrund-Job

/** Klassifiziert noch unbekannte Künstler (meistgehörte zuerst). */
export async function classifyPendingArtists({ limit = 25 } = {}) {
  const { rows } = await query(
    `SELECT min(t.artist_names[1]) AS name, lower(t.artist_names[1]) AS key, count(*) AS plays
       FROM plays p JOIN tracks t ON t.id = p.track_id
      WHERE t.artist_names[1] IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM artist_genres g
           WHERE g.name_key = lower(t.artist_names[1])
             AND (g.main_genre IS NOT NULL OR g.checked_at > now() - interval '30 days'))
      GROUP BY lower(t.artist_names[1])
      ORDER BY count(*) DESC LIMIT $1`,
    [limit],
  );
  let classified = 0;
  let unknown = 0;
  for (const r of rows) {
    try {
      const { mbid, tags } = await lookupArtist(r.name);
      const { main, styles } = classify(tags);
      await query(
        `INSERT INTO artist_genres (name_key, artist_name, main_genre, styles, mbid, tags, checked_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (name_key) DO UPDATE SET artist_name = EXCLUDED.artist_name, main_genre = EXCLUDED.main_genre,
           styles = EXCLUDED.styles, mbid = EXCLUDED.mbid, tags = EXCLUDED.tags, checked_at = now()`,
        [r.key, r.name, main, styles, mbid, JSON.stringify(tags)],
      );
      if (main) classified++;
      else unknown++;
    } catch (err) {
      console.warn(`[genres] ${r.name}: ${err.message}`);
      if (err.retry) break; // MusicBrainz dauerhaft überlastet → beim nächsten Lauf weiter
    }
  }
  return { checked: rows.length, classified, unknown };
}

/** Bestehende Zuordnungen nach einer Regel-Änderung neu berechnen (ohne neue Abfragen). */
export async function reclassifyAll() {
  const { rows } = await query('SELECT name_key, tags FROM artist_genres');
  for (const r of rows) {
    const { main, styles } = classify(r.tags || []);
    await query('UPDATE artist_genres SET main_genre = $2, styles = $3 WHERE name_key = $1', [r.name_key, main, styles]);
  }
  return rows.length;
}
