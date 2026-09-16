import { TILE_SIZE } from './config';
import type { TileKind, Vec2 } from './types';

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
  regions: {
    /** Starts the preparation/fight when an eligible player enters it. */
    trigger: DungeonRegion;
    /** Team members inside this region during preparation join the fight. */
    admission: DungeonRegion;
    /** Participants die when they leave this region. */
    combat: DungeonRegion;
    /** Non-participants entering this region are moved to ejectTo. */
    ejectIntruders: DungeonRegion;
    /** The boss only targets participants inside this region. */
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
  area: Vec2 & { radius: number };
  layout: {
    bounds: DungeonTileRect;
    floor: TileKind;
    obstacles: readonly DungeonTileRect[];
    obstacleTiles: readonly Vec2[];
  };
  passages: readonly DungeonPassage[];
  spawnPoints: { boss: Vec2; party: readonly Vec2[] };
  encounter: DungeonEncounterDefinition;
  spawnExclusionMargin: number;
  approach: DungeonApproach;
  theme: DungeonTheme;
}

const tileRange = (min: number, max: number): number[] => Array.from({ length: max - min + 1 }, (_, index) => min + index);
const horizontalTiles = (ty: number): Vec2[] => [...tileRange(-8, -3), ...tileRange(2, 7)].map(tx => ({ x: tx, y: ty }));
const ruinsNorthOpening = tileRange(-2, 1).map(tx => ({ x: tx, y: -87 }));
const ruinsMainEntrance = tileRange(-2, 1).map(tx => ({ x: tx, y: -74 }));
export function flameBarrierFromTiles(tiles: readonly Vec2[]): DungeonFlameBarrier {
  if (!tiles.length) throw new Error('Una barriera dungeon deve occupare almeno una tile.');
  const vertical = tiles.every(tile => tile.x === tiles[0].x);
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
const mazeSeal = [5, 6, 7].map(y => ({ x: 85, y }));
const mazeBoss = { x: 4200, y: 0 } as const;
const circle = (center: Vec2, radius: number): DungeonRegion => ({ kind: 'circle', center, radius });

/**
 * The first dungeon is entirely described here. Adding another dungeon should
 * require one more definition, not another branch in world/server/renderer.
 */
export const RUINS_DUNGEON: DungeonDefinition = {
  id: 'ruins',
  name: 'Rovine della Soglia',
  bossId: 'boss:ruins:warden',
  area: { x: 0, y: -3840, radius: 340 },
  layout: {
    bounds: { minTx: -8, maxTx: 7, minTy: -87, maxTy: -74 },
    floor: 'path',
    obstacles: [
      { minTx: -8, maxTx: -8, minTy: -86, maxTy: -75 },
      { minTx: 7, maxTx: 7, minTy: -86, maxTy: -75 },
    ],
    obstacleTiles: [
      ...horizontalTiles(-87), ...horizontalTiles(-74),
      { x: -4, y: -83 }, { x: 3, y: -83 }, { x: -4, y: -78 }, { x: 3, y: -78 },
    ],
  },
  passages: [
    { id: 'north-guard', position: { x: 0, y: -4152 }, tiles: ruinsNorthOpening,
      fightState: 'flame', flame: flameBarrierFromTiles(ruinsNorthOpening) },
    { id: 'main-entrance', position: { x: 0, y: -3528 }, tiles: ruinsMainEntrance, fightState: 'stone' },
  ],
  spawnPoints: {
    boss: { x: 0, y: -3840 },
    party: [{ x: -72, y: -3635 }, { x: -24, y: -3635 }, { x: 24, y: -3635 }, { x: 72, y: -3635 }],
  },
  encounter: {
    preparationMs: 5000,
    regions: {
      trigger: circle({ x: 0, y: -3840 }, 260),
      admission: circle({ x: 0, y: -3840 }, 260),
      combat: circle({ x: 0, y: -3840 }, 420),
      ejectIntruders: circle({ x: 0, y: -3840 }, 260),
      bossAggro: circle({ x: 0, y: -3840 }, 420),
      bossLeash: circle({ x: 0, y: -3840 }, 420),
    },
    ejectTo: { x: 0, y: -3400 },
  },
  spawnExclusionMargin: 220,
  approach: {
    from: { x: 0, y: -300 }, to: { x: 0, y: -3540 }, halfWidth: 70, corridorHalfWidth: 520,
    waves: [{ amplitude: 145, cycles: 2 }, { amplitude: 48, cycles: 5 }],
    markers: [420 / 3240, 1150 / 3240, 1920 / 3240, 2700 / 3240],
  },
  theme: {
    floor: '#918567', wall: '#5c5d52', wallTop: '#92917e', minimap: '#d8bd79',
    markerStone: '#777864', markerEdge: '#464e42', markerRune: '#d0b97999',
  },
};

/** A second definition deliberately exercises horizontal approaches and a non-arena layout. */
export const MAZE_DUNGEON: DungeonDefinition = {
  id: 'ashen-maze',
  name: 'Dedalo delle Ceneri',
  bossId: 'boss:ashen-maze:stalker',
  area: { x: 3840, y: 0, radius: 470 },
  layout: {
    bounds: { minTx: 70, maxTx: 89, minTy: -9, maxTy: 8 },
    floor: 'path',
    obstacles: [
      { minTx: 70, maxTx: 89, minTy: -9, maxTy: -9 },
      { minTx: 70, maxTx: 89, minTy: 8, maxTy: 8 },
      { minTx: 70, maxTx: 70, minTy: -8, maxTy: -2 },
      { minTx: 70, maxTx: 70, minTy: 1, maxTy: 7 },
      { minTx: 89, maxTx: 89, minTy: -8, maxTy: 7 },
      // Alternating openings create a wide serpentine route usable by boss-sized actors.
      { minTx: 75, maxTx: 75, minTy: -8, maxTy: 4 },
      { minTx: 80, maxTx: 80, minTy: -3, maxTy: 7 },
      { minTx: 85, maxTx: 85, minTy: -8, maxTy: 4 },
    ],
    obstacleTiles: [],
  },
  passages: [
    { id: 'west', position: { x: 3384, y: 0 }, tiles: [{ x: 70, y: -1 }, { x: 70, y: 0 }], fightState: 'open' },
    { id: 'maze-exit', position: { x: 4104, y: 312 }, tiles: mazeSeal,
      fightState: 'flame', flame: flameBarrierFromTiles(mazeSeal) },
  ],
  spawnPoints: {
    boss: mazeBoss,
    party: [{ x: 4160, y: -72 }, { x: 4160, y: -24 }, { x: 4160, y: 24 }, { x: 4160, y: 72 }],
  },
  encounter: {
    preparationMs: 3000,
    regions: {
      trigger: circle(mazeBoss, 80),
      admission: circle(mazeBoss, 100),
      combat: circle(mazeBoss, 520),
      ejectIntruders: circle(mazeBoss, 100),
      bossAggro: circle(mazeBoss, 500),
      bossLeash: circle(mazeBoss, 500),
    },
    ejectTo: { x: 3750, y: 312 },
  },
  spawnExclusionMargin: 180,
  approach: {
    from: { x: 300, y: 0 }, to: { x: 3360, y: 0 }, halfWidth: 72, corridorHalfWidth: 500,
    waves: [{ amplitude: 105, cycles: 3 }, { amplitude: 34, cycles: 7 }],
    markers: [0.2, 0.42, 0.65, 0.86],
  },
  theme: {
    floor: '#665f59', wall: '#37363b', wallTop: '#655d64', minimap: '#d47a56',
    markerStone: '#62595b', markerEdge: '#302d32', markerRune: '#e58b65aa',
  },
};

export const DUNGEON_DEFINITIONS: readonly DungeonDefinition[] = [RUINS_DUNGEON, MAZE_DUNGEON];
if (new Set(DUNGEON_DEFINITIONS.map(dungeon => dungeon.id)).size !== DUNGEON_DEFINITIONS.length
  || new Set(DUNGEON_DEFINITIONS.map(dungeon => dungeon.bossId)).size !== DUNGEON_DEFINITIONS.length) {
  throw new Error('Il catalogo dungeon contiene id dungeon o boss duplicati.');
}
export const DUNGEON_BY_ID = new Map(DUNGEON_DEFINITIONS.map(definition => [definition.id, definition]));
export const DUNGEON_BY_BOSS_ID = new Map(DUNGEON_DEFINITIONS.map(definition => [definition.bossId, definition]));

const insideRect = (tx: number, ty: number, rect: DungeonTileRect): boolean =>
  tx >= rect.minTx && tx <= rect.maxTx && ty >= rect.minTy && ty <= rect.maxTy;

export function dungeonTile(definition: DungeonDefinition, tx: number, ty: number): TileKind | undefined {
  if (!insideRect(tx, ty, definition.layout.bounds)) return undefined;
  if (definition.layout.obstacles.some(rect => insideRect(tx, ty, rect))
    || definition.layout.obstacleTiles.some(tile => tile.x === tx && tile.y === ty)) return 'rock';
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

export function dungeonStoneTiles(definition: DungeonDefinition): readonly Vec2[] {
  return definition.passages.filter(passage => passage.fightState === 'stone').flatMap(passage => [...passage.tiles]);
}

export function dungeonFlames(definition: DungeonDefinition): readonly DungeonFlameBarrier[] {
  return definition.passages.filter((passage): passage is DungeonPassage & { fightState: 'flame' } => passage.fightState === 'flame')
    .map(passage => passage.flame);
}

export function touchesDungeonFlame(definition: DungeonDefinition, position: Vec2, radius = 0): boolean {
  return dungeonFlames(definition).some(flame => touchesFlame(flame, position, radius));
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
  return DUNGEON_DEFINITIONS.some(definition => lockedBosses.has(definition.bossId)
    && dungeonStoneTiles(definition).some(tile => tile.x === tx && tile.y === ty));
}

export function dungeonTileCenter(tile: Vec2): Vec2 {
  return { x: (tile.x + 0.5) * TILE_SIZE, y: (tile.y + 0.5) * TILE_SIZE };
}

function touchesFlame(flame: DungeonFlameBarrier, position: Vec2, radius = 0): boolean {
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
  if (![bounds.minTx, bounds.maxTx, bounds.minTy, bounds.maxTy].every(Number.isInteger)
    || bounds.minTx > bounds.maxTx || bounds.minTy > bounds.maxTy) fail('limiti della mappa non validi.');
  if (!finitePoint(definition.area) || !Number.isFinite(definition.area.radius) || definition.area.radius <= 0) fail('area mondo non valida.');
  if (!finitePoint(definition.spawnPoints.boss) || !definition.spawnPoints.party.length
    || definition.spawnPoints.party.some(point => !finitePoint(point))) fail('spawn boss/party non validi.');
  for (const [name, point] of [['boss', definition.spawnPoints.boss], ...definition.spawnPoints.party.map((point, index) => [`party ${index}`, point] as const)] as const) {
    const tx = Math.floor(point.x / TILE_SIZE), ty = Math.floor(point.y / TILE_SIZE);
    if (dungeonTile(definition, tx, ty) !== definition.layout.floor) fail(`spawn ${name} sopra una tile solida o fuori mappa.`);
  }
  if (!Number.isFinite(definition.encounter.preparationMs) || definition.encounter.preparationMs < 0) fail('preparationMs non valido.');
  if (!finitePoint(definition.encounter.ejectTo)) fail('destinazione di espulsione non valida.');
  const passageIds = new Set<string>(), passageTiles = new Map<string, string>(), stoneTiles = new Set<string>();
  const flames: DungeonFlameBarrier[] = [];
  for (const passage of definition.passages) {
    if (!passage.id || passageIds.has(passage.id)) fail(`passaggio duplicato o senza id: ${passage.id}.`);
    passageIds.add(passage.id);
    if (!finitePoint(passage.position) || !passage.tiles.length) fail(`passaggio ${passage.id} senza posizione o tile.`);
    for (const tile of passage.tiles) {
      if (!Number.isInteger(tile.x) || !Number.isInteger(tile.y) || !insideRect(tile.x, tile.y, bounds)) fail(`tile fuori mappa nel passaggio ${passage.id}.`);
      if (dungeonTile(definition, tile.x, tile.y) !== definition.layout.floor) fail(`il passaggio ${passage.id} occupa una tile solida.`);
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
    ['bossAggro', regions.bossAggro], ['bossLeash', regions.bossLeash]] as const) {
    if (!regionContained(region, regions.combat)) fail(`la regione ${name} deve essere contenuta in combat.`);
  }
  if (insideDungeonRegion(regions.combat, definition.encounter.ejectTo)) fail('ejectTo deve essere esterno alla regione combat.');

  // Every walkable boundary opening must be named, otherwise a map edit could create an accidental escape route.
  for (let ty = bounds.minTy; ty <= bounds.maxTy; ty++) for (let tx = bounds.minTx; tx <= bounds.maxTx; tx++) {
    if (tx !== bounds.minTx && tx !== bounds.maxTx && ty !== bounds.minTy && ty !== bounds.maxTy) continue;
    if (dungeonTile(definition, tx, ty) === definition.layout.floor && !passageTiles.has(tileKey({ x: tx, y: ty }))) {
      fail(`apertura sul bordo ${tx},${ty} non dichiarata come passaggio.`);
    }
  }
}

for (const definition of DUNGEON_DEFINITIONS) assertValidDungeonDefinition(definition);
