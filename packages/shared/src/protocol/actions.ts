import { z } from 'zod';
import { SETTING_LIMITS } from '../types';
import { IdSchema, PointSchema, UnitTypeSchema } from './common';

// Client input, so strict: an unknown key is a mistake or a probe, never something to ignore.
export const ActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('move'), unit: IdSchema, to: PointSchema }),
  z.strictObject({ type: z.literal('board'), unit: IdSchema, carrier: IdSchema }),
  z.strictObject({ type: z.literal('leave'), unit: IdSchema }),
  z.strictObject({ type: z.literal('drop'), unit: IdSchema, to: PointSchema }),
  z.strictObject({ type: z.literal('strike'), unit: IdSchema, to: PointSchema }),
  z.strictObject({ type: z.literal('produce'), city: IdSchema, unitType: UnitTypeSchema }),
  z.strictObject({ type: z.literal('sentry'), unit: IdSchema, on: z.boolean() }),
  z.strictObject({ type: z.literal('pickStart'), city: IdSchema }),
  z.strictObject({ type: z.literal('endTurn') }),
  z.strictObject({ type: z.literal('resign') }),
]);

const { seats, liveTurnSeconds, asyncTurnHours, holdPercent } = SETTING_LIMITS;

const settingsFields = {
  seats: z.int().min(seats.min).max(seats.max),
  startMode: z.enum(['auto', 'pick']),
  playMode: z.enum(['live', 'async']),
  turnLimitSeconds: z.int().positive(),
  botDifficulty: z.enum(['easy', 'normal', 'hard']),
  terrain: z.enum(['revealed', 'unexplored']),
  victory: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('last') }),
    z.strictObject({ kind: z.literal('hold'), percent: z.int().min(holdPercent.min).max(holdPercent.max) }),
  ]),
  production: z.enum(['normal', 'fast']),
  privacy: z.enum(['private', 'public']),
  spectators: z.boolean(),
};

/** The turn limit's allowed values depend on the play mode, so it is checked on the whole object. */
function checkTurnLimit(s: { playMode: 'live' | 'async'; turnLimitSeconds: number }, ctx: z.RefinementCtx) {
  const allowed: readonly number[] =
    s.playMode === 'live' ? liveTurnSeconds : asyncTurnHours.map((h) => h * 3600);
  if (!allowed.includes(s.turnLimitSeconds)) {
    ctx.addIssue({
      code: 'custom',
      path: ['turnLimitSeconds'],
      message:
        s.playMode === 'live'
          ? `A live turn lasts ${liveTurnSeconds.join(', ')} seconds`
          : `An async turn lasts ${asyncTurnHours.join(', ')} hours`,
    });
  }
}

export const MatchSettingsSchema = z.strictObject(settingsFields).superRefine(checkTurnLimit);

/**
 * Settings as the server reports them. Shape only: the lobby limits above are for what a host
 * may ask for, and a client must not reject a view because a limit changed later.
 */
export const ReportedSettingsSchema = z.object({
  ...settingsFields,
  seats: z.int().min(1).max(6),
  turnLimitSeconds: z.int().positive(),
  victory: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('last') }),
    z.object({ kind: z.literal('hold'), percent: z.int().min(1).max(100) }),
  ]),
});

/**
 * A host's change in the lobby. Each field is checked here; the server then merges it into the
 * current settings and checks the result with MatchSettingsSchema, since playMode and
 * turnLimitSeconds only make sense together.
 */
export const MatchSettingsPatchSchema = z
  .strictObject(settingsFields)
  .partial()
  .refine((p) => Object.keys(p).length > 0, 'Change at least one setting');
