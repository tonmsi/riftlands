import { TILE_SIZE } from '../config';
import type { Vec2 } from '../types';
import type { World } from '../world';
import { FISHING } from './model';
/** Stop at the first water cell: casts cannot cross land or obstacle cells beyond the shore. */
export function validFishingCast(world: World, from: Vec2, to: Vec2): boolean {
  if (world.mode !== 'world') return false;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (!Number.isFinite(distance) || distance < FISHING.minCast || distance > FISHING.maxCast || world.getTile(Math.floor(to.x / TILE_SIZE), Math.floor(to.y / TILE_SIZE)) !== 'water') return false;
  const steps = Math.ceil(distance / 6); let water = false;
  for (let i = 1; i <= steps; i++) {
    const x = from.x + (to.x - from.x) * i / steps, y = from.y + (to.y - from.y) * i / steps;
    const tx = Math.floor(x / TILE_SIZE), ty = Math.floor(y / TILE_SIZE), tile = world.getTile(tx, ty);
    if (tile === 'water') water = true;
    else if (water || world.isBlocked(tx, ty)) return false;
  }
  return true;
}
export function nearbyFishingWater(world: World, player: Vec2): Vec2 | undefined {
  if (world.mode !== 'world') return;
  const tx = Math.floor(player.x / TILE_SIZE), ty = Math.floor(player.y / TILE_SIZE), radius = Math.ceil(FISHING.shoreRange / TILE_SIZE);
  const candidates: Vec2[] = [];
  for (let y = ty - radius; y <= ty + radius; y++) for (let x = tx - radius; x <= tx + radius; x++)
    if (world.getTile(x, y) === 'water') candidates.push({ x: (x + .5) * TILE_SIZE, y: (y + .5) * TILE_SIZE });
  return candidates.sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y)).find(p => validFishingCast(world, player, p));
}
