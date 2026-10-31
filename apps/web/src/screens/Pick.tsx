import { useMemo, useState } from 'react';
import { distance, START_SPACING, START_VALUE_RADIUS, tileIndex, type PlayerView, type Point } from '@warfront/shared';
import { Countdown } from '../components/Countdown';
import { EmblemIcon, Logo } from '../components/Icons';
import { MapCanvas } from '../map/MapCanvas';
import { SEATS } from '../theme';

interface Props {
  view: PlayerView;
  onPick: (cityId: string) => void;
  onPickForMe: () => void;
  deadline?: string | null;
  /** Online, the pick is sent and the screen stays until everyone has picked. */
  busy?: boolean;
}

/** Hidden start pick for one person. */
export function Pick({ view, onPick, onPickForMe, deadline, busy }: Props) {
  const seat = view.seat;
  const myPick = view.picking?.myPick ?? null;
  const [choice, setChoice] = useState<string | null>(myPick);
  const city = view.cities.find((c) => c.id === choice) ?? null;
  const eligible = useMemo(() => new Set(view.cities.filter((c) => c.port).map((c) => tileIndex(c.x, c.y))), [view]);
  const nearby = city ? view.cities.filter((c) => c.id !== city.id && distance(c, city) <= START_VALUE_RADIUS) : [];
  const picked = view.picking?.picked ?? [];
  const locked = myPick !== null;

  const click = (p: Point) => {
    if (locked) return;
    const c = view.cities.find((x) => x.x === p.x && x.y === p.y && x.port);
    setChoice(c ? c.id : null);
  };

  return (
    <div className="page play">
      <header className="bar">
        <div className="brand"><Logo /><span>MOAB: Warfront</span></div>
        <div className="bar-title"><strong>Pick your start</strong><span className="muted">Everyone picks at once · hidden until turn 1</span></div>
        {deadline && <Countdown deadline={deadline} label="Time to pick" />}
        <ul className="chips" aria-label="Who has picked">
          {view.players.map((p) => (
            <li key={p.seat} className={`chip ${p.seat === seat ? 'active' : ''}`}>
              <EmblemIcon seat={p.seat} />
              <span>{p.seat === seat ? 'You' : p.name}</span>
              <small className={picked.includes(p.seat) ? 'good' : 'warn'}>{picked.includes(p.seat) ? 'Picked' : 'Choosing'}</small>
            </li>
          ))}
        </ul>
      </header>
      <div className="play-body">
        <MapCanvas
          view={view}
          initialTile={7}
          focus={city ? { x: city.x, y: city.y } : { x: 90, y: 40 }}
          overlay={{ eligible: locked ? undefined : eligible, pick: city, zone: city ? { x: city.x, y: city.y, radius: START_SPACING, color: SEATS[seat].color } : null }}
          onTileClick={click}
        />
        <aside className="side">
          <section className="panel">
            <h2 className="eyebrow">Your pick</h2>
            {city ? (
              <>
                <div className="pick-name">
                  <span className="swatch" style={{ background: SEATS[seat].color }}><EmblemIcon seat={seat} size={14} color="#0D1217" /></span>
                  <strong>{city.name}</strong>
                  <span className="pill">Port</span>
                  {city.capital && <span className="pill">Capital</span>}
                </div>
                <ul className="facts">
                  <li>{nearby.length} cities within {START_VALUE_RADIUS} tiles, {nearby.filter((c) => c.port).length} of them ports</li>
                  <li>If a player later in turn order also picks inside the dashed square, they keep the spot and you move to the best open city.</li>
                </ul>
                {!locked && <button type="button" className="btn primary big wide" disabled={busy} onClick={() => onPick(city.id)}>Start in {city.name}</button>}
              </>
            ) : (
              <p className="muted">Tap a city with an amber ring. Only coastal cities can be starts, so every player can build ships from turn 1.</p>
            )}
            {locked ? (
              <p className="banner-inline" role="status">Picked. Waiting for {view.players.length - picked.length} more {view.players.length - picked.length === 1 ? 'player' : 'players'}.</p>
            ) : (
              <button type="button" className="btn wide" disabled={busy} onClick={onPickForMe}>Pick for me</button>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
