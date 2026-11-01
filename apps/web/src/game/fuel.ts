import { LOW_FUEL, UNITS, type PlayerView, type ViewUnit } from '@warfront/shared';

/** Aircraft must be back at a base when the turn ends, so the moves one has left are its fuel. */
export function isAircraft(u: ViewUnit): boolean {
  return UNITS[u.type].domain === 'air';
}

/** One of your fighters or bombers out of base with little fuel left. */
export function lowFuel(view: PlayerView, u: ViewUnit): boolean {
  if (u.owner !== view.seat || (u.type !== 'fighter' && u.type !== 'bomber') || u.carriedBy) return false;
  if (view.cities.some((c) => c.owner === view.seat && c.x === u.x && c.y === u.y)) return false;
  return (u.moves ?? 0) < LOW_FUEL;
}
