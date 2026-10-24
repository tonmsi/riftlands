import { TILE_SIZE } from '../shared/config';
import { elevationOf, type Elevated } from '../shared/elevation';
import type { Vec2 } from '../shared/types';
import type { World } from '../shared/world';

export function worldSpawn(world: World): Vec2 & Elevated {
  const document = world.authoring.document, offset = document.interiorBounds ? .5 : 0;
  const x = (document.spawn.x + offset) * TILE_SIZE, y = (document.spawn.y + offset) * TILE_SIZE;
  return { x, y, ...world.elevation.at(x, y, document.spawnElevation ?? 0) };
}

/** Only geometry inside the occupied tile matters; never search nearby tiles for a landing. */
export function relocateForWorldChange(actor: Vec2 & Elevated, previous: World, next: World): boolean {
  const oldFloor = previous.elevation.at(actor.x, actor.y, elevationOf(actor));
  const floor = next.elevation.at(actor.x, actor.y, elevationOf(actor));
  const blocked = (world: World, level: number) => world.elevation.blocked(actor.x, actor.y, 0, level);
  const wasBlocked = blocked(previous, elevationOf(actor)), nowBlocked = blocked(next, elevationOf(floor));
  if (elevationOf(oldFloor) === elevationOf(floor) && wasBlocked === nowBlocked) return false;
  if (nowBlocked || elevationOf(floor) < 0) Object.assign(actor, worldSpawn(next));
  else Object.assign(actor, floor);
  return true;
}
