import type { Vec2 } from './types';

export const OUTPOST = { x: 0, y: 0, radius: 250, clearingRadius: 340, combatMs: 8000 } as const;

export function inOutpost(position: Vec2): boolean {
  return Math.hypot(position.x - OUTPOST.x, position.y - OUTPOST.y) <= OUTPOST.radius;
}

