import { TILE_SIZE } from '../../shared/config';

export interface ShoreCurve {
  start: [number, number]; c1: [number, number]; c2: [number, number]; end: [number, number];
  closure: [number, number][];
}

export interface ShoreTile { x: number; y: number; mask: number; variation: number; inset?: number; }
export interface ConnectedShore { x: number; y: number; corner: number; curve: ShoreCurve; }
type Point = [number, number];
const pointKey = (p: Point) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;

/** Join in world space before smoothing, so both sides of a tile seam share position and tangent.
 * Callers include three tiles of halo; the finite filter then gives identical geometry on dirty strips. */
export function connectedShore(tiles: readonly ShoreTile[]): ConnectedShore[] {
  const segments: ConnectedShore[] = [];
  for (const tile of tiles) for (let corner = 0; corner < 4; corner++) {
    const raw = shoreCurve(tile.mask, corner, tile.variation, tile.inset); if (!raw) continue;
    const c = Math.cos(corner * Math.PI / 2), s = Math.sin(corner * Math.PI / 2), h = TILE_SIZE / 2;
    const rotate = ([x, y]: Point): Point => [tile.x * TILE_SIZE + h + (x - h) * c - (y - h) * s,
      tile.y * TILE_SIZE + h + (x - h) * s + (y - h) * c];
    segments.push({ x: tile.x, y: tile.y, corner, curve: { start: rotate(raw.start), c1: rotate(raw.c1),
      c2: rotate(raw.c2), end: rotate(raw.end), closure: raw.closure.map(rotate) } });
  }
  const starts = new Map(segments.map(segment => [pointKey(segment.curve.start), segment]));
  const ends = new Map(segments.map(segment => [pointKey(segment.curve.end), segment]));
  let knots = new Map<string, Point>();
  for (const segment of segments) { knots.set(pointKey(segment.curve.start), segment.curve.start); knots.set(pointKey(segment.curve.end), segment.curve.end); }
  // Keep tiny pools intact instead of shrinking a one-tile water loop.
  const fixed = new Set<string>();
  for (const segment of segments) {
    let next: ConnectedShore | undefined = segment;
    const loop: string[] = [];
    for (let i = 0; next && i < 8; i++) {
      loop.push(pointKey(next.curve.start)); next = starts.get(pointKey(next.curve.end));
      if (next === segment) { for (const key of loop) fixed.add(key); break; }
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const smoothed = new Map<string, Point>();
    for (const [key, point] of knots) {
      const before = ends.get(key), after = starts.get(key);
      if (!before || !after || fixed.has(key)) { smoothed.set(key, point); continue; }
      const a = knots.get(pointKey(before.curve.start))!, b = knots.get(pointKey(after.curve.end))!;
      smoothed.set(key, [point[0] * .6 + (a[0] + b[0]) * .2, point[1] * .6 + (a[1] + b[1]) * .2]);
    }
    knots = smoothed;
  }
  return segments.map(segment => {
    const raw = segment.curve, before = ends.get(pointKey(raw.start)), after = starts.get(pointKey(raw.end));
    const start = knots.get(pointKey(raw.start))!, end = knots.get(pointKey(raw.end))!;
    const previous = before && knots.get(pointKey(before.curve.start))!, next = after && knots.get(pointKey(after.curve.end))!;
    const c1: Point = previous ? [start[0] + (end[0] - previous[0]) / 6, start[1] + (end[1] - previous[1]) / 6] : raw.c1;
    const c2: Point = next ? [end[0] - (next[0] - start[0]) / 6, end[1] - (next[1] - start[1]) / 6] : raw.c2;
    return { ...segment, curve: { ...raw, start, end, c1, c2 } };
  });
}

/** Shared rounded shoreline for bank painting and shoreline object placement. */
export function shoreCurve(mask: number, corner: number, variation: number, inset = 14): ShoreCurve | undefined {
  const north = Boolean(mask & 1 << corner), west = Boolean(mask & 1 << ((corner + 3) % 4));
  const diagonal = Boolean(mask & 1 << (4 + ((corner + 3) % 4)));
  if (!north && !west && !diagonal) return;
  const h = TILE_SIZE / 2, wobble = (variation - .5) * 3;
  const turn = inset + (h - inset) * .448;
  if (north && west) return { start:[inset,h], c1:[inset,turn], c2:[turn,inset], end:[h,inset], closure:[[h,0],[0,0],[0,h]] };
  if (north) return { start:[0,inset], c1:[h*.33,inset+wobble], c2:[h*.67,inset-wobble], end:[h,inset], closure:[[h,0],[0,0]] };
  if (west) return { start:[inset,h], c1:[inset+wobble,h*.67], c2:[inset-wobble,h*.33], end:[inset,0], closure:[[0,0],[0,h]] };
  // A convex land corner joins the adjoining straight banks at their same inset.
  // A larger endpoint here would create detached hooks inside the river.
  const radius = inset;
  return { start:[0,radius], c1:[0,radius*.45], c2:[radius*.45,0], end:[radius,0], closure:[[0,0]] };
}

export function curvePath(curve: ShoreCurve, closed = false): Path2D {
  const p = new Path2D(); p.moveTo(...curve.start); p.bezierCurveTo(...curve.c1,...curve.c2,...curve.end);
  if (closed) { for(const point of curve.closure) p.lineTo(...point); p.closePath(); }
  return p;
}

/** Narrow only near-vertical banks. Horizontal and diagonal banks retain their full width. */
export function shoreBankWidth(dx: number, dy: number): number {
  const vertical = Math.abs(dy) / (Math.hypot(dx, dy) || 1);
  const t = Math.max(0, Math.min(1, (vertical - .88) / .115));
  return 1 - .45 * t * t * (3 - 2 * t);
}

export function sampleShoreCurve(curve: ShoreCurve, t: number): { x: number; y: number; dx: number; dy: number } {
  const u = 1 - t;
  const at = (axis: number) => u*u*u*curve.start[axis] + 3*u*u*t*curve.c1[axis]
    + 3*u*t*t*curve.c2[axis] + t*t*t*curve.end[axis];
  const derivative = (axis: number) => 3*u*u*(curve.c1[axis]-curve.start[axis])
    + 6*u*t*(curve.c2[axis]-curve.c1[axis]) + 3*t*t*(curve.end[axis]-curve.c2[axis]);
  return { x: at(0), y: at(1), dx: derivative(0), dy: derivative(1) };
}

/** A variable-width ribbon follows the shared tangent, including across tile joints. */
export function shoreBankRibbon(curves: readonly ShoreCurve[], width: number, thinVertical = true): Path2D {
  const path = new Path2D();
  for (const curve of curves) {
    const length = Math.hypot(curve.c1[0] - curve.start[0], curve.c1[1] - curve.start[1])
      + Math.hypot(curve.c2[0] - curve.c1[0], curve.c2[1] - curve.c1[1])
      + Math.hypot(curve.end[0] - curve.c2[0], curve.end[1] - curve.c2[1]);
    const steps = Math.max(4, Math.ceil(length / 2));
    const left: Point[] = [], right: Point[] = [];
    for (let i = 0; i <= steps; i++) {
      const { x, y, dx, dy } = sampleShoreCurve(curve, i / steps), norm = Math.hypot(dx,dy) || 1;
      const half = width * (thinVertical ? shoreBankWidth(dx,dy) : 1) / 2, nx = -dy/norm*half, ny = dx/norm*half;
      left.push([x+nx,y+ny]); right.push([x-nx,y-ny]);
    }
    path.moveTo(...left[0]);
    for (const point of left.slice(1)) path.lineTo(...point);
    for (const point of right.reverse()) path.lineTo(...point);
    path.closePath();
  }
  return path;
}

export function shorePoint(curve: ShoreCurve, t: number, corner: number): {x:number;y:number;nx:number;ny:number} {
  const {x,y,dx,dy}=sampleShoreCurve(curve,t),length=Math.hypot(dx,dy)||1;
  let nx=-dy/length,ny=dx/length;
  if(nx*(24-x)+ny*(24-y)<0){nx=-nx;ny=-ny;}
  const angle=corner*Math.PI/2,c=Math.cos(angle),s=Math.sin(angle);
  return {x:24+(x-24)*c-(y-24)*s,y:24+(x-24)*s+(y-24)*c,nx:nx*c-ny*s,ny:nx*s+ny*c};
}
