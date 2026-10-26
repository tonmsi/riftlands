import type { TileKind, Vec2 } from './types';
import { validGeometry, validElevation, type ElevationGeometry } from './elevation';
import { validWorldPainting, type WorldPainting } from './world-painting';
import { validNpcSettings, type NpcSettings } from './npc-settings';
import { NPC_DEFINITIONS, type NpcKind, type NpcTemplateId } from './npcs';
import { WORLD_TILE_TERRAINS, type WorldTileChunk } from './world-tiles';
import { CLIFF_VARIANTS, type CliffVariant } from './terrain-cliffs';

/** Coordinates in authored documents are tiles, including fractional visual dimensions.
 * Gameplay positions remain world units. The format contains data only, never scripts. */
export interface AssetCell { blocked: boolean; visibility: 'normal' | 'hide' | 'fade' | 'hide-fade'; elevation?: number; }
export const DEFAULT_ASSET_FADE = { opacity: .28, feather: .35, durationMs: 180 };
/** Coordinates and full dimensions relative to artwork, before its transform.
 * x/y locate the ellipse centre or the silhouette base. */
export interface AssetShadow { kind: 'ellipse' | 'silhouette'; skew: number; x: number; y: number; width: number; height: number; opacity: number; softness: number; }
export const DEFAULT_ASSET_SHADOW: AssetShadow = { kind: 'silhouette', skew: .15, x: .5, y: .95, width: .8, height: .2, opacity: .3, softness: .5 };
export const assetCellFades = (cell?: AssetCell): boolean => cell?.visibility === 'fade' || cell?.visibility === 'hide-fade';
export interface AssetGeneration {
  enabled: boolean; category: string; terrains: TileKind[];
  temperature: [number, number]; moisture: [number, number]; density: number; spacing: number;
}
export interface WorldAsset {
  /** Fine behavior cells per tile edge; never changes image or physical dimensions. */
  cellSubdivision?: 1 | 2 | 4 | 8;
  geometry?: ElevationGeometry;
  id: string; name: string; image: string; width: number; height: number;
  columns: number; rows: number; cells: AssetCell[];
  layer: 'ground' | 'object'; pivot: Vec2; generation: AssetGeneration;
  /** Built-in animated artwork is data-selected, never tied to an asset ID or world position. */
  visual?: { kind: 'image' } | { kind: 'fire'; style: 'brazier' | 'campfire' };
  fade?: { opacity: number; feather: number; durationMs: number };
  /** Catalog organization only; independent of procedural generation categories. */
  group?: string;
  /** Alternative in the referenced asset's random pool; inherits its generation rules. */
  variantOf?: string;
  /** Artwork moves and scales independently of the annotated tile grid. */
  imageTransform?: { x: number; y: number; scale: number };
  /** Missing inherits from variantOf; null explicitly disables the shadow. */
  shadow?: AssetShadow | null;
}
export function worldAssetShadow(asset: WorldAsset, parent?: WorldAsset): AssetShadow | undefined {
  return (asset.shadow === undefined && asset.variantOf ? parent?.shadow : asset.shadow) ?? undefined;
}
export function worldAssetImageBounds(asset: WorldAsset) {
  const { x = 0, y = 0, scale = 1 } = asset.imageTransform ?? {};
  return { x, y, width: asset.width * scale, height: asset.height * scale };
}
export interface AssetPlacement extends Vec2 { id: string; assetId: string; pivotY?: number; baseElevation?: number; bushJs?: boolean; }
export interface TileOverride extends Vec2 {
  terrain?: TileKind; suppressAssets?: boolean;
  /** Painted grass allows scattered bushes in this style while suppressing other generated assets. */
  bushStyle?: 'png' | 'js';
}
export type ZoneShape = { kind: 'rect'; x: number; y: number; width: number; height: number }
  | { kind: 'circle'; x: number; y: number; radius: number };
