#!/usr/bin/env node
// Builds src/world/world-v1.json: Earth on a 180 x 90 grid of 2-degree tiles, plus the city list.
//
// Coastlines come from Natural Earth (public domain) via the world-atlas package.
// Each tile samples 9 points; it is land when at least 4 of them fall on land.
// Mountain ranges are approximate lon/lat boxes, for terrain only.
//
// Run with: npm run world (from the repo root)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DEG = 2;
const COLS = 360 / DEG;
const ROWS = 180 / DEG;
const VERSION = 'world-v1';

// --- Land polygons ---------------------------------------------------------
const topology = JSON.parse(fs.readFileSync(require.resolve('world-atlas/land-50m.json'), 'utf8'));
const land = feature(topology, topology.objects.land);
const polys = [];
for (const f of land.features) {
  const g = f.geometry;
  const list = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const raw of list) {
    // Unwrap rings that jump across the antimeridian so they stay continuous.
    const rings = raw.map((ring) => {
      let off = 0;
      return ring.map(([x, y], i) => {
        if (i > 0) {
          const px = ring[i - 1][0];
          if (x - px < -180) off += 360;
          else if (x - px > 180) off -= 360;
        }
        return [x + off, y];
      });
    });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of rings[0]) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    polys.push({ rings, minX, minY, maxX, maxY });
  }
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

function isLandAt(x, y) {
  for (const p of polys) {
    if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) continue;
    if (!inRing(x, y, p.rings[0])) continue;
    let hole = false;
    for (let k = 1; k < p.rings.length; k++) if (inRing(x, y, p.rings[k])) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}
const isLand = (x, y) => isLandAt(x, y) || isLandAt(x + 360, y) || isLandAt(x - 360, y);

// --- Rasterize ---------------------------------------------------------------
const grid = [];
for (let r = 0; r < ROWS; r++) {
  const row = [];
  for (let c = 0; c < COLS; c++) {
    let n = 0;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      const x = -180 + DEG * c + (DEG * (a + 0.5)) / 3;
      const y = 90 - DEG * r - (DEG * (b + 0.5)) / 3;
      if (isLand(x, y)) n++;
    }
    row.push(n >= 4 ? '#' : '.');
  }
  grid.push(row);
}

const MOUNTAINS = [
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
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  if (grid[r][c] !== '#') continue;
  const x = -180 + DEG * (c + 0.5);
  const y = 90 - DEG * (r + 0.5);
  if (MOUNTAINS.some(([x0, x1, y0, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) grid[r][c] = '^';
}

const tileOf = (lon, lat) => [Math.floor((lon + 180) / DEG), Math.floor((90 - lat) / DEG)];
// Straits that must stay open to ships at this resolution.
const STRAITS = [[-5.6, 35.95, 'Gibraltar'], [29.0, 41.1, 'Bosporus'], [32.3, 30.5, 'Suez'], [43.4, 12.6, 'Bab-el-Mandeb'], [-79.6, 9.1, 'Panama']];
for (const [lon, lat] of STRAITS) { const [c, r] = tileOf(lon, lat); grid[r][c] = '.'; }
// Islands too small to survive sampling that carry a city.
const ISLANDS = [[-157.86, 21.31, 'Oahu']];
for (const [lon, lat] of ISLANDS) { const [c, r] = tileOf(lon, lat); grid[r][c] = '#'; }

// --- Cities ------------------------------------------------------------------
// Capitals of the larger countries first, then major population and cultural centres.
// Where a capital and a bigger city would share neighbouring tiles, the capital stays.
const DROPPED = new Set([
  'New York', 'Montreal', 'Miami', 'Seattle', 'Marseille', 'Lahore', 'Kolkata', 'Medan', 'Sydney',
  'Amsterdam', 'Abidjan', 'Bengaluru',
]);
const at = (c, r) => (r < 0 || r >= ROWS ? '.' : grid[r][(c + COLS) % COLS]);
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const source = JSON.parse(fs.readFileSync(path.join(here, 'cities-source.json'), 'utf8'));
const cities = [];
for (const [name, , kind, lon, lat] of source) {
  if (DROPPED.has(name)) continue;
  let [c, r] = tileOf(lon, lat);
  if (at(c, r) === '.') {
    // Coastal city whose tile centre fell in the sea: snap to the nearest land neighbour.
    let best = null;
    let bestD = Infinity;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (at(c + dc, r + dr) === '.') continue;
      const cx = -180 + DEG * (c + dc + 0.5);
      const cy = 90 - DEG * (r + dr + 0.5);
      const d = (cx - lon) ** 2 + (cy - lat) ** 2;
      if (d < bestD) { bestD = d; best = [c + dc, r + dr]; }
    }
    if (!best) throw new Error(`No land tile near ${name}`);
    [c, r] = best;
  }
  grid[r][(c + COLS) % COLS] = '#'; // a city tile is never a mountain
  cities.push({ id: slug(name), name, x: (c + COLS) % COLS, y: r, capital: kind === 'cap' });
}
for (const city of cities) {
  let port = false;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (at(city.x + dc, city.y + dr) === '.') port = true;
  city.port = port;
}

// Sanity checks.
const ids = new Set(cities.map((c) => c.id));
if (ids.size !== cities.length) throw new Error('Duplicate city ids');
for (let i = 0; i < cities.length; i++) for (let j = i + 1; j < cities.length; j++) {
  const a = cities[i], b = cities[j];
  const dx = Math.min(Math.abs(a.x - b.x), COLS - Math.abs(a.x - b.x));
  if (Math.max(dx, Math.abs(a.y - b.y)) < 2) throw new Error(`Cities too close: ${a.name} / ${b.name}`);
}

// --- Write -------------------------------------------------------------------
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
const out = {
  version: VERSION,
  source: 'Natural Earth 1:50m land (public domain), via world-atlas',
  cols: COLS,
  rows: ROWS,
  degreesPerTile: DEG,
  rle,
  cities,
};
const target = path.join(here, '..', 'src', 'world', `${VERSION}.json`);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
const landTiles = grid.flat().filter((t) => t !== '.').length;
console.log(`${VERSION}: ${COLS} x ${ROWS}, ${landTiles} land tiles, ${cities.length} cities (${cities.filter((c) => c.capital).length} capitals, ${cities.filter((c) => c.port).length} ports) -> ${path.relative(process.cwd(), target)}`);
