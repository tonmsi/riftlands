import { TILE_SIZE } from './tile-size';
import type { Vec2 } from './types';
import type { World } from './world';
import { BASE_SURFACE, type SurfaceStair } from './world-surfaces';
import { stairGeometry } from './surface-stairs';

/** A walking approach can use the flat landing to line up with an inset stair. */
export function terracedStairEntryDirection(point: Vec2 & { radius: number }, direction: Vec2, budget: number, world: World): Vec2 {
  if ((point.surfaceId ?? BASE_SURFACE) !== BASE_SURFACE || budget <= 0 || !world.surfaceIndex.stairs.length) return direction;
  const tx = Math.floor(point.x / TILE_SIZE), ty = Math.floor(point.y / TILE_SIZE);
  const stairs = new Set<SurfaceStair>();
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++)
    for (const stair of world.surfaceIndex.stairsAtColumn(tx + ox, ty + oy)) if (stair.profile === 'terraced') stairs.add(stair);
  if (!stairs.size) return direction;
  const source = world.surfaceFor(point);
  if (!source || source.blocked || source.kind !== 'ground') return direction;
  let closest: { dx: number; dy: number; sign: number; lateral: number; clearance: number } | undefined;

  for (const stair of stairs) {
    const g = stairGeometry(stair), start = g.pointAt(0);
    const lateral = (point.x - start.x) * -g.dy + (point.y - start.y) * g.dx;
    const clearance = stair.width / 2 - point.radius - 1;
    if (clearance < 0 || Math.abs(lateral) >= stair.width / 2 + point.radius) continue;
    for (const [bank, sign] of [[g.low, 1], [g.high, -1]] as const) {
      if (bank.surfaceId !== BASE_SURFACE || source.elevation !== bank.elevation) continue;
      const along = (point.x - (bank.x + .5) * TILE_SIZE) * g.dx + (point.y - (bank.y + .5) * TILE_SIZE) * g.dy;
      if (Math.abs(along) > TILE_SIZE / 2) continue;
      const forward = (direction.x * g.dx + direction.y * g.dy) * sign;
      const sideways = direction.x * -g.dy + direction.y * g.dx;
      if (forward <= 0 || Math.abs(sideways) > .2) continue;
      if (!closest || Math.abs(lateral) < Math.abs(closest.lateral)) closest = { dx: g.dx, dy: g.dy, sign, lateral, clearance };
    }
  }
  if (!closest || Math.abs(closest.lateral) <= closest.clearance) return direction;
  // This changes direction only. Collision integration spends the original walking budget.
  const { dx, dy, sign, lateral } = closest;
  const side = -Math.sign(lateral) * Math.min(1, Math.abs(lateral) / budget), length = Math.hypot(1, side);
  return { x: (dx * sign - dy * side) / length, y: (dy * sign + dx * side) / length };
}
