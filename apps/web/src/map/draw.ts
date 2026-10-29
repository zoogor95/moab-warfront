import { UNITS, getMap, hexHasBit, type GameMap, type PlayerView, type Point, type ViewUnit } from '@warfront/shared';
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

/** Horizontal offset from the camera; on a wrapping map, to the copy of the tile nearest it. */
function offsetX(map: GameMap, d: number): number {
  return map.wraps ? ((((d + map.cols / 2) % map.cols) + map.cols) % map.cols) - map.cols / 2 : d;
}

export function screenToTile(map: GameMap, cam: Camera, w: number, h: number, sx: number, sy: number): Point | null {
  const x = Math.floor(cam.cx + (sx - w / 2) / cam.t);
  const y = Math.floor(cam.cy + (sy - h / 2) / cam.t);
  if (!map.inBounds(x, y)) return null;
  return { x: map.wrapX(x), y };
}

/** Top-left corner of a tile on screen, using the copy nearest the camera. */
export function tileToScreen(map: GameMap, cam: Camera, w: number, h: number, p: Point): { x: number; y: number } {
  return {
    x: w / 2 + offsetX(map, p.x + 0.5 - cam.cx) * cam.t - cam.t / 2,
    y: h / 2 + (p.y + 0.5 - cam.cy) * cam.t - cam.t / 2,
  };
}

