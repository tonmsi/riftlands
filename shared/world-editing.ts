import type { Vec2 } from './types';
import { DEFAULT_CELL, type WorldDocument, type WorldAsset, type AssetPlacement } from './world-schema';
import { placementBounds, overlaps, SpatialIndex } from './world-authoring';
import type { TileOverride } from './world-schema';
import { EDIT_CHUNK_SIZE, decodeTileChunk, encodeTileChunk, tileCode, tileFromCode, tileChunkKey, worldTileMetrics, setWorldTileMetrics, type WorldTileChunk } from './world-tiles';

/** Copy metadata and compact chunk references; strokes replace only touched chunks. */
export function forkWorldDocument(document: WorldDocument, tilesOnly = false): WorldDocument {
  const { tileChunks, ...metadata } = document;
  const result = { ...(tilesOnly ? metadata : structuredClone(metadata)), ...(tileChunks ? { tileChunks: tileChunks.slice() } : {}) };
  setWorldTileMetrics(result, { ...worldTileMetrics(document) }); return result;
}

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
export function paintAssetCell(asset: WorldAsset, column: number, row: number, mode: 'background' | 'wall' | 'hide' | 'fade' | 'hide-fade'): void {
  if (column < 0 || row < 0 || column >= asset.columns || row >= asset.rows) return;
  asset.cells[row * asset.columns + column] = mode === 'background' ? { ...DEFAULT_CELL }
    : mode === 'wall' ? { blocked: true, visibility: 'normal' } : { blocked: false, visibility: mode };
}

/** Mutable indices live only for a brush transaction. Per-dab work depends on local density,
 * not the total number of tiles/instances in the authored world. Removed entries are tombstoned. */
export class WorldBrush {
  private chunkIndices = new Map<string, number>();
  private changedChunks = new Map<string, { x: number; y: number; cells: Uint8Array }>();
  private dirtyChunks = new Set<string>();
  private visited = new Map<string, Uint8Array>();
  private assets: Map<string, WorldAsset>;
  private tileIndices: Map<string, number>;
  private placementIndices: Map<string, number>;
  private npcIndices: Map<string, number>;
  private placements: SpatialIndex<AssetPlacement>;
  private npcTiles: Map<string, string[]>;
  constructor(private document: WorldDocument, tilesOnly = false) {
    for (const [i, c] of (document.tileChunks ?? []).entries()) this.chunkIndices.set(tileChunkKey(c[0], c[1]), i);
    this.assets = new Map(tilesOnly ? [] : document.assets.map(a => [a.id, a]));
    this.tileIndices = new Map(document.tiles.map((t, i) => [`${t.x},${t.y}`, i]));
    this.placementIndices = new Map(tilesOnly ? [] : document.placements.map((p, i) => [p.id, i]));
    this.npcIndices = new Map(tilesOnly ? [] : document.npcs.map((n, i) => [n.id, i]));
    this.npcTiles = new Map(); for (const n of tilesOnly ? [] : document.npcs) { const key = `${n.x},${n.y}`, ids = this.npcTiles.get(key) ?? []; ids.push(n.id); this.npcTiles.set(key, ids); }
    this.placements = new SpatialIndex(p => placementBounds(p, this.assets.get(p.assetId)!));
    for (const p of tilesOnly ? [] : document.placements) this.placements.add(p);
  }
  tile(point: Vec2, value?: Omit<TileOverride, 'x' | 'y'>): void {
    if (this.document.tileChunks) {
      const c = this.chunk(point), i = (point.y - c.y * EDIT_CHUNK_SIZE) * EDIT_CHUNK_SIZE + point.x - c.x * EDIT_CHUNK_SIZE, code = tileCode(value);
      if (c.cells[i] !== code) { c.cells[i] = code; this.dirtyChunks.add(tileChunkKey(c.x, c.y)); }
      return;
    }
    const key = `${point.x},${point.y}`, index = this.tileIndices.get(key);
    if (value) {
      if (index !== undefined) this.document.tiles[index] = { ...point, ...value };
      else { this.tileIndices.set(key, this.document.tiles.length); this.document.tiles.push({ ...point, ...value }); }
    } else if (index !== undefined) {
      const last = this.document.tiles.pop()!; this.tileIndices.delete(key);
      if (index < this.document.tiles.length) { this.document.tiles[index] = last; this.tileIndices.set(`${last.x},${last.y}`, index); }
    }
  }
  visit(point: Vec2): boolean {
    const x = Math.floor(point.x / EDIT_CHUNK_SIZE), y = Math.floor(point.y / EDIT_CHUNK_SIZE), key = tileChunkKey(x, y);
    let cells = this.visited.get(key); if (!cells) { cells = new Uint8Array(EDIT_CHUNK_SIZE ** 2); this.visited.set(key, cells); }
    const index = (point.y - y * EDIT_CHUNK_SIZE) * EDIT_CHUNK_SIZE + point.x - x * EDIT_CHUNK_SIZE;
    if (cells[index]) return false; cells[index] = 1; return true;
  }
  erase(point: Vec2): void {
    const current = this.tileIndices.get(`${point.x},${point.y}`);
    const chunk = this.document.tileChunks ? this.chunk(point) : undefined;
    const terrain = chunk ? tileFromCode(chunk.cells[(point.y - chunk.y * EDIT_CHUNK_SIZE) * EDIT_CHUNK_SIZE + point.x - chunk.x * EDIT_CHUNK_SIZE], point.x, point.y)?.terrain
      : current !== undefined ? this.document.tiles[current].terrain : undefined;
    this.tile(point, { suppressAssets: true, ...(terrain ? { terrain } : {}) });
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
  private chunk(point: Vec2) {
    const x = Math.floor(point.x / EDIT_CHUNK_SIZE), y = Math.floor(point.y / EDIT_CHUNK_SIZE), key = tileChunkKey(x, y);
    let changed = this.changedChunks.get(key);
    if (!changed) { const index = this.chunkIndices.get(key); changed = { x, y, cells: index === undefined ? new Uint8Array(EDIT_CHUNK_SIZE ** 2) : decodeTileChunk(this.document.tileChunks![index]) }; this.changedChunks.set(key, changed); }
    return changed;
  }
  /** Once per frame, publish immutable RLE only for changed chunks. */
  flushTiles(): WorldTileChunk[] {
    const changed: WorldTileChunk[] = [], chunks = this.document.tileChunks;
    if (!chunks) return changed;
    const totals = worldTileMetrics(this.document);
    for (const key of this.dirtyChunks) {
      const c = this.changedChunks.get(key)!, encoded = encodeTileChunk(c.x, c.y, c.cells), index = this.chunkIndices.get(key);
      const old = index !== undefined ? chunks[index] : undefined;
      if (old) { totals.runs -= (old.length - 2) / 3; for (let i = 2; i < old.length; i += 3) totals.cells -= old[i + 1]; }
      totals.runs += (encoded.length - 2) / 3; for (let i = 2; i < encoded.length; i += 3) totals.cells += encoded[i + 1];
      changed.push(encoded);
      if (encoded.length > 2) {
        if (index === undefined) { this.chunkIndices.set(key, chunks.length); chunks.push(encoded); } else chunks[index] = encoded;
      } else if (index !== undefined) {
        const last = chunks.pop()!; this.chunkIndices.delete(key);
        if (index < chunks.length) { chunks[index] = last; this.chunkIndices.set(tileChunkKey(last[0], last[1]), index); }
      }
    }
    setWorldTileMetrics(this.document, totals);
    this.dirtyChunks.clear(); return changed;
  }
}
