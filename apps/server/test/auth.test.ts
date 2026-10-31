import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthResponse } from '@warfront/shared';
import { ACCESS_TTL_SECONDS, signAccess, verifyAccess } from '../src/auth';
import { RateLimiter } from '../src/limits';
import { Player, testServer, type TestServer } from './client';
import { hasTestDb, SECRET } from './db';

const dbUp = await hasTestDb();

describe('access tokens', () => {
  it('round-trips a user id', () => {
    expect(verifyAccess(SECRET, signAccess(SECRET, 'user-1'))).toBe('user-1');
  });

  it('refuses forged, altered, foreign and expired tokens', () => {
    const token = signAccess(SECRET, 'user-1');
    const [payload, sig] = token.split('.');
    const other = Buffer.from(JSON.stringify({ sub: 'user-2', exp: 9e9 })).toString('base64url');
    expect(verifyAccess(SECRET, `${other}.${sig}`)).toBeNull();
    expect(verifyAccess(SECRET, `${payload}.${sig.slice(0, -2)}xx`)).toBeNull();
    expect(verifyAccess('another-secret-of-thirty-two-characters', token)).toBeNull();
    expect(verifyAccess(SECRET, token, Date.now() + (ACCESS_TTL_SECONDS + 1) * 1000)).toBeNull();
    expect(verifyAccess(SECRET, 'garbage')).toBeNull();
    expect(verifyAccess(SECRET, undefined)).toBeNull();
  });
});

describe('rate limiter', () => {
  it('allows a burst, then refills over time', () => {
    let t = 0;
    const limit = new RateLimiter(3, 1, () => t);
    expect([1, 2, 3, 4].map(() => limit.take('a'))).toEqual([true, true, true, false]);
    expect(limit.take('b')).toBe(true);
    t = 1000;
    expect(limit.take('a')).toBe(true);
    expect(limit.take('a')).toBe(false);
  });
});

describe.skipIf(!dbUp)('guest accounts', () => {
  let t: TestServer;
  beforeAll(async () => {
    t = await testServer();
  });
  afterAll(() => t?.stop());

  const post = (path: string, body: unknown) =>
    fetch(`${t.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('starts a guest with a name and tokens', async () => {
    const p = await Player.guest(t, '  Ana  ');
    expect(p.auth.user.name).toBe('Ana');
    expect(await p.ok('GET', '/me')).toEqual({ id: p.id, name: 'Ana' });
  });

  it('refuses a missing or bad token and an empty name', async () => {
    expect((await fetch(`${t.base}/me`)).status).toBe(401);
    expect((await fetch(`${t.base}/me`, { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
    const res = await post('/auth/guest', { name: '   ' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('bad-request');
  });

  it('swaps a refresh token once', async () => {
    const p = await Player.guest(t, 'Ben');
    const first = await post('/auth/refresh', { refreshToken: p.auth.refreshToken });
    expect(first.status).toBe(200);
    const next = (await first.json()) as AuthResponse;
    expect(next.user).toEqual(p.auth.user);
    expect(verifyAccess(SECRET, next.accessToken)).toBe(p.id);
    // The old refresh token was used up.
    expect((await post('/auth/refresh', { refreshToken: p.auth.refreshToken })).status).toBe(401);
    expect((await post('/auth/refresh', { refreshToken: next.refreshToken })).status).toBe(200);
  });

  it('answers the web client origin only', async () => {
    const pre = await fetch(`${t.base}/matches`, { method: 'OPTIONS', headers: { origin: 'http://app.test' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://app.test');
    const other = await fetch(`${t.base}/health`, { headers: { origin: 'http://evil.test' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });
});
