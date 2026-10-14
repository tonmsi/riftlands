import { newWorldDocument, type WorldDocument } from './world-schema';
import { World } from './world';
import { BASE_SURFACE, type SurfaceCell, type SurfaceMaterial, type WallMaterial } from './world-surfaces';
import { planStair } from './surface-stairs';
import { planBridge, upsertSurfaceLinks } from '../client/editors/surface-authoring';
import { newDungeonDraft, type DungeonDraft } from './dungeon-draft';
import { referenceDemoAssets } from './terrain-reference-demo-assets';

export const REFERENCE_BRIDGE = 'reference-bridge';
export const REFERENCE_DEMO_SIZE = { width: 36, height: 26 };

/** Complete, isolated comparison scene. Building it never edits the installed world. */
export function newTerrainReferenceDemoWorld(): WorldDocument {
  const doc = newWorldDocument(), { width, height } = REFERENCE_DEMO_SIZE;
  doc.interiorBounds = { ...REFERENCE_DEMO_SIZE, id: 'terrain-reference-demo', name: 'Terrazze, scale e ponte', pvp: false };
  doc.spawn = { x: 3, y: 10, surfaceId: BASE_SURFACE, elevation: 0 };
  doc.assets = referenceDemoAssets(); doc.surfaceCells = []; doc.surfaceLinks = []; doc.surfaceStairs = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const terrain = x >= 13 && x <= 22 && y >= 7 && y <= 19 ? 'water'
      : x === 17 && y >= 6 && y <= 23 || y === 10 && x <= 5 || y === 23 && x >= 17 && x <= 32 ? 'path' : 'grass';
    doc.tiles.push({ x, y, terrain, suppressAssets: true });
  }
  // A real lower route remains walkable under both arms of the bridge.
  for (const tile of doc.tiles) if (tile.x === 17 && tile.y >= 6 && tile.y <= 23) tile.terrain = 'path';
  const rect = (x: number, y: number, w: number, h: number, elevation: number,
    material: SurfaceMaterial = 'grass', wallMaterial: WallMaterial = 'rock') => {
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) {
      const cell: SurfaceCell = { x: tx, y: ty, surfaceId: BASE_SURFACE, elevation, material, wallMaterial, kind: 'ground' };
      const old = doc.surfaceCells!.findIndex(c => c.x === tx && c.y === ty && c.surfaceId === BASE_SURFACE);
      if (old < 0) doc.surfaceCells!.push(cell); else doc.surfaceCells![old] = cell;
    }
  };
  rect(6, 7, 6, 7, 3); rect(9, 8, 3, 3, 6);
  rect(16, 2, 5, 4, 3);
  rect(24, 15, 8, 9, 3); rect(28, 15, 3, 3, 6, 'stone');
  rect(31, 12, 3, 3, 3);
  // Concave rocky rim and a low shelf exercise body/cap/foot at different heights.
  for (let y = 3; y <= 6; y++) for (let x = 25; x <= 29; x++) if (x === 25 || y === 3 || y === 6) rect(x, y, 1, 1, 3);
  rect(3, 19, 7, 3, 1);
  const world = () => new World(doc.seed, 16, 'world', doc, []);
  const stairs = (id: string, from: { x: number; y: number }, to: { x: number; y: number }, width = 48) => {
    const support = world(), plan = planStair({ ...from, surfaceId: BASE_SURFACE }, { ...to, surfaceId: BASE_SURFACE },
      (x, y, surfaceId) => support.surfaceAt(x, y, surfaceId), {
        id, width, material: 'stone', wallMaterial: 'rock', cells: doc.surfaceCells, links: doc.surfaceLinks, stairs: doc.surfaceStairs,
      });
    doc.surfaceCells!.push(...plan.cells); doc.surfaceStairs!.push(plan.stair); upsertSurfaceLinks(doc, plan.links);
  };
  stairs('reference-west-stair', { x: 4, y: 10 }, { x: 6, y: 10 });
  stairs('reference-upper-stair', { x: 7, y: 9 }, { x: 9, y: 9 });
  stairs('reference-front-stair', { x: 7, y: 14 }, { x: 7, y: 13 });
  stairs('reference-long-front', { x: 10, y: 16 }, { x: 10, y: 13 });
  stairs('reference-wide-stair', { x: 26, y: 16 }, { x: 28, y: 16 }, 96);
  stairs('reference-south-stair', { x: 32, y: 9 }, { x: 32, y: 12 });
  const bridge = (from: { x: number; y: number; surfaceId?: string }, to: { x: number; y: number }, extend = false) => {
    const support = world(), plan = planBridge(from, to, p => support.surfaceAt(p.x, p.y, p.surfaceId ?? BASE_SURFACE), {
      id: REFERENCE_BRIDGE, widthTiles: 2, material: 'wood', wallMaterial: 'wood', route: 'horizontal-first',
      existingAt: (x, y) => support.surfacesAt(x, y), extendExisting: extend,
    });
    doc.surfaceCells!.push(...plan.cells); upsertSurfaceLinks(doc, plan.links);
  };
  bridge({ x: 11, y: 11 }, { x: 24, y: 15 });
  bridge({ x: 17, y: 11, surfaceId: REFERENCE_BRIDGE }, { x: 17, y: 5 }, true);
  doc.placements = [
    { id: 'reference-oak-left', assetId: 'reference-oak', x: 8, y: 11, elevation: 3 },
    { id: 'reference-pine-island', assetId: 'reference-pine', x: 18, y: 2, elevation: 3 },
    { id: 'reference-oak-low', assetId: 'reference-oak', x: 2, y: 3 },
    { id: 'reference-pine-low', assetId: 'reference-pine', x: 4, y: 4 },
    ...(doc.assets.some(a => a.id === 'reference-cottage') ? [{ id: 'reference-house', assetId: 'reference-cottage', x: 26, y: 19, elevation: 3 }] : []),
  ];
  doc.zones = [{ id: 'reference-demo', name: 'Terrazze, scale e ponte', priority: 10,
    shape: { kind: 'rect', x: 0, y: 0, width, height }, temperature: .65, moisture: .4, pvp: false, generateAssets: false,
    npcs: { density: 0, maxPerChunk: 0, weights: { slime: 0, wisp: 0, sentinel: 0 } } }];
  return doc;
}

export function newTerrainReferenceDemoDungeon(): DungeonDraft {
  const doc = newTerrainReferenceDemoWorld(), draft = newDungeonDraft(REFERENCE_DEMO_SIZE.width, REFERENCE_DEMO_SIZE.height);
  draft.id = 'demo-terrazze-scale-ponte'; draft.name = 'Prova · terrazze, scale e ponte'; draft.encounters = [];
  draft.tiles = doc.tiles.map(t => t.terrain!); draft.surfaceCells = structuredClone(doc.surfaceCells);
  draft.surfaceLinks = structuredClone(doc.surfaceLinks); draft.surfaceStairs = structuredClone(doc.surfaceStairs);
  draft.assetPlacements = structuredClone(doc.placements); draft.entities = [];
  return draft;
}
