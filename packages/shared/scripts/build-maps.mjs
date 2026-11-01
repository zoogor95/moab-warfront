#!/usr/bin/env node
// Builds every map in src/world/maps/: terrain on a grid of square lon/lat tiles, plus cities.
//
// Coastlines come from Natural Earth (public domain) via the world-atlas package, unless a map
// brings its own polygons (`land`). Each tile samples 9 points and is land
// when at least 4 of them fall on land. Mountain ranges are approximate lon/lat boxes.
//
// Run with: npm run maps (from the repo root). Pass map versions to build only those:
//   npm run maps -- europe-standard-v1 world-v1

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';
import { MAPS } from './maps.config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const outDir = path.join(here, '..', 'src', 'world', 'maps');

// --- Land polygons, bucketed by 10-degree cell so each lookup tests only nearby shapes -------
function indexPolygons(rawPolys) {
  const polys = rawPolys.map((rings) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of rings[0]) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { rings, minX, minY, maxX, maxY };
  });
  const buckets = new Map();
  const key = (cx, cy) => `${cx},${cy}`;
  for (const p of polys) {
    for (let cx = Math.floor(p.minX / 10); cx <= Math.floor(p.maxX / 10); cx++) {
      for (let cy = Math.floor(p.minY / 10); cy <= Math.floor(p.maxY / 10); cy++) {
        const k = key(cx, cy);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(p);
      }
    }
  }
  const isLandAt = (x, y) => {
    for (const p of buckets.get(key(Math.floor(x / 10), Math.floor(y / 10))) ?? []) {
      if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) continue;
      if (!inRing(x, y, p.rings[0])) continue;
      let hole = false;
      for (let k = 1; k < p.rings.length; k++) if (inRing(x, y, p.rings[k])) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  };
  return (x, y) => isLandAt(x, y) || isLandAt(x + 360, y) || isLandAt(x - 360, y);
}

function inRing(x, y, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

let earthLand;
function naturalEarth() {
  if (earthLand) return earthLand;
  const topology = JSON.parse(fs.readFileSync(require.resolve('world-atlas/land-50m.json'), 'utf8'));
  const land = feature(topology, topology.objects.land);
  const rawPolys = [];
  for (const f of land.features) {
    const g = f.geometry;
    const list = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const raw of list) {
      // Unwrap rings that jump across the antimeridian so they stay continuous.
      rawPolys.push(raw.map((ring) => {
        let off = 0;
        return ring.map(([x, y], i) => {
          if (i > 0) {
            const px = ring[i - 1][0];
            if (x - px < -180) off += 360;
            else if (x - px > 180) off -= 360;
          }
          return [x + off, y];
        });
      }));
    }
  }
  earthLand = indexPolygons(rawPolys);
  return earthLand;
}

