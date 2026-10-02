import type { Vec2 } from './types';
import { WORLD_DOCUMENT } from './world-content';
import { TILE_SIZE } from './config';
import { WorldAuthoring } from './world-authoring';

const sanctuary = WORLD_DOCUMENT.zones.find(z => z.id === 'crossroads-safe')?.shape;
export const OUTPOST = { x: WORLD_DOCUMENT.spawn.x * TILE_SIZE, y: WORLD_DOCUMENT.spawn.y * TILE_SIZE,
  radius: sanctuary?.kind === 'circle' ? sanctuary.radius * TILE_SIZE : 250, clearingRadius: 340, combatMs: 8000 } as const;
const authoring = new WorldAuthoring(WORLD_DOCUMENT);

export function inOutpost(position: Vec2): boolean {
  return authoring.rule(position.x / TILE_SIZE, position.y / TILE_SIZE, 'pvp') === false;
}
