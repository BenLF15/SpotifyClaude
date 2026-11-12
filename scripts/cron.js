// Manueller Sync-Lauf (der Web Service macht das sonst selbst alle 30 Minuten).
//   npm run cron                     – alle fälligen Nutzer
//   npm run cron -- --all            – alle Nutzer, unabhängig vom letzten Sync
//   npm run cron -- --user <id>      – nur ein Nutzer
//   --snapshot                       – Top-Snapshot erzwingen
//   --enrich-only                    – nur Cover/Genres nachladen
import { migrate, pool } from '../src/db.js';
import { syncAllDue } from '../src/scheduler.js';
import { enrichMetadata, runCron } from '../src/sync.js';
import { allUserIds } from '../src/users.js';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const userArg = args.includes('--user') ? args[args.indexOf('--user') + 1] : null;

let exitCode = 0;
try {
  await migrate();
  let result;
  if (userArg || flag('--all') || flag('--snapshot') || flag('--enrich-only')) {
    const ids = userArg ? [userArg] : await allUserIds();
    result = {};
    for (const id of ids) {
      result[id] = flag('--enrich-only')
        ? await enrichMetadata(id)
        : await runCron(id, { forceSnapshot: flag('--snapshot') });
    }
  } else {
    result = await syncAllDue();
  }
  console.log(`[cron] ${new Date().toISOString()} OK`, JSON.stringify(result));
} catch (err) {
  console.error(`[cron] Fehler: ${err.message}`);
  exitCode = 1;
} finally {
  await pool.end();
}
process.exit(exitCode);
