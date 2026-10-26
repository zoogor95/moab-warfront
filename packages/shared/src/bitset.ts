/** Bitsets stored as hex strings so game state stays plain JSON. */

export function bitsToHex(bits: Uint8Array): string {
  let out = '';
  for (const b of bits) out += b.toString(16).padStart(2, '0');
  return out;
}

export function hexToBits(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function emptyBits(size: number, fill = false): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(size / 8));
  if (fill) bytes.fill(0xff);
  return bytes;
}

export function getBit(bits: Uint8Array, i: number): boolean {
  return (bits[i >> 3] & (1 << (i & 7))) !== 0;
}

export function setBit(bits: Uint8Array, i: number): void {
  bits[i >> 3] |= 1 << (i & 7);
}

export function hexHasBit(hex: string, i: number): boolean {
  const byte = parseInt(hex.slice((i >> 3) * 2, (i >> 3) * 2 + 2), 16);
  return (byte & (1 << (i & 7))) !== 0;
}
