import type { TileKind, Vec2 } from './types';
import { TILE_SIZE } from './tile-size';
import { stairFootprint, stairGeometry, stairLinks, stairSurfaceId, validateSurfaceStairs } from './surface-stairs';
import { isWallSpriteKitId } from './wall-sprite-kits';

export const BASE_SURFACE = 'ground';
export const ELEVATION_STEP = 16;
export const MAX_ELEVATION = 16;
export const SURFACE_MATERIALS = ['grass', 'path', 'water', 'rock', 'bush', 'mud', 'snow', 'ice', 'stone', 'brick', 'sand', 'wood'] as const;
export type SurfaceMaterial = TileKind | 'stone' | 'brick' | 'sand' | 'wood';
export const WALL_MATERIALS = ['earth', 'rock', 'stone', 'brick', 'wood'] as const;
export type WallMaterial = typeof WALL_MATERIALS[number];
export interface SurfaceCell {
  x: number; y: number; surfaceId: string; elevation: number;
  material: SurfaceMaterial; wallMaterial: WallMaterial; kind: 'ground' | 'bridge' | 'stairs'; blocked?: boolean;
  /** Optional PNG wall kit; geometry and collision remain independent from its artwork. */
  wallSkin?: string;
}
export interface SurfaceEndpoint { x: number; y: number; surfaceId: string; }
export type StairProfile = 'landings' | 'incline';
export interface SurfaceStair {
  id: string; kind: 'stairs' | 'ramp';
  from: SurfaceEndpoint & { elevation: number }; to: SurfaceEndpoint & { elevation: number };
  /** Traversable corridor width in world pixels, independent of the tile grid. */
  width: number;
  /** New inclines run continuously between the two bank centres; absence preserves historical landings. */
  profile?: StairProfile;
  /** Only suspended stairs permit a separate lower route. Missing/false means a solid body. */
  underpass?: boolean;
}
export interface SurfaceLink {
  id: string; kind: 'stairs' | 'ramp' | 'bridge-entry'; from: SurfaceEndpoint; to: SurfaceEndpoint;
}
export interface ResolvedSurface extends SurfaceCell { blocked: boolean; }
export const surfaceKey = (x: number, y: number, surfaceId = BASE_SURFACE): string => `${x},${y}@${surfaceId}`;
export function validSurfaceId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(value);
}
export function validSurfacePoint(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const p = value as Vec2;
  return (p.surfaceId === undefined || validSurfaceId(p.surfaceId))
    && (p.elevation === undefined || Number.isInteger(p.elevation) && p.elevation >= 0 && p.elevation <= MAX_ELEVATION);
}
export function copySurfacePoint(point: Vec2): Pick<Vec2, 'surfaceId' | 'elevation'> {
  return { ...(point.surfaceId !== undefined ? { surfaceId: point.surfaceId } : {}),
    ...(point.elevation !== undefined ? { elevation: point.elevation } : {}) };
}
/** Sparse metadata is independent of legacy terrain RLE, and survives its compaction unchanged. */
export function validateSurfaceData(cells: unknown = [], links: unknown = [], stairs: unknown = []): void {
  const fail = (message: string): never => { throw new Error(`Superfici non valide: ${message}`); };
  if (!Array.isArray(cells) || cells.length > 500_000 || !Array.isArray(links) || links.length > 100_000) fail('budget');
  const point = (p: any) => p && Number.isSafeInteger(p.x) && Math.abs(p.x) <= 10_000_000
    && Number.isSafeInteger(p.y) && Math.abs(p.y) <= 10_000_000 && validSurfaceId(p.surfaceId);
  const keys = new Set<string>();
  for (const c of cells as SurfaceCell[]) {
    if (!point(c) || !validSurfacePoint(c) || c.elevation === undefined
      || !SURFACE_MATERIALS.includes(c.material) || !WALL_MATERIALS.includes(c.wallMaterial)
      || c.wallSkin !== undefined && !isWallSpriteKitId(c.wallSkin)
      || !['ground', 'bridge', 'stairs'].includes(c.kind) || (c.kind === 'ground') !== (c.surfaceId === BASE_SURFACE)
      || c.blocked !== undefined && typeof c.blocked !== 'boolean') fail('cella, quota o materiale');
    const key = surfaceKey(c.x, c.y, c.surfaceId);
    if (keys.has(key)) fail('celle duplicate'); keys.add(key);
  }
  const ids = new Set<string>(), edges = new Set<string>();
  for (const l of links as SurfaceLink[]) {
    if (!l || !validSurfaceId(l.id) || !['stairs', 'ramp', 'bridge-entry'].includes(l.kind)
      || !point(l.from) || !point(l.to) || Math.abs(l.from.x - l.to.x) + Math.abs(l.from.y - l.to.y) !== 1) fail('collegamento: usa due celle adiacenti');
    if (ids.has(l.id)) fail('collegamenti duplicati'); ids.add(l.id);
    for (const p of [l.from, l.to]) if (p.surfaceId !== BASE_SURFACE && !keys.has(surfaceKey(p.x, p.y, p.surfaceId))) fail('collegamento a una superficie assente');
    const edge = [surfaceKey(l.from.x, l.from.y, l.from.surfaceId), surfaceKey(l.to.x, l.to.y, l.to.surfaceId)].sort().join('|');
    if (edges.has(edge)) fail('collegamento ripetuto'); edges.add(edge);
  }
  validateSurfaceStairs(cells as SurfaceCell[], links as SurfaceLink[], stairs);
}
/** Constant-time cell and connector queries; bridge layers are allocated only where authored. */
export class SurfaceIndex {
  private readonly cells = new Map<string, SurfaceCell>();
  private readonly columns = new Map<string, SurfaceCell[]>();
  private readonly links = new Map<string, SurfaceEndpoint[]>();
  private readonly stairColumns = new Map<string, SurfaceStair[]>();
  private readonly stairEdges = new Map<string, SurfaceStair>();
  readonly stairs: readonly SurfaceStair[];
  readonly hasSurfaces: boolean;
  constructor(cells: readonly SurfaceCell[] = [], links: readonly SurfaceLink[] = [], stairs: readonly SurfaceStair[] = []) {
    this.stairs = stairs;
    this.hasSurfaces = cells.length > 0 || stairs.length > 0;
    for (const c of cells) this.cells.set(surfaceKey(c.x, c.y, c.surfaceId), c);
    for (const c of this.cells.values()) { const key = `${c.x},${c.y}`; const bucket = this.columns.get(key) ?? []; bucket.push(c); this.columns.set(key, bucket); }
    for (const l of links) for (const [a, b] of [[l.from, l.to], [l.to, l.from]]) {
      const key = surfaceKey(a.x, a.y, a.surfaceId), bucket = this.links.get(key) ?? []; bucket.push(b); this.links.set(key, bucket);
    }
    for (const stair of stairs) for (const p of stairFootprint(stair)) {
      const key = `${p.x},${p.y}`, bucket = this.stairColumns.get(key) ?? []; bucket.push(stair); this.stairColumns.set(key, bucket);
    }
    for (const stair of stairs) for (const link of stairLinks(stair))
      this.stairEdges.set(this.edgeKey(link.from, link.to), stair);
  }
  at(x: number, y: number, surfaceId = BASE_SURFACE): SurfaceCell | undefined { return this.cells.get(surfaceKey(x, y, surfaceId)); }
  atColumn(x: number, y: number): readonly SurfaceCell[] { return this.columns.get(`${x},${y}`) ?? []; }
  exits(x: number, y: number, surfaceId = BASE_SURFACE): readonly SurfaceEndpoint[] { return this.links.get(surfaceKey(x, y, surfaceId)) ?? []; }
  stairsAtColumn(x: number, y: number): readonly SurfaceStair[] { return this.stairColumns.get(`${x},${y}`) ?? []; }
  private edgeKey(a: SurfaceEndpoint, b: SurfaceEndpoint): string {
    return [surfaceKey(a.x, a.y, a.surfaceId), surfaceKey(b.x, b.y, b.surfaceId)].sort().join('|');
  }
  stairForEdge(a: SurfaceEndpoint, b: SurfaceEndpoint): SurfaceStair | undefined { return this.stairEdges.get(this.edgeKey(a, b)); }
  stairFor(point: Vec2): SurfaceStair | undefined {
    const id = point.surfaceId ?? BASE_SURFACE;
    const tx = Math.floor(point.x / TILE_SIZE), ty = Math.floor(point.y / TILE_SIZE);
    const candidates = this.stairsAtColumn(tx, ty).filter(stair => {
      const g = stairGeometry(stair), t = g.progressAt(point);
      if (id === stairSurfaceId(stair)) return true;
      const endpoint = (g.dx ? tx === stair.from.x : ty === stair.from.y) && id === stair.from.surfaceId
        || (g.dx ? tx === stair.to.x : ty === stair.to.y) && id === stair.to.surfaceId;
      return endpoint && g.contains(point) && t >= 0 && t <= 1 && (id === stair.from.surfaceId || id === stair.to.surfaceId)
        && (point.elevation === undefined || point.elevation === stair.from.elevation || point.elevation === stair.to.elevation);
    });
    // At a landing shared by several flights, favour the flight already entered.
    return candidates.sort((a, b) => {
      const score = (stair: SurfaceStair) => { const g = stairGeometry(stair), t = g.progressAt(point);
        return id === stairSurfaceId(stair) ? 2 : t > g.landing / g.run && t < 1 - g.landing / g.run ? 1 : 0; };
      return score(b) - score(a);
    })[0];
  }
}
