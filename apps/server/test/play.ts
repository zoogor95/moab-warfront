import { expect } from 'vitest';
import { distance, findPath, hexHasBit, quietPassFor, samePoint, tileIndex, UNITS, type MatchUpdateMsg, type Point } from '@warfront/shared';
import type { Player } from './client';

const STOPS = new Set(['combat', 'blocked', 'captured', 'captureFailed']);

/**
 * Plays one turn the way a person with only their own view could: tanks head for the nearest
 * city they do not own and attack enemy land units next to them; one tank stays in each city.
 * Returns the rev after its endTurn, or null if it was not this player's turn.
 */
export async function playTurnFromView(p: Player, matchId: string): Promise<number | null> {
  let view = p.update!.view;
  const seat = view.seat;
  const garrisoned = new Set<number>();
  const tanks = view.units.filter((u) => u.owner === seat && UNITS[u.type].domain === 'land' && !u.carriedBy);
  for (const start of tanks) {
    view = p.update!.view;
    if (view.phase !== 'playing' || view.activeSeat !== seat) return null;
    let unit = view.units.find((u) => u.id === start.id);
    if (!unit) continue;
    const here = tileIndex(unit.x, unit.y);
    if (view.cities.some((c) => c.owner === seat && tileIndex(c.x, c.y) === here) && !garrisoned.has(here)) {
      garrisoned.add(here);
      continue;
    }
    while (unit && (unit.moves ?? 0) > 0) {
      const foe = view.units.find((o) => o.owner !== seat && UNITS[o.type].domain === 'land' && distance(o, unit!) === 1);
      let to: Point | undefined = foe ? { x: foe.x, y: foe.y } : undefined;
      if (!to) {
        const targets = view.cities.filter((c) => c.owner !== seat);
        const path = findPath(unit, (q) => targets.some((c) => samePoint(c, q)), quietPassFor(view, unit), 8000);
        to = path?.[0];
      }
      if (!to) break;
      const r = await p.submit(matchId, { type: 'move', unit: unit.id, to }, view.rev);
      if (!r.ok) break;
      await p.waitFor(() => (p.update?.view.rev ?? 0) >= r.rev, 'view after a move');
      view = p.update!.view;
      if (r.events.some((e) => STOPS.has(e.type))) break;
      unit = view.units.find((u) => u.id === start.id);
    }
  }
  view = p.update!.view;
  if (view.phase !== 'playing' || view.activeSeat !== seat) return null;
  const r = await p.submit(matchId, { type: 'endTurn' }, view.rev);
  expect(r.ok, `endTurn: ${!r.ok ? r.message : ''}`).toBe(true);
  return r.rev;
}

/** What a seat must never be sent. */
export function expectNothingHidden(u: MatchUpdateMsg, seat: number): void {
  const v = u.view;
  expect(v.seat).toBe(seat);
  const json = JSON.stringify(u);
  expect(json).not.toMatch(/"rng"|"seed"|"picks"|"memory"/);
  for (const unit of v.units) {
    if (unit.owner === seat) continue;
    expect(hexHasBit(v.visible, tileIndex(unit.x, unit.y)), `enemy ${unit.type} out of sight`).toBe(true);
    expect(unit.moves).toBeUndefined();
  }
  for (const c of v.cities) if (c.owner !== seat) expect(c.building).toBeUndefined();
  if (v.picking) expect(v.picking.myPick === null || typeof v.picking.myPick === 'string').toBe(true);
}
