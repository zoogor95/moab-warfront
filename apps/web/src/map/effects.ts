import { BOMBER_BLAST_RADIUS, getMap, type LoggedEvent, type PlayerView } from '@warfront/shared';
import { EMBLEMS, path2d } from '../icons';
import { C, SEATS, seatColor } from '../theme';
import { tileToScreen, type Camera } from './draw';

// Short map effects for events a player saw: a burst where units were destroyed, a colour sweep
// on a city that changed hands, and the bomber's blast area. They are drawn over the map, which
// already shows the state after the event.

export type EffectKind = 'blast' | 'capture' | 'strike';

export interface Effect {
  kind: EffectKind;
  x: number;
  y: number;
  /** The loser for a blast, the new owner for a capture, the bomber's owner for a strike. */
  seat: number | null;
  /** performance.now() when it starts. */
  start: number;
}

const DURATION: Record<EffectKind, number> = { blast: 800, capture: 1300, strike: 1100 };

export function effectsOf(e: LoggedEvent, view: PlayerView, start: number): Effect[] {
  const city = (id: string) => view.cities.find((c) => c.id === id);
  switch (e.type) {
    case 'combat':
      return [{ kind: 'blast', x: e.x, y: e.y, seat: e.winner === 'attacker' ? e.defender.owner : e.attacker.owner, start }];
    case 'outOfFuel':
      return [{ kind: 'blast', x: e.x, y: e.y, seat: e.unit.owner, start }];
    case 'strike':
      return [{ kind: 'strike', x: e.x, y: e.y, seat: e.by, start }];
    case 'captured':
    case 'captureFailed': {
      const c = city(e.city);
      if (!c) return [];
      return [{ kind: e.type === 'captured' ? 'capture' : 'blast', x: c.x, y: c.y, seat: e.by, start }];
    }
    default:
      return [];
  }
}

export function isPlaying(fx: Effect, now: number): boolean {
  return now - fx.start < DURATION[fx.kind];
}

/** Players who ask their system for less motion get still highlights that fade out. */
export function prefersStill(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const easeOut = (p: number) => 1 - (1 - p) ** 3;

function burst(ctx: CanvasRenderingContext2D, cx: number, cy: number, t: number, p: number, scale = 1) {
  const r = t * scale;
  const fade = 1 - p;
  ctx.globalAlpha = fade * 0.9;
  ctx.fillStyle = C.amber;
  ctx.beginPath();
  ctx.arc(cx, cy, r * (0.25 + 0.5 * easeOut(Math.min(1, p * 2))), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = Math.max(0, 1 - p * 2.5);
  ctx.fillStyle = '#FFF4DC';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.28 * (1 - p), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = fade;
  ctx.strokeStyle = C.bad;
  ctx.lineWidth = Math.max(1.5, t * 0.07);
  ctx.beginPath();
  ctx.arc(cx, cy, r * (0.35 + 0.75 * easeOut(p)), 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = C.amber;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    const d0 = r * (0.3 + 0.6 * easeOut(p));
    const d1 = d0 + r * 0.25 * fade;
    ctx.moveTo(cx + Math.cos(a) * d0, cy + Math.sin(a) * d0);
    ctx.lineTo(cx + Math.cos(a) * d1, cy + Math.sin(a) * d1);
  }
  ctx.stroke();
}

function emblemBadge(ctx: CanvasRenderingContext2D, seat: number, cx: number, cy: number, size: number) {
  ctx.beginPath();
  ctx.roundRect(cx - size / 2, cy - size / 2, size, size, size * 0.25);
  ctx.fillStyle = C.ground;
  ctx.fill();
  ctx.strokeStyle = seatColor(seat);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const g = size * 0.64;
  ctx.save();
  ctx.translate(cx - g / 2, cy - g / 2);
  ctx.scale(g / 10, g / 10);
  ctx.fillStyle = seatColor(seat);
  ctx.fill(path2d(EMBLEMS[SEATS[seat % SEATS.length].emblem]));
  ctx.restore();
}

/** Draws the effects still playing; returns true while any are, so the caller keeps animating. */
export function drawEffects(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cam: Camera,
  view: PlayerView,
  effects: Effect[],
  now: number,
  still: boolean,
): boolean {
  const map = getMap(view.mapVersion);
  const t = cam.t;
  let playing = false;
  for (const fx of effects) {
    const p = (now - fx.start) / DURATION[fx.kind];
    if (p < 0) {
      playing = true;
      continue;
    }
    if (p >= 1) continue;
    playing = true;
    const s = tileToScreen(map, cam, w, h, fx);
    if (s.x < -4 * t || s.x > w + 4 * t || s.y < -4 * t || s.y > h + 4 * t) continue;
    const cx = s.x + t / 2;
    const cy = s.y + t / 2;
    ctx.save();
    if (fx.kind === 'blast') {
      if (still) {
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = C.bad;
        ctx.lineWidth = Math.max(2, t * 0.09);
        ctx.beginPath();
        ctx.roundRect(s.x - 2, s.y - 2, t + 4, t + 4, t * 0.28);
        ctx.stroke();
      } else {
        burst(ctx, cx, cy, t, p);
      }
    } else if (fx.kind === 'strike') {
      const r = BOMBER_BLAST_RADIUS;
      const full = (2 * r + 1) * t;
      const size = still ? full : full * (0.2 + 0.8 * easeOut(Math.min(1, p * 1.6)));
      ctx.globalAlpha = 1 - p;
      ctx.beginPath();
      ctx.roundRect(cx - size / 2, cy - size / 2, size, size, 6);
      ctx.fillStyle = 'rgba(255,107,107,0.22)';
      ctx.fill();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = C.bad;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      if (!still) burst(ctx, cx, cy, t, p, 1.6);
    } else {
      const color = seatColor(fx.seat);
      const sweep = still ? 1 : easeOut(Math.min(1, p * 2.2));
      const fade = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
      ctx.globalAlpha = 0.7 * fade;
      ctx.beginPath();
      ctx.rect(s.x, s.y, t * sweep, t);
      ctx.clip();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(s.x + 1, s.y + 1, t - 2, t - 2, t * 0.24);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, t * 0.08);
      const grow = still ? 0 : t * 0.5 * easeOut(p);
      ctx.beginPath();
      ctx.roundRect(s.x - 2 - grow, s.y - 2 - grow, t + 4 + 2 * grow, t + 4 + 2 * grow, t * 0.3);
      ctx.stroke();
      // The new owner's emblem, so the change never depends on colour alone.
      if (fx.seat !== null) {
        const b = Math.max(16, t * 0.6);
        const rise = still ? 0 : t * 0.3 * easeOut(Math.min(1, p * 2));
        emblemBadge(ctx, fx.seat, cx, s.y - b / 2 - 4 - rise, b);
      }
    }
    ctx.restore();
  }
  return playing;
}
