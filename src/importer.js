// Import der "Extended Streaming History" (Streaming_History_Audio_*.json) von Spotify.
import { config } from './config.js';
import { withTransaction } from './db.js';
import { insertPlays } from './sync.js';

const CHUNK = 5000;

/**
 * Wandelt die Einträge einer History-Datei in Tracks + Plays um.
 * Podcasts/Hörbücher und Plays unter MIN_PLAY_MS werden übersprungen.
 */
export function parseHistory(entries, { minPlayMs = config.minPlayMs } = {}) {
  if (!Array.isArray(entries)) throw new Error('Die Datei enthält kein JSON-Array.');
  const tracks = new Map();
  const plays = [];
  const stats = { total: entries.length, skippedShort: 0, skippedNonTrack: 0, unsupported: 0 };

  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    if (!('ts' in e) && ('endTime' in e || 'trackName' in e)) {
      // Das ist das einfache "Account data"-Format ohne Track-IDs.
      stats.unsupported++;
      continue;
    }
    const uri = e.spotify_track_uri;
    if (!uri || !uri.startsWith('spotify:track:') || !e.master_metadata_track_name) {
      stats.skippedNonTrack++;
      continue;
    }
    const ms = Number(e.ms_played) || 0;
    if (ms < minPlayMs) {
      stats.skippedShort++;
      continue;
    }
    const id = uri.slice('spotify:track:'.length);
    if (!tracks.has(id)) {
      tracks.set(id, {
        id,
        name: e.master_metadata_track_name,
        artist: e.master_metadata_album_artist_name || 'Unbekannt',
        album: e.master_metadata_album_album_name || null,
      });
    }
    plays.push({ playedAt: new Date(e.ts).toISOString(), trackId: id, msPlayed: ms });
  }
  return { tracks: [...tracks.values()], plays, stats };
}

/** Schreibt geparste History-Daten in die DB (idempotent, ohne Duplikate). */
export async function importHistory(userId, entries, opts = {}) {
  if (!userId) throw new Error('importHistory: userId fehlt');
  const { tracks, plays, stats } = parseHistory(entries, opts);
  let inserted = 0;
  await withTransaction(async (db) => {
    for (let i = 0; i < tracks.length; i += CHUNK) {
      const part = tracks.slice(i, i + CHUNK);
      // Nur Basisdaten – Cover & Artist-IDs ergänzt später der Cron (enrichMetadata).
      await db.query(
        `INSERT INTO tracks (id, name, artist_names, album_name)
         SELECT v.id, v.name, ARRAY[v.artist], v.album
           FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS v(id, name, artist, album)
         ON CONFLICT (id) DO NOTHING`,
        [part.map((t) => t.id), part.map((t) => t.name), part.map((t) => t.artist), part.map((t) => t.album)],
      );
    }
    plays.sort((a, b) => a.playedAt.localeCompare(b.playedAt));
    for (let i = 0; i < plays.length; i += CHUNK) {
      inserted += await insertPlays(db, userId, plays.slice(i, i + CHUNK), 'import');
    }
  });
  return { ...stats, tracks: tracks.length, candidates: plays.length, inserted, duplicates: plays.length - inserted };
}
