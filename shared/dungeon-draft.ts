import { BOSS_BY_ID } from './bosses';
import { TILE_SIZE } from './config';
import { assertValidDungeonDefinition, dungeonEncounters, flameBarrierFromTiles, dungeonTile, DEFAULT_DUNGEON_THEME, type DungeonDefinition, type DungeonRegion } from './dungeons';
import { NPC_CATALOG, type NpcKind } from './npcs';
import type { TileKind, Vec2 } from './types';
import { World, isSolid } from './world';
import { collidesWorld } from './physics';

export const TERRAIN_CATALOG: Record<TileKind, { name: string; color: string }> = {
  grass: { name: 'Erba', color: '#4d6846' }, path: { name: 'Pavimento', color: '#948465' },
  rock: { name: 'Muro', color: '#353f43' }, water: { name: 'Acqua', color: '#376b83' },
  bush: { name: 'Cespuglio', color: '#2c5039' }, mud: { name: 'Fango', color: '#675444' },
};
export interface DraftEntity extends Vec2 {
  id: string; kind: 'npc' | 'boss' | 'party' | 'activation' | 'flame'; encounterId?: string; span?: number; vertical?: boolean; aggroRadius?: number; template: string; label: string; level: number; radius: number;
}
export const DEFAULT_BOSS_AGGRO_RADIUS = 288;
export interface DraftEncounter { id: string; name: string; x: number; y: number; width: number; height: number; visitorTiles?: Vec2[]; }
export interface DungeonDraft {
  version: 1; id: string; name: string; width: number; height: number;
  encounters: DraftEncounter[]; origin: Vec2; tiles: TileKind[]; entities: DraftEntity[];
}
export function newDungeonDraft(width = 24, height = 18): DungeonDraft {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || width > 96 || height > 96) throw new Error('Dimensioni consentite: 8–96 caselle.');
  return { version: 1, id: 'nuovo-dungeon', name: 'Dungeon senza nome', width, height, origin: { x: 0, y: -144 }, encounters: [{ id: 'main', name: 'Incontro 1', x: 0, y: 0, width, height }],
    tiles: Array.from({ length: width * height }, (_, i) => i % width === 0 || i % width === width - 1 || i < width || i >= width * (height - 1) ? 'rock' : 'path'),
    entities: [] };
}

