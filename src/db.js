import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config, requireEnv } from './config.js';

// bigint/count als Number statt String zurückgeben
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));
pg.types.setTypeParser(1700, (v) => Number.parseFloat(v));
// date ohne Zeitzonen-Verschiebung als 'YYYY-MM-DD'
pg.types.setTypeParser(1082, (v) => v);

requireEnv('DATABASE_URL');

function sslOption(url) {
  if (process.env.PGSSL === 'false') return false;
  if (process.env.PGSSL === 'true') return { rejectUnauthorized: false };
  // Externe Render-URLs (…render.com) brauchen TLS, die interne URL nicht.
  try {
    const host = new URL(url).hostname;
    return host.endsWith('.render.com') ? { rejectUnauthorized: false } : false;
  } catch {
    return false;
  }
}

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: sslOption(config.databaseUrl),
  max: Number.parseInt(process.env.PG_POOL_MAX || '5', 10),
});

pool.on('error', (err) => console.error('[db] idle client error', err.message));

export const query = (text, params) => pool.query(text, params);

let migrated;
export function migrate() {
  if (!migrated) {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');
    migrated = pool.query(fs.readFileSync(file, 'utf8')).catch((err) => {
      migrated = undefined;
      throw err;
    });
  }
  return migrated;
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
