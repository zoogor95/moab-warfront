import { fight, pickDefender } from './combat';
import { initialExplored, refreshMemory, subHiddenFrom } from './fog';
import { hashSeed, nextRandom } from './rng';
import { chooseAutoStarts, resolvePicks } from './starts';
import {
  canCarry,
  cityAt,
  emit,
  fail,
  freeSpace,
  getCity,
  getUnit,
  ownCityAt,
  placeUnit,
  ref,
  removeUnit,
  topUnitsOnTile,
} from './state';
import { advanceTurn, beginTurn, landAircraft, settleSurvivors } from './turns';
import {
  BOMBER_BLAST_RADIUS,
  CAPTURE_CHANCE,
  PARATROOPER_DROP_RANGE,
  UNITS,
  UNIT_TYPES,
  canCapture,
} from './units';
import type { Action, ActionResult, City, GameState, LoggedEvent, MatchSettings, Unit } from './types';
import { getMap, mapOf, mapVersionFor } from './world/maps';
import type { Point } from './world/world';

export interface PlayerSetup {
  name: string;
  bot?: boolean;
}

export interface CreateMatchOptions {
  settings: MatchSettings;
  players: PlayerSetup[];
  /** Secret; kept on the server. The same seed and actions always give the same match. */
  seed: string;
}

export function createMatch({ settings, players, seed }: CreateMatchOptions): GameState {
  if (players.length < 2 || players.length > 6) throw new Error('A match needs 2 to 6 players');
  const map = getMap(mapVersionFor(settings.map, settings.mapSize));
  const s: GameState = {
    version: 1,
    mapVersion: map.version,
    settings: { ...settings, seats: players.length },
    phase: 'picking',
    round: 0,
    activeSeat: 0,
    rev: 0,
    players: players.map((p, seat) => ({
      seat,
      name: p.name,
      bot: Boolean(p.bot),
      alive: true,
      explored: initialExplored(map, settings.terrain === 'revealed'),
      memory: {},
    })),
    cities: map.cities.map((c) => ({ ...c, owner: null, building: 'tank', progress: 0 })),
    units: [],
    nextId: 1,
    rng: { seed: hashSeed(seed), counter: 0 },
    picks: {},
    domination: null,
    winner: null,
    log: [],
  };
  if (settings.startMode === 'auto') {
    const starts = chooseAutoStarts(map, s.rng, s.cities, players.length);
    starts.forEach((city, seat) => (city.owner = seat));
    startPlaying(s);
  }
  finish(s, 0);
  return s;
}

/** Ends the pick phase now (for example when its timer runs out); missing picks are made for those players. */
export function finishPicking(state: GameState): ActionResult {
  if (state.phase !== 'picking') fail('wrong-phase', 'The match is not picking starts');
  const s = structuredClone(state);
  const from = s.log.length;
  settlePicks(s);
  return finish(s, from);
}

/** Checks and applies one action to a copy of the state. The input state is never changed. */
export function applyAction(state: GameState, seat: number, action: Action): ActionResult {
  const s = structuredClone(state);
  const events = applyActionInPlace(s, seat, action);
  return { state: s, events };
}

/**
 * Same rules, but changes `s` directly; for bots, which make many moves in a row. A refused
 * action throws before anything changes. With `settle: false`, memory and who-saw-what are
 * left for the next settled action (such as endTurn) to work out.
 */
