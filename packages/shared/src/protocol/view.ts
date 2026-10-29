import { z } from 'zod';
import { IdSchema, PointSchema, SeatSchema, UnitTypeSchema } from './common';
import { ReportedSettingsSchema } from './actions';

// Server output. Plain (non-strict) objects, so a client ignores fields added by a newer server.

const X = PointSchema.shape.x;
const Y = PointSchema.shape.y;

const UnitRefSchema = z.object({ id: IdSchema, type: UnitTypeSchema, owner: SeatSchema });

export const GameEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('combat'),
    attacker: UnitRefSchema,
    defender: UnitRefSchema,
    winner: z.enum(['attacker', 'defender']),
    x: X,
    y: Y,
  }),
  z.object({ type: z.literal('captured'), city: IdSchema, by: SeatSchema, from: SeatSchema.nullable(), unit: UnitTypeSchema }),
  z.object({ type: z.literal('captureFailed'), city: IdSchema, by: SeatSchema, owner: SeatSchema.nullable(), unit: UnitTypeSchema }),
  z.object({ type: z.literal('built'), city: IdSchema, owner: SeatSchema, unit: UnitTypeSchema, unitId: IdSchema }),
  z.object({ type: z.literal('strike'), by: SeatSchema, x: X, y: Y, destroyed: z.array(UnitRefSchema) }),
  z.object({ type: z.literal('outOfFuel'), unit: UnitRefSchema, x: X, y: Y }),
  z.object({ type: z.literal('blocked'), unit: UnitRefSchema, x: X, y: Y }),
  // JSON object keys are strings, so seats arrive as "0".."5".
  z.object({ type: z.literal('startsRevealed'), starts: z.record(z.string().regex(/^[0-5]$/), IdSchema), moved: z.array(SeatSchema) }),
  z.object({ type: z.literal('resigned'), seat: SeatSchema }),
  z.object({ type: z.literal('eliminated'), seat: SeatSchema }),
  z.object({ type: z.literal('victory'), seat: SeatSchema, reason: z.enum(['last', 'hold']) }),
]);

export const LoggedEventSchema = z.intersection(
  GameEventSchema,
  z.object({ round: z.int().min(0), turnOf: SeatSchema, seenBy: z.array(SeatSchema) }),
);

const HexBitsSchema = z.string().regex(/^[0-9a-f]*$/);

export const PlayerViewSchema = z.object({
  seat: SeatSchema,
  phase: z.enum(['picking', 'playing', 'finished']),
  round: z.int().min(0),
  activeSeat: SeatSchema,
  rev: z.int().min(0),
  mapVersion: z.string(),
  settings: ReportedSettingsSchema,
  winner: SeatSchema.nullable(),
  players: z.array(z.object({ seat: SeatSchema, name: z.string(), bot: z.boolean(), alive: z.boolean() })),
  cities: z.array(
    z.object({
      id: IdSchema,
      name: z.string(),
      x: X,
      y: Y,
      capital: z.boolean(),
      port: z.boolean(),
      owner: SeatSchema.nullable(),
      known: z.boolean(),
      building: UnitTypeSchema.optional(),
      progress: z.int().min(0).optional(),
    }),
  ),
  units: z.array(
    z.object({
      id: IdSchema,
      type: UnitTypeSchema,
      owner: SeatSchema,
      x: X,
      y: Y,
      hp: z.int().min(0),
      moves: z.int().min(0).optional(),
      carriedBy: IdSchema.optional(),
      sentry: z.boolean().optional(),
    }),
  ),
  lastSeen: z.array(
    z.object({
      x: X,
      y: Y,
      round: z.int().min(0),
      units: z.array(z.object({ type: UnitTypeSchema, owner: SeatSchema, count: z.int().positive() })),
    }),
  ),
  visible: HexBitsSchema,
  explored: HexBitsSchema,
  picking: z.object({ myPick: IdSchema.nullable(), picked: z.array(SeatSchema) }).optional(),
  log: z.array(LoggedEventSchema),
});
