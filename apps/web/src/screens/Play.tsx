import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  buildTurns,
  findPath,
  getMap,
  quietPassFor,
  reachable,
  samePoint,
  UNIT_TYPES,
  UNITS,
  type Action,
  type PlayerView,
  type Point,
  type ViewUnit,
} from '@warfront/shared';
import { ConfirmButton } from '../components/ConfirmButton';
import { Countdown } from '../components/Countdown';
import { HelpButton } from '../components/Help';
import { EmblemIcon, Logo, UnitToken } from '../components/Icons';
import { fuelOf, hasTank, isAircraft, lowFuel } from '../game/fuel';
import { describeEvent } from '../game/session';
import { effectsOf, isPlaying, type Effect } from '../map/effects';
import { MapCanvas } from '../map/MapCanvas';

type Mode = 'move' | 'strike';
/** The replay at the start of a turn shows at most this many of the latest events. */
const MAX_REPLAY = 12;
const REPLAY_STEP = 1100;

interface ReplayStep {
  effects: Effect[];
  text: string;
}

/** Runs actions in order, stopping at the first refusal or anything that ends a move; returns notes to show. */
export type RunActions = (actions: Action[], opts?: { stopOnFight?: boolean }) => Promise<string[]> | string[];

interface Props {
  view: PlayerView;
  readOnly?: boolean;
  run: RunActions;
  /** The header's way out, asked inline when `question` is set. */
  exit: { label: string; question?: string; confirmLabel?: string; onExit: () => void };
  deadline?: string | null;
  /** Extra panels for the side, such as chat. */
  extra?: ReactNode;
  /** Shown above the side panel, such as "Reconnecting". */
  banner?: string | null;
  /** Extra header controls, such as the hot-seat save menu. */
  headerExtra?: ReactNode;
  /**
   * Replays what this player could see happen since their last turn, for players sharing a
   * device who did not watch the other turns.
   */
  replaySinceLastTurn?: boolean;
}