export interface NpcRule { density: number; maxPerChunk: number; weights: Record<NpcKind, number>; }
export interface ZoneMusic { src: string; volume: number; }
/** Tile coordinates; the source is at the tile centre. Empty music allows an editor draft. */
export interface WorldSoundPoint extends Vec2 { id: string; name: string; radius: number; innerRadius: number; music?: ZoneMusic; restartOnEnter?: boolean; }
export interface ClimateBand { at: number; value: number; curve?: number; }
export interface WorldZone {
  id: string; name: string; priority: number; shape: ZoneShape;
  temperature?: number; moisture?: number; pvp?: boolean; generateAssets?: boolean;
  /** Inward climate blending depth, as a fraction of radius / shortest half-side. Missing preserves hard overrides. */
  climateTransition?: number;
  /** Independent curve strength per climate property; 1 is linear, missing is 3. */
  climateCurves?: { temperature?: number; moisture?: number };
  /** Up to three absolute climate targets; positions are fractions of the transition depth. Last position is 1. */
  climateBands?: { temperature?: ClimateBand[]; moisture?: ClimateBand[] };
  npcs?: NpcRule; arenaId?: string;
  /** Entering this area advances the matching reach-area quest, on the server. */
  questId?: string;
  music?: ZoneMusic;
}
export interface WorldNpc extends Vec2 { id: string; npcKind: NpcTemplateId; level: number; elevation?: number; settings?: NpcSettings; }
/** One placement per installed dungeon, preserving encounter/boss identity and persistence. */
export interface WorldDungeon extends Vec2 { dungeonId: string; enabled?: boolean; pvp?: boolean; }
export interface WorldInterior { id: string; name: string; width: number; height: number; document: WorldDocument; pvp?: boolean; kind?: 'building' | 'dungeon'; }
/** Coordinates are tile centres. Each link is directional; return doors are explicit links. */
export interface WorldWarp {
  entryElevation?: number; arrivalElevation?: number;
  id: string; name: string; from: string; to: string; entry: Vec2; arrival: Vec2; entrySize?: Vec2; arrivalSize?: Vec2;
  activation: 'walk' | 'interact';
  reverseId?: string;
}
export interface WorldDocument {
  cliffAssets?: Partial<Record<CliffVariant, string>>;
  geometry?: ElevationGeometry;
  spawnElevation?: number;
  painting?: WorldPainting;
  version: 1 | 2; generatorVersion: 1; seed: number; spawn: Vec2;
  assets: WorldAsset[]; placements: AssetPlacement[]; tiles: TileOverride[];
  zones: WorldZone[]; npcs: WorldNpc[]; dungeons: WorldDungeon[];
  soundPoints?: WorldSoundPoint[];
  tileChunks?: WorldTileChunk[];
  interiors?: WorldInterior[];
  warps?: WorldWarp[];
  /** Runtime surface metadata, never accepted from exported project fields. */
  interiorBounds?: { width: number; height: number; name: string; id: string; pvp?: boolean };
}
export const WORLD_TERRAINS = WORLD_TILE_TERRAINS;
export const DEFAULT_CELL: AssetCell = { blocked: false, visibility: 'normal' };
export const ASSET_CELL_SUBDIVISIONS = [1, 2, 4, 8] as const;
export const assetCellSubdivision = (a: Pick<WorldAsset,'cellSubdivision'>): number => a.cellSubdivision ?? 1;
export const assetCellColumns = (a: Pick<WorldAsset,'cellSubdivision'|'columns'>): number => a.columns * assetCellSubdivision(a);
export const assetCellRows = (a: Pick<WorldAsset,'cellSubdivision'|'rows'>): number => a.rows * assetCellSubdivision(a);
export function subdivideWorldAsset(asset: WorldAsset, subdivision: number): void {
  if (!ASSET_CELL_SUBDIVISIONS.includes(subdivision as 1|2|4|8)) throw new Error('Suddivisione non valida: scegli 1, 2, 4 o 8.');
  const oldDivision=assetCellSubdivision(asset); if (oldDivision===subdivision) return;
  const oldColumns=assetCellColumns(asset), oldRows=assetCellRows(asset), old=asset.cells;
  const columns=asset.columns*subdivision, rows=asset.rows*subdivision;
  asset.cells=Array.from({length:columns*rows},(_,i)=>{
    const x=i%columns,y=Math.floor(i/columns); let blocked=false,hide=false,fade=false, elevation: number | undefined, seen=false;
    for(let oy=Math.floor(y*oldDivision/subdivision);oy<Math.min(oldRows,Math.ceil((y+1)*oldDivision/subdivision));oy++)
      for(let ox=Math.floor(x*oldDivision/subdivision);ox<Math.min(oldColumns,Math.ceil((x+1)*oldDivision/subdivision));ox++) {
        const cell=old[oy*oldColumns+ox]; blocked ||= cell.blocked;
        if(seen && elevation!==cell.elevation) throw new Error('Le sottocelle hanno quote diverse: mantieni la suddivisione o uniforma prima le quote.');
        elevation=cell.elevation;seen=true;
        hide ||= cell.visibility==='hide'||cell.visibility==='hide-fade'; fade ||= cell.visibility==='fade'||cell.visibility==='hide-fade';
      }
    return {blocked,visibility:hide ? fade ? 'hide-fade' : 'hide' : fade ? 'fade' : 'normal',...(elevation!==undefined?{elevation}:{})};
  });
  asset.cellSubdivision=subdivision as 1|2|4|8;
}
const LEGACY_FIRE_IMAGES: Readonly<Record<string, 'brazier' | 'campfire'>> = {
  '/world-assets/brazier.svg': 'brazier',
  '/world-assets/ddbdb1a40dac723ae93c5f978cedc1c19c6f7efae2f819ce09f37d0cbb6fe65b.svg': 'brazier',
  '/world-assets/campfire.svg': 'campfire',
  '/world-assets/8be2ee9ad348b9996368c35425c71b666d341cf52382cc4208cf1703b008805e.svg': 'campfire',
};
/** Compatibility for drafts/exported projects made before built-in animation metadata existed.
 * An explicit image choice always takes precedence over these legacy built-in sources. */
