import { TILE_SIZE } from './config';
import type { Pickup, TileKind, Vec2 } from './types';
import { NPC_CATALOG, type NpcKind } from './npcs';
import customDungeons from './custom-dungeons.json';

export interface DungeonTileRect { minTx: number; maxTx: number; minTy: number; maxTy: number; }
export interface DungeonFlameBarrier extends Vec2 { length: number; thickness: number; angle: number; }
interface DungeonPassageBase {
  id: string;
  position: Vec2;
  tiles: readonly Vec2[];
}
export type DungeonPassage = DungeonPassageBase & ({
  fightState: 'stone';
} | {
  fightState: 'flame';
  flame: DungeonFlameBarrier;
} | {
  fightState: 'open';
});
export type DungeonRegion = {
  kind: 'circle';
  center: Vec2;
  radius: number;
} | {
  kind: 'polygon';
  points: readonly Vec2[];
};
export interface DungeonEncounterDefinition {
  preparationMs: number;
  /** Invisible, manually authored activation tiles, separate from player spawns. */
  activationPoints?: readonly Vec2[];
  /** World tile coordinates accessible to non-participants while this encounter is locked. */
  visitorTiles?: readonly Vec2[];
  regions: {
    /** Bounds within which authored entry points can activate the encounter. */
    trigger: DungeonRegion;
    /** Team members inside this region during preparation join the fight. */
    admission: DungeonRegion;
    /** Participants die when they leave this region. */
    combat: DungeonRegion;
    /** Non-participants entering this region are moved to ejectTo. */
    ejectIntruders: DungeonRegion;
    /** Initial detection area, intersected with combat; pursuit persists after detection. */
    bossAggro: DungeonRegion;
    /** Movement, pathfinding and charge endpoints are constrained to this region. */
    bossLeash: DungeonRegion;
  };
  ejectTo: Vec2;
}
export interface DungeonApproach {
  from: Vec2;
  to: Vec2;
  halfWidth: number;
  corridorHalfWidth: number;
  waves: readonly { amplitude: number; cycles: number }[];
  /** Normalized positions along the route used for visual wayfinding. */
  markers: readonly number[];
}
export interface DungeonTheme {
  floor: string;
  wall: string;
  wallTop: string;
  minimap: string;
  markerStone: string;
  markerEdge: string;
  markerRune: string;
}
export interface DungeonDefinition {
  id: string;
  name: string;
  bossId: string;
  encounterGroupId?: string;
  additionalEncounters?: readonly { bossId: string; encounterGroupId: string; spawnPoints: DungeonDefinition['spawnPoints']; encounter: DungeonEncounterDefinition; passages: readonly DungeonPassage[] }[];
  area: Vec2 & { radius: number };
  layout: {
    bounds: DungeonTileRect;
    floor: TileKind;
    obstacles: readonly DungeonTileRect[];
    obstacleTiles: readonly Vec2[];
    tiles?: readonly (Vec2 & { kind: TileKind })[];
  };
  passages: readonly DungeonPassage[];
  /** Players are placed at these positions when the encounter starts. */
  spawnPoints: { boss: Vec2; party: readonly Vec2[] };
  npcSpawns?: readonly (Vec2 & { id: string; npcKind: NpcKind; level: number })[];
  pickupSpawns?: readonly Pickup[];
  encounter: DungeonEncounterDefinition;
  spawnExclusionMargin: number;
  approach: DungeonApproach;
  theme: DungeonTheme;
}

