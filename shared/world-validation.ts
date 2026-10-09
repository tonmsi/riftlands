import { TILE_SIZE, PLAYER_RADIUS } from './config';
import type { DungeonDefinition } from './dungeons';
import { assertValidDungeonDefinition, configuredDungeonTile } from './dungeons';
import { relocateDungeon } from './dungeon-relocation';
import { World } from './world';
import { collidesWorld } from './physics';
import type { WorldDocument } from './world-schema';
import { QUEST_DEFINITIONS } from './narrative';
import { atWarp, mapDocument, warpPosition } from './warps';

export function worldDungeons(document: WorldDocument, catalog: readonly DungeonDefinition[]): DungeonDefinition[] {
  const indoor = new Set((document.interiors ?? []).flatMap(m => m.document.dungeons.filter(p => p.enabled !== false).map(p => p.dungeonId)));
  return catalog.filter(d => !indoor.has(d.id) && (!document.interiorBounds || document.dungeons.some(p => p.dungeonId === d.id)) && document.dungeons.find(p => p.dungeonId === d.id)?.enabled !== false)
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
  const bounds = document.interiorBounds;
  if (bounds) {
    for (const p of document.placements) {
      const asset = assets.get(p.assetId);
      if (asset && (p.x < 0 || p.y < 0 || p.x + asset.columns > bounds.width || p.y + asset.rows > bounds.height)) issues.push(`Asset ${asset.name} oltre i limiti dell'interno.`);
    }
    for (const z of document.zones) if (z.arenaId) issues.push('Gli ingressi arena vanno collocati nell’open world.');
  }
  for (const d of dungeons) {
    for (const e of [d, ...(d.additionalEncounters ?? [])]) for (const p of [e.spawnPoints.boss, ...e.spawnPoints.party]) {
      if (collidesWorld(p.x, p.y, PLAYER_RADIUS, world)) issues.push(`${d.name}: spawn su un ostacolo del catalogo condiviso.`);
    }
  }
  const spawn = { x: (document.spawn.x + (bounds ? .5 : 0)) * TILE_SIZE, y: (document.spawn.y + (bounds ? .5 : 0)) * TILE_SIZE };
  if (collidesWorld(spawn.x, spawn.y, PLAYER_RADIUS + 2, world)) issues.push('Spawn del giocatore bloccato: libera anche le celle vicine.');
  if (!bounds && configuredDungeonTile(Math.floor(spawn.x / TILE_SIZE), Math.floor(spawn.y / TILE_SIZE), dungeons) !== undefined) issues.push('Spawn globale dentro un dungeon: scegli una posizione nel mondo.');
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
  if (!document.interiorBounds) {
    const maps = new Map([['world', world]]);
    for (const m of document.interiors ?? []) {
      const surface = mapDocument(document, m.id);
      maps.set(m.id, new World(document.seed, 16, 'world', surface, worldDungeons(surface, catalog)));
      issues.push(...validateWorld(surface, catalog).map(issue => `${m.name}: ${issue}`));
      for (const p of m.document.dungeons.filter(p => p.enabled !== false)) {
        if ((document.interiors ?? []).some(other => other.id !== m.id && other.document.dungeons.some(q => q.dungeonId === p.dungeonId && q.enabled !== false))) issues.push(`Dungeon ${p.dungeonId} assegnato a più interni.`);
        const d = worldDungeons(surface, catalog).find(d => d.id === p.dungeonId);
        if (d && (d.layout.bounds.minTx < 0 || d.layout.bounds.minTy < 0 || d.layout.bounds.maxTx >= m.width || d.layout.bounds.maxTy >= m.height)) issues.push(`${m.name}: dungeon oltre i limiti dell'interno.`);
      }
    }
    for (const w of document.warps ?? []) {
      if ((document.warps ?? []).some(other => other.id !== w.id && other.from === w.from && atWarp(warpPosition(w.entry), other))) issues.push(`${w.name}: ingresso sovrapposto a un altro warp.`);
      const source = maps.get(w.from), target = maps.get(w.to);
      if (!source || !target) { issues.push(`${w.name}: destinazione assente.`); continue; }
      for (const [label, map, p] of [['ingresso', source, w.entry], ['arrivo', target, w.arrival]] as const) {
        const pos = warpPosition(p);
        if (collidesWorld(pos.x, pos.y, PLAYER_RADIUS + 2, map)) issues.push(`${w.name}: ${label} su un ostacolo.`);
        if (map.arenaAt(pos.x, pos.y)) issues.push(`${w.name}: ${label} sovrapposto a un ingresso arena.`);
      }
      if (w.reverseId) {
        const reverse = document.warps?.find(other => other.id === w.reverseId);
        if (!reverse || reverse.reverseId !== w.id || reverse.from !== w.to || reverse.to !== w.from
          || reverse.entry.x !== w.arrival.x || reverse.entry.y !== w.arrival.y || reverse.arrival.x !== w.entry.x || reverse.arrival.y !== w.entry.y)
          issues.push(`${w.name}: passaggio di ritorno non coerente.`);
      }
    }
  }
  return [...new Set(issues)];
}
