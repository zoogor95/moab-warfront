// Every map the builder makes. Bounds are [west, east, south, north] in degrees.
//
// Sizes aim at a land-tile count; the tile size follows from the region's land area:
//   small ~2,500 land tiles (2–3 players), standard ~5,000 (4–5), detailed ~15,000.
// `spacing` is the closest two cities may be, in tiles; small maps space them wider so the
// same priority-ordered list yields fewer, evenly spread cities.

import { VELGARD_BOUNDS, VELGARD_LAND, VELGARD_MOUNTAINS, VELGARD_STRAITS } from './velgard.mjs';

const NE = 'Natural Earth 1:50m land (public domain), via world-atlas';

const WORLD_STRAITS = [[-5.6, 35.95], [29.0, 41.1], [32.3, 30.5], [43.4, 12.6], [-79.6, 9.1]];

// Narrow water that sampling would close at finer tiles, drawn along each channel's axis.
const STRAITS = {
  gibraltar: [-6.2, 35.95, -5.2, 36.05],
  dover: [1.0, 50.75, 2.0, 51.3],
  oresund: [12.7, 55.5, 12.6, 56.1],
  greatBelt: [10.95, 55.15, 10.85, 55.75],
  // The Dardanelles, the Sea of Marmara and the Bosporus as one channel: at coarse tiles the
  // Marmara closes up and would cut the Black Sea off.
  turkishStraits: [26.15, 40.0, 26.7, 40.42, 27.5, 40.65, 28.5, 40.85, 29.0, 41.02, 29.15, 41.25],
  kerch: [36.6, 45.2, 36.55, 45.5],
  messina: [15.6, 38.15, 15.68, 38.3],
  bonifacio: [9.0, 41.35, 9.4, 41.35],
  suez: [32.55, 29.9, 32.3, 31.3],
  babElMandeb: [43.3, 12.75, 43.5, 12.4],
  hormuz: [56.1, 26.75, 56.6, 26.2],
  singapore: [103.5, 1.15, 104.4, 1.25],
  sunda: [105.75, -5.85, 105.85, -6.15],
  bali: [114.4, -8.05, 114.45, -8.4],
  cook: [174.75, -41.05, 174.3, -41.4],
  tsugaru: [140.4, 41.35, 141.3, 41.55],
  panama: [-79.95, 9.35, -79.5, 8.9],
  juanDeFuca: [-124.7, 48.45, -123.2, 48.2],
  belleIsle: [-57.4, 51.1, -55.8, 51.9],
  magellan: [-68.5, -52.45, -70.4, -52.95, -71.2, -53.4, -72.6, -53.6],
};

/** The three sizes of a regional map. */
function regional(region, bounds, straits, extra = {}) {
  const base = { source: NE, bounds, straits, cities: [`${region}.json`], ...extra };
  return [
    { ...base, version: `${region}-small-v1`, landTiles: 2500, tier: 1, spacing: 3 },
    { ...base, version: `${region}-standard-v1`, landTiles: 5000, tier: 2, spacing: 2 },
    { ...base, version: `${region}-detailed-v1`, landTiles: 15000, tier: 3, spacing: 2 },
  ];
}

export const MAPS = [
  // --- World: wraps east to west, so tile sizes divide 360 and 180 evenly. ---
  {
    version: 'world-small-v1',
    source: NE,
    bounds: [-180, 180, -90, 90],
    wraps: true,
    deg: 3,
    straits: WORLD_STRAITS,
    islands: [[-157.86, 21.31]],
    cities: ['world.json'],
    spacing: 3,
  },
  {
    // The original map. Built exactly as before so saved matches replay unchanged.
    version: 'world-v1',
    source: NE,
    bounds: [-180, 180, -90, 90],
    wraps: true,
    deg: 2,
    strict: true,
    straits: WORLD_STRAITS,
    islands: [[-157.86, 21.31]],
    cities: ['world.json'],
    dropped: ['New York', 'Montreal', 'Miami', 'Seattle', 'Marseille', 'Lahore', 'Kolkata', 'Medan', 'Sydney', 'Amsterdam', 'Abidjan', 'Bengaluru'],
  },
  {
    version: 'world-detailed-v1',
    source: NE,
    bounds: [-180, 180, -90, 90],
    wraps: true,
    deg: 1.125,
    straits: WORLD_STRAITS,
    islands: [[-157.86, 21.31]],
    cities: ['world.json', 'world-extra.json'],
  },

  // Europe to the Urals, with the North African coast, Turkey and the Caucasus.
  ...regional('europe', [-25, 60, 28, 72], [
    STRAITS.gibraltar, STRAITS.dover, STRAITS.oresund, STRAITS.greatBelt, STRAITS.turkishStraits,
    STRAITS.kerch, STRAITS.messina, STRAITS.bonifacio, STRAITS.suez,
  ]),

  // Africa with Arabia, the Levant and the northern shore of the Mediterranean.
  ...regional('africa', [-26, 60, -36, 38], [STRAITS.gibraltar, STRAITS.suez, STRAITS.babElMandeb, STRAITS.hormuz, STRAITS.messina]),

  // All of Asia: the Middle East, Central Asia and Siberia to South, East and Southeast Asia.
  ...regional('asia', [25, 180, -11, 78], [
    STRAITS.turkishStraits, STRAITS.kerch, STRAITS.suez, STRAITS.babElMandeb, STRAITS.hormuz,
    STRAITS.singapore, STRAITS.sunda, STRAITS.bali, STRAITS.tsugaru,
  ]),

  // North America with Central America, the Caribbean and Hawaii.
  ...regional('north-america', [-170, -50, 5, 72], [STRAITS.panama, STRAITS.juanDeFuca, STRAITS.belleIsle]),

  // South America with southern Central America, the southern Caribbean and the Galápagos.
  ...regional('south-america', [-93, -30, -56, 15], [STRAITS.panama, STRAITS.magellan]),

  // ASEAN, Australia, Papua New Guinea and New Zealand, with the South China coast, Taiwan and
  // the nearer Pacific islands.
  ...regional('asean-australia', [92, 180, -48, 29], [STRAITS.singapore, STRAITS.sunda, STRAITS.bali, STRAITS.cook]),

  // Velgard, an original fantasy continent (see velgard.mjs).
  ...regional('velgard', VELGARD_BOUNDS, VELGARD_STRAITS, {
    source: 'Drawn for MOAB: Warfront',
    land: VELGARD_LAND,
    mountains: VELGARD_MOUNTAINS,
  }),
];
