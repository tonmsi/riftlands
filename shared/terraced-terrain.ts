import type { SurfaceCell, TerrainSurfaceCell } from './world-surfaces';

/** Cardinal neighbour bits are shared by wall artwork and its occupied grid cell. */
export const TERRAIN_WALL_SIDES = [
  { dx: 0, dy: -1, bit: 1 }, { dx: 1, dy: 0, bit: 2 },
  { dx: 0, dy: 1, bit: 4 }, { dx: -1, dy: 0, bit: 8 },
] as const;
const key = (x: number, y: number): string => `${x},${y}`;

/** Reserve one inner ring per level without changing the saved logical height field.
 * A bounded distance transform gives adjacent rings consecutive physical heights;
 * historical ground and other decks remain fixed boundary conditions. */
export function deriveTerracedTerrain(cells: readonly SurfaceCell[]): Map<string, TerrainSurfaceCell> {
  const ground = new Map(cells.filter(c => c.kind === 'ground').map(c => [key(c.x, c.y), c]));
  const terraced = new Map([...ground].filter(([, c]) => c.layout === 'terraced'));
  const heights = new Map<string, number>(), buckets: string[][] = [];
  const enqueue = (id: string, height: number) => {
    heights.set(id, height); (buckets[height] ??= []).push(id);
  };
  for (const [id, cell] of terraced) {
    let height = cell.elevation;
    for (const { dx, dy } of TERRAIN_WALL_SIDES) {
      const neighbour = ground.get(key(cell.x + dx, cell.y + dy));
      if (neighbour?.layout !== 'terraced') height = Math.min(height, (neighbour?.elevation ?? 0) + 1);
    }
    enqueue(id, height);
  }
  for (let height = 0; height < buckets.length; height++) for (const id of buckets[height] ?? []) {
    if (heights.get(id) !== height) continue;
    const cell = terraced.get(id)!;
    for (const { dx, dy } of TERRAIN_WALL_SIDES) {
      const next = key(cell.x + dx, cell.y + dy), old = heights.get(next);
      if (old !== undefined && old > height + 1) enqueue(next, height + 1);
    }
  }
  const result = new Map<string, TerrainSurfaceCell>();
  for (const [id, cell] of terraced) {
    const elevation = heights.get(id)!;
    let wallMask = 0;
    for (const { dx, dy, bit } of TERRAIN_WALL_SIDES) {
      const next = key(cell.x + dx, cell.y + dy);
      if (elevation > (heights.get(next) ?? ground.get(next)?.elevation ?? 0)) wallMask |= bit;
    }
    result.set(id, { ...cell, elevation, logicalElevation: cell.elevation,
      ...(wallMask ? { terrainRole: 'wall', wallMask, blocked: true } : {}) });
  }
  return result;
}
