import type { Vec2 } from './types';
import { WORLD_DOCUMENT } from './world-content';
import { TILE_SIZE } from './config';

const entrance = WORLD_DOCUMENT.zones.find(z => z.arenaId)?.shape;
/** Compatibility view for the primary gate; queues use the identity of each authored zone. */
export const ARENA_GATE = { x: entrance ? entrance.x * TILE_SIZE : 0, y: entrance ? entrance.y * TILE_SIZE : -115,
  radius: entrance?.kind === 'circle' ? entrance.radius * TILE_SIZE : 70, countdownMs: 3000 } as const;
export const ARENA_DURATION_SECONDS = 180;
export function insideArenaGate(position: Vec2): boolean {
  return nearArenaGate(position, 0);
}
export function nearArenaGate(position: Vec2, margin = 55): boolean {
  const x = position.x / TILE_SIZE, y = position.y / TILE_SIZE, padding = margin / TILE_SIZE;
  return WORLD_DOCUMENT.zones.some(z => {
    if (!z.arenaId) return false;
    const s = z.shape;
    if (s.kind === 'circle') return Math.hypot(x - s.x, y - s.y) <= s.radius + padding;
    return Math.hypot(Math.max(s.x - x, 0, x - s.x - s.width), Math.max(s.y - y, 0, y - s.y - s.height)) <= padding;
  });
}

/** Compact, mirrored layout: 864 × 672 units, four 96 × 96 pillars. */
export function arenaTileIsWall(tx: number, ty: number): boolean {
  if (tx < -9 || tx >= 9 || ty < -7 || ty >= 7) return true;
  const pillarX = (tx >= -3 && tx <= -2) || (tx >= 1 && tx <= 2);
  const pillarY = (ty >= -4 && ty <= -3) || (ty >= 2 && ty <= 3);
  return pillarX && pillarY;
}
