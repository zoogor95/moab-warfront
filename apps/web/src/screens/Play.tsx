import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyAction,
  buildTurns,
  findPath,
  getMap,
  PARATROOPER_DROP_RANGE,
  quietPassFor,
  reachable,
  RuleError,
  samePoint,
  UNIT_TYPES,
  UNITS,
  viewFor,
  type Action,
  type GameState,
  type Point,
  type ViewUnit,
} from '@warfront/shared';
import { EmblemIcon, Logo, UnitToken } from '../components/Icons';
import { SaveMenu } from '../components/SaveMenu';
import { describeEvent, humanSeats } from '../game/session';
import { effectsOf, isPlaying, type Effect } from '../map/effects';
import { MapCanvas } from '../map/MapCanvas';

type Mode = 'move' | 'drop' | 'strike';
const STOPS = new Set(['combat', 'blocked', 'captured', 'captureFailed', 'strike']);
/** The replay at the start of a turn shows at most this many of the latest events. */
const MAX_REPLAY = 12;
const REPLAY_STEP = 1100;

interface ReplayStep {
  effects: Effect[];
  text: string;
}

interface Props {
  game: GameState;
  seat: number;
  readOnly?: boolean;
  onChange?: (g: GameState) => void;
  onEndTurn?: (g: GameState) => void;
  onNewGame: () => void;
}

