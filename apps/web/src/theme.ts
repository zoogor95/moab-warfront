import { SEAT_STYLES, type Emblem } from '@warfront/shared';

export type { Emblem };

export interface SeatStyle {
  color: string;
  colorName: string;
  emblem: Emblem;
}

/** Seat colours, each paired with an emblem so colour is never the only cue. Shared with the server. */
export const SEATS: readonly SeatStyle[] = SEAT_STYLES.map((s) => ({ color: s.colour, colorName: s.colourName, emblem: s.emblem }));

export const C = {
  ground: '#0D1217',
  bar: '#11171E',
  panel: '#151C24',
  raised: '#1B2430',
  line: '#2A3646',
  text: '#E8EEF4',
  muted: '#9DAAB8',
  faint: '#7F8D9C',
  amber: '#F2A93B',
  amberInk: '#1A1206',
  good: '#3DD68C',
  bad: '#FF6B6B',
  neutral: '#A3AEBA',
  sea: '#0E2A3D',
  shallow: '#133B54',
  land: '#4D6B45',
  mountain: '#6E6551',
  ice: '#8C9DA6',
  dark: '#05080B',
} as const;

export function seatColor(seat: number | null | undefined): string {
  return seat === null || seat === undefined ? C.neutral : SEATS[seat % SEATS.length].color;
}
