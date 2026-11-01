import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyAction,
  chooseAutoStarts,
  createMatch,
  DEFAULT_SETTINGS,
  getMap,
  loadAllMaps,
  MAP_REGIONS,
  MAP_SIZES,
  MAP_VERSIONS,
  mapVersionFor,
  playBotTurn,
  WORLD,
  type GameMap,
  type MapRegion,
  type MapSize,
} from '../src';
import { checkInvariants } from './helpers';

beforeAll(async () => {
  await loadAllMaps();
});

/** Size of the 8-connected body of water a tile belongs to (ships move diagonally too). */
function seaBody(map: GameMap, x: number, y: number): Set<number> {
  const body = new Set<number>();
  if (map.terrainAt(x, y) !== 'sea') return body;
  const queue = [map.tileIndex(x, y)];
  body.add(queue[0]);
  for (let i = 0; i < queue.length; i++) {
    const p = map.tilePoint(queue[i]);
    for (const n of map.neighbours(p.x, p.y)) {
      const k = map.tileIndex(n.x, n.y);
      if (body.has(k) || map.terrainAt(n.x, n.y) !== 'sea') continue;
      body.add(k);
      queue.push(k);
    }
  }
  return body;
}

/** True when two lon/lat points lie in the same body of water. */
function sameSea(map: GameMap, a: [number, number], b: [number, number]): boolean {
  const pa = map.tileAt(...a);
  const pb = map.tileAt(...b);
  return seaBody(map, pa.x, pa.y).has(map.tileIndex(pb.x, pb.y));
}

const LAND_TARGET: Record<MapSize, [number, number]> = { small: [2000, 3000], standard: [4500, 5600], detailed: [13000, 17000] };

describe('every map', () => {
  for (const region of MAP_REGIONS) {
    for (const size of MAP_SIZES) {
      const version = mapVersionFor(region.id, size.id);
      it(`${version} is sound`, () => {
        const map = getMap(version);
        expect(map.version).toBe(version);
        expect(map.wraps).toBe(region.id === 'world');

        const land = map.terrain.reduce((n, t) => n + (t ? 1 : 0), 0);
        if (version !== 'world-v1') {
          const [lo, hi] = LAND_TARGET[size.id];
          expect(land, 'land tiles').toBeGreaterThanOrEqual(lo);
          expect(land, 'land tiles').toBeLessThanOrEqual(hi);
        }

        const ids = new Set(map.cities.map((c) => c.id));
        expect(ids.size, 'unique city ids').toBe(map.cities.length);
        expect(map.cities.filter((c) => c.capital).length).toBeGreaterThan(0);
        for (const c of map.cities) {
          expect(map.inBounds(c.x, c.y), c.name).toBe(true);
          expect(map.terrainAt(c.x, c.y), c.name).toBe('land');
          if (c.port) expect(map.touchesSea(c.x, c.y), `${c.name} is a port`).toBe(true);
        }
        for (let i = 0; i < map.cities.length; i++) {
          for (let j = i + 1; j < map.cities.length; j++) {
            expect(map.distance(map.cities[i], map.cities[j]), `${map.cities[i].name} / ${map.cities[j].name}`).toBeGreaterThanOrEqual(2);
          }
        }
        // Every port opens on real sea, so a start there can always build and use ships.
        if (version !== 'world-v1') {
          for (const c of map.cities.filter((x) => x.port)) {
            const sizes = map.neighbours(c.x, c.y).filter((n) => map.isSea(n.x, n.y)).map((n) => seaBody(map, n.x, n.y).size);
            expect(Math.max(...sizes), `${c.name}'s sea`).toBeGreaterThanOrEqual(25);
          }
        }
      });
    }
  }
});

describe('starts on every map', () => {
  const rng = () => ({ seed: 12345, counter: 0 });
  for (const region of MAP_REGIONS) {
    for (const size of MAP_SIZES) {
      const version = mapVersionFor(region.id, size.id);
      // The suggested player count must always fit; 6 players is allowed on any size.
      it(`${version} places 6 auto starts`, () => {
        const map = getMap(version);
        const cities = map.cities.map((c) => ({ ...c, owner: null, building: 'tank' as const, progress: 0 }));
        expect(chooseAutoStarts(map, rng(), cities, 6)).toHaveLength(6);
      });
    }
  }
});

