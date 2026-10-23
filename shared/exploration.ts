import { TILE_SIZE } from './config';
import type { NarrativeProgress } from './narrative';

/** Six tiles around the player; 16×16 tiles packed into 64 hex digits per chunk. */
export const EXPLORATION_RADIUS = 18;
export type Exploration = Record<string, string>;
const EMPTY = '0'.repeat(64);
function cell(mapId: string, tx: number, ty: number): { key: string; digit: number; bit: number } {
  const cx = Math.floor(tx / 16), cy = Math.floor(ty / 16);
  const index = (ty - cy * 16) * 16 + tx - cx * 16;
  return { key: `${mapId}:${cx},${cy}`, digit: Math.floor(index / 4), bit: 1 << (index % 4) };
}
export function tileExplored(exploration: Exploration | undefined, mapId: string, tx: number, ty: number): boolean {
  const { key, digit, bit } = cell(mapId, tx, ty);
  return !!(parseInt(exploration?.[key]?.[digit] ?? '0', 16) & bit);
}
/** Called only for authoritative positions, never for camera movement or map zoom. */
export function revealExploration(progress: NarrativeProgress, mapId: string, x: number, y: number): boolean {
  const tx = Math.floor(x / TILE_SIZE), ty = Math.floor(y / TILE_SIZE);
  const exploration = progress.exploration ??= {};
  let changed = false;
  for (let dy = -EXPLORATION_RADIUS; dy <= EXPLORATION_RADIUS; dy++) {
    for (let dx = -EXPLORATION_RADIUS; dx <= EXPLORATION_RADIUS; dx++) {
      if (dx * dx + dy * dy > EXPLORATION_RADIUS ** 2) continue;
      const { key, digit, bit } = cell(mapId, tx + dx, ty + dy);
      const chunk = exploration[key] ?? EMPTY, value = parseInt(chunk[digit], 16);
      if (value & bit) continue;
      exploration[key] = chunk.slice(0, digit) + (value | bit).toString(16) + chunk.slice(digit + 1);
      changed = true;
    }
  }
  if (changed) progress.revision = (progress.revision ?? 0) + 1;
  return changed;
}
export function validExploration(value: unknown): value is Exploration {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length <= 100_000
    && Object.entries(value).every(([key, bits]) => /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}:-?\d{1,8},-?\d{1,8}$/.test(key)
      && typeof bits === 'string' && /^[0-9a-f]{64}$/.test(bits));
}