/** Import untrusted drafts without retaining prototypes, unknown fields or unbounded arrays. */
export function parseDungeonDraft(raw: string): DungeonDraft {
  if (raw.length > 2_000_000) throw new Error('File troppo grande (massimo 2 MB).');
  const value = JSON.parse(raw) as DungeonDraft;
  const fail = (): never => { throw new Error('Bozza non valida: controlla versione, dimensioni, terreno ed entità.'); };
  if (!value || value.version !== 1 || typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.id)
    || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80) fail();
  const draft = newDungeonDraft(value.width, value.height);
  if (!value.origin || ![value.origin.x, value.origin.y].every(n => Number.isInteger(n) && Math.abs(n) < 100_000)
    || !Array.isArray(value.tiles) || value.tiles.length !== value.width * value.height
    || value.tiles.some(tile => !Object.hasOwn(TERRAIN_CATALOG, tile)) || !Array.isArray(value.entities) || value.entities.length > 500) fail();
  const encounters = value.encounters ?? draft.encounters;
  if (!Array.isArray(encounters) || !encounters.length || encounters.length > 16) fail();
  const groupIds = new Set<string>();
  draft.encounters = encounters.map(group => {
    if (!group || typeof group.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(group.id) || groupIds.has(group.id)
      || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 80
      || ![group.x, group.y, group.width, group.height].every(Number.isInteger)
      || group.x < 0 || group.y < 0 || group.width < 3 || group.height < 3 || group.x + group.width > value.width || group.y + group.height > value.height) fail();
    groupIds.add(group.id);
    const seen = new Set<string>();
    if (group.visitorTiles !== undefined && (!Array.isArray(group.visitorTiles) || group.visitorTiles.length > value.width * value.height
      || group.visitorTiles.some(p => !p || !Number.isInteger(p.x) || !Number.isInteger(p.y)
        || p.x < 0 || p.y < 0 || p.x >= value.width || p.y >= value.height
        || seen.has(`${p.x},${p.y}`) || !seen.add(`${p.x},${p.y}`)))) fail();
    return { id: group.id, name: group.name, x: group.x, y: group.y, width: group.width, height: group.height,
      ...(group.visitorTiles !== undefined ? { visitorTiles: group.visitorTiles.map(p => ({x:p.x,y:p.y})) } : {}) };
  });
  const ids = new Set<string>();
  const entities = value.entities.map(entity => {
    if (!entity || typeof entity.id !== 'string' || !/^[a-zA-Z0-9:-]{1,100}$/.test(entity.id) || ids.has(entity.id)
      || !['npc', 'boss', 'party', 'activation', 'flame'].includes(entity.kind) || typeof entity.template !== 'string' || entity.template.length > 100
      || typeof entity.label !== 'string' || entity.label.length > 80
      || !Number.isInteger(entity.x) || !Number.isInteger(entity.y) || entity.x < 0 || entity.y < 0 || entity.x >= value.width || entity.y >= value.height
      || !Number.isInteger(entity.level) || entity.level < 1 || entity.level > 25
      || !Number.isFinite(entity.radius) || entity.radius < 1 || entity.radius > 96
      || (entity.kind === 'npc' && !Object.hasOwn(NPC_CATALOG, entity.template))) fail();
    if (entity.encounterId !== undefined && !groupIds.has(entity.encounterId)) fail();
    if (entity.aggroRadius !== undefined && (entity.kind !== 'boss' || !Number.isFinite(entity.aggroRadius) || entity.aggroRadius <= 0 || entity.aggroRadius > 10000)) fail();
    if (entity.kind === 'flame' && ((!Number.isInteger(entity.span ?? 1) || (entity.span ?? 1) < 1 || (entity.span ?? 1) > 96)
      || (entity.vertical !== undefined && typeof entity.vertical !== 'boolean'))) fail();
    ids.add(entity.id);
    return { ...(entity.aggroRadius !== undefined ? { aggroRadius: entity.aggroRadius } : {}), ...(entity.encounterId !== undefined ? { encounterId: entity.encounterId } : {}), ...(entity.kind === 'flame' ? { span: entity.span ?? 1, vertical: entity.vertical ?? false } : {}), id: entity.id, kind: entity.kind, template: entity.template, label: entity.label, x: entity.x, y: entity.y, level: entity.level,
      radius: entity.kind === 'npc' ? NPC_CATALOG[entity.template as NpcKind].radius : entity.kind === 'party' ? 15 : entity.radius };
  });
  return { ...draft, id: value.id, name: value.name, origin: { x: value.origin.x, y: value.origin.y }, tiles: [...value.tiles], entities };
}

export class DraftWorld extends World {
  constructor(readonly draft: DungeonDraft) { super(); }
  override getTile(tx: number, ty: number): TileKind {
    return tx < 0 || ty < 0 || tx >= this.draft.width || ty >= this.draft.height ? 'rock' : this.draft.tiles[ty * this.draft.width + tx];
  }
}
export function draftEntityPosition(entity: Vec2): Vec2 { return { x: (entity.x + .5) * TILE_SIZE, y: (entity.y + .5) * TILE_SIZE }; }

