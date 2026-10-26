import type { UnitType } from '@warfront/shared';
import type { Emblem } from './theme';

/** Original unit silhouettes on a 24 x 24 grid: a filled shape plus round-capped details. */
export const UNIT_ICONS: Record<UnitType, { fill: string; line: string }> = {
  tank: { fill: 'M4.5 10.5h14.5l1.8 3.5h-18z M8.5 6.8h6a1.6 1.6 0 0 1 1.6 1.6v2.1h-9.2v-2.1a1.6 1.6 0 0 1 1.6-1.6z', line: 'M5.8 15.8h12.4a2.2 2.2 0 0 1 0 4.4h-12.4a2.2 2.2 0 0 1 0-4.4z M16.1 8.6H22 M8.4 18h.01 M12 18h.01 M15.6 18h.01' },
  paratrooper: { fill: 'M3 10.2C3 5 7.5 2.4 12 2.4C16.5 2.4 21 5 21 10.2z M10.5 17.6a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0z M10.6 19.4h2.8l0.6 3h-4z', line: 'M3.6 10.2L11 16.4 M20.4 10.2L13 16.4 M12 10.2V15.8' },
  fighter: { fill: 'M12 1.8C12.9 1.8 13.4 3.5 13.4 6V9.6L21.6 14.6V16.6L13.4 14.2V18.4L16.4 20.6V22L12 20.9L7.6 22V20.6L10.6 18.4V14.2L2.4 16.6V14.6L10.6 9.6V6C10.6 3.5 11.1 1.8 12 1.8z', line: '' },
  bomber: { fill: 'M12 2C12.8 2 13.2 3.4 13.2 5.5V9L22.8 11.2V13.4L13.2 12.8V18.6L16.6 20.4V21.8L12 21L7.4 21.8V20.4L10.8 18.6V12.8L1.2 13.4V11.2L10.8 9V5.5C10.8 3.4 11.2 2 12 2z M5.2 9.6h1.6v2.6h-1.6z M8.2 9.2h1.6v2.6h-1.6z M14.2 9.2h1.6v2.6h-1.6z M17.2 9.6h1.6v2.6h-1.6z', line: '' },
  transport: { fill: 'M1.8 14.5H22.2L19.8 19.5H4.6z M16.5 9.5h3.5v5h-3.5z M17.4 6.8h1.7v2.7h-1.7z M3.8 10.6h5v3.9h-5z M9.6 10.6h5v3.9h-5z', line: '' },
  destroyer: { fill: 'M1.5 14.8H22.5L20.2 18.8H5.2z M10 11h5.5v3.8H10z M12 7.2h1.6v3.8H12z M4.6 12.6h3.2v2.2H4.6z', line: 'M5 13.4L1.6 12.4 M13.6 8.2h2.6' },
  submarine: { fill: 'M3.2 13.4H18.8C21.4 13.4 23 14.5 23 15.6C23 16.7 21.4 17.8 18.8 17.8H4.8C3.1 17.8 1.4 16.9 1.4 15.6C1.4 14.3 2.3 13.4 3.2 13.4z M9 9.6h4.4a1 1 0 0 1 1 1v2.8H8v-2.8a1 1 0 0 1 1-1z', line: 'M11.4 9.6V6.2h2.2 M2.4 20.8h3.2 M9.4 20.8h5.2 M18.4 20.8h3.2' },
  battleship: { fill: 'M1 15.2H23L20.8 19.8H4.2z M8.6 11.4h7.6v3.8H8.6z M10.4 8.2h4v3.2h-4z M11.8 5h1.4v3.2h-1.4z M3.2 13h3.6v2.2H3.2z M17.8 13h3.6v2.2h-3.6z', line: 'M3.4 13.9L0.9 12.9 M21.3 13.9L23.2 13.1' },
  carrier: { fill: 'M2.6 15.4H21.4L19.6 19.6H4.6z M1 13h22v2.4H1z M15.4 7.6h3.2v5.4h-3.2z M16.6 5.2h0.9v2.4h-0.9z', line: '' },
};

/** Emblems on a 10 x 10 grid. */
export const EMBLEMS: Record<Emblem, string> = {
  circle: 'M1 5a4 4 0 1 0 8 0a4 4 0 1 0-8 0z',
  triangle: 'M5 0.8L9.4 8.8H0.6z',
  square: 'M1.4 1.4h7.2v7.2H1.4z',
  diamond: 'M5 0.4L9.6 5L5 9.6L0.4 5z',
  hexagon: 'M5 0.6L8.9 2.8V7.2L5 9.4L1.1 7.2V2.8z',
  star: 'M5 0.4L6.35 3.55L9.6 3.85L7.15 6.05L7.85 9.3L5 7.6L2.15 9.3L2.85 6.05L0.4 3.85L3.65 3.55z',
};

/** A city on a 24 x 24 grid. */
export const CITY_GLYPH = 'M3 20V10.5l4.5-3V20z M9.5 20V5l5.5-2v17z M17 20v-8l4.5 2.2V20z';

const cache = new Map<string, Path2D>();
export function path2d(d: string): Path2D {
  let p = cache.get(d);
  if (!p) {
    p = new Path2D(d);
    cache.set(d, p);
  }
  return p;
}
