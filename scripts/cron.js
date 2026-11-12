// Cron-Einstieg (Render Cron Job, alle 30 Minuten):
//   - neue Plays aus /me/player/recently-played speichern
//   - einmal pro Tag Top-Artists/-Tracks als Snapshot sichern
//   - Cover/Genres schrittweise nachladen
// Flags: --snapshot (Snapshot erzwingen), --enrich-only
import { migrate, pool } from '../src/db.js';
import { enrichMetadata, runCron } from '../src/sync.js';

const args = new Set(process.argv.slice(2));
let exitCode = 0;
try {
  await migrate();
  const result = args.has('--enrich-only')
    ? await enrichMetadata()
    : await runCron({ forceSnapshot: args.has('--snapshot') });
  console.log(`[cron] ${new Date().toISOString()} OK`, JSON.stringify(result));
} catch (err) {
  console.error(`[cron] Fehler: ${err.message}`);
  exitCode = 1;
} finally {
  await pool.end();
}
process.exit(exitCode);
