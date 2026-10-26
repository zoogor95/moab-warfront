export type Emblem = 'circle' | 'triangle' | 'square' | 'diamond' | 'hexagon' | 'star';

export interface SeatStyle {
  color: string;
  colorName: string;
  emblem: Emblem;
}

/** Seat colours, each paired with an emblem so colour is never the only cue. */
export const SEATS: readonly SeatStyle[] = [
  { color: '#4C8DFF', colorName: 'Blue', emblem: 'circle' },
  { color: '#FF8C42', colorName: 'Orange', emblem: 'triangle' },
  { color: '#26C6B0', colorName: 'Teal', emblem: 'square' },
  { color: '#A77BFF', colorName: 'Violet', emblem: 'diamond' },
  { color: '#FF5D8F', colorName: 'Rose', emblem: 'hexagon' },
  { color: '#B8E05A', colorName: 'Lime', emblem: 'star' },
];

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
