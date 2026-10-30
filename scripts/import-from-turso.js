// One-time copy of the live Turso database into the local SQLite file used on cPanel.
//
//   TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… DATABASE_PATH=./studio.db \
//     npm run import-from-turso
//
// It copies every table, row and index exactly, then compares row counts. It refuses to
// write into a database file that already exists, so it can never overwrite live data.
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const { TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: authToken } = process.env;
const file = path.resolve(process.env.DATABASE_PATH || 'data/studio.db');
if (!url || !authToken) {
  console.error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (from the Turso dashboard).');
  process.exit(1);
}
if (fs.existsSync(file)) {
  console.error(`${file} already exists. Move it away or choose another DATABASE_PATH; nothing was changed.`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(file), { recursive: true });

const src = createClient({ url, authToken, intMode: 'bigint' });
const dst = createClient({ url: `file:${file}`, intMode: 'bigint' });
const quote = (n) => `"${n.replace(/"/g, '""')}"`;

const objects = (await src.execute("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type = 'table' DESC, rowid")).rows;
const tables = objects.filter((o) => o.type === 'table').map((o) => o.name);
const hasSequence = (await src.execute("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'")).rows.length > 0;

await dst.execute('PRAGMA foreign_keys = OFF');
for (const o of objects.filter((x) => x.type === 'table')) await dst.execute(o.sql);

const counts = {};
for (const t of [...tables, ...(hasSequence ? ['sqlite_sequence'] : [])]) {
  const rs = await src.execute(`SELECT * FROM ${quote(t)}`);
  counts[t] = rs.rows.length;
  if (!rs.rows.length) continue;
  const cols = rs.columns.map(quote).join(', ');
  const marks = rs.columns.map(() => '?').join(', ');
  const stmts = rs.rows.map((r) => ({ sql: `INSERT INTO ${quote(t)} (${cols}) VALUES (${marks})`, args: rs.columns.map((_, i) => r[i]) }));
  for (let i = 0; i < stmts.length; i += 500) await dst.batch(stmts.slice(i, i + 500), 'write');
}
for (const o of objects.filter((x) => x.type !== 'table')) await dst.execute(o.sql);
await dst.execute('PRAGMA journal_mode = DELETE'); // one self-contained file to upload

let ok = true;
for (const t of tables) {
  const n = Number((await dst.execute(`SELECT count(*) FROM ${quote(t)}`)).rows[0][0]);
  const same = n === counts[t];
  ok &&= same;
  console.log(`${same ? 'ok ' : 'MISMATCH'} ${t}: ${counts[t]} → ${n}`);
}
const fk = (await dst.execute('PRAGMA foreign_key_check')).rows.length;
if (fk) console.log(`Note: ${fk} rows point at records that were already missing in Turso (copied as they were).`);
src.close();
dst.close();
console.log(ok ? `\nAll data copied to ${file}` : '\nRow counts differ. Do not switch over; delete the file and run again.');
process.exit(ok ? 0 : 1);