export function Play({ game, seat, readOnly, onChange, onEndTurn, onNewGame }: Props) {
  const view = useMemo(() => viewFor(game, seat), [game, seat]);
  const map = getMap(view.mapVersion);
  const myTurn = !readOnly && game.phase === 'playing' && game.activeSeat === seat;
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

  // Effects for events as they happen: this player's own actions, or bots moving while watched.
  const [fx, setFx] = useState<Effect[]>([]);
  const logSeen = useRef(view.log.length);
  useEffect(() => {
    const fresh = view.log.slice(logSeen.current);
    logSeen.current = view.log.length;
    const now = performance.now();
    const add = fresh.flatMap((e) => effectsOf(e, view, now));
    if (add.length) setFx((list) => [...list.filter((f) => isPlaying(f, now)), ...add]);
  }, [view]);

  // When players share a device, nobody saw the other turns, so replay what this player could
  // see happen since their last turn, panning to each event in turn.
  const [replay, setReplay] = useState<{ steps: ReplayStep[]; at: number } | null>(() => {
    if (readOnly || game.phase !== 'playing' || humanSeats(game).length < 2) return null;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay]);

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
    if (mode === 'drop') {
      const enemy = new Set(view.units.filter((u) => u.owner !== seat).map((u) => map.tileIndex(u.x, u.y)));
      return new Set(map.tilesWithin(unit.x, unit.y, PARATROOPER_DROP_RANGE).filter((i) => {
        const p = map.tilePoint(i);
        return map.terrainAt(p.x, p.y) === 'land' && !enemy.has(i) && map.distance(p, unit) >= 1;
      }));
    }
    if (mode === 'strike') return new Set(map.tilesWithin(unit.x, unit.y, unit.moves ?? 0));
    if (!unit.moves || !canPass) return undefined;
    return new Set(reachable(map, unit, unit.moves, canPass).keys());
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

  /** Runs actions in order, stopping at the first refusal or anything that ends a move. */
  const run = (actions: Action[], opts: { stopOnFight?: boolean } = {}): GameState => {
    let g = game;
    const notes: string[] = [];
    for (const a of actions) {
      if (a.type === 'move' && !g.units.find((u) => u.id === a.unit)?.moves) break;
      try {
        const r = applyAction(g, seat, a);
        g = r.state;
        const v = viewFor(g, seat);
        notes.push(...r.events.filter((e) => e.type !== 'built').map((e) => describeEvent(e, v)));
        if (opts.stopOnFight && r.events.some((e) => STOPS.has(e.type))) break;
      } catch (e) {
        if (e instanceof RuleError) {
          notes.push(e.message);
          break;
        }
        throw e;
      }
    }
    if (g !== game) onChange?.(g);
    if (notes.length) say(notes.join(' '));
    return g;
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
    const r = applyAction(game, seat, { type: 'endTurn' });
    setSelUnit(null);
    onEndTurn?.(r.state);
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
    if (myTurn && unit && mode === 'drop') {
      run([{ type: 'drop', unit: unit.id, to: p }]);
      setMode('move');
      return;
    }
    if (myTurn && unit && mode === 'strike') {
      run([{ type: 'strike', unit: unit.id, to: p }]);
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
      run(route.map((to) => ({ type: 'move', unit: unit.id, to })), { stopOnFight: true });
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
      else if (e.key === 's' && unit && myTurn) run([{ type: 'sentry', unit: unit.id, on: !unit.sentry }]);
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
  const recent = view.log.filter((e) => e.round >= view.round - 1).slice(-8).reverse();
  const name = (s: number) => (s === seat ? 'You' : view.players[s].name);

  return (
    <div className="page play">
      <header className="bar">
        <div className="brand"><Logo /><span>MOAB: Warfront</span></div>
        <div className="round"><small>ROUND</small><strong>{view.round}</strong></div>
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
        {game.phase === 'playing' && <SaveMenu game={game} />}
        <button type="button" className="btn ghost" onClick={() => window.confirm('Leave this match and start a new one? It cannot be resumed.') && onNewGame()}>New match</button>
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
          {readOnly && <div className="banner">{view.players[view.activeSeat].name} is moving…</div>}

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
                  <div><small>Moves</small><strong>{unit.moves ?? 0} / {UNITS[unit.type].moves}</strong></div>
                  <div><small>Health</small><strong>{unit.hp} / {UNITS[unit.type].hp}</strong></div>
                  <div><small>Attack</small><strong>{UNITS[unit.type].attack || '—'}</strong></div>
                </div>
                {myTurn && (
                  <div className="orders">
                    <button type="button" className="btn" onClick={() => run([{ type: 'sentry', unit: unit.id, on: !unit.sentry }])}>{unit.sentry ? 'Wake' : 'Sentry'}<kbd>S</kbd></button>
                    <button type="button" className="btn" onClick={nextUnit}>Next unit<kbd>Space</kbd></button>
                    {unit.type === 'paratrooper' && ownCityHere && !unit.carriedBy && unit.moves === UNITS.paratrooper.moves && (
                      <button type="button" className={`btn ${mode === 'drop' ? 'on' : ''}`} onClick={() => setMode(mode === 'drop' ? 'move' : 'drop')}>{mode === 'drop' ? 'Cancel drop' : 'Drop'}</button>
                    )}
                    {unit.type === 'bomber' && (unit.moves ?? 0) > 0 && (
                      <button type="button" className={`btn ${mode === 'strike' ? 'on' : ''}`} onClick={() => setMode(mode === 'strike' ? 'move' : 'strike')}>{mode === 'strike' ? 'Cancel strike' : 'Strike'}</button>
                    )}
                    {boardable && <button type="button" className="btn" onClick={() => run([{ type: 'board', unit: unit.id, carrier: boardable.id }])}>Board {UNITS[boardable.type].name.toLowerCase()}</button>}
                    {carrier && ownCityHere && <button type="button" className="btn" onClick={() => run([{ type: 'leave', unit: unit.id }])}>Step ashore</button>}
                  </div>
                )}
                <p className="hint">
                  {mode === 'drop'
                    ? `Tap open ground or a city within ${PARATROOPER_DROP_RANGE} tiles. A city drop is a capture attempt.`
                    : mode === 'strike'
                      ? 'Tap the target. Everything within 2 tiles is destroyed, yours included, and the bomber is used up.'
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
                      <small className="muted">{u.moves ?? 0} moves{u.sentry ? ' · sentry' : ''}</small>
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
                    <button key={t} type="button" aria-pressed={on} className={`build ${on ? 'on' : ''}`} disabled={!myTurn || (ship && !cityHere.port)} onClick={() => run([{ type: 'produce', city: cityHere.id, unitType: t }])}>
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
