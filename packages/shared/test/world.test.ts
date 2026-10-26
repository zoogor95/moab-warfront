import { describe, expect, it } from 'vitest';
import { CITY_INFO, COLS, ROWS, TERRAIN, distance, neighbours, terrainAt, wrapX } from '../src';

describe('world map', () => {
  it('is 180 x 90 tiles of 2 degrees', () => {
    expect(COLS).toBe(180);
    expect(ROWS).toBe(90);
    expect(TERRAIN.length).toBe(180 * 90);
  });

  it('has the 134 agreed cities, 87 of them ports', () => {
    expect(CITY_INFO).toHaveLength(134);
    expect(CITY_INFO.filter((c) => c.capital)).toHaveLength(76);
    expect(CITY_INFO.filter((c) => c.port)).toHaveLength(87);
    expect(new Set(CITY_INFO.map((c) => c.id)).size).toBe(134);
  });

  it('puts every city on land and never on neighbouring tiles', () => {
    for (const c of CITY_INFO) expect(terrainAt(c.x, c.y), c.name).toBe('land');
    for (let i = 0; i < CITY_INFO.length; i++) {
      for (let j = i + 1; j < CITY_INFO.length; j++) expect(distance(CITY_INFO[i], CITY_INFO[j])).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps the key straits open', () => {
    const tile = (lon: number, lat: number) => [Math.floor((lon + 180) / 2), Math.floor((90 - lat) / 2)] as const;
    for (const [lon, lat] of [[-5.6, 35.95], [29.0, 41.1], [32.3, 30.5], [43.4, 12.6], [-79.6, 9.1]]) {
      const [x, y] = tile(lon, lat);
      expect(terrainAt(x, y)).toBe('sea');
    }
  });

  it('wraps east to west but not over the poles', () => {
    expect(wrapX(-1)).toBe(179);
    expect(wrapX(180)).toBe(0);
    expect(distance({ x: 0, y: 10 }, { x: 179, y: 10 })).toBe(1);
    expect(neighbours(0, 0)).toHaveLength(5);
    expect(neighbours(0, 45).some((p) => p.x === 179)).toBe(true);
  });

  it('places a few landmarks where they belong', () => {
    const at = (name: string) => CITY_INFO.find((c) => c.name === name)!;
    expect(at('Lisbon').port).toBe(true);
    expect(at('Madrid').port).toBe(false);
    expect(at('Washington').capital).toBe(true);
    expect(distance(at('London'), at('Paris'))).toBe(2);
  });
});
