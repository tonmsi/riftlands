import { TILE_SIZE } from './tile-size';
import type { Vec2 } from './types';
import { BASE_SURFACE, type SurfaceCell, type SurfaceEndpoint, type SurfaceLink, type SurfaceStair, surfaceKey } from './world-surfaces';
import { stairGeometry, stairLinks, stairSurfaceId } from './surface-stairs';

export interface StairBodyBounds { left: number; top: number; right: number; bottom: number; }
/** A horizontal slice of the solid body uses the very same continuous foot profile. */
export interface StairVolume {
  readonly id: string;
  readonly bounds: StairBodyBounds;
  readonly low: SurfaceStair['from'];
  readonly high: SurfaceStair['to'];
  readonly stair?: SurfaceStair;
  readonly legacy?: SurfaceLink;
  progressAt(point: Pick<Vec2, 'x' | 'y'>): number;
  contains(point: Pick<Vec2, 'x' | 'y'>, radius?: number): boolean;
  elevationAt(point: Pick<Vec2, 'x' | 'y'>): number;
  boundsAt(elevation: number): StairBodyBounds | undefined;
  followsSupport(point: Vec2, surface: SurfaceCell | undefined): boolean;
}

const EPSILON = 1e-8;
const BUCKET_SIZE = TILE_SIZE * 4;
const edgeKey = (a: SurfaceEndpoint, b: SurfaceEndpoint): string => [surfaceKey(a.x, a.y, a.surfaceId), surfaceKey(b.x, b.y, b.surfaceId)].sort().join('|');
function volume(stair: SurfaceStair, legacy?: SurfaceLink): StairVolume {
  const g = stairGeometry(stair), start = g.pointAt(0), end = g.pointAt(1);
  const rect = (distance: number): StairBodyBounds => {
    const a = { x: start.x + g.dx * distance, y: start.y + g.dy * distance };
    return { left: Math.min(a.x, end.x) - Math.abs(g.dy) * stair.width / 2,
      right: Math.max(a.x, end.x) + Math.abs(g.dy) * stair.width / 2,
      top: Math.min(a.y, end.y) - Math.abs(g.dx) * stair.width / 2,
      bottom: Math.max(a.y, end.y) + Math.abs(g.dx) * stair.width / 2 };
  };
  const inverseProfile = (elevation: number): number => {
    const fraction = (elevation - g.low.elevation) / (g.high.elevation - g.low.elevation);
    if (!legacy) return g.landing + fraction * (g.run - 2 * g.landing);
    // Analytic inverse of smoothstep keeps historical connectors cheap in movement queries.
    return (.5 + Math.sin(Math.asin(2 * Math.max(0, Math.min(1, fraction)) - 1) / 3)) * g.run;
  };
  return { id: legacy?.id ?? stair.id, bounds: rect(0), low: g.low, high: g.high,
    ...(legacy ? { legacy } : { stair }), progressAt: g.progressAt, contains: g.contains,
    elevationAt(point) {
      const t = Math.max(0, Math.min(1, g.progressAt(point)));
      return legacy ? g.low.elevation + (g.high.elevation - g.low.elevation) * t * t * (3 - 2 * t) : g.elevationAt(t);
    },
    boundsAt(elevation) {
      if (elevation >= g.high.elevation - EPSILON) return undefined;
      return rect(elevation < g.low.elevation - EPSILON ? 0 : inverseProfile(Math.max(elevation, g.low.elevation)));
    },
    followsSupport(point, surface) {
      const id = point.surfaceId ?? BASE_SURFACE;
      if (!legacy && id === stairSurfaceId(stair)) return true;
      if (g.lateralAt(point) > stair.width / 2 + EPSILON) return false;
      const tx = Math.floor(point.x / TILE_SIZE), ty = Math.floor(point.y / TILE_SIZE);
      return [stair.from, stair.to].some(p => id === p.surfaceId && surface?.elevation === p.elevation
        && (legacy ? tx === p.x && ty === p.y : g.dx ? tx === p.x : ty === p.y));
    } };
}

