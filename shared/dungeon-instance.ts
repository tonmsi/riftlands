import { dungeonRoomAt, dungeonRoomContains } from './dungeon-topology';
import { CHUNK_TILES, TILE_SIZE } from './config';
import { dungeonEncounters, dungeonTile, dungeonStoneTiles, type DungeonDefinition } from './dungeons';
import { World, chunkCoords, chunkKey, type Chunk } from './world';
import { WORLD_DOCUMENT } from './world-content';
import { newWorldDocument } from './world-schema';
import type { TileKind } from './types';

/** Same instance boundary as PvP rooms; only authored dungeon terrain and population exist here. */
export class DungeonInstanceWorld extends World {
  constructor(readonly dungeon: DungeonDefinition, seed = WORLD_DOCUMENT.seed) {
    const document = newWorldDocument(seed);
    document.assets = WORLD_DOCUMENT.assets.map(a => ({ ...a, generation: { ...a.generation, enabled: false } }));
    const p = dungeon.topology!.entry;
    document.spawn = { x: dungeon.layout.bounds.minTx + p.x, y: dungeon.layout.bounds.minTy + p.y };
    super(seed, 160, 'world', document, [dungeon]);
  }
  override canTraverse(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
    const origin = { x: this.dungeon.layout.bounds.minTx, y: this.dungeon.layout.bounds.minTy }, t = this.dungeon.topology!;
    const room = dungeonRoomAt(t,origin,from); return !!room && dungeonRoomAt(t,origin,to)?.id === room.id;
  }
  override getTile(tx: number, ty: number): TileKind {
    for (const e of dungeonEncounters(this.dungeon)) if (this.isBossLocked(e.bossId) && dungeonStoneTiles(e).some(t => t.x === tx && t.y === ty)) return 'rock';
    const b = this.dungeon.layout.bounds, x = tx - b.minTx, y = ty - b.minTy;
    if (!this.dungeon.topology!.rooms.some(r => dungeonRoomContains(r, x, y))) return 'rock';
    return dungeonTile(this.dungeon, tx, ty) ?? 'rock';
  }
  override getChunk(cx: number, cy: number): Chunk {
    const within = (p: { x: number; y: number }) => { const c = chunkCoords(p.x, p.y); return c.cx === cx && c.cy === cy; };
    return { key: chunkKey(cx, cy), cx, cy,
      tiles: Array.from({ length: CHUNK_TILES ** 2 }, (_, i) => this.getTile(cx * CHUNK_TILES + i % CHUNK_TILES, cy * CHUNK_TILES + Math.floor(i / CHUNK_TILES))),
      npcs: (this.dungeon.npcSpawns ?? []).filter(within).map(n => ({ ...n, id: `dungeon:${this.dungeon.id}:${n.id}` })),
      pickups: (this.dungeon.pickupSpawns ?? []).filter(within).map(p => ({ ...p, id: `dungeon:${this.dungeon.id}:${p.id}` })),
    };
  }
  override pvpAt(_x: number, _y: number): boolean { return false; }
}
