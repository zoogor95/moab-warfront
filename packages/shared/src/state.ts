import { UNITS, type UnitType } from './units';
import type { City, GameEvent, GameState, LoggedEvent, Unit, UnitRef } from './types';
import { mapOf } from './world/maps';
import type { Point } from './world/world';

export class RuleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'RuleError';
  }
}

export function fail(code: string, message: string): never {
  throw new RuleError(code, message);
}

/** Stored positions are always on the grid (createUnit and placeUnit fold them), so plain equality works. */
export function sameTile(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export function findUnit(s: GameState, id: string): Unit | undefined {
  return s.units.find((u) => u.id === id);
}

export function getUnit(s: GameState, id: string): Unit {
  return findUnit(s, id) ?? fail('no-unit', `There is no unit ${id}`);
}

export function getCity(s: GameState, id: string): City {
  return s.cities.find((c) => c.id === id) ?? fail('no-city', `There is no city ${id}`);
}

export function unitsOnTile(s: GameState, p: Point): Unit[] {
  return s.units.filter((u) => sameTile(u, p));
}

/** Units on a tile that are not aboard anything. */
export function topUnitsOnTile(s: GameState, p: Point): Unit[] {
  return s.units.filter((u) => !u.carriedBy && sameTile(u, p));
}

export function cargoOf(s: GameState, carrierId: string): Unit[] {
  return s.units.filter((u) => u.carriedBy === carrierId);
}

export function cityAt(s: GameState, p: Point): City | undefined {
  return s.cities.find((c) => sameTile(c, p));
}

export function ownCityAt(s: GameState, p: Point, seat: number): boolean {
  return cityAt(s, p)?.owner === seat;
}

export function canCarry(carrier: Unit, type: UnitType): boolean {
  return UNITS[carrier.type].capacity?.types.includes(type) ?? false;
}

export function freeSpace(s: GameState, carrier: Unit): number {
  const cap = UNITS[carrier.type].capacity?.count ?? 0;
  return cap - cargoOf(s, carrier.id).length;
}

export function createUnit(s: GameState, type: UnitType, owner: number, at: Point): Unit {
  const unit: Unit = {
    id: `u${s.nextId++}`,
    type,
    owner,
    x: mapOf(s).wrapX(at.x),
    y: at.y,
    hp: UNITS[type].hp,
    moves: UNITS[type].moves,
  };
  s.units.push(unit);
  return unit;
}

/** Removes a unit and anything aboard it. Returns everything removed. */
export function removeUnit(s: GameState, id: string): Unit[] {
  const removed = s.units.filter((u) => u.id === id || u.carriedBy === id);
  s.units = s.units.filter((u) => u.id !== id && u.carriedBy !== id);
  return removed;
}

/** Moves a unit and its cargo to a tile. */
export function placeUnit(s: GameState, unit: Unit, p: Point): void {
  unit.x = mapOf(s).wrapX(p.x);
  unit.y = p.y;
  for (const c of cargoOf(s, unit.id)) {
    c.x = unit.x;
    c.y = unit.y;
  }
}

export function ref(u: Unit): UnitRef {
  return { id: u.id, type: u.type, owner: u.owner };
}

/**
 * Records an event. `involves` are seats that always learn of it; anyone else who can see
 * `at` once the action finishes learns of it too (filled in by the engine).
 */
export function emit(s: GameState, event: GameEvent, involves: number[], at?: Point): void {
  const logged: LoggedEvent & { involves?: number[]; at?: Point } = {
    ...event,
    round: s.round,
    turnOf: s.activeSeat,
    seenBy: [],
    involves,
    at,
  };
  s.log.push(logged);
}
