import type { Vec2 } from './types';

export const OUTPOST = { x: 0, y: 0, radius: 220, clearingRadius: 310, combatMs: 8000 } as const;
export const OUTPOST_HUTS = [
  { x: -192, y: -96, width: 96, height: 96 },
  { x: 96, y: -96, width: 96, height: 96 },
] as const;
export function inOutpost(position: Vec2): boolean {
  return Math.hypot(position.x - OUTPOST.x, position.y - OUTPOST.y) <= OUTPOST.radius;
}
export function outpostHutAt(x: number, y: number): boolean {
  return OUTPOST_HUTS.some(hut => x >= hut.x && x < hut.x + hut.width && y >= hut.y && y < hut.y + hut.height);
}
