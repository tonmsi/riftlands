import { dungeonRoomAt, dungeonRoomContains } from '../../../shared/dungeon-topology';
import { topologyPosition } from '../../../shared/dungeon-topology';
import { CHUNK_TILES, DT, TILE_SIZE } from '../../../shared/config';
import { compileDungeonDraft, reachableDraftTiles, type DungeonDraft } from '../../../shared/dungeon-draft';
import { resolveDungeonBosses } from '../../../shared/dungeon-install';
import { dungeonEncounters, dungeonStoneTiles, dungeonTile, type DungeonDefinition } from '../../../shared/dungeons';
import { World, chunkCoords, chunkKey, type Chunk } from '../../../shared/world';
import type { ClassId, InputCommand, TileKind } from '../../../shared/types';
import { WorldSimulation } from '../../../server/simulation';
import { WORLD_DOCUMENT } from '../../../shared/world-content';
import { newWorldDocument, type WorldAsset } from '../../../shared/world-schema';

/** Isolated authored map: no procedural terrain, population, accounts or network. */
export class DungeonPlaytestWorld extends World {
  private readonly stones: Map<string, Set<string>>;
  private readonly encounters: DungeonDefinition[];
  constructor(readonly dungeon: DungeonDefinition, assets: readonly WorldAsset[] = WORLD_DOCUMENT.assets) {
    const document = newWorldDocument();
    document.assets = assets.map(a => ({ ...a, generation: { ...a.generation, enabled: false } }));
    super(document.seed, 16, 'world', document, [dungeon]);
    this.encounters = dungeonEncounters(dungeon);
    this.stones = new Map(this.encounters.map(e => [e.bossId, new Set(dungeonStoneTiles(e).map(t => `${t.x},${t.y}`))]));
  }
  override canTraverse(from: {x:number;y:number}, to: {x:number;y:number}): boolean {
    const t = this.dungeon.topology; if (!t) return true;
    const origin = {x:this.dungeon.layout.bounds.minTx,y:this.dungeon.layout.bounds.minTy}, room = dungeonRoomAt(t,origin,from);
    return !!room && dungeonRoomAt(t,origin,to)?.id === room.id;
  }
  override getBiome() { return 'meadow' as const; }
  override getMoisture() { return 0; }
  override getTile(tx: number, ty: number): TileKind {
    const b = this.dungeon.layout.bounds;
    if (this.dungeon.topology && !this.dungeon.topology.rooms.some(r => dungeonRoomContains(r, tx-b.minTx, ty-b.minTy))) return 'rock';
    if (tx < b.minTx - 2 || tx > b.maxTx + 2 || ty < b.minTy - 2 || ty > b.maxTy + 2) return 'rock';
    if (this.encounters.some(e => this.isBossLocked(e.bossId) && this.stones.get(e.bossId)!.has(`${tx},${ty}`))) return 'rock';
    return dungeonTile(this.dungeon, tx, ty) ?? 'grass';
  }
  override getChunk(cx: number, cy: number): Chunk {
    const within = (p: { x: number; y: number }) => { const c = chunkCoords(p.x, p.y); return c.cx === cx && c.cy === cy; };
    return { key: chunkKey(cx, cy), cx, cy,
      tiles: Array.from({ length: CHUNK_TILES ** 2 }, (_, i) => this.getTile(cx * CHUNK_TILES + i % CHUNK_TILES, cy * CHUNK_TILES + Math.floor(i / CHUNK_TILES))),
      npcs: (this.dungeon.npcSpawns ?? []).filter(within).map(p => ({ ...p })),
      pickups: (this.dungeon.pickupSpawns ?? []).filter(within).map(p => ({ ...p })),
    };
  }
}

export function createDungeonPlaytest(draft: DungeonDraft, classId: ClassId = 'warrior', assets: readonly WorldAsset[] = WORLD_DOCUMENT.assets) {
  const isolated = structuredClone(draft);
  isolated.origin = { x: 256, y: 256 }; // Far from world sanctuary/arena rules, irrespective of placement in the editor.
  const compiled = compileDungeonDraft(isolated, assets), definition = compiled.definition;
  const bosses = resolveDungeonBosses(compiled);
  const b = definition.layout.bounds;
  const anchor = isolated.entities.find(e => e.kind === 'party') ?? isolated.entities.find(e => e.kind === 'boss')!;
  const start = definition.spawnPoints.party[0] ?? definition.spawnPoints.boss;
  const reachable = reachableDraftTiles(isolated, anchor, assets);
  const entrance = definition.passages.filter(p => p.tiles.some(t => (t.x === b.minTx || t.x === b.maxTx || t.y === b.minTy || t.y === b.maxTy) && reachable.has(`${t.x - b.minTx},${t.y - b.minTy}`)))
    .sort((a, b) => Math.hypot(a.position.x - start.x, a.position.y - start.y) - Math.hypot(b.position.x - start.x, b.position.y - start.y))[0];
  if (!entrance && !definition.topology) throw new Error('Apri un ingresso sul bordo con erba o pavimento e collegalo alla stanza per iniziare la prova fuori dal dungeon.');
  const tile = entrance?.tiles[0] ?? { x: b.minTx, y: b.minTy };
  const normal = tile.x === b.minTx ? { x: -1, y: 0 } : tile.x === b.maxTx ? { x: 1, y: 0 } : tile.y === b.minTy ? { x: 0, y: -1 } : { x: 0, y: 1 };
  const spawn = definition.topology ? topologyPosition({ x: b.minTx, y: b.minTy }, definition.topology.entry) : { x: entrance!.position.x + normal.x * TILE_SIZE * 2, y: entrance!.position.y + normal.y * TILE_SIZE * 2 };
  const encounters = dungeonEncounters(definition);
  if (!definition.topology) for (const encounter of encounters) encounter.encounter.ejectTo = { ...spawn };
  const world = new DungeonPlaytestWorld(definition, assets);
  const simulation = new WorldSimulation(734291, 1_000_000, undefined, 'world', { world, dungeons: encounters, bosses: new Map(bosses.map(boss => [boss.id, boss])), spawn });
  const player = simulation.addPlayer({ id: 'local-playtest', name: 'Prova locale', nameLower: 'prova locale', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0, gold: 0 }, classId);
  // The offline editor previews the full catalog, independent of account progression.
  player.loadout = undefined;
  let seq = 0, accumulator = 0, warpReady = simulation.now + 1200;
  let warpArrival: { x: number; y: number } | undefined;
  return { simulation, player, definition, world,
    step(elapsed: number, input: Omit<InputCommand, 'seq'>) {
      accumulator += Math.min(.1, elapsed);
      let stepped = false;
      while (accumulator >= DT) {
        simulation.enqueueInput(player.id, { ...input, seq: ++seq });
        simulation.step(); accumulator -= DT; stepped = true;
        if (definition.topology && simulation.now >= warpReady) {
          const t = definition.topology, origin = { x: b.minTx, y: b.minTy };
          if (warpArrival && Math.hypot(player.x-warpArrival.x,player.y-warpArrival.y) < TILE_SIZE*.55) continue;
          warpArrival = undefined;
          const w = t.warps.find(w => { const p = topologyPosition(origin, w.from); return Math.hypot(player.x-p.x, player.y-p.y) < TILE_SIZE*.45; });
          if (w) { for (const encounter of simulation.bosses.values()) encounter.participantLeft(player.id, simulation.world); warpArrival = topologyPosition(origin, w.to); Object.assign(player, warpArrival); }
        }
      }
      return stepped;
    },
  };
}
export type DungeonPlaytest = ReturnType<typeof createDungeonPlaytest>;
