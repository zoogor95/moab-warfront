import { useEffect, useRef, useState } from 'react';
import { loadMap, MAP_REGIONS, MAP_SIZES, mapVersionFor, type GameMap, type MapRegion, type MapSize } from '@warfront/shared';
import { terrainImage } from '../map/draw';
import { C } from '../theme';

interface Props {
  region: MapRegion;
  size: MapSize;
}

/** Canvas pixels per tile edge: enough for crisp city dots on the smallest maps. */
function scaleFor(map: GameMap): number {
  return Math.max(2, Math.ceil(720 / map.cols));
}

function draw(canvas: HTMLCanvasElement, map: GameMap) {
  const k = scaleFor(map);
  canvas.width = map.cols * k;
  canvas.height = map.rows * k;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(terrainImage(map), 0, 0, canvas.width, canvas.height);
  // Capitals last, so they sit on top where dots overlap on the small maps.
  const cities = [...map.cities].sort((a, b) => Number(a.capital) - Number(b.capital));
  for (const c of cities) {
    const r = Math.max(2, k * (c.capital ? 1.1 : 0.7));
    ctx.beginPath();
    ctx.arc((c.x + 0.5) * k, (c.y + 0.5) * k, r, 0, Math.PI * 2);
    ctx.fillStyle = c.capital ? C.amber : C.text;
    ctx.fill();
    ctx.lineWidth = Math.max(1, k * 0.3);
    ctx.strokeStyle = C.dark;
    ctx.stroke();
  }
}

function landShare(map: GameMap): number {
  let land = 0;
  for (let i = 0; i < map.tileCount; i++) if (map.terrain[i] !== 0) land++;
  return Math.round((land / map.tileCount) * 100);
}

/** The chosen map and its numbers, so the host sees what each region and size means before starting. */
export function MapPreview({ region, size }: Props) {
  const version = mapVersionFor(region, size);
  const [map, setMap] = useState<GameMap | null>(null);
  const [failed, setFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let current = true;
    setFailed(false);
    loadMap(version).then(
      (m) => current && setMap(m),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [version]);

  const shown = map?.version === version ? map : null;
  useEffect(() => {
    if (shown && canvas.current) draw(canvas.current, shown);
  }, [shown]);

  const name = MAP_REGIONS.find((r) => r.id === region)?.name ?? region;
  const sizeInfo = MAP_SIZES.find((s) => s.id === size) ?? MAP_SIZES[1];
  const capitals = shown?.cities.filter((c) => c.capital).length ?? 0;
  const ports = shown?.cities.filter((c) => c.port).length ?? 0;
  // A degree of latitude is about 111 km; good enough for a scale hint.
  const km = shown ? Math.round((shown.degreesPerTile * 111) / 10) * 10 : null;

  return (
    <figure className="map-preview">
      <div className="map-frame" style={{ aspectRatio: shown ? `${shown.cols} / ${shown.rows}` : '2 / 1' }}>
        {shown ? (
          <canvas
            ref={canvas}
            role="img"
            aria-label={`${name}, ${sizeInfo.name}: ${shown.cities.length} cities, ${capitals} of them capitals.`}
          />
        ) : (
          <span className="muted">{failed ? 'The map did not load. Check your connection.' : 'Loading map…'}</span>
        )}
      </div>
      <figcaption>
        <div className="map-legend" aria-hidden="true">
          <span><i className="dot" />City</span>
          <span><i className="dot capital" />Capital</span>
        </div>
        {shown && (
          <dl className="map-facts">
            <div><dt>Cities</dt><dd>{shown.cities.length}</dd></div>
            <div><dt>Capitals</dt><dd>{capitals}</dd></div>
            <div><dt>Ports</dt><dd>{ports}</dd></div>
            <div><dt>Land</dt><dd>{landShare(shown)}%</dd></div>
            <div><dt>Grid</dt><dd>{shown.cols} × {shown.rows}</dd></div>
            {km !== null && <div><dt>Tile</dt><dd>~{km} km</dd></div>}
            <div><dt>Edges</dt><dd>{shown.wraps ? 'East and west join' : 'Fixed'}</dd></div>
            <div><dt>Suits</dt><dd>{sizeInfo.players}</dd></div>
          </dl>
        )}
      </figcaption>
    </figure>
  );
}
