import { randomInt, shuffle, type RngState } from './rng';
import { START_SPACING, START_VALUE_RADIUS } from './units';
import type { City } from './types';
import type { GameMap } from './world/world';

/** How many other cities lie within reach of a start. */
export function startValue(map: GameMap, city: City, all: readonly City[]): number {
  return all.filter((c) => c.id !== city.id && map.distance(c, city) <= START_VALUE_RADIUS).length;
}

function spacedFrom(map: GameMap, city: City, chosen: readonly City[]): boolean {
  return chosen.every((c) => map.distance(c, city) >= START_SPACING);
}

/**
 * Auto starts: coastal cities at least START_SPACING apart. Samples many spread-out sets and
 * picks at random among the best, scoring distance between starts and how even their values are.
 */
export function chooseAutoStarts(map: GameMap, rng: RngState, cities: readonly City[], count: number): City[] {
  const ports = cities.filter((c) => c.port);
  const value = new Map(ports.map((c) => [c.id, startValue(map, c, cities)]));
  const scored: { score: number; set: City[] }[] = [];
  for (let attempt = 0; attempt < 300; attempt++) {
    const set: City[] = [];
    for (const c of shuffle(rng, ports)) {
      if ((value.get(c.id) ?? 0) < 2) continue; // avoid lonely islands
      if (spacedFrom(map, c, set)) set.push(c);
      if (set.length === count) break;
    }
    if (set.length < count) continue;
    let minDist = Infinity;
    for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) minDist = Math.min(minDist, map.distance(set[i], set[j]));
    const values = set.map((c) => value.get(c.id) ?? 0);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    scored.push({ score: Math.min(minDist, 40) + 2 * lo - (hi - lo), set });
  }
  if (!scored.length) throw new Error(`Could not place ${count} starts`);
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 5);
  return top[randomInt(rng, top.length)].set;
}

/** Best open port for a player whose pick clashed or who did not pick in time. */
export function bestOpenStart(map: GameMap, rng: RngState, cities: readonly City[], taken: readonly City[]): City {
  const open = cities.filter((c) => c.port && spacedFrom(map, c, taken));
  if (!open.length) throw new Error('No open start left');
  const scored = shuffle(rng, open).map((c) => {
    const nearest = taken.length ? Math.min(...taken.map((t) => map.distance(t, c))) : 40;
    return { c, score: 2 * startValue(map, c, cities) + Math.min(nearest, 40) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].c;
}

/**
 * Hidden picks. Seats are settled from the last in turn order to the first: a pick within
 * START_SPACING of one already settled loses, and that player moves to the best open city.
 */
export function resolvePicks(
  map: GameMap,
  rng: RngState,
  cities: readonly City[],
  seats: number,
  picks: Readonly<Record<number, string>>,
): { starts: Record<number, City>; moved: number[] } {
  const byId = new Map(cities.map((c) => [c.id, c]));
  const starts: Record<number, City> = {};
  const unsettled: number[] = [];
  const moved: number[] = [];
  for (let seat = seats - 1; seat >= 0; seat--) {
    const pick = picks[seat] !== undefined ? byId.get(picks[seat]) : undefined;
    if (pick && pick.port && spacedFrom(map, pick, Object.values(starts))) starts[seat] = pick;
    else {
      unsettled.push(seat);
      if (pick) moved.push(seat);
    }
  }
  for (const seat of unsettled) starts[seat] = bestOpenStart(map, rng, cities, Object.values(starts));
  return { starts, moved: moved.sort((a, b) => a - b) };
}
