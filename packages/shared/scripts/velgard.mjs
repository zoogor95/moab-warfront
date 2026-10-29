// Velgard: an original fantasy continent, drawn by hand for MOAB: Warfront.
//
// Coordinates are map units laid out like degrees (x east, y north) inside [0, 64] x [0, 48].
// Outlines are rough on purpose: roughen() adds deterministic fractal detail so coasts read as
// natural rather than as straight polygon edges.
//
// Realms: Harrowmark (northern highlands), Brannoch (western hills), Elmarren (old forest),
// Thalmere (the heartland round the Mirrow Sea), Corvesse (eastern coast), Sunmarch (southern
// desert), and the island realms of Wyrne, Kaldmoor and the Shardlands.

export const VELGARD_BOUNDS = [0, 64, 0, 48];

// The mainland, ringed round the Mirrow Sea (its hole), which opens east through the Narrows.
const MAINLAND = [
  // West coast, with the Gulf of Brannoch cutting in between the hills and the forest
  [12, 17], [12, 20], [13.5, 22], [12.5, 25], [15.5, 26.5], [16, 27.5], [12.5, 28], [11, 30],
  [13, 31.5], [12, 34], [14.5, 35.5], [13.5, 38], [16, 39], [17, 40.5], [19, 42],
  // North coast, cut by the Skarfjord and the Kolfjord
  [21, 41], [22.5, 41.5], [23, 40], [24, 40.2], [25, 43], [27, 43.2], [28, 42], [29.5, 42.3],
  [30, 40.5], [31, 40.5], [31.5, 42.8], [34, 42.2], [35, 42.8], [37, 42.6], [38.5, 41.5], [40, 41],
  [41, 42.5], [43, 42],
  // The Corvesse horn and the east coast
  [45, 39.5], [47.5, 38.5], [46.5, 36.5], [47.5, 35], [50, 33.5], [48.5, 31.5], [49, 30], [51, 28],
  [50, 26], [49.5, 24], [50.5, 22], [50, 20.5], [48, 18.5], [49, 15], [47.5, 14], [46, 13],
  // South coast, with the Bay of Ambrakesh and the desert peninsula
  [44.5, 10.5], [42.5, 11.5], [41, 11], [39.5, 9.5], [38, 8], [36, 9.5], [34.5, 10.5], [33, 9],
  [32, 6], [29, 7], [27, 5], [25.5, 6], [24, 7], [23, 4], [21, 2], [19, 3], [18, 6], [19.5, 8.5],
  [18, 10], [17, 12], [15, 13], [14, 16],
];
const MIRROW_SEA = [
  [33, 25], [34, 28], [36, 30], [39, 30], [42, 29], [44, 26], [43, 23], [41, 21], [38, 20], [35, 21], [33, 23],
];
const ISLANDS = [
  // Wyrne, west of the mainland
  [[4, 19], [3, 23], [5, 26], [4, 29], [6, 32], [9, 31], [8, 27], [9, 23], [7, 20]],
  // Kaldmoor, in the frozen north
  [[21, 45.6], [24, 47.6], [29, 47.2], [33, 47.6], [36, 46.6], [34, 45.6], [28, 45.9], [24, 45.5]],
  // The Shardlands
  [[54, 30], [53, 33], [55, 35], [57, 33], [56, 30]],
  [[57, 22], [56, 25], [58, 27], [60, 25], [59, 22]],
  [[55, 14], [54, 17], [56, 19], [58, 17], [57, 14]],
  [[60, 8], [59, 11], [61, 12], [62, 9]],
  // The Cinder Isle, off the southern coast
  [[36, 1], [35, 3], [38, 4], [41, 3], [40, 1]],
];

// Mountains: [west, east, south, north].
export const VELGARD_MOUNTAINS = [
  [17, 19, 18, 34], // the Greyspine, between Elmarren and the heartland
  [24, 34, 38.5, 41], // the Harrow Peaks
  [26, 32, 9, 12], // the Sunwall
  [46, 48, 30, 36], // the Corvesse Downs
  [5, 7, 25, 29], // the Wyrnfells
];

// The Narrows: the Mirrow Sea's only way out to the ocean.
export const VELGARD_STRAITS = [[43.5, 25.2, 50.5, 25.2]];

/** A small deterministic generator, so every build draws the same coast. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Midpoint displacement: each pass splits every edge and nudges the new point sideways. */
function roughen(ring, seed, passes = 6, strength = 0.32) {
  const rand = rng(seed);
  let pts = ring.map(([x, y]) => [x, y]);
  for (let p = 0; p < passes; p++) {
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const off = (rand() - 0.5) * 2 * strength * len;
      next.push([x0, y0], [(x0 + x1) / 2 + (-(y1 - y0) / (len || 1)) * off, (y0 + y1) / 2 + ((x1 - x0) / (len || 1)) * off]);
    }
    pts = next;
  }
  pts.push(pts[0]);
  return pts;
}

/** Polygons in the builder's format: each is [outer ring, ...holes]. */
export const VELGARD_LAND = [
  [roughen(MAINLAND, 11), roughen(MIRROW_SEA, 12)],
  ...ISLANDS.map((ring, i) => [roughen(ring, 100 + i)]),
];
