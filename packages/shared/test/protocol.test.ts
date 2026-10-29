import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import {
  applyAction,
  botPickStart,
  createMatch,
  DEFAULT_SETTINGS,
  playBotTurn,
  viewFor,
  type Action,
  type GameEvent,
  type GameState,
  type MatchSettings,
  type PlayerView,
} from '../src';
import {
  ActionSchema,
  EventsQuerySchema,
  GameEventSchema,
  JoinMatchBodySchema,
  MatchSettingsPatchSchema,
  MatchSettingsSchema,
  parseClientEvent,
  PlayerViewSchema,
  SERVER_EVENTS,
} from '../src/protocol';

const MATCH_ID = '6f1c2a4e-8b1d-4c3e-9f2a-1b2c3d4e5f60';

/** What crosses the wire: JSON in, JSON out. */
const wire = <T>(v: T): unknown => JSON.parse(JSON.stringify(v));

describe('protocol types', () => {
  it('match the engine exactly for client input', () => {
    expectTypeOf<z.output<typeof ActionSchema>>().toEqualTypeOf<Action>();
    expectTypeOf<z.output<typeof MatchSettingsSchema>>().toEqualTypeOf<MatchSettings>();
  });

  it('give clients data they can use as engine types', () => {
    expectTypeOf<z.output<typeof GameEventSchema>>().toMatchTypeOf<GameEvent>();
    expectTypeOf<z.output<typeof PlayerViewSchema>>().toMatchTypeOf<PlayerView>();
  });
});

describe('actions', () => {
  it('accepts every action type', () => {
    const all: Action[] = [
      { type: 'move', unit: 'u1', to: { x: 86, y: 25 } },
      { type: 'board', unit: 'u1', carrier: 'u2' },
      { type: 'leave', unit: 'u1' },
      { type: 'drop', unit: 'u3', to: { x: 0, y: 0 } },
      { type: 'strike', unit: 'u4', to: { x: 179, y: 89 } },
      { type: 'produce', city: 'mexico-city', unitType: 'carrier' },
      { type: 'sentry', unit: 'u1', on: true },
      { type: 'pickStart', city: 'lisbon' },
      { type: 'endTurn' },
      { type: 'resign' },
    ];
    for (const a of all) expect(ActionSchema.parse(wire(a))).toEqual(a);
  });

  it.each([
    ['an unknown type', { type: 'teleport', unit: 'u1' }],
    ['an extra key', { type: 'endTurn', seat: 1 }],
    ['a tile no map has', { type: 'move', unit: 'u1', to: { x: 1000, y: 0 } }],
    ['a negative tile', { type: 'move', unit: 'u1', to: { x: -1, y: 0 } }],
    ['a fractional tile', { type: 'move', unit: 'u1', to: { x: 1.5, y: 0 } }],
    ['an unknown unit type', { type: 'produce', city: 'lisbon', unitType: 'mech' }],
    ['a malformed id', { type: 'leave', unit: 'U1; DROP TABLE' }],
    ['a missing field', { type: 'board', unit: 'u1' }],
  ])('rejects %s', (_, bad) => {
    expect(ActionSchema.safeParse(bad).success).toBe(false);
  });
});

describe('match settings', () => {
  it('accepts the defaults and every allowed turn limit', () => {
    expect(MatchSettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    for (const t of [60, 90, 120, 180]) {
      expect(MatchSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, turnLimitSeconds: t }).success).toBe(true);
    }
    for (const h of [12, 24, 48, 72]) {
      const s = { ...DEFAULT_SETTINGS, playMode: 'async', turnLimitSeconds: h * 3600 };
      expect(MatchSettingsSchema.safeParse(s).success).toBe(true);
    }
  });

  it('matches the turn limit to the play mode', () => {
    const r = MatchSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, playMode: 'async', turnLimitSeconds: 90 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['turnLimitSeconds']);
    expect(MatchSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, turnLimitSeconds: 86_400 }).success).toBe(false);
  });

  it.each([
    ['1 seat', { seats: 1 }],
    ['7 seats', { seats: 7 }],
    ['holding 30%', { victory: { kind: 'hold', percent: 30 } }],
    ['holding 95%', { victory: { kind: 'hold', percent: 95 } }],
    ['an unknown setting', { fogOfWar: false }],
  ])('rejects %s', (_, change) => {
    expect(MatchSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...change }).success).toBe(false);
  });

  it('takes a partial change but not an empty one', () => {
    expect(MatchSettingsPatchSchema.parse({ privacy: 'public' })).toEqual({ privacy: 'public' });
    expect(MatchSettingsPatchSchema.safeParse({}).success).toBe(false);
    expect(MatchSettingsPatchSchema.safeParse({ seats: 9 }).success).toBe(false);
  });
});

