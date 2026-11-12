// Interner Zeitplan: ersetzt einen separaten Cron Job.
// - Für jeden Nutzer alle 30 Min. (SYNC_INTERVAL_MINUTES): Recently Played speichern,
//   1× täglich Top-Snapshot, Cover/Genres nachladen (runCron).
// - Der Zeitpunkt des letzten Laufs steht in der DB → nach Neustart/Aufwachen wird sofort nachgeholt.
// - Optionales Keep-Alive, damit ein Render-Free-Service nicht einschläft.
import { config } from './config.js';
import { query } from './db.js';
import { runCron } from './sync.js';

const running = new Map();

/** Startet einen Sync-Lauf für einen Nutzer; läuft schon einer, wird dessen Ergebnis zurückgegeben. */
export function triggerSync(userId, opts = {}) {
  if (!running.has(userId)) {
    running.set(
      userId,
      runCron(userId, opts).finally(() => running.delete(userId)),
    );
  }
  return running.get(userId);
}

/** Nutzer, deren letzter Sync älter als das Intervall ist (oder die noch nie synchronisiert wurden). */
async function dueUsers() {
  const { rows } = await query(
    `SELECT u.id FROM users u
       LEFT JOIN LATERAL (
         SELECT max(started_at) AS last FROM sync_log WHERE user_id = u.id AND job = 'recently_played'
       ) s ON true
      WHERE u.auth_error IS NULL
        AND (s.last IS NULL OR s.last < now() - make_interval(secs => $1::int * 60 - 30))
      ORDER BY s.last NULLS FIRST`,
    [config.syncIntervalMinutes],
  );
  return rows.map((r) => r.id);
}

/** Synchronisiert alle fälligen Nutzer nacheinander (schont das Spotify-Rate-Limit). */
export async function syncAllDue() {
  const results = {};
  for (const userId of await dueUsers()) {
    try {
      results[userId] = await triggerSync(userId);
    } catch (err) {
      results[userId] = { error: err.message };
      console.error(`[scheduler] Sync für ${userId} fehlgeschlagen:`, err.message);
    }
  }
  return results;
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const results = await syncAllDue();
    const n = Object.keys(results).length;
    if (n) console.log(`[scheduler] ${new Date().toISOString()} ${n} Nutzer synchronisiert`);
  } catch (err) {
    console.error('[scheduler] Fehler:', err.message);
  } finally {
    ticking = false;
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
