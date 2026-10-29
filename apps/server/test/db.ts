import { randomBytes } from 'node:crypto';
import { createPool, type Pool } from '../src/db';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://warfront:warfront@localhost:5434/warfront_test';

/**
 * True when the test database answers. Without one the database suites are skipped,
 * unless REQUIRE_DB is set (`npm run test:db`, and CI), in which case they fail.
 */
export async function hasTestDb(): Promise<boolean> {
  const pool = createPool(TEST_DATABASE_URL, { connectionTimeoutMillis: 2_000 });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    if (process.env.REQUIRE_DB) {
      // pg's own error is a long AggregateError; say what to do instead.
      throw new Error(`No Postgres at ${TEST_DATABASE_URL}. Start Docker Desktop, then run \`npm run db:up\`.`, {
        cause: err,
      });
    }
    console.warn(`Skipping database tests: no Postgres at ${TEST_DATABASE_URL}. Run \`npm run db:up\`.`);
    return false;
  } finally {
    await pool.end();
  }
}

/** A pool whose connections all use a new, empty schema, so suites can run side by side. */
export async function freshSchema(): Promise<{ pool: Pool; schema: string; drop(): Promise<void> }> {
  const schema = `test_${randomBytes(6).toString('hex')}`;
  const admin = createPool(TEST_DATABASE_URL);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = createPool(TEST_DATABASE_URL, { options: `-c search_path=${schema}` });
  return {
    pool,
    schema,
    async drop() {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}
