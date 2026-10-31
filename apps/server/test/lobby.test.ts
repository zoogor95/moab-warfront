import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Lobby, type MatchSummary } from '@warfront/shared';
import { Player, testServer, type TestServer } from './client';
import { hasTestDb } from './db';

const dbUp = await hasTestDb();

describe.skipIf(!dbUp)('lobbies', () => {
  let t: TestServer;
  let host: Player;
  let guest: Player;
  let third: Player;
  beforeAll(async () => {
    t = await testServer();
    [host, guest, third] = await Promise.all([Player.guest(t, 'Host'), Player.guest(t, 'Guest'), Player.guest(t, 'Third')]);
  });
  afterAll(async () => {
    for (const p of [host, guest, third]) p?.close();
    await t?.stop();
  });

  const create = (settings = { ...DEFAULT_SETTINGS, seats: 3 }) => host.ok<Lobby>('POST', '/matches', { settings });

  it('creates a lobby with the host in seat 1 and a 6-character code', async () => {
    const lobby = await create();
    expect(lobby.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(lobby.status).toBe('lobby');
    expect(lobby.hostId).toBe(host.id);
    expect(lobby.seats).toEqual([{ seat: 0, userId: host.id, name: 'Host', bot: false, ready: false, colour: '#4C8DFF', emblem: 'circle' }]);
  });

  it('joins by code, in any case, once', async () => {
    const lobby = await create();
    const joined = await guest.ok<Lobby>('POST', '/matches/join', { code: lobby.code.toLowerCase() });
    expect(joined.seats.map((s) => s.name)).toEqual(['Host', 'Guest']);
    const again = await guest.ok<Lobby>('POST', '/matches/join', { code: lobby.code });
    expect(again.seats).toHaveLength(2);
    expect((await guest.req('POST', '/matches/join', { code: 'ZZZZZZ' })).status).toBe(404);
    expect((await guest.req('POST', '/matches/join', { code: 'nope' })).status).toBe(400);
  });

  it('tells everyone in the lobby about changes', async () => {
    const lobby = await create();
    await host.connect(lobby.id);
    await host.waitFor(() => host.lobby?.id === lobby.id, 'first lobby');
    await guest.ok('POST', '/matches/join', { code: lobby.code });
    await host.waitFor(() => host.lobby?.seats.length === 2, 'guest to appear');
    host.close();
  });

  it('keeps settings to the host and asks players to confirm again', async () => {
    const lobby = await create();
    await guest.ok('POST', '/matches/join', { code: lobby.code });
    await guest.ok('POST', `/matches/${lobby.id}/ready`, { ready: true });
    expect((await guest.req('PATCH', `/matches/${lobby.id}/settings`, { settings: DEFAULT_SETTINGS })).status).toBe(403);
    const changed = await host.ok<Lobby>('PATCH', `/matches/${lobby.id}/settings`, { settings: { ...DEFAULT_SETTINGS, seats: 2, production: 'fast' } });
    expect(changed.settings.production).toBe('fast');
    expect(changed.seats.find((s) => s.userId === guest.id)?.ready).toBe(false);
    // Turn limits must be one of the listed values.
    expect((await host.req('PATCH', `/matches/${lobby.id}/settings`, { settings: { ...DEFAULT_SETTINGS, turnLimitSeconds: 61 } })).status).toBe(400);
  });

  it('will not close a seat someone sits in', async () => {
    const lobby = await create({ ...DEFAULT_SETTINGS, seats: 4 });
    await guest.ok('POST', '/matches/join', { code: lobby.code });
    await guest.ok('POST', `/matches/${lobby.id}/seat`, { seat: 3 });
    const r = await host.req<{ error: string }>('PATCH', `/matches/${lobby.id}/settings`, { settings: { ...DEFAULT_SETTINGS, seats: 3 } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('seat-in-use');
  });

  it('moves a player to another seat, colour and emblem', async () => {
    const lobby = await create();
    await guest.ok('POST', '/matches/join', { code: lobby.code });
    const moved = await guest.ok<Lobby>('POST', `/matches/${lobby.id}/seat`, { seat: 2 });
    expect(moved.seats.find((s) => s.userId === guest.id)).toMatchObject({ seat: 2, colour: '#26C6B0', emblem: 'square' });
    expect((await guest.req('POST', `/matches/${lobby.id}/seat`, { seat: 0 })).status).toBe(409);
    expect((await guest.req('POST', `/matches/${lobby.id}/seat`, { seat: 5 })).status).toBe(409);
  });

  it('starts only when every seat is filled and everyone is ready', async () => {
    const lobby = await create();
    await guest.ok('POST', '/matches/join', { code: lobby.code });
    const start = () => host.req<{ error: string }>('POST', `/matches/${lobby.id}/start`);
    expect((await start()).body.error).toBe('seats-open');
    expect((await guest.req('POST', `/matches/${lobby.id}/bots`, { seat: 2 })).status).toBe(403);
    const withBot = await host.ok<Lobby>('POST', `/matches/${lobby.id}/bots`, { seat: 2 });
    expect(withBot.seats[2]).toMatchObject({ name: 'Bot 3', bot: true, ready: true, userId: null });
    expect((await start()).body.error).toBe('not-ready');
    await guest.ok('POST', `/matches/${lobby.id}/ready`, { ready: true });
    const started = await host.ok<Lobby>('POST', `/matches/${lobby.id}/start`);
    expect(started.status).toBe('playing');
    expect((await start()).status).toBe(409);
    expect((await third.req<{ error: string }>('POST', '/matches/join', { code: lobby.code })).body.error).toBe('not-in-lobby');

    const mine = await guest.ok<MatchSummary[]>('GET', '/matches');
    // Guest's earlier test lobbies come after a match in progress.
    expect(mine[0]).toMatchObject({ id: lobby.id, status: 'playing', mySeat: 1, yourTurn: false, players: ['Host', 'Guest', 'Bot 3'] });
  });

  it('removes bots and players, and passes the lobby on when the host leaves', async () => {
    const lobby = await create();
    await guest.ok('POST', '/matches/join', { code: lobby.code });
    await third.ok('POST', '/matches/join', { code: lobby.code });
    const cleared = await host.ok<Lobby>('DELETE', `/matches/${lobby.id}/seats/2`);
    expect(cleared.seats.map((s) => s.name)).toEqual(['Host', 'Guest']);
    expect((await host.req('DELETE', `/matches/${lobby.id}/seats/0`)).status).toBe(409);

    expect((await host.req('POST', `/matches/${lobby.id}/leave`)).status).toBe(204);
    const after = await guest.ok<Lobby>('GET', `/matches/${lobby.id}`);
    expect(after.hostId).toBe(guest.id);
    expect((await host.req('GET', `/matches/${lobby.id}`)).status).toBe(404);

    await guest.ok('POST', `/matches/${lobby.id}/leave`);
    expect((await guest.req('GET', `/matches/${lobby.id}`)).status).toBe(404);
  });

  it('treats a malformed match id as not found', async () => {
    expect((await host.req('GET', '/matches/not-a-uuid')).status).toBe(404);
  });
});
