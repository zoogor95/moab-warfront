import { z } from 'zod';
import { ActionSchema, MatchSettingsPatchSchema, MatchSettingsSchema } from './actions';
import { ClientActionIdSchema, DisplayNameSchema, MatchCodeSchema, MatchIdSchema, RevSchema } from './common';

// Request bodies, params and queries for the REST routes in the design doc's Protocol section.
// /auth/:provider and /discord/token come with account linking and the Discord phase.

/** POST /auth/guest */
export const GuestSignInBodySchema = z.strictObject({ displayName: DisplayNameSchema });

/** POST /matches. Settings left out get DEFAULT_SETTINGS. */
export const CreateMatchBodySchema = z.strictObject({ settings: MatchSettingsSchema.optional() });

/** PATCH /matches/:id/settings */
export const UpdateSettingsBodySchema = MatchSettingsPatchSchema;

/** POST /matches/join */
export const JoinMatchBodySchema = z.strictObject({ code: MatchCodeSchema });

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
