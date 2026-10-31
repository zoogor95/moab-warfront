import { z } from 'zod';
import { ActionSchema, MatchSettingsPatchSchema, MatchSettingsSchema } from './actions';
import { ClientActionIdSchema, DisplayNameSchema, MatchCodeSchema, MatchIdSchema, RevSchema, SeatSchema } from './common';

// Request bodies, params and queries for the REST routes in the design doc's Protocol section,
// plus the lobby routes the server adds. /auth/:provider and /discord/token come with account
// linking and the Discord phase.

/** POST /auth/guest */
export const GuestSignInBodySchema = z.strictObject({ displayName: DisplayNameSchema });

/** POST /auth/refresh: swaps a refresh token for a new pair. */
export const RefreshBodySchema = z.strictObject({ refreshToken: z.string().min(16).max(200) });

/** POST /matches. Settings left out get DEFAULT_SETTINGS. */
export const CreateMatchBodySchema = z.strictObject({ settings: MatchSettingsSchema.optional() });

/** PATCH /matches/:id/settings: a change the server merges, then checks whole. */
export const UpdateSettingsBodySchema = MatchSettingsPatchSchema;

/** POST /matches/join */
export const JoinMatchBodySchema = z.strictObject({ code: MatchCodeSchema });

/** POST /matches/:id/seat (move there) and POST /matches/:id/bots (host puts a bot there). */
export const SeatBodySchema = z.strictObject({ seat: SeatSchema });

/** POST /matches/:id/ready */
export const ReadyBodySchema = z.strictObject({ ready: z.boolean() });

/** The :id in /matches/:id/... */
export const MatchParamsSchema = z.strictObject({ id: MatchIdSchema });

/** GET /matches/:id/events?since=:rev. Query values arrive as strings. */
export const EventsQuerySchema = z.strictObject({ since: z.coerce.number().pipe(RevSchema) });

/** POST /matches/:id/actions, for async play from a notification without a socket. */
export const SubmitActionBodySchema = z.strictObject({
  clientActionId: ClientActionIdSchema,
  expectedRev: RevSchema,
  action: ActionSchema,
});

// --- Responses -----------------------------------------------------------------------------

export interface AuthResponse {
  user: { id: string; name: string };
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export const MATCH_STATUSES = ['lobby', 'picking', 'playing', 'finished'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** GET /matches: the home screen's list, matches waiting on you first. */
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
