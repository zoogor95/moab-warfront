import { applyActionInPlace } from './engine';
import { quietPassFor } from './path';
import { hashSeed, randomInt, shuffle } from './rng';
import { RuleError } from './state';
import { startValue } from './starts';
import { UNITS } from './units';
import type { Action, GameState } from './types';
import { viewFor } from './view';
import { COLS, distance, neighbours, tileIndex, TILE_COUNT, type Point } from './world/world';

/**
 * A simple bot for empty seats. It plays from its own fogged view, like a person would:
 * cities build tanks, one tank stays home as a garrison, the rest head for the nearest city
 * they do not own and attack enemy land units next to them. Ships and aircraft stay put.
 */
export function playBotTurn(state: GameState, seat: number): GameState {
  if (state.phase !== 'playing' || state.activeSeat !== seat) return state;
  const s = structuredClone(state);
  const apply = (a: Action): boolean => {
    try {
      applyActionInPlace(s, seat, a, { settle: a.type === 'endTurn' });
      return true;
    } catch (e) {
      if (e instanceof RuleError) return false;
      throw e;
    }
  };

  const view = viewFor(s, seat);
  for (const c of view.cities) {
    if (c.owner === seat && c.building !== 'tank') apply({ type: 'produce', city: c.id, unitType: 'tank' });
  }

  // One distance field per turn: moves from every tile to the nearest city this bot does not own.
  const targets = view.cities.filter((c) => c.owner !== seat);
  const sample = view.units.find((u) => u.owner === seat && u.type === 'tank') ?? { id: '', type: 'tank' as const, owner: seat, x: 0, y: 0, hp: 1 };
  const field = distanceField(targets, quietPassFor(view, sample));

  const tanks = view.units.filter((u) => u.owner === seat && UNITS[u.type].domain === 'land' && !u.carriedBy);
  const garrisoned = new Set<number>();
  for (const t of tanks) {
    const here = tileIndex(t.x, t.y);
    if (view.cities.some((c) => c.owner === seat && tileIndex(c.x, c.y) === here) && !garrisoned.has(here)) {
      garrisoned.add(here);
      continue;
    }
    let pos: Point = { x: t.x, y: t.y };
    for (let step = 0; step < UNITS[t.type].moves; step++) {
      if (s.phase !== 'playing' || s.activeSeat !== seat) break;
      const foe = view.units.find((o) => o.owner !== seat && UNITS[o.type].domain === 'land' && distance(o, pos) === 1);
      if (foe) {
        apply({ type: 'move', unit: t.id, to: { x: foe.x, y: foe.y } });
        break;
      }
      const d = field[tileIndex(pos.x, pos.y)];
      if (d === Infinity || d === 0) break;
      const next = neighbours(pos.x, pos.y).find((n) => field[tileIndex(n.x, n.y)] === d - 1);
      if (!next || !apply({ type: 'move', unit: t.id, to: next })) break;
      if (!s.units.some((u) => u.id === t.id)) break; // lost while capturing
      pos = next;
      if (d - 1 === 0) break; // reached a city
    }
  }

  if (s.phase === 'playing' && s.activeSeat === seat) apply({ type: 'endTurn' });
  return s;
}

/** Breadth-first distance from every tile to the nearest goal, moving through passable tiles. */
function distanceField(goals: Point[], canPass: (p: Point) => boolean): Float64Array {
  const dist = new Float64Array(TILE_COUNT).fill(Infinity);
  const queue: number[] = [];
  for (const g of goals) {
    const i = tileIndex(g.x, g.y);
    dist[i] = 0;
    queue.push(i);
  }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const cx = cur % COLS;
    const cy = Math.floor(cur / COLS);
    for (const n of neighbours(cx, cy)) {
      const ni = tileIndex(n.x, n.y);
      if (dist[ni] !== Infinity || !canPass(n)) continue;
      dist[ni] = dist[cur] + 1;
      queue.push(ni);
    }
  }
  return dist;
}

/** A bot's start pick: a coastal city with plenty of cities nearby. */
export function botPickStart(state: GameState, seat: number): string {
  const rng = { seed: hashSeed(`${state.rng.seed}:pick:${seat}`), counter: 0 };
  const ports = shuffle(rng, state.cities.filter((c) => c.port));
  ports.sort((a, b) => startValue(b, state.cities) - startValue(a, state.cities));
  return ports[randomInt(rng, Math.min(7, ports.length))].id;
}
