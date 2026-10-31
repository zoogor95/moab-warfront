import { useEffect, useState } from 'react';
import { currentSession, onSession } from '../net/api';
import { closeSocket } from '../net/socket';
import { Home } from './Home';
import { OnlineMatch } from './OnlineMatch';
import { SignIn } from './SignIn';

function param(name: string): string | null {
  return new URLSearchParams(location.search).get(name);
}

/** Keeps the open match in the address, so a reload or a shared tab comes back to it. */
function setParams(next: Record<string, string | null>): void {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(next)) {
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  history.replaceState(null, '', url);
}

export function Online({ onHotSeat }: { onHotSeat: () => void }) {
  const [session, setSession] = useState(currentSession);
  const [matchId, setMatchId] = useState(() => param('match'));
  const [invite, setInvite] = useState(() => param('join'));

  useEffect(
    () =>
      onSession((s) => {
        setSession(s);
        if (!s) {
          closeSocket();
          setMatchId(null);
          setParams({ match: null });
        }
      }),
    [],
  );

  const open = (id: string | null) => {
    setMatchId(id);
    setParams({ match: id });
  };

  if (!session) return <SignIn onHotSeat={onHotSeat} joining={invite !== null} />;
  if (matchId) return <OnlineMatch key={matchId} matchId={matchId} me={session.user.id} onBack={() => open(null)} />;
  return (
    <Home
      session={session}
      inviteCode={invite}
      onInviteUsed={() => {
        setInvite(null);
        setParams({ join: null });
      }}
      onOpen={open}
      onHotSeat={onHotSeat}
    />
  );
}
