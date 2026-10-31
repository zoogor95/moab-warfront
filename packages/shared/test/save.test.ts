import { describe, expect, it } from 'vitest';
import { createMatch, DEFAULT_SETTINGS, loadMap, playBotTurn, type GameState } from '../src';
import { checkSavedGame, makeSaveFile, readSaveFile, SAVE_FORMAT } from '../src/protocol';

const SAVED_AT = '2026-10-30T12:00:00.000Z';

function botMatch(map: GameState['settings']['map'] = 'world', mapSize: GameState['settings']['mapSize'] = 'standard', turns = 30): GameState {
  let s = createMatch({ settings: { ...DEFAULT_SETTINGS, map, mapSize, seats: 3 }, players: [0, 1, 2].map((i) => ({ name: `Bot ${i}`, bot: true })), seed: 'save' });
  for (let i = 0; i < turns && s.phase === 'playing'; i++) s = playBotTurn(s, s.activeSeat);
  return s;
}

/** A save as it would be written to disk and read back. */
function roundTrip(game: GameState) {
  return readSaveFile(JSON.stringify(makeSaveFile(game, 'Test save', SAVED_AT)));
}

/** A copy of the game, changed by `edit`, then saved and checked. */
function tampered(game: GameState, edit: (g: GameState) => void): string | null {
  const copy = structuredClone(game);
  edit(copy);
  const read = roundTrip(copy);
  return read.ok ? checkSavedGame(read.save.game) : read.error;
}

describe('save files', () => {
  const game = botMatch();

  it('round-trips a match exactly', () => {
    const read = roundTrip(game);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.save.name).toBe('Test save');
    expect(read.save.savedAt).toBe(SAVED_AT);
    expect(read.save.game).toEqual(game);
    expect(checkSavedGame(read.save.game)).toBeNull();
  });

  it('plays on from a loaded save exactly as the original would', () => {
    const read = roundTrip(game);
    if (!read.ok) throw new Error(read.error);
    let a = game;
    let b = read.save.game;
    for (let i = 0; i < 12; i++) {
      a = playBotTurn(a, a.activeSeat);
      b = playBotTurn(b, b.activeSeat);
    }
    expect(b).toEqual(a);
  });

  it('accepts a save on a regional map once that map is loaded', async () => {
    await loadMap('velgard-small-v1');
    const read = roundTrip(botMatch('velgard', 'small', 9));
    expect(read.ok).toBe(true);
    if (read.ok) expect(checkSavedGame(read.save.game)).toBeNull();
  });

  it('gives an untitled save a name', () => {
    expect(makeSaveFile(game, '   ', SAVED_AT).name).toBe('Saved match');
  });

  it('refuses files that are not saves', () => {
    expect(readSaveFile('not json')).toEqual({ ok: false, error: 'This is not a MOAB: Warfront save file.' });
    expect(readSaveFile('{"hello":1}')).toEqual({ ok: false, error: 'This is not a MOAB: Warfront save file.' });
    expect(readSaveFile('[]').ok).toBe(false);
  });

  it('refuses saves from a newer version of the game', () => {
    const newer = { ...makeSaveFile(game, 'x', SAVED_AT), version: 2 };
    expect(readSaveFile(JSON.stringify(newer))).toEqual({ ok: false, error: 'This save comes from a newer version of the game.' });
  });

  it('refuses damaged saves', () => {
    const damaged = { ok: false, error: 'This save file is damaged.' };
    const file = makeSaveFile(game, 'x', SAVED_AT);
    expect(readSaveFile(JSON.stringify({ ...file, game: { ...game, units: 'none' } }))).toEqual(damaged);
    expect(readSaveFile(JSON.stringify({ ...file, game: { ...game, mapVersion: 'atlantis-v1' } }))).toEqual(damaged);
    expect(readSaveFile(JSON.stringify({ ...file, format: SAVE_FORMAT, savedAt: 'yesterday' }))).toEqual(damaged);
  });

  it('refuses games that do not fit their map or hang together', () => {
    const msg = 'This save file is damaged.';
    expect(game.units.length).toBeGreaterThan(0);
    expect(tampered(game, (g) => (g.units[0].x = 400))).toBe(msg);
    expect(tampered(game, (g) => (g.units[0].owner = 5))).toBe(msg);
    expect(tampered(game, (g) => (g.units[0].hp = 99))).toBe(msg);
    expect(tampered(game, (g) => (g.units[1].id = g.units[0].id))).toBe(msg);
    expect(tampered(game, (g) => (g.units[0].carriedBy = 'nobody'))).toBe(msg);
    expect(tampered(game, (g) => (g.cities[0].y = 90))).toBe(msg);
    expect(tampered(game, (g) => (g.players[0].explored = g.players[0].explored.slice(2)))).toBe(msg);
    expect(tampered(game, (g) => g.players.pop())).toBe(msg);
    expect(tampered(game, (g) => (g.activeSeat = 4))).toBe(msg);
    expect(tampered(game, (g) => (g.picks = { 1: 'atlantis' }))).toBe(msg);
  });
});
