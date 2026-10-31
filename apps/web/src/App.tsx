import { useState } from 'react';
import { HotSeat } from './HotSeat';
import { Online } from './online/Online';

const KEY = 'warfront.mode.v1';
type Mode = 'online' | 'hotseat';

function savedMode(): Mode {
  try {
    return localStorage.getItem(KEY) === 'hotseat' ? 'hotseat' : 'online';
  } catch {
    return 'online';
  }
}

/** Online play with friends, or hot-seat on one device; the last choice is remembered. */
export function App() {
  const [mode, setMode] = useState<Mode>(() => (new URLSearchParams(location.search).has('join') ? 'online' : savedMode()));
  const choose = (m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem(KEY, m);
    } catch {
      // ignore
    }
  };
  return mode === 'hotseat' ? <HotSeat onExit={() => choose('online')} /> : <Online onHotSeat={() => choose('hotseat')} />;
}
