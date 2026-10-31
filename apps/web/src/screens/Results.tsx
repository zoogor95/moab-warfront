import type { Standings } from '@warfront/shared/protocol';
import { EmblemIcon, Logo } from '../components/Icons';
import { SEATS } from '../theme';

interface Props {
  round: number;
  winner: number | null;
  reason: 'last' | 'hold' | null;
  players: { seat: number; name: string; alive: boolean }[];
  standings: Standings | null;
  /** Online, the viewer's seat, so their row reads "You". */
  mySeat?: number;
  doneLabel: string;
  onDone: () => void;
}

export function Results({ round, winner: winnerSeat, reason, players, standings, mySeat, doneLabel, onDone }: Props) {
  const winner = winnerSeat === null ? null : players[winnerSeat];
  const name = (seat: number) => (seat === mySeat ? 'You' : players[seat].name);
  return (
    <div className="page pass">
      <div className="pass-card">
        <Logo size={40} />
        <p className="muted">Round {round}</p>
        <h1>
          {winner && <span className="swatch big" style={{ background: SEATS[winner.seat].color }}><EmblemIcon seat={winner.seat} size={18} color="#0D1217" /></span>}
          {winner ? (winner.seat === mySeat ? 'You win' : `${winner.name} wins`) : 'No winner'}
        </h1>
        {reason && <p className="muted">{reason === 'hold' ? 'Held the city share for a full round.' : 'Last player standing.'}</p>}
        {standings && (
          <table className="tally">
            <thead><tr><th scope="col">Player</th><th scope="col">Cities</th><th scope="col">Units</th></tr></thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.seat}>
                  <td><EmblemIcon seat={p.seat} /> {name(p.seat)}{!p.alive && <span className="muted"> · out</span>}</td>
                  <td>{standings.cities[p.seat]}</td>
                  <td>{standings.units[p.seat]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button type="button" className="btn primary big" onClick={onDone}>{doneLabel}</button>
      </div>
    </div>
  );
}
