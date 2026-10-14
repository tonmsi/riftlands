import { TILE_SIZE } from './tile-size';
import type { Vec2 } from './types';
import type { World } from './world';
import { BASE_SURFACE, ELEVATION_STEP, type SurfaceEndpoint, type SurfaceStair } from './world-surfaces';
import { stairGeometry, stairSurfaceId } from './surface-stairs';

interface WalkingProfile {
  x: number; y: number; dx: number; dy: number; run: number; rise: number; width: number;
  /** An absent landing identifies the historical smoothstep connector. */
  landing?: number;
}
interface ProfileInterval { profile: WalkingProfile; from: number; to: number; }
const NEIGHBOURS = [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const EPSILON = 1e-10;

function authoredProfile(stair: SurfaceStair): WalkingProfile {
  const g = stairGeometry(stair), start = g.pointAt(0);
  return { ...start, dx: g.dx, dy: g.dy, run: g.run, rise: g.rise, width: stair.width, landing: g.landing };
}

/** Only the current support can borrow a staircase's projected foot profile. */
function nearbyProfiles(point: Vec2, world: World): WalkingProfile[] {
  const index = world.surfaceIndex, id = point.surfaceId ?? BASE_SURFACE;
  const tx = Math.floor(point.x / TILE_SIZE), ty = Math.floor(point.y / TILE_SIZE);
  const height = point.elevation ?? index.at(tx, ty, id)?.elevation ?? (id === BASE_SURFACE ? 0 : undefined);
  const stairs = new Set<SurfaceStair>(), profiles: WalkingProfile[] = [];
  for (const [ox, oy] of NEIGHBOURS) for (const stair of index.stairsAtColumn(tx + ox, ty + oy)) stairs.add(stair);
  for (const stair of stairs) {
    const g = stairGeometry(stair);
    const onBank = [stair.from, stair.to].some(p => p.surfaceId === id && p.elevation === height
      && (g.dx ? tx === p.x : ty === p.y));
    if (id === stairSurfaceId(stair) || onBank) profiles.push(authoredProfile(stair));
  }

  const seen = new Set<string>();
  for (const [ox, oy] of NEIGHBOURS) {
    const x = tx + ox, y = ty + oy;
    const fromHeight = index.at(x, y, id)?.elevation ?? (id === BASE_SURFACE ? 0 : undefined);
    if (fromHeight === undefined) continue;
    const from: SurfaceEndpoint = { x, y, surfaceId: id };
    for (const to of index.exits(x, y, id)) {
      if (index.stairForEdge(from, to)) continue;
      const atFrom = tx === x && ty === y, atTo = tx === to.x && ty === to.y;
      const toHeight = index.at(to.x, to.y, to.surfaceId)?.elevation ?? (to.surfaceId === BASE_SURFACE ? 0 : undefined);
      if (toHeight === undefined || toHeight === fromHeight || !(atFrom || atTo)) continue;
      const localId = atFrom ? id : to.surfaceId, localHeight = atFrom ? fromHeight : toHeight;
      if (id !== localId || height !== localHeight) continue;
      const key = [`${x},${y}@${id}`, `${to.x},${to.y}@${to.surfaceId}`].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const low = fromHeight < toHeight ? from : to, high = low === from ? to : from;
      profiles.push({ x: (low.x + .5) * TILE_SIZE, y: (low.y + .5) * TILE_SIZE,
        dx: high.x - low.x, dy: high.y - low.y, run: TILE_SIZE,
        rise: Math.abs(toHeight - fromHeight) * ELEVATION_STEP, width: TILE_SIZE });
    }
  }
  return profiles;
}

function interval(profile: WalkingProfile, point: Vec2, ux: number, uy: number, maximum: number): ProfileInterval | undefined {
  let from = 0, to = maximum;
  const along = (point.x - profile.x) * profile.dx + (point.y - profile.y) * profile.dy;
  const lateral = (point.x - profile.x) * -profile.dy + (point.y - profile.y) * profile.dx;
  for (const [origin, velocity, min, max] of [
    [along, ux * profile.dx + uy * profile.dy, profile.landing ?? 0, profile.run - (profile.landing ?? 0)],
    [lateral, ux * -profile.dy + uy * profile.dx, -profile.width / 2, profile.width / 2],
  ]) {
    if (Math.abs(velocity) < EPSILON) { if (origin < min || origin > max) return undefined; continue; }
    let a = (min - origin) / velocity, b = (max - origin) / velocity;
    if (a > b) [a, b] = [b, a];
    from = Math.max(from, a); to = Math.min(to, b);
    if (to - from <= EPSILON) return undefined;
  }
  return { profile, from, to };
}

/** Screen-space differential of (x, y - height), clamped so no direction gains world speed. */
function metric(profile: WalkingProfile, point: Vec2, ux: number, uy: number, distance: number): number {
  const alongDirection = ux * profile.dx + uy * profile.dy;
  const along = (point.x - profile.x) * profile.dx + (point.y - profile.y) * profile.dy + alongDirection * distance;
  const t = Math.max(0, Math.min(1, along / profile.run));
  const slope = profile.landing === undefined ? 6 * profile.rise / profile.run * t * (1 - t)
    : profile.rise / (profile.run - 2 * profile.landing);
  return Math.max(1, Math.hypot(ux, uy - slope * alongDirection));
}

/** Bounded quadrature is needed only for old connectors whose slope varies smoothly. */
function integrate(f: (x: number) => number, a: number, b: number): number {
  const m = (a + b) / 2, fa = f(a), fm = f(m), fb = f(b);
  const estimate = (b - a) * (fa + 4 * fm + fb) / 6;
  const refine = (left: number, right: number, fl: number, fc: number, fr: number, whole: number, depth: number): number => {
    const center = (left + right) / 2, l = (left + center) / 2, r = (center + right) / 2;
    const fLeft = f(l), fRight = f(r);
    const leftPart = (center - left) * (fl + 4 * fLeft + fc) / 6;
    const rightPart = (right - center) * (fc + 4 * fRight + fr) / 6;
    const sum = leftPart + rightPart;
    if (!depth || Math.abs(sum - whole) < 1e-9) return sum + (sum - whole) / 15;
    return refine(left, center, fl, fLeft, fc, leftPart, depth - 1)
      + refine(center, right, fc, fRight, fr, rightPart, depth - 1);
  };
  return refine(a, b, fa, fm, fb, estimate, 5);
}

/**
 * Converts at most seven pixels of flat walking time into a physical stride.
 * Authored landings are exact piecewise boundaries, rather than a per-tick multiplier.
 */
export function walkingStepDistance(point: Vec2, ux: number, uy: number, budget: number, world: World): number {
  if (!world.surfaceIndex.hasSurfaces || budget <= 0) return budget;
  const intervals = nearbyProfiles(point, world).map(p => interval(p, point, ux, uy, budget))
    .filter((p): p is ProfileInterval => p !== undefined);
  if (!intervals.length) return budget;
  const boundaries = [...new Set([0, budget, ...intervals.flatMap(p => [p.from, p.to])])].sort((a, b) => a - b);
  let remaining = budget;
  for (let i = 1; i < boundaries.length; i++) {
    const a = boundaries[i - 1], b = boundaries[i], middle = (a + b) / 2;
    const active = intervals.find(p => middle >= p.from && middle <= p.to)?.profile;
    if (!active) { if (remaining < b - a) return a + remaining; remaining -= b - a; continue; }
    const factor = (s: number) => metric(active, point, ux, uy, s);
    if (active.landing !== undefined) {
      const k = factor(middle), cost = (b - a) * k;
      if (remaining < cost) return a + remaining / k;
      remaining -= cost;
    } else {
      const cost = integrate(factor, a, b);
      if (remaining >= cost) { remaining -= cost; continue; }
      let low = a, high = b;
      for (let n = 0; n < 32; n++) {
        const mid = (low + high) / 2;
        if (integrate(factor, a, mid) > remaining) high = mid; else low = mid;
      }
      return (low + high) / 2;
    }
  }
  return budget;
}
