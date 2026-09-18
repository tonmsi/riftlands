import { TILE_SIZE } from './config';
import { segmentCircleHit } from './physics';
import { World, isSolid } from './world';
import type { Vec2 } from './types';

/** Exact sweep against tile rectangles expanded by a circular radius, including rounded corners. */
export function sweptWorldHit(start: Vec2, end: Vec2, radius: number, world: World): number | null {
  let earliest = Infinity;
  const rectHit = (left: number, top: number, right: number, bottom: number): number | null => {
    let enter = 0, leave = 1;
    for (const [origin, delta, min, max] of [[start.x, end.x - start.x, left, right], [start.y, end.y - start.y, top, bottom]]) {
      if (Math.abs(delta) < 1e-12) { if (origin < min || origin > max) return null; continue; }
      let a = (min - origin) / delta, b = (max - origin) / delta;
      if (a > b) [a, b] = [b, a];
      enter = Math.max(enter, a);
      leave = Math.min(leave, b);
      if (enter > leave) return null;
    }
    return enter >= 0 && enter <= 1 ? enter : null;
  };
  for (let tx = Math.floor((Math.min(start.x, end.x) - radius) / TILE_SIZE); tx <= Math.floor((Math.max(start.x, end.x) + radius) / TILE_SIZE); tx++) {
    for (let ty = Math.floor((Math.min(start.y, end.y) - radius) / TILE_SIZE); ty <= Math.floor((Math.max(start.y, end.y) + radius) / TILE_SIZE); ty++) {
      if (!isSolid(world.getTile(tx, ty))) continue;
      const left = tx * TILE_SIZE, top = ty * TILE_SIZE, right = left + TILE_SIZE, bottom = top + TILE_SIZE;
      const hits = [rectHit(left - radius, top, right + radius, bottom), rectHit(left, top - radius, right, bottom + radius)];
      for (const x of [left, right]) for (const y of [top, bottom]) hits.push(segmentCircleHit(start, end, { x, y }, radius));
      for (const hit of hits) if (hit !== null) earliest = Math.min(earliest, hit);
    }
  }
  return earliest === Infinity ? null : earliest;
}

