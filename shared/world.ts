import { CHUNK_SIZE, CHUNK_TILES, TILE_SIZE, WORLD_SEED } from './config';
import { ARENA_GATE, arenaTileIsWall } from './arena';
import type { Biome, Pickup, TileKind, RoomMode } from './types';

export interface NpcSpawn { id: string; x: number; y: number; npcKind: 'slime' | 'sentinel' | 'wisp'; level: number; }
export interface Chunk { key: string; cx: number; cy: number; tiles: TileKind[]; npcs: NpcSpawn[]; pickups: Pickup[]; }
export const chunkKey = (cx: number, cy: number): string => `${cx},${cy}`;
export const chunkCoords = (x: number, y: number): { cx: number; cy: number } => ({ cx: Math.floor(x / CHUNK_SIZE), cy: Math.floor(y / CHUNK_SIZE) });
export const isSolid = (tile: TileKind): boolean => tile === 'rock' || tile === 'water';

/** Coordinate-addressed PRNG: generation never depends on exploration order. */
export function coordinateHash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (v: number): number => v * v * (3 - 2 * v);
function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const a = coordinateHash(ix, iy, seed), b = coordinateHash(ix + 1, iy, seed);
  const c = coordinateHash(ix, iy + 1, seed), d = coordinateHash(ix + 1, iy + 1, seed);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** Pure terrain plus a bounded LRU cache; neither client nor server retains infinity. */
export class World {
  private cache = new Map<string, Chunk>();
  constructor(public readonly seed = WORLD_SEED, private readonly cacheLimit = 160, public readonly mode: RoomMode = 'world') {}
  get cacheSize(): number { return this.cache.size; }

  getBiome(x: number, y: number): Biome {
    if (this.mode !== 'world') return 'meadow';
    const moisture = noise(x / 1250, y / 1250, this.seed + 411);
    return moisture > 0.63 ? 'marsh' : moisture > 0.39 ? 'forest' : 'meadow';
  }

  getTile(tx: number, ty: number): TileKind {
    const cx = Math.floor(tx / CHUNK_TILES), cy = Math.floor(ty / CHUNK_TILES);
    const cached = this.cache.get(chunkKey(cx, cy));
    if (cached) return cached.tiles[(ty - cy * CHUNK_TILES) * CHUNK_TILES + tx - cx * CHUNK_TILES];
    return this.generateTile(tx, ty);
  }

  private generateTile(tx: number, ty: number): TileKind {
    // Bounded test maps shared by prediction, renderer and authority.
    if (this.mode !== 'world') {
      if (this.mode === 'arena') return arenaTileIsWall(tx, ty) ? 'rock' : 'grass';
      const half = 24;
      return tx < -half || tx >= half || ty < -half || ty >= half ? 'rock' : 'grass';
    }
    // Walkable approach to the physical arena entrance. PvP rules stay unchanged.
    const x = (tx + 0.5) * TILE_SIZE, y = (ty + 0.5) * TILE_SIZE;
    if (Math.hypot(x - ARENA_GATE.x, y - ARENA_GATE.y) < ARENA_GATE.radius + 55 || (Math.abs(x) < 75 && y < -120 && y > ARENA_GATE.y)) return 'path';
    const distance = Math.hypot(tx + 0.5, ty + 0.5);
    if (distance < 4.7) return distance < 2.7 ? 'path' : 'grass';
    // An uninterrupted road network guarantees routes through terrain in every direction.
    const mod = (n: number): number => ((n % 48) + 48) % 48;
    if (mod(tx) === 0 || mod(tx) === 47 || mod(ty) === 0 || mod(ty) === 47) return 'path';
    const elevation = noise(tx * 0.085, ty * 0.085, this.seed);
    const detail = coordinateHash(tx, ty, this.seed + 31);
    const moisture = noise(tx * 0.12, ty * 0.12, this.seed + 491);
    if (elevation < 0.29) return 'water';
    if (elevation > 0.77 || detail < 0.024) return 'rock';
    if ((moisture > 0.58 && detail < 0.52) || detail > 0.947) return 'bush';
    if (moisture > 0.72) return 'mud';
    return 'grass';
  }

  getChunk(cx: number, cy: number): Chunk {
    const key = chunkKey(cx, cy), existing = this.cache.get(key);
    if (existing) { this.cache.delete(key); this.cache.set(key, existing); return existing; }
    const tiles: TileKind[] = [];
    for (let y = 0; y < CHUNK_TILES; y++) for (let x = 0; x < CHUNK_TILES; x++) tiles.push(this.generateTile(cx * CHUNK_TILES + x, cy * CHUNK_TILES + y));
    const chunk: Chunk = { key, cx, cy, tiles, npcs: [], pickups: [] };
    // Try a bounded number of positions and place on walkable tile centres.
    for (let i = 0; this.mode === 'world' && i < 24 && (chunk.npcs.length < 3 || chunk.pickups.length < 2); i++) {
      const tx = Math.floor(coordinateHash(cx * 41 + i, cy, this.seed + 88) * CHUNK_TILES);
      const ty = Math.floor(coordinateHash(cx, cy * 41 + i, this.seed + 97) * CHUNK_TILES);
      const tile = tiles[ty * CHUNK_TILES + tx];
      const x = (cx * CHUNK_TILES + tx + 0.5) * TILE_SIZE, y = (cy * CHUNK_TILES + ty + 0.5) * TILE_SIZE;
      if (isSolid(tile) || tile === 'path' || Math.hypot(x, y) < 890) continue;
      if (chunk.npcs.some(n => Math.hypot(n.x - x, n.y - y) < 120) || chunk.pickups.some(p => Math.hypot(p.x - x, p.y - y) < 100)) continue;
      if (chunk.npcs.length < 3) {
        const index = chunk.npcs.length;
        chunk.npcs.push({ id: `npc:${key}:${index}`, x, y, npcKind: (['slime', 'wisp', 'sentinel'] as const)[Math.floor(coordinateHash(cx, cy + i, this.seed + 123) * 3)], level: Math.min(25, 1 + Math.floor(Math.hypot(x, y) / 2200)) });
      } else {
        const index = chunk.pickups.length;
        chunk.pickups.push({ id: `pickup:${key}:${index}`, x, y, radius: 12, kind: (['heal', 'haste', 'power', 'weakness'] as const)[Math.floor(coordinateHash(cx + i, cy, this.seed + 345) * 4)] });
      }
    }
    if (this.mode === 'world' && cx === 0 && cy === 0) chunk.pickups.push({ id: 'pickup:camp:heal', x: 168, y: 120, radius: 12, kind: 'heal' });
    if (this.mode === 'world' && cx === -1 && cy === 0) chunk.pickups.push({ id: 'pickup:camp:haste', x: -168, y: 120, radius: 12, kind: 'haste' });
    this.cache.set(key, chunk);
    while (this.cache.size > Math.max(1, this.cacheLimit)) this.cache.delete(this.cache.keys().next().value!);
    return chunk;
  }
}
