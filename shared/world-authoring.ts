import { CHUNK_TILES } from './config';
import { coordinateHash } from './coordinate-random';
import type { TileKind } from './types';
import type { AssetCell, AssetPlacement, TileOverride, WorldAsset, WorldDocument, WorldZone, ZoneShape } from './world-schema';

export interface TileBounds { left: number; top: number; right: number; bottom: number; }
export function shapeBounds(s: ZoneShape): TileBounds {
  return s.kind === 'rect' ? { left: s.x, top: s.y, right: s.x + s.width, bottom: s.y + s.height }
    : { left: s.x - s.radius, top: s.y - s.radius, right: s.x + s.radius, bottom: s.y + s.radius };
}
export function insideShape(s: ZoneShape, x: number, y: number): boolean {
  return s.kind === 'rect' ? x >= s.x && y >= s.y && x < s.x + s.width && y < s.y + s.height
    : (x - s.x) ** 2 + (y - s.y) ** 2 <= s.radius ** 2;
}
export function overlaps(a: TileBounds, b: TileBounds): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
export function placementBounds(p: AssetPlacement, a: WorldAsset): TileBounds {
  return { left: p.x, top: p.y, right: p.x + a.columns, bottom: p.y + a.rows };
}
/** Bounded bucket expansion; enormous zones use a separate coarse list rather than millions of entries. */
export class SpatialIndex<T> {
  private buckets = new Map<string, T[]>();
  private large: T[] = [];
  constructor(private bounds: (item: T) => TileBounds) {}
  add(item: T): void {
    const b = this.bounds(item), l = Math.floor(b.left / CHUNK_TILES), r = Math.ceil(b.right / CHUNK_TILES) - 1;
    const t = Math.floor(b.top / CHUNK_TILES), bottom = Math.ceil(b.bottom / CHUNK_TILES) - 1;
    if ((r - l + 1) * (bottom - t + 1) > 256) { this.large.push(item); return; }
    for (let y = t; y <= bottom; y++) for (let x = l; x <= r; x++) {
      const key = `${x},${y}`, bucket = this.buckets.get(key) ?? []; bucket.push(item); this.buckets.set(key, bucket);
    }
  }
  query(bounds: TileBounds): T[] {
    const found = new Set<T>(this.large);
    for (let y = Math.floor(bounds.top / CHUNK_TILES); y < Math.ceil(bounds.bottom / CHUNK_TILES); y++)
      for (let x = Math.floor(bounds.left / CHUNK_TILES); x < Math.ceil(bounds.right / CHUNK_TILES); x++)
        for (const item of this.buckets.get(`${x},${y}`) ?? []) found.add(item);
    return [...found].filter(item => overlaps(this.bounds(item), bounds));
  }
}
export interface GenerationEnvironment {
  tile(x: number, y: number): TileKind; temperature(x: number, y: number): number; moisture(x: number, y: number): number;
  reserved(x: number, y: number): boolean;
}
interface GenerationBand { stride: number; assets: WorldAsset[]; density: number; maxSpacing: number; }
interface Proposal { placement: AssetPlacement; priority: number; band: GenerationBand; }
/** Immutable runtime snapshot. Editor mutations create a new snapshot and invalidate all derived caches. */
export class WorldAuthoring {
  readonly assets: ReadonlyMap<string, WorldAsset>;
  readonly tiles: ReadonlyMap<string, TileOverride>;
  readonly placements: SpatialIndex<AssetPlacement>;
  readonly zones = new SpatialIndex<WorldZone>(z => shapeBounds(z.shape));
  private bands: GenerationBand[];
  private proposals = new Map<string, Proposal | null>();
  private generated = new Map<string, AssetPlacement | null>();
  private zoneCache = new Map<string, WorldZone[]>();
  constructor(readonly document: WorldDocument) {
    this.assets = new Map(document.assets.map(a => [a.id, a]));
    this.tiles = new Map(document.tiles.map(t => [`${t.x},${t.y}`, t]));
    this.placements = new SpatialIndex(p => placementBounds(p, this.assets.get(p.assetId)!));
    for (const p of document.placements) this.placements.add(p);
    for (const z of document.zones) this.zones.add(z);
    const bands = new Map<number, GenerationBand>();
    for (const a of document.assets.filter(a => a.generation.enabled && a.generation.density > 0).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      const stride = 2 ** Math.ceil(Math.log2(Math.max(a.columns, a.rows) + 2 * a.generation.spacing));
      const band = bands.get(stride) ?? { stride, assets: [], density: 0, maxSpacing: 0 };
      band.assets.push(a); band.density += a.generation.density; band.maxSpacing = Math.max(band.maxSpacing, a.generation.spacing); bands.set(stride, band);
    }
    // Size bands keep small vegetation dense when a large asset is added to the catalog.
    this.bands = [...bands.values()].sort((a, b) => a.stride - b.stride);
  }
  zonesAt(x: number, y: number): WorldZone[] {
    const key = `${x},${y}`, cached = this.zoneCache.get(key);
    if (cached) return cached;
    const result = this.zones.query({ left: x, top: y, right: x + 1e-6, bottom: y + 1e-6 })
      .filter(z => insideShape(z.shape, x, y)).sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.zoneCache.set(key, result);
    while (this.zoneCache.size > 2048) this.zoneCache.delete(this.zoneCache.keys().next().value!);
    return result;
  }
  rule<K extends keyof WorldZone>(x: number, y: number, key: K): WorldZone[K] | undefined {
    return this.zonesAt(x, y).find(z => z[key] !== undefined)?.[key];
  }
  cell(p: AssetPlacement, x: number, y: number): AssetCell | undefined {
    const a = this.assets.get(p.assetId)!;
    const col = Math.floor(x) - p.x, row = Math.floor(y) - p.y;
    return col >= 0 && col < a.columns && row >= 0 && row < a.rows ? a.cells[row * a.columns + col] : undefined;
  }
  private proposal(band: GenerationBand, sx: number, sy: number, env: GenerationEnvironment, seed: number): Proposal | null {
    const key = `${band.stride}:${sx},${sy}`, cached = this.proposals.get(key);
    if (cached !== undefined) { this.proposals.delete(key); this.proposals.set(key, cached); return cached; }
    let result: Proposal | null = null;
    {
      const salt = seed + band.stride * 7919;
      let weight = coordinateHash(sx, sy, salt + 1709) * band.density;
      const a = band.assets.find(a => (weight -= a.generation.density) < 0)!;
      if (coordinateHash(sx, sy, salt + 1711) < Math.min(1, band.density)) {
        const gap = a.generation.spacing;
        const x = sx * band.stride + gap + Math.floor(coordinateHash(sx, sy, salt + 1721) * (band.stride - a.columns - 2 * gap + 1));
        const y = sy * band.stride + gap + Math.floor(coordinateHash(sx, sy, salt + 1723) * (band.stride - a.rows - 2 * gap + 1));
        const p: AssetPlacement = { id: `generated:${band.stride}:${sx}:${sy}`, assetId: a.id, x, y };
        let allowed = !this.placements.query({ left: x - gap, top: y - gap, right: x + a.columns + gap, bottom: y + a.rows + gap }).length;
        for (let row = 0; allowed && row < a.rows; row++) for (let col = 0; allowed && col < a.columns; col++) {
          const tx = x + col, ty = y + row, temp = env.temperature(tx, ty), moisture = env.moisture(tx, ty), g = a.generation;
          allowed = !env.reserved(tx, ty) && !this.tiles.get(`${tx},${ty}`)?.suppressAssets && this.rule(tx + .5, ty + .5, 'generateAssets') !== false
            && g.terrains.includes(env.tile(tx, ty)) && temp >= g.temperature[0] && temp <= g.temperature[1] && moisture >= g.moisture[0] && moisture <= g.moisture[1];
        }
        if (allowed) result = { placement: p, priority: coordinateHash(sx, sy, salt + 1727), band };
      }
    }
    this.proposals.set(key, result);
    while (this.proposals.size > 4096) this.proposals.delete(this.proposals.keys().next().value!);
    return result;
  }
  private candidate(band: GenerationBand, sx: number, sy: number, env: GenerationEnvironment, seed: number): AssetPlacement | null {
    const key = `${band.stride}:${sx},${sy}`, cached = this.generated.get(key);
    if (cached !== undefined) { this.generated.delete(key); this.generated.set(key, cached); return cached; }
    const proposal = this.proposal(band, sx, sy, env, seed);
    let result = proposal?.placement ?? null;
    if (proposal) {
      const a = this.assets.get(proposal.placement.assetId)!, b = placementBounds(proposal.placement, a);
      // Matérn-style priority thinning compares *proposals*, never recursive accepted neighbors.
      // Both peers make the same local decision regardless of chunk traversal or cache eviction.
      for (const otherBand of this.bands) {
        if (!result || otherBand === band) continue;
        const padding = Math.max(a.generation.spacing, otherBand.maxSpacing);
        for (let y = Math.floor((b.top - padding) / otherBand.stride); result && y < Math.ceil((b.bottom + padding) / otherBand.stride); y++)
          for (let x = Math.floor((b.left - padding) / otherBand.stride); result && x < Math.ceil((b.right + padding) / otherBand.stride); x++) {
            const other = this.proposal(otherBand, x, y, env, seed);
            if (!other || other.priority > proposal.priority || (other.priority === proposal.priority && other.placement.id > proposal.placement.id)) continue;
            const asset = this.assets.get(other.placement.assetId)!, gap = Math.max(a.generation.spacing, asset.generation.spacing);
            if (overlaps({ left: b.left - gap, top: b.top - gap, right: b.right + gap, bottom: b.bottom + gap }, placementBounds(other.placement, asset))) result = null;
          }
      }
    }
    this.generated.set(key, result);
    while (this.generated.size > 2048) this.generated.delete(this.generated.keys().next().value!);
    return result;
  }
  assetsIn(bounds: TileBounds, env: GenerationEnvironment, seed: number): AssetPlacement[] {
    const result = this.placements.query(bounds);
    for (const band of this.bands) for (let sy = Math.floor(bounds.top / band.stride); sy < Math.ceil(bounds.bottom / band.stride); sy++)
      for (let sx = Math.floor(bounds.left / band.stride); sx < Math.ceil(bounds.right / band.stride); sx++) {
        const p = this.candidate(band, sx, sy, env, seed);
        if (p && overlaps(bounds, placementBounds(p, this.assets.get(p.assetId)!))) result.push(p);
      }
    return result;
  }
  get generationCacheSize(): number { return this.generated.size; }
}
