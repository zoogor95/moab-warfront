import { buildTurns, UNITS } from './units';
import type { GameState, Unit } from './types';
import { canCarry, createUnit, emit, freeSpace, ownCityAt, placeUnit, ref, removeUnit } from './state';
import { mapOf } from './world/maps';

/** Start of a seat's turn: production, repairs, fresh moves. */
export function beginTurn(s: GameState, seat: number): void {
  const fast = s.settings.production === 'fast';
  for (const city of s.cities) {
    if (city.owner !== seat) continue;
    city.progress += 1;
    if (city.progress >= buildTurns(city.building, fast)) {
      const unit = createUnit(s, city.building, seat, city);
      city.progress = 0;
      emit(s, { type: 'built', city: city.id, owner: seat, unit: unit.type, unitId: unit.id }, [seat]);
    }
  }
  for (const u of s.units) {
    if (u.owner !== seat) continue;
    if (u.hp < UNITS[u.type].hp && ownCityAt(s, u, seat)) u.hp += 1;
    u.moves = UNITS[u.type].moves;
    const fuel = UNITS[u.type].fuel;
    if (fuel !== undefined && (u.carriedBy || ownCityAt(s, u, seat))) u.fuel = fuel;
  }
}

/** Aircraft without a fuel tank (bombers, flying paratroopers) must end the turn at a base. */
export function landAircraft(s: GameState, seat: number): void {
  const flying = s.units.filter((u) => u.owner === seat && UNITS[u.type].domain === 'air' && UNITS[u.type].fuel === undefined && !u.carriedBy && !ownCityAt(s, u, seat));
  for (const plane of flying) {
    const base = nearestBase(s, plane);
    if (base) {
      if ('type' in base) plane.carriedBy = base.id;
      placeUnit(s, plane, base);
      plane.moves = 0;
    } else {
      removeUnit(s, plane.id);
      emit(s, { type: 'outOfFuel', unit: ref(plane), x: plane.x, y: plane.y }, [seat], plane);
    }
  }
}

function nearestBase(s: GameState, plane: Unit) {
  type Base = { x: number; y: number; d: number; carrier?: Unit };
  const options: Base[] = [];
  const map = mapOf(s);
  for (const c of s.cities) if (c.owner === plane.owner) options.push({ x: c.x, y: c.y, d: map.distance(c, plane) });
  for (const u of s.units) {
    if (u.owner === plane.owner && !u.carriedBy && canCarry(u, plane.type) && freeSpace(s, u) > 0) options.push({ x: u.x, y: u.y, d: map.distance(u, plane), carrier: u });
  }
  const reachable = options.filter((o) => o.d <= plane.moves).sort((a, b) => a.d - b.d || (a.carrier ? 1 : 0) - (b.carrier ? 1 : 0));
  const best = reachable[0];
  if (!best) return undefined;
  return best.carrier ?? { x: best.x, y: best.y };
}

/** Marks players with no city and no unit as out, and ends the match when one is left. */
export function settleSurvivors(s: GameState): void {
  if (s.phase !== 'playing') return;
  for (const p of s.players) {
    if (!p.alive) continue;
    const hasCity = s.cities.some((c) => c.owner === p.seat);
    const hasUnit = s.units.some((u) => u.owner === p.seat);
    if (!hasCity && !hasUnit) {
      p.alive = false;
      emit(s, { type: 'eliminated', seat: p.seat }, s.players.map((q) => q.seat));
    }
  }
  const alive = s.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    s.phase = 'finished';
    s.winner = alive[0]?.seat ?? null;
    if (s.winner !== null) emit(s, { type: 'victory', seat: s.winner, reason: 'last' }, s.players.map((q) => q.seat));
  }
}

/** Hands the turn to the next player still in the match. A new round starts after the last seat. */
export function advanceTurn(s: GameState): void {
  if (s.phase !== 'playing') return;
  const n = s.players.length;
  let next = s.activeSeat;
  for (let i = 1; i <= n; i++) {
    const seat = (s.activeSeat + i) % n;
    if (s.players[seat].alive) {
      next = seat;
      break;
    }
  }
  if (next <= s.activeSeat) {
    s.round += 1;
    checkDomination(s);
    if (s.phase !== 'playing') return;
  }
  s.activeSeat = next;
  beginTurn(s, next);
}

/** Hold-cities victory: a player who holds the share at the start of two rounds in a row wins. */
function checkDomination(s: GameState): void {
  const rule = s.settings.victory;
  if (rule.kind !== 'hold') return;
  const need = Math.ceil((rule.percent / 100) * s.cities.length);
  const counts = new Map<number, number>();
  for (const c of s.cities) if (c.owner !== null) counts.set(c.owner, (counts.get(c.owner) ?? 0) + 1);
  const leader = [...counts.entries()].find(([, n]) => n >= need)?.[0];
  if (leader === undefined) {
    s.domination = null;
    return;
  }
  if (s.domination?.seat === leader && s.domination.since < s.round) {
    s.phase = 'finished';
    s.winner = leader;
    emit(s, { type: 'victory', seat: leader, reason: 'hold' }, s.players.map((q) => q.seat));
  } else if (s.domination?.seat !== leader) {
    s.domination = { seat: leader, since: s.round };
  }
}