export function flameBarrierFromTiles(tiles: readonly Vec2[], singleTileVertical = false): DungeonFlameBarrier {
  if (!tiles.length) throw new Error('Una barriera dungeon deve occupare almeno una tile.');
  const vertical = tiles.length === 1 ? singleTileVertical : tiles.every(tile => tile.x === tiles[0].x);
  const horizontal = tiles.every(tile => tile.y === tiles[0].y);
  if (!vertical && !horizontal) throw new Error('Le tile di una barriera dungeon devono essere allineate.');
  return {
    x: tiles.reduce((sum, tile) => sum + (tile.x + 0.5) * TILE_SIZE, 0) / tiles.length,
    y: tiles.reduce((sum, tile) => sum + (tile.y + 0.5) * TILE_SIZE, 0) / tiles.length,
    length: tiles.length * TILE_SIZE,
    thickness: 12,
    angle: vertical ? Math.PI / 2 : 0,
  };
}
/** Canvas flames grow along local +Y: face that normal towards the map's centre. Collision geometry is unchanged. */
export function inwardFlameAngle(flame: DungeonFlameBarrier, bounds: DungeonTileRect): number {
  const centerX = (bounds.minTx + bounds.maxTx + 1) * TILE_SIZE / 2;
  const centerY = (bounds.minTy + bounds.maxTy + 1) * TILE_SIZE / 2;
  const inward = (centerX - flame.x) * -Math.sin(flame.angle) + (centerY - flame.y) * Math.cos(flame.angle);
  return inward < -1e-8 ? flame.angle + Math.PI : flame.angle;
}
export const DEFAULT_DUNGEON_THEME: DungeonTheme = { floor: '#918567', wall: '#5c5d52', wallTop: '#92917e', minimap: '#d8bd79', markerStone: '#777864', markerEdge: '#464e42', markerRune: '#d0b97999' };

export const DUNGEON_DEFINITIONS: readonly DungeonDefinition[] =
  (customDungeons as { definition: DungeonDefinition }[]).map(entry => entry.definition);
export function dungeonEncounters(definition: DungeonDefinition): DungeonDefinition[] {
  return [definition, ...(definition.additionalEncounters ?? []).map(encounter => ({ ...definition, ...encounter, additionalEncounters: undefined }))];
}
if (new Set(DUNGEON_DEFINITIONS.map(dungeon => dungeon.id)).size !== DUNGEON_DEFINITIONS.length
  || new Set(DUNGEON_DEFINITIONS.map(dungeon => dungeon.bossId)).size !== DUNGEON_DEFINITIONS.length) {
  throw new Error('Il catalogo dungeon contiene id dungeon o boss duplicati.');
}
export const DUNGEON_BY_ID = new Map(DUNGEON_DEFINITIONS.map(definition => [definition.id, definition]));
export const DUNGEON_BY_BOSS_ID = new Map(DUNGEON_DEFINITIONS.flatMap(dungeonEncounters).map(definition => [definition.bossId, definition]));
if (DUNGEON_BY_BOSS_ID.size !== DUNGEON_DEFINITIONS.flatMap(dungeonEncounters).length) throw new Error('ID boss duplicato nel catalogo dungeon.');

const insideRect = (tx: number, ty: number, rect: DungeonTileRect): boolean =>
  tx >= rect.minTx && tx <= rect.maxTx && ty >= rect.minTy && ty <= rect.maxTy;
const paintedTileIndexes = new WeakMap<object, Map<string, TileKind>>();

export function dungeonTile(definition: DungeonDefinition, tx: number, ty: number): TileKind | undefined {
  if (!insideRect(tx, ty, definition.layout.bounds)) return undefined;
  if (definition.layout.obstacles.some(rect => insideRect(tx, ty, rect))
    || definition.layout.obstacleTiles.some(tile => tile.x === tx && tile.y === ty)) return 'rock';
  if (definition.layout.tiles) {
    let index = paintedTileIndexes.get(definition.layout.tiles);
    if (!index) {
      index = new Map(definition.layout.tiles.map(tile => [`${tile.x},${tile.y}`, tile.kind]));
      paintedTileIndexes.set(definition.layout.tiles, index);
    }
    const painted = index.get(`${tx},${ty}`);
    if (painted) return painted;
  }
  return definition.layout.floor;
}

