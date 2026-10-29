import pg from 'pg';

export type Pool = pg.Pool;

export function createPool(connectionString: string, options: pg.PoolConfig = {}): Pool {
  return new pg.Pool({
    connectionString,
    // Fail fast so the health route reports a dead database instead of hanging.
    connectionTimeoutMillis: 5_000,
    ...options,
  });
}
