import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from './db';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

// Any constant works; it only has to be the same for every server instance.
const LOCK_ID = 7_230_001;

/**
 * Applies every migrations/NNN_name.sql not yet recorded in schema_migrations, in name order,
 * each in its own transaction. Returns the names it applied.
 */
export async function migrate(pool: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => /^\d+_[\w-]+\.sql$/.test(f)).sort();
  const client = await pool.connect();
  try {
    // Two instances starting together must not both apply the same file.
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}
