import { useMemo, useState } from 'react';
import { applyAction, botPickStart, getMap, START_SPACING, START_VALUE_RADIUS, viewFor, type GameState, type Point } from '@warfront/shared';
import { EmblemIcon, Logo } from '../components/Icons';
import { MapCanvas } from '../map/MapCanvas';
import { SEATS } from '../theme';

/** Hidden start pick for one person. */
export function Pick({ game, seat, onPicked }: { game: GameState; seat: number; onPicked: (g: GameState) => void }) {
  const view = useMemo(() => viewFor(game, seat), [game, seat]);
  const map = getMap(view.mapVersion);
  const [choice, setChoice] = useState<string | null>(null);
  const city = view.cities.find((c) => c.id === choice) ?? null;
  const eligible = useMemo(() => new Set(view.cities.filter((c) => c.port).map((c) => map.tileIndex(c.x, c.y))), [view, map]);
  const nearby = city ? view.cities.filter((c) => c.id !== city.id && map.distance(c, city) <= START_VALUE_RADIUS) : [];
  const picked = view.picking?.picked ?? [];

  const click = (p: Point) => {
    const c = view.cities.find((x) => x.x === p.x && x.y === p.y && x.port);
    setChoice(c ? c.id : null);
  };

  const confirm = (cityId: string) => onPicked(applyAction(game, seat, { type: 'pickStart', city: cityId }).state);

  return (
    <div className="page play">
      <header className="bar">
        <div className="brand"><Logo /><span>MOAB: Warfront</span></div>
        <div className="bar-title"><strong>Pick your start</strong><span className="muted">Everyone picks at once · hidden until turn 1</span></div>
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
          focus={{ x: 90, y: 40 }}
          overlay={{ eligible, pick: city, zone: city ? { x: city.x, y: city.y, radius: START_SPACING, color: SEATS[seat].color } : null }}
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
                <button type="button" className="btn primary big wide" onClick={() => confirm(city.id)}>Start in {city.name}</button>
              </>
            ) : (
              <p className="muted">Tap a city with an amber ring. Only coastal cities can be starts, so every player can build ships from turn 1.</p>
            )}
            <button type="button" className="btn wide" onClick={() => confirm(botPickStart(game, seat))}>Pick for me</button>
          </section>
        </aside>
      </div>
    </div>
  );
}
