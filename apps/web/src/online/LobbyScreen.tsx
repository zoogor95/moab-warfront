import { useState, type ReactNode } from 'react';
import { MAP_REGIONS, MAP_SIZES, SETTING_LIMITS, type MatchSettings } from '@warfront/shared';
import type { ChatMessage, Lobby } from '@warfront/shared/protocol';
import { Chat } from '../components/Chat';
import { ConfirmButton } from '../components/ConfirmButton';
import { HelpButton } from '../components/Help';
import { EmblemIcon, Logo } from '../components/Icons';
import { MapPreview } from '../components/MapPreview';
import { Segmented } from '../components/Segmented';
import { api } from '../net/api';
import { SEATS } from '../theme';

interface Props {
  lobby: Lobby;
  me: string;
  chat: ChatMessage[];
  say: (text: string) => Promise<string | null>;
  onLobby: (l: Lobby) => void;
  onLeave: () => void;
  onBack: () => void;
}

function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}?join=${code}`;
}

/** Seats, the host's settings (read-only for everyone else), the invite, Ready and Start. */
export function LobbyScreen({ lobby, me, chat, say, onLobby, onLeave, onBack }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const host = lobby.hostId === me;
  const mine = lobby.seats.find((s) => s.userId === me);
  const settings = lobby.settings;

  const call = async (method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const next = await api<Lobby | null>(method, `/matches/${lobby.id}${path}`, body);
      if (next) onLobby(next);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  // The server merges a change into the current settings and checks the whole.
  const set = <K extends keyof MatchSettings>(k: K, v: MatchSettings[K]) => void call('PATCH', '/settings', { [k]: v });
  const size = MAP_SIZES.find((m) => m.id === settings.mapSize) ?? MAP_SIZES[1];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(lobby.code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copying is blocked here. Share the code instead.');
    }
  };

  const open = Array.from({ length: settings.seats }, (_, i) => i).filter((i) => !lobby.seats.some((s) => s.seat === i));
  const notReady = lobby.seats.filter((s) => !s.bot && !s.ready && s.userId !== lobby.hostId);
  const blocker = open.length ? 'Fill or close the empty seats first.' : notReady.length ? `Waiting for ${notReady.map((s) => s.name).join(', ')}.` : null;

  const option = (label: string, text: string, control: ReactNode) => (
    <div className="setting">
      <div><strong>{label}</strong><p className="muted">{text}</p></div>
      {host ? control : null}
    </div>
  );

  return (
    <div className="page setup">
      <header className="bar">
        <div className="brand"><Logo /><span>MOAB: Warfront</span></div>
        <div className="bar-title"><strong>Lobby</strong><span className="muted">{host ? 'You are the host' : 'The host sets up the match'}</span></div>
        <span className="grow" />
        <HelpButton />
        <button type="button" className="btn ghost" onClick={onBack}>My matches</button>
        <ConfirmButton label="Leave" question="Leave this lobby? Your seat opens for someone else." confirmLabel="Leave" onConfirm={() => void call('POST', '/leave').then((ok) => ok && onLeave())} />
      </header>
      <main className="setup-body lobby">
        <section className="card invite">
          <div>
            <h2>Invite friends</h2>
            <p className="muted">Send the link, or have them enter the code under Join.</p>
          </div>
          <div className="row">
            <span className="code" aria-label={`Match code ${lobby.code.split('').join(' ')}`}>{lobby.code}</span>
            <button type="button" className="btn" onClick={() => void copy()}>{copied ? 'Link copied' : 'Copy invite link'}</button>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Players</h2>
            <span className="muted">{lobby.seats.length} of {settings.seats} seats filled</span>
          </div>
          <ol className="seats">
            {Array.from({ length: settings.seats }, (_, i) => {
              const s = lobby.seats.find((x) => x.seat === i);
              return (
                <li key={i} className="seat">
                  <span className="swatch" style={{ background: SEATS[i].color }}><EmblemIcon seat={i} size={14} color="#0D1217" /></span>
                  {s ? (
                    <>
                      <span className="seat-name">{s.userId === me ? `${s.name} (you)` : s.name}</span>
                      {s.userId === lobby.hostId && <span className="pill">Host</span>}
                      <span className={s.ready || s.bot || s.userId === lobby.hostId ? 'good' : 'muted'}>
                        {s.bot ? 'Bot' : s.userId === lobby.hostId ? 'Hosting' : s.ready ? 'Ready' : 'Not ready'}
                      </span>
                      {host && s.userId !== me && (
                        <button type="button" className="btn ghost" disabled={busy} aria-label={`Remove ${s.name} from seat ${i + 1}`} onClick={() => void call('DELETE', `/seats/${i}`)}>Remove</button>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="seat-name muted">Open seat · {SEATS[i].colorName}</span>
                      {mine && <button type="button" className="btn ghost" disabled={busy} onClick={() => void call('POST', '/seat', { seat: i })}>Sit here</button>}
                      {host && <button type="button" className="btn" disabled={busy} onClick={() => void call('POST', '/bots', { seat: i })}>Add bot</button>}
                    </>
                  )}
                </li>
              );
            })}
          </ol>
          {host && (
            <div className="row">
              <button type="button" className="btn" disabled={busy || settings.seats >= 6} onClick={() => set('seats', settings.seats + 1)}>Add a seat</button>
              <button type="button" className="btn ghost" disabled={busy || settings.seats <= 2} onClick={() => set('seats', settings.seats - 1)}>Close the last seat</button>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head"><h2>Match settings</h2>{!host && <span className="muted">Set by the host</span>}</div>
          {option('Map', `${MAP_REGIONS.find((r) => r.id === settings.map)?.name ?? settings.map}. Real coastlines and cities.`,
            <Segmented label="Map" disabled={busy} value={settings.map} options={MAP_REGIONS.map((r) => ({ value: r.id, label: r.name }))} onChange={(v) => set('map', v)} />)}
          {option('Map size', `${size.name}: suits ${size.players.toLowerCase()}. Any size works for any number of players.`,
            <Segmented label="Map size" disabled={busy} value={settings.mapSize} options={MAP_SIZES.map((m) => ({ value: m.id, label: m.name }))} onChange={(v) => set('mapSize', v)} />)}
          <MapPreview region={settings.map} size={settings.mapSize} />
          {option('Starting position', settings.startMode === 'auto' ? 'Auto: coastal starts spread out by the game.' : 'Pick: everyone picks a coastal city; picks stay hidden until turn 1.',
            <Segmented label="Starting position" disabled={busy} value={settings.startMode} options={[{ value: 'auto', label: 'Auto' }, { value: 'pick', label: 'Pick' }]} onChange={(v) => set('startMode', v)} />)}
          {option('Turn timer', `${settings.turnLimitSeconds} seconds per turn. When it runs out, the turn ends.`,
            <Segmented label="Turn timer" disabled={busy} value={String(settings.turnLimitSeconds)} options={SETTING_LIMITS.liveTurnSeconds.map((s) => ({ value: String(s), label: `${s} s` }))} onChange={(v) => set('turnLimitSeconds', Number(v))} />)}
          {option('Terrain at start', settings.terrain === 'revealed' ? 'Revealed: coastlines and cities visible from turn 1.' : 'Unexplored: dark until your units explore.',
            <Segmented label="Terrain at start" disabled={busy} value={settings.terrain} options={[{ value: 'revealed', label: 'Revealed' }, { value: 'unexplored', label: 'Unexplored' }]} onChange={(v) => set('terrain', v)} />)}
          {option('Victory', settings.victory.kind === 'last' ? 'Last player with a city or unit wins.' : `Hold ${settings.victory.percent}% of cities for a full round.`,
            <Segmented
              label="Victory"
              disabled={busy}
              value={settings.victory.kind === 'last' ? 'last' : String(settings.victory.percent)}
              options={[{ value: 'last', label: 'Last standing' }, { value: '50', label: 'Hold 50%' }, { value: '70', label: 'Hold 70%' }, { value: '90', label: 'Hold 90%' }]}
              onChange={(v) => set('victory', v === 'last' ? { kind: 'last' } : { kind: 'hold', percent: Number(v) })}
            />)}
          {option('Production speed', settings.production === 'fast' ? 'Fast: build times halved.' : 'Normal build times.',
            <Segmented label="Production speed" disabled={busy} value={settings.production} options={[{ value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }]} onChange={(v) => set('production', v)} />)}
        </section>

        <Chat messages={chat} mySeat={mine?.seat ?? null} onSend={say} />

        {error && <p className="warn" role="alert">{error}</p>}
        <div className="setup-foot">
          {host ? (
            <div className="foot-stack">
              {blocker && <span className="muted">{blocker}</span>}
              <button type="button" className="btn primary big" disabled={busy || blocker !== null} onClick={() => void call('POST', '/start')}>Start match</button>
            </div>
          ) : mine ? (
            <button type="button" className={`btn big ${mine.ready ? '' : 'primary'}`} disabled={busy} onClick={() => void call('POST', '/ready', { ready: !mine.ready })}>
              {mine.ready ? 'Not ready' : "I'm ready"}
            </button>
          ) : null}
        </div>
      </main>
    </div>
  );
}
