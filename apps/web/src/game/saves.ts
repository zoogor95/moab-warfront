import { loadMap, MAP_REGIONS, MAP_SIZES, type GameState } from '@warfront/shared';

// Named saves of hot-seat matches. The index and each save's file sit in separate keys, so listing
// saves never parses whole games. Browser storage can be cleared at any time, which is why every
// save can also be downloaded as a file.

const INDEX_KEY = 'warfront.saves.v1';
const SAVE_KEY = 'warfront.save.v1.';
export const MAX_SAVES = 20;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export interface SaveMeta {
  id: string;
  name: string;
  savedAt: string;
  mapVersion: string;
  round: number;
  players: string[];
}

export type Opened = { ok: true; game: GameState; name: string } | { ok: false; error: string };

// The save format uses zod, so it loads only when someone saves or opens a match.
const protocol = () => import('@warfront/shared/protocol');

export function mapLabel(game: GameState): string {
  const region = MAP_REGIONS.find((r) => r.id === game.settings.map)?.name ?? 'Map';
  const size = MAP_SIZES.find((s) => s.id === game.settings.mapSize)?.name ?? '';
  return `${region} ${size}`.trim();
}

export function defaultSaveName(game: GameState): string {
  return `${mapLabel(game)} · Round ${game.round}`;
}

export function listSaves(): SaveMeta[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]');
    return Array.isArray(list) ? (list as SaveMeta[]).filter((s) => typeof s?.id === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveToBrowser(game: GameState, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const list = listSaves();
  if (list.length >= MAX_SAVES) return { ok: false, error: `You have ${MAX_SAVES} saves. Delete one, or download this match as a file.` };
  const { makeSaveFile } = await protocol();
  const file = makeSaveFile(game, name, new Date().toISOString());
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const meta: SaveMeta = { id, name: file.name, savedAt: file.savedAt, mapVersion: game.mapVersion, round: game.round, players: game.players.map((p) => p.name) };
  try {
    localStorage.setItem(SAVE_KEY + id, JSON.stringify(file));
    localStorage.setItem(INDEX_KEY, JSON.stringify([meta, ...list]));
    return { ok: true };
  } catch {
    try {
      localStorage.removeItem(SAVE_KEY + id);
    } catch {
      // ignore
    }
    return { ok: false, error: 'This browser would not store the save. Download it as a file instead.' };
  }
}

export function deleteSave(id: string): void {
  try {
    localStorage.removeItem(SAVE_KEY + id);
    localStorage.setItem(INDEX_KEY, JSON.stringify(listSaves().filter((s) => s.id !== id)));
  } catch {
    // ignore
  }
}

/** Reads, checks and loads the map for a save, from browser storage or a file's text. */
async function openText(text: string): Promise<Opened> {
  const { readSaveFile, checkSavedGame } = await protocol();
  const read = readSaveFile(text);
  if (!read.ok) return read;
  try {
    await loadMap(read.save.game.mapVersion);
  } catch {
    return { ok: false, error: 'The map did not load. Check your connection and try again.' };
  }
  const problem = checkSavedGame(read.save.game);
  return problem ? { ok: false, error: problem } : { ok: true, game: read.save.game, name: read.save.name };
}

export async function openSave(id: string): Promise<Opened> {
  let text: string | null = null;
  try {
    text = localStorage.getItem(SAVE_KEY + id);
  } catch {
    // handled below
  }
  if (text === null) return { ok: false, error: 'This save is no longer in the browser.' };
  return openText(text);
}

export async function openSaveFile(file: File): Promise<Opened> {
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: 'This file is too large to be a save.' };
  return openText(await file.text());
}

function fileName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `warfront-${slug || 'save'}.json`;
}

function download(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(name);
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadGame(game: GameState, name: string): Promise<void> {
  const { makeSaveFile } = await protocol();
  const file = makeSaveFile(game, name, new Date().toISOString());
  download(JSON.stringify(file), file.name);
}

export function downloadSave(meta: SaveMeta): boolean {
  try {
    const text = localStorage.getItem(SAVE_KEY + meta.id);
    if (text === null) return false;
    download(text, meta.name);
    return true;
  } catch {
    return false;
  }
}
