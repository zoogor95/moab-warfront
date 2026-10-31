import { z } from 'zod';
import { UNIT_TYPES, type UnitType } from '../units';
import { MAP_REGION_IDS, MAP_SIZE_IDS } from '../world/maps';

export const SeatSchema = z.int().min(0).max(5);

/** Unit ids (`u12`) and city ids (`mexico-city`). The engine checks that they exist. */
export const IdSchema = z.string().regex(/^[a-z0-9-]{1,40}$/);

// Maps differ in size and load on demand, so this only rules out nonsense; the engine refuses
// tiles off the match's own map with 'off-map'.
const MAX_TILES_ACROSS = 1000;
export const PointSchema = z.object({
  x: z.int().min(0).max(MAX_TILES_ACROSS - 1),
  y: z.int().min(0).max(MAX_TILES_ACROSS - 1),
});

export const MapRegionSchema = z.enum(MAP_REGION_IDS);
export const MapSizeSchema = z.enum(MAP_SIZE_IDS);

export const UnitTypeSchema = z.enum(UNIT_TYPES as [UnitType, ...UnitType[]]);

export const EMBLEMS = ['circle', 'triangle', 'square', 'diamond', 'hexagon', 'star'] as const;
export const EmblemSchema = z.enum(EMBLEMS);
export type Emblem = z.infer<typeof EmblemSchema>;

export const ColourSchema = z.string().regex(/^#[0-9A-F]{6}$/);

export const MatchIdSchema = z.uuid();

export const RevSchema = z.int().min(0);

/** Set by the client so a retried action returns the first result instead of running twice. */
export const ClientActionIdSchema = z.string().min(1).max(64);

export const MATCH_CODE = /^[A-Z0-9]{6}$/;
/** Accepts what people type ("k7q-4zp", "K7Q 4ZP") and yields the stored form ("K7Q4ZP"). */
export const MatchCodeSchema = z
  .string()
  .transform((s) => s.toUpperCase().replace(/[\s-]/g, ''))
  .pipe(z.string().regex(MATCH_CODE, 'A match code is 6 letters and digits'));

export const DisplayNameSchema = z.string().trim().min(1).max(32);

export const ChatTextSchema = z.string().trim().min(1).max(500);

export const IsoTimeSchema = z.iso.datetime();
