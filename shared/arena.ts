import type { Vec2 } from './types';

export const ARENA_GATE = { x: 0, y: -115, radius: 60, countdownMs: 1000 } as const;
export const ARENA_DURATION_SECONDS = 180;
export function insideArenaGate(position: Vec2): boolean {
  return Math.hypot(position.x - ARENA_GATE.x, position.y - ARENA_GATE.y) <= ARENA_GATE.radius;
}

/** Compact, mirrored layout: 864 × 672 units, four 96 × 96 pillars. */
export function arenaTileIsWall(tx: number, ty: number): boolean {
  if (tx < -9 || tx >= 9 || ty < -7 || ty >= 7) return true;
  const pillarX = (tx >= -3 && tx <= -2) || (tx >= 1 && tx <= 2);
  const pillarY = (ty >= -4 && ty <= -3) || (ty >= 2 && ty <= 3);
  return pillarX && pillarY;
}
