import { newWorldDocument, type WorldDocument } from './world-schema';
import { newSurfaceDemoDungeon } from './dungeon-surface-demo';

/** A separate, downloadable example. It never overwrites the installed world. */
export function newSurfaceDemoWorld(): WorldDocument {
  const draft = newSurfaceDemoDungeon(), document = newWorldDocument();
  document.spawn = { x: 3, y: 7, surfaceId: 'ground', elevation: 0 };
  document.tiles = draft.tiles.map((terrain, i) => ({ x: i % draft.width, y: Math.floor(i / draft.width), terrain, suppressAssets: true }));
  document.surfaceCells = structuredClone(draft.surfaceCells); document.surfaceLinks = structuredClone(draft.surfaceLinks);
  document.zones = [{ id: 'demo', name: 'Alture e ponti', priority: 10, shape: { kind: 'rect', x: 0, y: 0, width: draft.width, height: draft.height },
    temperature: .7, moisture: .35, pvp: false, generateAssets: false, npcs: { density: 0, maxPerChunk: 0, weights: { slime: 0, wisp: 0, sentinel: 0 } } }];
  return document;
}
