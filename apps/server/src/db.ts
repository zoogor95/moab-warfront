import pg from 'pg';

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

export function createPool(connectionString: string, options: pg.PoolConfig = {}): Pool {
  return new pg.Pool({
    connectionString,
    // Fail fast so the health route reports a dead database instead of hanging.
    connectionTimeoutMillis: 5_000,
    ...options,
  });
}

/** Runs `fn` in one transaction; rolls back if it throws. */
export async function tx<T>(pool: Pool, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}
