import { CHUNK_TILES, DT, TILE_SIZE } from '../shared/config';
import { compileDungeonDraft, reachableDraftTiles, type DungeonDraft } from '../shared/dungeon-draft';
import { resolveDungeonBosses } from '../shared/dungeon-install';
import { dungeonEncounters, dungeonStoneTiles, dungeonTile, type DungeonDefinition } from '../shared/dungeons';
import { World, chunkCoords, chunkKey, type Chunk } from '../shared/world';
import type { ClassId, InputCommand, TileKind } from '../shared/types';
import { WorldSimulation } from '../server/simulation';

/** Isolated authored map: no procedural terrain, population, accounts or network. */
export class DungeonPlaytestWorld extends World {
  private readonly stones: Set<string>;
  private readonly encounters: DungeonDefinition[];
  constructor(readonly dungeon: DungeonDefinition) {
    super();
    this.encounters = dungeonEncounters(dungeon);
    this.stones = new Set(this.encounters.flatMap(dungeonStoneTiles).map(t => `${t.x},${t.y}`));
  }
  override getBiome() { return 'meadow' as const; }
  override getMoisture() { return 0; }
  override getTile(tx: number, ty: number): TileKind {
    const b = this.dungeon.layout.bounds;
    if (tx < b.minTx - 2 || tx > b.maxTx + 2 || ty < b.minTy - 2 || ty > b.maxTy + 2) return 'rock';
    if (this.encounters.some(e => this.isBossLocked(e.bossId)) && this.stones.has(`${tx},${ty}`)) return 'rock';
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

export function createDungeonPlaytest(draft: DungeonDraft, classId: ClassId = 'warrior') {
  const isolated = structuredClone(draft);
  isolated.origin = { x: 256, y: 256 }; // Far from world sanctuary/arena rules, irrespective of placement in the editor.
  const compiled = compileDungeonDraft(isolated), definition = compiled.definition;
  const bosses = resolveDungeonBosses(compiled);
  const b = definition.layout.bounds;
  const start = definition.spawnPoints.party[0];
  const reachable = reachableDraftTiles(isolated, isolated.entities.find(e => e.kind === 'party')!);
  const entrance = definition.passages.filter(p => p.tiles.some(t => (t.x === b.minTx || t.x === b.maxTx || t.y === b.minTy || t.y === b.maxTy) && reachable.has(`${t.x - b.minTx},${t.y - b.minTy}`)))
    .sort((a, b) => Math.hypot(a.position.x - start.x, a.position.y - start.y) - Math.hypot(b.position.x - start.x, b.position.y - start.y))[0];
  if (!entrance) throw new Error('Apri un ingresso sul bordo con erba o pavimento e collegalo agli spawn gruppo per iniziare la prova fuori dal dungeon.');
  const tile = entrance.tiles[0];
  const normal = tile.x === b.minTx ? { x: -1, y: 0 } : tile.x === b.maxTx ? { x: 1, y: 0 } : tile.y === b.minTy ? { x: 0, y: -1 } : { x: 0, y: 1 };
  const spawn = { x: entrance.position.x + normal.x * TILE_SIZE * 2, y: entrance.position.y + normal.y * TILE_SIZE * 2 };
  const encounters = dungeonEncounters(definition);
  for (const encounter of encounters) encounter.encounter.ejectTo = { ...spawn };
  const world = new DungeonPlaytestWorld(definition);
  const simulation = new WorldSimulation(734291, 1_000_000, undefined, 'world', { world, dungeons: encounters, bosses: new Map(bosses.map(boss => [boss.id, boss])), spawn });
  const player = simulation.addPlayer({ id: 'local-playtest', name: 'Prova locale', nameLower: 'prova locale', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0, gold: 0 }, classId);
  let seq = 0, accumulator = 0;
  return { simulation, player, definition, world,
    step(elapsed: number, input: Omit<InputCommand, 'seq'>) {
      accumulator += Math.min(.1, elapsed);
      let stepped = false;
      while (accumulator >= DT) {
        simulation.enqueueInput(player.id, { ...input, seq: ++seq });
        simulation.step(); accumulator -= DT; stepped = true;
      }
      return stepped;
    },
  };
}
export type DungeonPlaytest = ReturnType<typeof createDungeonPlaytest>;
