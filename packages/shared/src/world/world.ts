import data from './world-v1.json';

export type Terrain = 'sea' | 'land' | 'mountain';

export interface CityInfo {
  id: string;
  name: string;
  x: number;
  y: number;
  capital: boolean;
  port: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export const MAP_VERSION: string = data.version;
export const COLS: number = data.cols;
export const ROWS: number = data.rows;
export const TILE_COUNT = COLS * ROWS;

/** 0 = sea, 1 = land, 2 = mountain; indexed by y * COLS + x. */
export const TERRAIN: Uint8Array = decode(data.rle);

export const CITY_INFO: readonly CityInfo[] = data.cities as CityInfo[];

const CITY_BY_TILE = new Map<number, CityInfo>(CITY_INFO.map((c) => [c.y * COLS + c.x, c]));

function decode(rows: string[]): Uint8Array {
  const out = new Uint8Array(COLS * ROWS);
  const codes: Record<string, number> = { s: 0, l: 1, m: 2 };
  rows.forEach((row, y) => {
    let x = 0;
    for (const m of row.matchAll(/([slm])(\d+)/g)) {
      const n = Number(m[2]);
      out.fill(codes[m[1]], y * COLS + x, y * COLS + x + n);
      x += n;
    }
    if (x !== COLS) throw new Error(`World row ${y} decodes to ${x} tiles, expected ${COLS}`);
  });
  return out;
}

/** Columns wrap east to west; rows do not. */
export function wrapX(x: number): number {
  return ((x % COLS) + COLS) % COLS;
}

export function inRows(y: number): boolean {
  return y >= 0 && y < ROWS;
}

export function tileIndex(x: number, y: number): number {
  return y * COLS + wrapX(x);
}

export function tilePoint(index: number): Point {
  return { x: index % COLS, y: Math.floor(index / COLS) };
}

export function terrainAt(x: number, y: number): Terrain {
  if (!inRows(y)) return 'sea';
  const t = TERRAIN[tileIndex(x, y)];
  return t === 0 ? 'sea' : t === 1 ? 'land' : 'mountain';
}

export function isSea(x: number, y: number): boolean {
  return terrainAt(x, y) === 'sea';
}

export function cityInfoAt(x: number, y: number): CityInfo | undefined {
  return inRows(y) ? CITY_BY_TILE.get(tileIndex(x, y)) : undefined;
}

/** Horizontal distance on a map that wraps east to west. */
export function dx(a: number, b: number): number {
  const d = Math.abs(wrapX(a) - wrapX(b));
  return Math.min(d, COLS - d);
}

/** Moves needed between two tiles when diagonal steps cost the same as straight ones. */
export function distance(a: Point, b: Point): number {
  return Math.max(dx(a.x, b.x), Math.abs(a.y - b.y));
}

export function neighbours(x: number, y: number): Point[] {
  const out: Point[] = [];
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (ox === 0 && oy === 0) continue;
      const ny = y + oy;
      if (inRows(ny)) out.push({ x: wrapX(x + ox), y: ny });
    }
  }
  return out;
}

/** Every tile within `radius` moves of (x, y), including the centre. */
export function tilesWithin(x: number, y: number, radius: number): number[] {
  const out: number[] = [];
  for (let oy = -radius; oy <= radius; oy++) {
    const ny = y + oy;
    if (!inRows(ny)) continue;
    for (let ox = -radius; ox <= radius; ox++) out.push(tileIndex(x + ox, ny));
  }
  return out;
}

export function touchesSea(x: number, y: number): boolean {
  return neighbours(x, y).some((p) => isSea(p.x, p.y));
}
