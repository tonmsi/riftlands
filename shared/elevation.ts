/** Authored coordinates are tile units; elevations are signed, discrete floors. */
export interface ElevationRect { id: string; x: number; y: number; width: number; height: number; }
export interface WorldSurface extends ElevationRect {
  elevation: number;
  /** Replaces the procedural floor in this footprint; suspended surfaces leave it intact. */
  ground?: boolean;
  /** Terrain painted with the material brush; generates an exterior cliff ring. */
  painted?: boolean;
  terrain?: import('./types').TileKind;
  /** Invisible artwork only; support and collision rules stay unchanged. */
  transparent?: boolean;
  /** Suspended decks fade their supported asset instances when viewed from below. Defaults to true. */
  inheritAssetVisuals?: boolean;
}
export interface WorldSolid extends ElevationRect { base: number; top: number; }
export interface WorldStair extends ElevationRect {
  from: number; to: number; axis: 'x' | 'y';
  automatic?: boolean;
  /** Passage keeps existing terrain/asset artwork; omitted preserves legacy stone stairs. */
  appearance?: 'stone' | 'passage';
  /** Whole grid cells including a landing at each end. Legacy rectangles remain valid. */
  tiled?: boolean;
}
export interface ElevationGeometry { surfaces: WorldSurface[]; solids: WorldSolid[]; stairs: WorldStair[]; }
export interface Elevated { elevation?: number; surfaceId?: string; }
export const elevationOf = (p: Elevated): number => p.elevation ?? 0;
export const sameElevation = (a: Elevated, b: Elevated): boolean => elevationOf(a) === elevationOf(b);
export const validElevation = (v: unknown): v is number => Number.isInteger(v) && Number(v) >= -128 && Number(v) <= 127;
export const emptyGeometry = (): ElevationGeometry => ({ surfaces: [], solids: [], stairs: [] });
export const containsRectPoint = (r: ElevationRect, x: number, y: number): boolean => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;
export const rectBounds = (r: ElevationRect) => ({ left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height });

/** Reject malformed geometry at every import/storage boundary, including relative asset floors. */
export function validGeometry(v: unknown): v is ElevationGeometry {
  if (!v || typeof v !== 'object') return false;
  const g = v as ElevationGeometry;
  const rect = (r: ElevationRect) => r && typeof r === 'object' && typeof r.id === 'string'
    && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(r.id)
    && [r.x, r.y, r.width, r.height].every(n => typeof n === 'number' && Number.isFinite(n))
    && Math.abs(r.x) <= 10_000_000 && Math.abs(r.y) <= 10_000_000
    && r.width > 0 && r.height > 0 && r.width <= 100_000 && r.height <= 100_000;
  if (![g.surfaces, g.solids, g.stairs].every(a => Array.isArray(a) && a.length <= 100_000)) return false;
  const all = [...g.surfaces, ...g.solids, ...g.stairs];
  return all.every(rect) && new Set(all.map(r => r.id)).size === all.length
    && g.surfaces.every(s => validElevation(s.elevation) && (s.ground === undefined || typeof s.ground === 'boolean') && (s.painted === undefined || (typeof s.painted === 'boolean' && (!s.painted || s.ground === true))) && (s.terrain === undefined || ['grass', 'path', 'water', 'rock', 'bush', 'mud', 'snow', 'ice'].includes(s.terrain)))
    && g.surfaces.every(s => (s.transparent === undefined || typeof s.transparent === 'boolean') && (s.inheritAssetVisuals === undefined || typeof s.inheritAssetVisuals === 'boolean'))
    && g.solids.every(s => validElevation(s.base) && Number.isInteger(s.top) && s.top > s.base && s.top <= 128)
    && g.stairs.every(s => validElevation(s.from) && validElevation(s.to) && s.from !== s.to && ['x', 'y'].includes(s.axis) && (s.automatic === undefined || typeof s.automatic === 'boolean') && (s.appearance === undefined || ['stone','passage'].includes(s.appearance))
      && (s.tiled === undefined || (typeof s.tiled === 'boolean' && (!s.tiled || ([s.x,s.y,s.width,s.height].every(Number.isInteger) && s.width >= 1 && s.height >= 1 && (s.axis === 'x' ? s.width : s.height) >= 2)))));
}

export function placedGeometry(g: ElevationGeometry, x: number, y: number, elevation: number, prefix: string): ElevationGeometry {
  const place = <T extends ElevationRect>(r: T): T => ({ ...r, id: `${prefix}/${r.id}`, x: r.x + x, y: r.y + y });
  return {
    surfaces: g.surfaces.map(r => ({ ...place(r), elevation: r.elevation + elevation })),
    solids: g.solids.map(r => ({ ...place(r), base: r.base + elevation, top: r.top + elevation })),
    stairs: g.stairs.map(r => ({ ...place(r), from: r.from + elevation, to: r.to + elevation })),
  };
}

/** Subtract support rectangles from a footprint. Remaining rectangles must not touch the circle. */
export function circleSupported(x: number, y: number, radius: number, supports: ElevationRect[]): boolean {
  if (radius === 0) return supports.some(r => containsRectPoint(r, x, y));
  let gaps = [{ x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 }];
  for (const s of supports) {
    gaps = gaps.flatMap(g => {
      const l = Math.max(g.x, s.x), t = Math.max(g.y, s.y);
      const r = Math.min(g.x + g.width, s.x + s.width), b = Math.min(g.y + g.height, s.y + s.height);
      if (l >= r || t >= b) return [g];
      return [
        { x: g.x, y: g.y, width: l - g.x, height: g.height },
        { x: r, y: g.y, width: g.x + g.width - r, height: g.height },
        { x: l, y: g.y, width: r - l, height: t - g.y },
        { x: l, y: b, width: r - l, height: g.y + g.height - b },
      ].filter(a => a.width > 1e-9 && a.height > 1e-9);
    });
    if (!gaps.length) return true;
  }
  return !gaps.some(g => circleTouchesRect(x, y, radius, g));
}
export function circleTouchesRect(x: number, y: number, radius: number, r: Omit<ElevationRect, 'id'>): boolean {
  if (radius === 0) return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
  const dx = x - Math.max(r.x, Math.min(x, r.x + r.width));
  const dy = y - Math.max(r.y, Math.min(y, r.y + r.height));
  return dx * dx + dy * dy < radius * radius - 1e-9;
}

export function subtractRect<T extends Omit<ElevationRect, 'id'>>(r: T, cut: Omit<ElevationRect, 'id'>): T[] {
  const l = Math.max(r.x, cut.x), t = Math.max(r.y, cut.y);
  const right = Math.min(r.x + r.width, cut.x + cut.width), bottom = Math.min(r.y + r.height, cut.y + cut.height);
  if (l >= right || t >= bottom) return [r];
  return [
    { ...r, width: l - r.x }, { ...r, x: right, width: r.x + r.width - right },
    { ...r, x: l, width: right - l, height: t - r.y },
    { ...r, x: l, y: bottom, width: right - l, height: r.y + r.height - bottom },
  ].filter(p => p.width > 1e-9 && p.height > 1e-9);
}