describe('regional maps', () => {
  it('have hard edges instead of wrapping', () => {
    const map = getMap('europe-standard-v1');
    expect(map.wrapX(-1)).toBe(-1);
    expect(map.inBounds(-1, 10)).toBe(false);
    expect(map.inBounds(map.cols, 10)).toBe(false);
    expect(map.neighbours(0, 10)).toHaveLength(5);
    expect(map.neighbours(map.cols - 1, 0)).toHaveLength(3);
    expect(map.distance({ x: 0, y: 5 }, { x: map.cols - 1, y: 5 })).toBe(map.cols - 1);
    expect(map.tilesWithin(0, 0, 1)).toHaveLength(4);
  });

  it('refuse moves off the edge', async () => {
    const s = createMatch({ settings: { ...DEFAULT_SETTINGS, map: 'europe', mapSize: 'small' }, players: [{ name: 'A' }, { name: 'B' }], seed: 'edge' });
    const map = getMap(s.mapVersion);
    const fighter = { id: 'f', type: 'fighter' as const, owner: s.activeSeat, x: 0, y: 5, hp: 2, moves: 8 };
    s.units.push(fighter);
    expect(() => applyAction(s, s.activeSeat, { type: 'move', unit: 'f', to: { x: -1, y: 5 } })).toThrow(/off the map/);
    expect(applyAction(s, s.activeSeat, { type: 'move', unit: 'f', to: { x: 1, y: 5 } }).state.units.find((u) => u.id === 'f')).toMatchObject({ x: 1, y: 5 });
    expect(map.version).toBe('europe-small-v1');
  });

  it('keep the important straits open', () => {
    for (const size of ['small', 'standard', 'detailed'] as const) {
      const europe = getMap(mapVersionFor('europe', size));
      expect(sameSea(europe, [18, 35], [-15, 40]), `${europe.version}: Mediterranean to Atlantic`).toBe(true);
      expect(sameSea(europe, [34, 43], [18, 35]), `${europe.version}: Black Sea to Mediterranean`).toBe(true);
      expect(sameSea(europe, [20, 58], [3, 56]), `${europe.version}: Baltic to North Sea`).toBe(true);
      const asia = getMap(mapVersionFor('asia', size));
      expect(sameSea(asia, [34, 43], [30, 34]), `${asia.version}: Black Sea to Mediterranean`).toBe(true);
      expect(sameSea(asia, [52, 26], [60, 20]), `${asia.version}: Persian Gulf to Arabian Sea`).toBe(true);
      const sa = getMap(mapVersionFor('south-america', size));
      expect(sameSea(sa, [-80, 5], [-75, 13]), `${sa.version}: Pacific to Caribbean through Panama`).toBe(true);
      const southAsia = getMap(mapVersionFor('south-asia', size));
      expect(sameSea(southAsia, [65, 15], [88, 15]), `${southAsia.version}: Arabian Sea to Bay of Bengal`).toBe(true);
    }
  });
});

describe('World', () => {
  it('Standard is the original world-v1 map', () => {
    expect(mapVersionFor('world', 'standard')).toBe('world-v1');
    expect(getMap('world-v1')).toBe(WORLD);
  });

  it('lists every map file', () => {
    expect(MAP_VERSIONS).toHaveLength(MAP_REGIONS.length * MAP_SIZES.length);
  });
});

describe('bot matches on every map', () => {
  const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Bot ${i + 1}`, bot: true }));
  for (const region of MAP_REGIONS) {
    for (const size of MAP_SIZES) {
      it(`${mapVersionFor(region.id, size.id)} plays 15 rounds by the rules`, () => {
        let s = createMatch({
          settings: { ...DEFAULT_SETTINGS, map: region.id as MapRegion, mapSize: size.id, production: 'fast' },
          players: bots(size.id === 'small' ? 3 : 5),
          seed: `maps-${region.id}-${size.id}`,
        });
        expect(s.mapVersion).toBe(mapVersionFor(region.id, size.id));
        while (s.phase === 'playing' && s.round <= 15) {
          s = playBotTurn(s, s.activeSeat);
          checkInvariants(s);
        }
        expect(s.cities.filter((c) => c.owner !== null).length).toBeGreaterThan(size.id === 'small' ? 3 : 5);
      });
    }
  }
});
