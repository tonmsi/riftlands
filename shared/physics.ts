import { TILE_SIZE } from './config';
import type { Actor, Vec2 } from './types';
import { isSolid, World } from './world';

/** Circle vs solid terrain AABBs, also correct across negative chunk coordinates. */
export function collidesWorld(x: number, y: number, radius: number, world: World): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) return true;
  const minX = Math.floor((x - radius) / TILE_SIZE), maxX = Math.floor((x + radius) / TILE_SIZE);
  const minY = Math.floor((y - radius) / TILE_SIZE), maxY = Math.floor((y + radius) / TILE_SIZE);
  for (let ty = minY; ty <= maxY; ty++) for (let tx = minX; tx <= maxX; tx++) {
    if (!isSolid(world.getTile(tx, ty))) continue;
    const nearestX = Math.max(tx * TILE_SIZE, Math.min(x, (tx + 1) * TILE_SIZE));
    const nearestY = Math.max(ty * TILE_SIZE, Math.min(y, (ty + 1) * TILE_SIZE));
    if ((x - nearestX) ** 2 + (y - nearestY) ** 2 < radius ** 2 + 1e-8) return true;
  }
  return false;
}

/** Both peers run this exact fixed-step movement; small substeps prevent tunnelling. */
export function moveWithCollisions(actor: Vec2 & { radius: number }, dx: number, dy: number, distance: number, world: World): Vec2 {
  const magnitude = Math.hypot(dx, dy);
  if (!Number.isFinite(magnitude) || !Number.isFinite(distance) || magnitude === 0 || distance <= 0) return { x: actor.x, y: actor.y };
  const factor = Math.min(1, magnitude), steps = Math.max(1, Math.ceil(distance * factor / 7));
  const sx = dx / magnitude * distance * factor / steps, sy = dy / magnitude * distance * factor / steps;
  let x = actor.x, y = actor.y;
  for (let i = 0; i < steps; i++) {
    if (!collidesWorld(x + sx, y, actor.radius, world)) x += sx;
    if (!collidesWorld(x, y + sy, actor.radius, world)) y += sy;
  }
  return { x, y };
}

export function movementSpeed(actor: Actor, time: number): number {
  if (actor.hp <= 0 || actor.deadUntil > time) return 0;
  let speed = actor.speed;
  for (const effect of actor.effects) if (effect.until > time) {
    if (effect.kind === 'haste') speed *= 1.35;
    if (effect.kind === 'slow') speed *= 0.55;
  }
  return speed;
}

export function terrainSpeed(actor: Vec2, world: World): number {
  return world.getTile(Math.floor(actor.x / TILE_SIZE), Math.floor(actor.y / TILE_SIZE)) === 'mud' ? 0.65 : 1;
}

/** Grid traversal checks every crossed tile, including diagonal corner cracks. */
export function hasLineOfSight(a: Vec2, b: Vec2, world: World): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  // Grid DDA checks every crossed tile, including the two corner-adjacent cells.
  let tx = Math.floor(a.x / TILE_SIZE), ty = Math.floor(a.y / TILE_SIZE);
  const endX = Math.floor(b.x / TILE_SIZE), endY = Math.floor(b.y / TILE_SIZE);
  if (isSolid(world.getTile(tx, ty))) return false;
  const stepX = Math.sign(dx), stepY = Math.sign(dy);
  const deltaX = dx === 0 ? Infinity : Math.abs(TILE_SIZE / dx), deltaY = dy === 0 ? Infinity : Math.abs(TILE_SIZE / dy);
  let nextX = dx === 0 ? Infinity : ((tx + (stepX > 0 ? 1 : 0)) * TILE_SIZE - a.x) / dx;
  let nextY = dy === 0 ? Infinity : ((ty + (stepY > 0 ? 1 : 0)) * TILE_SIZE - a.y) / dy;
  const max = Math.abs(endX - tx) + Math.abs(endY - ty) + 2;
  for (let i = 0; i < max && (tx !== endX || ty !== endY); i++) {
    if (Math.abs(nextX - nextY) < 1e-10) {
      if (isSolid(world.getTile(tx + stepX, ty)) || isSolid(world.getTile(tx, ty + stepY))) return false;
      tx += stepX; ty += stepY; nextX += deltaX; nextY += deltaY;
    } else if (nextX < nextY) { tx += stepX; nextX += deltaX; }
    else { ty += stepY; nextY += deltaY; }
    if (isSolid(world.getTile(tx, ty))) return false;
  }
  return true;
}

/** Earliest hit fraction [0,1] for a swept point against a circle. */
export function segmentCircleHit(a: Vec2, b: Vec2, center: Vec2, radius: number): number | null {
  const dx = b.x - a.x, dy = b.y - a.y, fx = a.x - center.x, fy = a.y - center.y;
  const c = fx * fx + fy * fy - radius * radius;
  if (c <= 0) return 0;
  const aa = dx * dx + dy * dy;
  if (aa === 0) return null;
  const bb = 2 * (fx * dx + fy * dy), discriminant = bb * bb - 4 * aa * c;
  if (discriminant < 0) return null;
  const t = (-bb - Math.sqrt(discriminant)) / (2 * aa);
  return t >= 0 && t <= 1 ? t : null;
}

/** Spatial buckets bound broad-phase collision work to local actor density. */
export function resolveActorCollisions(actors: Actor[], world: World): void {
  const living = actors.filter(a => a.hp > 0).sort((a, b) => a.id.localeCompare(b.id));
  for (let pass = 0; pass < 3; pass++) {
    const buckets = new Map<string, Actor[]>();
    for (const a of living) {
      const bx = Math.floor(a.x / 80), by = Math.floor(a.y / 80);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (const b of buckets.get(`${bx + ox},${by + oy}`) ?? []) {
        const dx = a.x - b.x, dy = a.y - b.y, dist = Math.hypot(dx, dy), minimum = a.radius + b.radius;
        if (dist >= minimum) continue;
        const nx = dist > 0.0001 ? dx / dist : 1, ny = dist > 0.0001 ? dy / dist : 0;
        const push = (minimum - dist + 0.05) / 2;
        const pa = moveWithCollisions(a, nx, ny, push, world);
        const movedA = Math.hypot(pa.x - a.x, pa.y - a.y);
        a.x = pa.x; a.y = pa.y;
        const pb = moveWithCollisions(b, -nx, -ny, push * 2 - movedA, world);
        b.x = pb.x; b.y = pb.y;
      }
      const key = `${Math.floor(a.x / 80)},${Math.floor(a.y / 80)}`;
      const bucket = buckets.get(key) ?? []; bucket.push(a); buckets.set(key, bucket);
    }
  }
}
