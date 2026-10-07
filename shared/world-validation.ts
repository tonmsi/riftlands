import { TILE_SIZE, PLAYER_RADIUS } from './config';
import type { DungeonDefinition } from './dungeons';
import { assertValidDungeonDefinition, configuredDungeonTile } from './dungeons';
import { relocateDungeon } from './dungeon-relocation';
import { World } from './world';
import { collidesWorld } from './physics';
import type { WorldDocument } from './world-schema';
import { QUEST_DEFINITIONS } from './narrative';

export function worldDungeons(document: WorldDocument, catalog: readonly DungeonDefinition[]): DungeonDefinition[] {
  return catalog.filter(d => document.dungeons.find(p => p.dungeonId === d.id)?.enabled !== false)
    .map(d => { const p = document.dungeons.find(p => p.dungeonId === d.id); return p ? relocateDungeon(d, p) : d; });
}
/** Referential and spatial checks supplement format validation before installation. */
export function validateWorld(document: WorldDocument, catalog: readonly DungeonDefinition[]): string[] {
  const issues: string[] = [], dungeons = worldDungeons(document, catalog), known = new Set(catalog.map(d => d.id));
  for (const zone of document.zones) if (zone.questId && QUEST_DEFINITIONS[zone.questId]?.objective.kind !== 'reach-area')
    issues.push(`${zone.name}: missione di esplorazione non disponibile: ${zone.questId}.`);
  for (const p of document.dungeons) if (!known.has(p.dungeonId)) issues.push(`Dungeon assente dal catalogo: ${p.dungeonId}.`);
  const assets = new Map(document.assets.map(a => [a.id, a]));
  for (const d of catalog) for (const p of d.assetPlacements ?? []) {
    const a = assets.get(p.assetId), b = d.layout.bounds;
    if (!a) issues.push(`${d.name}: asset assente dal catalogo condiviso: ${p.assetId}.`);
    else if (p.x < b.minTx || p.y < b.minTy || p.x + a.columns > b.maxTx + 1 || p.y + a.rows > b.maxTy + 1)
      issues.push(`${d.name}: asset ${a.name} fuori dai limiti del dungeon.`);
  }
  for (const d of dungeons) {
    try { assertValidDungeonDefinition(d); } catch (e) { issues.push((e as Error).message); }
    for (const other of dungeons) if (d.id < other.id && Math.hypot(d.area.x - other.area.x, d.area.y - other.area.y) < d.area.radius + other.area.radius + 192)
      issues.push(`Dungeon sovrapposti o troppo vicini: ${d.name}, ${other.name}.`);
  }
  const world = new World(document.seed, 16, 'world', document, dungeons);
  for (const d of dungeons) {
    for (const e of [d, ...(d.additionalEncounters ?? [])]) for (const p of [e.spawnPoints.boss, ...e.spawnPoints.party]) {
      if (collidesWorld(p.x, p.y, PLAYER_RADIUS, world)) issues.push(`${d.name}: spawn su un ostacolo del catalogo condiviso.`);
    }
  }
  const spawn = { x: document.spawn.x * TILE_SIZE, y: document.spawn.y * TILE_SIZE };
  if (collidesWorld(spawn.x, spawn.y, PLAYER_RADIUS + 2, world)) issues.push('Spawn del giocatore bloccato: libera anche le celle vicine.');
  if (configuredDungeonTile(Math.floor(spawn.x / TILE_SIZE), Math.floor(spawn.y / TILE_SIZE), dungeons) !== undefined) issues.push('Spawn globale dentro un dungeon: scegli una posizione nel mondo.');
  if (world.arenaAt(spawn.x, spawn.y)) issues.push('Lo spawn del giocatore si trova dentro un ingresso arena.');
  for (const n of document.npcs) {
    if (collidesWorld((n.x + .5) * TILE_SIZE, (n.y + .5) * TILE_SIZE, 19, world)) issues.push(`NPC ${n.id} su un ostacolo.`);
    if (configuredDungeonTile(n.x, n.y, dungeons) !== undefined) issues.push(`NPC ${n.id} dentro un dungeon: usa il Dungeon Maker.`);
  }
  for (const p of document.placements) {
    const a = world.authoring.assets.get(p.assetId)!;
    for (let y = 0; y < a.rows; y++) for (let x = 0; x < a.columns; x++) if (configuredDungeonTile(p.x + x, p.y + y, dungeons) !== undefined) {
      issues.push(`Asset ${a.name} dentro un dungeon: modifica il dungeon nel Dungeon Maker.`); y = a.rows; break;
    }
  }
  for (const z of document.zones) if (z.arenaId && z.arenaId !== 'arena-1') issues.push(`${z.name}: arena ${z.arenaId} non implementata. Usa arena-1; ogni ingresso ha una coda separata.`);
  return [...new Set(issues)];
}
