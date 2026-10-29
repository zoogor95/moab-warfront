import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { createPool } from '../src/db';
import { startServer, type RunningServer } from '../src/server';
import { freshSchema, hasTestDb } from './db';

const dbUp = await hasTestDb();

describe('config', () => {
  it('needs a database URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('fills in defaults', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://x' })).toEqual({
      port: 3100,
      databaseUrl: 'postgres://x',
      clientOrigins: ['http://localhost:5173'],
    });
  });

  it('splits client origins and rejects bad ports', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://x', CLIENT_ORIGINS: 'https://a.test, https://b.test' }).clientOrigins)
      .toEqual(['https://a.test', 'https://b.test']);
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', PORT: 'abc' })).toThrow(/PORT/);
  });
});

describe('server without a database', () => {
  // Port 1 refuses connections at once, so this needs no Postgres.
  const pool = createPool('postgres://nobody@127.0.0.1:1/none');
  let server: RunningServer;
  beforeAll(async () => {
    server = await startServer({ port: 0, clientOrigins: [] }, pool);
  });
  afterAll(async () => {
    await server?.close();
    await pool.end();
  });

  it('reports the database as down', async () => {
    const res = await fetch(`http://localhost:${server.port}/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, db: 'down' });
  });

  it('answers a Socket.IO handshake', async () => {
    const res = await fetch(`http://localhost:${server.port}/socket.io/?EIO=4&transport=polling`);
    expect(res.status).toBe(200);
    // Engine.IO's open packet: type 0 followed by the session JSON.
    expect(await res.text()).toMatch(/^0\{"sid":/);
  });
});

describe.skipIf(!dbUp)('server with a database', () => {
  let db: Awaited<ReturnType<typeof freshSchema>>;
  let server: RunningServer;
  beforeAll(async () => {
    db = await freshSchema();
    server = await startServer({ port: 0, clientOrigins: [] }, db.pool);
  });
  afterAll(async () => {
    await server?.close();
    await db?.drop();
  });

  it('reports healthy', async () => {
    const res = await fetch(`http://localhost:${server.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: 'up' });
  });
});
