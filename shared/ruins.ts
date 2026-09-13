import type { Vec2 } from './types';

export const RUINS = { x: 0, y: -3840, radius: 340 } as const;
export function inRuins(position: Vec2, margin = 0): boolean {
  return Math.hypot(position.x - RUINS.x, position.y - RUINS.y) < RUINS.radius + margin;
}

/** Curated approach: deterministic on both client and server, but less artificial than a straight axial road. */
export function ruinsRoadCenter(y: number): number {
  const start = -300, end = RUINS.y + 300;
  const t = Math.max(0, Math.min(1, (start - y) / (start - end)));
  return Math.sin(t * Math.PI * 2) * 145 + Math.sin(t * Math.PI * 5) * 48;
}

export function onRuinsRoad(position: Vec2): boolean {
  return position.y <= -300 && position.y >= RUINS.y + 300 && Math.abs(position.x - ruinsRoadCenter(position.y)) < 70;
}
export function ruinsTile(tx: number, ty: number): 'rock' | 'path' | undefined {
  const x = tx * 48 - RUINS.x, y = ty * 48 - RUINS.y;
  if (Math.abs(x + 24) > 384 || Math.abs(y + 24) > 336) return undefined;
  const pillars = (x === -192 || x === 144) && (y === -144 || y === 96);
  const walls = (Math.abs(x + 24) > 312 && Math.abs(y + 24) < 264) || (Math.abs(y + 24) > 264 && Math.abs(x + 24) > 96);
  return pillars || walls ? 'rock' : 'path';
}
