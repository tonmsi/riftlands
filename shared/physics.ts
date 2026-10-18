import { TILE_SIZE } from './config';
import type { Actor, Vec2 } from './types';
import { World } from './world';
import { elevationOf, sameElevation, type Elevated } from './elevation';
import { sweptWorldHit } from './projectiles';

/** Circle vs solid terrain AABBs, also correct across negative chunk coordinates. */
export function collidesWorld(x: number, y: number, radius: number, world: World, elevation = 0): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) return true;
  return world.elevation.blocked(x, y, radius, elevation);
}

/** Both peers run this exact fixed-step movement; small substeps prevent tunnelling. */
/** Movimento a step discreti con scivolamento tangenziale a velocità conservata */
export function moveWithCollisions(actor: Vec2 & Elevated & { radius: number }, dx: number, dy: number, distance: number, world: World): Vec2 & Elevated {
  const magnitude = Math.hypot(dx, dy);
  if (!Number.isFinite(magnitude) || !Number.isFinite(distance) || magnitude === 0 || distance <= 0) return { x: actor.x, y: actor.y };
  
  const factor = Math.min(1, magnitude);
  const totalDist = distance * factor;
  const steps = Math.max(1, Math.ceil(totalDist / 7));
  const stepDist = totalDist / steps;
  
  const dirX = dx / magnitude;
  const dirY = dy / magnitude;
  
  let x = actor.x, y = actor.y, elevation = elevationOf(actor), surfaceId = actor.surfaceId;
  const attempt = (tx: number, ty: number) => world.sameRoom(actor, { x: tx, y: ty })
    ? world.elevation.transition({ x, y, elevation, surfaceId }, { x: tx, y: ty }, actor.radius) : null;
  const blocked = (tx: number, ty: number) => !attempt(tx, ty);
  const accept = (tx: number, ty: number) => {
    const state = attempt(tx, ty);
    if (!state) return;
    x = tx; y = ty; elevation = state.elevation!; surfaceId = state.surfaceId;
  };
  for (let i = 0; i < steps; i++) {
    const targetX = x + dirX * stepDist;
    const targetY = y + dirY * stepDist;
    
    // Prova il movimento diagonale diretto
    if (!blocked(targetX, targetY)) {
      accept(targetX, targetY);
      continue;
    }

    // Se sbatte, prova a scivolare mantenendo l'intera velocità lungo l'asse libero
    const canMoveX = !blocked(x + Math.sign(dirX) * stepDist, y);
    const canMoveY = !blocked(x, y + Math.sign(dirY) * stepDist);

    if (canMoveX && !canMoveY) {
      // Parete orizzontale: scivola orizzontalmente a piena velocità
      accept(x + Math.sign(dirX) * stepDist, y);
    } else if (canMoveY && !canMoveX) {
      // Parete verticale: scivola verticalmente a piena velocità
      accept(x, y + Math.sign(dirY) * stepDist);
    } else {
      // Tentativo standard a componenti ridotte se entrambi o nessuno sono completamente liberi
      accept(x + dirX * stepDist, y);
      accept(x, y + dirY * stepDist);
    }
  }
  return { x, y, ...(actor.elevation !== undefined || elevation !== 0 ? { elevation, surfaceId } : {}) };
}
export function movementSpeed(actor: Actor, time: number): number {
  if (actor.hp <= 0 || actor.deadUntil > time) return 0;
  let speed = actor.speed;
  for (const effect of actor.effects) if (effect.until > time) {
    if (effect.kind === 'haste') speed *= 1.35;
    if (effect.kind === 'slow') speed *= 0.55;
    if (effect.kind === 'root') return 0; // Bersaglio immobilizzato
  }
  return speed;
}

export function terrainSpeed(actor: Vec2 & Elevated, world: World): number {
  const x = actor.x / TILE_SIZE, y = actor.y / TILE_SIZE;
  const s = world.elevation.geometry({ left: x, top: y, right: x + 1e-6, bottom: y + 1e-6 }).surfaces.find(s => s.elevation === elevationOf(actor) && x >= s.x && y >= s.y && x < s.x + s.width && y < s.y + s.height);
  return (s?.terrain ?? world.getTile(Math.floor(x), Math.floor(y))) === 'mud' ? 0.65 : 1;
}

/** Exact geometry sweep at the source floor, including subtile walls. */
export function hasLineOfSight(a: Vec2 & Elevated, b: Vec2 & Elevated, world: World): boolean {
  return world.sameRoom(a, b) && sameElevation(a, b) && sweptWorldHit(a, b, 0, world, elevationOf(a)) === null;
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
        if (!world.sameRoom(a, b) || !sameElevation(a, b)) continue;
        const dx = a.x - b.x, dy = a.y - b.y, dist = Math.hypot(dx, dy), minimum = a.radius + b.radius;
        if (dist >= minimum) continue;
        const nx = dist > 0.0001 ? dx / dist : 1, ny = dist > 0.0001 ? dy / dist : 0;
        const push = (minimum - dist + 0.05) / 2;
        const pa = moveWithCollisions(a, nx, ny, push, world);
        const movedA = Math.hypot(pa.x - a.x, pa.y - a.y);
        Object.assign(a, pa);
        const pb = moveWithCollisions(b, -nx, -ny, push * 2 - movedA, world);
        Object.assign(b, pb);
      }
      const key = `${Math.floor(a.x / 80)},${Math.floor(a.y / 80)}`;
      const bucket = buckets.get(key) ?? []; bucket.push(a); buckets.set(key, bucket);
    }
  }
}
