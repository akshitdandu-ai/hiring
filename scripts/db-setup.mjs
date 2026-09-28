// Optional: create tables and load rubric.txt into rubric_criteria without starting the app.
// The app does this automatically on first request; run this after editing rubric.txt to
// push the new criteria into the database:  DATABASE_URL=... npm run db:setup
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { parseRubric } from '../lib/rubric-parse.mjs';
import { SCHEMA_SQL } from '../lib/schema.mjs';

try {
  process.loadEnvFile?.('.env.local');
} catch {}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL (or put it in .env.local)');
  process.exit(1);
}
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const sql = postgres(url, { prepare: false, ssl: local ? false : 'require', onnotice: () => {} });
const { criteria, guidance } = parseRubric(readFileSync(new URL('../rubric.txt', import.meta.url), 'utf8'));

await sql.begin(async (tx) => {
  await tx`select pg_advisory_xact_lock(424242)`;
  await tx.unsafe(SCHEMA_SQL);
  for (const c of criteria) {
    await tx`insert into rubric_criteria ${tx(c, 'id', 'role', 'position', 'name', 'weight', 'anchor_5', 'anchor_3', 'anchor_1', 'source')}
             on conflict (id) do update set role = excluded.role, position = excluded.position, name = excluded.name,
               weight = excluded.weight, anchor_5 = excluded.anchor_5, anchor_3 = excluded.anchor_3,
               anchor_1 = excluded.anchor_1, source = excluded.source`;
  }
  for (const [key, content] of Object.entries(guidance)) {
    await tx`insert into rubric_guidance (key, content) values (${key}, ${content})
             on conflict (key) do update set content = excluded.content`;
  }
});
const rows = await sql`select role, name, weight from rubric_criteria order by role, position`;
console.table(rows);
await sql.end();