describe('REST inputs', () => {
  it('normalises match codes the way people type them', () => {
    expect(JoinMatchBodySchema.parse({ code: 'k7q-4zp' })).toEqual({ code: 'K7Q4ZP' });
    expect(JoinMatchBodySchema.parse({ code: ' K7Q 4ZP ' })).toEqual({ code: 'K7Q4ZP' });
    expect(JoinMatchBodySchema.safeParse({ code: 'K7Q4Z' }).success).toBe(false);
    expect(JoinMatchBodySchema.safeParse({ code: 'K7Q4ZP!' }).success).toBe(false);
  });

  it('reads the events cursor from a query string', () => {
    expect(EventsQuerySchema.parse({ since: '12' })).toEqual({ since: 12 });
    expect(EventsQuerySchema.safeParse({ since: '-1' }).success).toBe(false);
    expect(EventsQuerySchema.safeParse({ since: 'abc' }).success).toBe(false);
    expect(EventsQuerySchema.safeParse({ since: '1.5' }).success).toBe(false);
  });
});

describe('socket events', () => {
  it('checks client payloads by event name', () => {
    const sub = parseClientEvent('match:subscribe', { matchId: MATCH_ID, lastRev: 0 });
    expect(sub.success && sub.data).toEqual({ matchId: MATCH_ID, lastRev: 0 });
    expect(parseClientEvent('match:subscribe', { matchId: 'nope', lastRev: 0 }).success).toBe(false);

    const submit = { matchId: MATCH_ID, clientActionId: 'a1', expectedRev: 4, action: { type: 'endTurn' } };
    expect(parseClientEvent('action:submit', submit).success).toBe(true);
    expect(parseClientEvent('action:submit', { ...submit, seat: 3 }).success).toBe(false);
  });

  it('trims chat and refuses empty or very long messages', () => {
    const chat = parseClientEvent('chat:message', { matchId: MATCH_ID, text: '  gg  ' });
    expect(chat.success && chat.data.text).toBe('gg');
    expect(parseClientEvent('chat:message', { matchId: MATCH_ID, text: '   ' }).success).toBe(false);
    expect(parseClientEvent('chat:message', { matchId: MATCH_ID, text: 'x'.repeat(501) }).success).toBe(false);
  });

  it('describes action results both ways', () => {
    const ok = { matchId: MATCH_ID, clientActionId: 'a1', ok: true, rev: 5 };
    const refused = { matchId: MATCH_ID, clientActionId: 'a2', ok: false, error: { code: 'stale-rev', message: 'Someone moved first.' } };
    expect(SERVER_EVENTS['action:result'].parse(ok)).toEqual(ok);
    expect(SERVER_EVENTS['action:result'].parse(refused)).toEqual(refused);
    expect(SERVER_EVENTS['action:result'].safeParse({ ...ok, ok: false }).success).toBe(false);
  });
});

describe('player views from real matches', () => {
  const bots = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Bot ${i + 1}`, bot: true }));

  function expectValidViews(s: GameState) {
    for (const p of s.players) {
      const r = PlayerViewSchema.safeParse(wire(viewFor(s, p.seat)));
      if (!r.success) throw new Error(`Seat ${p.seat}, round ${s.round}: ${r.error.message}`);
    }
  }

  it('parses every seat during hidden picks', () => {
    let s = createMatch({ settings: { ...DEFAULT_SETTINGS, startMode: 'pick' }, players: bots(3), seed: 'protocol-pick' });
    expect(s.phase).toBe('picking');
    s = applyAction(s, 0, { type: 'pickStart', city: botPickStart(s, 0) }).state;
    expectValidViews(s);
    expect(PlayerViewSchema.parse(wire(viewFor(s, 0))).picking?.myPick).not.toBeNull();
  });

  it('parses every seat through a long bot match, with every event it logged', () => {
    const settings: MatchSettings = { ...DEFAULT_SETTINGS, production: 'fast', victory: { kind: 'hold', percent: 40 } };
    let s = createMatch({ settings, players: bots(4), seed: 'protocol-long' });
    const seen = new Set<string>();
    while (s.phase === 'playing' && s.round <= 120) {
      s = playBotTurn(s, s.activeSeat);
      if (s.activeSeat === 0) expectValidViews(s);
    }
    expectValidViews(s);
    for (const e of s.log) {
      expect(GameEventSchema.safeParse(wire(e)).success, JSON.stringify(e)).toBe(true);
      seen.add(e.type);
    }
    // Guards against a test that passes only because nothing happened.
    expect([...seen]).toEqual(expect.arrayContaining(['built', 'captured', 'combat']));
  });
});

describe('the engine stays free of runtime dependencies', () => {
  it('imports zod only inside src/protocol', () => {
    const src = join(__dirname, '../src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'protocol') walk(path);
        } else if (/\.ts$/.test(entry.name) && /from ['"](zod|\.\/protocol|\.\.\/protocol)/.test(readFileSync(path, 'utf8'))) {
          offenders.push(path);
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});
