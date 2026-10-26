import { subHiddenFrom } from './fog';
import { nextRandom } from './rng';
import { ROUND_WIN, ROUND_WIN_VS_CITY, UNITS } from './units';
import type { GameState, Unit } from './types';
import { cityAt } from './state';

/** Whether `attacker` may start a fight with `defender` (both on the map, not aboard). */
export function canTarget(s: GameState, attacker: Unit, defender: Unit): boolean {
  if (defender.carriedBy || defender.owner === attacker.owner) return false;
  if (UNITS[attacker.type].attack <= 0) return false;
  if (subHiddenFrom(s, defender, attacker.owner)) return false;
  const target = UNITS[defender.type].domain;
  switch (attacker.type) {
    case 'tank':
    case 'paratrooper':
      return target === 'land';
    case 'fighter':
      return true;
    case 'destroyer':
    case 'submarine':
      return target === 'sea';
    case 'battleship':
      return target === 'sea' || target === 'land';
    default:
      return false;
  }
}

/** The strongest unit on the tile that this attacker can fight. */
export function pickDefender(s: GameState, attacker: Unit, onTile: Unit[]): Unit | undefined {
  return onTile
    .filter((d) => canTarget(s, attacker, d))
    .sort((a, b) => b.hp - a.hp || UNITS[b.type].attack - UNITS[a.type].attack)[0];
}

/**
 * Fights in rounds until one side is destroyed. Each round the attacker wins with 50% chance,
 * or 40% against a unit defending its own city; the loser of a round takes the winner's attack
 * as damage. Mutates hp and returns the winner.
 */
export function fight(s: GameState, attacker: Unit, defender: Unit): 'attacker' | 'defender' {
  const inOwnCity = cityAt(s, defender)?.owner === defender.owner;
  const p = inOwnCity ? ROUND_WIN_VS_CITY : ROUND_WIN;
  const atk = UNITS[attacker.type].attack;
  const def = UNITS[defender.type].attack;
  while (attacker.hp > 0 && defender.hp > 0) {
    if (nextRandom(s.rng) < p) defender.hp -= atk;
    else attacker.hp -= def;
  }
  return defender.hp <= 0 ? 'attacker' : 'defender';
}
