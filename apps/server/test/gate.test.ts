import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, startValue, type City, type Lobby } from '@warfront/shared';
import { Player, testServer, type TestServer } from './client';
import { hasTestDb } from './db';
import { expectNothingHidden, playTurnFromView } from './play';

const dbUp = await hasTestDb();
const ROUNDS = 10;

/**
 * The phase 2 gate, automated: four people on their own connections create a lobby, pick
 * hidden starts, play real turns from their own fogged views, survive a server restart, and
 * finish with a winner. Three resign at the end so the test takes seconds, not a whole war.
 */
describe.skipIf(!dbUp)('phase 2 gate', () => {
  let t: TestServer;
  let players: Player[];
  beforeAll(async () => {
    t = await testServer();
    players = await Promise.all(['Ana', 'Ben', 'Cy', 'Dee'].map((n) => Player.guest(t, n)));
  });
  afterAll(async () => {
    for (const p of players ?? []) p.close();
    await t?.stop();
  });

  it('four clients play a live match to a winner', async () => {
    const [host, ...rest] = players;
    const lobby = await host.ok<Lobby>('POST', '/matches', {
      settings: { ...DEFAULT_SETTINGS, seats: 4, startMode: 'pick', production: 'fast' },
    });
    for (const p of rest) {
      await p.ok('POST', '/matches/join', { code: lobby.code });
      await p.ok('POST', `/matches/${lobby.id}/ready`, { ready: true });
    }
    for (const p of players) await p.connect(lobby.id);
    await host.ok('POST', `/matches/${lobby.id}/start`);
    const id = lobby.id;
    for (const p of players) await p.waitFor(() => p.update?.view.phase === 'picking', 'pick phase');

    // Everyone picks at once, each from what their own view shows.
    const ports = host.update!.view.cities.filter((c) => c.port) as unknown as City[];
    const ranked = [...ports].sort((a, b) => startValue(b, ports) - startValue(a, ports) || a.id.localeCompare(b.id));
    const picks = await Promise.all(players.map((p, i) => p.submit(id, { type: 'pickStart', city: ranked[i * 9].id })));
    expect(picks.every((r) => r.ok)).toBe(true);
    for (const p of players) await p.waitFor(() => p.update?.view.phase === 'playing', 'starts revealed');
    players.forEach((p, seat) => {
      expect(p.update!.view.cities.filter((c) => c.owner === seat)).toHaveLength(1);
      expect(p.updates.some((u) => u.events.some((e) => e.type === 'startsRevealed'))).toBe(true);
    });

    const playRounds = async (until: number) => {
      while (host.update!.view.round <= until && host.update!.view.phase === 'playing') {
        const active = players[host.update!.view.activeSeat];
        await active.waitFor(() => active.update!.view.rev === host.update!.view.rev, 'active player view');
        const ended = await playTurnFromView(active, id);
        expect(ended, 'the active player ends their turn').not.toBeNull();
        // Wait for the endTurn itself, not just any move, before reading whose turn it is.
        await host.waitFor(() => host.update!.view.rev >= ended!, 'turn to end');
      }
    };

    await playRounds(ROUNDS / 2);
    const before = (await t.server.matches.seatIn(id, host.id)).live.state;
    const seen = players.map((p) => p.updates.length);
    await t.restart();
    for (const [i, p] of players.entries()) await p.waitFor(() => p.updates.length > seen[i], 'reconnect');
    expect((await t.server.matches.seatIn(id, host.id)).live.state).toEqual(before);
    await playRounds(ROUNDS);

    const state = (await t.server.matches.seatIn(id, host.id)).live.state;
    expect(state.round).toBeGreaterThan(ROUNDS);
    // The seed is new each run, so check that real play happened rather than how it went.
    const moves = await t.db.pool.query<{ n: string }>(`SELECT count(*) AS n FROM match_actions WHERE match_id = $1 AND type = 'move'`, [id]);
    expect(Number(moves.rows[0].n)).toBeGreaterThan(8);
    const attempts = players.flatMap((p) => p.updates.flatMap((u) => u.events)).filter((e) => e.type === 'captured' || e.type === 'captureFailed');
    expect(attempts.length).toBeGreaterThan(0);

    for (const p of rest) {
      const r = await p.submit(id, { type: 'resign' }, p.update!.view.rev);
      expect(r.ok, !r.ok ? r.message : '').toBe(true);
      await p.waitFor(() => !p.update!.view.players[p.update!.view.seat].alive, 'resignation');
    }
    for (const p of players) await p.waitFor(() => p.update!.view.phase === 'finished', 'the end');
    for (const p of players) {
      expect(p.update!.view.winner).toBe(0);
      expect(p.update!.standings?.cities[0]).toBeGreaterThan(0);
    }

    const row = await t.db.pool.query<{ status: string; rev: number; n: string }>(
      `SELECT status, rev, (SELECT count(*) FROM match_actions WHERE match_id = $1) AS n FROM matches WHERE id = $1`,
      [id],
    );
    expect(row.rows[0].status).toBe('finished');
    expect(Number(row.rows[0].n)).toBe(row.rows[0].rev);
    expect((await t.db.pool.query(`SELECT 1 FROM jobs WHERE payload ->> 'matchId' = $1`, [id])).rows).toHaveLength(0);

    players.forEach((p, seat) => p.updates.forEach((u) => expectNothingHidden(u, seat)));
  });
});
