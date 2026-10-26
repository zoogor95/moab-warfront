import { UNITS, type GameState, type LoggedEvent, type PlayerView, type UnitType } from '@warfront/shared';

const KEY = 'warfront.hotseat.v1';

/** Browser storage can be missing or blocked; saving is a convenience, never required. */
export function saveGame(game: GameState | null): void {
  try {
    if (game) localStorage.setItem(KEY, JSON.stringify(game));
    else localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const game = JSON.parse(raw) as GameState;
    return game.version === 1 ? game : null;
  } catch {
    return null;
  }
}

export function humanSeats(game: GameState): number[] {
  return game.players.filter((p) => !p.bot).map((p) => p.seat);
}

const unitName = (t: UnitType) => UNITS[t].name.toLowerCase();

export function describeEvent(e: LoggedEvent, view: PlayerView): string {
  const name = (seat: number | null) => (seat === null ? 'neutral' : seat === view.seat ? 'you' : view.players[seat]?.name ?? `Seat ${seat + 1}`);
  const whose = (seat: number | null) => (seat === null ? 'a neutral' : seat === view.seat ? 'your' : `${name(seat)}'s`);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const city = (id: string) => view.cities.find((c) => c.id === id)?.name ?? id;
  switch (e.type) {
    case 'combat':
      return e.winner === 'attacker'
        ? `${cap(whose(e.attacker.owner))} ${unitName(e.attacker.type)} destroyed ${whose(e.defender.owner)} ${unitName(e.defender.type)}.`
        : `${cap(whose(e.defender.owner))} ${unitName(e.defender.type)} beat off ${whose(e.attacker.owner)} ${unitName(e.attacker.type)}.`;
    case 'captured':
      return `${cap(whose(e.by))} ${unitName(e.unit)} took ${city(e.city)}${e.from !== null ? ` from ${name(e.from)}` : ''}.`;
    case 'captureFailed':
      return `${cap(whose(e.by))} ${unitName(e.unit)} was lost attacking ${city(e.city)}.`;
    case 'built':
      return `${city(e.city)} finished a ${unitName(e.unit)}.`;
    case 'strike':
      return `${cap(whose(e.by))} bomber struck, destroying ${e.destroyed.length} unit${e.destroyed.length === 1 ? '' : 's'}.`;
    case 'outOfFuel':
      return `${cap(whose(e.unit.owner))} ${unitName(e.unit.type)} ran out of fuel and was lost.`;
    case 'blocked':
      return `Your ${unitName(e.unit.type)} ran into something it could not see.`;
    case 'startsRevealed': {
      const mine = e.starts[view.seat];
      return e.moved.includes(view.seat)
        ? `A later player picked near you, so you start in ${city(mine)}.`
        : `Starts are revealed. You start in ${city(mine)}.`;
    }
    case 'resigned':
      return `${cap(name(e.seat))} resigned.`;
    case 'eliminated':
      return `${cap(name(e.seat))} ${e.seat === view.seat ? 'are' : 'is'} out of the match.`;
    case 'victory':
      return `${cap(name(e.seat))} ${e.seat === view.seat ? 'win' : 'wins'}${e.reason === 'hold' ? ' by holding the city share' : ''}.`;
  }
}
