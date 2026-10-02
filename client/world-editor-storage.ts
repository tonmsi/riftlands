import { parseWorldDocument, type WorldDocument } from '../shared/world-schema';

export interface WorldCheckpoint { document: WorldDocument; revision: string; }
let database: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('riftlands.world-maker.v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function loadWorldCheckpoint(): Promise<WorldCheckpoint | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('drafts').objectStore('drafts').get('project');
    request.onsuccess = () => { try { resolve(request.result ? { revision: request.result.revision, document: parseWorldDocument(request.result.document) } : undefined); } catch (e) { reject(e); } };
    request.onerror = () => reject(request.error);
  });
}
export async function saveWorldCheckpoint(checkpoint: WorldCheckpoint): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readwrite'); transaction.objectStore('drafts').put(checkpoint, 'project');
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
  });
}
