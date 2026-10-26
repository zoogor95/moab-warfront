import { describe, expect, it } from 'vitest';
import { applyAction, RuleError } from '../src';
import { blankGame, own, put, sync, unit } from './helpers';

describe('turn order', () => {
  it('lets only the player whose turn it is act, then moves to the next seat and round', () => {
    const s = blankGame({ players: 3 });
    const t = put(s, 'tank', 1, 86, 25);
    sync(s);
    expect(() => applyAction(s, 1, { type: 'move', unit: t.id, to: { x: 87, y: 25 } })).toThrowError(RuleError);
    let r = applyAction(s, 0, { type: 'endTurn' });
    expect(r.state).toMatchObject({ activeSeat: 1, round: 1 });
    r = applyAction(r.state, 1, { type: 'endTurn' });
    r = applyAction(r.state, 2, { type: 'endTurn' });
    expect(r.state).toMatchObject({ activeSeat: 0, round: 2 });
  });

  it('gives units fresh moves and repairs them in their own cities', () => {
    const s = blankGame();
    own(s, 'lisbon', 0);
    const d = put(s, 'destroyer', 0, 85, 25, { hp: 1, moves: 0 });
    sync(s);
    let r = applyAction(s, 0, { type: 'endTurn' });
    r = applyAction(r.state, 1, { type: 'endTurn' });
    expect(unit(r.state, d.id)).toMatchObject({ hp: 2, moves: 4 });
  });

  it('skips players who are out', () => {
    const s = blankGame({ players: 3 });
    s.players[1].alive = false;
    s.units = s.units.filter((u) => u.owner !== 1);
    sync(s);
    const r = applyAction(s, 0, { type: 'endTurn' });
    expect(r.state.activeSeat).toBe(2);
  });

  it('hands a resigning player\'s cities back and moves the turn on', () => {
    const s = blankGame({ players: 3 });
    own(s, 'lisbon', 0);
    own(s, 'rome', 1);
    sync(s);
    const r = applyAction(s, 0, { type: 'resign' });
    expect(r.state.players[0].alive).toBe(false);
    expect(r.state.cities.find((c) => c.id === 'lisbon')!.owner).toBeNull();
    expect(r.state.units.some((u) => u.owner === 0)).toBe(false);
    expect(r.state.activeSeat).toBe(1);
    expect(r.state.phase).toBe('playing');
  });
});

describe('victory', () => {
  it('goes to the last player with a city or unit', () => {
    const s = blankGame({ keepAlive: false });
    own(s, 'lisbon', 0);
    const ship = put(s, 'transport', 1, 84, 25);
    const d = put(s, 'destroyer', 0, 83, 25);
    sync(s);
    const r = applyAction(s, 0, { type: 'move', unit: d.id, to: { x: 84, y: 25 } });
    expect(unit(r.state, ship.id)).toBeUndefined();
    expect(r.state).toMatchObject({ phase: 'finished', winner: 0 });
    expect(r.events.map((e) => e.type)).toEqual(['combat', 'eliminated', 'victory']);
    expect(() => applyAction(r.state, 0, { type: 'endTurn' })).toThrowError(/over/);
  });

  it('can go to whoever holds the agreed share of cities for a full round', () => {
    const s = blankGame({ settings: { victory: { kind: 'hold', percent: 50 } } });
    s.cities.slice(0, 67).forEach((c) => (c.owner = 0));
    s.cities[100].owner = 1;
    sync(s);
    let r = applyAction(s, 0, { type: 'endTurn' });
    r = applyAction(r.state, 1, { type: 'endTurn' });
    expect(r.state.phase).toBe('playing');
    expect(r.state.domination).toEqual({ seat: 0, since: 2 });
    r = applyAction(r.state, 0, { type: 'endTurn' });
    r = applyAction(r.state, 1, { type: 'endTurn' });
    expect(r.state).toMatchObject({ phase: 'finished', winner: 0 });
    expect(r.events.at(-1)).toMatchObject({ type: 'victory', reason: 'hold' });
  });

  it('resets the hold count when the share is lost', () => {
    const s = blankGame({ settings: { victory: { kind: 'hold', percent: 50 } } });
    s.cities.slice(0, 67).forEach((c) => (c.owner = 0));
    sync(s);
    let r = applyAction(s, 0, { type: 'endTurn' });
    r = applyAction(r.state, 1, { type: 'endTurn' });
    expect(r.state.domination?.seat).toBe(0);
    r.state.cities[0].owner = 1; // a city falls
    r = applyAction(r.state, 0, { type: 'endTurn' });
    r = applyAction(r.state, 1, { type: 'endTurn' });
    expect(r.state.phase).toBe('playing');
    expect(r.state.domination).toBeNull();
  });
});
