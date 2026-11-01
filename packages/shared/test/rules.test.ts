import { describe, expect, it } from 'vitest';
import { applyAction, RuleError, UNITS, viewFor, type GameState } from '../src';
import { blankGame, expectTerrain, own, put, sync, unit, unitsAt } from './helpers';

// Iberia, on the 2-degree grid: Lisbon (85,25) is a port, Madrid (88,24) is inland,
// (89,23) is in the Pyrenees, and the Atlantic lies to the west.
const LISBON = { x: 85, y: 25 };
const MADRID = { x: 88, y: 24 };

function rejects(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RuleError);
    expect((e as RuleError).code).toBe(code);
    return;
  }
  throw new Error(`Expected the rules to refuse with ${code}`);
}

/** Runs the same action under many seeds and counts outcomes. */
function trials(base: GameState, n: number, run: (s: GameState) => boolean): number {
  let wins = 0;
  for (let i = 0; i < n; i++) {
    const s = structuredClone(base);
    s.rng = { seed: (i * 2654435761) >>> 0, counter: 0 };
    if (run(s)) wins++;
  }
  return wins / n;
}

describe('movement', () => {
  it('moves one tile per move until the unit runs out', () => {
    expectTerrain(86, 25, 'land');
    expectTerrain(87, 25, 'land');
    expectTerrain(88, 25, 'land');
    const s = sync(blankGame());
    const t = put(s, 'tank', 0, 86, 25);
    let r = applyAction(s, 0, { type: 'move', unit: t.id, to: { x: 87, y: 25 } });
    expect(unit(r.state, t.id)).toMatchObject({ x: 87, y: 25, moves: 1 });
    r = applyAction(r.state, 0, { type: 'move', unit: t.id, to: { x: 88, y: 25 } });
    expect(unit(r.state, t.id)).toMatchObject({ x: 88, moves: 0 });
    rejects(() => applyAction(r.state, 0, { type: 'move', unit: t.id, to: { x: 87, y: 25 } }), 'no-moves');
  });

  it('refuses moves that skip tiles or use someone else\'s unit', () => {
    const s = sync(blankGame());
    const t = put(s, 'tank', 0, 86, 25);
    const theirs = put(s, 'tank', 1, 88, 25);
    rejects(() => applyAction(s, 0, { type: 'move', unit: t.id, to: { x: 88, y: 25 } }), 'not-adjacent');
    rejects(() => applyAction(s, 0, { type: 'move', unit: theirs.id, to: { x: 89, y: 25 } }), 'not-yours');
  });

  it('keeps land units off mountains and open sea', () => {
    expectTerrain(89, 23, 'mountain');
    expectTerrain(85, 24, 'sea');
    const s = sync(blankGame());
    const a = put(s, 'tank', 0, 88, 23);
    const b = put(s, 'tank', 0, 86, 24);
    rejects(() => applyAction(s, 0, { type: 'move', unit: a.id, to: { x: 89, y: 23 } }), 'cannot-enter');
    rejects(() => applyAction(s, 0, { type: 'move', unit: b.id, to: { x: 85, y: 24 } }), 'cannot-enter');
  });

  it('keeps ships at sea or in their own ports', () => {
    expectTerrain(84, 25, 'sea');
    const s = sync(blankGame());
    const d = put(s, 'destroyer', 0, 84, 25);
    rejects(() => applyAction(s, 0, { type: 'move', unit: d.id, to: LISBON }), 'cannot-enter');
    own(s, 'lisbon', 0);
    const r = applyAction(s, 0, { type: 'move', unit: d.id, to: LISBON });
    expect(unit(r.state, d.id)).toMatchObject(LISBON);
  });

  it('lets aircraft cross land, sea and mountains', () => {
    const s = sync(blankGame());
    const f = put(s, 'fighter', 0, 88, 24);
    let r = applyAction(s, 0, { type: 'move', unit: f.id, to: { x: 89, y: 23 } });
    r = applyAction(r.state, 0, { type: 'move', unit: f.id, to: { x: 90, y: 22 } });
    expect(unit(r.state, f.id)).toMatchObject({ x: 90, y: 22, moves: 6 });
  });

  it('wraps across the date line', () => {
    const s = sync(blankGame());
    const d = put(s, 'destroyer', 0, 0, 45);
    expectTerrain(0, 45, 'sea');
    expectTerrain(179, 45, 'sea');
    const r = applyAction(s, 0, { type: 'move', unit: d.id, to: { x: -1, y: 45 } });
    expect(unit(r.state, d.id)).toMatchObject({ x: 179, y: 45 });
  });
});

