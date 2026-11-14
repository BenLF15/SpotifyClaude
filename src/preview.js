// Hörproben (30 s) für die Rückblick-Story.
// Spotify liefert für neue Apps seit Ende 2024 keine preview_url mehr. Deshalb sucht der
// Server Titel + Künstler bei Deezer (Ersatz: iTunes) und reicht die MP3/M4A über die eigene
// Domain durch – der Browser des Nutzers spricht nie direkt mit einem Fremddienst, und an
// die Musikdienste gehen nur Songtitel und Künstlername, keine Nutzerdaten.
import { query } from './db.js';

const HOSTS = [/\.dzcdn\.net$/, /\.deezer\.com$/, /\.mzstatic\.com$/, /\.apple\.com$/];
const cache = new Map(); // trackId → { url, exp }
const HIT_MS = 50 * 60_000; // Deezer-Links tragen ein Ablaufdatum
const MISS_MS = 6 * 3600_000;

const norm = (s) => String(s || '').toLowerCase()
  .replace(/\s*[([].*?[)\]]\s*/g, ' ') // „(feat. …)“, „[Remastered]“
  .replace(/\s+-\s+.*$/, '') // „ - Remix“
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

async function getJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const allowed = (u) => { try { const h = new URL(u); return h.protocol === 'https:' && HOSTS.some((r) => r.test(h.hostname)); } catch { return false; } };

async function fromDeezer(title, artist) {
  const tries = [`artist:"${artist}" track:"${title}"`, `${artist} ${title}`];
  for (const q of tries) {
    const d = await getJSON(`https://api.deezer.com/search?limit=8&q=${encodeURIComponent(q)}`);
    const list = (d.data || []).filter((x) => x.preview);
    const hit = list.find((x) => norm(x.artist?.name) === norm(artist) && norm(x.title).includes(norm(title)))
      || list.find((x) => norm(x.artist?.name) === norm(artist))
      || (q === tries[0] ? list[0] : null);
    if (hit) return hit.preview;
  }
  return null;
}

async function fromItunes(title, artist) {
  const d = await getJSON(`https://itunes.apple.com/search?media=music&entity=song&limit=8&term=${encodeURIComponent(`${artist} ${title}`)}`);
  const list = (d.results || []).filter((x) => x.previewUrl);
  const hit = list.find((x) => norm(x.artistName) === norm(artist) && norm(x.trackName).includes(norm(title)))
    || list.find((x) => norm(x.artistName) === norm(artist));
  return hit?.previewUrl || null;
}

/** Liefert die Hörprobe-URL eines Songs aus der eigenen Datenbank (oder null). */
export async function previewUrl(trackId) {
  const c = cache.get(trackId);
  if (c && c.exp > Date.now()) return c.url;
  const { rows } = await query('SELECT name, artist_names[1] AS artist FROM tracks WHERE id = $1', [trackId]);
  if (!rows[0]) return null;
  const { name, artist } = rows[0];
  let url = null;
  let failed = 0;
  for (const src of [fromDeezer, fromItunes]) {
    try { url = await src(name, artist); } catch (err) { failed++; console.warn('[preview]', src.name, err.message); }
    if (url && allowed(url)) break;
    url = null;
  }
  if (cache.size > 2000) cache.clear();
  // Netzwerkfehler nur kurz merken, „nicht gefunden“ länger
  cache.set(trackId, { url, exp: Date.now() + (url ? HIT_MS : failed === 2 ? 120_000 : MISS_MS) });
  return url;
}

/** Streamt die Hörprobe an den Browser (mit Range-Unterstützung für Safari). */
export async function streamPreview(trackId, req, res) {
  const url = await previewUrl(trackId);
  if (!url) return res.status(404).json({ error: 'Keine Hörprobe gefunden.' });
  const headers = {};
  if (req.headers.range) headers.Range = req.headers.range;
  const up = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!up.ok && up.status !== 206) {
    cache.delete(trackId);
    return res.status(502).json({ error: 'Hörprobe nicht erreichbar.' });
  }
  res.status(up.status);
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = up.headers.get(h);
    if (v) res.set(h, v);
  }
  if (!up.headers.get('content-type')) res.set('content-type', 'audio/mpeg');
  res.set('Cache-Control', 'private, max-age=3000');
  const reader = up.body.getReader();
  req.on('close', () => reader.cancel().catch(() => {}));
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!res.write(value)) await new Promise((r) => res.once('drain', r));
  }
  res.end();
}
