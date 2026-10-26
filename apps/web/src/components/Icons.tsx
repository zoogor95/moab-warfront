import type { UnitType } from '@warfront/shared';
import { EMBLEMS, UNIT_ICONS } from '../icons';
import { C, SEATS } from '../theme';

export function EmblemIcon({ seat, size = 12, color }: { seat: number; size?: number; color?: string }) {
  const s = SEATS[seat % SEATS.length];
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
      <path d={EMBLEMS[s.emblem]} fill={color ?? s.color} />
    </svg>
  );
}

/** A unit token: the owner's colour, the unit's silhouette and the owner's emblem. */
export function UnitToken({ type, seat, size = 40, count }: { type: UnitType; seat: number; size?: number; count?: number }) {
  const icon = UNIT_ICONS[type];
  const badge = Math.max(12, Math.round(size * 0.34));
  return (
    <span className="token" style={{ width: size, height: size, borderRadius: Math.round(size * 0.26), background: SEATS[seat % SEATS.length].color }}>
      <svg width={Math.round(size * 0.76)} height={Math.round(size * 0.76)} viewBox="0 0 24 24" aria-hidden="true">
        <path d={icon.fill} fill={C.ground} />
        {icon.line && <path d={icon.line} fill="none" stroke={C.ground} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
      <span className="token-emblem" style={{ width: badge, height: badge }}>
        <EmblemIcon seat={seat} size={Math.max(8, Math.round(size * 0.22))} />
      </span>
      {count !== undefined && count > 1 && (
        <span className="token-count" style={{ minWidth: badge, height: badge, fontSize: Math.max(9, Math.round(size * 0.22)), borderColor: SEATS[seat % SEATS.length].color }}>
          {count}
        </span>
      )}
    </span>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="10.5" fill="none" stroke={C.amber} strokeWidth="2" />
      <circle cx="14" cy="14" r="3.5" fill={C.amber} />
      <path d="M14 1.5v5M14 21.5v5M1.5 14h5M21.5 14h5" stroke={C.amber} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