export function draftFlameTiles(entity: DraftEntity): Vec2[] {
  return Array.from({ length: entity.span ?? 1 }, (_, i) => ({ x: entity.x + (entity.vertical ? 0 : i), y: entity.y + (entity.vertical ? i : 0) }));
}
export function validateDungeonDraft(draft: DungeonDraft): string[] {
  const issues: string[] = [];
  const bosses = draft.entities.filter(e => e.kind === 'boss'), party = draft.entities.filter(e => e.kind === 'party');
  if (!bosses.length || bosses.length > 32) issues.push('Posiziona da 1 a 32 boss, anche come segnaposto.');
  const groups = draft.encounters;
  for (const group of groups) {
    if (group.visitorTiles?.some(p => p.x < group.x || p.y < group.y || p.x >= group.x + group.width || p.y >= group.y + group.height))
      issues.push(`${group.name}: zona visitatori fuori dalla regione dell'incontro.`);
    const belongs = (e: DraftEntity) => (e.encounterId ?? groups[0].id) === group.id;
    if (!bosses.some(belongs)) issues.push(`${group.name}: manca un boss.`);
    const count = party.filter(belongs).length;
    if (count < 1 || count > 5) issues.push(`${group.name}: posiziona da 1 a 5 spawn gruppo.`);
    for (const e of draft.entities.filter(e => e.kind !== 'npc' && belongs(e))) {
      if (e.x < group.x || e.y < group.y || e.x >= group.x + group.width || e.y >= group.y + group.height) issues.push(`${e.label}: fuori dalla regione del suo incontro.`);
      if (e.kind === 'flame' && draftFlameTiles(e).some(t => t.x < group.x || t.y < group.y || t.x >= group.x + group.width || t.y >= group.y + group.height)) issues.push(`${e.label}: la barriera oltrepassa la regione del suo incontro.`);
      const clearance = e.kind === 'boss' ? e.radius + 14 : e.radius;
      if (e.kind !== 'flame' && Math.min(e.x+.5-group.x,e.y+.5-group.y,group.x+group.width-e.x-.5,group.y+group.height-e.y-.5)*TILE_SIZE < clearance) issues.push(`${e.label}: ingombro troppo vicino al bordo della regione.`);
    }
  }
  for (let i = 0; i < groups.length; i++) for (const b of groups.slice(i + 1)) {
    const a = groups[i];
    if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) issues.push(`${a.name} e ${b.name}: regioni di incontri separati sovrapposte.`);
  }
  const world = new DraftWorld(draft);
  for (const entity of draft.entities) {
    if (entity.kind === 'flame') {
      for (const tile of draftFlameTiles(entity)) if (isSolid(world.getTile(tile.x, tile.y))) issues.push(`${entity.label}: fiamma su terreno solido o fuori mappa.`);
      continue;
    }
    const point = draftEntityPosition(entity);
    if (collidesWorld(point.x, point.y, entity.radius, world)) issues.push(`${entity.label}: ingombro su terreno solido o fuori mappa.`);
  }
  for (let i = 0; i < draft.entities.length; i++) for (let j = i + 1; j < draft.entities.length; j++) {
    const a = draft.entities[i], b = draft.entities[j];
    // Trigger markers have no physical body and may overlap other authored entities.
    if (a.kind === 'activation' || b.kind === 'activation') continue;
    if (a.kind === 'flame' || b.kind === 'flame') {
      const flame = a.kind === 'flame' ? a : b, other = flame === a ? b : a;
      const tiles = other.kind === 'flame' ? draftFlameTiles(other) : [other];
      if (draftFlameTiles(flame).some(t => tiles.some(o => t.x === o.x && t.y === o.y))) issues.push(`${a.label} e ${b.label}: posizioni sovrapposte.`);
      continue;
    }
    if (Math.hypot(a.x - b.x, a.y - b.y) * TILE_SIZE < a.radius + b.radius) issues.push(`${a.label} e ${b.label}: posizioni sovrapposte.`);
  }
  if (party.length) {
    // Reachability uses player-sized clearance, including narrow corridors and diagonals.
    const reached = new Set<string>(), queue = [{ x: party[0].x, y: party[0].y }];
    for (let index = 0; index < queue.length; index++) {
      const point = queue[index], key = `${point.x},${point.y}`;
      if (reached.has(key)) continue;
      const center = draftEntityPosition(point);
      if (collidesWorld(center.x, center.y, 15, world)) continue;
      reached.add(key);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = point.x + dx, y = point.y + dy;
        if (x >= 0 && y >= 0 && x < draft.width && y < draft.height && !reached.has(`${x},${y}`)) queue.push({ x, y });
      }
    }
    for (const entity of draft.entities) if (!reached.has(`${entity.x},${entity.y}`)) issues.push(`${entity.label}: non raggiungibile dal primo ingresso.`);
  }
  return [...new Set(issues)];
}

