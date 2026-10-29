import { useCallback, useEffect, useState } from 'react';
import { applyAction, botPickStart, loadMap, playBotTurn, type GameState } from '@warfront/shared';
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

export function App() {
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

  if (screen.kind === 'setup' || !game) {
    return (
      <Setup
        saved={saved}
        onStart={(g) => advance(g, null)}
        onResume={(g) => loadMap(g.mapVersion).then(() => advance(g, null))}
        onDiscard={() => {
          saveGame(null);
          setSaved(null);
        }}
      />
    );
  }

  const newGame = () => {
    saveGame(null);
    setSaved(null);
    setGame(null);
    setScreen({ kind: 'setup' });
  };

  switch (screen.kind) {
    case 'pass':
      return (
        <Pass
          game={game}
          seat={screen.seat}
          onReady={() => setScreen(game.phase === 'picking' ? { kind: 'pick', seat: screen.seat } : { kind: 'play', seat: screen.seat })}
        />
      );
    case 'pick':
      return <Pick game={game} seat={screen.seat} onPicked={(g) => advance(g, screen.seat)} />;
    case 'play':
      return <Play key={screen.seat} game={game} seat={screen.seat} onChange={(g) => { setGame(g); saveGame(g); }} onEndTurn={(g) => advance(g, screen.seat)} onNewGame={newGame} />;
    case 'bots':
      return screen.watchSeat !== null ? (
        <Play key={`watch-${screen.watchSeat}`} game={game} seat={screen.watchSeat} readOnly onNewGame={newGame} />
      ) : (
        <Pass game={game} seat={game.activeSeat} botsMoving />
      );
    case 'results':
      return <Results game={game} onNewGame={newGame} />;
  }
}
