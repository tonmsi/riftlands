import type { World } from '../../shared/world';
import type { SurfaceMaterial } from '../../shared/world-surfaces';
import { legacyRockInWater } from './legacy-water-rocks';

/** Decorative rocks/bushes inherit the nearest visible land; water has no vote. */
export function inferSceneryGround<T extends string>(tx: number, ty: number,
  rawSurface: (x: number, y: number) => T | null | undefined, fallback: T): T {
  for (let radius = 1; radius <= 4; radius++) {
    const scores = new Map<T, number>();
    const offsets: [number, number][] = radius === 1
      ? [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[1,1],[-1,1]] : [];
    if (radius > 1) for (let offset = -radius; offset <= radius; offset++) {
      offsets.push([-radius,offset],[radius,offset]);
      if (Math.abs(offset) !== radius) offsets.push([offset,-radius],[offset,radius]);
    }
    for (const [dx,dy] of offsets) {
      const candidate = rawSurface(tx+dx,ty+dy); if (!candidate || candidate === 'water') continue;
      scores.set(candidate,(scores.get(candidate) ?? 0)+(dx === 0 || dy === 0 ? 2 : 1));
    }
    if (scores.size) {
      let best = scores.keys().next().value!;
      for (const [candidate,score] of scores) if (score > scores.get(best)!) best = candidate;
      return best;
    }
  }
  return fallback;
}

const cache = new WeakMap<World, { revision: string; cells: Map<string, SurfaceMaterial> }>();
/** The same backing decision is used for legacy scenery and the adjacent river bank palette. */
export function legacySceneryGround(world: World, tx: number, ty: number): SurfaceMaterial {
  const revision = `${world.authoringRevision}:${world.lockRevision}`;
  let index = cache.get(world);
  if (!index || index.revision !== revision) { index = { revision, cells: new Map() }; cache.set(world,index); }
  const key = `${tx},${ty}`, known = index.cells.get(key); if (known) return known;
  const dungeonAt = (x: number,y: number) => world.mode === 'world' ? world.dungeons.find(d =>
    x >= d.layout.bounds.minTx && x <= d.layout.bounds.maxTx && y >= d.layout.bounds.minTy && y <= d.layout.bounds.maxTy) : undefined;
  const backing = inferSceneryGround<SurfaceMaterial>(tx,ty,(x,y) => {
    const bounds = world.authoring.document.interiorBounds;
    if (bounds && (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height)) return null;
    if (world.mode === 'arena' && (x < -10 || x > 9 || y < -8 || y > 7)) return null;
    const tile = world.getTile(x,y), dungeon = dungeonAt(x,y);
    if (tile === 'rock' && !dungeon && legacyRockInWater(world,x,y)) return 'water';
    if (tile === 'rock' || tile === 'bush') return null;
    const authored = world.surfaceIndex.at(x,y)?.material;
    if (authored && authored !== 'rock' && authored !== 'bush' && authored !== tile) return authored;
    if (dungeon && tile === dungeon.layout.floor) return 'stone';
    return ['path','mud','water','snow','ice'].includes(tile) ? tile : 'grass';
  },dungeonAt(tx,ty) ? 'stone' : 'grass');
  if (index.cells.size >= 4096) index.cells.delete(index.cells.keys().next().value!);
  index.cells.set(key,backing); return backing;
}
