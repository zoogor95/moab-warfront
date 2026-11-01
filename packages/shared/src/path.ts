import { UNITS } from './units';
import type { PlayerView, ViewUnit } from './view';
import { getMap } from './world/maps';
import type { GameMap, Point } from './world/world';

/** Shortest path by breadth-first search. Returns the steps after `from`, or null. */
export function findPath(
  map: GameMap,
  from: Point,
  isGoal: (p: Point) => boolean,
  canPass: (p: Point) => boolean,
  limit = 20000,
): Point[] | null {
  const start = map.tileIndex(from.x, from.y);
  const parent = new Map<number, number>([[start, -1]]);
  const queue: number[] = [start];
  for (let head = 0; head < queue.length && parent.size <= limit; head++) {
    const cur = queue[head];
    const { x: cx, y: cy } = map.tilePoint(cur);
    for (const n of map.neighbours(cx, cy)) {
      const ni = map.tileIndex(n.x, n.y);
      if (parent.has(ni)) continue;
      if (isGoal(n)) {
        parent.set(ni, cur);
        const path: Point[] = [];
        for (let i = ni; i !== start; i = parent.get(i)!) path.push(map.tilePoint(i));
        return path.reverse();
      }
      if (!canPass(n)) continue;
      parent.set(ni, cur);
      queue.push(ni);
    }
  }
  return null;
}

/** Tiles a unit can reach this turn without a fight, with the moves each takes. */
export function reachable(map: GameMap, from: Point, moves: number, canPass: (p: Point) => boolean): Map<number, number> {
  const out = new Map<number, number>();
  let frontier: Point[] = [from];
  const seen = new Set<number>([map.tileIndex(from.x, from.y)]);
  for (let step = 1; step <= moves; step++) {
    const next: Point[] = [];
    for (const p of frontier) {
      for (const n of map.neighbours(p.x, p.y)) {
        const i = map.tileIndex(n.x, n.y);
        if (seen.has(i) || !canPass(n)) continue;
        seen.add(i);
        out.set(i, step);
        next.push(n);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * Whether a unit can move through a tile without fighting, as far as its player knows.
 * Enemy and neutral cities are not passable for land units (entering one is a capture).
 */
export function quietPassFor(view: PlayerView, unit: ViewUnit): (p: Point) => boolean {
  const map = getMap(view.mapVersion);
  const me = view.seat;
  const domain = UNITS[unit.type].domain;
  const enemy = new Set<number>();
  const ownCarrier = new Set<number>();
  for (const u of view.units) {
    const i = map.tileIndex(u.x, u.y);
    if (u.owner !== me) enemy.add(i);
    else if (UNITS[u.type].capacity?.types.includes(unit.type)) ownCarrier.add(i);
  }
  for (const s of view.lastSeen) enemy.add(map.tileIndex(s.x, s.y));
  const cityOwner = new Map(view.cities.map((c) => [map.tileIndex(c.x, c.y), c.owner]));
  return (p: Point) => {
    const i = map.tileIndex(p.x, p.y);
    if (enemy.has(i)) return false;
    const t = map.terrainAt(p.x, p.y);
    const hasCity = cityOwner.has(i);
    const own = cityOwner.get(i) === me;
    // Fighters stay out of cities that are not yours; a paratrooper may fly in to land.
    if (domain === 'air') return unit.type === 'paratrooper' || !hasCity || own;
    if (domain === 'sea') return t === 'sea' || (hasCity && own);
    if (t === 'mountain') return false;
    if (t === 'sea') return ownCarrier.has(i);
    return !hasCity || own;
  };
}

/** For grid points (from the map, a view or a unit). Fold raw screen columns with map.wrapX first. */
export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}
