import { applyAction, RuleError, viewFor, type Action, type GameState } from '@warfront/shared';
import { describeEvent } from './session';

const STOPS = new Set(['combat', 'blocked', 'captured', 'captureFailed', 'strike', 'outOfFuel']);

/** Hot-seat: runs actions on the device, stopping at the first refusal or anything that ends a move. */
export function runLocal(game: GameState, seat: number, actions: Action[], opts: { stopOnFight?: boolean } = {}): { state: GameState; notes: string[] } {
  let g = game;
  const notes: string[] = [];
  for (const a of actions) {
    if (a.type === 'move' && !g.units.find((u) => u.id === a.unit)?.moves) break;
    try {
      const r = applyAction(g, seat, a);
      g = r.state;
      const v = viewFor(g, seat);
      notes.push(...r.events.filter((e) => e.type !== 'built' && e.seenBy.includes(seat)).map((e) => describeEvent(e, v)));
      if (opts.stopOnFight && r.events.some((e) => STOPS.has(e.type))) break;
    } catch (e) {
      if (e instanceof RuleError) {
        notes.push(e.message);
        break;
      }
      throw e;
    }
  }
  return { state: g, notes };
}
