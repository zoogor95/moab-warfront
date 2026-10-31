import type { UnitType } from './units';
import type { MapRegion, MapSize } from './world/maps';
import type { Point } from './world/world';

export interface MatchSettings {
  map: MapRegion;
  mapSize: MapSize;
  seats: number;
  startMode: 'auto' | 'pick';
  playMode: 'live' | 'async';
  /** Live: seconds per turn. Async: hours per turn are turnLimitSeconds / 3600. */
  turnLimitSeconds: number;
  botDifficulty: 'easy' | 'normal' | 'hard';
  terrain: 'revealed' | 'unexplored';
  victory: { kind: 'last' } | { kind: 'hold'; percent: number };
  production: 'normal' | 'fast';
  privacy: 'private' | 'public';
  spectators: boolean;
}

/** What a host may choose in the lobby, from the design doc's Match settings table. */
export const SETTING_LIMITS = {
  seats: { min: 2, max: 6 },
  liveTurnSeconds: [60, 90, 120, 180],
  asyncTurnHours: [12, 24, 48, 72],
  holdPercent: { min: 50, max: 90 },
} as const;

export const DEFAULT_SETTINGS: MatchSettings = {
  map: 'world',
  mapSize: 'standard',
  seats: 4,
  startMode: 'auto',
  playMode: 'live',
  turnLimitSeconds: 90,
  botDifficulty: 'normal',
  terrain: 'revealed',
  victory: { kind: 'last' },
  production: 'normal',
  privacy: 'private',
  spectators: true,
};

export interface Unit {
  id: string;
  type: UnitType;
  owner: number;
  x: number;
  y: number;
  hp: number;
  moves: number;
  /** Id of the transport or carrier this unit is aboard. */
  carriedBy?: string;
  sentry?: boolean;
}

export interface City {
  id: string;
  name: string;
  x: number;
  y: number;
  capital: boolean;
  port: boolean;
  owner: number | null;
  building: UnitType;
  progress: number;
}

export interface UnitSighting {
  type: UnitType;
  owner: number;
  count: number;
}

/** What a player last saw on a tile they cannot see now. */
export interface TileMemory {
  round: number;
  cityOwner?: number | null;
  units?: UnitSighting[];
}

export interface PlayerState {
  seat: number;
  name: string;
  bot: boolean;
  alive: boolean;
  /** Hex bitset of tiles this player has ever seen. */
  explored: string;
  /** Last-known contents of seen tiles that hold a city or enemy units, keyed by tile index. */
  memory: Record<string, TileMemory>;
}

export type Phase = 'picking' | 'playing' | 'finished';

export interface UnitRef {
  id: string;
  type: UnitType;
  owner: number;
}

export type GameEvent =
  | { type: 'combat'; attacker: UnitRef; defender: UnitRef; winner: 'attacker' | 'defender'; x: number; y: number }
  | { type: 'captured'; city: string; by: number; from: number | null; unit: UnitType }
  | { type: 'captureFailed'; city: string; by: number; owner: number | null; unit: UnitType }
  | { type: 'built'; city: string; owner: number; unit: UnitType; unitId: string }
  | { type: 'strike'; by: number; x: number; y: number; destroyed: UnitRef[] }
  | { type: 'outOfFuel'; unit: UnitRef; x: number; y: number }
  | { type: 'blocked'; unit: UnitRef; x: number; y: number }
  | { type: 'startsRevealed'; starts: Record<number, string>; moved: number[] }
  | { type: 'resigned'; seat: number }
  | { type: 'eliminated'; seat: number }
  | { type: 'victory'; seat: number; reason: 'last' | 'hold' };

export type LoggedEvent = GameEvent & {
  round: number;
  /** Whose turn it was. */
  turnOf: number;
  /** Seats that saw it happen. */
  seenBy: number[];
};

export interface GameState {
  version: 1;
  mapVersion: string;
  settings: MatchSettings;
  phase: Phase;
  round: number;
  activeSeat: number;
  rev: number;
  players: PlayerState[];
  cities: City[];
  units: Unit[];
  nextId: number;
  rng: { seed: number; counter: number };
  /** Start picks by seat, hidden from everyone else until turn 1. */
  picks: Record<number, string>;
  domination: { seat: number; since: number } | null;
  winner: number | null;
  log: LoggedEvent[];
}

export type Action =
  | { type: 'move'; unit: string; to: Point }
  | { type: 'board'; unit: string; carrier: string }
  | { type: 'leave'; unit: string }
  | { type: 'drop'; unit: string; to: Point }
  | { type: 'strike'; unit: string; to: Point }
  | { type: 'produce'; city: string; unitType: UnitType }
  | { type: 'sentry'; unit: string; on: boolean }
  | { type: 'pickStart'; city: string }
  | { type: 'endTurn' }
  | { type: 'resign' };

export interface ActionResult {
  state: GameState;
  /** Events this action caused, with who saw them. */
  events: LoggedEvent[];
}
