import { useCallback, useEffect, useState } from 'react';
import { matchCode, type Lobby, type MatchSummary } from '@warfront/shared';
import { ConfirmButton } from '../components/ConfirmButton';
import { EmblemIcon, Logo } from '../components/Icons';
import { api, signOut, type Session } from '../net/api';

function statusLine(m: MatchSummary): string {
  switch (m.status) {
    case 'lobby':
      return 'In the lobby';
    case 'picking':
      return 'Picking starts';
    case 'finished':
      return 'Finished';
    case 'playing':
      return m.yourTurn ? `Your turn · round ${m.round}` : `${m.players[m.activeSeat]} is moving · round ${m.round}`;
  }
}

interface Props {
  session: Session;
  /** A code from an invite link, joined once on arrival. */
  inviteCode: string | null;
  onInviteUsed: () => void;
  onOpen: (matchId: string) => void;
  onHotSeat: () => void;
}

/** Your matches, the ones waiting on you first; start a new one or join with a code. */
export function Home({ session, inviteCode, onInviteUsed, onOpen, onHotSeat }: Props) {
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setMatches(await api<MatchSummary[]>('GET', '/matches'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const act = async (f: () => Promise<Lobby>) => {
    setBusy(true);
    setError(null);
    try {
      onOpen((await f()).id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const join = (raw: string) => {
    const parsed = matchCode.safeParse(raw);
    if (!parsed.success) {
      setError('Codes are 6 letters or digits.');
      return;
    }
    void act(() => api<Lobby>('POST', '/matches/join', { code: parsed.data }));
  };

  useEffect(() => {
    if (!inviteCode) return;
    onInviteUsed();
    join(inviteCode);
    // Only on arrival with an invite; `join` is recreated every render.
  }, [inviteCode]);

  return (
    <div className="page setup">
      <header className="bar">
        <div className="brand"><Logo /><span>MOAB: Warfront</span></div>
        <span className="grow" />
        <span className="muted who">{session.user.name}</span>
        <ConfirmButton label="Sign out" question="Sign out? As a guest you cannot sign back in to these matches." confirmLabel="Sign out" onConfirm={signOut} />
      </header>
      <main className="setup-body">
        <section className="card">
          <div className="card-head"><h2>Play online</h2></div>
          <div className="row">
            <button type="button" className="btn primary big" disabled={busy} onClick={() => void act(() => api<Lobby>('POST', '/matches', {}))}>New match</button>
            <form className="row join" onSubmit={(e) => (e.preventDefault(), join(code))}>
              <label className="sr-only" htmlFor="join-code">Match code</label>
              <input id="join-code" value={code} placeholder="Code" maxLength={6} autoCapitalize="characters" autoComplete="off" onChange={(e) => setCode(e.target.value.toUpperCase())} />
              <button type="submit" className="btn big" disabled={busy || code.trim().length !== 6}>Join</button>
            </form>
          </div>
          {error && <p className="warn" role="alert">{error}</p>}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Your matches</h2>
            <button type="button" className="btn ghost" onClick={() => void load()}>Refresh</button>
          </div>
          {matches === null ? (
            <p className="muted">Loading…</p>
          ) : matches.length === 0 ? (
            <p className="muted">No matches yet. Start one and send the code to friends.</p>
          ) : (
            <ul className="match-list">
              {matches.map((m) => (
                <li key={m.id}>
                  <button type="button" className={`match-row ${m.yourTurn ? 'mine' : ''}`} onClick={() => onOpen(m.id)}>
                    <span className="match-players">
                      {m.players.map((p, seat) => (
                        <span key={seat} className="match-player"><EmblemIcon seat={seat} /> {seat === m.mySeat ? 'You' : p}</span>
                      ))}
                    </span>
                    <span className={m.yourTurn ? 'warn' : 'muted'}>{statusLine(m)}</span>
                    <small className="muted">Code {m.code}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card resume">
          <div>
            <h2>One device</h2>
            <p className="muted">Pass-and-play with friends or bots on this device, no account needed.</p>
          </div>
          <button type="button" className="btn" onClick={onHotSeat}>Play on this device</button>
        </section>
      </main>
    </div>
  );
}
