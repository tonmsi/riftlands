import { TILE_SIZE } from '../../shared/config';
import { stairGeometry } from '../../shared/surface-stairs';
import { ELEVATION_STEP, type SurfaceCell, type SurfaceLink, type SurfaceStair } from '../../shared/world-surfaces';
import type { ContourPoint } from './surface-contours';

export interface RockStep { top: ContourPoint[]; riser: ContourPoint[]; center: ContourPoint; }
export interface RockStairGeometry {
  low: SurfaceCell; high: SurfaceCell; dx: number; dy: number; width: number;
  treads: RockStep[]; shoulders: ContourPoint[]; landing: ContourPoint[]; lowerLanding: ContourPoint[];
  corridor: ContourPoint[]; sideFace: ContourPoint[];
}

interface StairProfile {
  low: SurfaceCell; high: SurfaceCell; dx: number; dy: number; width: number; run: number;
  landing: number; inset?: boolean; elevationAt(t: number): number;
}

/** Map axes orient the slabs; elevation projects them without rotating their risers. */
function buildGeometry(profile: StairProfile, projectElevation: boolean): RockStairGeometry {
  const { low, high, dx, dy, width, run, landing, inset, elevationAt } = profile;
  const rise = (high.elevation - low.elevation) * ELEVATION_STEP;
  const nx = -dy * width / 2, ny = dx * width / 2;
  const position = (t: number, elevation = elevationAt(t), side = 0): ContourPoint => ({
    x: (low.x + .5) * TILE_SIZE + dx * run * t + nx * side,
    y: (low.y + .5) * TILE_SIZE + dy * run * t + ny * side - (projectElevation ? elevation * ELEVATION_STEP : 0),
  });
  const start = landing / run, end = 1 - start;
  const count = Math.max(3, Math.min(64, Math.ceil(rise / 4)));
  const treads = Array.from({ length: count }, (_, i): RockStep => {
    const a = start + (end - start) * i / count, b = start + (end - start) * (i + 1) / count;
    const za = elevationAt(a), zb = elevationAt(b);
    return {
      top: [position(a, zb, -1), position(a, zb, 1), position(b, zb, 1), position(b, zb, -1)],
      riser: [position(a, za, -1), position(a, za, 1), position(a, zb, 1), position(a, zb, -1)],
      center: position((a + b) / 2, zb),
    };
  });
  // The stone body begins at the first riser; the lower flat approach keeps its terrain.
  const samples = Array.from({ length: count + 1 }, (_, i) => start + (end - start) * i / count);
  // Inset flights meet the edge of the upper ground cell. That ground owns its
  // flat landing, so neither stone artwork nor the shaft extends over its top.
  if (!inset) samples.push(1);
  const corridor = [...samples.map(t => position(t, elevationAt(t), -1)), ...samples.slice().reverse().map(t => position(t, elevationAt(t), 1))];
  const shoulders: ContourPoint[] = [];
  const shoulderCount = Math.max(2, Math.ceil(Math.max(rise, run) / 15));
  for (let i = 0; !inset && i <= shoulderCount; i++) {
    const t = start + (1 - start) * i / shoulderCount;
    // Border stones sit outside the useful corridor, which already includes the actor's margin.
    shoulders.push(position(t, elevationAt(t), -1 - 6 / width), position(t, elevationAt(t), 1 + 6 / width));
  }
  const landingQuad = (a: number, b: number, elevation: number) =>
    [position(a, elevation, -1), position(a, elevation, 1), position(b, elevation, 1), position(b, elevation, -1)];
  const upperLanding = inset ? [] : landingQuad(end, landing ? 1 : 1 + 6 / run, high.elevation);
  const lowerLanding = landingQuad(landing ? 0 : -6 / run, start, low.elevation);
  const front = dx > 0 ? 1 : -1;
  const sideFace = dx ? [...samples.map(t => position(t, elevationAt(t), front)), ...samples.slice().reverse().map(t => position(t, low.elevation, front))] : [];
  return { low, high, dx, dy, width, treads, shoulders, landing: upperLanding, lowerLanding, corridor, sideFace };
}

