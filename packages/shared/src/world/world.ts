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

/** A map file as written by scripts/build-maps.mjs. */
export interface MapData {
  version: string;
  cols: number;
  rows: number;
  /** Only the whole-Earth maps join east to west; regional maps have hard edges. */
  wraps?: boolean;
  /** Degrees (or Velgard's map units) per tile, and the north-west corner; world-v1 predates both. */
  degreesPerTile?: number;
  bounds?: { west: number; north: number };
  /** Row strings of run-length terrain: s = sea, l = land, m = mountain. */
  rle: string[];
  cities: CityInfo[];
}

/**
 * One map's grid, terrain and cities. Every tile question goes through a map, because
 * matches on different maps run side by side on the same server.
 */
export class GameMap {
  readonly version: string;
  readonly cols: number;
  readonly rows: number;
  readonly wraps: boolean;
  readonly tileCount: number;
  /** 0 = sea, 1 = land, 2 = mountain; indexed by y * cols + x. */
  readonly terrain: Uint8Array;
  readonly cities: readonly CityInfo[];
  private readonly cityByTile: Map<number, CityInfo>;
  private readonly west: number;
  private readonly north: number;
  private readonly degreesPerTile: number;

  constructor(data: MapData) {
    this.version = data.version;
    this.cols = data.cols;
    this.rows = data.rows;
    // world-v1 predates the flag and wraps.
    this.wraps = data.wraps ?? true;
    this.tileCount = data.cols * data.rows;
    this.terrain = decode(data.rle, data.cols, data.rows, data.version);
    this.cities = data.cities;
    this.cityByTile = new Map(data.cities.map((c) => [c.y * data.cols + c.x, c]));
    this.west = data.bounds?.west ?? -180;
    this.north = data.bounds?.north ?? 90;
    this.degreesPerTile = data.degreesPerTile ?? 180 / data.rows;
  }

  /** The tile under a longitude and latitude (Velgard: map units); for tools and tests. */
  tileAt(lon: number, lat: number): Point {
    return { x: Math.floor((lon - this.west) / this.degreesPerTile), y: Math.floor((this.north - lat) / this.degreesPerTile) };
  }

  /** Latitude of a row's centre, for drawing (polar ice); the rules never use it. */
  latitude(y: number): number {
    return this.north - this.degreesPerTile * (y + 0.5);
  }

  /** On a wrapping map, any column folds back onto the grid; elsewhere columns are left as they are. */
  wrapX(x: number): number {
    return this.wraps ? ((x % this.cols) + this.cols) % this.cols : x;
  }

  inBounds(x: number, y: number): boolean {
    return y >= 0 && y < this.rows && (this.wraps || (x >= 0 && x < this.cols));
  }

  /** Callers on non-wrapping maps must check inBounds first. */
  tileIndex(x: number, y: number): number {
    return y * this.cols + this.wrapX(x);
  }

  tilePoint(index: number): Point {
    return { x: index % this.cols, y: Math.floor(index / this.cols) };
  }

  terrainAt(x: number, y: number): Terrain {
    if (!this.inBounds(x, y)) return 'sea';
    const t = this.terrain[this.tileIndex(x, y)];
    return t === 0 ? 'sea' : t === 1 ? 'land' : 'mountain';
  }

  isSea(x: number, y: number): boolean {
    return this.terrainAt(x, y) === 'sea';
  }

  cityInfoAt(x: number, y: number): CityInfo | undefined {
    return this.inBounds(x, y) ? this.cityByTile.get(this.tileIndex(x, y)) : undefined;
  }

  /** Horizontal distance, the short way round on a wrapping map. */
  dx(a: number, b: number): number {
    if (!this.wraps) return Math.abs(a - b);
    const d = Math.abs(this.wrapX(a) - this.wrapX(b));
    return Math.min(d, this.cols - d);
  }

  /** Moves needed between two tiles when diagonal steps cost the same as straight ones. */
  distance(a: Point, b: Point): number {
    return Math.max(this.dx(a.x, b.x), Math.abs(a.y - b.y));
  }

  neighbours(x: number, y: number): Point[] {
    const out: Point[] = [];
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        if (this.inBounds(x + ox, y + oy)) out.push({ x: this.wrapX(x + ox), y: y + oy });
      }
    }
    return out;
  }

  /** Every tile within `radius` moves of (x, y), including the centre. */
  tilesWithin(x: number, y: number, radius: number): number[] {
    const out: number[] = [];
    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) {
        if (this.inBounds(x + ox, y + oy)) out.push(this.tileIndex(x + ox, y + oy));
      }
    }
    return out;
  }

  touchesSea(x: number, y: number): boolean {
    return this.neighbours(x, y).some((p) => this.isSea(p.x, p.y));
  }
}

function decode(rows: string[], cols: number, rowCount: number, version: string): Uint8Array {
  if (rows.length !== rowCount) throw new Error(`${version} has ${rows.length} rows, expected ${rowCount}`);
  const out = new Uint8Array(cols * rowCount);
  const codes: Record<string, number> = { s: 0, l: 1, m: 2 };
  rows.forEach((row, y) => {
    let x = 0;
    for (const m of row.matchAll(/([slm])(\d+)/g)) {
      const n = Number(m[2]);
      out.fill(codes[m[1]], y * cols + x, y * cols + x + n);
      x += n;
    }
    if (x !== cols) throw new Error(`${version} row ${y} decodes to ${x} tiles, expected ${cols}`);
  });
  return out;
}
