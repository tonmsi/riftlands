import { parseWorldDocument, type WorldDocument } from '../../../shared/world-schema';
import { compactWorldTiles, tileChunkKey, type WorldTileChunk } from '../../../shared/world-tiles';

export interface WorldCheckpoint { document: WorldDocument; revision: string; migrated?: boolean; }
let database: Promise<IDBDatabase> | undefined;
let savedChunks: Map<string, WorldTileChunk> | undefined;
function db(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('riftlands.world-maker.v1', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('drafts')) request.result.createObjectStore('drafts');
      if (!request.result.objectStoreNames.contains('tile-chunks')) request.result.createObjectStore('tile-chunks');
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function loadWorldCheckpoint(): Promise<WorldCheckpoint | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['drafts', 'tile-chunks']), request = transaction.objectStore('drafts').get('project');
    const chunks = transaction.objectStore('tile-chunks').getAll();
    transaction.oncomplete = () => {
      try {
        savedChunks = new Map((chunks.result as WorldTileChunk[]).map(c => [tileChunkKey(c[0], c[1]), c]));
        const record = request.result;
        resolve(record ? { revision: record.revision, document: compactWorldTiles(parseWorldDocument(record.chunked ? { ...record.document, tileChunks: chunks.result } : record.document)), migrated: !record.chunked } : undefined);
      } catch (e) { reject(e); }
    };
    transaction.onerror = () => reject(transaction.error);
  });
}
export async function saveWorldCheckpoint(checkpoint: WorldCheckpoint): Promise<void> {
  const database = await db();
  if (!savedChunks) await loadWorldCheckpoint();
  const document = compactWorldTiles(checkpoint.document), next = new Map(document.tileChunks!.map(c => [tileChunkKey(c[0], c[1]), c]));
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['drafts', 'tile-chunks'], 'readwrite'), store = transaction.objectStore('tile-chunks');
    for (const [key, chunk] of next) if (savedChunks!.get(key) !== chunk && JSON.stringify(savedChunks!.get(key)) !== JSON.stringify(chunk)) store.put(chunk, key);
    for (const key of savedChunks!.keys()) if (!next.has(key)) store.delete(key);
    const { tileChunks, ...metadata } = document;
    transaction.objectStore('drafts').put({ document: { ...metadata, tileChunks: [] }, revision: checkpoint.revision, chunked: true }, 'project');
    transaction.oncomplete = () => { savedChunks = next; resolve(); };
    transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
  });
}
