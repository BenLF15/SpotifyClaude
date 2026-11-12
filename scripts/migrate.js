import { migrate, pool } from '../src/db.js';

await migrate();
console.log('Schema ist aktuell.');
await pool.end();
