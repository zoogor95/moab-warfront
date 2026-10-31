import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Lobby, type MatchSettings } from '@warfront/shared';
import { Player, testServer, type TestServer } from './client';
import { hasTestDb } from './db';
import { expectNothingHidden } from './play';

const dbUp = await hasTestDb();

describe.skipIf(!dbUp)('live matches', () => {
  let t: TestServer;
  beforeAll(async () => {
    t = await testServer();
  });
  afterAll(() => t?.stop());

  /** A started match: the first player hosts, the rest join and get ready, `bots` fill the seats after them. */
  async function startMatch(people: Player[], bots: number, settings: Partial<MatchSettings> = {}): Promise<string> {
    const [host, ...rest] = people;
    const lobby = await host.ok<Lobby>('POST', '/matches', { settings: { ...DEFAULT_SETTINGS, ...settings, seats: people.length + bots } });
    for (const p of rest) {
      await p.ok('POST', '/matches/join', { code: lobby.code });
      await p.ok('POST', `/matches/${lobby.id}/ready`, { ready: true });
    }
    for (let i = 0; i < bots; i++) await host.ok('POST', `/matches/${lobby.id}/bots`, { seat: people.length + i });
    for (const p of people) await p.connect(lobby.id);
    await host.ok('POST', `/matches/${lobby.id}/start`);
    for (const p of people) await p.waitFor(() => p.update?.matchId === lobby.id, 'first view');
    return lobby.id;
  }

  const count = async (sql: string, id: string) => Number((await t.db.pool.query<{ n: string }>(sql, [id])).rows[0].n);

  it('plays bot turns straight after a person ends theirs', async () => {
    const ana = await Player.guest(t, 'Ana');
    const id = await startMatch([ana], 2);
    expect(ana.update!.view).toMatchObject({ phase: 'playing', round: 1, activeSeat: 0, seat: 0 });
    expect(ana.update!.deadline).not.toBeNull();

    const r = await ana.submit(id, { type: 'endTurn' });
    expect(r).toMatchObject({ ok: true });
    await t.server.matches.idle();
    await ana.waitFor(() => ana.update!.view.round === 2 && ana.update!.view.activeSeat === 0, 'round 2');

    const kinds = (await t.db.pool.query<{ type: string }>('SELECT type FROM match_actions WHERE match_id = $1 ORDER BY rev', [id])).rows.map((x) => x.type);
    expect(kinds).toEqual(['endTurn', 'botTurn', 'botTurn']);
    expect(await count('SELECT rev AS n FROM matches WHERE id = $1', id)).toBe(3);
    // One snapshot to start, then one per turn change.
    expect(await count('SELECT count(*) AS n FROM match_snapshots WHERE match_id = $1', id)).toBe(4);
    for (const u of ana.updates) expectNothingHidden(u, 0);
    ana.close();
  });

  it('refuses out-of-turn, stale and illegal actions, and answers a retry with the first result', async () => {
    const [ben, cy] = [await Player.guest(t, 'Ben'), await Player.guest(t, 'Cy')];
    const id = await startMatch([ben, cy], 0);
    const rev = ben.update!.view.rev;

    expect(await cy.submit(id, { type: 'endTurn' })).toMatchObject({ ok: false, error: 'not-your-turn' });
    expect(await ben.submit(id, { type: 'endTurn' }, rev - 1)).toMatchObject({ ok: false, error: 'stale', rev });
    expect(await ben.submit(id, { type: 'move', unit: 'u999', to: { x: 1, y: 1 } })).toMatchObject({ ok: false });
    expect(await ben.submit(id, { type: 'teleport' } as never)).toMatchObject({ ok: false, error: 'bad-request' });

    const first = await ben.submit(id, { type: 'endTurn' }, rev, 'same-id');
    const again = await ben.submit(id, { type: 'endTurn' }, rev, 'same-id');
    expect(first).toMatchObject({ ok: true, rev: rev + 1 });
    expect(again).toEqual(first);
    expect(await count('SELECT rev AS n FROM matches WHERE id = $1', id)).toBe(1);
    await cy.waitFor(() => cy.update!.view.activeSeat === 1, 'Cy to move');
    ben.close();
    cy.close();
  });

  it('keeps outsiders out', async () => {
    const [dee, eve] = [await Player.guest(t, 'Dee'), await Player.guest(t, 'Eve')];
    const id = await startMatch([dee], 1);
    await eve.connect();
    const reply = await new Promise<{ ok: boolean; error?: string }>((resolve) => eve.socket!.emit('match:subscribe', { matchId: id }, (r) => resolve(r as never)));
    expect(reply).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await eve.submit(id, { type: 'endTurn' })).toMatchObject({ ok: false, error: 'forbidden' });
    expect((await eve.req('GET', `/matches/${id}/view`)).status).toBe(403);
    dee.close();
    eve.close();
  });

  it('accepts actions over REST too', async () => {
    const fay = await Player.guest(t, 'Fay');
    const id = await startMatch([fay], 1);
    const view = await fay.ok<{ view: { rev: number } }>('GET', `/matches/${id}/view`);
    const r = await fay.ok('POST', `/matches/${id}/actions`, { clientActionId: 'rest-1', expectedRev: view.view.rev, action: { type: 'endTurn' } });
    expect(r).toMatchObject({ ok: true });
    fay.close();
  });

  it('comes back exactly as it was after a restart, and players reconnect', async () => {
    const [gus, hal] = [await Player.guest(t, 'Gus'), await Player.guest(t, 'Hal')];
    const id = await startMatch([gus, hal], 1, { production: 'fast' });
    for (let i = 0; i < 4; i++) {
      const p = gus.update!.view.activeSeat === 0 ? gus : hal;
      expect(await p.submit(id, { type: 'endTurn' }, p.update!.view.rev)).toMatchObject({ ok: true });
      await t.server.matches.idle();
      await gus.waitFor(() => gus.update!.view.activeSeat !== 2, 'bot to finish');
      await hal.waitFor(() => hal.update!.view.rev === gus.update!.view.rev, 'Hal to catch up');
    }
    const before = (await t.server.matches.seatIn(id, gus.id)).live.state;

    const seen = gus.updates.length;
    await t.restart();
    await gus.waitFor(() => gus.updates.length > seen, 'view after reconnect');
    expect(gus.update!.view.rev).toBe(before.rev);
    const after = (await t.server.matches.seatIn(id, gus.id)).live.state;
    expect(after).toEqual(before);

    const p = after.activeSeat === 0 ? gus : hal;
    expect(await p.submit(id, { type: 'endTurn' }, after.rev)).toMatchObject({ ok: true });
    gus.close();
    hal.close();
  });

  it('ends a turn when its clock runs out', async () => {
    const [ivy, jo] = [await Player.guest(t, 'Ivy'), await Player.guest(t, 'Jo')];
    const id = await startMatch([ivy, jo], 0);
    const job = await t.db.pool.query<{ kind: string; payload: { round: number; seat: number } }>(`SELECT kind, payload FROM jobs WHERE payload ->> 'matchId' = $1`, [id]);
    expect(job.rows).toEqual([{ kind: 'turnTimeout', payload: { matchId: id, round: 1, seat: 0 } }]);

    // Nothing is due yet.
    expect(await t.server.jobs.tick()).toBe(0);
    await t.db.pool.query(`UPDATE jobs SET run_at = now() - interval '1 second' WHERE payload ->> 'matchId' = $1`, [id]);
    expect(await t.server.jobs.tick()).toBe(1);
    await jo.waitFor(() => jo.update!.view.activeSeat === 1, 'turn to pass');
    const next = await t.db.pool.query(`SELECT payload FROM jobs WHERE payload ->> 'matchId' = $1`, [id]);
    expect(next.rows).toEqual([{ payload: { matchId: id, round: 1, seat: 1 } }]);
    ivy.close();
    jo.close();
  });

  it('keeps picks hidden and picks for whoever runs out of time', async () => {
    const [kai, lu] = [await Player.guest(t, 'Kai'), await Player.guest(t, 'Lu')];
    const id = await startMatch([kai, lu], 1, { startMode: 'pick' });
    expect(kai.update!.view.phase).toBe('picking');
    // The bot picks straight after the start; nobody can see where.
    await kai.waitFor(() => kai.update!.view.picking?.picked.length === 1, 'bot pick');
    expect(kai.update!.view.picking).toEqual({ myPick: null, picked: [2] });

    const port = kai.update!.view.cities.find((c) => c.port)!;
    // A pick made from an older view still counts: everyone picks at once.
    expect(await kai.submit(id, { type: 'pickStart', city: port.id }, 0)).toMatchObject({ ok: true });
    await lu.waitFor(() => lu.update!.view.picking?.picked.length === 2, 'Kai to have picked');
    expect(lu.update!.view.picking).toEqual({ myPick: null, picked: [0, 2] });
    expect(kai.update!.view.picking?.myPick).toBe(port.id);

    await t.db.pool.query(`UPDATE jobs SET run_at = now() WHERE payload ->> 'matchId' = $1`, [id]);
    expect(await t.server.jobs.tick()).toBe(1);
    await lu.waitFor(() => lu.update!.view.phase === 'playing', 'starts revealed');
    expect(lu.update!.view.cities.filter((c) => c.owner === 1)).toHaveLength(1);
    for (const p of [kai, lu]) for (const u of p.updates) expectNothingHidden(u, p === kai ? 0 : 1);
    kai.close();
    lu.close();
  });

  it('carries chat to the match, with a limit', async () => {
    const [max, ned] = [await Player.guest(t, 'Max'), await Player.guest(t, 'Ned')];
    const id = await startMatch([max, ned], 0);
    expect(await max.say(id, '  hello  ')).toEqual({ ok: true });
    await ned.waitFor(() => ned.chat.length === 1, 'chat');
    expect(ned.chat[0]).toMatchObject({ matchId: id, seat: 0, name: 'Max', text: 'hello' });
    const replies = await Promise.all([1, 2, 3, 4, 5].map((n) => max.say(id, `spam ${n}`)));
    expect(replies.at(-1)).toMatchObject({ ok: false, error: 'rate-limited' });
    max.close();
    ned.close();
  });
});