export function draftFromDungeon(definition: DungeonDefinition, bossRadius = 36): DungeonDraft {
  const b = definition.layout.bounds, width = b.maxTx - b.minTx + 1, height = b.maxTy - b.minTy + 1;
  const draft = newDungeonDraft(width, height);
  draft.id = definition.id; draft.name = definition.name; draft.origin = { x: b.minTx, y: b.minTy };
  draft.tiles = Array.from({ length: width * height }, (_, index) => dungeonTile(definition, b.minTx + index % width, b.minTy + Math.floor(index / width))!);
  const position = (point: Vec2) => ({ x: Math.floor(point.x / TILE_SIZE) - b.minTx, y: Math.floor(point.y / TILE_SIZE) - b.minTy });
  draft.entities = [];
  draft.encounters = [];
  for (const [index, encounter] of dungeonEncounters(definition).entries()) {
    const groupId = encounter.encounterGroupId ?? `encounter-${index}`;
    const template = BOSS_BY_ID.get(encounter.bossId);
    if (!draft.encounters.some(g => g.id === groupId)) {
      const region = encounter.encounter.regions.combat;
      const points = region.kind === 'polygon' ? region.points : [{ x: region.center.x-region.radius, y: region.center.y-region.radius },{ x: region.center.x+region.radius, y: region.center.y+region.radius }];
      const x = Math.max(0, Math.floor(Math.min(...points.map(p=>p.x))/TILE_SIZE)-b.minTx);
      const y = Math.max(0, Math.floor(Math.min(...points.map(p=>p.y))/TILE_SIZE)-b.minTy);
      const right = Math.min(width, Math.ceil(Math.max(...points.map(p=>p.x))/TILE_SIZE)-b.minTx);
      const bottom = Math.min(height, Math.ceil(Math.max(...points.map(p=>p.y))/TILE_SIZE)-b.minTy);
      draft.encounters.push({ id: groupId, name: `Incontro ${draft.encounters.length+1}`, x, y, width: Math.max(3,right-x), height: Math.max(3,bottom-y),
        ...(encounter.encounter.visitorTiles !== undefined ? { visitorTiles: encounter.encounter.visitorTiles.map(p=>({x:p.x-b.minTx,y:p.y-b.minTy})) } : {}) });
      draft.entities.push(...encounter.spawnPoints.party.map((p,i): DraftEntity=>({id:`party-${index}-${i}`,kind:'party',template:'',label:`Spawn gruppo ${i+1}`,level:1,radius:15,encounterId:groupId,...position(p)})));
      draft.entities.push(...(encounter.encounter.activationPoints ?? []).map((p,i): DraftEntity=>({id:`activation-${index}-${i}`,kind:'activation',template:'',label:'Attivazione',level:1,radius:15,encounterId:groupId,...position(p)})));
      for (const passage of encounter.passages) if (passage.fightState === 'flame') {
        const first = {x:Math.min(...passage.tiles.map(t=>t.x)),y:Math.min(...passage.tiles.map(t=>t.y))};
        draft.entities.push({id:`flame-${index}-${draft.entities.length}`,kind:'flame',template:'',label:passage.id,level:1,radius:15,encounterId:groupId,x:first.x-b.minTx,y:first.y-b.minTy,span:passage.tiles.length,vertical:Math.abs(Math.sin(passage.flame.angle)) > .5});
      }
    }
    const aggro = encounter.encounter.regions.bossAggro;
    draft.entities.push({id:`boss-${index}`,kind:'boss',template:template?.templateId??encounter.bossId,label:template?.name??'Boss',level:1,radius:template?.radius??bossRadius,aggroRadius:aggro.kind === 'circle' ? aggro.radius : Math.hypot(width,height)*TILE_SIZE,encounterId:groupId,...position(encounter.spawnPoints.boss)});
  }
  draft.entities.push(...(definition.npcSpawns??[]).map((p):DraftEntity=>({id:p.id,kind:'npc',template:p.npcKind,label:NPC_CATALOG[p.npcKind].name,level:p.level,radius:NPC_CATALOG[p.npcKind].radius,...position(p)})));
  return draft;
}

