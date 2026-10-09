import { TILE_SIZE } from './config';
import type { DungeonDefinition, DungeonEncounterDefinition, DungeonPassage, DungeonTileRect } from './dungeons';
import type { Vec2 } from './types';

/** Translate every piece of geometry together. Identity, templates and encounter rules are preserved. */
export function relocateDungeon(source: DungeonDefinition, origin: Vec2 & { worldExit?: Vec2 }): DungeonDefinition {
  const d = structuredClone(source);
  if (d.topology) {
    d.area.x = (origin.x + .5) * TILE_SIZE; d.area.y = (origin.y + .5) * TILE_SIZE;
    if (origin.worldExit) d.topology.worldExit = { ...origin.worldExit };
    return d;
  }
  const dx = origin.x - d.layout.bounds.minTx, dy = origin.y - d.layout.bounds.minTy;
  const tile = <T extends Vec2>(p: T): T => ({ ...p, x: p.x + dx, y: p.y + dy });
  const position = <T extends Vec2>(p: T): T => ({ ...p, x: p.x + dx * TILE_SIZE, y: p.y + dy * TILE_SIZE });
  const rect = (b: DungeonTileRect): DungeonTileRect => ({ minTx: b.minTx + dx, maxTx: b.maxTx + dx, minTy: b.minTy + dy, maxTy: b.maxTy + dy });
  const passages = (items: readonly DungeonPassage[]) => items.map(p => ({ ...p, tiles: p.tiles.map(tile), position: position(p.position),
    ...(p.fightState === 'flame' ? { flame: position(p.flame) } : {}) })) as DungeonPassage[];
  const encounter = (e: DungeonEncounterDefinition): DungeonEncounterDefinition => ({ ...e, ejectTo: position(e.ejectTo),
    activationPoints: e.activationPoints?.map(position), visitorTiles: e.visitorTiles?.map(tile),
    regions: Object.fromEntries(Object.entries(e.regions).map(([key, r]) => [key, r.kind === 'circle'
      ? { ...r, center: position(r.center) } : { ...r, points: r.points.map(position) }])) as DungeonEncounterDefinition['regions'] });
  const spawns = (s: DungeonDefinition['spawnPoints']) => ({ boss: position(s.boss), party: s.party.map(position) });
  d.area = position(d.area); d.layout.bounds = rect(d.layout.bounds);
  d.layout.obstacles = d.layout.obstacles.map(rect); d.layout.obstacleTiles = d.layout.obstacleTiles.map(tile); d.layout.tiles = d.layout.tiles?.map(tile);
  d.passages = passages(d.passages); d.spawnPoints = spawns(d.spawnPoints); d.encounter = encounter(d.encounter);
  d.additionalEncounters = d.additionalEncounters?.map(e => ({ ...e, passages: passages(e.passages), spawnPoints: spawns(e.spawnPoints), encounter: encounter(e.encounter) }));
  d.npcSpawns = d.npcSpawns?.map(position); d.pickupSpawns = d.pickupSpawns?.map(position);
  d.assetPlacements = d.assetPlacements?.map(tile);
  d.approach = { ...d.approach, from: position(d.approach.from), to: position(d.approach.to) };
  return d;
}
