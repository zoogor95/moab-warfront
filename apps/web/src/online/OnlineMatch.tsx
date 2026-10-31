import { useRef, useState } from 'react';
import { startValue, type Action, type City } from '@warfront/shared';
import { Chat } from '../components/Chat';
import { ConfirmButton } from '../components/ConfirmButton';
import { Logo } from '../components/Icons';
import { describeEvent } from '../game/session';
import { submitAction } from '../net/socket';
import { Pick } from '../screens/Pick';
import { Play, type RunActions } from '../screens/Play';
import { Results } from '../screens/Results';
import { LobbyScreen } from './LobbyScreen';
import { useMatch } from './useMatch';

const STOPS = new Set(['combat', 'blocked', 'captured', 'captureFailed', 'strike']);

/** One online match, from lobby to results, driven by the views the server sends this seat. */
export function OnlineMatch({ matchId, me, onBack }: { matchId: string; me: string; onBack: () => void }) {
  const m = useMatch(matchId);
  const [picking, setPicking] = useState(false);
  const latest = useRef(m.update);
  latest.current = m.update;

  if (m.error && !m.lobby) {
    return (
      <div className="page pass">
        <div className="pass-card">
          <Logo size={40} />
          <h1>Cannot open this match</h1>
          <p className="muted">{m.error}</p>
          <button type="button" className="btn primary big" onClick={onBack}>My matches</button>
        </div>
      </div>
    );
  }
  if (!m.lobby || (m.lobby.status !== 'lobby' && !m.update)) {
    return (
      <div className="page pass">
        <div className="pass-card" role="status">
          <Logo size={40} />
          <p className="muted">{m.connected ? 'Loading the match…' : 'Connecting to the game server…'}</p>
          <button type="button" className="btn ghost" onClick={onBack}>My matches</button>
        </div>
      </div>
    );
  }

  if (m.lobby.status === 'lobby') {
    return <LobbyScreen lobby={m.lobby} me={me} chat={m.chat} say={m.say} onLobby={m.setLobby} onLeave={onBack} onBack={onBack} />;
  }

  const { view, deadline, standings } = m.update!;
  const banner = m.connected ? null : 'Reconnecting… your seat is kept, but the turn clock keeps running.';

  /** Sends actions one at a time; each waits for the server, which is the only judge. */
  const run: RunActions = async (actions, opts) => {
    let rev = latest.current!.view.rev;
    const notes: string[] = [];
    let moved = false;
    for (const action of actions) {
      const r = await submitAction(matchId, action, rev);
      if (!r.ok) {
        // A route longer than this turn's moves simply stops where the moves run out.
        if (!(moved && r.error === 'no-moves')) notes.push(r.error === 'stale' ? 'The map changed. Try again.' : r.message);
        break;
      }
      rev = r.rev;
      moved ||= action.type === 'move';
      const v = latest.current!.view;
      notes.push(...r.events.filter((e) => e.type !== 'built').map((e) => describeEvent(e, v)));
      if (opts?.stopOnFight && r.events.some((e) => STOPS.has(e.type))) break;
    }
    return notes;
  };

  if (view.phase === 'picking') {
    const pick = async (city: string) => {
      setPicking(true);
      await run([{ type: 'pickStart', city }]);
      setPicking(false);
    };
    // Without the seed, "pick for me" chooses on the device among the best-placed ports.
    const pickForMe = () => {
      const ports = view.cities.filter((c) => c.port) as unknown as City[];
      const best = [...ports].sort((a, b) => startValue(b, ports) - startValue(a, ports)).slice(0, 7);
      void pick(best[Math.floor(Math.random() * best.length)].id);
    };
    return <Pick view={view} onPick={(c) => void pick(c)} onPickForMe={pickForMe} deadline={deadline} busy={picking} />;
  }

  if (view.phase === 'finished') {
    const won = view.log.find((e) => e.type === 'victory');
    return (
      <Results
        round={view.round}
        winner={view.winner}
        reason={won?.type === 'victory' ? won.reason : null}
        players={view.players}
        standings={standings ?? null}
        mySeat={view.seat}
        doneLabel="My matches"
        onDone={onBack}
      />
    );
  }

  const alive = view.players[view.seat].alive;
  const resign: Action = { type: 'resign' };
  return (
    <Play
      key={matchId}
      view={view}
      readOnly={!alive}
      run={run}
      deadline={deadline}
      banner={banner ?? (alive ? null : 'You are out of this match. You can keep watching.')}
      exit={{ label: 'My matches', onExit: onBack }}
      extra={
        <>
          <Chat messages={m.chat} mySeat={view.seat} onSend={m.say} />
          {alive && (
            <section className="panel">
              <ConfirmButton
                label="Resign"
                className="btn ghost wide"
                question="Resign? Your cities turn neutral and your units are removed."
                confirmLabel="Resign"
                cancelLabel="Keep playing"
                onConfirm={() => void run([resign])}
              />
            </section>
          )}
        </>
      }
    />
  );
}
