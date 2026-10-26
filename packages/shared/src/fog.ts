import { emptyBits, bitsToHex, hexToBits, setBit } from './bitset';
import { CITY_SIGHT, UNITS } from './units';
import type { GameState, TileMemory, Unit, UnitSighting } from './types';
import { distance, tileIndex, tilesWithin, TILE_COUNT } from './world/world';

/** Tiles a seat can see right now: around its cities and units. */
export function visibleTiles(s: GameState, seat: number): Set<number> {
  const out = new Set<number>();
  for (const c of s.cities) {
    if (c.owner === seat) for (const i of tilesWithin(c.x, c.y, CITY_SIGHT)) out.add(i);
  }
  for (const u of s.units) {
    if (u.owner !== seat || u.carriedBy) continue;
    for (const i of tilesWithin(u.x, u.y, UNITS[u.type].sight)) out.add(i);
  }
  return out;
}

/** Submarines show up for other players only next to one of their destroyers. */
export function subHiddenFrom(s: GameState, sub: Unit, seat: number): boolean {
  if (sub.type !== 'submarine' || sub.owner === seat) return false;
  return !s.units.some((u) => u.owner === seat && u.type === 'destroyer' && !u.carriedBy && distance(u, sub) <= 1);
}

export function canSeeUnit(s: GameState, unit: Unit, seat: number, visible: Set<number>): boolean {
  if (unit.owner === seat) return true;
  if (unit.carriedBy) return false;
  if (!visible.has(tileIndex(unit.x, unit.y))) return false;
  return !subHiddenFrom(s, unit, seat);
}

function summarize(units: Unit[]): UnitSighting[] {
  const map = new Map<string, UnitSighting>();
  for (const u of units) {
    const key = `${u.owner}:${u.type}`;
    const seen = map.get(key);
    if (seen) seen.count += 1;
    else map.set(key, { type: u.type, owner: u.owner, count: 1 });
  }
  return [...map.values()];
}

/**
 * Updates what each player has explored and remembers. Returns the visible tiles per seat,
 * which the engine reuses to decide who saw each event.
 */
export function refreshMemory(s: GameState): Map<number, Set<number>> {
  const result = new Map<number, Set<number>>();
  const cityByTile = new Map(s.cities.map((c) => [tileIndex(c.x, c.y), c]));
  for (const p of s.players) {
    const visible = visibleTiles(s, p.seat);
    result.set(p.seat, visible);
    if (!p.alive) continue;

    if (s.settings.terrain === 'unexplored') {
      const bits = hexToBits(p.explored);
      for (const i of visible) setBit(bits, i);
      p.explored = bitsToHex(bits);
    }

    const enemiesByTile = new Map<number, Unit[]>();
    for (const u of s.units) {
      if (u.owner === p.seat || !canSeeUnit(s, u, p.seat, visible)) continue;
      const i = tileIndex(u.x, u.y);
      const list = enemiesByTile.get(i);
      if (list) list.push(u);
      else enemiesByTile.set(i, [u]);
    }
    for (const i of visible) {
      const city = cityByTile.get(i);
      const enemies = enemiesByTile.get(i);
      if (!city && !enemies) {
        delete p.memory[i];
        continue;
      }
      const mem: TileMemory = { round: s.round };
      if (city) mem.cityOwner = city.owner;
      if (enemies) mem.units = summarize(enemies);
      p.memory[i] = mem;
    }
  }
  return result;
}

export function initialExplored(revealed: boolean): string {
  return bitsToHex(emptyBits(TILE_COUNT, revealed));
}