describe('transports and carriers', () => {
  it('carry tanks, move them along and let them off on land', () => {
    expectTerrain(84, 24, 'sea');
    const s = blankGame();
    own(s, 'lisbon', 0);
    const ship = put(s, 'transport', 0, 84, 25);
    const t = put(s, 'tank', 0, 85, 25);
    sync(s);
    let r = applyAction(s, 0, { type: 'move', unit: t.id, to: { x: 84, y: 25 } });
    expect(unit(r.state, t.id)).toMatchObject({ carriedBy: ship.id, x: 84, y: 25 });
    r = applyAction(r.state, 0, { type: 'move', unit: ship.id, to: { x: 84, y: 24 } });
    expect(unit(r.state, t.id)).toMatchObject({ x: 84, y: 24, carriedBy: ship.id });
    r = applyAction(r.state, 0, { type: 'move', unit: ship.id, to: { x: 84, y: 25 } });
    r = applyAction(r.state, 0, { type: 'move', unit: t.id, to: LISBON });
    expect(unit(r.state, t.id)).toMatchObject({ ...LISBON, carriedBy: undefined });
  });

  it('hold six tanks and no more', () => {
    const s = blankGame();
    own(s, 'lisbon', 0);
    const ship = put(s, 'transport', 0, 84, 25);
    for (let i = 0; i < 6; i++) put(s, 'tank', 0, 84, 25, { carriedBy: ship.id });
    const extra = put(s, 'tank', 0, 85, 25);
    sync(s);
    rejects(() => applyAction(s, 0, { type: 'move', unit: extra.id, to: { x: 84, y: 25 } }), 'cannot-enter');
  });

  it('can be boarded and left inside your own port', () => {
    const s = blankGame();
    own(s, 'lisbon', 0);
    const ship = put(s, 'transport', 0, 85, 25);
    const t = put(s, 'tank', 0, 85, 25);
    sync(s);
    let r = applyAction(s, 0, { type: 'board', unit: t.id, carrier: ship.id });
    expect(unit(r.state, t.id)?.carriedBy).toBe(ship.id);
    r = applyAction(r.state, 0, { type: 'leave', unit: t.id });
    expect(unit(r.state, t.id)?.carriedBy).toBeUndefined();
  });

  it('sink with everything aboard', () => {
    const s = blankGame();
    const ship = put(s, 'transport', 1, 84, 25);
    const a = put(s, 'tank', 1, 84, 25, { carriedBy: ship.id });
    const b = put(s, 'tank', 1, 84, 25, { carriedBy: ship.id });
    const d = put(s, 'destroyer', 0, 83, 25);
    sync(s);
    // A transport has no attack, so the destroyer cannot lose.
    const r = applyAction(s, 0, { type: 'move', unit: d.id, to: { x: 84, y: 25 } });
    for (const gone of [ship, a, b]) expect(unit(r.state, gone.id)).toBeUndefined();
    expect(r.events[0]).toMatchObject({ type: 'combat', winner: 'attacker' });
  });

  it('let fighters land on a carrier at sea', () => {
    expectTerrain(70, 25, 'sea');
    expectTerrain(71, 25, 'sea');
    const s = blankGame();
    const c = put(s, 'carrier', 0, 70, 25);
    const f = put(s, 'fighter', 0, 71, 25);
    sync(s);
    const r = applyAction(s, 0, { type: 'move', unit: f.id, to: { x: 70, y: 25 } });
    expect(unit(r.state, f.id)?.carriedBy).toBe(c.id);
  });
});

