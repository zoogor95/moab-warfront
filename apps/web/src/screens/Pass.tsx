import type { GameState } from '@warfront/shared';
import { EmblemIcon, Logo } from '../components/Icons';
import { SEATS } from '../theme';

/** Hides the board between players sharing one device. */
export function Pass({ game, seat, onReady, botsMoving }: { game: GameState; seat: number; onReady?: () => void; botsMoving?: boolean }) {
  const player = game.players[seat];
  const picking = game.phase === 'picking';
  return (
    <div className="page pass">
      <div className="pass-card">
        <Logo size={40} />
        {botsMoving ? (
          <>
            <h1>{player.name} is moving…</h1>
            <p className="muted">Round {game.round}. The next person's turn starts in a moment.</p>
          </>
        ) : (
          <>
            <p className="muted">{picking ? 'Pick your start' : `Round ${game.round}`}</p>
            <h1>
              <span className="swatch big" style={{ background: SEATS[seat].color }}><EmblemIcon seat={seat} size={18} color="#0D1217" /></span>
              Pass to {player.name}
            </h1>
            <p className="muted">Everyone else, look away. {picking ? 'Picks stay hidden until turn 1.' : 'Your view shows only what your units and cities can see.'}</p>
            <button type="button" className="btn primary big" onClick={onReady} autoFocus>
              I'm {player.name}, show my {picking ? 'map' : 'turn'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
