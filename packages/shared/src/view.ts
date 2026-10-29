import { bitsToHex, emptyBits, setBit } from './bitset';
import { canSeeUnit, visibleTiles } from './fog';
import type { UnitType } from './units';
import type { GameState, LoggedEvent, MatchSettings, Phase, UnitSighting } from './types';
import { mapOf } from './world/maps';

export interface ViewCity {
  id: string;
  name: string;
  x: number;
  y: number;
  capital: boolean;
  port: boolean;
  /** As far as this player knows. */
  owner: number | null;
  /** True when the owner is known from current sight or memory. */
  known: boolean;
  building?: UnitType;
  progress?: number;
}

export interface ViewUnit {
  id: string;
  type: UnitType;
  owner: number;
  x: number;
  y: number;
  hp: number;
  /** Only for your own units. */
  moves?: number;
  carriedBy?: string;
  sentry?: boolean;
}

export interface LastSeen {
  x: number;
  y: number;
  round: number;
  units: UnitSighting[];
}

/** Everything one player is allowed to know. Clients only ever receive this. */
export interface PlayerView {
  seat: number;
  phase: Phase;
  round: number;
  activeSeat: number;
  rev: number;
  mapVersion: string;
  settings: MatchSettings;
  winner: number | null;
  players: { seat: number; name: string; bot: boolean; alive: boolean }[];
  cities: ViewCity[];
  units: ViewUnit[];
  lastSeen: LastSeen[];
  /** Hex bitsets over all tiles. */
  visible: string;
  explored: string;
  picking?: { myPick: string | null; picked: number[] };
  log: LoggedEvent[];
}

export function viewFor(s: GameState, seat: number): PlayerView {
  const me = s.players[seat];
  if (!me) throw new Error(`No seat ${seat}`);
  const map = mapOf(s);
  const visible = visibleTiles(s, seat);
  const visBits = emptyBits(map.tileCount);
  for (const i of visible) setBit(visBits, i);

  const cities: ViewCity[] = s.cities.map((c) => {
    const i = map.tileIndex(c.x, c.y);
    const base = { id: c.id, name: c.name, x: c.x, y: c.y, capital: c.capital, port: c.port };
    if (c.owner === seat) return { ...base, owner: seat, known: true, building: c.building, progress: c.progress };
    if (visible.has(i)) return { ...base, owner: c.owner, known: true };
    const mem = me.memory[i];
    if (mem && 'cityOwner' in mem) return { ...base, owner: mem.cityOwner ?? null, known: true };
    return { ...base, owner: null, known: false };
  });

  const units: ViewUnit[] = [];
  for (const u of s.units) {
    if (u.owner === seat) {
      units.push({ id: u.id, type: u.type, owner: u.owner, x: u.x, y: u.y, hp: u.hp, moves: u.moves, carriedBy: u.carriedBy, sentry: u.sentry });
    } else if (canSeeUnit(s, u, seat, visible)) {
      units.push({ id: u.id, type: u.type, owner: u.owner, x: u.x, y: u.y, hp: u.hp });
    }
  }

  const lastSeen: LastSeen[] = [];
  for (const [key, mem] of Object.entries(me.memory)) {
    const i = Number(key);
    if (visible.has(i) || !mem.units?.length) continue;
    const p = map.tilePoint(i);
    lastSeen.push({ x: p.x, y: p.y, round: mem.round, units: mem.units });
  }

  const view: PlayerView = {
    seat,
    phase: s.phase,
    round: s.round,
    activeSeat: s.activeSeat,
    rev: s.rev,
    mapVersion: s.mapVersion,
    settings: s.settings,
    winner: s.winner,
    players: s.players.map((p) => ({ seat: p.seat, name: p.name, bot: p.bot, alive: p.alive })),
    cities,
    units,
    lastSeen,
    visible: bitsToHex(visBits),
    explored: me.explored,
    log: s.log.filter((e) => e.seenBy.includes(seat)),
  };
  if (s.phase === 'picking') {
    view.picking = {
      myPick: s.picks[seat] ?? null,
      picked: Object.keys(s.picks).map(Number),
    };
  }
  return view;
}