describe('combat', () => {
  it('destroys the loser and uses up the attacker\'s moves', () => {
    const s = blankGame();
    own(s, 'rome', 1);
    const a = put(s, 'tank', 0, 86, 25);
    const b = put(s, 'tank', 1, 87, 25);
    sync(s);
    const r = applyAction(s, 0, { type: 'move', unit: a.id, to: { x: 87, y: 25 } });
    const left = r.state.units.filter((u) => u.id === a.id || u.id === b.id);
    expect(left).toHaveLength(1);
    expect(unit(r.state, a.id)?.x ?? 86).toBe(86); // the attacker never moves in
    if (unit(r.state, a.id)) expect(unit(r.state, a.id)!.moves).toBe(0);
  });

  it('gives the attacker half the rounds in the open and 40% against a defended city', () => {
    const open = blankGame();
    own(open, 'rome', 1);
    const a = put(open, 'tank', 0, 86, 25);
    put(open, 'tank', 1, 87, 25);
    sync(open);
    const openRate = trials(open, 3000, (s) => Boolean(unit(applyAction(s, 0, { type: 'move', unit: a.id, to: { x: 87, y: 25 } }).state, a.id)));
    expect(openRate).toBeGreaterThan(0.47);
    expect(openRate).toBeLessThan(0.53);

    const city = blankGame();
    own(city, 'madrid', 1);
    const b = put(city, 'tank', 0, 87, 24);
    put(city, 'tank', 1, MADRID.x, MADRID.y);
    sync(city);
    const cityRate = trials(city, 3000, (s) => Boolean(unit(applyAction(s, 0, { type: 'move', unit: b.id, to: MADRID }).state, b.id)));
    expect(cityRate).toBeGreaterThan(0.37);
    expect(cityRate).toBeLessThan(0.43);
  });

  it('fights a big ship over many rounds, so damage carries over', () => {
    const s = blankGame();
    own(s, 'rome', 1);
    const sub = put(s, 'submarine', 0, 70, 25);
    const bb = put(s, 'battleship', 1, 71, 25);
    sync(s);
    const r = applyAction(s, 0, { type: 'move', unit: sub.id, to: { x: 71, y: 25 } });
    const survivor = unit(r.state, sub.id) ?? unit(r.state, bb.id)!;
    expect(survivor.hp).toBeGreaterThan(0);
    expect(r.state.units.some((u) => u.id === sub.id) !== r.state.units.some((u) => u.id === bb.id)).toBe(true);
  });

  it('lets each unit attack only what it can reach', () => {
    const s = blankGame();
    own(s, 'lisbon', 1);
    const ship = put(s, 'transport', 0, 83, 25);
    const tank = put(s, 'tank', 0, 86, 24);
    put(s, 'destroyer', 1, 84, 25);
    put(s, 'destroyer', 1, 85, 24);
    put(s, 'tank', 1, 85, 25);
    const bb = put(s, 'battleship', 0, 84, 26);
    sync(s);
    rejects(() => applyAction(s, 0, { type: 'move', unit: ship.id, to: { x: 84, y: 25 } }), 'cannot-attack');
    rejects(() => applyAction(s, 0, { type: 'move', unit: tank.id, to: { x: 85, y: 24 } }), 'cannot-attack');
    // A battleship can shell units on the coast, even inside a city.
    const r = applyAction(s, 0, { type: 'move', unit: bb.id, to: LISBON });
    expect(r.events[0]).toMatchObject({ type: 'combat', defender: { type: 'tank' } });
  });
});