// Approximate ranges on Earth, for terrain only: [west, east, south, north].
const EARTH_MOUNTAINS = [
  [-125, -106, 36, 58], // Rockies and the Coast Mountains
  [-114, -104, 38, 50], // Rockies, eastern ranges
  [-78, -68, -18, 6], // Andes, north
  [-73.5, -68, -52, -18], // Andes, south
  [-1, 3, 42, 43.5], // Pyrenees
  [6, 14, 45.6, 47.6], // Alps
  [-7, 2, 30.5, 32.5], // Atlas
  [39, 48, 40.5, 43.8], // Caucasus
  [45, 58, 27.5, 35.5], // Zagros
  [70, 97, 27.5, 36.5], // Himalaya and Karakoram
  [80, 100, 31, 36], // Tibetan Plateau
  [57, 61, 52, 66], // Urals
  [36, 40.5, 6.5, 13.5], // Ethiopian Highlands
  [8, 16, 62, 68], // Scandinavian Mountains
  [66, 76, 36, 40], // Pamir and Hindu Kush
  [75, 95, 41, 45], // Tian Shan
  [86, 100, 46, 50], // Altai
  [23, 26, 45.5, 48], // Carpathians
  [140, 160, 62, 68], // Chersky and Kolyma ranges
  [138, 145, 35, 38], // Japanese Alps
];

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function build(cfg) {
  const isLand = cfg.land ? indexPolygons(cfg.land) : naturalEarth();
  const mountains = cfg.mountains ?? EARTH_MOUNTAINS;
  const [west, east, south, north] = cfg.bounds;
  const deg = cfg.deg ?? fitTileSize(cfg, isLand);
  const COLS = Math.round((east - west) / deg);
  const ROWS = Math.round((north - south) / deg);
  const lonOf = (c) => west + deg * c;
  const latOf = (r) => north - deg * r;

  // --- Rasterize --------------------------------------------------------------
  const grid = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      let n = 0;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        if (isLand(lonOf(c) + (deg * (a + 0.5)) / 3, latOf(r) - (deg * (b + 0.5)) / 3)) n++;
      }
      row.push(n >= 4 ? '#' : '.');
    }
    grid.push(row);
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (grid[r][c] !== '#') continue;
    const x = lonOf(c + 0.5);
    const y = latOf(r + 0.5);
    if (mountains.some(([x0, x1, y0, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) grid[r][c] = '^';
  }

  const inside = (c, r) => r >= 0 && r < ROWS && (cfg.wraps || (c >= 0 && c < COLS));
  const at = (c, r) => (inside(c, r) ? grid[r][(c + COLS) % COLS] : '.');
  const set = (c, r, v) => { if (inside(c, r)) grid[r][(c + COLS) % COLS] = v; };
  const tileOf = (lon, lat) => [Math.floor((lon - west) / deg), Math.floor((north - lat) / deg)];

  // Straits that must stay open to ships: a point, or a line (lon, lat, lon, lat, ...) drawn
  // along the channel.
  for (const s of cfg.straits ?? []) {
    const pts = s.length === 2 ? [s, s] : Array.from({ length: s.length / 2 }, (_, i) => [s[2 * i], s[2 * i + 1]]);
    for (let k = 0; k + 1 < pts.length; k++) {
      const [x0, y0] = pts[k];
      const [x1, y1] = pts[k + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (deg / 3)));
      for (let i = 0; i <= steps; i++) {
        const [c, r] = tileOf(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
        set(c, r, '.');
      }
    }
  }
  // Islands too small to survive sampling that carry a city.
  for (const [lon, lat] of cfg.islands ?? []) { const [c, r] = tileOf(lon, lat); set(c, r, '#'); }

  // --- Cities -----------------------------------------------------------------
  // Capitals first, then the rest in source order (biggest and best known first); a city closer
  // than `spacing` tiles to one already placed is left out, so the capital stays.
  // Rows are [name, country, 'cap' or '', lon, lat, tier]. Tier 1 is on every size of a map,
  // tier 2 joins from standard and tier 3 only on detailed; rows without a tier count as 1.
  const source = cfg.cities
    .flatMap((file) => JSON.parse(fs.readFileSync(path.join(here, 'cities', file), 'utf8')))
    .filter((row) => (row[5] ?? 1) <= (cfg.tier ?? 3));
  const dropped = new Set(cfg.dropped ?? []);
  // Lower tiers first, so a city kept on the small map is never crowded out on a bigger one;
  // within a tier, capitals first.
  const rank = (r) => (r[5] ?? 1) * 2 + (r[2] === 'cap' ? 0 : 1);
  const ordered = cfg.strict ? source : source.map((r, i) => [r, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([r]) => r);
  const spacing = cfg.spacing ?? 2;
  const snapReach = cfg.strict ? 1 : 2;
  const dist = (a, b) => {
    const d = Math.abs(a.x - b.x);
    return Math.max(cfg.wraps ? Math.min(d, COLS - d) : d, Math.abs(a.y - b.y));
  };
  const cities = [];
  const left = [];
  for (const [name, , kind, lon, lat] of ordered) {
    if (dropped.has(name)) continue;
    if (!cfg.wraps && (lon < west || lon >= east || lat <= south || lat > north)) continue;
    let [c, r] = tileOf(lon, lat);
    if (at(c, r) === '.') {
      // Coastal city whose tile centre fell in the sea: snap to the nearest land tile.
      let best = null;
      let bestD = Infinity;
      for (let dr = -snapReach; dr <= snapReach; dr++) for (let dc = -snapReach; dc <= snapReach; dc++) {
        if (at(c + dc, r + dr) === '.' || !inside(c + dc, r + dr)) continue;
        const d = (lonOf(c + dc + 0.5) - lon) ** 2 + (latOf(r + dr + 0.5) - lat) ** 2;
        if (d < bestD) { bestD = d; best = [c + dc, r + dr]; }
      }
      if (best) [c, r] = best;
      else if (cfg.strict) throw new Error(`No land tile near ${name}`);
      // Otherwise the island is too small for this grid: the city keeps one tile of its own.
    }
    const city = { id: slug(name), name, x: (c + COLS) % COLS, y: r, capital: kind === 'cap' };
    const clash = cities.find((o) => dist(o, city) < spacing);
    if (clash) {
      if (cfg.strict) throw new Error(`Cities too close: ${clash.name} / ${name}`);
      left.push(name);
      continue;
    }
    if (cities.some((o) => o.id === city.id)) throw new Error(`${cfg.version}: duplicate city id ${city.id}`);
    set(c, r, '#'); // a city tile is never a mountain or sea
    cities.push(city);
    if (cfg.maxCities && cities.length >= cfg.maxCities) break;
  }

  // A port needs open water: a lake or a single-tile pocket of sea does not count.
  const seaSize = seaComponents(grid, COLS, ROWS, cfg.wraps);
  for (const city of cities) {
    let port = false;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!inside(city.x + dc, city.y + dr) || at(city.x + dc, city.y + dr) !== '.') continue;
      const size = seaSize[city.y + dr][(city.x + dc + COLS) % COLS];
      if (cfg.strict || size >= (cfg.minPortSea ?? 25)) port = true;
    }
    city.port = port;
  }
  // Keep the output order stable and readable: the original world map listed cities as sourced.
  if (!cfg.strict) cities.sort((a, b) => ordered.findIndex((s) => slug(s[0]) === a.id) - ordered.findIndex((s) => slug(s[0]) === b.id));

  // --- Write ------------------------------------------------------------------
  const CODE = { '.': 's', '#': 'l', '^': 'm' };
  const rle = grid.map((row) => {
    let out = '';
    for (let i = 0; i < row.length;) {
      let j = i;
      while (j < row.length && row[j] === row[i]) j++;
      out += CODE[row[i]] + (j - i);
      i = j;
    }
    return out;
  });
  const out = cfg.strict
    ? // world-v1's original layout, kept so its file does not churn.
      { version: cfg.version, source: cfg.source, cols: COLS, rows: ROWS, degreesPerTile: deg, rle, cities }
    : { version: cfg.version, source: cfg.source, cols: COLS, rows: ROWS, wraps: Boolean(cfg.wraps), degreesPerTile: Number(deg.toFixed(4)), bounds: { west, north }, rle, cities };
  const target = path.join(outDir, `${cfg.version}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
  const landTiles = grid.flat().filter((t) => t !== '.').length;
  console.log(
    `${cfg.version.padEnd(28)} ${String(COLS).padStart(3)} x ${String(ROWS).padEnd(3)} @ ${deg.toFixed(3)}°  ${String(landTiles).padStart(5)} land  ` +
      `${String(cities.length).padStart(3)} cities (${cities.filter((c) => c.capital).length} capitals, ${cities.filter((c) => c.port).length} ports)` +
      (left.length ? `  ${left.length} left out for spacing` : ''),
  );
  return { landTiles, cities };
}

/** Sizes of 8-connected bodies of water, per tile (0 on land). */
function seaComponents(grid, COLS, ROWS, wraps) {
  const size = grid.map((row) => row.map(() => 0));
  const seen = grid.map((row) => row.map(() => false));
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (seen[r][c] || grid[r][c] !== '.') continue;
    const members = [[c, r]];
    seen[r][c] = true;
    for (let i = 0; i < members.length; i++) {
      const [mc, mr] = members[i];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const nr = mr + dr;
        let nc = mc + dc;
        if (nr < 0 || nr >= ROWS) continue;
        if (wraps) nc = (nc + COLS) % COLS;
        else if (nc < 0 || nc >= COLS) continue;
        if (seen[nr][nc] || grid[nr][nc] !== '.') continue;
        seen[nr][nc] = true;
        members.push([nc, nr]);
      }
    }
    for (const [mc, mr] of members) size[mr][mc] = members.length;
  }
  return size;
}

/** Tile size that gives about `landTiles` land tiles, from a quick 0.25-degree land survey. */
function fitTileSize(cfg, isLand) {
  const [west, east, south, north] = cfg.bounds;
  const step = 0.25;
  let land = 0;
  for (let y = south + step / 2; y < north; y += step) for (let x = west + step / 2; x < east; x += step) if (isLand(x, y)) land++;
  const landArea = land * step * step;
  return Math.sqrt(landArea / cfg.landTiles);
}

const only = process.argv.slice(2);
const chosen = only.length ? MAPS.filter((m) => only.includes(m.version)) : MAPS;
if (only.length && chosen.length !== only.length) throw new Error(`Unknown map: ${only.filter((v) => !MAPS.some((m) => m.version === v)).join(', ')}`);
for (const cfg of chosen) build(cfg);
