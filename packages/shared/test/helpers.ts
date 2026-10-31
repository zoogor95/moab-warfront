import { expect } from 'vitest';
import { createMatch, DEFAULT_SETTINGS, mapOf, UNITS, WORLD, type GameState, type MatchSettings, type Terrain, type Unit, type UnitType } from '../src';
import { refreshMemory } from '../src/fog';
import { createUnit, getCity, sameTile } from '../src/state';

/**
 * A playing match with no city owners, seat 0 to move, round 1. Unless `keepAlive` is false,
 * each seat gets a submarine parked in the empty South Pacific so nobody is eliminated by accident.
 */
export function blankGame(opts: { players?: number; settings?: Partial<MatchSettings>; seed?: string; keepAlive?: boolean } = {}): GameState {
  const n = opts.players ?? 2;
  const s = createMatch({
    settings: { ...DEFAULT_SETTINGS, ...opts.settings, startMode: 'auto' },
    players: Array.from({ length: n }, (_, i) => ({ name: `P${i}` })),
    seed: opts.seed ?? 'test',
  });
  for (const c of s.cities) {
    c.owner = null;
    c.building = 'tank';
    c.progress = 0;
  }
  s.units = [];
  s.log = [];
  s.round = 1;
  s.activeSeat = 0;
  s.phase = 'playing';
  for (const p of s.players) {
    p.alive = true;
    p.memory = {};
  }
  if (opts.keepAlive ?? true) {
    for (const p of s.players) {
      const x = 2 + p.seat * 3;
      if (WORLD.terrainAt(x, 62) !== 'sea') throw new Error('keep-alive tile is not sea');
      createUnit(s, 'submarine', p.seat, { x, y: 62 }).id = `keep${p.seat}`;
    }
  }
  return s;
}

/** Units on a tile, optionally of one owner. */
export function unitsAt(s: GameState, p: { x: number; y: number }, owner?: number): Unit[] {
  return s.units.filter((u) => sameTile(u, p) && (owner === undefined || u.owner === owner));
}

export function own(s: GameState, cityId: string, seat: number): void {
  getCity(s, cityId).owner = seat;
}

export function put(s: GameState, type: UnitType, owner: number, x: number, y: number, extra: Partial<Unit> = {}): Unit {
  const u = createUnit(s, type, owner, { x, y });
  Object.assign(u, extra);
  return u;
}

export function sync(s: GameState): GameState {
  refreshMemory(s);
  return s;
}

export function unit(s: GameState, id: string): Unit | undefined {
  return s.units.find((u) => u.id === id);
}

/** Terrain on the World Standard map, which scenario tests are built on. */
export function expectTerrain(x: number, y: number, t: Terrain): void {
  expect(WORLD.terrainAt(x, y), `terrain at ${x},${y}`).toBe(t);
}

/** Rules that must hold after every action. */
export function checkInvariants(s: GameState): void {
  const map = mapOf(s);
  const ids = new Set<string>();
  for (const u of s.units) {
    expect(ids.has(u.id), `duplicate id ${u.id}`).toBe(false);
    expect(map.inBounds(u.x, u.y) && u.x === map.wrapX(u.x), `${u.id} off the grid at ${u.x},${u.y}`).toBe(true);
    ids.add(u.id);
    expect(u.hp, `${u.id} hp`).toBeGreaterThan(0);
    expect(u.hp).toBeLessThanOrEqual(UNITS[u.type].hp);
    expect(u.moves).toBeGreaterThanOrEqual(0);
    expect(s.players[u.owner].alive, `unit of eliminated seat ${u.owner}`).toBe(true);
    if (u.carriedBy) {
      const carrier = s.units.find((c) => c.id === u.carriedBy);
      expect(carrier, `${u.id} aboard a missing carrier`).toBeDefined();
      expect(carrier!.owner).toBe(u.owner);
      expect(sameTile(carrier!, u), `${u.id} not with its carrier`).toBe(true);
      expect(UNITS[carrier!.type].capacity?.types).toContain(u.type);
    } else {
      const t = map.terrainAt(u.x, u.y);
      const domain = UNITS[u.type].domain;
      const city = s.cities.find((c) => sameTile(c, u));
      if (domain === 'land') expect(t, `${u.type} ${u.id} on ${t}`).toBe('land');
      if (domain === 'sea') expect(t === 'sea' || city?.owner === u.owner, `${u.type} ${u.id} ashore`).toBe(true);
    }
  }
  const owners = new Map<string, number>();
  for (const u of s.units) {
    if (u.carriedBy) continue;
    const key = `${u.x},${u.y}`;
    const o = owners.get(key);
    if (o !== undefined) expect(o, `two owners on ${key}`).toBe(u.owner);
    owners.set(key, u.owner);
  }
  for (const [kind, cap] of [['transport', 6], ['carrier', 8]] as const) {
    for (const c of s.units.filter((u) => u.type === kind)) {
      expect(s.units.filter((u) => u.carriedBy === c.id).length).toBeLessThanOrEqual(cap);
    }
  }
  for (const p of s.players) {
    if (p.alive && s.phase === 'playing') {
      const has = s.cities.some((c) => c.owner === p.seat) || s.units.some((u) => u.owner === p.seat);
      expect(has, `seat ${p.seat} alive with nothing`).toBe(true);
    }
  }
}
