// Import der Spotify "Extended Streaming History".
// Nutzung:
//   DATABASE_URL=... node scripts/import-history.js [--user <spotify-id>] <Datei.json | Ordner> [weitere …]
// Ohne --user wird in das Konto des ersten Admins importiert.
// Es werden alle Streaming_History_Audio_*.json (bzw. alle .json) im Ordner gelesen.
import fs from 'node:fs';
import path from 'node:path';
import { migrate, pool, query } from '../src/db.js';
import { importHistory } from '../src/importer.js';

const argv = process.argv.slice(2);
let userId = null;
const ui = argv.indexOf('--user');
if (ui !== -1) {
  userId = argv[ui + 1];
  argv.splice(ui, 2);
}
const inputs = argv;
if (!inputs.length) {
  console.error('Nutzung: node scripts/import-history.js <Datei.json | Ordner> [...]');
  process.exit(1);
}

function collect(p) {
  const stat = fs.statSync(p);
  if (stat.isFile()) return [p];
  const files = fs.readdirSync(p).filter((f) => f.toLowerCase().endsWith('.json'));
  const audio = files.filter((f) => /Streaming_History_Audio/i.test(f));
  return (audio.length ? audio : files).sort().map((f) => path.join(p, f));
}

const files = inputs.flatMap(collect);
let exitCode = 0;
try {
  await migrate();
  if (!userId) {
    const { rows } = await query('SELECT id FROM users ORDER BY is_admin DESC, created_at LIMIT 1');
    if (!rows.length) throw new Error('Noch kein Nutzer vorhanden – erst einmal im Dashboard mit Spotify anmelden.');
    userId = rows[0].id;
  }
  console.log(`Importiere für Nutzer: ${userId}`);
  const total = { inserted: 0, duplicates: 0 };
  for (const file of files) {
    const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
    const r = await importHistory(userId, entries);
    total.inserted += r.inserted;
    total.duplicates += r.duplicates;
    console.log(
      `${path.basename(file)}: ${r.total} Einträge → ${r.inserted} neu, ${r.duplicates} Duplikate, ` +
        `${r.skippedShort} zu kurz, ${r.skippedNonTrack} kein Musiktrack` +
        (r.unsupported ? `, ${r.unsupported} im nicht unterstützten Kurzformat` : ''),
    );
  }
  console.log(`Fertig: ${total.inserted} Plays importiert (${total.duplicates} übersprungen).`);
  console.log('Cover & Genres werden vom Cron-Job schrittweise nachgeladen (oder: npm run cron -- --enrich-only).');
} catch (err) {
  console.error('Import fehlgeschlagen:', err.message);
  exitCode = 1;
} finally {
  await pool.end();
}
process.exit(exitCode);
