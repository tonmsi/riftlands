import { CHUNK_SIZE, CHUNK_TILES, TILE_SIZE } from './config';
import { arenaTileIsWall } from './arena';
import { DUNGEON_DEFINITIONS, configuredDungeonTile, dungeonEncounters, dungeonStoneTiles, inDungeonApproachCorridor, insideDungeon, onDungeonApproach, type DungeonDefinition } from './dungeons';
import type { Biome, Pickup, TileKind, RoomMode } from './types';
import { WORLD_DOCUMENT } from './world-content';
import { WorldAuthoring, type TileBounds, type GenerationEnvironment } from './world-authoring';
import type { AssetPlacement, WorldDocument } from './world-schema';
import { coordinateHash } from './coordinate-random';
import { EDIT_CHUNK_SIZE, type WorldTileChunk } from './world-tiles';
export { coordinateHash } from './coordinate-random';

export interface NpcSpawn { id: string; x: number; y: number; npcKind: import('./npcs').NpcTemplateId; level: number; }
export interface Chunk { key: string; cx: number; cy: number; tiles: TileKind[]; npcs: NpcSpawn[]; pickups: Pickup[]; }
export const chunkKey = (cx: number, cy: number): string => `${cx},${cy}`;
export const chunkCoords = (x: number, y: number): { cx: number; cy: number } => ({ cx: Math.floor(x / CHUNK_SIZE), cy: Math.floor(y / CHUNK_SIZE) });
export const isSolid = (tile: TileKind): boolean => tile === 'rock' || tile === 'water';

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
  private readonly lockedBosses = new Set<string>();
  lockRevision = 0;
  authoringRevision = 0;
  readonly authoring: WorldAuthoring;
  private readonly manualNpcs = new Map<string, NpcSpawn[]>();
  private readonly lockedTiles = new Map<string, ReadonlySet<string>>();
  private readonly generationEnvironment: GenerationEnvironment;
  constructor(public readonly seed = WORLD_DOCUMENT.seed, private readonly cacheLimit = 160, public readonly mode: RoomMode = 'world',
    document: WorldDocument = WORLD_DOCUMENT, readonly dungeons: readonly DungeonDefinition[] = DUNGEON_DEFINITIONS.filter(d => !d.topology)) {
    this.authoring = new WorldAuthoring(document);
    for (const d of dungeons) for (const p of d.assetPlacements ?? []) {
      if (this.authoring.assets.has(p.assetId)) this.authoring.addPlacement({ ...p, id: `dungeon:${d.id}:${p.id}` });
    }
    for (const n of document.npcs) {
      const x = (n.x + .5) * TILE_SIZE, y = (n.y + .5) * TILE_SIZE, c = chunkCoords(x, y), key = chunkKey(c.cx, c.cy);
      const bucket = this.manualNpcs.get(key) ?? []; bucket.push({ ...n, id: `authored:${n.id}`, x, y }); this.manualNpcs.set(key, bucket);
    }
    for (const d of dungeons.flatMap(dungeonEncounters)) this.lockedTiles.set(d.bossId, new Set(dungeonStoneTiles(d).map(t => `${t.x},${t.y}`)));
    this.generationEnvironment = { tile: (x, y) => this.generateTile(x, y), temperature: (x, y) => this.getTemperature(x, y),
      moisture: (x, y) => this.getMoisture((x + .5) * TILE_SIZE, (y + .5) * TILE_SIZE),
      reserved: (x, y) => configuredDungeonTile(x, y, this.dungeons) !== undefined
        || this.dungeons.some(d => onDungeonApproach(d, { x: (x + .5) * TILE_SIZE, y: (y + .5) * TILE_SIZE }))
        || this.arenaAt((x + .5) * TILE_SIZE, (y + .5) * TILE_SIZE) !== undefined };
  }
  canTraverse(_from: { x: number; y: number }, _to: { x: number; y: number }): boolean { return true; }
  /** Rendering includes image overflow; movement and concealment query only the tile grid. */
  assetsIn(bounds: TileBounds, includeArtwork = true): AssetPlacement[] { return this.mode === 'world' ? this.authoring.assetsIn(bounds, this.generationEnvironment, this.seed, includeArtwork) : []; }
  updateAuthoredTiles(document: WorldDocument, chunks: readonly WorldTileChunk[]): void {
    this.authoring.document = document;
    this.authoring.tiles.update(chunks); this.authoring.invalidateTileGeneration(); this.authoringRevision++;
    for (const c of chunks) for (let y = 0; y < EDIT_CHUNK_SIZE / CHUNK_TILES; y++) for (let x = 0; x < EDIT_CHUNK_SIZE / CHUNK_TILES; x++)
      this.cache.delete(chunkKey(c[0] * EDIT_CHUNK_SIZE / CHUNK_TILES + x, c[1] * EDIT_CHUNK_SIZE / CHUNK_TILES + y));
  }
  locationAt(x: number, y: number): string | undefined { return this.mode === 'world' ? this.authoring.zonesAt(x / TILE_SIZE, y / TILE_SIZE)[0]?.name : undefined; }
  isBlocked(tx: number, ty: number): boolean {
    return isSolid(this.getTile(tx, ty)) || this.assetsIn({ left: tx, top: ty, right: tx + 1, bottom: ty + 1 }, false).some(p => this.authoring.cell(p, tx, ty)?.blocked);
  }
  isHiding(x: number, y: number): boolean {
    const tx = Math.floor(x / TILE_SIZE), ty = Math.floor(y / TILE_SIZE);
    return this.getTile(tx, ty) === 'bush' || this.assetsIn({ left: tx, top: ty, right: tx + 1, bottom: ty + 1 }, false).some(p => ['hide', 'hide-fade'].includes(this.authoring.cell(p, tx, ty)?.visibility ?? ''));
  }
  pvpAt(x: number, y: number): boolean { return this.mode !== 'world' || (this.authoring.rule(x / TILE_SIZE, y / TILE_SIZE, 'pvp') ?? true); }
  arenaAt(x: number, y: number): string | undefined { return this.mode === 'world' ? this.authoring.zonesAt(x / TILE_SIZE, y / TILE_SIZE).find(z => z.arenaId)?.id : undefined; }
  get cacheSize(): number { return this.cache.size; }
  setBossLocked(id: string, locked: boolean): void { if (this.lockedBosses.has(id) !== locked) this.lockRevision++; if (locked) this.lockedBosses.add(id); else this.lockedBosses.delete(id); }
  setBossLocks(ids: Iterable<string>): void { const next = new Set(ids); for (const id of this.lockedBosses) if (!next.has(id)) this.setBossLocked(id, false); for (const id of next) this.setBossLocked(id, true); }
  isBossLocked(id: string): boolean { return this.lockedBosses.has(id); }

  getBiome(x: number, y: number): Biome {
    if (this.mode !== 'world') return 'meadow';
    const moisture = this.getMoisture(x, y);
    return moisture > 0.63 ? 'marsh' : moisture > 0.39 ? 'forest' : 'meadow';
  }

  getMoisture(x: number, y: number): number {
    return this.mode === 'world' ? this.authoring.rule(x / TILE_SIZE, y / TILE_SIZE, 'moisture') ?? noise(x / 1250, y / 1250, this.seed + 411) : 0;
  }

  getTemperature(tx: number, ty: number): number {
    if (this.mode !== 'world') return 1;
    const override = this.authoring.rule(tx + .5, ty + .5, 'temperature');
    if (override !== undefined) return override;
    const warpX = (noise(tx * 0.025, ty * 0.025, this.seed + 701) - 0.5) * 5;
    const warpY = (noise(tx * 0.025, ty * 0.025, this.seed + 709) - 0.5) * 5;
    return noise((tx + warpY) * 0.035, (ty - warpX) * 0.035, this.seed + 805);
  }

  getTile(tx: number, ty: number): TileKind {
    if (this.mode === 'world' && [...this.lockedBosses].some(id => this.lockedTiles.get(id)?.has(`${tx},${ty}`))) return 'rock';
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
    // Dungeon interiors own their terrain. Authored overrides precede procedural terrain outside them.
    const x = (tx + 0.5) * TILE_SIZE, y = (ty + 0.5) * TILE_SIZE;
    const curatedTile = configuredDungeonTile(tx, ty, this.dungeons);
    if (curatedTile) return curatedTile;
    const authored = this.authoring.tiles.at(tx, ty)?.terrain;
    if (authored !== undefined) return authored;
    const curatedDungeonApproach = this.dungeons.some(definition => inDungeonApproachCorridor(definition, { x, y }));
    if (this.dungeons.some(definition => onDungeonApproach(definition, { x, y }))) return 'path';
    // An uninterrupted road network guarantees routes through terrain in every direction.
    const mod = (n: number): number => ((n % 48) + 48) % 48;
    if ((!curatedDungeonApproach && (mod(tx) === 0 || mod(tx) === 47)) || mod(ty) === 0 || mod(ty) === 47) return 'path';
    // Broad landforms with gentle domain warping replace the small, busy pools.
    // Coordinate-only sampling preserves identical authority/prediction worlds.
    const warpX = (noise(tx * 0.025, ty * 0.025, this.seed + 701) - 0.5) * 5;
    const warpY = (noise(tx * 0.025, ty * 0.025, this.seed + 709) - 0.5) * 5;
    const elevation = noise((tx + warpX) * 0.065, (ty + warpY) * 0.065, this.seed);
    const detail = coordinateHash(tx, ty, this.seed + 31);
    const moisture = this.getMoisture(x, y);

    const temperature = this.getTemperature(tx, ty);

    // Shared climate controls terrain and asset eligibility.
    if (temperature < 0.28) {
      // L'acqua alle basse temperature diventa ghiaccio solido calpestabile
      if (elevation < 0.29) return 'ice';
      // Le altitudini elevate diventano vette rocciose
      if (elevation > 0.79 || (elevation > 0.64 && detail < 0.045)) return 'rock';
      // Conca fredda o depressione del terreno: lastra di ghiaccio
      if (elevation < 0.35 && detail < 0.25) return 'ice';
      return 'snow';
    }

    if (elevation < 0.29) return 'water';
    if (elevation > 0.79 || (elevation > 0.64 && detail < 0.045)) return 'rock';
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
    for (let i = 0; this.mode === 'world' && i < 48; i++) {
      const tx = Math.floor(coordinateHash(cx * 41 + i, cy, this.seed + 88) * CHUNK_TILES);
      const ty = Math.floor(coordinateHash(cx, cy * 41 + i, this.seed + 97) * CHUNK_TILES);
      const tile = tiles[ty * CHUNK_TILES + tx];
      const x = (cx * CHUNK_TILES + tx + 0.5) * TILE_SIZE, y = (cy * CHUNK_TILES + ty + 0.5) * TILE_SIZE;
      if (this.isBlocked(cx * CHUNK_TILES + tx, cy * CHUNK_TILES + ty) || tile === 'path'
        || this.dungeons.some(definition => insideDungeon(definition, { x, y }, definition.spawnExclusionMargin))) continue;
      if (chunk.npcs.some(n => Math.hypot(n.x - x, n.y - y) < 120) || chunk.pickups.some(p => Math.hypot(p.x - x, p.y - y) < 100)) continue;
      const rule = this.authoring.rule(x / TILE_SIZE, y / TILE_SIZE, 'npcs');
      const limit = rule?.maxPerChunk ?? 3, weights = rule?.weights ?? { slime: 1, wisp: 1, sentinel: 1 };
      const total = weights.slime + weights.wisp + weights.sentinel;
      if (chunk.npcs.length < limit && total > 0 && coordinateHash(cx * 41 + i, cy, this.seed + 129) < (rule?.density ?? 1)) {
        const index = chunk.npcs.length;
        let weight = coordinateHash(cx, cy + i, this.seed + 123) * total;
        const npcKind = (['slime', 'wisp', 'sentinel'] as const).find(k => (weight -= weights[k]) < 0)!;
        chunk.npcs.push({ id: `npc:${key}:${index}`, x, y, npcKind, level: Math.min(25, 1 + Math.floor(Math.hypot(x, y) / 2200)) });
      } else if (chunk.pickups.length < 2 && (rule?.density ?? 1) > 0) {
        const index = chunk.pickups.length;
        chunk.pickups.push({ id: `pickup:${key}:${index}`, x, y, radius: 12, kind: (['heal', 'haste', 'power', 'weakness'] as const)[Math.floor(coordinateHash(cx + i, cy, this.seed + 345) * 4)] });
      }
    }
    if (this.mode === 'world' && cx === 0 && cy === 0) chunk.pickups.push({ id: 'pickup:camp:heal', x: 168, y: 120, radius: 12, kind: 'heal' });
    if (this.mode === 'world' && cx === -1 && cy === 0) chunk.pickups.push({ id: 'pickup:camp:haste', x: -168, y: 120, radius: 12, kind: 'haste' });
    if (this.mode === 'world') for (const n of this.manualNpcs.get(key) ?? []) if (!this.isBlocked(Math.floor(n.x / TILE_SIZE), Math.floor(n.y / TILE_SIZE))) chunk.npcs.push({ ...n });
    if (this.mode === 'world') for (const dungeon of this.dungeons) for (const npc of dungeon.npcSpawns ?? []) {
      const position = chunkCoords(npc.x, npc.y);
      if (position.cx === cx && position.cy === cy) chunk.npcs.push({ ...npc, id: `dungeon:${dungeon.id}:${npc.id}` });
    }
    if (this.mode === 'world') for (const dungeon of this.dungeons) for (const pickup of dungeon.pickupSpawns ?? []) {
      const position = chunkCoords(pickup.x, pickup.y);
      if (position.cx === cx && position.cy === cy) chunk.pickups.push({ ...pickup, id: `dungeon:${dungeon.id}:${pickup.id}` });
    }
    this.cache.set(key, chunk);
    while (this.cache.size > Math.max(1, this.cacheLimit)) this.cache.delete(this.cache.keys().next().value!);
    return chunk;
  }
}