/** Local spatial buckets include short connectors as well as authored multi-cell structures. */
export class StairVolumeIndex {
  private readonly buckets = new Map<string, StairVolume[]>();
  readonly volumes: readonly StairVolume[];
  constructor(stairs: readonly SurfaceStair[], links: readonly SurfaceLink[], lookup: (p: SurfaceEndpoint) => SurfaceCell | undefined) {
    const owned = new Set(stairs.flatMap(stair => stairLinks(stair).map(link => edgeKey(link.from, link.to))));
    const bodies = stairs.filter(stair => !stair.underpass).map(stair => volume(stair));
    for (const link of links) {
      if (link.kind === 'bridge-entry' || owned.has(edgeKey(link.from, link.to))) continue;
      const from = lookup(link.from), to = lookup(link.to);
      if (!from || !to || from.elevation === to.elevation) continue;
      bodies.push(volume({ id: link.id, kind: link.kind, from: { ...link.from, elevation: from.elevation },
        to: { ...link.to, elevation: to.elevation }, width: TILE_SIZE }, link));
    }
    this.volumes = bodies;
    for (const body of bodies) for (let x = Math.floor(body.bounds.left / BUCKET_SIZE); x <= Math.floor(body.bounds.right / BUCKET_SIZE); x++)
      for (let y = Math.floor(body.bounds.top / BUCKET_SIZE); y <= Math.floor(body.bounds.bottom / BUCKET_SIZE); y++) {
        const key = `${x},${y}`, bucket = this.buckets.get(key) ?? []; bucket.push(body); this.buckets.set(key, bucket);
      }
  }
  inBounds(bounds: StairBodyBounds): readonly StairVolume[] {
    const found = new Set<StairVolume>();
    for (let x = Math.floor(bounds.left / BUCKET_SIZE); x <= Math.floor(bounds.right / BUCKET_SIZE); x++)
      for (let y = Math.floor(bounds.top / BUCKET_SIZE); y <= Math.floor(bounds.bottom / BUCKET_SIZE); y++)
        for (const body of this.buckets.get(`${x},${y}`) ?? []) if (body.bounds.right >= bounds.left && body.bounds.left <= bounds.right
          && body.bounds.bottom >= bounds.top && body.bounds.top <= bounds.bottom) found.add(body);
    return [...found];
  }
  at(point: Pick<Vec2, 'x' | 'y'>, radius = 0): readonly StairVolume[] {
    return this.inBounds({ left: point.x - radius, right: point.x + radius, top: point.y - radius, bottom: point.y + radius });
  }
  collides(point: Vec2, elevation: number, radius = 0, exempt: (body: StairVolume) => boolean = () => false): boolean {
    return this.at(point, radius).some(body => {
      if (exempt(body)) return false;
      if (!radius && body.elevationAt(point) <= elevation + EPSILON) return false;
      const bounds = body.boundsAt(elevation); if (!bounds) return false;
      const x = Math.max(bounds.left, Math.min(point.x, bounds.right)), y = Math.max(bounds.top, Math.min(point.y, bounds.bottom));
      return (point.x - x) ** 2 + (point.y - y) ** 2 <= radius ** 2 + EPSILON;
    });
  }
  hit(start: Vec2, end: Vec2, elevation: number, radius = 0, exempt: (body: StairVolume) => boolean = () => false): number | null {
    let earliest = Infinity;
    for (const body of this.inBounds({ left: Math.min(start.x, end.x) - radius, right: Math.max(start.x, end.x) + radius,
      top: Math.min(start.y, end.y) - radius, bottom: Math.max(start.y, end.y) + radius })) {
      if (exempt(body)) continue;
      if (!radius && Math.abs(body.progressAt(start) - body.progressAt(end)) < EPSILON
        && body.elevationAt(start) <= elevation + EPSILON) continue;
      const bounds = body.boundsAt(elevation); if (!bounds) continue;
      const hit = sweptCircleRectangle(start, end, radius, bounds);
      if (hit !== null) earliest = Math.min(earliest, hit);
    }
    return earliest === Infinity ? null : earliest;
  }
}

/** Minkowski sum with rounded corners, so a narrow body never blocks an entire support tile. */
function sweptCircleRectangle(start: Vec2, end: Vec2, radius: number, bounds: StairBodyBounds): number | null {
  let earliest = Infinity;
  const rectangleHit = (left: number, top: number, right: number, bottom: number): number | null => {
    let enter = 0, leave = 1;
    for (const [origin, delta, min, max] of [[start.x, end.x - start.x, left, right], [start.y, end.y - start.y, top, bottom]]) {
      if (Math.abs(delta) < 1e-12) { if (origin < min || origin > max) return null; continue; }
      let a = (min - origin) / delta, b = (max - origin) / delta; if (a > b) [a, b] = [b, a];
      enter = Math.max(enter, a); leave = Math.min(leave, b); if (enter > leave) return null;
    }
    return enter >= 0 && enter <= 1 ? enter : null;
  };
  const { left, top, right, bottom } = bounds;
  const hits = [rectangleHit(left - radius, top, right + radius, bottom), rectangleHit(left, top - radius, right, bottom + radius)];
  if (radius > 0) for (const x of [left, right]) for (const y of [top, bottom]) {
    const dx = end.x - start.x, dy = end.y - start.y, fx = start.x - x, fy = start.y - y;
    const c = fx * fx + fy * fy - radius * radius, aa = dx * dx + dy * dy;
    if (c <= 0) { hits.push(0); continue; }
    if (!aa) continue;
    const bb = 2 * (fx * dx + fy * dy), discriminant = bb * bb - 4 * aa * c;
    if (discriminant < 0) continue;
    const t = (-bb - Math.sqrt(discriminant)) / (2 * aa); if (t >= 0 && t <= 1) hits.push(t);
  }
  for (const hit of hits) if (hit !== null) earliest = Math.min(earliest, hit);
  return earliest === Infinity ? null : earliest;
}
