import { describe, expect, it } from 'vitest';
import { applyAction, botPickStart, createMatch, DEFAULT_SETTINGS, playBotTurn, type GameState, type MatchSettings } from '../src';
import { blankGame, checkInvariants, own, put, sync } from './helpers';

const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Bot ${i + 1}`, bot: true }));

function runBots(s: GameState, maxRounds: number, check = false): GameState {
  let cur = s;
  while (cur.phase === 'playing' && cur.round <= maxRounds) {
    cur = playBotTurn(cur, cur.activeSeat);
    if (check) checkInvariants(cur);
  }
  return cur;
}

describe('whole matches', () => {
  it('never changes the state it was given', () => {
    const s = blankGame();
    own(s, 'lisbon', 0);
    const t = put(s, 'tank', 0, 86, 25);
    sync(s);
    const before = JSON.stringify(s);
    applyAction(s, 0, { type: 'move', unit: t.id, to: { x: 87, y: 25 } });
    applyAction(s, 0, { type: 'endTurn' });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('replays exactly from the same seed and moves', () => {
    const settings: MatchSettings = { ...DEFAULT_SETTINGS, production: 'fast' };
    const a = runBots(createMatch({ settings, players: bots(3), seed: 'replay' }), 25);
    const b = runBots(createMatch({ settings, players: bots(3), seed: 'replay' }), 25);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('keeps every rule intact through a long 4-player bot match', () => {
    const settings: MatchSettings = { ...DEFAULT_SETTINGS, production: 'fast', terrain: 'unexplored' };
    const s = runBots(createMatch({ settings, players: bots(4), seed: 'long' }), 60, true);
    expect(s.round).toBeGreaterThan(40);
    expect(s.cities.filter((c) => c.owner !== null).length).toBeGreaterThan(20);
  });

  it('plays a match through to a winner', () => {
    const settings: MatchSettings = { ...DEFAULT_SETTINGS, production: 'fast', victory: { kind: 'hold', percent: 40 } };
    const s = runBots(createMatch({ settings, players: bots(3), seed: 'to-the-end' }), 400);
    expect(s.phase).toBe('finished');
    expect(s.winner).not.toBeNull();
    expect(s.log.some((e) => e.type === 'victory')).toBe(true);
  });

  it('starts a hidden-pick match with bot picks', () => {
    let s = createMatch({ settings: { ...DEFAULT_SETTINGS, startMode: 'pick' }, players: bots(4), seed: 'bot-picks' });
    for (const p of s.players) s = applyAction(s, p.seat, { type: 'pickStart', city: botPickStart(s, p.seat) }).state;
    expect(s.phase).toBe('playing');
    expect(s.cities.filter((c) => c.owner !== null)).toHaveLength(4);
    s = runBots(s, 10, true);
    expect(s.round).toBeGreaterThan(9);
  });
});
