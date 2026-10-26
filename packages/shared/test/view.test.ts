import { describe, expect, it } from 'vitest';
import { applyAction, hexHasBit, tileIndex, viewFor } from '../src';
import { blankGame, own, put, sync } from './helpers';

describe('what each player can see', () => {
  it('shows enemy units only within sight', () => {
    const s = blankGame();
    own(s, 'lisbon', 0);
    const near = put(s, 'tank', 1, 87, 25); // 2 tiles from Lisbon
    const far = put(s, 'tank', 1, 92, 22);
    sync(s);
    const ids = viewFor(s, 0).units.map((u) => u.id);
    expect(ids).toContain(near.id);
    expect(ids).not.toContain(far.id);
  });

  it('remembers enemies on tiles it can no longer see', () => {
    const s = blankGame();
    own(s, 'lisbon', 0);
    own(s, 'rome', 1);
    const scout = put(s, 'fighter', 0, 89, 25);
    const t = put(s, 'tank', 1, 89, 24);
    sync(s);
    let r = applyAction(s, 0, { type: 'move', unit: scout.id, to: { x: 88, y: 25 } });
    r = applyAction(r.state, 0, { type: 'move', unit: scout.id, to: { x: 87, y: 25 } });
    r = applyAction(r.state, 0, { type: 'move', unit: scout.id, to: { x: 86, y: 25 } });
    const v = viewFor(r.state, 0);
    expect(v.units.some((u) => u.id === t.id)).toBe(false);
    expect(v.lastSeen).toContainEqual({ x: 89, y: 24, round: 1, units: [{ type: 'tank', owner: 1, count: 1 }] });
    // Seeing the tile again replaces the memory with the truth.
    r = applyAction(r.state, 0, { type: 'move', unit: scout.id, to: { x: 87, y: 25 } });
    const back = viewFor(r.state, 0);
    expect(back.lastSeen).toHaveLength(0);
    expect(back.units.some((u) => u.id === t.id)).toBe(true);
  });

  it('forgets an enemy it watched move off a tile it can still see', () => {
    const s = blankGame();
    own(s, 'lisbon', 0);
    own(s, 'rome', 1);
    s.activeSeat = 1;
    const t = put(s, 'tank', 1, 87, 25);
    sync(s);
    const r = applyAction(s, 1, { type: 'move', unit: t.id, to: { x: 88, y: 25 } });
    expect(viewFor(r.state, 0).lastSeen).toHaveLength(0);
  });

  it('never shows another player\'s cargo, production or the match seed', () => {
    const s = blankGame();
    own(s, 'lisbon', 0);
    own(s, 'madrid', 1);
    const ship = put(s, 'transport', 0, 84, 25);
    put(s, 'tank', 0, 84, 25, { carriedBy: ship.id });
    put(s, 'fighter', 1, 86, 26); // gives seat 1 sight of the transport and Lisbon
    sync(s);
    const v = viewFor(s, 1);
    expect(v.units.filter((u) => u.owner === 0).map((u) => u.type)).toEqual(['transport']);
    const lisbon = v.cities.find((c) => c.id === 'lisbon')!;
    expect(lisbon.owner).toBe(0);
    expect(lisbon.building).toBeUndefined();
    const json = JSON.stringify(v);
    expect(json).not.toContain('"rng"');
    expect(json).not.toContain(String(s.rng.seed));
  });

  it('marks cities nobody has seen as unknown', () => {
    const s = blankGame();
    own(s, 'lisbon', 0);
    own(s, 'tokyo', 1);
    sync(s);
    const tokyo = viewFor(s, 0).cities.find((c) => c.id === 'tokyo')!;
    expect(tokyo).toMatchObject({ owner: null, known: false });
  });

  it('starts dark with unexplored terrain and opens up around your units', () => {
    const s = blankGame({ settings: { terrain: 'unexplored' } });
    for (const p of s.players) p.explored = '0'.repeat(p.explored.length);
    own(s, 'lisbon', 0);
    sync(s);
    const v = viewFor(s, 0);
    expect(hexHasBit(v.explored, tileIndex(86, 26))).toBe(true);
    expect(hexHasBit(v.explored, tileIndex(120, 40))).toBe(false);
  });

  it('tells each player only about events they saw', () => {
    const s = blankGame({ players: 3 });
    own(s, 'lisbon', 0);
    own(s, 'tokyo', 2);
    const a = put(s, 'destroyer', 0, 83, 25);
    put(s, 'transport', 1, 84, 25);
    sync(s);
    const r = applyAction(s, 0, { type: 'move', unit: a.id, to: { x: 84, y: 25 } });
    expect(r.events[0].seenBy).toEqual([0, 1]);
    expect(viewFor(r.state, 2).log).toHaveLength(0);
  });
});
