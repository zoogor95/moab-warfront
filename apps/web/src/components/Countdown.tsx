import { useEffect, useState } from 'react';

function left(deadline: string): number {
  return Math.max(0, Math.ceil((Date.parse(deadline) - Date.now()) / 1000));
}

export function formatSeconds(s: number): string {
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Time left on the turn (or pick) clock, in the header's round style. */
export function Countdown({ deadline, label }: { deadline: string; label: string }) {
  const [secs, setSecs] = useState(() => left(deadline));
  useEffect(() => {
    setSecs(left(deadline));
    const id = window.setInterval(() => setSecs(left(deadline)), 1000);
    return () => window.clearInterval(id);
  }, [deadline]);
  return (
    <div className={`round ${secs <= 10 ? 'urgent' : ''}`} role="timer" aria-label={`${label}: ${formatSeconds(secs)} left`}>
      <small>{label.toUpperCase()}</small>
      <strong aria-hidden="true">{formatSeconds(secs)}</strong>
    </div>
  );
}
