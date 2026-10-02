import type { TileKind } from './types';
import type { TileOverride, WorldDocument } from './world-schema';

export const WORLD_TILE_TERRAINS: readonly TileKind[] = ['grass', 'path', 'water', 'rock', 'bush', 'mud', 'snow', 'ice'];
export const EDIT_CHUNK_SIZE = 32;
const AREA = EDIT_CHUNK_SIZE ** 2;
/** [chunkX, chunkY, offset, length, value, ...]. Zero cells remain procedural. */
export type WorldTileChunk = [number, number, ...number[]];
export const tileChunkKey = (x: number, y: number) => `${x},${y}`;
export interface TileMetrics { cells: number; runs: number; }
interface CachedMetrics { value: TileMetrics; chunks: WorldDocument['tileChunks']; chunkCount: number; tiles: WorldDocument['tiles']; tileCount: number; }
const metrics = new WeakMap<WorldDocument, CachedMetrics>();
export function worldTileMetrics(document: WorldDocument): TileMetrics {
  const cached = metrics.get(document);
  if (cached && cached.chunks === document.tileChunks && cached.chunkCount === (document.tileChunks?.length ?? 0) && cached.tiles === document.tiles && cached.tileCount === document.tiles.length) return cached.value;
  const value = { cells: document.tiles.length, runs: 0 };
  for (const c of document.tileChunks ?? []) { value.runs += (c.length - 2) / 3; for (let i = 2; i < c.length; i += 3) value.cells += c[i + 1]; }
  setWorldTileMetrics(document, value);
  return value;
}
export function setWorldTileMetrics(document: WorldDocument, value: TileMetrics): void {
  metrics.set(document, { value, chunks: document.tileChunks, chunkCount: document.tileChunks?.length ?? 0, tiles: document.tiles, tileCount: document.tiles.length });
}
export function tileCode(tile?: Omit<TileOverride, 'x' | 'y'>): number {
  if (!tile) return 0;
  return tile.terrain === undefined ? (tile.suppressAssets ? 1 : 0) : (WORLD_TILE_TERRAINS.indexOf(tile.terrain) + 1) * 2 + (tile.suppressAssets ? 1 : 0);
}
export function tileFromCode(code: number, x: number, y: number): TileOverride | undefined {
  return code ? { x, y, ...(code >= 2 ? { terrain: WORLD_TILE_TERRAINS[Math.floor(code / 2) - 1] } : {}), ...(code % 2 ? { suppressAssets: true } : {}) } : undefined;
}
export function decodeTileChunk(chunk: WorldTileChunk): Uint8Array {
  const cells = new Uint8Array(AREA);
  for (let i = 2; i < chunk.length; i += 3) cells.fill(chunk[i + 2], chunk[i], chunk[i] + chunk[i + 1]);
  return cells;
}
export function encodeTileChunk(x: number, y: number, cells: Uint8Array): WorldTileChunk {
  const chunk: WorldTileChunk = [x, y];
  for (let i = 0; i < AREA;) {
    const value = cells[i], start = i++;
    while (i < AREA && cells[i] === value) i++;
    if (value) chunk.push(start, i - start, value);
  }
  return chunk;
}
/** One-time migration, without creating coordinate strings or retaining one object per tile. */
export function compactWorldTiles(document: WorldDocument): WorldDocument {
  if (document.version === 2 && !document.tiles.length) return document;
  const chunks = new Map<string, WorldTileChunk>((document.tileChunks ?? []).map(c => [tileChunkKey(c[0], c[1]), c]));
  const changed = new Map<string, { x: number; y: number; cells: Uint8Array }>();
  for (const tile of document.tiles) {
    const x = Math.floor(tile.x / EDIT_CHUNK_SIZE), y = Math.floor(tile.y / EDIT_CHUNK_SIZE), key = tileChunkKey(x, y);
    let chunk = changed.get(key);
    if (!chunk) { chunk = { x, y, cells: chunks.has(key) ? decodeTileChunk(chunks.get(key)!) : new Uint8Array(AREA) }; changed.set(key, chunk); }
    chunk.cells[(tile.y - y * EDIT_CHUNK_SIZE) * EDIT_CHUNK_SIZE + tile.x - x * EDIT_CHUNK_SIZE] = tileCode(tile);
  }
  for (const [key, chunk] of changed) chunks.set(key, encodeTileChunk(chunk.x, chunk.y, chunk.cells));
  return { ...document, version: 2, tiles: [], tileChunks: [...chunks.values()].filter(c => c.length > 2).sort((a, b) => a[1] - b[1] || a[0] - b[0]) };
}
/** Keep metadata readable and each encoded chunk on one line, without per-cell JSON overhead. */
export function serializeWorldDocument(document: WorldDocument): string {
  const compact = compactWorldTiles(document), chunks = compact.tileChunks!;
  const text = JSON.stringify({ ...compact, tileChunks: [] }, null, 2);
  return text.replace('"tileChunks": []', `"tileChunks": [${chunks.length ? '\n' + chunks.map(c => '    ' + JSON.stringify(c)).join(',\n') + '\n  ' : ''}]`) + '\n';
}
/** Storage key order is not authored content: IndexedDB may return chunks in a different order. */
export function worldDocumentsEqual(first: WorldDocument, second: WorldDocument): boolean {
  const { tileChunks: a = [], ...am } = compactWorldTiles(first), { tileChunks: b = [], ...bm } = compactWorldTiles(second);
  if (a.length !== b.length || JSON.stringify(am) !== JSON.stringify(bm)) return false;
  const chunks = new Map(a.map(c => [tileChunkKey(c[0], c[1]), c]));
  return b.every(c => { const other = chunks.get(tileChunkKey(c[0], c[1])); return other === c || !!other && other.length === c.length && c.every((value, i) => other[i] === value); });
}
/** Encoded chunks stay compact; only recently queried chunks are decoded, in a bounded cache. */
export class WorldTiles {
  private chunks = new Map<string, WorldTileChunk>();
  private cache = new Map<string, Uint8Array>();
  private legacy: Map<string, TileOverride>;
  constructor(document: WorldDocument) {
    for (const c of document.tileChunks ?? []) this.chunks.set(tileChunkKey(c[0], c[1]), c);
    this.legacy = new Map(document.tiles.map(t => [tileChunkKey(t.x, t.y), t]));
  }
  get(key: string): TileOverride | undefined {
    const legacy = this.legacy.get(key); if (legacy) return legacy;
    const comma = key.indexOf(','); return this.at(Number(key.slice(0, comma)), Number(key.slice(comma + 1)));
  }
  at(x: number, y: number): TileOverride | undefined {
    const cx = Math.floor(x / EDIT_CHUNK_SIZE), cy = Math.floor(y / EDIT_CHUNK_SIZE), key = tileChunkKey(cx, cy), chunk = this.chunks.get(key);
    if (!chunk) return this.legacy.get(tileChunkKey(x, y));
    let cells = this.cache.get(key);
    if (!cells) { cells = decodeTileChunk(chunk); this.cache.set(key, cells); while (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!); }
    return tileFromCode(cells[(y - cy * EDIT_CHUNK_SIZE) * EDIT_CHUNK_SIZE + x - cx * EDIT_CHUNK_SIZE], x, y);
  }
  update(chunks: readonly WorldTileChunk[]): void {
    for (const c of chunks) { const key = tileChunkKey(c[0], c[1]); if (c.length > 2) this.chunks.set(key, c); else this.chunks.delete(key); this.cache.delete(key); }
  }
  get decodedChunkCount(): number { return this.cache.size; }
}
