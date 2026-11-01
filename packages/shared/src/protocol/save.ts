import { z } from 'zod';
import { UNITS } from '../units';
import type { GameState } from '../types';
import { MAP_VERSIONS, mapOf } from '../world/maps';
import { IdSchema, PointSchema, SeatSchema, UnitTypeSchema } from './common';
import { ReportedSettingsSchema } from './actions';
import { LoggedEventSchema } from './view';

// A saved hot-seat match. It holds the full game state, seed included, so it is only ever made
// from a match the device already has in full. Never offer one for an online match: the server
// sends each seat only viewFor(state, seat).

export const SAVE_FORMAT = 'warfront-save';
export const SAVE_VERSION = 1;

const X = PointSchema.shape.x;
const Y = PointSchema.shape.y;

const SightingSchema = z.object({ type: UnitTypeSchema, owner: SeatSchema, count: z.int().positive() });

export const GameStateSchema = z.object({
  version: z.literal(1),
  mapVersion: z.string().refine((v) => MAP_VERSIONS.includes(v), 'Unknown map'),
  settings: ReportedSettingsSchema,
  phase: z.enum(['picking', 'playing', 'finished']),
  round: z.int().min(0),
  activeSeat: SeatSchema,
  rev: z.int().min(0),
  players: z.array(
    z.object({
      seat: SeatSchema,
      name: z.string().max(64),
      bot: z.boolean(),
      alive: z.boolean(),
      explored: z.string().regex(/^[0-9a-f]*$/),
      memory: z.record(
        z.string().regex(/^\d+$/),
        z.object({ round: z.int().min(0), cityOwner: SeatSchema.nullable().optional(), units: z.array(SightingSchema).optional() }),
      ),
    }),
  ),
  cities: z.array(
    z.object({
      id: IdSchema,
      name: z.string(),
      x: X,
      y: Y,
      capital: z.boolean(),
      port: z.boolean(),
      owner: SeatSchema.nullable(),
      building: UnitTypeSchema,
      progress: z.int().min(0),
    }),
  ),
  units: z.array(
    z.object({
      id: IdSchema,
      type: UnitTypeSchema,
      owner: SeatSchema,
      x: X,
      y: Y,
      hp: z.int().positive(),
      moves: z.int().min(0),
      fuel: z.int().min(0).optional(),
      carriedBy: IdSchema.optional(),
      sentry: z.boolean().optional(),
    }),
  ),
  nextId: z.int().min(0),
  rng: z.object({ seed: z.int(), counter: z.int().min(0) }),
  picks: z.record(z.string().regex(/^[0-5]$/), IdSchema),
  domination: z.object({ seat: SeatSchema, since: z.int().min(0) }).nullable(),
  winner: SeatSchema.nullable(),
  log: z.array(LoggedEventSchema),
});

export const SaveFileSchema = z.object({
  format: z.literal(SAVE_FORMAT),
  version: z.literal(SAVE_VERSION),
  name: z.string().trim().min(1).max(80),
  savedAt: z.iso.datetime(),
  game: GameStateSchema,
});

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  version: typeof SAVE_VERSION;
  name: string;
  savedAt: string;
  game: GameState;
}

/** `savedAt` is passed in so this stays free of clocks, like the rest of the shared package. */
export function makeSaveFile(game: GameState, name: string, savedAt: string): SaveFile {
  return { format: SAVE_FORMAT, version: SAVE_VERSION, name: name.trim() || 'Saved match', savedAt, game };
}

export type SaveReadResult = { ok: true; save: SaveFile } | { ok: false; error: string };

/**
 * Reads a save file's text. The map is not needed yet; once it is loaded, run checkSavedGame,
 * because the shape alone cannot tell whether units sit on the map.
 */
export function readSaveFile(text: string): SaveReadResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This is not a MOAB: Warfront save file.' };
  }
  const head = z.object({ format: z.literal(SAVE_FORMAT), version: z.int() }).safeParse(data);
  if (!head.success) return { ok: false, error: 'This is not a MOAB: Warfront save file.' };
  if (head.data.version > SAVE_VERSION) return { ok: false, error: 'This save comes from a newer version of the game.' };
  const save = SaveFileSchema.safeParse(data);
  if (!save.success) return { ok: false, error: 'This save file is damaged.' };
  return { ok: true, save: save.data as SaveFile };
}

/**
 * Checks that a saved game fits its own map and hangs together, so a damaged or edited file is
 * refused rather than crashing the engine part-way through a turn. Its map must be loaded.
 * Returns null when the game is fine.
 */
export function checkSavedGame(g: GameState): string | null {
  const damaged = 'This save file is damaged.';
  const map = mapOf(g);
  const n = g.players.length;
  if (n !== g.settings.seats || g.players.some((p, i) => p.seat !== i)) return damaged;
  if (g.activeSeat >= n || (g.winner !== null && g.winner >= n)) return damaged;
  const bitsLength = Math.ceil(map.tileCount / 8) * 2;
  if (g.players.some((p) => p.explored.length !== bitsLength)) return damaged;
  const onMap = (p: { x: number; y: number }) => map.inBounds(p.x, p.y) && p.x === map.wrapX(p.x);
  const cityIds = new Set<string>();
  for (const c of g.cities) {
    if (cityIds.has(c.id) || !onMap(c) || (c.owner !== null && c.owner >= n)) return damaged;
    cityIds.add(c.id);
  }
  const units = new Map(g.units.map((u) => [u.id, u]));
  if (units.size !== g.units.length) return damaged;
  for (const u of g.units) {
    if (!onMap(u) || u.owner >= n || u.hp > UNITS[u.type].hp) return damaged;
    if (u.carriedBy !== undefined) {
      const carrier = units.get(u.carriedBy);
      if (!carrier || carrier.owner !== u.owner || !UNITS[carrier.type].capacity?.types.includes(u.type)) return damaged;
    }
  }
  for (const [seat, city] of Object.entries(g.picks)) {
    if (Number(seat) >= n || !cityIds.has(city)) return damaged;
  }
  return null;
}
