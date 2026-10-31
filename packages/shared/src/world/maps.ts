import worldData from './maps/world-v1.json';
import { GameMap, type MapData } from './world';

export const MAP_REGIONS = [
  { id: 'world', name: 'World' },
  { id: 'africa', name: 'Africa' },
  { id: 'asia', name: 'Asia' },
  { id: 'europe', name: 'Europe' },
  { id: 'north-america', name: 'North America' },
  { id: 'south-america', name: 'South America' },
  { id: 'asean-australia', name: 'ASEAN and Australia' },
  { id: 'velgard', name: 'Velgard' },
] as const;
export type MapRegion = (typeof MAP_REGIONS)[number]['id'];
export const MAP_REGION_IDS = MAP_REGIONS.map((r) => r.id) as [MapRegion, ...MapRegion[]];

/** `players` is advice for the host, not a limit. */
export const MAP_SIZES = [
  { id: 'small', name: 'Small', players: '2–3 players' },
  { id: 'standard', name: 'Standard', players: '4–5 players' },
  { id: 'detailed', name: 'Detailed', players: 'Long matches, up to 6 players' },
] as const;
export type MapSize = (typeof MAP_SIZES)[number]['id'];
export const MAP_SIZE_IDS = MAP_SIZES.map((s) => s.id) as [MapSize, ...MapSize[]];

/** The file a region and size load from, which a match records so it always replays on the same map. */
export function mapVersionFor(region: MapRegion, size: MapSize): string {
  // The original Earth map keeps its name so saved matches still load.
  return region === 'world' && size === 'standard' ? 'world-v1' : `${region}-${size}-v1`;
}

export const MAP_VERSIONS: readonly string[] = MAP_REGIONS.flatMap((r) => MAP_SIZES.map((s) => mapVersionFor(r.id, s.id)));

/** World Standard is always loaded: it is the default map and what the tests build on. */
export const WORLD = new GameMap(worldData as MapData);

const loaded = new Map<string, GameMap>([[WORLD.version, WORLD]]);

/**
 * Loads a map file once. Maps are fetched on demand so a phone downloads only the one it plays;
 * the engine itself is synchronous, so load before creating, replaying or viewing a match.
 */
export async function loadMap(version: string): Promise<GameMap> {
  const have = loaded.get(version);
  if (have) return have;
  if (!MAP_VERSIONS.includes(version)) throw new Error(`Unknown map ${version}`);
  const mod = (await import(`./maps/${version}.json`)) as { default: MapData };
  const map = new GameMap(mod.default);
  loaded.set(version, map);
  return map;
}

export function loadAllMaps(): Promise<GameMap[]> {
  return Promise.all(MAP_VERSIONS.map(loadMap));
}

export function getMap(version: string): GameMap {
  const map = loaded.get(version);
  if (!map) throw new Error(`Map ${version} is not loaded; await loadMap('${version}') first`);
  return map;
}

/** The map a match or view is played on. */
export function mapOf(s: { mapVersion: string }): GameMap {
  return getMap(s.mapVersion);
}