export function applyActionInPlace(s: GameState, seat: number, action: Action, opts: { settle?: boolean } = {}): LoggedEvent[] {
  const from = s.log.length;
  const settle = opts.settle ?? true;
  const player = s.players[seat] ?? fail('no-seat', `There is no seat ${seat}`);
  if (s.phase === 'finished') fail('finished', 'The match is over');
  if (!player.alive) fail('eliminated', 'You are out of this match');

  if (action.type === 'pickStart') {
    pickStart(s, seat, action.city);
    return finish(s, from, settle).events;
  }
  if (s.phase !== 'playing') fail('wrong-phase', 'Starts are still being picked');
  if (action.type === 'resign') {
    resign(s, seat);
    return finish(s, from, settle).events;
  }
  if (seat !== s.activeSeat) fail('not-your-turn', 'It is not your turn');

  switch (action.type) {
    case 'move':
      move(s, seat, action.unit, action.to);
      break;
    case 'board':
      board(s, seat, action.unit, action.carrier);
      break;
    case 'leave':
      leave(s, seat, action.unit);
      break;
    case 'drop':
      drop(s, seat, action.unit, action.to);
      break;
    case 'strike':
      strike(s, seat, action.unit, action.to);
      break;
    case 'produce':
      produce(s, seat, action.city, action.unitType);
      break;
    case 'sentry': {
      const u = ownUnit(s, seat, action.unit);
      u.sentry = action.on;
      break;
    }
    case 'endTurn':
      landAircraft(s, seat);
      settleSurvivors(s);
      advanceTurn(s);
      break;
    default:
      fail('unknown-action', 'Unknown action');
  }
  return finish(s, from, settle).events;
}

/**
 * Works out memory and who saw what after in-place actions made with `settle: false`, for a
 * batch that ends without a settled action (a bot that wins before it can end its turn).
 */
export function settleInPlace(s: GameState): void {
  finish(s, s.log.length);
}

// --- Bookkeeping ---------------------------------------------------------------

type PendingEvent = LoggedEvent & { involves?: number[]; at?: Point };

function finish(s: GameState, from: number, settle = true): ActionResult {
  settleSurvivors(s);
  // If the player whose turn it is just lost everything, move on.
  while (s.phase === 'playing' && !s.players[s.activeSeat].alive) advanceTurn(s);
  const fresh = s.log.slice(from);
  if (settle) {
    const visible = refreshMemory(s);
    const map = mapOf(s);
    for (const e of s.log as PendingEvent[]) {
      if (!e.involves) continue;
      const seen = new Set(e.involves);
      if (e.at) {
        const i = map.tileIndex(e.at.x, e.at.y);
        for (const [seat, tiles] of visible) if (tiles.has(i)) seen.add(seat);
      }
      e.seenBy = [...seen].sort((a, b) => a - b);
      delete e.involves;
      delete e.at;
    }
    s.log = s.log.filter((e) => e.round >= s.round - 2);
  }
  s.rev += 1;
  return { state: s, events: fresh };
}

function startPlaying(s: GameState): void {
  s.phase = 'playing';
  s.round = 1;
  s.activeSeat = 0;
  beginTurn(s, 0);
}

function settlePicks(s: GameState): void {
  const { starts, moved } = resolvePicks(mapOf(s), s.rng, s.cities, s.players.length, s.picks);
  const reveal: Record<number, string> = {};
  for (const [seat, city] of Object.entries(starts)) {
    const c = getCity(s, city.id);
    c.owner = Number(seat);
    reveal[Number(seat)] = c.id;
  }
  s.picks = {};
  startPlaying(s);
  emit(s, { type: 'startsRevealed', starts: reveal, moved }, s.players.map((p) => p.seat));
}

function ownUnit(s: GameState, seat: number, id: string): Unit {
  const u = getUnit(s, id);
  if (u.owner !== seat) fail('not-yours', 'That unit is not yours');
  return u;
}

// --- Starts ------------------------------------------------------------------

function pickStart(s: GameState, seat: number, cityId: string): void {
  if (s.phase !== 'picking') fail('wrong-phase', 'Starts have already been chosen');
  const city = getCity(s, cityId);
  if (!city.port) fail('not-coastal', 'Starts must be coastal cities');
  s.picks[seat] = city.id;
  if (s.players.every((p) => s.picks[p.seat] !== undefined)) settlePicks(s);
}

// --- Moving and fighting -----------------------------------------------------------

