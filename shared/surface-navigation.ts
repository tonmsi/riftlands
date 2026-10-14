import { TILE_SIZE } from './config';
import { collidesWorld } from './physics';
import { surfaceKey } from './world-surfaces';
import type { Vec2 } from './types';
import type { World } from './world';

/** Bounded A* on authored support surfaces. Connectors are the only edges between heights/decks. */
export function findSurfacePath(world: World, from: Vec2, to: Vec2, radius = 15, maxNodes = 2048): Vec2[] | undefined {
  const start = world.surfaceFor(from), target = world.surfaceFor(to);
  if (!start || !target || start.blocked || target.blocked || !world.sameRoom(from, to)) return;
  const startKey = surfaceKey(start.x, start.y, start.surfaceId), goal = surfaceKey(target.x, target.y, target.surfaceId);
  if (startKey === goal) return [{ ...to, ...world.surfaceState(to) }];
  const cost = new Map([[startKey, 0]]), previous = new Map<string, string>(), points = new Map<string, Vec2>();
  points.set(startKey, { x: (start.x + .5) * TILE_SIZE, y: (start.y + .5) * TILE_SIZE, surfaceId: start.surfaceId, elevation: start.elevation });
  const heuristic = (point: Vec2) => Math.abs(Math.floor(point.x / TILE_SIZE) - target.x) + Math.abs(Math.floor(point.y / TILE_SIZE) - target.y);
  const open = [{ key: startKey, score: heuristic(from) }], visited = new Set<string>();
  while (open.length && visited.size < Math.max(1, Math.min(8192, maxNodes))) {
    open.sort((a, b) => a.score - b.score || a.key.localeCompare(b.key));
    const current = open.shift()!; if (visited.has(current.key)) continue;
    if (current.key === goal) {
      const path: Vec2[] = []; let key = goal;
      while (key !== startKey) { path.unshift(points.get(key)!); key = previous.get(key)!; }
      path.push({ ...to, ...world.surfaceState(to) }); return path;
    }
    visited.add(current.key); const point = points.get(current.key)!;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const x = point.x + dx * TILE_SIZE, y = point.y + dy * TILE_SIZE, support = world.canTraverse(point, x, y);
      if (!support || collidesWorld(x, y, radius, world, { x, y, surfaceId: support.surfaceId })) continue;
      const next = { x, y, surfaceId: support.surfaceId, elevation: support.elevation }, key = surfaceKey(support.x, support.y, support.surfaceId);
      const distance = cost.get(current.key)! + 1;
      if (visited.has(key) || distance >= (cost.get(key) ?? Infinity)) continue;
      cost.set(key, distance); previous.set(key, current.key); points.set(key, next); open.push({ key, score: distance + heuristic(next) });
    }
  }
}