describe('capturing cities', () => {
  it('always takes a neutral city', () => {
    const base = blankGame();
    const t = put(base, 'tank', 0, 87, 24);
    sync(base);
    expect(base.cities.find((c) => c.id === 'madrid')!.owner).toBeNull();
    const rate = trials(base, 200, (s) => {
      const r = applyAction(s, 0, { type: 'move', unit: t.id, to: MADRID });
      expect(r.events[0]).toMatchObject({ type: 'captured', city: 'madrid', from: null });
      expect(unit(r.state, t.id)).toMatchObject({ ...MADRID, moves: 0 });
      return r.state.cities.find((c) => c.id === 'madrid')!.owner === 0;
    });
    expect(rate).toBe(1);
  });

  it('takes an undefended enemy city half the time and loses the tank otherwise', () => {
    const base = blankGame();
    own(base, 'madrid', 1);
    const t = put(base, 'tank', 0, 87, 24);
    sync(base);
    let lost = 0;
    const rate = trials(base, 2000, (s) => {
      const r = applyAction(s, 0, { type: 'move', unit: t.id, to: MADRID });
      const madrid = r.state.cities.find((c) => c.id === 'madrid')!;
      if (madrid.owner === 0) {
        expect(unit(r.state, t.id)).toMatchObject({ ...MADRID, moves: 0 });
        expect(madrid).toMatchObject({ building: 'tank', progress: 0 });
        return true;
      }
      expect(unit(r.state, t.id)).toBeUndefined();
      lost++;
      return false;
    });
    expect(rate).toBeGreaterThan(0.46);
    expect(rate).toBeLessThan(0.54);
    expect(lost).toBeGreaterThan(0);
  });

  it('destroys ships and aircraft left in a city it takes', () => {
    const base = blankGame();
    own(base, 'madrid', 1);
    const plane = put(base, 'fighter', 1, MADRID.x, MADRID.y);
    const t = put(base, 'tank', 0, 87, 24);
    sync(base);
    let checked = false;
    trials(base, 20, (s) => {
      const r = applyAction(s, 0, { type: 'move', unit: t.id, to: MADRID });
      if (r.state.cities.find((c) => c.id === 'madrid')!.owner === 0) {
        expect(unit(r.state, plane.id)).toBeUndefined();
        checked = true;
      }
      return true;
    });
    expect(checked).toBe(true);
  });

  it('is only for tanks moving in; paratroopers capture by landing', () => {
    const s = sync(blankGame());
    const f = put(s, 'fighter', 0, 87, 24);
    const r = applyAction(s, 0, { type: 'move', unit: f.id, to: MADRID });
    expect(r.state.cities.find((c) => c.id === 'madrid')!.owner).toBeNull();
  });
});

describe('production', () => {
  function cycle(s: GameState, rounds: number): GameState {
    let cur = s;
    for (let i = 0; i < rounds * cur.players.length; i++) cur = applyAction(cur, cur.activeSeat, { type: 'endTurn' }).state;
    return cur;
  }

  it('finishes a tank after five of its owner\'s turns', () => {
    const s = blankGame();
    own(s, 'lisbon', 0);
    own(s, 'rome', 1);
    sync(s);
    const after4 = cycle(s, 4);
    expect(unitsAt(after4, LISBON)).toHaveLength(0);
    const after5 = cycle(after4, 1);
    const built = unitsAt(after5, LISBON);
    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({ type: 'tank', ...LISBON, moves: 2 });
    expect(after5.log.some((e) => e.type === 'built' && e.seenBy.includes(0) && !e.seenBy.includes(1))).toBe(true);
  });

  it('halves build times with fast production', () => {
    const s = blankGame({ settings: { production: 'fast' } });
    own(s, 'lisbon', 0);
    own(s, 'rome', 1);
    sync(s);
    expect(unitsAt(cycle(s, 3), LISBON)).toHaveLength(1);
  });

  it('restarts progress when the city switches, and builds ships only in ports', () => {
    const s = blankGame();
    own(s, 'lisbon', 0);
    own(s, 'madrid', 0);
    own(s, 'rome', 1);
    sync(s);
    const mid = cycle(s, 2);
    expect(mid.cities.find((c) => c.id === 'lisbon')!.progress).toBe(2);
    const r = applyAction(mid, 0, { type: 'produce', city: 'lisbon', unitType: 'destroyer' });
    expect(r.state.cities.find((c) => c.id === 'lisbon')).toMatchObject({ building: 'destroyer', progress: 0 });
    rejects(() => applyAction(mid, 0, { type: 'produce', city: 'madrid', unitType: 'destroyer' }), 'not-a-port');
    rejects(() => applyAction(mid, 0, { type: 'produce', city: 'rome', unitType: 'tank' }), 'not-yours');
  });
});