function move(s: GameState, seat: number, unitId: string, to: Point): void {
  const u = ownUnit(s, seat, unitId);
  if (u.moves <= 0) fail('no-moves', 'That unit has no moves left this turn');
  const map = mapOf(s);
  if (!map.inBounds(to.x, to.y)) fail('off-map', 'That is off the map');
  const target = { x: map.wrapX(to.x), y: to.y };
  if (map.distance(u, target) !== 1) fail('not-adjacent', 'Units move one tile at a time');

  const domain = UNITS[u.type].domain;
  const terrain = map.terrainAt(target.x, target.y);
  const city = cityAt(s, target);
  const onTile = topUnitsOnTile(s, target);
  const enemies = onTile.filter((o) => o.owner !== seat);

  if (enemies.length) {
    attack(s, u, target, enemies, city);
    return;
  }

  if (domain === 'land') {
    if (terrain === 'mountain') fail('cannot-enter', 'Mountains block land units');
    if (terrain === 'sea') {
      const ride = onTile.find((o) => canCarry(o, u.type) && freeSpace(s, o) > 0);
      if (!ride) fail('cannot-enter', 'Land units go to sea only aboard your transport');
      u.carriedBy = ride.id;
      placeUnit(s, u, target);
      u.moves -= 1;
      return;
    }
    if (city && city.owner !== seat) {
      if (!canCapture(u.type)) fail('cannot-capture', 'Only tanks and paratroopers capture cities');
      capture(s, u, city);
      return;
    }
    u.carriedBy = undefined;
    placeUnit(s, u, target);
    u.moves -= 1;
    return;
  }

  if (domain === 'sea') {
    if (terrain !== 'sea' && !(city && city.owner === seat)) fail('cannot-enter', 'Ships stay at sea or in your own port cities');
    u.carriedBy = undefined;
    placeUnit(s, u, target);
    u.moves -= 1;
    return;
  }

  // Air: anywhere. A fighter over your carrier at sea lands on it.
  const carrier = !ownCityAt(s, target, seat) ? onTile.find((o) => canCarry(o, u.type) && freeSpace(s, o) > 0) : undefined;
  u.carriedBy = carrier?.id;
  placeUnit(s, u, target);
  u.moves -= 1;
}

function attack(s: GameState, u: Unit, target: Point, enemies: Unit[], city: City | undefined): void {
  const defender = pickDefender(s, u, enemies);
  if (!defender) {
    // A city left with only ships or aircraft in it falls to a land attack.
    if (city && city.owner !== u.owner && canCapture(u.type) && enemies.every((e) => UNITS[e.type].domain !== 'land')) {
      capture(s, u, city);
      return;
    }
    // Something this unit cannot see is in the way: it stops here.
    if (enemies.some((e) => subHiddenFrom(s, e, u.owner))) {
      u.moves = 0;
      emit(s, { type: 'blocked', unit: ref(u), x: target.x, y: target.y }, [u.owner]);
      return;
    }
    if (UNITS[u.type].attack <= 0) fail('cannot-attack', `A ${UNITS[u.type].name.toLowerCase()} cannot attack`);
    fail('cannot-attack', `A ${UNITS[u.type].name.toLowerCase()} cannot attack what is there`);
  }
  const winner = fight(s, u, defender);
  u.moves = 0;
  emit(
    s,
    { type: 'combat', attacker: ref(u), defender: ref(defender), winner, x: target.x, y: target.y },
    [u.owner, defender.owner],
    target,
  );
  removeUnit(s, winner === 'attacker' ? defender.id : u.id);
}

function capture(s: GameState, u: Unit, city: City): void {
  const from = city.owner;
  const involves = from === null ? [u.owner] : [u.owner, from];
  if (nextRandom(s.rng) < CAPTURE_CHANCE) {
    for (const e of topUnitsOnTile(s, city)) if (e.owner !== u.owner) removeUnit(s, e.id);
    city.owner = u.owner;
    city.building = 'tank';
    city.progress = 0;
    u.carriedBy = undefined;
    placeUnit(s, u, city);
    u.moves = 0;
    emit(s, { type: 'captured', city: city.id, by: u.owner, from, unit: u.type }, involves, city);
  } else {
    removeUnit(s, u.id);
    emit(s, { type: 'captureFailed', city: city.id, by: u.owner, owner: from, unit: u.type }, involves, city);
  }
}

