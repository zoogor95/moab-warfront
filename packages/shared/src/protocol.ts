import { z } from 'zod';
import { UNIT_TYPES, type UnitType } from './units';
import type { Action, LoggedEvent, MatchSettings } from './types';
import type { PlayerView } from './view';

// Messages between client and server. Both ends parse with these, so a shape is defined once.

/** Seat colours, each paired with an emblem so colour is never the only cue. Index = seat. */
export const SEAT_STYLES = [
  { colour: '#4C8DFF', colourName: 'Blue', emblem: 'circle' },
  { colour: '#FF8C42', colourName: 'Orange', emblem: 'triangle' },
  { colour: '#26C6B0', colourName: 'Teal', emblem: 'square' },
  { colour: '#A77BFF', colourName: 'Violet', emblem: 'diamond' },
  { colour: '#FF5D8F', colourName: 'Rose', emblem: 'hexagon' },
  { colour: '#B8E05A', colourName: 'Lime', emblem: 'star' },
] as const;

export type Emblem = (typeof SEAT_STYLES)[number]['emblem'];

export const LIVE_TURN_LIMITS = [60, 90, 120, 180] as const;
export const ASYNC_TURN_LIMITS = [12, 24, 48, 72].map((h) => h * 3600);
export const CHAT_MAX_LENGTH = 300;
export const NAME_MAX_LENGTH = 24;

const int = () => z.number().int();
const point = z.object({ x: int().min(0).max(179), y: int().min(0).max(89) });
const id = z.string().min(1).max(64);
const unitType = z.enum(UNIT_TYPES as [UnitType, ...UnitType[]]);

export const actionSchema: z.ZodType<Action> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), unit: id, to: point }),
  z.object({ type: z.literal('board'), unit: id, carrier: id }),
  z.object({ type: z.literal('leave'), unit: id }),
  z.object({ type: z.literal('drop'), unit: id, to: point }),
  z.object({ type: z.literal('strike'), unit: id, to: point }),
  z.object({ type: z.literal('produce'), city: id, unitType }),
  z.object({ type: z.literal('sentry'), unit: id, on: z.boolean() }),
  z.object({ type: z.literal('pickStart'), city: id }),
  z.object({ type: z.literal('endTurn') }),
  z.object({ type: z.literal('resign') }),
]);

export const matchSettingsSchema: z.ZodType<MatchSettings> = z
  .object({
    seats: int().min(2).max(6),
    startMode: z.enum(['auto', 'pick']),
    playMode: z.enum(['live', 'async']),
    turnLimitSeconds: int().positive(),
    botDifficulty: z.enum(['easy', 'normal', 'hard']),
    terrain: z.enum(['revealed', 'unexplored']),
    victory: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('last') }),
      z.object({ kind: z.literal('hold'), percent: int().min(30).max(90) }),
    ]),
    production: z.enum(['normal', 'fast']),
    privacy: z.enum(['private', 'public']),
    spectators: z.boolean(),
  })
  .refine(
    (s) => (s.playMode === 'live' ? (LIVE_TURN_LIMITS as readonly number[]) : ASYNC_TURN_LIMITS).includes(s.turnLimitSeconds),
    { message: 'Pick one of the listed turn limits', path: ['turnLimitSeconds'] },
  );

const displayName = z.string().trim().min(1).max(NAME_MAX_LENGTH);
export const matchCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, 'Codes are 6 letters or digits');

// --- REST bodies ---------------------------------------------------------------------------

export const guestBody = z.object({ name: displayName });
export const refreshBody = z.object({ refreshToken: z.string().min(16).max(200) });
export const createMatchBody = z.object({ settings: matchSettingsSchema.optional() });
export const settingsBody = z.object({ settings: matchSettingsSchema });
export const joinBody = z.object({ code: matchCode });
export const seatBody = z.object({ seat: int().min(0).max(5) });
export const readyBody = z.object({ ready: z.boolean() });
export const submitBody = z.object({ clientActionId: z.string().min(1).max(64), expectedRev: int().min(0), action: actionSchema });

export interface AuthResponse {
  user: { id: string; name: string };
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export type MatchStatus = 'lobby' | 'picking' | 'playing' | 'finished';

export interface LobbySeat {
  seat: number;
  userId: string | null;
  name: string;
  bot: boolean;
  ready: boolean;
  colour: string;
  emblem: Emblem;
}

export interface Lobby {
  id: string;
  code: string;
  hostId: string;
  status: MatchStatus;
  settings: MatchSettings;
  seats: LobbySeat[];
}

export interface MatchSummary {
  id: string;
  code: string;
  status: MatchStatus;
  round: number;
  activeSeat: number;
  mySeat: number;
  yourTurn: boolean;
  players: string[];
  turnDeadline: string | null;
}

// --- Socket events -------------------------------------------------------------------------

export const subscribeMsg = z.object({ matchId: z.uuid(), lastRev: int().min(0).optional() });
export const submitMsg = submitBody.extend({ matchId: z.uuid() });
export const chatSendMsg = z.object({ matchId: z.uuid(), text: z.string().trim().min(1).max(CHAT_MAX_LENGTH) });

/** Error codes outside the rules engine's own (which come from RuleError). */
export type ProtocolError =
  | 'bad-request'
  | 'unauthorized'
  | 'not-found'
  | 'forbidden'
  | 'stale'
  | 'rate-limited'
  | 'not-started'
  | 'server-error';

export type ActionResultMsg =
  | { clientActionId: string; ok: true; rev: number; events: LoggedEvent[] }
  | { clientActionId: string; ok: false; error: string; message: string; rev: number };

/** Final counts, sent once a match is over; nothing in them is secret by then. */
export interface Standings {
  cities: number[];
  units: number[];
}

export interface MatchUpdateMsg {
  matchId: string;
  view: PlayerView;
  /** Events this seat saw since its previous update. */
  events: LoggedEvent[];
  deadline: string | null;
  standings?: Standings;
}

export interface TurnChangedMsg {
  matchId: string;
  round: number;
  activeSeat: number;
  deadline: string | null;
}

export interface PickUpdatedMsg {
  matchId: string;
  picked: number[];
  deadline: string | null;
}

export interface ChatMessage {
  matchId: string;
  seat: number | null;
  name: string;
  text: string;
  at: string;
}

export interface ServerToClientEvents {
  'lobby:updated': (lobby: Lobby) => void;
  'match:events': (msg: MatchUpdateMsg) => void;
  'turn:changed': (msg: TurnChangedMsg) => void;
  'pick:updated': (msg: PickUpdatedMsg) => void;
  'chat:message': (msg: ChatMessage) => void;
  'chat:history': (msg: { matchId: string; messages: ChatMessage[] }) => void;
}

export type Ack<T> = (reply: T | { ok: false; error: ProtocolError; message: string }) => void;

export interface ClientToServerEvents {
  'match:subscribe': (msg: z.input<typeof subscribeMsg>, ack: Ack<{ ok: true }>) => void;
  'match:unsubscribe': (msg: { matchId: string }) => void;
  'action:submit': (msg: z.input<typeof submitMsg>, ack: (reply: ActionResultMsg | { ok: false; error: ProtocolError; message: string; clientActionId?: string }) => void) => void;
  'chat:message': (msg: z.input<typeof chatSendMsg>, ack: Ack<{ ok: true }>) => void;
}
