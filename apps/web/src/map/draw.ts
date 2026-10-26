import { COLS, ROWS, TERRAIN, UNITS, hexHasBit, tileIndex, type PlayerView, type Point, type ViewUnit } from '@warfront/shared';
import { CITY_GLYPH, EMBLEMS, UNIT_ICONS, path2d } from '../icons';
import { C, SEATS, seatColor } from '../theme';

export interface Camera {
  /** Centre of the screen, in tiles. */
  cx: number;
  cy: number;
  /** Tile size in CSS pixels. */
  t: number;
}

export interface Overlay {
  selectedUnit?: string | null;
  selectedTile?: Point | null;
  hover?: Point | null;
  reachable?: Set<number>;
  path?: Point[] | null;
  /** Tiles where the selected unit runs out of moves along the path. */
  turnEnds?: Set<number>;
  eligible?: Set<number>;
  zone?: { x: number; y: number; radius: number; color: string } | null;
  pick?: Point | null;
}

/** Signed horizontal offset on a map that wraps, in the range [-90, 90). */
export function wrapDelta(d: number): number {
  return ((((d + COLS / 2) % COLS) + COLS) % COLS) - COLS / 2;
}

export function screenToTile(cam: Camera, w: number, h: number, sx: number, sy: number): Point | null {
  const x = Math.floor(cam.cx + (sx - w / 2) / cam.t);
  const y = Math.floor(cam.cy + (sy - h / 2) / cam.t);
  if (y < 0 || y >= ROWS) return null;
  return { x: ((x % COLS) + COLS) % COLS, y };
}

/** Top-left corner of a tile on screen, using the copy nearest the camera. */
export function tileToScreen(cam: Camera, w: number, h: number, p: Point): { x: number; y: number } {
  return {
    x: w / 2 + wrapDelta(p.x + 0.5 - cam.cx) * cam.t - cam.t / 2,
    y: h / 2 + (p.y + 0.5 - cam.cy) * cam.t - cam.t / 2,
  };
}

let terrainImage: HTMLCanvasElement | null = null;
function terrain(): HTMLCanvasElement {
  if (terrainImage) return terrainImage;
  const c = document.createElement('canvas');
  c.width = COLS;
  c.height = ROWS;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(COLS, ROWS);
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const sea = rgb(C.sea), shallow = rgb(C.shallow), land = rgb(C.land), mountain = rgb(C.mountain), ice = rgb(C.ice);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = TERRAIN[y * COLS + x];
      let col = sea;
      if (t === 2) col = mountain;
      else if (t === 1) col = y < 12 || y >= 75 ? ice : land;
      else {
        let coast = false;
        for (let dy = -1; dy <= 1 && !coast; dy++) for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy;
          if (ny >= 0 && ny < ROWS && TERRAIN[ny * COLS + ((x + dx + COLS) % COLS)] !== 0) { coast = true; break; }
        }
        if (coast) col = shallow;
      }
      const o = (y * COLS + x) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  terrainImage = c;
  return c;
}

const maskCache = new Map<string, HTMLCanvasElement>();
/** One pixel per tile: shade where `hex` has no bit set. */
function mask(hex: string, rgba: [number, number, number, number]): HTMLCanvasElement {
  const key = `${rgba.join(',')}|${hex}`;
  const hit = maskCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = COLS;
  c.height = ROWS;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(COLS, ROWS);
  for (let i = 0; i < COLS * ROWS; i++) {
    if (hexHasBit(hex, i)) continue;
    img.data.set(rgba, i * 4);
  }
  ctx.putImageData(img, 0, 0);
  if (maskCache.size > 8) maskCache.clear();
  maskCache.set(key, c);
  return c;
}

function drawWrapped(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, cam: Camera, w: number, h: number) {
  const left = cam.cx - w / 2 / cam.t;
  const top = cam.cy - h / 2 / cam.t;
  const first = Math.floor(left / COLS) - 1;
  const last = Math.ceil((left + w / cam.t) / COLS) + 1;
  for (let k = first; k <= last; k++) {
    ctx.drawImage(img, (k * COLS - left) * cam.t, -top * cam.t, COLS * cam.t, ROWS * cam.t);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawIcon(ctx: CanvasRenderingContext2D, type: ViewUnit['type'], cx: number, cy: number, size: number, ink: string) {
  const icon = UNIT_ICONS[type];
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = ink;
  ctx.fill(path2d(icon.fill));
  if (icon.line) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path2d(icon.line));
  }
  ctx.restore();
}