function board(s: GameState, seat: number, unitId: string, carrierId: string): void {
  const u = ownUnit(s, seat, unitId);
  const carrier = ownUnit(s, seat, carrierId);
  if (u.carriedBy) fail('already-aboard', 'That unit is already aboard');
  if (u.x !== carrier.x || u.y !== carrier.y) fail('not-together', 'Board from the same tile');
  if (!canCarry(carrier, u.type)) fail('cannot-carry', `A ${UNITS[carrier.type].name.toLowerCase()} cannot carry that`);
  if (freeSpace(s, carrier) <= 0) fail('full', 'No room aboard');
  u.carriedBy = carrier.id;
}

function leave(s: GameState, seat: number, unitId: string): void {
  const u = ownUnit(s, seat, unitId);
  if (!u.carriedBy) fail('not-aboard', 'That unit is not aboard anything');
  if (!ownCityAt(s, u, seat)) fail('not-in-port', 'Units can step off only in your own city; at sea, move them onto land');
  u.carriedBy = undefined;
}

function drop(s: GameState, seat: number, unitId: string, to: Point): void {
  const u = ownUnit(s, seat, unitId);
  if (u.type !== 'paratrooper') fail('cannot-drop', 'Only paratroopers drop');
  if (u.carriedBy || !ownCityAt(s, u, seat)) fail('cannot-drop', 'Paratroopers drop from your own city');
  if (u.moves < UNITS.paratrooper.moves) fail('cannot-drop', 'A drop takes a full turn of moves');
  const map = mapOf(s);
  if (!map.inBounds(to.x, to.y)) fail('off-map', 'That is off the map');
  const target = { x: map.wrapX(to.x), y: to.y };
  const d = map.distance(u, target);
  if (d < 1 || d > PARATROOPER_DROP_RANGE) fail('out-of-range', `Drops reach 1 to ${PARATROOPER_DROP_RANGE} tiles`);
  if (map.terrainAt(target.x, target.y) !== 'land') fail('cannot-enter', 'Paratroopers land on open ground or a city');
  if (topUnitsOnTile(s, target).some((o) => o.owner !== seat)) fail('occupied', 'The drop zone is occupied');
  const city = cityAt(s, target);
  if (city && city.owner !== seat) {
    capture(s, u, city);
    return;
  }
  placeUnit(s, u, target);
  u.moves = 0;
}

function strike(s: GameState, seat: number, unitId: string, to: Point): void {
  const u = ownUnit(s, seat, unitId);
  if (u.type !== 'bomber') fail('cannot-strike', 'Only bombers strike');
  const map = mapOf(s);
  if (!map.inBounds(to.x, to.y)) fail('off-map', 'That is off the map');
  const target = { x: map.wrapX(to.x), y: to.y };
  if (map.distance(u, target) > u.moves) fail('out-of-range', 'The target is out of this turn\'s range');
  const hit = s.units.filter((o) => o.id !== u.id && !o.carriedBy && map.distance(o, target) <= BOMBER_BLAST_RADIUS);
  const destroyed = hit.flatMap((o) => removeUnit(s, o.id)).map(ref);
  removeUnit(s, u.id);
  const involves = [...new Set([seat, ...destroyed.map((d) => d.owner)])];
  emit(s, { type: 'strike', by: seat, x: target.x, y: target.y, destroyed }, involves, target);
}

function produce(s: GameState, seat: number, cityId: string, type: Unit['type']): void {
  const city = getCity(s, cityId);
  if (city.owner !== seat) fail('not-yours', 'That city is not yours');
  if (!UNIT_TYPES.includes(type)) fail('unknown-unit', 'Unknown unit type');
  if (UNITS[type].domain === 'sea' && !city.port) fail('not-a-port', 'Only port cities build ships');
  if (city.building !== type) {
    city.building = type;
    city.progress = 0;
  }
}

function resign(s: GameState, seat: number): void {
  for (const c of s.cities) {
    if (c.owner !== seat) continue;
    c.owner = null;
    c.building = 'tank';
    c.progress = 0;
  }
  s.units = s.units.filter((u) => u.owner !== seat);
  emit(s, { type: 'resigned', seat }, s.players.map((p) => p.seat));
  // finish() marks the player out and moves the turn on if it was theirs.
}
