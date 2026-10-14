import { TILE_SIZE } from './config';
import type { Vec2 } from './types';
import type { World } from './world';
import { BASE_SURFACE } from './world-surfaces';
import { stairGeometry } from './surface-stairs';

export interface SurfacePresentation { elevation: number; drawPlane: number; }

/** Logical support stays discrete; the body follows a connector above its painted steps. */
export function surfacePresentationAt(point: Vec2, world: World): SurfacePresentation {
  const tx = Math.floor(point.x / TILE_SIZE), ty = Math.floor(point.y / TILE_SIZE);
  const id = point.surfaceId ?? BASE_SURFACE;
  const current = world.surfaceIndex.at(tx, ty, id);
  const logical = point.elevation ?? current?.elevation ?? 0;
  if (!world.surfaceIndex.hasSurfaces) return { elevation: logical, drawPlane: logical };
  const stair = world.surfaceIndex.stairFor({ ...point, elevation: logical });
  if (stair) {
    const g = stairGeometry(stair), t = g.progressAt(point);
    if (t >= 0 && t <= 1 && g.contains(point)) return { elevation: g.elevationAt(t), drawPlane: g.high.elevation };
  }
  // Interpolated positions can still be in the previous cell while carrying the new support.
  for (const [dx, dy] of [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const x = tx + dx, y = ty + dy;
    const sourceHeight = world.surfaceIndex.at(x, y, id)?.elevation ?? (id === BASE_SURFACE ? 0 : undefined);
    if (sourceHeight === undefined) continue;
    for (const exit of world.surfaceIndex.exits(x, y, id)) {
      if (!(tx === x && ty === y || tx === exit.x && ty === exit.y)) continue;
      const targetHeight = world.surfaceIndex.at(exit.x, exit.y, exit.surfaceId)?.elevation ?? (exit.surfaceId === BASE_SURFACE ? 0 : undefined);
      if (targetHeight === undefined || targetHeight === sourceHeight) continue;
      const atSource = tx === x && ty === y;
      const localId = atSource ? id : exit.surfaceId, localHeight = atSource ? sourceHeight : targetHeight;
      // A character below a deck occupies a real, different support at the same coordinates.
      // Only a mismatching sampled support may borrow the neighbouring endpoint during interpolation.
      const realHeight = current?.elevation ?? (id === BASE_SURFACE ? 0 : undefined);
      if (localId !== id || point.elevation !== undefined && point.elevation !== localHeight) {
        if (realHeight === logical || logical !== sourceHeight) continue;
      }
      const ax = (x + .5) * TILE_SIZE, ay = (y + .5) * TILE_SIZE;
      const vx = exit.x - x, vy = exit.y - y;
      const t = ((point.x - ax) * vx + (point.y - ay) * vy) / TILE_SIZE;
      if (t < 0 || t > 1) continue;
      const eased = t * t * (3 - 2 * t);
      return { elevation: sourceHeight + (targetHeight - sourceHeight) * eased, drawPlane: Math.max(sourceHeight, targetHeight) };
    }
  }
  return { elevation: logical, drawPlane: logical };
}

export function visualElevationAt(point: Vec2, world: World): number { return surfacePresentationAt(point, world).elevation; }

/** An adjacent authored connector permits tick/snapshot interpolation; teleports still reset it. */
export function canInterpolateSurfaceTransition(before: Vec2, after: Vec2, world?: World): boolean {
  const fromId = before.surfaceId ?? BASE_SURFACE, toId = after.surfaceId ?? BASE_SURFACE;
  const fromHeight = before.elevation ?? 0, toHeight = after.elevation ?? 0;
  if (fromId === toId && fromHeight === toHeight) return true;
  if (!world || Math.hypot(after.x - before.x, after.y - before.y) > TILE_SIZE * 1.5 || !world.sameRoom(before, after)) return false;
  const fx = Math.floor(before.x / TILE_SIZE), fy = Math.floor(before.y / TILE_SIZE);
  const tx = Math.floor(after.x / TILE_SIZE), ty = Math.floor(after.y / TILE_SIZE);
  if (Math.abs(tx - fx) + Math.abs(ty - fy) !== 1) return false;
  const source = world.surfaceIndex.at(fx, fy, fromId), target = world.surfaceIndex.at(tx, ty, toId);
  if ((source?.elevation ?? (fromId === BASE_SURFACE ? 0 : undefined)) !== fromHeight
    || (target?.elevation ?? (toId === BASE_SURFACE ? 0 : undefined)) !== toHeight) return false;
  return world.surfaceIndex.exits(fx, fy, fromId).some(exit => exit.x === tx && exit.y === ty && exit.surfaceId === toId);
}