function drawToken(
  ctx: CanvasRenderingContext2D,
  unit: { type: ViewUnit['type']; owner: number; hp: number },
  x: number,
  y: number,
  t: number,
  opts: { count?: number; ghost?: boolean; dim?: boolean },
) {
  const size = t * 0.8;
  const ox = x + (t - size) / 2;
  const oy = y + (t - size) / 2;
  const color = seatColor(unit.owner);
  ctx.save();
  ctx.globalAlpha = opts.ghost ? 0.8 : opts.dim ? 0.62 : 1;
  roundRect(ctx, ox, oy, size, size, size * 0.26);
  if (opts.ghost) {
    ctx.fillStyle = 'rgba(13,18,23,0.6)';
    ctx.fill();
    ctx.setLineDash([3, 2]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(5,8,12,0.85)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  drawIcon(ctx, unit.type, x + t / 2, y + t / 2, size * 0.78, opts.ghost ? color : C.ground);
  const max = UNITS[unit.type].hp;
  if (!opts.ghost && unit.hp < max && t >= 16) {
    const bw = size * 0.72;
    ctx.fillStyle = 'rgba(5,8,12,0.85)';
    ctx.fillRect(x + (t - bw) / 2, oy + size * 0.84, bw, 3);
    ctx.fillStyle = unit.hp / max <= 0.34 ? C.bad : unit.hp / max < 0.67 ? C.amber : C.good;
    ctx.fillRect(x + (t - bw) / 2, oy + size * 0.84, (bw * unit.hp) / max, 3);
  }
  if (t >= 20) {
    const b = Math.max(10, size * 0.34);
    roundRect(ctx, ox - 3, oy + size - b + 3, b, b, 3);
    ctx.fillStyle = C.ground;
    ctx.fill();
    ctx.save();
    ctx.translate(ox - 3 + b * 0.18, oy + size - b + 3 + b * 0.18);
    ctx.scale((b * 0.64) / 10, (b * 0.64) / 10);
    ctx.fillStyle = color;
    ctx.fill(path2d(EMBLEMS[SEATS[unit.owner % SEATS.length].emblem]));
    ctx.restore();
  }
  if (opts.count && opts.count > 1 && t >= 16) {
    const b = Math.max(12, size * 0.38);
    const label = String(opts.count);
    ctx.font = `600 ${Math.round(b * 0.7)}px Barlow, sans-serif`;
    const bw = Math.max(b, ctx.measureText(label).width + 6);
    roundRect(ctx, ox + size - bw + 4, oy - 4, bw, b, b / 2);
    ctx.fillStyle = C.ground;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = C.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, ox + size - bw / 2 + 4, oy - 4 + b / 2 + 0.5);
  }
  ctx.restore();
}

export function drawMap(ctx: CanvasRenderingContext2D, w: number, h: number, cam: Camera, view: PlayerView, o: Overlay) {
  const t = cam.t;
  ctx.fillStyle = C.sea;
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  drawWrapped(ctx, terrain(), cam, w, h);
  if (view.phase === 'playing' || view.phase === 'finished') drawWrapped(ctx, mask(view.visible, [3, 7, 11, 133]), cam, w, h);
  if (view.settings.terrain === 'unexplored') drawWrapped(ctx, mask(view.explored, [5, 8, 11, 255]), cam, w, h);

  const left = Math.floor(cam.cx - w / 2 / t) - 1;
  const top = Math.max(0, Math.floor(cam.cy - h / 2 / t) - 1);
  const right = Math.ceil(cam.cx + w / 2 / t) + 1;
  const bottom = Math.min(ROWS, Math.ceil(cam.cy + h / 2 / t) + 1);
  const onScreen = (p: Point) => {
    const s = tileToScreen(cam, w, h, p);
    return s.x > -2 * t && s.x < w + t && s.y > -2 * t && s.y < h + t;
  };

  if (t >= 14) {
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = left; x <= right; x++) {
      const sx = Math.round(w / 2 + (x - cam.cx) * t) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    for (let y = top; y <= bottom; y++) {
      const sy = Math.round(h / 2 + (y - cam.cy) * t) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.stroke();
  }

  if (o.zone) {
    const z = tileToScreen(cam, w, h, { x: o.zone.x - o.zone.radius, y: o.zone.y - o.zone.radius });
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = o.zone.color;
    ctx.fillStyle = 'rgba(76,141,255,0.10)';
    ctx.lineWidth = 2;
    roundRect(ctx, z.x, z.y, (o.zone.radius * 2 + 1) * t, (o.zone.radius * 2 + 1) * t, 6);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  if (o.reachable) {
    ctx.fillStyle = 'rgba(242,169,59,0.18)';
    ctx.strokeStyle = 'rgba(242,169,59,0.55)';
    ctx.lineWidth = 1;
    for (const i of o.reachable) {
      const p = { x: i % COLS, y: Math.floor(i / COLS) };
      if (!onScreen(p)) continue;
      const s = tileToScreen(cam, w, h, p);
      ctx.fillRect(s.x, s.y, t, t);
      ctx.strokeRect(s.x + 0.5, s.y + 0.5, t - 1, t - 1);
    }
  }

  // Cities
  const labels: { x: number; y: number; text: string; color: string }[] = [];
  const hideUnexplored = view.settings.terrain === 'unexplored' && view.phase !== 'picking';
  for (const c of view.cities) {
    if (!onScreen(c)) continue;
    if (hideUnexplored && !hexHasBit(view.explored, tileIndex(c.x, c.y))) continue;
    const s = tileToScreen(cam, w, h, c);
    const visible = hexHasBit(view.visible, tileIndex(c.x, c.y)) || view.phase === 'picking';
    const color = c.known ? seatColor(c.owner) : C.neutral;
    const pad = Math.max(1, t * 0.05);
    ctx.save();
    ctx.globalAlpha = visible ? 1 : 0.62;
    roundRect(ctx, s.x + pad, s.y + pad, t - 2 * pad, t - 2 * pad, t * 0.24);
    ctx.fillStyle = c.owner === null || !c.known ? 'rgba(163,174,186,0.16)' : `${color}3D`;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, t * 0.06);
    ctx.strokeStyle = color;
    ctx.stroke();
    const g = t * 0.6;
    ctx.translate(s.x + (t - g) / 2, s.y + (t - g) / 2);
    ctx.scale(g / 24, g / 24);
    ctx.fillStyle = color;
    ctx.fill(path2d(CITY_GLYPH));
    ctx.restore();
    if (o.eligible?.has(tileIndex(c.x, c.y))) {
      ctx.beginPath();
      ctx.arc(s.x + t / 2, s.y + t / 2, Math.max(5, t * 0.62), 0, Math.PI * 2);
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (t >= 22) labels.push({ x: s.x + t / 2, y: s.y + t + 11, text: c.name, color: visible ? C.text : C.muted });
  }

  // Path preview
  if (o.path?.length && o.selectedUnit) {
    const u = view.units.find((x) => x.id === o.selectedUnit);
    if (u) {
      const pts = [u, ...o.path].map((p) => {
        const s = tileToScreen(cam, w, h, p);
        return { x: s.x + t / 2, y: s.y + t / 2 };
      });
      ctx.save();
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = Math.max(2, t * 0.08);
      ctx.setLineDash([t * 0.2, t * 0.16]);
      ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 0; i < o.path.length; i++) {
        if (!o.turnEnds?.has(tileIndex(o.path[i].x, o.path[i].y))) continue;
        ctx.beginPath();
        ctx.arc(pts[i + 1].x, pts[i + 1].y, Math.max(3.5, t * 0.14), 0, Math.PI * 2);
        ctx.fillStyle = C.ground;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Last-seen enemies
  for (const seen of view.lastSeen) {
    if (!onScreen(seen)) continue;
    const s = tileToScreen(cam, w, h, seen);
    const top = seen.units[0];
    const count = seen.units.reduce((n, u) => n + u.count, 0);
    drawToken(ctx, { type: top.type, owner: top.owner, hp: UNITS[top.type].hp }, s.x, s.y, t, { ghost: true, count });
  }

  // Units, one token per tile
  const byTile = new Map<number, ViewUnit[]>();
  for (const u of view.units) {
    if (u.carriedBy) continue;
    const i = tileIndex(u.x, u.y);
    const list = byTile.get(i);
    if (list) list.push(u);
    else byTile.set(i, [u]);
  }
  for (const [i, list] of byTile) {
    const p = { x: i % COLS, y: Math.floor(i / COLS) };
    if (!onScreen(p)) continue;
    const s = tileToScreen(cam, w, h, p);
    const shown = list.find((u) => u.id === o.selectedUnit) ?? list.slice().sort((a, b) => (b.moves ?? 0) - (a.moves ?? 0))[0];
    const cargo = view.units.filter((u) => u.carriedBy && list.some((l) => l.id === u.carriedBy)).length;
    const mine = shown.owner === view.seat;
    const idle = mine && list.every((u) => !u.moves || u.sentry);
    drawToken(ctx, shown, s.x, s.y, t, { count: list.length > 1 ? list.length : cargo, dim: idle && view.activeSeat === view.seat });
  }

  // Selection and hover
  const ring = (p: Point, color: string, width: number) => {
    const s = tileToScreen(cam, w, h, p);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    roundRect(ctx, s.x - 1, s.y - 1, t + 2, t + 2, t * 0.28);
    ctx.stroke();
    ctx.restore();
  };
  const sel = o.selectedUnit ? view.units.find((u) => u.id === o.selectedUnit) : null;
  if (sel) ring(sel, C.amber, 2.5);
  else if (o.selectedTile) ring(o.selectedTile, C.amber, 2.5);
  if (o.pick) ring(o.pick, C.text, 2.5);
  if (o.hover && t >= 10) ring(o.hover, 'rgba(232,238,244,0.55)', 1);

  ctx.font = '600 11px Barlow, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const l of labels) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(l.text, l.x, l.y);
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, l.x, l.y);
  }
}
