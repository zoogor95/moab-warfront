import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db';
import { migrate } from '../src/migrate';
import { freshSchema, hasTestDb } from './db';

const dbUp = await hasTestDb();

describe.skipIf(!dbUp)('migrations', () => {
  let db: Awaited<ReturnType<typeof freshSchema>>;
  let pool: Pool;

  beforeAll(async () => {
    db = await freshSchema();
    pool = db.pool;
  });
  afterAll(() => db?.drop());

  it('creates every table from the design doc, plus refresh tokens', async () => {
    const applied = await migrate(pool);
    expect(applied).toEqual(['001_initial.sql', '002_refresh_tokens.sql']);
    const { rows } = await pool.query<{ table_name: string }>(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
      [db.schema],
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'jobs',
      'match_actions',
      'match_snapshots',
      'matches',
      'push_tokens',
      'refresh_tokens',
      'schema_migrations',
      'seats',
      'user_logins',
      'users',
    ]);
  });

  it('does nothing the second time', async () => {
    expect(await migrate(pool)).toEqual([]);
  });

  it('lets only one action claim each revision', async () => {
    const user = await pool.query<{ id: string }>(`INSERT INTO users (display_name) VALUES ('Ana') RETURNING id`);
    const match = await pool.query<{ id: string }>(
      `INSERT INTO matches (code, host_id, settings) VALUES ('K7Q4ZP', $1, '{}') RETURNING id`,
      [user.rows[0].id],
    );
    const id = match.rows[0].id;
    const claim = (expected: number) =>
      pool.query('UPDATE matches SET rev = rev + 1 WHERE id = $1 AND rev = $2', [id, expected]);

    expect((await claim(0)).rowCount).toBe(1);
    // A second client that also read rev 0 is now stale.
    expect((await claim(0)).rowCount).toBe(0);

    const insert = () =>
      pool.query(`INSERT INTO match_actions (match_id, rev, seat, type, payload) VALUES ($1, 1, 0, 'endTurn', '{}')`, [id]);
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
  });

  it('keeps colours and emblems unique within a match', async () => {
    const user = await pool.query<{ id: string }>(`INSERT INTO users (display_name) VALUES ('Ben') RETURNING id`);
    const match = await pool.query<{ id: string }>(
      `INSERT INTO matches (code, host_id, settings) VALUES ('AB12CD', $1, '{}') RETURNING id`,
      [user.rows[0].id],
    );
    const seat = (n: number, colour: string, emblem: string) =>
      pool.query('INSERT INTO seats (match_id, seat, user_id, colour, emblem) VALUES ($1, $2, NULL, $3, $4)', [
        match.rows[0].id,
        n,
        colour,
        emblem,
      ]);
    await seat(0, '#4C8DFF', 'circle');
    await expect(seat(1, '#4C8DFF', 'triangle')).rejects.toThrow(/duplicate key/);
    await expect(seat(1, '#FF8C42', 'circle')).rejects.toThrow(/duplicate key/);
    await expect(seat(6, '#FF8C42', 'triangle')).rejects.toThrow(/check constraint/);
  });

  it('rejects unknown match statuses and malformed codes', async () => {
    const user = await pool.query<{ id: string }>(`INSERT INTO users (display_name) VALUES ('Cy') RETURNING id`);
    const host = user.rows[0].id;
    await expect(
      pool.query(`INSERT INTO matches (code, host_id, settings, status) VALUES ('ZZ99ZZ', $1, '{}', 'paused')`, [host]),
    ).rejects.toThrow(/check constraint/);
    await expect(
      pool.query(`INSERT INTO matches (code, host_id, settings) VALUES ('k7q-4z', $1, '{}')`, [host]),
    ).rejects.toThrow(/check constraint/);
  });
});