/** Adjacent saved links preserve their historical profile and transit. Their useful width is a tile. */
export function rockStairGeometry(from: SurfaceCell, to: SurfaceCell, projectElevation = true, width = TILE_SIZE,
  allowAnyWall = false): RockStairGeometry | undefined {
  if (from.elevation === to.elevation || Math.abs(from.x - to.x) + Math.abs(from.y - to.y) !== 1) return;
  const [low, high] = from.elevation < to.elevation ? [from, to] : [to, from];
  if (!allowAnyWall && high.wallMaterial !== 'rock') return;
  return buildGeometry({ low, high, dx: high.x - low.x, dy: high.y - low.y, run: TILE_SIZE, width, landing: 0,
    elevationAt: t => low.elevation + (high.elevation - low.elevation) * t * t * (3 - 2 * t) }, projectElevation);
}

/** All steps and both landings follow the single authored profile, including its intermediate cells. */
export function authoredRockStairGeometry(stair: SurfaceStair, projectElevation = true): RockStairGeometry {
  const geometry = stairGeometry(stair);
  const cell = (endpoint: SurfaceStair['from']): SurfaceCell => ({ ...endpoint, material: 'stone', wallMaterial: 'rock',
    kind: endpoint.surfaceId === 'ground' ? 'ground' : 'stairs' });
  const result = buildGeometry({ ...geometry, low: cell(geometry.low), high: cell(geometry.high),
    inset: stair.profile === 'terraced' }, projectElevation);
  // An inset flight borrows its body from the wall bands around its shaft.
  // Painting the ordinary side triangle would cover the neighboring rock again.
  if (stair.underpass === true || stair.profile === 'terraced') result.sideFace = [];
  return result;
}

/** Endpoint mouth on the support plane: this same polygon excludes rock lips and plants. */
export function stairEndpointMouth(low: SurfaceCell, high: SurfaceCell, cell: SurfaceCell, width: number,
  projectElevation = true): ContourPoint[] | undefined {
  const run = Math.hypot(high.x - low.x, high.y - low.y), dx = (high.x - low.x) / run, dy = (high.y - low.y) / run;
  if (!run || dx && dy || low.elevation === high.elevation) return;
  const atBank = (bank: SurfaceCell) => cell.surfaceId === bank.surfaceId && cell.elevation === bank.elevation
    && (cell.x - bank.x) * dx + (cell.y - bank.y) * dy === 0
    && Math.abs((cell.x - bank.x) * -dy + (cell.y - bank.y) * dx) * TILE_SIZE < width / 2 + TILE_SIZE / 2;
  const isLow = atBank(low), isHigh = atBank(high);
  if (!isLow && !isHigh) return;
  const bank = isHigh ? high : low;
  const inward = isHigh ? -1 : 1, extension = TILE_SIZE / 2 + 16;
  const center = { x: (bank.x + .5) * TILE_SIZE, y: (bank.y + .5) * TILE_SIZE - (projectElevation ? bank.elevation * ELEVATION_STEP : 0) };
  const point = (along: number, side: number) => ({ x: center.x + dx * inward * along - dy * width * side / 2,
    y: center.y + dy * inward * along + dx * width * side / 2 });
  return [point(-6, -1), point(-6, 1), point(extension, 1), point(extension, -1)];
}

/** Only the south-facing wall has a frontal extrusion in this game's projection. */
export function rockWallOpenings(cell: SurfaceCell, links: readonly SurfaceLink[], lookup: (p: SurfaceLink['from']) => SurfaceCell | undefined,
  allowAnyWall = false): { x: number; width: number }[] {
  if (!allowAnyWall && cell.wallMaterial !== 'rock') return [];
  const openings: { x: number; width: number }[] = [];
  for (const link of links) {
    if (link.kind !== 'stairs' && link.kind !== 'ramp') continue;
    const from = lookup(link.from), to = lookup(link.to);
    if (!from || !to) continue;
    const [low, high] = from.elevation < to.elevation ? [from, to] : [to, from];
    if (high.x !== cell.x || high.y !== cell.y || high.surfaceId !== cell.surfaceId || high.elevation <= low.elevation) continue;
    if (low.x === cell.x && low.y === cell.y + 1) openings.push({ x: 0, width: TILE_SIZE });
  }
  return openings;
}

export function authoredStairWallOpening(stair: SurfaceStair, cell: SurfaceCell): { x: number; width: number } | undefined {
  const { low, high, width } = stairGeometry(stair);
  if (cell.y !== high.y || cell.surfaceId !== high.surfaceId || cell.elevation !== high.elevation || low.x !== high.x || low.y <= high.y) return;
  const left = (high.x - cell.x + .5) * TILE_SIZE - width / 2;
  const start = Math.max(0, left), end = Math.min(TILE_SIZE, left + width);
  return end > start ? { x: start, width: end - start } : undefined;
}
