import { useCallback, useEffect, useMemo, useState } from 'react';
import { applyAction, botPickStart, playBotTurn, viewFor, type GameState } from '@warfront/shared';
import { runLocal } from './game/local';
import { humanSeats, loadGame, saveGame } from './game/session';
import { Setup } from './screens/Setup';
import { Pass } from './screens/Pass';
import { Pick } from './screens/Pick';
import { Play } from './screens/Play';
import { Results } from './screens/Results';

type Screen =
  | { kind: 'setup' }
  | { kind: 'pass'; seat: number }
  | { kind: 'pick'; seat: number }
  | { kind: 'play'; seat: number }
  | { kind: 'bots'; watchSeat: number | null }
  | { kind: 'results' };

/** Bots pick at once; their picks stay hidden like everyone else's. */
function autoPickBots(game: GameState): GameState {
  let g = game;
  for (const p of g.players) {
    if (g.phase !== 'picking') break;
    if (p.bot && g.picks[p.seat] === undefined) g = applyAction(g, p.seat, { type: 'pickStart', city: botPickStart(g, p.seat) }).state;
  }
  return g;
}

/** Which screen comes next. `lastHuman` is whoever just played, so one human never sees a pass screen. */
function nextScreen(game: GameState, lastHuman: number | null): Screen {
  const humans = humanSeats(game);
  if (game.phase === 'finished') return { kind: 'results' };
  if (game.phase === 'picking') {
    const seat = humans.find((s) => game.picks[s] === undefined);
    if (seat === undefined) return { kind: 'setup' };
    return humans.length > 1 ? { kind: 'pass', seat } : { kind: 'pick', seat };
  }
  const active = game.activeSeat;
  if (game.players[active].bot) return { kind: 'bots', watchSeat: humans.length === 1 ? humans[0] : null };
  if (humans.length > 1 && active !== lastHuman) return { kind: 'pass', seat: active };
  return { kind: 'play', seat: active };
}

/** Everyone on one device, passing it between turns; bots play in the page. */
export function HotSeat({ onExit }: { onExit: () => void }) {
  const [game, setGame] = useState<GameState | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: 'setup' });
  const [saved, setSaved] = useState<GameState | null>(() => loadGame());

  const advance = useCallback((g: GameState, lastHuman: number | null) => {
    const ready = g.phase === 'picking' ? autoPickBots(g) : g;
    setGame(ready);
    saveGame(ready.phase === 'finished' ? null : ready);
    setScreen(nextScreen(ready, lastHuman));
  }, []);

  // Bots move one turn per tick so the page stays responsive.
  useEffect(() => {
    if (screen.kind !== 'bots' || !game) return;
    const id = window.setTimeout(() => {
      const g = playBotTurn(game, game.activeSeat);
      if (g.phase === 'playing' && g.players[g.activeSeat].bot) {
        setGame(g);
        saveGame(g);
      } else {
        advance(g, screen.watchSeat);
      }
    }, 60);
    return () => window.clearTimeout(id);
  }, [screen, game, advance]);

  const viewSeat = screen.kind === 'pick' || screen.kind === 'play' ? screen.seat : screen.kind === 'bots' ? screen.watchSeat : null;
  const view = useMemo(() => (game && viewSeat !== null ? viewFor(game, viewSeat) : null), [game, viewSeat]);

  if (screen.kind === 'setup' || !game) {
    return (
      <Setup
        saved={saved}
        onStart={(g) => advance(g, null)}
        onResume={(g) => advance(g, null)}
        onDiscard={() => {
          saveGame(null);
          setSaved(null);
        }}
        onBack={onExit}
      />
    );
  }

  const newGame = () => {
    saveGame(null);
    setSaved(null);
    setGame(null);
    setScreen({ kind: 'setup' });
  };
  const exit = { label: 'New match', question: 'Leave this match? It cannot be resumed.', onExit: newGame };

  switch (screen.kind) {
    case 'pass':
      return (
        <Pass
          game={game}
          seat={screen.seat}
          onReady={() => setScreen(game.phase === 'picking' ? { kind: 'pick', seat: screen.seat } : { kind: 'play', seat: screen.seat })}
        />
      );
    case 'pick': {
      const pick = (city: string) => advance(applyAction(game, screen.seat, { type: 'pickStart', city }).state, screen.seat);
      return <Pick view={view!} onPick={pick} onPickForMe={() => pick(botPickStart(game, screen.seat))} />;
    }
    case 'play': {
      const seat = screen.seat;
      const run = (actions: Parameters<typeof runLocal>[2], opts?: Parameters<typeof runLocal>[3]) => {
        const { state, notes } = runLocal(game, seat, actions, opts);
        if (state === game) return notes;
        // The turn passing, a win or a loss changes the screen; anything else stays on the map.
        if (state.phase !== 'playing' || state.activeSeat !== seat) advance(state, seat);
        else {
          setGame(state);
          saveGame(state);
        }
        return notes;
      };
      return <Play key={seat} view={view!} run={run} exit={exit} />;
    }
    case 'bots':
      return screen.watchSeat !== null ? (
        <Play key={`watch-${screen.watchSeat}`} view={view!} readOnly run={() => []} exit={exit} />
      ) : (
        <Pass game={game} seat={game.activeSeat} botsMoving />
      );
    case 'results': {
      const reason = game.log.find((e) => e.type === 'victory');
      return (
        <Results
          round={game.round}
          winner={game.winner}
          reason={reason?.type === 'victory' ? reason.reason : null}
          players={game.players}
          standings={{
            cities: game.players.map((p) => game.cities.filter((c) => c.owner === p.seat).length),
            units: game.players.map((p) => game.units.filter((u) => u.owner === p.seat).length),
          }}
          doneLabel="New match"
          onDone={newGame}
        />
      );
    }
  }
}