describe('aircraft', () => {
  it('fly home to the nearest base in range when the turn ends', () => {
    const s = blankGame();
    own(s, 'lisbon', 0);
    own(s, 'rome', 1);
    const f = put(s, 'fighter', 0, 88, 25, { moves: 5 });
    sync(s);
    const r = applyAction(s, 0, { type: 'endTurn' });
    expect(unit(r.state, f.id)).toMatchObject(LISBON);
  });

  it('are lost when no base is in range', () => {
    const s = blankGame();
    own(s, 'lisbon', 0);
    own(s, 'rome', 1);
    const f = put(s, 'fighter', 0, 70, 25, { moves: 1 });
    sync(s);
    const r = applyAction(s, 0, { type: 'endTurn' });
    expect(unit(r.state, f.id)).toBeUndefined();
    expect(r.events.some((e) => e.type === 'outOfFuel')).toBe(true);
  });
});

describe('bombers', () => {
  it('destroy every unit within 2 tiles, friend or foe, and are used up', () => {
    expectTerrain(89, 25, 'land');
    const s = blankGame();
    own(s, 'lisbon', 0);
    own(s, 'rome', 1);
    const b = put(s, 'bomber', 0, 85, 25);
    const mine = put(s, 'tank', 0, 86, 25);
    const theirs = put(s, 'tank', 1, 87, 25);
    const edge = put(s, 'tank', 1, 89, 25);
    const safe = put(s, 'tank', 1, 90, 24);
    sync(s);
    const r = applyAction(s, 0, { type: 'strike', unit: b.id, to: { x: 87, y: 25 } });
    for (const gone of [b, mine, theirs, edge]) expect(unit(r.state, gone.id)).toBeUndefined();
    expect(unit(r.state, safe.id)).toBeDefined();
    expect(r.events[0]).toMatchObject({ type: 'strike', destroyed: expect.arrayContaining([expect.objectContaining({ id: mine.id })]) });
  });

  it('reach only as far as their moves', () => {
    const s = sync(blankGame());
    const b = put(s, 'bomber', 0, 85, 25);
    rejects(() => applyAction(s, 0, { type: 'strike', unit: b.id, to: { x: 92, y: 25 } }), 'out-of-range');
  });
});

