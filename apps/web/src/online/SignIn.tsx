import { useState } from 'react';
import { NAME_MAX_LENGTH } from '@warfront/shared';
import { Logo } from '../components/Icons';
import { signInAsGuest } from '../net/api';

/** First visit: pick a name and play as a guest; accounts that work across devices come later. */
export function SignIn({ onHotSeat, joining }: { onHotSeat: () => void; joining: boolean }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInAsGuest(name.trim());
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="page pass">
      <form className="pass-card" onSubmit={(e) => (e.preventDefault(), void submit())}>
        <Logo size={40} />
        <h1>MOAB: Warfront</h1>
        <p className="muted">{joining ? 'Pick a name to join the match you were invited to.' : 'Pick a name to play online with friends.'}</p>
        <label className="field" htmlFor="guest-name">
          <span>Your name</span>
          <input id="guest-name" value={name} maxLength={NAME_MAX_LENGTH} autoComplete="nickname" autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        {error && <p className="warn" role="alert">{error}</p>}
        <button type="submit" className="btn primary big wide" disabled={busy || !name.trim()}>{joining ? 'Join as guest' : 'Play as guest'}</button>
        <button type="button" className="btn ghost wide" onClick={onHotSeat}>Play on this device instead</button>
      </form>
    </div>
  );
}
