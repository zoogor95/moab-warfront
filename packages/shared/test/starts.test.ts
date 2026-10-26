import { describe, expect, it } from 'vitest';
import { applyAction, createMatch, DEFAULT_SETTINGS, distance, finishPicking, START_SPACING, viewFor } from '../src';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}` }));

describe('auto starts', () => {
  it('gives every player a coastal city, all at least 12 tiles apart', () => {
    for (let n = 2; n <= 6; n++) {
      for (let k = 0; k < 4; k++) {
        const s = createMatch({ settings: DEFAULT_SETTINGS, players: players(n), seed: `auto-${n}-${k}` });
        const starts = s.cities.filter((c) => c.owner !== null);
        expect(starts).toHaveLength(n);
        expect(new Set(starts.map((c) => c.owner)).size).toBe(n);
        for (const c of starts) expect(c.port).toBe(true);
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(distance(starts[i], starts[j])).toBeGreaterThanOrEqual(START_SPACING);
      }
    }
  });

  it('is the same for the same seed and differs between seeds', () => {
    const a = createMatch({ settings: DEFAULT_SETTINGS, players: players(4), seed: 'same' });
    const b = createMatch({ settings: DEFAULT_SETTINGS, players: players(4), seed: 'same' });
    const c = createMatch({ settings: DEFAULT_SETTINGS, players: players(4), seed: 'other' });
    const starts = (s: typeof a) => s.cities.filter((x) => x.owner !== null).map((x) => `${x.owner}:${x.id}`).sort().join();
    expect(starts(a)).toBe(starts(b));
    expect(starts(a)).not.toBe(starts(c));
  });
});

describe('picked starts', () => {
  const pick = { ...DEFAULT_SETTINGS, startMode: 'pick' as const };

  it('keep every pick hidden until turn 1', () => {
    let s = createMatch({ settings: pick, players: players(3), seed: 'p1' });
    expect(s.phase).toBe('picking');
    expect(() => applyAction(s, 0, { type: 'pickStart', city: 'madrid' })).toThrowError(/coastal/);
    s = applyAction(s, 0, { type: 'pickStart', city: 'lisbon' }).state;
    const other = viewFor(s, 1);
    expect(other.picking).toEqual({ myPick: null, picked: [0] });
    expect(JSON.stringify(other)).not.toContain('"lisbon","name":"Lisbon","x":85,"y":25,"capital":true,"port":true,"owner":0');
    expect(other.cities.find((c) => c.id === 'lisbon')!.owner).toBeNull();
    expect(viewFor(s, 0).picking?.myPick).toBe('lisbon');
  });

  it('start the match once everyone has picked, and reveal the starts to all', () => {
    let s = createMatch({ settings: pick, players: players(3), seed: 'p2' });
    s = applyAction(s, 0, { type: 'pickStart', city: 'lisbon' }).state;
    s = applyAction(s, 1, { type: 'pickStart', city: 'tokyo' }).state;
    const r = applyAction(s, 2, { type: 'pickStart', city: 'rio-de-janeiro' });
    expect(r.state).toMatchObject({ phase: 'playing', round: 1, activeSeat: 0 });
    expect(r.state.cities.filter((c) => c.owner !== null).map((c) => [c.id, c.owner])).toEqual(
      expect.arrayContaining([['lisbon', 0], ['tokyo', 1], ['rio-de-janeiro', 2]]),
    );
    const reveal = r.events.find((e) => e.type === 'startsRevealed')!;
    expect(reveal.seenBy).toEqual([0, 1, 2]);
    expect(reveal).toMatchObject({ moved: [] });
  });

  it('let the later seat keep a contested spot and move the other to the best open city', () => {
    let s = createMatch({ settings: pick, players: players(2), seed: 'p3' });
    s = applyAction(s, 0, { type: 'pickStart', city: 'lisbon' }).state;
    const r = applyAction(s, 1, { type: 'pickStart', city: 'rabat' });
    const owner = (id: string) => r.state.cities.find((c) => c.id === id)!.owner;
    expect(owner('rabat')).toBe(1);
    expect(owner('lisbon')).toBeNull();
    const seat0 = r.state.cities.find((c) => c.owner === 0)!;
    expect(seat0.port).toBe(true);
    expect(distance(seat0, r.state.cities.find((c) => c.id === 'rabat')!)).toBeGreaterThanOrEqual(START_SPACING);
    expect(r.events.find((e) => e.type === 'startsRevealed')).toMatchObject({ moved: [0] });
  });

  it('pick for anyone who runs out of time', () => {
    let s = createMatch({ settings: pick, players: players(3), seed: 'p4' });
    s = applyAction(s, 2, { type: 'pickStart', city: 'tokyo' }).state;
    const r = finishPicking(s);
    expect(r.state.phase).toBe('playing');
    const starts = r.state.cities.filter((c) => c.owner !== null);
    expect(starts).toHaveLength(3);
    expect(starts.find((c) => c.owner === 2)!.id).toBe('tokyo');
  });
});
