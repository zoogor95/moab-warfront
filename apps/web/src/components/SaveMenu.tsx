import { useEffect, useRef, useState } from 'react';
import type { GameState } from '@warfront/shared';
import { defaultSaveName, downloadGame, saveToBrowser } from '../game/saves';

/** The header's Save button and the small panel it opens. */
export function SaveMenu({ game }: { game: GameState }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; good: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', close);
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('pointerdown', close);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      setName(defaultSaveName(game));
      setNote(null);
    }
    setOpen(!open);
  };

  const save = async () => {
    setBusy(true);
    const result = await saveToBrowser(game, name);
    setBusy(false);
    setNote(result.ok ? { text: 'Saved. Load it from the start screen.', good: true } : { text: result.error, good: false });
  };

  return (
    <div className="save-menu" ref={root}>
      <button type="button" className={`btn ghost ${open ? 'on' : ''}`} aria-expanded={open} aria-controls="save-panel" onClick={toggle}>Save</button>
      {open && (
        <div id="save-panel" className="save-panel" role="dialog" aria-label="Save this match">
          <label htmlFor="save-name"><strong>Save this match</strong></label>
          <input id="save-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) void save();
            // Keep typed letters away from the map's shortcuts (E ends the turn).
            if (e.key !== 'Escape') e.stopPropagation();
          }} autoFocus />
          <div className="row">
            <button type="button" className="btn primary" disabled={busy} onClick={save}>Save in this browser</button>
            <button type="button" className="btn" onClick={() => void downloadGame(game, name)}>Download file</button>
          </div>
          <p className="hint">A file keeps the match safe if browser data is cleared, and opens on any device.</p>
          {note && <p className={note.good ? 'good' : 'warn'} role="status">{note.text}</p>}
        </div>
      )}
    </div>
  );
}