const terrainCache = new Map<string, HTMLCanvasElement>();
function terrain(map: GameMap): HTMLCanvasElement {
  const hit = terrainCache.get(map.version);
  if (hit) return hit;
  const { cols, rows } = map;
  const c = document.createElement('canvas');
  c.width = cols;
  c.height = rows;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(cols, rows);
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const sea = rgb(C.sea), shallow = rgb(C.shallow), land = rgb(C.land), mountain = rgb(C.mountain), ice = rgb(C.ice);
  for (let y = 0; y < rows; y++) {
    const lat = map.latitude(y);
    const polar = lat > 66 || lat < -60;
    for (let x = 0; x < cols; x++) {
      const t = map.terrain[y * cols + x];
      let col = sea;
      if (t === 2) col = mountain;
      else if (t === 1) col = polar ? ice : land;
      else if (map.neighbours(x, y).some((n) => map.terrain[n.y * cols + n.x] !== 0)) col = shallow;
      const o = (y * cols + x) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (terrainCache.size > 3) terrainCache.clear();
  terrainCache.set(map.version, c);
  return c;
}

const maskCache = new Map<string, HTMLCanvasElement>();
/** One pixel per tile: shade where `hex` has no bit set. */
function mask(map: GameMap, hex: string, rgba: [number, number, number, number]): HTMLCanvasElement {
  const key = `${map.version}|${rgba.join(',')}|${hex}`;
  const hit = maskCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = map.cols;
  c.height = map.rows;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(map.cols, map.rows);
  for (let i = 0; i < map.tileCount; i++) {
    if (hexHasBit(hex, i)) continue;
    img.data.set(rgba, i * 4);
  }
  ctx.putImageData(img, 0, 0);
  if (maskCache.size > 8) maskCache.clear();
  maskCache.set(key, c);
  return c;
}

/** Draws a one-pixel-per-tile image; on a wrapping map, once per copy across the screen. */
function drawLayer(ctx: CanvasRenderingContext2D, map: GameMap, img: HTMLCanvasElement, cam: Camera, w: number, h: number) {
  const left = cam.cx - w / 2 / cam.t;
  const top = cam.cy - h / 2 / cam.t;
  const first = map.wraps ? Math.floor(left / map.cols) - 1 : 0;
  const last = map.wraps ? Math.ceil((left + w / cam.t) / map.cols) + 1 : 0;
  for (let k = first; k <= last; k++) {
    ctx.drawImage(img, (k * map.cols - left) * cam.t, -top * cam.t, map.cols * cam.t, map.rows * cam.t);
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
  const map = getMap(view.mapVersion);
  const t = cam.t;
  // Beyond a regional map's edge is darker than open sea, so the edge reads as an edge.
  ctx.fillStyle = map.wraps ? C.sea : C.ground;
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  drawLayer(ctx, map, terrain(map), cam, w, h);
  if (view.phase === 'playing' || view.phase === 'finished') drawLayer(ctx, map, mask(map, view.visible, [3, 7, 11, 133]), cam, w, h);
  if (view.settings.terrain === 'unexplored') drawLayer(ctx, map, mask(map, view.explored, [5, 8, 11, 255]), cam, w, h);
  const toScreen = (p: Point) => tileToScreen(map, cam, w, h, p);

  const left = Math.max(map.wraps ? -Infinity : 0, Math.floor(cam.cx - w / 2 / t) - 1);
  const top = Math.max(0, Math.floor(cam.cy - h / 2 / t) - 1);
  const right = Math.min(map.wraps ? Infinity : map.cols, Math.ceil(cam.cx + w / 2 / t) + 1);
  const bottom = Math.min(map.rows, Math.ceil(cam.cy + h / 2 / t) + 1);
  const onScreen = (p: Point) => {
    const s = toScreen(p);
    return s.x > -2 * t && s.x < w + t && s.y > -2 * t && s.y < h + t;
  };

  if (t >= 14) {
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x0 = Math.round(w / 2 + (left - cam.cx) * t);
    const x1 = Math.round(w / 2 + (right - cam.cx) * t);
    const y0 = Math.round(h / 2 + (top - cam.cy) * t);
    const y1 = Math.round(h / 2 + (bottom - cam.cy) * t);
    for (let x = left; x <= right; x++) {
      const sx = Math.round(w / 2 + (x - cam.cx) * t) + 0.5;
      ctx.moveTo(sx, y0);
      ctx.lineTo(sx, y1);
    }
    for (let y = top; y <= bottom; y++) {
      const sy = Math.round(h / 2 + (y - cam.cy) * t) + 0.5;
      ctx.moveTo(x0, sy);
      ctx.lineTo(x1, sy);
    }
    ctx.stroke();
  }

  if (o.zone) {
    const z = toScreen({ x: o.zone.x - o.zone.radius, y: o.zone.y - o.zone.radius });
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
      const p = map.tilePoint(i);
      if (!onScreen(p)) continue;
      const s = toScreen(p);
      ctx.fillRect(s.x, s.y, t, t);
      ctx.strokeRect(s.x + 0.5, s.y + 0.5, t - 1, t - 1);
    }
  }

  // Cities
  const labels: { x: number; y: number; text: string; color: string }[] = [];
  const hideUnexplored = view.settings.terrain === 'unexplored' && view.phase !== 'picking';
  for (const c of view.cities) {
    if (!onScreen(c)) continue;
    if (hideUnexplored && !hexHasBit(view.explored, map.tileIndex(c.x, c.y))) continue;
    const s = toScreen(c);
    const visible = hexHasBit(view.visible, map.tileIndex(c.x, c.y)) || view.phase === 'picking';
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
    if (o.eligible?.has(map.tileIndex(c.x, c.y))) {
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
        const s = toScreen(p);
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
        if (!o.turnEnds?.has(map.tileIndex(o.path[i].x, o.path[i].y))) continue;
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
    const s = toScreen(seen);
    const top = seen.units[0];
    const count = seen.units.reduce((n, u) => n + u.count, 0);
    drawToken(ctx, { type: top.type, owner: top.owner, hp: UNITS[top.type].hp }, s.x, s.y, t, { ghost: true, count });
  }

  // Units, one token per tile
  const byTile = new Map<number, ViewUnit[]>();
  for (const u of view.units) {
    if (u.carriedBy) continue;
    const i = map.tileIndex(u.x, u.y);
    const list = byTile.get(i);
    if (list) list.push(u);
    else byTile.set(i, [u]);
  }
  for (const [i, list] of byTile) {
    const p = map.tilePoint(i);
    if (!onScreen(p)) continue;
    const s = toScreen(p);
    const shown = list.find((u) => u.id === o.selectedUnit) ?? list.slice().sort((a, b) => (b.moves ?? 0) - (a.moves ?? 0))[0];
    const cargo = view.units.filter((u) => u.carriedBy && list.some((l) => l.id === u.carriedBy)).length;
    const mine = shown.owner === view.seat;
    const idle = mine && list.every((u) => !u.moves || u.sentry);
    drawToken(ctx, shown, s.x, s.y, t, { count: list.length > 1 ? list.length : cargo, dim: idle && view.activeSeat === view.seat });
  }

  // Selection and hover
  const ring = (p: Point, color: string, width: number) => {
    const s = toScreen(p);
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
