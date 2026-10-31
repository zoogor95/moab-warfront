import { useState } from 'react';
import { MAP_REGIONS, MAP_SIZES, type GameState } from '@warfront/shared';
import { deleteSave, downloadSave, listSaves, openSave, openSaveFile, type Opened, type SaveMeta } from '../game/saves';

function mapName(version: string): string {
  const region = MAP_REGIONS.find((r) => version.startsWith(`${r.id}-`));
  const size = MAP_SIZES.find((s) => version.includes(`-${s.id}-`));
  return region ? `${region.name} ${size?.name ?? 'Standard'}` : version;
}

function when(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

interface Props {
  /** True when a match in progress would be replaced by loading one. */
  replacing: boolean;
  onLoad: (g: GameState) => void;
}

/** Saves kept in this browser, plus opening a downloaded save file. */
export function SavedMatches({ replacing, onLoad }: Props) {
  const [saves, setSaves] = useState<SaveMeta[]>(listSaves);
  const [confirm, setConfirm] = useState<{ id: string; kind: 'load' | 'delete' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = (opened: Opened) => {
    setBusy(false);
    if (opened.ok) onLoad(opened.game);
    else setError(opened.error);
  };

  const load = async (id: string) => {
    setConfirm(null);
    setError(null);
    setBusy(true);
    finish(await openSave(id));
  };

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    finish(await openSaveFile(file));
  };

  const remove = (id: string) => {
    deleteSave(id);
    setConfirm(null);
    setSaves(listSaves());
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Saved matches</h2>
        <label className="btn file-btn">
          Open a save file
          <input type="file" accept=".json,application/json" disabled={busy} onChange={(e) => { void openFile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </div>
      {replacing && <p className="muted">Loading a save replaces the match in progress.</p>}
      {saves.length === 0 ? (
        <p className="muted">No saves in this browser yet. Use Save during a match.</p>
      ) : (
        <ul className="saves">
          {saves.map((s) => (
            <li key={s.id} className="save-item">
              <div>
                <strong>{s.name}</strong>
                <p className="muted">{mapName(s.mapVersion)} · Round {s.round} · {s.players.join(', ')}</p>
                <p className="muted">Saved {when(s.savedAt)}</p>
              </div>
              {confirm?.id === s.id ? (
                <div className="row" role="group" aria-label={confirm.kind === 'load' ? 'Confirm load' : 'Confirm delete'}>
                  <span className="warn">{confirm.kind === 'load' ? 'Replace the match in progress?' : 'Delete this save?'}</span>
                  <button type="button" className="btn primary" onClick={() => (confirm.kind === 'load' ? void load(s.id) : remove(s.id))}>
                    {confirm.kind === 'load' ? 'Load' : 'Delete'}
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirm(null)}>Cancel</button>
                </div>
              ) : (
                <div className="row">
                  <button type="button" className="btn primary" disabled={busy} onClick={() => (replacing ? setConfirm({ id: s.id, kind: 'load' }) : void load(s.id))}>Load</button>
                  <button type="button" className="btn" aria-label={`Download ${s.name}`} onClick={() => downloadSave(s) || setError('This save is no longer in the browser.')}>Download</button>
                  <button type="button" className="btn ghost" aria-label={`Delete ${s.name}`} onClick={() => setConfirm({ id: s.id, kind: 'delete' })}>Delete</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {busy && <p className="muted" role="status">Loading…</p>}
      {error && <p className="warn" role="alert">{error}</p>}
    </section>
  );
}