/** Compile spatial content; boss combat behavior must be explicitly linked before runtime activation. */
export function compileDungeonDraft(input: DungeonDraft) {
  const draft = parseDungeonDraft(JSON.stringify(input)), issues = validateDungeonDraft(draft);
  if (issues.length) throw new Error(issues.join('\n'));
  const bosses = draft.entities.filter(e => e.kind === 'boss'), boss = bosses[0];
  const position = (point: Vec2) => ({ x: (point.x + draft.origin.x + .5) * TILE_SIZE, y: (point.y + draft.origin.y + .5) * TILE_SIZE });
  const bounds = { minTx: draft.origin.x, maxTx: draft.origin.x + draft.width - 1, minTy: draft.origin.y, maxTy: draft.origin.y + draft.height - 1 };
  const left = bounds.minTx * TILE_SIZE, top = bounds.minTy * TILE_SIZE, right = (bounds.maxTx + 1) * TILE_SIZE, bottom = (bounds.maxTy + 1) * TILE_SIZE;
  const region: DungeonRegion = { kind: 'polygon', points: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }] };
  const definition: DungeonDefinition = {
    id: draft.id, name: draft.name, bossId: `boss:${draft.id}:main`,
    area: { x: (left + right) / 2, y: (top + bottom) / 2, radius: Math.hypot(right - left, bottom - top) / 2 },
    layout: { bounds, floor: 'path', obstacles: [], obstacleTiles: [], tiles: draft.tiles.map((kind, i) => ({ x: bounds.minTx + i % draft.width, y: bounds.minTy + Math.floor(i / draft.width), kind })) },
    passages: [], spawnPoints: { boss: position(boss), party: draft.entities.filter(e => e.kind === 'party').map(position) },
    npcSpawns: draft.entities.filter(e => e.kind === 'npc').map(e => ({ ...position(e), id: e.id, npcKind: e.template as NpcKind, level: e.level })),
    encounter: { preparationMs: 5000, regions: { trigger: region, admission: region, combat: region, ejectIntruders: region, bossAggro: region, bossLeash: region }, ejectTo: { x: left - 96, y: bottom + 96 } },
    spawnExclusionMargin: 96,
    approach: { from: { x: left - 480, y: bottom + 96 }, to: { x: left - 96, y: bottom + 96 }, halfWidth: 48, corridorHalfWidth: 96, waves: [], markers: [] },
    theme: { ...DEFAULT_DUNGEON_THEME },
  };
  // Open boundary tiles become explicit named passages. Fight barriers are authored separately.
  for (const tile of definition.layout.tiles!) if (!isSolid(tile.kind) && (tile.x === bounds.minTx || tile.x === bounds.maxTx || tile.y === bounds.minTy || tile.y === bounds.maxTy)) {
    definition.passages = [...definition.passages, { id: `opening-${tile.x}-${tile.y}`, position: { x: (tile.x + .5) * TILE_SIZE, y: (tile.y + .5) * TILE_SIZE }, tiles: [{ x: tile.x, y: tile.y }], fightState: 'open' }];
  }
  const placements = bosses.map((entity, index) => {
    const group = draft.encounters.find(g => g.id === (entity.encounterId ?? draft.encounters[0].id))!;
    const l = (draft.origin.x + group.x) * TILE_SIZE, t = (draft.origin.y + group.y) * TILE_SIZE;
    const r = l + group.width * TILE_SIZE, b = t + group.height * TILE_SIZE;
    const region: DungeonRegion = { kind: 'polygon', points: [{x:l,y:t},{x:r,y:t},{x:r,y:b},{x:l,y:b}] };
    const flames = draft.entities.filter(e => e.kind === 'flame' && (e.encounterId ?? draft.encounters[0].id) === group.id).map(e => {
      const tiles = draftFlameTiles(e).map(p => ({ x: p.x + draft.origin.x, y: p.y + draft.origin.y }));
      return { id: e.id, position: position(e), tiles, fightState: 'flame' as const, flame: flameBarrierFromTiles(tiles, e.vertical) };
    });
    const passages = [...definition.passages.filter(p => !p.tiles.some(tile => flames.some(f => f.tiles.some(ft => ft.x === tile.x && ft.y === tile.y)))), ...flames];
    const party = draft.entities.filter(e => e.kind === 'party' && (e.encounterId ?? draft.encounters[0].id) === group.id);
    // Find a free staging tile outside every encounter so ejected outsiders cannot start another fight.
    let ejectTo = definition.encounter.ejectTo;
    for (let y = 0; y < draft.height; y++) for (let x = 0; x < draft.width; x++) {
      if (!isSolid(draft.tiles[y * draft.width + x]) && !draft.encounters.some(g => x >= g.x && x < g.x + g.width && y >= g.y && y < g.y + g.height)) ejectTo = position({x,y});
    }
    return { bossId: `boss:${draft.id}:${index === 0 ? 'main' : `spawn:${entity.id}`}`, encounterGroupId: group.id,
      spawnPoints: { boss: position(entity), party: party.map(position) }, passages,
      encounter: { preparationMs: 5000,
        ...(group.visitorTiles !== undefined ? { visitorTiles: group.visitorTiles.map(p=>({x:p.x+draft.origin.x,y:p.y+draft.origin.y})) } : {}),
        activationPoints: draft.entities.filter(e => e.kind === 'activation' && (e.encounterId ?? draft.encounters[0].id) === group.id).map(position),
        regions: { trigger: region, admission: region, combat: region, ejectIntruders: region,
          bossAggro: { kind: 'circle' as const, center: position(entity), radius: entity.aggroRadius ?? DEFAULT_BOSS_AGGRO_RADIUS }, bossLeash: region }, ejectTo } };
  });
  Object.assign(definition, placements[0]);
  definition.additionalEncounters = placements.slice(1);
  for (const encounter of dungeonEncounters(definition)) assertValidDungeonDefinition(encounter);
  return { definition, bossTemplate: boss.template, bossPlaceholder: { name: boss.label, radius: boss.radius },
    bosses: bosses.map((entity, i) => ({ id: placements[i].bossId, template: entity.template, name: entity.label, radius: entity.radius })) };

}
