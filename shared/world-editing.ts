import type { Vec2 } from './types';
import { DEFAULT_CELL, type WorldDocument, type WorldAsset, type AssetPlacement } from './world-schema';
import { placementBounds, overlaps, SpatialIndex } from './world-authoring';
import type { TileOverride } from './world-schema';

/** Interpolate pointer events so fast brush strokes cannot leave gaps. */
export function strokeTiles(from: Vec2, to: Vec2): Vec2[] {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  return Array.from({ length: steps + 1 }, (_, i) => ({ x: Math.round(from.x + (to.x - from.x) * i / Math.max(1, steps)), y: Math.round(from.y + (to.y - from.y) * i / Math.max(1, steps)) }));
}
export function brushTiles(center: Vec2, radius: number): Vec2[] {
  const result: Vec2[] = [];
  for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) if (x * x + y * y <= radius * radius) result.push({ x: center.x + x, y: center.y + y });
  return result;
}
/** Asset image and behavior mask share the same top-left origin. Pivot only controls painter ordering. */
export function canStampAsset(document: WorldDocument, asset: WorldAsset, point: Vec2, ignoreId?: string): boolean {
  const bounds = placementBounds({ id: '', assetId: asset.id, ...point }, asset);
  return !document.placements.some(p => {
    if (p.id === ignoreId) return false;
    const other = document.assets.find(a => a.id === p.assetId)!;
    if (other.layer === 'ground' || asset.layer === 'ground') return p.assetId === asset.id && p.x === point.x && p.y === point.y;
    const gap = asset.generation.spacing;
    return overlaps({ left: bounds.left - gap, top: bounds.top - gap, right: bounds.right + gap, bottom: bounds.bottom + gap }, placementBounds(p, other));
  });
}
export function stampAsset(document: WorldDocument, asset: WorldAsset, point: Vec2, id: string): AssetPlacement | undefined {
  if (!canStampAsset(document, asset, point)) return;
  const p = { id, assetId: asset.id, ...point }; document.placements.push(p); return p;
}
export function paintAssetCell(asset: WorldAsset, column: number, row: number, mode: 'background' | 'wall' | 'hide' | 'fade'): void {
  if (column < 0 || row < 0 || column >= asset.columns || row >= asset.rows) return;
  asset.cells[row * asset.columns + column] = mode === 'background' ? { ...DEFAULT_CELL }
    : mode === 'wall' ? { blocked: true, visibility: 'normal' } : { blocked: false, visibility: mode };
}

/** Mutable indices live only for a brush transaction. Per-dab work depends on local density,
 * not the total number of tiles/instances in the authored world. Removed entries are tombstoned. */
export class WorldBrush {
  private assets: Map<string, WorldAsset>;
  private tileIndices: Map<string, number>;
  private placementIndices: Map<string, number>;
  private npcIndices: Map<string, number>;
  private placements: SpatialIndex<AssetPlacement>;
  private npcTiles: Map<string, string[]>;
  constructor(private document: WorldDocument) {
    this.assets = new Map(document.assets.map(a => [a.id, a]));
    this.tileIndices = new Map(document.tiles.map((t, i) => [`${t.x},${t.y}`, i]));
    this.placementIndices = new Map(document.placements.map((p, i) => [p.id, i]));
    this.npcIndices = new Map(document.npcs.map((n, i) => [n.id, i]));
    this.npcTiles = new Map(); for (const n of document.npcs) { const key = `${n.x},${n.y}`, ids = this.npcTiles.get(key) ?? []; ids.push(n.id); this.npcTiles.set(key, ids); }
    this.placements = new SpatialIndex(p => placementBounds(p, this.assets.get(p.assetId)!));
    for (const p of document.placements) this.placements.add(p);
  }
  tile(point: Vec2, value?: Omit<TileOverride, 'x' | 'y'>): void {
    const key = `${point.x},${point.y}`, index = this.tileIndices.get(key);
    if (value) {
      if (index !== undefined) this.document.tiles[index] = { ...point, ...value };
      else { this.tileIndices.set(key, this.document.tiles.length); this.document.tiles.push({ ...point, ...value }); }
    } else if (index !== undefined) {
      const last = this.document.tiles.pop()!; this.tileIndices.delete(key);
      if (index < this.document.tiles.length) { this.document.tiles[index] = last; this.tileIndices.set(`${last.x},${last.y}`, index); }
    }
  }
  erase(point: Vec2): void {
    const current = this.tileIndices.get(`${point.x},${point.y}`);
    this.tile(point, { suppressAssets: true, ...(current !== undefined && this.document.tiles[current].terrain ? { terrain: this.document.tiles[current].terrain } : {}) });
    for (const p of this.placements.query({ left: point.x, top: point.y, right: point.x + 1, bottom: point.y + 1 })) {
      const index = this.placementIndices.get(p.id); if (index === undefined) continue;
      const last = this.document.placements.pop()!; this.placementIndices.delete(p.id);
      if (index < this.document.placements.length) { this.document.placements[index] = last; this.placementIndices.set(last.id, index); }
    }
    for (const id of this.npcTiles.get(`${point.x},${point.y}`) ?? []) {
      const index = this.npcIndices.get(id); if (index === undefined) continue;
      const last = this.document.npcs.pop()!; this.npcIndices.delete(id);
      if (index < this.document.npcs.length) { this.document.npcs[index] = last; this.npcIndices.set(last.id, index); }
    }
  }
  stamp(a: WorldAsset, point: Vec2, id: string): boolean {
    const bounds = placementBounds({ id, assetId: a.id, ...point }, a), gap = a.generation.spacing;
    const candidates = this.placements.query({ left: bounds.left - gap, top: bounds.top - gap, right: bounds.right + gap, bottom: bounds.bottom + gap })
      .filter(p => this.placementIndices.has(p.id));
    if (!canStampAsset({ ...this.document, placements: candidates }, a, point)) return false;
    const p = { id, assetId: a.id, ...point }; this.placementIndices.set(id, this.document.placements.length); this.document.placements.push(p); this.placements.add(p); return true;
  }
}