export function Play({ view, readOnly, run: runActions, exit, deadline, extra, banner, headerExtra, replaySinceLastTurn }: Props) {
  const seat = view.seat;
  const map = getMap(view.mapVersion);
  const myTurn = !readOnly && view.phase === 'playing' && view.activeSeat === seat;
  const fast = view.settings.production === 'fast';

  const [selUnit, setSelUnit] = useState<string | null>(null);
  const [selTile, setSelTile] = useState<Point | null>(null);
  const [mode, setMode] = useState<Mode>('move');
  const [hover, setHover] = useState<Point | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [focus, setFocus] = useState<Point | null>(() => {
    const u = view.units.find((x) => x.owner === seat && (x.moves ?? 0) > 0 && !x.carriedBy);
    const c = view.cities.find((x) => x.owner === seat);
    return u ? { x: u.x, y: u.y } : c ? { x: c.x, y: c.y } : { x: Math.floor(map.cols / 2), y: Math.floor(map.rows / 2) };
  });
  const toastTimer = useRef(0);

  // Effects for events as they happen: this player's own actions, other players live online,
  // or bots moving while watched.
  const [fx, setFx] = useState<Effect[]>([]);
  const logSeen = useRef(view.log.length);
  useEffect(() => {
    const fresh = view.log.slice(logSeen.current);
    logSeen.current = view.log.length;
    const now = performance.now();
    const add = fresh.flatMap((e) => effectsOf(e, view, now));
    if (add.length) setFx((list) => [...list.filter((f) => isPlaying(f, now)), ...add]);
  }, [view]);

  const [replay, setReplay] = useState<{ steps: ReplayStep[]; at: number } | null>(() => {
    if (readOnly || !replaySinceLastTurn || view.phase !== 'playing') return null;
    const n = view.players.length;
    const since = (view.round - 1) * n + seat;
    const steps = view.log
      .filter((e) => e.turnOf !== seat && e.round * n + e.turnOf > since)
      .map((e) => ({ effects: effectsOf(e, view, 0), text: describeEvent(e, view) }))
      .filter((step) => step.effects.length)
      .slice(-MAX_REPLAY);
    return steps.length ? { steps, at: 0 } : null;
  });
  const home = useRef(focus);
  const endReplay = () => {
    setReplay(null);
    setFx([]);
    if (home.current) setFocus({ ...home.current });
  };
  useEffect(() => {
    if (!replay) return;
    const step = replay.steps[replay.at];
    const now = performance.now();
    setFx(step.effects.map((f) => ({ ...f, start: now + 250 })));
    setFocus({ x: step.effects[0].x, y: step.effects[0].y });
    const id = window.setTimeout(() => (replay.at + 1 < replay.steps.length ? setReplay({ ...replay, at: replay.at + 1 }) : endReplay()), REPLAY_STEP);
    return () => window.clearTimeout(id);
    // Only the replay position drives this; endReplay is recreated every render.
  }, [replay]);
  // Online, an order waits for the server; a second click meanwhile would act on a stale map.
  const busy = useRef(false);

  const unit = view.units.find((u) => u.id === selUnit && u.owner === seat) ?? null;
  useEffect(() => {
    if (selUnit && !unit) {
      setSelUnit(null);
      setMode('move');
    }
  }, [selUnit, unit]);

  const say = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  };

  const canPass = useMemo(() => (unit ? quietPassFor(view, unit) : null), [view, unit]);

  const highlight = useMemo(() => {
    if (!unit || !myTurn) return undefined;
    if (mode === 'strike') return new Set(map.tilesWithin(unit.x, unit.y, unit.moves ?? 0));
    if (!unit.moves || !canPass) return undefined;
    // A fighter or bomber cannot fly further than its fuel, whatever its moves.
    const range = hasTank(unit) ? Math.min(unit.moves, fuelOf(unit).left) : unit.moves;
    return new Set(reachable(map, unit, range, canPass).keys());
  }, [unit, myTurn, mode, view, seat, canPass, map]);

  const path = useMemo(() => {
    if (!unit || !hover || mode !== 'move' || !myTurn || !canPass || samePoint(hover, unit)) return null;
    return findPath(map, unit, (p) => samePoint(p, hover), canPass, 6000);
  }, [unit, hover, mode, myTurn, canPass, map]);

  const turnEnds = useMemo(() => {
    if (!path || !unit) return undefined;
    const ends = new Set<number>();
    const full = UNITS[unit.type].moves;
    let left = unit.moves ?? 0;
    path.forEach((p, i) => {
      left -= 1;
      if (left <= 0 && i < path.length - 1) {
        ends.add(map.tileIndex(p.x, p.y));
        left = full;
      }
    });
    return ends;
  }, [path, unit, map]);

  const run = async (actions: Action[], opts: { stopOnFight?: boolean } = {}): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    try {
      const notes = await runActions(actions, opts);
      if (notes.length) say(notes.join(' '));
    } finally {
      busy.current = false;
    }
  };

  const waiting = view.units.filter((u) => u.owner === seat && (u.moves ?? 0) > 0 && !u.sentry && !u.carriedBy);

  const nextUnit = () => {
    if (!waiting.length) {
      say('Every unit has moved or is on sentry.');
      return;
    }
    const i = waiting.findIndex((u) => u.id === selUnit);
    const next = waiting[(i + 1) % waiting.length];
    setSelUnit(next.id);
    setSelTile(null);
    setMode('move');
    setFocus({ x: next.x, y: next.y });
  };

  const endTurn = () => {
    if (!myTurn) return;
    setSelUnit(null);
    void run([{ type: 'endTurn' }]);
  };

  const click = (p: Point, button: 'primary' | 'secondary') => {
    if (replay) {
      endReplay();
      return;
    }
    if (button === 'secondary') {
      setSelUnit(null);
      setSelTile(null);
      setMode('move');
      return;
    }
    if (myTurn && unit && mode === 'strike') {
      void run([{ type: 'strike', unit: unit.id, to: p }]);
      setMode('move');
      return;
    }
    const mineHere = view.units.filter((u) => u.owner === seat && samePoint(u, p));
    const inReach = highlight?.has(map.tileIndex(p.x, p.y)) ?? false;
    const enemyThere = view.units.some((u) => u.owner !== seat && samePoint(u, p));
    if (myTurn && unit && (unit.moves ?? 0) > 0 && !samePoint(unit, p) && (inReach || enemyThere || !mineHere.length)) {
      const route = path && samePoint(path[path.length - 1], p) ? path : canPass ? findPath(map, unit, (q) => samePoint(q, p), canPass, 8000) : null;
      if (!route) {
        say(`No route for this ${UNITS[unit.type].name.toLowerCase()} to that tile.`);
        return;
      }
      void run(route.map((to) => ({ type: 'move', unit: unit.id, to })), { stopOnFight: true });
      return;
    }
    if (mineHere.length) {
      const order = [...mineHere.filter((u) => !u.carriedBy), ...mineHere.filter((u) => u.carriedBy)];
      const i = order.findIndex((u) => u.id === selUnit);
      setSelUnit(order[(i + 1) % order.length].id);
      setSelTile(null);
      setMode('move');
      return;
    }
    setSelUnit(null);
    setMode('move');
    setSelTile(p);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
      if (replay) {
        if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') e.preventDefault();
        endReplay();
        return;
      }
      if (e.key === ' ' || e.key === 'n') {
        e.preventDefault();
        nextUnit();
      } else if (e.key === 'e' && myTurn) endTurn();
      else if (e.key === 's' && unit && myTurn) void run([{ type: 'sentry', unit: unit.id, on: !unit.sentry }]);
      else if (e.key === 'Escape') {
        setSelUnit(null);
        setSelTile(null);
        setMode('move');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // What the side panel describes.
  const tile: Point | null = unit ?? selTile;
  const cityHere = tile ? view.cities.find((c) => samePoint(c, tile)) ?? null : null;
  const unitsHere = tile ? view.units.filter((u) => samePoint(u, tile)) : [];
  const lastSeenHere = tile ? view.lastSeen.find((s) => samePoint(s, tile)) : undefined;
  const carrier = unit?.carriedBy ? view.units.find((u) => u.id === unit.carriedBy) : undefined;
  const boardable = unit && !unit.carriedBy ? unitsHere.find((u) => u.owner === seat && u.id !== unit.id && UNITS[u.type].capacity?.types.includes(unit.type) && view.units.filter((c) => c.carriedBy === u.id).length < (UNITS[u.type].capacity?.count ?? 0)) : undefined;
  const ownCityHere = cityHere?.owner === seat;
  const canLand = unit?.type === 'paratrooper' && !unit.carriedBy && map.terrainAt(unit.x, unit.y) === 'land';
  const low = unit ? lowFuel(view, unit) : false;
  const recent = view.log.filter((e) => e.round >= view.round - 1).slice(-8).reverse();
  const name = (s: number) => (s === seat ? 'You' : view.players[s].name);

  return (
    <div className="page play">
      <header className="bar">
        <div className="brand"><Logo /><span>MOAB: Warfront</span></div>
        <div className="round"><small>ROUND</small><strong>{view.round}</strong></div>
        {deadline && view.phase === 'playing' && <Countdown deadline={deadline} label={myTurn ? 'Your time' : 'Turn time'} />}
        <ol className="chips" aria-label="Turn order">
          {view.players.map((p) => (
            <li key={p.seat} className={`chip ${p.seat === view.activeSeat ? 'active' : ''} ${p.alive ? '' : 'out'}`}>
              <EmblemIcon seat={p.seat} />
              <span>{name(p.seat)}</span>
              {p.seat === view.activeSeat && <small className="warn">{p.seat === seat ? 'Your turn' : 'Moving'}</small>}
              {p.bot && p.seat !== view.activeSeat && <small className="muted">Bot</small>}
            </li>
          ))}
        </ol>
        <span className="grow" />
        <HelpButton />
        {headerExtra}
        {exit.question ? (
          <ConfirmButton label={exit.label} question={exit.question} confirmLabel={exit.confirmLabel ?? 'Leave'} onConfirm={exit.onExit} />
        ) : (
          <button type="button" className="btn ghost" onClick={exit.onExit}>{exit.label}</button>
        )}
      </header>

      <div className="play-body">
        <MapCanvas
          view={view}
          focus={focus}
          overlay={{ selectedUnit: unit?.id ?? null, selectedTile: selTile, hover, reachable: highlight, path, turnEnds }}
          onTileClick={click}
          onTileHover={setHover}
          effects={fx}
        >
          {replay && (
            <div className="replay" role="status" aria-live="polite">
              <div>
                <small className="eyebrow">Since your last turn · {replay.at + 1} of {replay.steps.length}</small>
                <p>{replay.steps[replay.at].text}</p>
              </div>
              <button type="button" className="btn" onClick={endReplay}>Skip</button>
            </div>
          )}
        </MapCanvas>

        <aside className="side">
          {banner ? <div className="banner">{banner}</div> : readOnly && <div className="banner">{view.players[view.activeSeat].name} is moving…</div>}

          <section className="panel">
            <h2 className="eyebrow">{unit ? 'Selected' : tile ? 'Tile' : 'Selected'}</h2>
            {unit ? (
              <>
                <div className="unit-head">
                  <UnitToken type={unit.type} seat={seat} size={48} count={view.units.filter((u) => u.carriedBy === unit.id).length || undefined} />
                  <div>
                    <div className="title">{UNITS[unit.type].name}{unit.sentry ? ' · sentry' : ''}</div>
                    <div className="muted">
                      {carrier ? `Aboard your ${UNITS[carrier.type].name.toLowerCase()}` : cityHere ? `In ${cityHere.name}${ownCityHere ? ', your city' : ''}` : map.terrainAt(unit.x, unit.y) === 'sea' ? 'At sea' : 'In the field'}
                    </div>
                  </div>
                </div>
                <div className="stats">
                  <div><small>{isAircraft(unit) && !hasTank(unit) ? 'Fuel' : 'Moves'}</small><strong>{unit.moves ?? 0} / {UNITS[unit.type].moves}</strong></div>
                  {hasTank(unit) && <div className={low ? 'low' : undefined}><small>Fuel</small><strong>{fuelOf(unit).left} / {fuelOf(unit).max}</strong></div>}
                  <div><small>Health</small><strong>{unit.hp} / {UNITS[unit.type].hp}</strong></div>
                  <div><small>Attack</small><strong>{UNITS[unit.type].attack || '—'}</strong></div>
                </div>
                {low && <p className="fuel-warn" role="status">Low fuel: {fuelOf(unit).left} left. Land in your city{unit.type === 'fighter' ? ' or on your carrier' : ''} before it runs out, or it crashes.</p>}
                {myTurn && (
                  <div className="orders">
                    <button type="button" className="btn" onClick={() => void run([{ type: 'sentry', unit: unit.id, on: !unit.sentry }])}>{unit.sentry ? 'Wake' : 'Sentry'}<kbd>S</kbd></button>
                    <button type="button" className="btn" onClick={nextUnit}>Next unit<kbd>Space</kbd></button>
                    {canLand && (
                      <button type="button" className="btn" onClick={() => void run([{ type: 'land', unit: unit.id }])}>{cityHere && !ownCityHere ? 'Land and capture' : 'Land'}</button>
                    )}
                    {unit.type === 'bomber' && (unit.moves ?? 0) > 0 && (
                      <button type="button" className={`btn ${mode === 'strike' ? 'on' : ''}`} onClick={() => setMode(mode === 'strike' ? 'move' : 'strike')}>{mode === 'strike' ? 'Cancel strike' : 'Strike'}</button>
                    )}
                    {boardable && <button type="button" className="btn" onClick={() => void run([{ type: 'board', unit: unit.id, carrier: boardable.id }])}>Board {UNITS[boardable.type].name.toLowerCase()}</button>}
                    {carrier && ownCityHere && <button type="button" className="btn" onClick={() => void run([{ type: 'leave', unit: unit.id }])}>Step ashore</button>}
                  </div>
                )}
                <p className="hint">
                  {mode === 'strike'
                      ? 'Tap the target. Everything within 2 tiles is destroyed, yours included, and the bomber is used up.'
                      : myTurn && unit.type === 'paratrooper'
                        ? 'Fly over land or sea, then press Land to become a tank. Landing on a city you do not own tries to capture it. Still flying at turn end, it heads home or is lost.'
                        : myTurn
                        ? 'Tap a lit tile to move, or a tile further away to head there. Moving into an enemy attacks it.'
                        : 'Waiting for your turn.'}
                </p>
              </>
            ) : tile ? (
              <>
                {cityHere && (
                  <div className="unit-head">
                    <div>
                      <div className="title">{cityHere.name}</div>
                      <div className="muted">
                        {cityHere.owner === seat ? 'Your city' : !cityHere.known ? 'Owner unknown' : cityHere.owner === null ? 'Neutral' : `${view.players[cityHere.owner].name}'s city`}
                        {cityHere.port ? ' · port' : ''}{cityHere.capital ? ' · capital' : ''}
                      </div>
                    </div>
                  </div>
                )}
                {unitsHere.filter((u) => u.owner !== seat).length > 0 && (
                  <p className="muted">Enemy here: {summarize(unitsHere.filter((u) => u.owner !== seat), view.players)}</p>
                )}
                {lastSeenHere && <p className="muted">Last seen in round {lastSeenHere.round}: {lastSeenHere.units.map((u) => `${view.players[u.owner].name}'s ${UNITS[u.type].name.toLowerCase()}${u.count > 1 ? ` ×${u.count}` : ''}`).join(', ')}</p>}
                {!cityHere && !unitsHere.length && !lastSeenHere && <p className="muted">{map.terrainAt(tile.x, tile.y) === 'sea' ? 'Open sea.' : map.terrainAt(tile.x, tile.y) === 'mountain' ? 'Mountains. Land units cannot cross.' : 'Open ground.'}</p>}
              </>
            ) : (
              <p className="muted">{myTurn ? `${waiting.length} unit${waiting.length === 1 ? '' : 's'} waiting for orders. Tap one, or press Space.` : 'Tap any tile to inspect it.'}</p>
            )}
            {unitsHere.filter((u) => u.owner === seat).length > 1 && (
              <ul className="here">
                {unitsHere.filter((u) => u.owner === seat).map((u) => (
                  <li key={u.id}>
                    <button type="button" className={`here-btn ${u.id === unit?.id ? 'on' : ''}`} onClick={() => { setSelUnit(u.id); setSelTile(null); setMode('move'); }}>
                      <UnitToken type={u.type} seat={seat} size={26} />
                      <span>{UNITS[u.type].name}{u.carriedBy ? ' (aboard)' : ''}</span>
                      <small className={lowFuel(view, u) ? 'warn' : 'muted'}>{u.moves ?? 0} moves{hasTank(u) ? ` · ${fuelOf(u).left} fuel` : ''}{u.sentry ? ' · sentry' : ''}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {cityHere && ownCityHere && cityHere.building && (
            <section className="panel">
              <h2 className="eyebrow">City · {cityHere.name}</h2>
              <div className="build-line">
                <span>Building <strong>{UNITS[cityHere.building].name}</strong></span>
                <span className="muted">{cityHere.progress} of {buildTurns(cityHere.building, fast)} turns</span>
              </div>
              <div className="progress"><div style={{ width: `${Math.min(100, ((cityHere.progress ?? 0) / buildTurns(cityHere.building, fast)) * 100)}%` }} /></div>
              <div className="build-grid" role="group" aria-label="Production">
                {UNIT_TYPES.map((t) => {
                  const ship = UNITS[t].domain === 'sea';
                  const on = cityHere.building === t;
                  return (
                    <button key={t} type="button" aria-pressed={on} className={`build ${on ? 'on' : ''}`} disabled={!myTurn || (ship && !cityHere.port)} onClick={() => void run([{ type: 'produce', city: cityHere.id, unitType: t }])}>
                      <UnitToken type={t} seat={seat} size={26} />
                      <span>{UNITS[t].name}</span>
                      <small>{buildTurns(t, fast)} turns</small>
                    </button>
                  );
                })}
              </div>
              <p className="hint">Switching restarts progress.{cityHere.port ? '' : ' Inland cities cannot build ships.'}</p>
            </section>
          )}

          <section className="panel grow-panel">
            <h2 className="eyebrow">Since your last turn</h2>
            {recent.length ? (
              <ul className="events">{recent.map((e, i) => <li key={i}><EmblemIcon seat={e.turnOf} /> <span>{describeEvent(e, view)}</span></li>)}</ul>
            ) : (
              <p className="muted">Nothing seen yet.</p>
            )}
          </section>

          {extra}

          {myTurn && (
            <div className="side-foot">
              <button type="button" className="btn big" onClick={nextUnit} aria-label={`Next unit, ${waiting.length} waiting`}>Next unit <span className="count">{waiting.length}</span></button>
              <button type="button" className="btn primary big" onClick={endTurn}>End turn <kbd>E</kbd></button>
            </div>
          )}
        </aside>
      </div>
      <div className="toast" role="status" aria-live="polite">{toast}</div>
    </div>
  );
}

function summarize(units: ViewUnit[], players: { name: string }[]): string {
  const counts = new Map<string, number>();
  for (const u of units) {
    const key = `${players[u.owner].name}'s ${UNITS[u.type].name.toLowerCase()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', ');
}
