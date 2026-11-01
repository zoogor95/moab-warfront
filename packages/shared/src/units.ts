export type UnitType =
  | 'tank'
  | 'paratrooper'
  | 'fighter'
  | 'bomber'
  | 'transport'
  | 'destroyer'
  | 'submarine'
  | 'battleship'
  | 'carrier';

export type Domain = 'land' | 'air' | 'sea';

export interface UnitStats {
  name: string;
  domain: Domain;
  moves: number;
  hp: number;
  /** Damage dealt per round won. 0 means the unit can never start a fight. */
  attack: number;
  /** Turns to build at normal production speed. */
  build: number;
  sight: number;
  /** How many units it carries, and of which types. */
  capacity?: { count: number; types: UnitType[] };
}

export const UNIT_TYPES: readonly UnitType[] = [
  'tank', 'paratrooper', 'fighter', 'bomber', 'transport', 'destroyer', 'submarine', 'battleship', 'carrier',
];

export const UNITS: Readonly<Record<UnitType, UnitStats>> = {
  tank: { name: 'Tank', domain: 'land', moves: 2, hp: 1, attack: 1, build: 5, sight: 1 },
  // Flies from your city until it lands, when it becomes a tank; it cannot attack from the air.
  paratrooper: { name: 'Paratrooper', domain: 'air', moves: 8, hp: 1, attack: 0, build: 10, sight: 1 },
  fighter: { name: 'Fighter', domain: 'air', moves: 8, hp: 2, attack: 1, build: 10, sight: 2 },
  bomber: { name: 'Bomber', domain: 'air', moves: 6, hp: 1, attack: 0, build: 20, sight: 2 },
  transport: { name: 'Transport', domain: 'sea', moves: 3, hp: 1, attack: 0, build: 15, sight: 1, capacity: { count: 6, types: ['tank'] } },
  destroyer: { name: 'Destroyer', domain: 'sea', moves: 4, hp: 3, attack: 1, build: 15, sight: 1 },
  submarine: { name: 'Submarine', domain: 'sea', moves: 3, hp: 2, attack: 3, build: 20, sight: 1 },
  battleship: { name: 'Battleship', domain: 'sea', moves: 2, hp: 10, attack: 2, build: 40, sight: 1 },
  carrier: { name: 'Carrier', domain: 'sea', moves: 2, hp: 8, attack: 0, build: 30, sight: 1, capacity: { count: 8, types: ['fighter'] } },
};

export const CITY_SIGHT = 2;
export const BOMBER_BLAST_RADIUS = 2;
/** Attacker's chance to win each round of a fight. */
export const ROUND_WIN = 0.5;
export const ROUND_WIN_VS_CITY = 0.4;
/** Aircraft away from a base with fewer moves left than this are flagged as low on fuel. */
export const LOW_FUEL = 5;
/** Chance a tank or paratrooper takes an enemy city with no land defenders; it is lost otherwise. */
export const CAPTURE_CHANCE = 0.5;
/** Neutral cities always fall to a tank or paratrooper. */
export const NEUTRAL_CAPTURE_CHANCE = 1;
/** Starts must be at least this far apart; with Pick, the later seat keeps a contested spot. */
export const START_SPACING = 12;
export const START_VALUE_RADIUS = 10;

/** Units that capture by moving in. A paratrooper captures by landing instead. */
export function canCapture(type: UnitType): boolean {
  return type === 'tank';
}

export function buildTurns(type: UnitType, fast: boolean): number {
  const t = UNITS[type].build;
  return fast ? Math.ceil(t / 2) : t;
}