describe('paratroopers', () => {
  it('fly over sea and land like aircraft, as far as a fighter', () => {
    expectTerrain(84, 25, 'sea');
    const s = blankGame();
    own(s, 'lisbon', 0);
    const p = put(s, 'paratrooper', 0, 85, 25);
    sync(s);
    let r = applyAction(s, 0, { type: 'move', unit: p.id, to: { x: 84, y: 25 } });
    expect(unit(r.state, p.id)).toMatchObject({ x: 84, y: 25, moves: UNITS.fighter.moves - 1 });
    r = applyAction(r.state, 0, { type: 'move', unit: p.id, to: { x: 85, y: 25 } });
    expect(unit(r.state, p.id)).toMatchObject({ moves: UNITS.fighter.moves - 2 });
  });

  it('become a tank when they land on open ground', () => {
    expectTerrain(87, 25, 'land');
    const s = blankGame();
    own(s, 'lisbon', 0);
    const p = put(s, 'paratrooper', 0, 87, 25);
    sync(s);
    const r = applyAction(s, 0, { type: 'land', unit: p.id });
    expect(unit(r.state, p.id)).toMatchObject({ type: 'tank', x: 87, y: 25, moves: 0 });
    expect(r.events[0]).toMatchObject({ type: 'landed', unit: { id: p.id, type: 'paratrooper' } });
  });

  it('cannot attack from the air, and fighters can shoot them down', () => {
    const s = blankGame();
    own(s, 'lisbon', 0);
    const p = put(s, 'paratrooper', 0, 86, 25);
    put(s, 'tank', 1, 87, 25);
    const f = put(s, 'fighter', 1, 86, 26);
    sync(s);
    rejects(() => applyAction(s, 0, { type: 'move', unit: p.id, to: { x: 87, y: 25 } }), 'cannot-attack');
    s.activeSeat = 1;
    const r = applyAction(s, 1, { type: 'move', unit: f.id, to: { x: 86, y: 25 } });
    expect(r.events[0]).toMatchObject({ type: 'combat', defender: { type: 'paratrooper' } });
  });

  it('take a neutral city by landing on it, and an enemy city half the time', () => {
    const base = blankGame();
    own(base, 'lisbon', 0);
    const p = put(base, 'paratrooper', 0, MADRID.x, MADRID.y);
    sync(base);
    const taken = (s: GameState) => {
      const r = applyAction(s, 0, { type: 'land', unit: p.id });
      const won = r.state.cities.find((c) => c.id === 'madrid')!.owner === 0;
      if (won) expect(unit(r.state, p.id)).toMatchObject({ type: 'tank', moves: 0 });
      else expect(unit(r.state, p.id)).toBeUndefined();
      return won;
    };
    expect(trials(base, 50, taken)).toBe(1);
    own(base, 'madrid', 1);
    const rate = trials(base, 400, taken);
    expect(rate).toBeGreaterThan(0.4);
    expect(rate).toBeLessThan(0.6);
  });

  it('do not capture by flying over a city', () => {
    const s = blankGame();
    own(s, 'lisbon', 0);
    const p = put(s, 'paratrooper', 0, 87, 24);
    sync(s);
    const r = applyAction(s, 0, { type: 'move', unit: p.id, to: MADRID });
    expect(r.state.cities.find((c) => c.id === 'madrid')!.owner).toBeNull();
    expect(unit(r.state, p.id)).toMatchObject({ type: 'paratrooper', ...MADRID });
  });

  it('refuse to land at sea, in the mountains, or for other units', () => {
    expectTerrain(85, 24, 'sea');
    expectTerrain(89, 23, 'mountain');
    const s = blankGame();
    own(s, 'lisbon', 0);
    const wet = put(s, 'paratrooper', 0, 85, 24);
    const high = put(s, 'paratrooper', 0, 89, 23);
    const f = put(s, 'fighter', 0, 87, 25);
    sync(s);
    rejects(() => applyAction(s, 0, { type: 'land', unit: wet.id }), 'cannot-land');
    rejects(() => applyAction(s, 0, { type: 'land', unit: high.id }), 'cannot-land');
    rejects(() => applyAction(s, 0, { type: 'land', unit: f.id }), 'cannot-land');
  });

  it('fly home or are lost if still in the air at turn end', () => {
    const s = blankGame();
    own(s, 'lisbon', 0);
    own(s, 'rome', 1);
    const near = put(s, 'paratrooper', 0, 87, 25);
    const far = put(s, 'paratrooper', 0, 120, 30);
    sync(s);
    near.moves = 3;
    far.moves = 3;
    const r = applyAction(s, 0, { type: 'endTurn' });
    expect(unit(r.state, near.id)).toMatchObject({ ...LISBON, type: 'paratrooper' });
    expect(unit(r.state, far.id)).toBeUndefined();
    expect(r.events.some((e) => e.type === 'outOfFuel' && e.unit.id === far.id)).toBe(true);
  });

  it('cannot ride transports', () => {
    const s = blankGame();
    own(s, 'lisbon', 0);
    const ship = put(s, 'transport', 0, LISBON.x, LISBON.y);
    const p = put(s, 'paratrooper', 0, LISBON.x, LISBON.y);
    sync(s);
    rejects(() => applyAction(s, 0, { type: 'board', unit: p.id, carrier: ship.id }), 'cannot-carry');
  });
});

describe('submarines', () => {
  it('stay hidden unless next to an enemy destroyer', () => {
    const s = blankGame();
    own(s, 'rome', 1);
    const sub = put(s, 'submarine', 1, 70, 25);
    put(s, 'transport', 0, 71, 24);
    sync(s);
    expect(viewFor(s, 0).units.some((u) => u.id === sub.id)).toBe(false);
    put(s, 'destroyer', 0, 71, 25);
    sync(s);
    expect(viewFor(s, 0).units.some((u) => u.id === sub.id)).toBe(true);
  });

  it('stop a ship that sails into them unseen', () => {
    const s = blankGame();
    own(s, 'rome', 1);
    put(s, 'submarine', 1, 70, 25);
    const ship = put(s, 'transport', 0, 71, 25);
    sync(s);
    const r = applyAction(s, 0, { type: 'move', unit: ship.id, to: { x: 70, y: 25 } });
    expect(unit(r.state, ship.id)).toMatchObject({ x: 71, y: 25, moves: 0 });
    expect(r.events[0]).toMatchObject({ type: 'blocked' });
  });
});
