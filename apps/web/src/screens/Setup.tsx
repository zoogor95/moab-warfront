import { useState } from 'react';
import { createMatch, DEFAULT_SETTINGS, type GameState, type MatchSettings } from '@warfront/shared';
import { EmblemIcon, Logo } from '../components/Icons';
import { Segmented } from '../components/Segmented';
import { SEATS } from '../theme';

interface Seat {
  name: string;
  bot: boolean;
}

const DEFAULT_SEATS: Seat[] = [
  { name: 'You', bot: false },
  { name: 'Bot 1', bot: true },
  { name: 'Bot 2', bot: true },
];

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface Props {
  saved: GameState | null;
  onStart: (g: GameState) => void;
  onResume: (g: GameState) => void;
  onDiscard: () => void;
  onBack: () => void;
}

export function Setup({ saved, onStart, onResume, onDiscard, onBack }: Props) {
  const [seats, setSeats] = useState<Seat[]>(DEFAULT_SEATS);
  const [settings, setSettings] = useState<MatchSettings>({ ...DEFAULT_SETTINGS });
  const [seed, setSeed] = useState(randomSeed);
  const humans = seats.filter((s) => !s.bot).length;
  const set = <K extends keyof MatchSettings>(k: K, v: MatchSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const update = (i: number, patch: Partial<Seat>) => setSeats((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const start = () => {
    const players = seats.map((s, i) => ({ name: s.name.trim() || `Player ${i + 1}`, bot: s.bot }));
    onStart(createMatch({ settings: { ...settings, seats: players.length }, players, seed: seed.trim() || randomSeed() }));
  };

  return (
    <div className="page setup">
      <header className="bar">
        <div className="brand"><Logo /><span>MOAB: Warfront</span></div>
        <span className="tag">Hot-seat play-test</span>
        <span className="grow" />
        <button type="button" className="btn ghost" onClick={onBack}>Play online</button>
      </header>
      <main className="setup-body">
        {saved && (
          <section className="card resume">
            <div>
              <h2>Match in progress</h2>
              <p className="muted">Round {saved.round} · {saved.players.map((p) => p.name).join(', ')}</p>
            </div>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => onResume(saved)}>Resume</button>
              <button type="button" className="btn" onClick={onDiscard}>Discard</button>
            </div>
          </section>
        )}

        <section className="card">
          <div className="card-head">
            <h2>Players</h2>
            <span className="muted">{seats.length} of 6 seats · everyone shares this device</span>
          </div>
          <ol className="seats">
            {seats.map((s, i) => (
              <li key={i} className="seat">
                <span className="swatch" style={{ background: SEATS[i].color }}><EmblemIcon seat={i} size={14} color="#0D1217" /></span>
                <label className="sr-only" htmlFor={`seat-${i}`}>Seat {i + 1} name</label>
                <input id={`seat-${i}`} value={s.name} maxLength={24} onChange={(e) => update(i, { name: e.target.value })} />
                <Segmented label={`Seat ${i + 1} is played by`} value={s.bot ? 'bot' : 'human'} options={[{ value: 'human', label: 'Person' }, { value: 'bot', label: 'Bot' }]} onChange={(v) => update(i, { bot: v === 'bot' })} />
                <button type="button" className="btn ghost" aria-label={`Remove seat ${i + 1}`} disabled={seats.length <= 2} onClick={() => setSeats((list) => list.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="btn" disabled={seats.length >= 6} onClick={() => setSeats((list) => [...list, { name: `Bot ${list.length}`, bot: true }])}>
            Add a seat
          </button>
          {humans === 0 && <p className="warn">At least one seat needs a person.</p>}
        </section>

        <section className="card">
          <div className="card-head"><h2>Match settings</h2></div>
          <div className="setting">
            <div><strong>Starting position</strong><p className="muted">{settings.startMode === 'auto' ? 'Coastal starts spread out by the game.' : 'Everyone picks a coastal city; picks stay hidden until turn 1.'}</p></div>
            <Segmented label="Starting position" value={settings.startMode} options={[{ value: 'auto', label: 'Auto' }, { value: 'pick', label: 'Pick' }]} onChange={(v) => set('startMode', v)} />
          </div>
          <div className="setting">
            <div><strong>Terrain at start</strong><p className="muted">{settings.terrain === 'revealed' ? 'Coastlines and cities visible from turn 1.' : 'Classic: dark until your units explore.'}</p></div>
            <Segmented label="Terrain at start" value={settings.terrain} options={[{ value: 'revealed', label: 'Revealed' }, { value: 'unexplored', label: 'Unexplored' }]} onChange={(v) => set('terrain', v)} />
          </div>
          <div className="setting">
            <div><strong>Victory</strong><p className="muted">{settings.victory.kind === 'last' ? 'Last player with a city or unit wins.' : `Hold ${settings.victory.percent}% of cities for a full round.`}</p></div>
            <Segmented
              label="Victory"
              value={settings.victory.kind === 'last' ? 'last' : String(settings.victory.percent)}
              options={[{ value: 'last', label: 'Last standing' }, { value: '30', label: 'Hold 30%' }, { value: '50', label: 'Hold 50%' }]}
              onChange={(v) => set('victory', v === 'last' ? { kind: 'last' } : { kind: 'hold', percent: Number(v) })}
            />
          </div>
          <div className="setting">
            <div><strong>Production speed</strong><p className="muted">{settings.production === 'fast' ? 'Build times halved.' : 'Standard build times.'}</p></div>
            <Segmented label="Production speed" value={settings.production} options={[{ value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }]} onChange={(v) => set('production', v)} />
          </div>
          <div className="setting">
            <div><strong>Seed</strong><p className="muted">The same seed and moves always replay the same match.</p></div>
            <div className="row">
              <label className="sr-only" htmlFor="seed">Seed</label>
              <input id="seed" value={seed} onChange={(e) => setSeed(e.target.value)} />
              <button type="button" className="btn ghost" onClick={() => setSeed(randomSeed())}>New</button>
            </div>
          </div>
        </section>

        <div className="setup-foot">
          <button type="button" className="btn primary big" disabled={humans === 0} onClick={start}>Start match</button>
        </div>
      </main>
    </div>
  );
}
