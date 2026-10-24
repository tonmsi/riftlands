import customWorld from './custom-world.json';
import { parseWorldDocument } from './world-schema';
import { compactWorldTiles } from './world-tiles';

/** Node reads the source document; Vite replaces only the import with runtime bootstrap data. */
export let WORLD_DOCUMENT = compactWorldTiles(parseWorldDocument(customWorld));
const listeners = new Set<() => void>();
export function onWorldDocumentChange(listener: () => void): void { listeners.add(listener); }
export function installWorldDocument(document: unknown): void {
  WORLD_DOCUMENT = compactWorldTiles(parseWorldDocument(document));
  for (const listener of listeners) listener();
}
