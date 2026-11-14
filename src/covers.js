// Cover-Ersatzquellen und Hilfen rund um fehlende Cover.
// Spotify bremst Apps im Development Mode stark (Rate-Limit mit teils stundenlanger Sperre) und
// oEmbed ist von Rechenzentren aus nicht immer erreichbar. Damit trotzdem alle Cover kommen,
// sucht der Server fehlende Albumcover zusätzlich bei Deezer und iTunes (nur Künstler + Albumname,
// keine Nutzerdaten). Die Bilder werden über /img/cover durch den eigenen Server gereicht –
// der Browser lädt nie direkt von Deezer/Apple.
import { query } from './db.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const norm = (s) => String(s || '').toLowerCase()
  .replace(/\s*[([].*?[)\]]\s*/g, ' ') // „(Deluxe)“, „[Remastered]“
  .replace(/\s+-\s+.*$/, '') // „ - Single“
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const PROXY_HOSTS = [/^(cdn-images|e-cdns-images|cdns-images)\.dzcdn\.net$/, /^is\d+-ssl\.mzstatic\.com$/];
export const proxied = (url) => `/img/cover?u=${encodeURIComponent(url)}`;
const allowedUpstream = (u) => {
  try { const x = new URL(u); return x.protocol === 'https:' && PROXY_HOSTS.some((r) => r.test(x.hostname)); } catch { return false; }
};

async function getJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
  if (res.status === 429) { const e = new Error('Rate-Limit'); e.status = 429; throw e; }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const sameAlbum = (a, b) => { const x = norm(a); const y = norm(b); return x && y && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `)); };

async function deezerAlbum(artist, album) {
  const d = await getJSON(`https://api.deezer.com/search/album?limit=10&q=${encodeURIComponent(`artist:"${artist}" album:"${album}"`)}`);
  let hit = (d.data || []).find((x) => norm(x.artist?.name) === norm(artist) && sameAlbum(x.title, album));
  if (!hit) {
    const d2 = await getJSON(`https://api.deezer.com/search/album?limit=10&q=${encodeURIComponent(`${artist} ${album}`)}`);
    hit = (d2.data || []).find((x) => norm(x.artist?.name) === norm(artist) && sameAlbum(x.title, album));
  }
  return hit?.cover_medium || hit?.cover_big || null;
}

async function itunesAlbum(artist, album) {
  const d = await getJSON(`https://itunes.apple.com/search?media=music&entity=album&limit=10&term=${encodeURIComponent(`${artist} ${album}`)}`);
  const hit = (d.results || []).find((x) => norm(x.artistName) === norm(artist) && sameAlbum(x.collectionName, album));
  return hit?.artworkUrl100 ? hit.artworkUrl100.replace(/\/\d+x\d+bb\./, '/300x300bb.') : null;
}

/**
 * Sucht für Alben ohne Cover (gruppiert nach Künstler + Album, meistgehört zuerst) ein Cover bei
 * Deezer bzw. iTunes und setzt es für alle Songs dieses Albums. Ein Abruf pro Album statt pro Song.
 */
export async function externalAlbumCovers({ limit = 600 } = {}) {
  const { rows } = await query(
    `SELECT lower(t.artist_names[1]) AS ak, lower(t.album_name) AS bk, min(t.artist_names[1]) AS artist, min(t.album_name) AS album
       FROM tracks t LEFT JOIN plays p ON p.track_id = t.id
      WHERE t.album_image IS NULL AND t.album_name IS NOT NULL AND t.album_name <> '' AND cardinality(t.artist_names) > 0
        AND (t.cover_checked_at IS NULL OR t.cover_checked_at < now() - interval '7 days')
      GROUP BY 1, 2 ORDER BY count(p.id) DESC LIMIT $1`,
    [limit],
  );
  let found = 0;
  let i = 0;
  let blocked = false;
  const worker = async () => {
    while (!blocked && i < rows.length) {
      const a = rows[i++];
      let url = null;
      for (const src of [deezerAlbum, itunesAlbum]) {
        try { url = await src(a.artist, a.album); } catch (err) { if (err.status === 429) { await sleep(5000); } }
        if (url && allowedUpstream(url)) break;
        url = null;
      }
      const { rowCount } = await query(
        `UPDATE tracks SET album_image = COALESCE(album_image, $3), cover_checked_at = now(), updated_at = now()
          WHERE album_image IS NULL AND lower(artist_names[1]) = $1 AND lower(album_name) = $2`,
        [a.ak, a.bk, url ? proxied(url) : null],
      );
      if (url) found += rowCount;
      await sleep(120); // Deezer: max. 50 Anfragen / 5 s
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return found;
}

/** Platten und CDs in Sammlungen, die beim Kauf noch kein Cover hatten, bekommen es nachträglich. */
export async function refreshCollectionImages(accountId = null) {
  const { rowCount } = await query(
    `UPDATE record_collection rc SET image = x.img
       FROM (
         SELECT rc2.account_id, rc2.record_id, COALESCE(
           (SELECT t.album_image FROM tracks t WHERE rc2.kind = 'cd' AND t.id = rc2.album_id AND t.album_image IS NOT NULL),
           (SELECT t.album_image FROM tracks t WHERE rc2.album_id IS NOT NULL AND t.album_id = rc2.album_id AND t.album_image IS NOT NULL LIMIT 1),
           (SELECT t.album_image FROM tracks t
             WHERE t.album_image IS NOT NULL AND lower(t.artist_names[1]) = lower(rc2.artist)
               AND ((rc2.kind = 'record' AND lower(t.album_name) = lower(rc2.album)) OR (rc2.kind = 'cd' AND lower(t.name) = lower(rc2.album)))
             LIMIT 1)
         ) AS img
           FROM record_collection rc2
          WHERE (rc2.image IS NULL OR rc2.image = '') AND ($1::int IS NULL OR rc2.account_id = $1)
       ) x
      WHERE rc.account_id = x.account_id AND rc.record_id = x.record_id AND x.img IS NOT NULL`,
    [accountId],
  );
  return rowCount;
}

/** Reicht ein Ersatz-Cover durch (nur Deezer-/Apple-Bild-CDNs, lange gecacht). */
export async function coverProxy(req, res) {
  const u = String(req.query.u || '');
  if (!allowedUpstream(u)) return res.status(400).end();
  try {
    const up = await fetch(u, { signal: AbortSignal.timeout(10_000) });
    const type = up.headers.get('content-type') || '';
    if (!up.ok || !type.startsWith('image/')) return res.status(404).end();
    res.set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=2592000, immutable', 'X-Content-Type-Options': 'nosniff' });
    res.send(Buffer.from(await up.arrayBuffer()));
  } catch {
    res.status(502).end();
  }
}
