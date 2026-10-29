import { z } from 'zod';
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
import { LoggedEventSchema } from './view';

// Socket.IO events from the design doc's Protocol section. One socket can follow several
// matches (the home screen lists them), so every payload names its match.

// --- Client to server: strict, and never trusted for who is sending; the server takes the
// seat from the signed-in user.

export const MatchSubscribeSchema = z.strictObject({ matchId: MatchIdSchema, lastRev: RevSchema });

export const ActionSubmitSchema = z.strictObject({
  matchId: MatchIdSchema,
  clientActionId: ClientActionIdSchema,
  expectedRev: RevSchema,
  action: ActionSchema,
});

export const ChatSendSchema = z.strictObject({ matchId: MatchIdSchema, text: ChatTextSchema });

export const CLIENT_EVENTS = {
  'match:subscribe': MatchSubscribeSchema,
  'action:submit': ActionSubmitSchema,
  'chat:message': ChatSendSchema,
} as const;

// --- Server to client.

/** Refusals the server adds to the engine's RuleError codes (not-your-turn, no-moves, ...). */
export const PROTOCOL_ERRORS = ['invalid-message', 'stale-rev', 'not-in-match', 'rate-limited'] as const;

export const ActionResultSchema = z.discriminatedUnion('ok', [
  z.object({ matchId: MatchIdSchema, clientActionId: ClientActionIdSchema, ok: z.literal(true), rev: RevSchema }),
  z.object({
    matchId: MatchIdSchema,
    clientActionId: ClientActionIdSchema,
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);

/** Only events this seat saw, from LoggedEvent.seenBy. */
export const MatchEventsSchema = z.object({ matchId: MatchIdSchema, rev: RevSchema, events: z.array(LoggedEventSchema) });

export const TurnChangedSchema = z.object({
  matchId: MatchIdSchema,
  round: z.int().min(0),
  activeSeat: SeatSchema,
  deadline: IsoTimeSchema.nullable(),
});

export const LobbySeatSchema = z.object({
  seat: SeatSchema,
  name: DisplayNameSchema,
  bot: z.boolean(),
  host: z.boolean(),
  colour: ColourSchema,
  emblem: EmblemSchema,
  ready: z.boolean(),
});

export const LobbyUpdatedSchema = z.object({
  matchId: MatchIdSchema,
  code: z.string().regex(MATCH_CODE),
  settings: ReportedSettingsSchema,
  seats: z.array(LobbySeatSchema),
});

/** Who has picked a start, never where. */
export const PickUpdatedSchema = z.object({
  matchId: MatchIdSchema,
  picked: z.array(SeatSchema),
  deadline: IsoTimeSchema.nullable(),
});

export const ChatMessageSchema = z.object({ matchId: MatchIdSchema, seat: SeatSchema, text: ChatTextSchema, at: IsoTimeSchema });

export const SERVER_EVENTS = {
  'action:result': ActionResultSchema,
  'match:events': MatchEventsSchema,
  'turn:changed': TurnChangedSchema,
  'lobby:updated': LobbyUpdatedSchema,
  'pick:updated': PickUpdatedSchema,
  'chat:message': ChatMessageSchema,
} as const;

type Handlers<T extends Record<string, z.ZodType>> = { [K in keyof T]: (payload: z.output<T[K]>) => void };

/** For `new Server<ClientToServerEvents, ServerToClientEvents>()` and the client's `io()`. */
export type ClientToServerEvents = Handlers<typeof CLIENT_EVENTS>;
export type ServerToClientEvents = Handlers<typeof SERVER_EVENTS>;

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
