/**
 * Deterministic randomness. The generator is a counter hashed with the match seed, so a match
 * replays exactly from its seed and action log. The seed never leaves the server.
 */
export interface RngState {
  seed: number;
  counter: number;
}

/** FNV-1a over the seed string. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A float in [0, 1). Advances the counter. */
export function nextRandom(rng: RngState): number {
  const h = mix((rng.seed ^ Math.imul(rng.counter + 1, 0x9e3779b9)) >>> 0);
  rng.counter += 1;
  return h / 4294967296;
}

export function randomInt(rng: RngState, n: number): number {
  return Math.floor(nextRandom(rng) * n);
}

export function shuffle<T>(rng: RngState, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
