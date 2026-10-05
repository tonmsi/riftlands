import type { WorldDocument } from '../../../shared/world-schema';
import { tileChunkKey, worldTileMetrics, setWorldTileMetrics, type WorldTileChunk } from '../../../shared/world-tiles';
import { forkWorldDocument } from '../../../shared/world-editing';

type Metadata = Omit<WorldDocument, 'tileChunks'>;
interface Transaction {
  before?: Metadata; after?: Metadata;
  chunks: { key: string; before?: WorldTileChunk; after?: WorldTileChunk }[];
  bytes: number;
}
/** Changed chunks only. Undo and redo share the same strict memory budget. */
export class WorldEditorHistory {
  private past: Transaction[] = [];
  private future: Transaction[] = [];
  private bytes = 0;
  get canUndo(): boolean { return !!this.past.length; }
  get canRedo(): boolean { return !!this.future.length; }
  get retainedBytes(): number { return this.bytes; }
  commit(before: WorldDocument, after: WorldDocument): boolean {
    const { tileChunks: a = [], ...am } = before, { tileChunks: b = [], ...bm } = after;
    const old = new Map(a.map(c => [tileChunkKey(c[0], c[1]), c])), next = new Map(b.map(c => [tileChunkKey(c[0], c[1]), c]));
    const chunks: Transaction['chunks'] = [];
    for (const key of new Set([...old.keys(), ...next.keys()])) {
      const x = old.get(key), y = next.get(key);
      if (x !== y && JSON.stringify(x) !== JSON.stringify(y)) chunks.push({ key, before: x?.slice() as WorldTileChunk | undefined, after: y?.slice() as WorldTileChunk | undefined });
    }
    const sameReferences = Object.keys(am).every(key => am[key as keyof Metadata] === bm[key as keyof Metadata]);
    const metaChanged = !sameReferences && JSON.stringify(am) !== JSON.stringify(bm);
    if (!metaChanged && !chunks.length) return false;
    const entry: Transaction = { chunks, bytes: 0, ...(metaChanged ? { before: structuredClone(am), after: structuredClone(bm) } : {}) };
    entry.bytes = JSON.stringify(entry).length * 2;
    for (const item of this.future) this.bytes -= item.bytes;
    this.future = [];
    if (entry.bytes > 24_000_000) { this.clear(); return true; }
    this.past.push(entry); this.bytes += entry.bytes;
    while (this.past.length > 40 || this.bytes > 24_000_000) this.bytes -= this.past.shift()!.bytes;
    return true;
  }
  private apply(current: WorldDocument, entry: Transaction, side: 'before' | 'after'): WorldDocument {
    const result = entry[side] ? { ...structuredClone(entry[side]!), ...(current.tileChunks ? { tileChunks: current.tileChunks.slice() } : {}) } : forkWorldDocument(current);
    const chunks = new Map((result.tileChunks ?? []).map(c => [tileChunkKey(c[0], c[1]), c]));
    const totals = { ...worldTileMetrics(current) };
    totals.cells += result.tiles.length - current.tiles.length;
    for (const change of entry.chunks) {
      const old = chunks.get(change.key), chunk = change[side];
      if (old) { totals.runs -= (old.length - 2) / 3; for (let i = 2; i < old.length; i += 3) totals.cells -= old[i + 1]; }
      if (chunk) { totals.runs += (chunk.length - 2) / 3; for (let i = 2; i < chunk.length; i += 3) totals.cells += chunk[i + 1]; chunks.set(change.key, chunk.slice() as WorldTileChunk); }
      else chunks.delete(change.key);
    }
    if (current.tileChunks || entry.chunks.length) result.tileChunks = [...chunks.values()];
    setWorldTileMetrics(result, totals);
    return result;
  }
  undo(current: WorldDocument): WorldDocument { const entry = this.past.pop(); if (!entry) return current; this.future.push(entry); return this.apply(current, entry, 'before'); }
  redo(current: WorldDocument): WorldDocument { const entry = this.future.pop(); if (!entry) return current; this.past.push(entry); return this.apply(current, entry, 'after'); }
  clear(): void { this.past = []; this.future = []; this.bytes = 0; }
}