export function worldAssetVisual(asset: WorldAsset): NonNullable<WorldAsset['visual']> {
  if (asset.visual) return asset.visual;
  const style = LEGACY_FIRE_IMAGES[asset.image];
  if (style) return { kind: 'fire', style };
  return { kind: 'image' };
}
export function validWorldAssetImage(image: unknown): image is string {
  if (typeof image !== 'string' || !image.startsWith('/world-assets/') || /[?#]/.test(image)) return false;
  try {
    const parts=decodeURIComponent(image.slice('/world-assets/'.length)).split('/');
    return parts.every(p=>p.length>0 && p!=='.' && p!=='..' && !/[\\\x00-\x1f:*?"<>|]/.test(p)) && /\.(png|svg)$/i.test(parts.at(-1)!);
  } catch { return false; }
}
export function newWorldDocument(seed = 734291): WorldDocument {
  return { version: 1, generatorVersion: 1, seed, spawn: { x: 0, y: 0 }, assets: [], placements: [], tiles: [], zones: [], npcs: [], dungeons: [] };
}
export function newWorldAsset(id: string, name: string, image: string): WorldAsset {
  return { id, name, image, width: 1, height: 1, columns: 1, rows: 1, cells: [{ ...DEFAULT_CELL }],
    layer: 'object', pivot: { x: .5, y: 1 }, generation: { enabled: false, category: 'vegetation', terrains: ['grass', 'bush', 'mud'], temperature: [0, 1], moisture: [0, 1], density: .2, spacing: 1 } };
}
/** Preserve existing cell annotations when changing scale, rather than silently resampling semantics. */
export function resizeWorldAsset(asset: WorldAsset, width: number, height: number): void {
  if (![width, height].every(n => Number.isFinite(n) && n >= .25 && n <= 32)) throw new Error('Dimensioni asset: da 0,25 a 32 quadratini.');
  const columns = Math.ceil(width), rows = Math.ceil(height), old = asset.cells, division=assetCellSubdivision(asset);
  const oldColumns=assetCellColumns(asset), oldRows=assetCellRows(asset), fineColumns=columns*division;
  asset.cells = Array.from({ length: fineColumns * rows * division }, (_, i) => ({ ...(i % fineColumns < oldColumns && Math.floor(i / fineColumns) < oldRows
    ? old[Math.floor(i / fineColumns) * oldColumns + i % fineColumns] : DEFAULT_CELL) }));
  asset.width = width; asset.height = height; asset.columns = columns; asset.rows = rows;
}

/** Strict boundary parser shared by file import, browser storage and the offline write API. */
export function parseWorldDocument(value: string | unknown): WorldDocument {
  const d: any = typeof value === 'string' ? JSON.parse(value) : value;
  const fail = (message: string): never => { throw new Error(`Mondo non valido: ${message}`); };
  const object = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v);
  const finite = (v: any, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const integer = (v: any, min: number, max: number) => Number.isSafeInteger(v) && finite(v, min, max);
  const point = (v: any) => object(v) && integer(v.x, -10_000_000, 10_000_000) && integer(v.y, -10_000_000, 10_000_000);
  const id = (v: any) => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(v);
  const name = (v: any) => typeof v === 'string' && v.trim().length > 0 && v.length <= 160;
  const list = (v: any, max: number, label: string) => { if (!Array.isArray(v) || v.length > max) fail(label); };
  const unique = (items: any[], key: (v: any) => string, label: string) => { if (new Set(items.map(key)).size !== items.length) fail(`${label}: duplicati`); };
  const range = (v: any) => Array.isArray(v) && v.length === 2 && v.every(n => finite(n, 0, 1)) && v[0] <= v[1];
  const boolean = (v: any) => typeof v === 'boolean';
  if (!object(d) || ![1, 2].includes(d.version) || d.generatorVersion !== 1 || !integer(d.seed, -2147483648, 2147483647) || !point(d.spawn)) fail('versione, seed o spawn');
  if (d.painting !== undefined && !validWorldPainting(d.painting)) fail('world painting');
  if (d.geometry !== undefined && !validGeometry(d.geometry)) fail('geometria dei livelli');
  if (d.spawnElevation !== undefined && !validElevation(d.spawnElevation)) fail('quota spawn');
  list(d.assets, 4096, 'catalogo asset'); list(d.placements, 100_000, 'piazzamenti'); list(d.tiles, 500_000, 'terreno');
  list(d.zones, 10_000, 'zone'); list(d.npcs, 100_000, 'NPC'); list(d.dungeons, 4096, 'dungeon');
  if (d.soundPoints !== undefined) {
    list(d.soundPoints, 4096, 'punti sonori');
    for (const p of d.soundPoints) {
      if (!object(p) || !point(p) || !id(p.id) || !name(p.name) || !finite(p.radius, .25, 1024)
        || !finite(p.innerRadius, 0, p.radius) || p.innerRadius >= p.radius) fail('punto sonoro: raggi o posizione');
      if (p.restartOnEnter !== undefined && !boolean(p.restartOnEnter)) fail('punto sonoro: riproduzione');
      if (p.music !== undefined && (!object(p.music) || typeof p.music.src !== 'string'
        || !/^\/music\/[a-zA-Z0-9_-]+\.(mp3|ogg|wav)$/.test(p.music.src) || !finite(p.music.volume, 0, 1))) fail('musica punto sonoro');
    }
    unique(d.soundPoints, p => p.id, 'punti sonori');
  }
  if (d.version === 2 && (!Array.isArray(d.tileChunks) || d.tiles.length)) fail('versione 2: terreno in chunk');
  for (const a of d.assets) {
    if (!object(a)) fail('definizione asset');
    if (a.geometry !== undefined && (!validGeometry(a.geometry) || [...a.geometry.surfaces, ...a.geometry.solids, ...a.geometry.stairs].some(r => r.x < 0 || r.y < 0 || r.x + r.width > a.columns || r.y + r.height > a.rows))) fail('geometria asset fuori griglia');
    if (!object(a) || !id(a.id) || !name(a.name) || !validWorldAssetImage(a.image)
      || !finite(a.width, .25, 32) || !finite(a.height, .25, 32) || a.columns !== Math.ceil(a.width) || a.rows !== Math.ceil(a.height)
      || !['ground', 'object'].includes(a.layer) || !object(a.pivot) || !finite(a.pivot.x, 0, 1) || !finite(a.pivot.y, 0, 1)) fail('definizione asset');
    if (a.cellSubdivision !== undefined && !ASSET_CELL_SUBDIVISIONS.includes(a.cellSubdivision)) fail(`suddivisione di ${a.id}`);
    list(a.cells, 65536, 'celle asset');
    if (a.group !== undefined && (!name(a.group) || a.group.length > 80)) fail(`gruppo di ${a.id}`);
    if (a.imageTransform !== undefined && (!object(a.imageTransform) || !finite(a.imageTransform.x, -32, 32)
      || !finite(a.imageTransform.y, -32, 32) || !finite(a.imageTransform.scale, .1, 8))) fail(`trasformazione immagine di ${a.id}`);
    if (a.visual !== undefined && (!object(a.visual) || (a.visual.kind !== 'image' && (a.visual.kind !== 'fire' || !['brazier', 'campfire'].includes(a.visual.style))))) fail(`aspetto di ${a.id}`);
    if (a.shadow !== undefined && a.shadow !== null && (!object(a.shadow) || !['ellipse', 'silhouette'].includes(a.shadow.kind) || !finite(a.shadow.skew, -1, 1) || !['x', 'y', 'width', 'height', 'opacity', 'softness'].every(k => finite(a.shadow[k], 0, 1)))) fail(`ombra di ${a.id}`);
    if (a.cells.length !== assetCellColumns(a) * assetCellRows(a) || !a.cells.every((c: any) => object(c) && boolean(c.blocked) && ['normal', 'hide', 'fade', 'hide-fade'].includes(c.visibility) && (c.elevation===undefined||validElevation(c.elevation)))) fail(`celle di ${a.id}`);
    if (a.fade !== undefined && (!object(a.fade) || !finite(a.fade.opacity, 0, 1) || !finite(a.fade.feather, 0, 1) || !integer(a.fade.durationMs, 0, 2000))) fail(`sfumatura di ${a.id}`);
    const g = a.generation;
    if (!object(g) || !boolean(g.enabled) || !id(g.category) || !range(g.temperature) || !range(g.moisture)
      || !finite(g.density, 0, 1) || !integer(g.spacing, 0, 16) || !Array.isArray(g.terrains) || !g.terrains.length
      || g.terrains.length > WORLD_TERRAINS.length || !g.terrains.every((t: any) => WORLD_TERRAINS.includes(t))) fail(`regole di ${a.id}`);
  }
  unique(d.assets, a => a.id, 'asset'); const assets = new Set(d.assets.map((a: any) => a.id));
  if (d.cliffAssets !== undefined && (!object(d.cliffAssets) || Object.entries(d.cliffAssets).some(([variant, assetId]) => !CLIFF_VARIANTS.includes(variant as CliffVariant) || !assets.has(assetId)))) fail('catalogo bordi cliff-grid');
  const assetDefinitions = new Map<string, WorldAsset>(d.assets.map((a: WorldAsset) => [a.id, a]));
  for (const a of d.assets) if (a.variantOf !== undefined) {
    const parent = assetDefinitions.get(a.variantOf);
    if (!id(a.variantOf) || !parent || parent.id === a.id || parent.variantOf !== undefined) fail(`gruppo varianti di ${a.id}: scegli un asset principale esistente`);
  }
  for (const p of d.placements) {
    if (!point(p) || !id(p.id) || !assets.has(p.assetId) || (p.pivotY !== undefined && !finite(p.pivotY,0,1)) || (p.baseElevation !== undefined && !validElevation(p.baseElevation)) || (p.bushJs !== undefined && !boolean(p.bushJs))) fail('piazzamento asset o riferimento assente');
    const a = assetDefinitions.get(p.assetId)!;
    const base = p.baseElevation ?? 0;
    if(a.cells.some((c:AssetCell)=>c.elevation!==undefined&&!validElevation(base+c.elevation))) fail('quote sottocelle fuori intervallo');
    if (a.geometry && (a.geometry.surfaces.some(s => !validElevation(s.elevation + base)) || a.geometry.stairs.some(s => !validElevation(s.from + base) || !validElevation(s.to + base)) || a.geometry.solids.some(s => !validElevation(s.base + base) || s.top + base > 128))) fail('quote asset fuori intervallo');
  }
  unique(d.placements, p => p.id, 'piazzamenti');
  for (const t of d.tiles) if (!point(t) || (t.terrain === undefined && t.suppressAssets !== true)
    || (t.terrain !== undefined && !WORLD_TERRAINS.includes(t.terrain)) || (t.suppressAssets !== undefined && !boolean(t.suppressAssets))
    || (t.bushStyle !== undefined && (!['png', 'js'].includes(t.bushStyle) || !['grass', 'bush'].includes(t.terrain!)))) fail('tile');
  unique(d.tiles, t => `${t.x},${t.y}`, 'tile');
  if (d.tileChunks !== undefined) {
    list(d.tileChunks, 100_000, 'chunk terreno');
    let cells = 0, runs = 0;
    for (const c of d.tileChunks) {
      if (!Array.isArray(c) || c.length < 5 || (c.length - 2) % 3 || !integer(c[0], -312500, 312500) || !integer(c[1], -312500, 312500)) fail('chunk terreno');
      let end = 0;
      for (let i = 2; i < c.length; i += 3) {
        const code = c[i + 2], base = code & 31, style = code & 96;
        if (!integer(c[i], end, 1023) || !integer(c[i + 1], 1, 1024 - c[i]) || !integer(code, 1, 81)
          || base < 1 || base > 17 || style === 96 || (style && ![2, 3, 10, 11].includes(base))) fail('intervallo terreno');
        end = c[i] + c[i + 1]; cells += c[i + 1]; runs++;
      }
    }
    if (cells > 20_000_000 || runs > 2_000_000) fail('budget terreno');
    unique(d.tileChunks, c => `${c[0]},${c[1]}`, 'chunk terreno');
    if (d.tiles.length) fail('usa celle legacy oppure chunk, senza mescolarli');
  }
  for (const z of d.zones) {
    if (!object(z) || !id(z.id) || !name(z.name) || !integer(z.priority, -10000, 10000) || !object(z.shape)
      || !finite(z.shape.x, -10_000_000, 10_000_000) || !finite(z.shape.y, -10_000_000, 10_000_000)) fail('zona');
    const s = z.shape;
    if (s.kind === 'rect' ? !integer(s.width, 1, 1_000_000) || !integer(s.height, 1, 1_000_000)
      : s.kind !== 'circle' || !finite(s.radius, .25, 1_000_000)) fail(`forma di ${z.id}`);
    for (const k of ['temperature', 'moisture']) if (z[k] !== undefined && !finite(z[k], 0, 1)) fail(`clima di ${z.id}`);
    if (z.climateTransition !== undefined && !finite(z.climateTransition, .01, 1)) fail(`transizione clima di ${z.id}`);
    if (z.climateCurves !== undefined && (!object(z.climateCurves)
      || Object.keys(z.climateCurves).some(k => !['temperature', 'moisture'].includes(k))
      || ['temperature', 'moisture'].some(k => z.climateCurves[k] !== undefined && !finite(z.climateCurves[k], .25, 12)))) fail(`curve clima di ${z.id}`);
    if (z.climateBands !== undefined) {
      if (!object(z.climateBands) || Object.keys(z.climateBands).some(k => !['temperature', 'moisture'].includes(k))) fail(`bande clima di ${z.id}`);
      for (const key of ['temperature', 'moisture']) if (z.climateBands[key] !== undefined) {
        const bands = z.climateBands[key];
        if (!Array.isArray(bands) || bands.length < 1 || bands.length > 3) fail(`bande clima di ${z.id}`);
        let previous = 0;
        for (const band of bands) {
          if (!object(band) || !finite(band.at, .001, 1) || band.at <= previous || !finite(band.value, 0, 1)
            || (band.curve !== undefined && !finite(band.curve, .25, 12))) fail(`bande clima di ${z.id}`);
          previous = band.at;
        }
        if (previous !== 1) fail(`ultima banda clima di ${z.id}: posizione 100% richiesta`);
      }
    }
    for (const k of ['pvp', 'generateAssets']) if (z[k] !== undefined && !boolean(z[k])) fail(`regole di ${z.id}`);
    if (z.arenaId !== undefined && !id(z.arenaId)) fail('arena');
    if (z.questId !== undefined && !id(z.questId)) fail('missione zona');
    if (z.music !== undefined && (!object(z.music) || typeof z.music.src !== 'string'
      || !/^\/music\/[a-zA-Z0-9_-]+\.(mp3|ogg|wav)$/.test(z.music.src) || !finite(z.music.volume, 0, 1))) fail('musica zona');
    if (z.npcs !== undefined) {
      const n = z.npcs;
      if (!object(n) || !finite(n.density, 0, 1) || !integer(n.maxPerChunk, 0, 24) || !object(n.weights)
        || !['slime', 'wisp', 'sentinel'].every(k => finite(n.weights[k], 0, 100))) fail(`NPC di ${z.id}`);
      const total = n.weights.slime + n.weights.wisp + n.weights.sentinel;
      if (total !== 0 && Math.abs(total - 100) > .001) fail(`percentuali NPC di ${z.id}: totale 100 oppure 0`);
    }
  }
  unique(d.zones, z => z.id, 'zone');
  for (const n of d.npcs) if (!point(n) || !id(n.id) || !Object.hasOwn(NPC_DEFINITIONS, n.npcKind) || !integer(n.level, 1, 100) || (n.elevation !== undefined && !validElevation(n.elevation)) || (n.settings !== undefined && !validNpcSettings(n.settings))) fail('NPC manuale');
  unique(d.npcs, n => n.id, 'NPC manuali');
  for (const p of d.dungeons) if (!point(p) || !id(p.dungeonId) || (p.enabled !== undefined && !boolean(p.enabled)) || (p.pvp !== undefined && !boolean(p.pvp))) fail('piazzamento dungeon');
  unique(d.dungeons, p => p.dungeonId, 'dungeon');
  if (d.interiors !== undefined) {
    list(d.interiors, 128, 'interni'); unique(d.interiors, (m: any) => m.id, 'interni');
    for (const m of d.interiors) {
      if (!object(m) || !id(m.id) || m.id === 'world' || !name(m.name) || !integer(m.width, 4, 512) || !integer(m.height, 4, 512)
        || (m.pvp !== undefined && !boolean(m.pvp)) || (m.kind !== undefined && !['building', 'dungeon'].includes(m.kind))
        || !object(m.document) || m.document.interiors !== undefined || m.document.warps !== undefined) fail('mappa interna');
      parseWorldDocument({ ...m.document, assets: d.assets, seed: d.seed });
    }
  }
  if (d.warps !== undefined) {
    list(d.warps, 4096, 'warp'); unique(d.warps, (w: any) => w.id, 'warp');
    const maps = new Set(['world', ...(d.interiors ?? []).map((m: any) => m.id)]);
    for (const w of d.warps) if (!object(w) || !id(w.id) || !name(w.name) || !maps.has(w.from) || !maps.has(w.to)
      || (w.entryElevation !== undefined && !validElevation(w.entryElevation)) || (w.arrivalElevation !== undefined && !validElevation(w.arrivalElevation))
      || [w.entrySize,w.arrivalSize].some(size => size !== undefined && (!point(size) || !['1,1','2,1','1,2','1,3','3,1'].includes(`${size.x},${size.y}`)))
      || !point(w.entry) || !point(w.arrival) || !['walk', 'interact'].includes(w.activation)
      || (w.reverseId !== undefined && (!id(w.reverseId) || w.reverseId === w.id))) fail('collegamento warp');
  }
  // Reconstruct the outer shape so unknown top-level fields cannot become executable extensions.
  const result: WorldDocument = structuredClone({ ...(d.cliffAssets !== undefined ? { cliffAssets: d.cliffAssets } : {}), ...(d.geometry !== undefined ? { geometry: d.geometry } : {}), ...(d.spawnElevation !== undefined ? { spawnElevation: d.spawnElevation } : {}), ...(d.painting !== undefined ? { painting: d.painting } : {}), version: d.version, generatorVersion: 1, seed: d.seed, spawn: d.spawn, assets: d.assets,
    placements: d.placements, tiles: d.tiles, zones: d.zones, npcs: d.npcs, dungeons: d.dungeons, ...(d.soundPoints !== undefined ? { soundPoints: d.soundPoints } : {}), ...(d.tileChunks !== undefined ? { tileChunks: d.tileChunks } : {}),
    ...(d.interiors !== undefined ? { interiors: d.interiors.map((m: WorldInterior) => ({ id: m.id, name: m.name, width: m.width, height: m.height,
      ...(m.pvp !== undefined ? { pvp: m.pvp } : {}), ...(m.kind !== undefined ? { kind: m.kind } : {}),
      document: { ...parseWorldDocument({ ...m.document, assets: d.assets, seed: d.seed }), assets: [] } })) } : {}),
    ...(d.warps !== undefined ? { warps: d.warps.map((w: WorldWarp) => ({ id: w.id, name: w.name, from: w.from, to: w.to, entry: w.entry, arrival: w.arrival, activation: w.activation,
      ...(w.entryElevation !== undefined ? { entryElevation: w.entryElevation } : {}), ...(w.arrivalElevation !== undefined ? { arrivalElevation: w.arrivalElevation } : {}),
      ...(w.entrySize ? {entrySize:w.entrySize} : {}), ...(w.arrivalSize ? {arrivalSize:w.arrivalSize} : {}),
      ...(w.reverseId !== undefined ? { reverseId: w.reverseId } : {}) })) } : {}) });
  // Persist recovered animation before an export can rename the image again.
  for (const asset of result.assets) if (!asset.visual && worldAssetVisual(asset).kind === 'fire') asset.visual = worldAssetVisual(asset);
  return result;
}
