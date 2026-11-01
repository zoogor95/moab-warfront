import { LOW_FUEL, UNITS, type PlayerView, type ViewUnit } from '@warfront/shared';

export function isAircraft(u: ViewUnit): boolean {
  return UNITS[u.type].domain === 'air';
}

/** Fighters and bombers carry fuel across turns; other aircraft must be back at base each turn. */
export function hasTank(u: ViewUnit): boolean {
  return UNITS[u.type].fuel !== undefined;
}

/** Fuel left: a fighter's or bomber's tank, or for a flying paratrooper the moves left this turn. */
export function fuelOf(u: ViewUnit): { left: number; max: number } {
  const max = UNITS[u.type].fuel;
  return max !== undefined ? { left: u.fuel ?? max, max } : { left: u.moves ?? 0, max: UNITS[u.type].moves };
}

/** One of your fighters or bombers out of base with little fuel left. */
export function lowFuel(view: PlayerView, u: ViewUnit): boolean {
  if (u.owner !== view.seat || !hasTank(u) || u.carriedBy) return false;
  if (view.cities.some((c) => c.owner === view.seat && c.x === u.x && c.y === u.y)) return false;
  return fuelOf(u).left < LOW_FUEL;
}
