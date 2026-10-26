import type { GameState } from '@warfront/shared';
import { EmblemIcon, Logo } from '../components/Icons';
import { SEATS } from '../theme';

export function Results({ game, onNewGame }: { game: GameState; onNewGame: () => void }) {
  const winner = game.winner === null ? null : game.players[game.winner];
  const reason = game.log.find((e) => e.type === 'victory');
  return (
    <div className="page pass">
      <div className="pass-card">
        <Logo size={40} />
        <p className="muted">Round {game.round}</p>
        <h1>
          {winner && <span className="swatch big" style={{ background: SEATS[winner.seat].color }}><EmblemIcon seat={winner.seat} size={18} color="#0D1217" /></span>}
          {winner ? `${winner.name} wins` : 'No winner'}
        </h1>
        {reason?.type === 'victory' && <p className="muted">{reason.reason === 'hold' ? 'Held the city share for a full round.' : 'Last player standing.'}</p>}
        <table className="tally">
          <thead><tr><th scope="col">Player</th><th scope="col">Cities</th><th scope="col">Units</th></tr></thead>
          <tbody>
            {game.players.map((p) => (
              <tr key={p.seat}>
                <td><EmblemIcon seat={p.seat} /> {p.name}{!p.alive && <span className="muted"> · out</span>}</td>
                <td>{game.cities.filter((c) => c.owner === p.seat).length}</td>
                <td>{game.units.filter((u) => u.owner === p.seat).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn primary big" onClick={onNewGame}>New match</button>
      </div>
    </div>
  );
}
