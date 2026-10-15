import { TILE_SIZE } from './config';
import { World } from './world';
import type { Vec2 } from './types';
import { sweptCircleRectangle } from './stair-volume';

/** Exact sweep against tile rectangles expanded by a circular radius, including rounded corners. */
export function sweptWorldHit(start: Vec2, end: Vec2, radius: number, world: World): number | null {
  const room = world.roomAt(start.x, start.y);
  let earliest = world.stairBodyHit(start, end, radius) ?? Infinity;
  for (let tx = Math.floor((Math.min(start.x, end.x) - radius) / TILE_SIZE); tx <= Math.floor((Math.max(start.x, end.x) + radius) / TILE_SIZE); tx++) {
    for (let ty = Math.floor((Math.min(start.y, end.y) - radius) / TILE_SIZE); ty <= Math.floor((Math.max(start.y, end.y) + radius) / TILE_SIZE); ty++) {
      const bounds = (world.roomTiles.get(`${tx},${ty}`) ?? '') === room ? world.terrainRayBounds(tx, ty, start)
        : [{ left: tx * TILE_SIZE, top: ty * TILE_SIZE, right: (tx + 1) * TILE_SIZE, bottom: (ty + 1) * TILE_SIZE }];
      for (const rect of bounds) {
        const hit = sweptCircleRectangle(start, end, radius, rect);
        if (hit !== null) earliest = Math.min(earliest, hit);
      }
    }
  }
  return earliest === Infinity ? null : earliest;
}

