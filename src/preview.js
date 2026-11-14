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

/**
 * Nur die ersten Sekunden einer Hörprobe (für das Intro-Quiz). Bei MP3 (Deezer) wird wirklich nur der Anfang
 * übertragen (~16 KB pro Sekunde bei 128 kbit/s); andere Formate kommen ganz und der Player stoppt selbst.
 */
export async function streamPreviewHead(trackId, seconds, res) {
  const url = await previewUrl(trackId);
  if (!url) return res.status(404).json({ error: 'Keine Hörprobe gefunden.' });
  const mp3 = /dzcdn\.net/.test(url) || /\.mp3(\?|$)/.test(url);
  const bytes = Math.round(3000 + seconds * 16000 * 1.12);
  const up = await fetch(url, { headers: mp3 ? { Range: `bytes=0-${bytes - 1}` } : {}, signal: AbortSignal.timeout(15_000) });
  if (!up.ok && up.status !== 206) { cache.delete(trackId); return res.status(502).json({ error: 'Hörprobe nicht erreichbar.' }); }
  let buf = Buffer.from(await up.arrayBuffer());
  if (mp3 && buf.length > bytes) buf = buf.subarray(0, bytes);
  res.set({ 'Content-Type': up.headers.get('content-type') || 'audio/mpeg', 'Cache-Control': 'no-store', 'Content-Length': String(buf.length) });
  res.send(buf);
}

// ================================================================ Hörprobe zu Platte/CD (Laden & Sammlung)
// CD-Single → genau dieser Song. Schallplatte → der „Hauptsong“ des Albums: dein meistgehörter Song daraus,
// sonst der beliebteste Song des Albums laut Deezer (Suchreihenfolge = Beliebtheit), notfalls iTunes.
const songCache = new Map(); // Schlüssel → { url, title, artist, exp }

async function deezerAlbumTop(album, artist) {
  const d = await getJSON(`https://api.deezer.com/search?limit=15&q=${encodeURIComponent(`artist:"${artist}" album:"${album}"`)}`);
  const list = (d.data || []).filter((x) => x.preview && norm(x.artist?.name) === norm(artist));
  const hit = list.find((x) => norm(x.album?.title) === norm(album)) || list.find((x) => norm(x.album?.title).includes(norm(album))) || list[0];
  return hit ? { url: hit.preview, title: hit.title } : null;
}

async function itunesAlbumTop(album, artist) {
  const d = await getJSON(`https://itunes.apple.com/search?media=music&entity=song&limit=15&term=${encodeURIComponent(`${artist} ${album}`)}`);
  const list = (d.results || []).filter((x) => x.previewUrl && norm(x.artistName) === norm(artist));
  const hit = list.find((x) => norm(x.collectionName) === norm(album)) || list.find((x) => norm(x.collectionName).includes(norm(album)));
  return hit ? { url: hit.previewUrl, title: hit.trackName } : null;
}

export async function resolveRecordSong({ userId, kind, artist, album, albumId }) {
  artist = String(artist || '').slice(0, 200);
  album = String(album || '').slice(0, 300);
  if (!artist || !album) return null;
  const key = `${userId}|${kind}|${norm(artist)}|${norm(album)}|${albumId || ''}`;
  const c = songCache.get(key);
  if (c && c.exp > Date.now()) return c.url ? c : null;
  let out = null;
  try {
    if (kind === 'cd') {
      if (albumId) {
        const { rows } = await query('SELECT id, name, artist_names[1] AS artist FROM tracks WHERE id = $1', [String(albumId)]);
        if (rows[0]) { const url = await previewUrl(rows[0].id); if (url) out = { url, title: rows[0].name, artist: rows[0].artist }; }
      }
      if (!out) {
        for (const src of [fromDeezer, fromItunes]) {
          const url = await src(album, artist).catch(() => null);
          if (url && allowed(url)) { out = { url, title: album, artist }; break; }
        }
      }
    } else {
      // dein meistgehörter Song dieses Albums
      const { rows } = await query(
        `SELECT t.id, t.name, t.artist_names[1] AS artist FROM plays pl JOIN tracks t ON t.id = pl.track_id
          WHERE pl.user_id = $1 AND lower(t.album_name) = lower($2) AND lower(t.artist_names[1]) = lower($3)
          GROUP BY t.id ORDER BY count(*) DESC, sum(pl.ms_played) DESC LIMIT 3`,
        [userId, album, artist],
      );
      for (const r of rows) {
        const url = await previewUrl(r.id).catch(() => null);
        if (url) { out = { url, title: r.name, artist: r.artist }; break; }
      }
      if (!out) {
        for (const src of [deezerAlbumTop, itunesAlbumTop]) {
          const hit = await src(album, artist).catch(() => null);
          if (hit && allowed(hit.url)) { out = { ...hit, artist }; break; }
        }
      }
    }
  } catch (err) { console.warn('[record-song]', err.message); }
  if (songCache.size > 3000) songCache.clear();
  songCache.set(key, { ...(out || { url: null }), exp: Date.now() + (out ? HIT_MS : 30 * 60_000) });
  return out;
}

/** Streamt eine bereits gefundene Hörprobe-URL (nur erlaubte Musik-CDNs). */
export async function streamUrl(url, req, res) {
  if (!allowed(url)) return res.status(400).end();
  const headers = {};
  if (req.headers.range) headers.Range = req.headers.range;
  const up = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!up.ok && up.status !== 206) return res.status(502).json({ error: 'Hörprobe nicht erreichbar.' });
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
