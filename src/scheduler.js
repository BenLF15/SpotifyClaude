// Interner Zeitplan: ersetzt einen separaten Cron Job.
// - Alle 30 Min. (SYNC_INTERVAL_MINUTES) Recently Played speichern, 1× täglich Top-Snapshot,
//   Cover/Genres nachladen (runCron).
// - Der Zeitpunkt des letzten Laufs steht in der DB → nach Neustart/Aufwachen wird sofort nachgeholt.
// - Optionales Keep-Alive, damit ein Render-Free-Service nicht einschläft.
import { config } from './config.js';
import { query } from './db.js';
import { runCron } from './sync.js';

let running = null;

/** Startet einen Sync-Lauf; läuft schon einer, wird dessen Ergebnis zurückgegeben. */
export function triggerSync(opts = {}) {
  if (!running) {
    running = runCron(opts).finally(() => {
      running = null;
    });
  }
  return running;
}

async function minutesSinceLastSync() {
  const { rows } = await query(
    `SELECT extract(epoch FROM now() - max(started_at)) / 60 AS minutes
       FROM sync_log WHERE job = 'recently_played'`,
  );
  return rows[0]?.minutes ?? Infinity;
}

async function tick() {
  try {
    const { rows } = await query('SELECT 1 FROM spotify_auth WHERE id = 1');
    if (!rows.length) return; // noch nicht mit Spotify verbunden
    if ((await minutesSinceLastSync()) < config.syncIntervalMinutes - 0.5) return;
    const result = await triggerSync();
    console.log(`[scheduler] ${new Date().toISOString()} Sync OK`, JSON.stringify(result));
  } catch (err) {
    console.error('[scheduler] Sync fehlgeschlagen:', err.message);
  }
}

export function startScheduler() {
  if (!config.internalScheduler) {
    console.log('[scheduler] deaktiviert (INTERNAL_SCHEDULER=false)');
    return;
  }
  console.log(`[scheduler] aktiv – Sync alle ${config.syncIntervalMinutes} Minuten`);
  setTimeout(tick, 5_000); // direkt nach dem Start nachholen
  setInterval(tick, 60_000).unref?.();

  if (config.keepAliveUrl) {
    // Render-Free-Services schlafen nach ~15 Min. ohne Anfragen ein. Ein Ping über die
    // öffentliche URL hält den Service (und damit den Zeitplan) wach.
    console.log(`[keep-alive] Ping alle 10 Minuten an ${config.keepAliveUrl}`);
    setInterval(() => {
      fetch(config.keepAliveUrl, { signal: AbortSignal.timeout(15_000) }).catch((err) =>
        console.warn('[keep-alive] Ping fehlgeschlagen:', err.message),
      );
    }, 10 * 60_000);
  }
}
