import { z } from 'zod';
import type { LoggedEvent } from '../types';
import type { PlayerView } from '../view';
import { ActionSchema, ReportedSettingsSchema } from './actions';
import {
  ChatTextSchema,
  ClientActionIdSchema,
  ColourSchema,
  DisplayNameSchema,
  EmblemSchema,
  IsoTimeSchema,
  MATCH_CODE,
  MatchIdSchema,
  RevSchema,
  SeatSchema,
} from './common';
import { MATCH_STATUSES } from './rest';
import { LoggedEventSchema, PlayerViewSchema } from './view';

// Socket.IO events from the design doc's Protocol section. One socket can follow several
// matches (the home screen lists them), so every payload names its match.

// --- Client to server: strict, and never trusted for who is sending; the server takes the
// seat from the signed-in user.

export const MatchSubscribeSchema = z.strictObject({ matchId: MatchIdSchema, lastRev: RevSchema });

export const MatchUnsubscribeSchema = z.strictObject({ matchId: MatchIdSchema });

export const ActionSubmitSchema = z.strictObject({
  matchId: MatchIdSchema,
  clientActionId: ClientActionIdSchema,
  expectedRev: RevSchema,
  action: ActionSchema,
});

export const ChatSendSchema = z.strictObject({ matchId: MatchIdSchema, text: ChatTextSchema });

export const CLIENT_EVENTS = {
  'match:subscribe': MatchSubscribeSchema,
  'match:unsubscribe': MatchUnsubscribeSchema,
  'action:submit': ActionSubmitSchema,
  'chat:message': ChatSendSchema,
} as const;

// --- Server to client.

/** Refusals the server adds to the engine's RuleError codes (not-your-turn, no-moves, ...). */
export const PROTOCOL_ERRORS = [
  'bad-request',
  'unauthorized',
  'not-found',
  'forbidden',
  'stale',
  'rate-limited',
  'not-started',
  'server-error',
] as const;
export type ProtocolError = (typeof PROTOCOL_ERRORS)[number];

/** The reply to action:submit, sent as its acknowledgement. Events are only those this seat saw. */
export const ActionResultSchema = z.discriminatedUnion('ok', [
  z.object({ clientActionId: ClientActionIdSchema, ok: z.literal(true), rev: RevSchema, events: z.array(LoggedEventSchema) }),
  z.object({ clientActionId: ClientActionIdSchema, ok: z.literal(false), error: z.string(), message: z.string(), rev: RevSchema }),
]);

/** Final counts, sent once a match is over; nothing in them is secret by then. */
export const StandingsSchema = z.object({ cities: z.array(z.int().min(0)), units: z.array(z.int().min(0)) });

/** This seat's whole view after each change, with the events it saw since its last one. */
export const MatchEventsSchema = z.object({
  matchId: MatchIdSchema,
  view: PlayerViewSchema,
  events: z.array(LoggedEventSchema),
  deadline: IsoTimeSchema.nullable(),
  standings: StandingsSchema.optional(),
});

export const TurnChangedSchema = z.object({
  matchId: MatchIdSchema,
  round: z.int().min(0),
  activeSeat: SeatSchema,
  deadline: IsoTimeSchema.nullable(),
});

export const LobbySeatSchema = z.object({
  seat: SeatSchema,
  /** Null for a bot. */
  userId: z.uuid().nullable(),
  name: DisplayNameSchema,
  bot: z.boolean(),
  ready: z.boolean(),
  colour: ColourSchema,
  emblem: EmblemSchema,
});

export const LobbySchema = z.object({
  id: MatchIdSchema,
  code: z.string().regex(MATCH_CODE),
  hostId: z.uuid(),
  status: z.enum(MATCH_STATUSES),
  settings: ReportedSettingsSchema,
  seats: z.array(LobbySeatSchema),
});

/** Who has picked a start, never where. */
export const PickUpdatedSchema = z.object({
  matchId: MatchIdSchema,
  picked: z.array(SeatSchema),
  deadline: IsoTimeSchema.nullable(),
});

export const ChatMessageSchema = z.object({
  matchId: MatchIdSchema,
  seat: SeatSchema.nullable(),
  name: z.string(),
  text: ChatTextSchema,
  at: IsoTimeSchema,
});

export const ChatHistorySchema = z.object({ matchId: MatchIdSchema, messages: z.array(ChatMessageSchema) });

export const SERVER_EVENTS = {
  'match:events': MatchEventsSchema,
  'turn:changed': TurnChangedSchema,
  'lobby:updated': LobbySchema,
  'pick:updated': PickUpdatedSchema,
  'chat:message': ChatMessageSchema,
  'chat:history': ChatHistorySchema,
} as const;

export type LobbySeat = z.output<typeof LobbySeatSchema>;
export type Lobby = z.output<typeof LobbySchema>;
export type Standings = z.output<typeof StandingsSchema>;
export type TurnChangedMsg = z.output<typeof TurnChangedSchema>;
export type PickUpdatedMsg = z.output<typeof PickUpdatedSchema>;
export type ChatMessage = z.output<typeof ChatMessageSchema>;

// Messages carrying views and events use the engine's own types, so the server can send what
// viewFor returns and clients can hand it straight to the screens.
export interface MatchUpdateMsg {
  matchId: string;
  view: PlayerView;
  events: LoggedEvent[];
  deadline: string | null;
  standings?: Standings;
}

export type ActionResultMsg =
  | { clientActionId: string; ok: true; rev: number; events: LoggedEvent[] }
  | { clientActionId: string; ok: false; error: string; message: string; rev: number };

export type Refusal = { ok: false; error: ProtocolError | string; message: string };
export type Ack<T> = (reply: T | Refusal) => void;

/** For `new Server<ClientToServerEvents, ServerToClientEvents>()` and the client's `io()`. */
export interface ClientToServerEvents {
  'match:subscribe': (msg: z.input<typeof MatchSubscribeSchema>, ack: Ack<{ ok: true }>) => void;
  'match:unsubscribe': (msg: z.input<typeof MatchUnsubscribeSchema>) => void;
  'action:submit': (msg: z.input<typeof ActionSubmitSchema>, ack: (reply: ActionResultMsg | (Refusal & { clientActionId?: string })) => void) => void;
  'chat:message': (msg: z.input<typeof ChatSendSchema>, ack: Ack<{ ok: true }>) => void;
}

export interface ServerToClientEvents {
  'match:events': (msg: MatchUpdateMsg) => void;
  'turn:changed': (msg: TurnChangedMsg) => void;
  'lobby:updated': (msg: Lobby) => void;
  'pick:updated': (msg: PickUpdatedMsg) => void;
  'chat:message': (msg: ChatMessage) => void;
  'chat:history': (msg: z.output<typeof ChatHistorySchema>) => void;
}

export type ClientEventName = keyof typeof CLIENT_EVENTS;

/** Checks an incoming client payload. The server drops anything that fails. */
export function parseClientEvent<K extends ClientEventName>(
  name: K,
  payload: unknown,
): z.ZodSafeParseResult<z.output<(typeof CLIENT_EVENTS)[K]>> {
  // TypeScript can't narrow the schema union by K; the lookup itself is exact.
  const schema: z.ZodType = CLIENT_EVENTS[name];
  return schema.safeParse(payload) as z.ZodSafeParseResult<z.output<(typeof CLIENT_EVENTS)[K]>>;
}