export function configuredDungeonTile(tx: number, ty: number): TileKind | undefined {
  for (const definition of DUNGEON_DEFINITIONS) {
    const tile = dungeonTile(definition, tx, ty);
    if (tile) return tile;
  }
  return undefined;
}

export function dungeonAtTile(tx: number, ty: number): DungeonDefinition | undefined {
  return DUNGEON_DEFINITIONS.find(definition => insideRect(tx, ty, definition.layout.bounds));
}

export function insideDungeon(definition: DungeonDefinition, position: Vec2, margin = 0): boolean {
  return Math.hypot(position.x - definition.area.x, position.y - definition.area.y) < definition.area.radius + margin;
}

export function dungeonAt(position: Vec2, margin = 0): DungeonDefinition | undefined {
  return DUNGEON_DEFINITIONS.find(definition => insideDungeon(definition, position, margin));
}

export function insideDungeonRegion(region: DungeonRegion, position: Vec2, margin = 0): boolean {
  if (region.kind === 'circle') return Math.hypot(position.x - region.center.x, position.y - region.center.y) < region.radius + margin;
  let inside = false;
  for (let index = 0, previous = region.points.length - 1; index < region.points.length; previous = index++) {
    const a = region.points[index], b = region.points[previous];
    if ((a.y > position.y) !== (b.y > position.y)
      && position.x < (b.x - a.x) * (position.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  const edgeDistance = Math.min(...region.points.map((point, index) => distanceToSegment(position, point, region.points[(index + 1) % region.points.length])));
  if (inside) return margin >= 0 || edgeDistance > -margin;
  return margin > 0 && edgeDistance < margin;
}

/** Keeps an endpoint inside a configured region along a movement segment whose start is already inside. */
export function clampToDungeonRegion(region: DungeonRegion, from: Vec2, target: Vec2, margin = 0): Vec2 {
  if (insideDungeonRegion(region, target, margin)) return target;
  let low = 0, high = 1;
  for (let iteration = 0; iteration < 24; iteration++) {
    const ratio = (low + high) / 2;
    const point = { x: from.x + (target.x - from.x) * ratio, y: from.y + (target.y - from.y) * ratio };
    if (insideDungeonRegion(region, point, margin)) low = ratio; else high = ratio;
  }
  return { x: from.x + (target.x - from.x) * low, y: from.y + (target.y - from.y) * low };
}

const stoneTileCache = new WeakMap<DungeonDefinition, readonly Vec2[]>();
export function dungeonStoneTiles(definition: DungeonDefinition): readonly Vec2[] {
  const cached = stoneTileCache.get(definition);
  if (cached) return cached;
  const tiles = new Map(definition.passages.filter(p => p.fightState === 'stone').flatMap(p => p.tiles).map(t => [tileKey(t), t]));
  const b = definition.layout.bounds;
  for (let x = b.minTx; x <= b.maxTx; x++) for (const y of [b.minTy, b.maxTy]) tiles.set(`${x},${y}`, { x, y });
  for (let y = b.minTy + 1; y < b.maxTy; y++) for (const x of [b.minTx, b.maxTx]) tiles.set(`${x},${y}`, { x, y });
  const result = [...tiles.values()]; stoneTileCache.set(definition, result); return result;
}

export function onDungeonBoundary(bounds: DungeonTileRect, tile: Vec2): boolean {
  return tile.x === bounds.minTx || tile.x === bounds.maxTx || tile.y === bounds.minTy || tile.y === bounds.maxTy;
}

export function dungeonFlames(definition: DungeonDefinition): readonly DungeonFlameBarrier[] {
  return definition.passages.filter((passage): passage is DungeonPassage & { fightState: 'flame' } => passage.fightState === 'flame')
    .filter(passage => !passage.tiles.some(tile => onDungeonBoundary(definition.layout.bounds, tile)))
    .map(passage => passage.flame);
}

export function touchesDungeonFlame(definition: DungeonDefinition, position: Vec2, radius = 0): boolean {
  return dungeonFlames(definition).some(flame => touchesFlame(flame, position, radius));
}

export function atDungeonActivation(definition: DungeonDefinition, position: Vec2, radius = 0): boolean {
  return insideDungeonRegion(definition.encounter.regions.trigger, position)
    && insideDungeonRegion(definition.encounter.regions.combat, position, -radius)
    && (definition.encounter.activationPoints ?? []).some(point => Math.hypot(position.x - point.x, position.y - point.y) <= TILE_SIZE / 2 + radius);
}

const visitorIndexes = new WeakMap<object, Set<string>>();
/** Test the player's whole circle against the painted union, preserving shared edges between tiles. */
export function insideDungeonVisitorArea(definition: DungeonDefinition, position: Vec2, radius = 0): boolean {
  const tiles = definition.encounter.visitorTiles;
  if (!tiles?.length) return false;
  let index = visitorIndexes.get(tiles);
  if (!index) { index = new Set(tiles.map(p=>`${p.x},${p.y}`)); visitorIndexes.set(tiles,index); }
  if (!index.has(`${Math.floor(position.x/TILE_SIZE)},${Math.floor(position.y/TILE_SIZE)}`)) return false;
  for(let ty=Math.floor((position.y-radius)/TILE_SIZE);ty<=Math.floor((position.y+radius)/TILE_SIZE);ty++)
    for(let tx=Math.floor((position.x-radius)/TILE_SIZE);tx<=Math.floor((position.x+radius)/TILE_SIZE);tx++) {
      if (index.has(`${tx},${ty}`)) continue;
      const x=Math.max(tx*TILE_SIZE,Math.min((tx+1)*TILE_SIZE,position.x));
      const y=Math.max(ty*TILE_SIZE,Math.min((ty+1)*TILE_SIZE,position.y));
      if (Math.hypot(position.x-x,position.y-y)<radius
        && insideDungeonRegion(definition.encounter.regions.ejectIntruders,dungeonTileCenter({x:tx,y:ty}))) return false;
    }
  return true;
}

function approachProgress(definition: DungeonDefinition, position: Vec2): number {
  const approach = definition.approach;
  const dx = approach.to.x - approach.from.x, dy = approach.to.y - approach.from.y;
  return ((position.x - approach.from.x) * dx + (position.y - approach.from.y) * dy) / Math.max(1, dx * dx + dy * dy);
}

export function dungeonApproachNormal(definition: DungeonDefinition): Vec2 {
  const { from, to } = definition.approach;
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.max(1, Math.hypot(dx, dy));
  return { x: -dy / length, y: dx / length };
}

export function dungeonApproachPoint(definition: DungeonDefinition, progress: number): Vec2 {
  const approach = definition.approach;
  const t = Math.max(0, Math.min(1, progress));
  const normal = dungeonApproachNormal(definition);
  const waveOffset = approach.waves.reduce((offset, wave) => offset + Math.sin(t * Math.PI * wave.cycles) * wave.amplitude, 0);
  return {
    x: approach.from.x + (approach.to.x - approach.from.x) * t + normal.x * waveOffset,
    y: approach.from.y + (approach.to.y - approach.from.y) * t + normal.y * waveOffset,
  };
}

export function dungeonApproachCenter(definition: DungeonDefinition, position: Vec2): Vec2 {
  return dungeonApproachPoint(definition, approachProgress(definition, position));
}

export function onDungeonApproach(definition: DungeonDefinition, position: Vec2): boolean {
  const progress = approachProgress(definition, position);
  if (progress < 0 || progress > 1) return false;
  const center = dungeonApproachPoint(definition, progress);
  return Math.hypot(position.x - center.x, position.y - center.y) < definition.approach.halfWidth;
}

export function inDungeonApproachCorridor(definition: DungeonDefinition, position: Vec2): boolean {
  const progress = approachProgress(definition, position);
  if (progress < 0 || progress > 1) return false;
  const { from, to } = definition.approach;
  const straight = { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
  return Math.hypot(position.x - straight.x, position.y - straight.y) < definition.approach.corridorHalfWidth;
}

export function isClosedDungeonTile(tx: number, ty: number, lockedBosses: ReadonlySet<string>): boolean {
  for (const definition of DUNGEON_BY_BOSS_ID.values()) if (lockedBosses.has(definition.bossId)
    && ((insideRect(tx, ty, definition.layout.bounds) && onDungeonBoundary(definition.layout.bounds, { x: tx, y: ty }))
      || definition.passages.some(p => p.fightState === 'stone' && p.tiles.some(tile => tile.x === tx && tile.y === ty)))) return true;
  return false;
}

export function dungeonTileCenter(tile: Vec2): Vec2 {
  return { x: (tile.x + 0.5) * TILE_SIZE, y: (tile.y + 0.5) * TILE_SIZE };
}

export function touchesFlame(flame: DungeonFlameBarrier, position: Vec2, radius = 0): boolean {
  const tangentX = Math.cos(flame.angle), tangentY = Math.sin(flame.angle);
  const dx = position.x - flame.x, dy = position.y - flame.y;
  const along = dx * tangentX + dy * tangentY;
  const normal = dx * -tangentY + dy * tangentX;
  return Math.abs(along) <= flame.length / 2 + radius && Math.abs(normal) <= flame.thickness / 2 + radius;
}

function distanceToSegment(point: Vec2, from: Vec2, to: Vec2): number {
  const dx = to.x - from.x, dy = to.y - from.y;
  const ratio = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / Math.max(1, dx * dx + dy * dy)));
  return Math.hypot(point.x - from.x - dx * ratio, point.y - from.y - dy * ratio);
}

const finitePoint = (point: Vec2): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);
const tileKey = (tile: Vec2): string => `${tile.x},${tile.y}`;
function regionSamples(region: DungeonRegion): Vec2[] {
  if (region.kind === 'polygon') return region.points.flatMap((point, index) => {
    const next = region.points[(index + 1) % region.points.length];
    return [point, { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 }];
  });
  return Array.from({ length: 32 }, (_, index) => {
    const angle = index / 32 * Math.PI * 2;
    return { x: region.center.x + Math.cos(angle) * region.radius, y: region.center.y + Math.sin(angle) * region.radius };
  });
}
const regionContained = (inner: DungeonRegion, outer: DungeonRegion): boolean =>
  regionSamples(inner).every(point => insideDungeonRegion(outer, point, 0.01));

/** Runtime validation complements TypeScript with spatial and topology invariants. */
export function assertValidDungeonDefinition(definition: DungeonDefinition): void {
  const fail = (message: string): never => { throw new Error(`Dungeon ${definition.id || '<senza id>'}: ${message}`); };
  if (!definition.id || !definition.name || !definition.bossId) fail('id, nome e bossId sono obbligatori.');
  const bounds = definition.layout.bounds;
  const walkable = (tile: TileKind | undefined) => tile !== undefined && tile !== 'water' && tile !== 'rock';
  if (![bounds.minTx, bounds.maxTx, bounds.minTy, bounds.maxTy].every(Number.isInteger)
    || bounds.minTx > bounds.maxTx || bounds.minTy > bounds.maxTy) fail('limiti della mappa non validi.');
  if (!finitePoint(definition.area) || !Number.isFinite(definition.area.radius) || definition.area.radius <= 0) fail('area mondo non valida.');
  if (!finitePoint(definition.spawnPoints.boss) || !definition.spawnPoints.party.length
    || definition.spawnPoints.party.some(point => !finitePoint(point))) fail('spawn boss/party non validi.');
  for (const [name, point] of [['boss', definition.spawnPoints.boss], ...definition.spawnPoints.party.map((point, index) => [`party ${index}`, point] as const)] as const) {
    const tx = Math.floor(point.x / TILE_SIZE), ty = Math.floor(point.y / TILE_SIZE);
    if (!walkable(dungeonTile(definition, tx, ty))) fail(`spawn ${name} sopra una tile solida o fuori mappa.`);
  }
  const paintedKeys = new Set<string>();
  for (const tile of definition.layout.tiles ?? []) {
    const key = tileKey(tile);
    if (!Number.isInteger(tile.x) || !Number.isInteger(tile.y) || !insideRect(tile.x, tile.y, bounds)
      || !['grass', 'path', 'mud', 'bush', 'water', 'rock'].includes(tile.kind) || paintedKeys.has(key)) fail('tile dipinta non valida o duplicata.');
    paintedKeys.add(key);
  }
  const npcIds = new Set<string>();
  const pickupIds = new Set<string>();
  if (definition.pickupSpawns !== undefined && (!Array.isArray(definition.pickupSpawns) || definition.pickupSpawns.length > 500)) fail('elenco bonus non valido.');
  for (const pickup of definition.pickupSpawns ?? []) {
    if (!pickup || !pickup.id || pickupIds.has(pickup.id) || !finitePoint(pickup)
      || !['heal', 'haste', 'power', 'weakness'].includes(pickup.kind) || pickup.radius !== 12
      || !walkable(dungeonTile(definition, Math.floor(pickup.x / TILE_SIZE), Math.floor(pickup.y / TILE_SIZE)))) fail('bonus non valido o su terreno solido.');
    pickupIds.add(pickup.id);
  }
  for (const npc of definition.npcSpawns ?? []) {
    if (!npc.id || npcIds.has(npc.id) || !Object.hasOwn(NPC_CATALOG, npc.npcKind) || !finitePoint(npc)
      || !Number.isInteger(npc.level) || npc.level < 1 || npc.level > 25
      || !walkable(dungeonTile(definition, Math.floor(npc.x / TILE_SIZE), Math.floor(npc.y / TILE_SIZE)))) fail('spawn NPC non valido.');
    npcIds.add(npc.id);
  }
  if (!Number.isFinite(definition.encounter.preparationMs) || definition.encounter.preparationMs < 0) fail('preparationMs non valido.');
  if (!finitePoint(definition.encounter.ejectTo)) fail('destinazione di espulsione non valida.');
  const activationPoints = definition.encounter.activationPoints ?? [];
  if (!Array.isArray(activationPoints) || activationPoints.length > 500
    || activationPoints.some(point => !finitePoint(point)
      || !insideDungeonRegion(definition.encounter.regions.trigger, point)
      || !walkable(dungeonTile(definition, Math.floor(point.x / TILE_SIZE), Math.floor(point.y / TILE_SIZE))))) fail('punti di attivazione non validi.');
  const visitorTiles = definition.encounter.visitorTiles ?? [], visitorKeys = new Set<string>();
  if (!Array.isArray(visitorTiles) || visitorTiles.length > (bounds.maxTx-bounds.minTx+1)*(bounds.maxTy-bounds.minTy+1)
    || visitorTiles.some(p => !p || !Number.isInteger(p.x) || !Number.isInteger(p.y) || !insideRect(p.x,p.y,bounds)
      || !insideDungeonRegion(definition.encounter.regions.combat,dungeonTileCenter(p))
      || visitorKeys.has(tileKey(p)) || !visitorKeys.add(tileKey(p)))) fail('zona visitatori non valida.');
  const passageIds = new Set<string>(), passageTiles = new Map<string, string>(), stoneTiles = new Set<string>();
  const flames: DungeonFlameBarrier[] = [];
  for (const passage of definition.passages) {
    if (!passage.id || passageIds.has(passage.id)) fail(`passaggio duplicato o senza id: ${passage.id}.`);
    passageIds.add(passage.id);
    if (!finitePoint(passage.position) || !passage.tiles.length) fail(`passaggio ${passage.id} senza posizione o tile.`);
    for (const tile of passage.tiles) {
      if (!Number.isInteger(tile.x) || !Number.isInteger(tile.y) || !insideRect(tile.x, tile.y, bounds)) fail(`tile fuori mappa nel passaggio ${passage.id}.`);
      if (!walkable(dungeonTile(definition, tile.x, tile.y))) fail(`il passaggio ${passage.id} occupa una tile solida.`);
      const key = tileKey(tile), previous = passageTiles.get(key);
      if (previous) fail(`i passaggi ${previous} e ${passage.id} condividono la tile ${key}.`);
      passageTiles.set(key, passage.id);
      if (passage.fightState === 'stone') stoneTiles.add(key);
    }
    if (passage.fightState === 'flame') {
      const flame = passage.flame;
      if (!finitePoint(flame) || ![flame.length, flame.thickness, flame.angle].every(Number.isFinite)
        || flame.length <= 0 || flame.thickness <= 0) fail(`fiamma non valida nel passaggio ${passage.id}.`);
      if (!passage.tiles.some(tile => touchesFlame(flame, dungeonTileCenter(tile), TILE_SIZE / 2))) fail(`la fiamma ${passage.id} non interseca il proprio varco.`);
      flames.push(flame);
    }
  }
  for (const key of stoneTiles) {
    const [x, y] = key.split(',').map(Number), center = dungeonTileCenter({ x, y });
    if (flames.some(flame => touchesFlame(flame, center, TILE_SIZE / 2 - 0.01))) fail(`pietre e fiamme si sovrappongono sulla tile ${key}.`);
  }

  for (const [name, region] of Object.entries(definition.encounter.regions)) {
    if (region.kind === 'circle') {
      if (!finitePoint(region.center) || !Number.isFinite(region.radius) || region.radius <= 0) fail(`regione ${name} non valida.`);
    } else if (region.points.length < 3 || region.points.some(point => !finitePoint(point))) fail(`poligono ${name} non valido.`);
  }
  const regions = definition.encounter.regions;
  if (!insideDungeonRegion(regions.trigger, definition.spawnPoints.boss)
    || !insideDungeonRegion(regions.combat, definition.spawnPoints.boss)
    || !insideDungeonRegion(regions.bossAggro, definition.spawnPoints.boss)
    || !insideDungeonRegion(regions.bossLeash, definition.spawnPoints.boss)) fail('lo spawn del boss deve essere dentro trigger, combat, aggro e leash.');
  for (const spawn of definition.spawnPoints.party) {
    if (!insideDungeonRegion(regions.admission, spawn) || !insideDungeonRegion(regions.combat, spawn)) fail('ogni spawn party deve essere dentro admission e combat.');
  }
  if (!regionContained(regions.trigger, regions.admission)) fail('trigger deve essere contenuta in admission.');
  for (const [name, region] of [['trigger', regions.trigger], ['admission', regions.admission], ['ejectIntruders', regions.ejectIntruders],
    ['bossLeash', regions.bossLeash]] as const) {
    if (!regionContained(region, regions.combat)) fail(`la regione ${name} deve essere contenuta in combat.`);
  }
  if (insideDungeonRegion(regions.combat, definition.encounter.ejectTo)) fail('ejectTo deve essere esterno alla regione combat.');

  // Every walkable boundary opening must be named, otherwise a map edit could create an accidental escape route.
  for (let ty = bounds.minTy; ty <= bounds.maxTy; ty++) for (let tx = bounds.minTx; tx <= bounds.maxTx; tx++) {
    if (tx !== bounds.minTx && tx !== bounds.maxTx && ty !== bounds.minTy && ty !== bounds.maxTy) continue;
    if (walkable(dungeonTile(definition, tx, ty)) && !passageTiles.has(tileKey({ x: tx, y: ty }))) {
      fail(`apertura sul bordo ${tx},${ty} non dichiarata come passaggio.`);
    }
  }
}

for (const definition of DUNGEON_DEFINITIONS.flatMap(dungeonEncounters)) assertValidDungeonDefinition(definition);
