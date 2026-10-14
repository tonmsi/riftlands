import type { World } from '../../shared/world';

const cached = new WeakMap<World, { authoring: number; locks: number; cells: Map<string, boolean> }>();
const cardinal = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

/** A small legacy rock surrounded by water is scenery in that water, rather than a square grass island. */
export function legacyRockInWater(world: World, tx: number, ty: number): boolean {
  if (world.getTile(tx, ty) !== 'rock') return false;
  let index = cached.get(world);
  if (!index || index.authoring !== world.authoringRevision || index.locks !== world.lockRevision) {
    index = { authoring: world.authoringRevision, locks: world.lockRevision, cells: new Map() }; cached.set(world, index);
  }
  const key = `${tx},${ty}`, known = index.cells.get(key); if (known !== undefined) return known;
  const cells = new Map<string, readonly [number, number]>([[key, [tx, ty]]]);
  const queue: (readonly [number, number])[] = [[tx, ty]];
  let surrounded = true;
  for (let i = 0; i < queue.length && surrounded; i++) {
    const [x, y] = queue[i];
    if (world.surfaceIndex.at(x, y) || world.dungeons.some(d => x >= d.layout.bounds.minTx && x <= d.layout.bounds.maxTx
      && y >= d.layout.bounds.minTy && y <= d.layout.bounds.maxTy)) { surrounded = false; break; }
    for (const [dx, dy] of cardinal) {
      const nx = x + dx, ny = y + dy, tile = world.getTile(nx, ny);
      if (tile === 'water') continue;
      if (tile !== 'rock') { surrounded = false; break; }
      const neighborKey = `${nx},${ny}`;
      if (cells.has(neighborKey)) continue;
      cells.set(neighborKey, [nx, ny]); queue.push([nx, ny]);
      // Large rock masses retain their ordinary land or dungeon backing.
      if (cells.size > 16) { surrounded = false; break; }
    }
  }
  for (const cellKey of cells.keys()) {
    if (index.cells.size >= 4096) index.cells.delete(index.cells.keys().next().value!);
    index.cells.set(cellKey, surrounded);
  }
  return surrounded;
}
