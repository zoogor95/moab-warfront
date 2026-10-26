import { useEffect, useRef, useState } from 'react';
import { ROWS, type PlayerView, type Point } from '@warfront/shared';
import { drawMap, screenToTile, type Camera, type Overlay } from './draw';

interface Props {
  view: PlayerView;
  overlay: Overlay;
  /** Centre the camera here whenever this changes (compared by value). */
  focus?: Point | null;
  initialTile?: number;
  onTileClick?: (p: Point, button: 'primary' | 'secondary') => void;
  onTileHover?: (p: Point | null) => void;
}

const MAX_TILE = 64;

export function MapCanvas({ view, overlay, focus, initialTile = 30, onTileClick, onTileHover }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useRef<Camera>({ cx: focus ? focus.x + 0.5 : 90, cy: focus ? focus.y + 0.5 : 45, t: initialTile });
  const size = useRef({ w: 0, h: 0 });
  const frame = useRef(0);
  const latest = useRef({ view, overlay });
  latest.current = { view, overlay };
  const [, setTick] = useState(0);
  const handlers = useRef({ onTileClick, onTileHover });
  handlers.current = { onTileClick, onTileHover };

  const minTile = () => Math.max(3, size.current.h / ROWS);
  const clamp = () => {
    const c = cam.current;
    const { w, h } = size.current;
    c.t = Math.min(MAX_TILE, Math.max(minTile(), c.t));
    const half = h / 2 / c.t;
    c.cy = ROWS * c.t <= h ? ROWS / 2 : Math.min(ROWS - half, Math.max(half, c.cy));
    c.cx = ((c.cx % 180) + 180) % 180;
    void w;
  };

  const render = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { w, h } = size.current;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMap(ctx, w, h, cam.current, latest.current.view, latest.current.overlay);
    });
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      size.current = { w: r.width, h: r.height };
      clamp();
      render();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(render);

  const focusKey = focus ? `${focus.x},${focus.y}` : '';
  useEffect(() => {
    if (!focus) return;
    cam.current.cx = focus.x + 0.5;
    cam.current.cy = focus.y + 0.5;
    clamp();
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  // Pointer input: drag to pan, pinch or wheel to zoom, tap to click.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, startX: 0, startY: 0, pinch: 0, lastHover: '' });

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const zoomAt = (factor: number, sx: number, sy: number) => {
    const c = cam.current;
    const { w, h } = size.current;
    const before = { x: c.cx + (sx - w / 2) / c.t, y: c.cy + (sy - h / 2) / c.t };
    c.t = Math.min(MAX_TILE, Math.max(minTile(), c.t * factor));
    c.cx = before.x - (sx - w / 2) / c.t;
    c.cy = before.y - (sy - h / 2) / c.t;
    clamp();
    render();
    setTick((n) => n + 1);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const p = local(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) gesture.current = { ...gesture.current, moved: false, startX: p.x, startY: p.y };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.current.moved = true;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    const prev = pointers.current.get(e.pointerId);
    if (!prev) {
      const tile = screenToTile(cam.current, size.current.w, size.current.h, p.x, p.y);
      const key = tile ? `${tile.x},${tile.y}` : '';
      if (key !== gesture.current.lastHover) {
        gesture.current.lastHover = key;
        handlers.current.onTileHover?.(tile);
      }
      return;
    }
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.current.pinch > 0) zoomAt(d / gesture.current.pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      gesture.current.pinch = d;
      return;
    }
    if (!gesture.current.moved && Math.hypot(p.x - gesture.current.startX, p.y - gesture.current.startY) < 6) return;
    gesture.current.moved = true;
    cam.current.cx -= (p.x - prev.x) / cam.current.t;
    cam.current.cy -= (p.y - prev.y) / cam.current.t;
    clamp();
    render();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const had = pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current.pinch = 0;
    if (!had || gesture.current.moved || pointers.current.size > 0) return;
    const p = local(e);
    const tile = screenToTile(cam.current, size.current.w, size.current.h, p.x, p.y);
    if (tile) handlers.current.onTileClick?.(tile, e.button === 2 ? 'secondary' : 'primary');
  };

  return (
    <div ref={wrapRef} className="map">
      <canvas
        ref={canvasRef}
        className="map-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
        onPointerLeave={() => handlers.current.onTileHover?.(null)}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={(e) => {
          const p = local(e);
          zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
        }}
        aria-label="World map"
        role="img"
      />
      <div className="map-zoom">
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.25, size.current.w / 2, size.current.h / 2)}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.25, size.current.w / 2, size.current.h / 2)}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
  );
}
