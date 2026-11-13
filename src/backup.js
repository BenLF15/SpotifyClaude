// Komplett-Backup der Datenbank als gzip-JSON (nur Admins) und Wiederherstellung daraus.
// Wiederherstellen ergänzt nur fehlende Zeilen (ON CONFLICT DO NOTHING) – vorhandene Daten bleiben unverändert.
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { pool, query, withTransaction } from './db.js';
import { UserError } from './users.js';

const gunzip = promisify(zlib.gunzip);

// Reihenfolge berücksichtigt Fremdschlüssel (Eltern vor Kindern).
export const BACKUP_TABLES = [
  'app_meta', 'users', 'accounts', 'artists', 'tracks', 'artist_genres',
  'plays', 'top_snapshots', 'sync_log', 'login_events', 'friendships', 'created_playlists',
];
const SERIAL_TABLES = ['accounts', 'plays', 'sync_log', 'login_events', 'created_playlists'];

const write = (stream, chunk) =>
  new Promise((resolve, reject) => {
    if (stream.write(chunk)) return resolve();
    stream.once('drain', resolve);
    stream.once('error', reject);
  });

/** Schreibt das Backup gestreamt (Cursor, 2000 Zeilen pro Abruf) als gzip in `res`. */
export async function streamBackup(res) {
  const gz = zlib.createGzip({ level: 6 });
  gz.pipe(res);
  const client = await pool.connect();
  const counts = {};
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await write(gz, `{"format":"spotlfy-backup","version":1,"created_at":${JSON.stringify(new Date().toISOString())},"tables":{`);
    for (const [ti, table] of BACKUP_TABLES.entries()) {
      await write(gz, `${ti ? ',' : ''}${JSON.stringify(table)}:[`);
      await client.query(`DECLARE c_${table} NO SCROLL CURSOR FOR SELECT * FROM ${table}`);
      let n = 0;
      for (;;) {
        const { rows } = await client.query(`FETCH 2000 FROM c_${table}`);
        if (!rows.length) break;
        await write(gz, (n ? ',' : '') + rows.map((r) => JSON.stringify(r)).join(','));
        n += rows.length;
      }
      await client.query(`CLOSE c_${table}`);
      await write(gz, ']');
      counts[table] = n;
    }
    await write(gz, `},"counts":${JSON.stringify(counts)}}`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    gz.destroy(err);
    throw err;
  } finally {
    client.release();
  }
  gz.end();
  await query(
    `INSERT INTO app_meta (key, value, updated_at) VALUES ('last_backup_at', now()::text, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
  );
  return counts;
}

export async function lastBackup() {
  const { rows } = await query(`SELECT updated_at FROM app_meta WHERE key = 'last_backup_at'`);
  return rows[0]?.updated_at || null;
}

/** Stellt ein Backup wieder her (Buffer: gzip oder JSON). Gibt je Tabelle gelesen/neu eingefügt zurück. */
export async function restoreBackup(buf) {
  let data;
  try {
    const raw = buf[0] === 0x1f && buf[1] === 0x8b ? await gunzip(buf) : buf;
    data = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new UserError('Keine gültige Backup-Datei.', 400, 'backupInvalid');
  }
  if (data?.format !== 'spotlfy-backup' || typeof data.tables !== 'object') {
    throw new UserError('Keine gültige Backup-Datei.', 400, 'backupInvalid');
  }
  const result = {};
  await withTransaction(async (db) => {
    for (const table of BACKUP_TABLES) {
      const rows = data.tables[table];
      if (!Array.isArray(rows) || !rows.length) continue;
      const { rows: colRows } = await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      const existing = new Set(colRows.map((r) => r.column_name));
      const keys = new Set();
      for (const r of rows.slice(0, 200)) Object.keys(r).forEach((k) => keys.add(k));
      const cols = [...keys].filter((k) => existing.has(k)).map((c) => `"${c}"`);
      if (!cols.length) continue;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 1000) {
        const r = await db.query(
          `INSERT INTO ${table} (${cols.join(', ')})
           SELECT ${cols.join(', ')} FROM json_populate_recordset(NULL::${table}, $1::json)
           ON CONFLICT DO NOTHING`,
          [JSON.stringify(rows.slice(i, i + 1000))],
        );
        inserted += r.rowCount;
      }
      result[table] = { rows: rows.length, inserted };
    }
    for (const t of SERIAL_TABLES) {
      await db.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST((SELECT max(id) FROM ${t}), 1))`);
    }
  });
  return { created_at: data.created_at || null, tables: result };
}
