import { newWorldDocument, type WorldDocument } from './world-schema';
import { World } from './world';
import { BASE_SURFACE, type SurfaceCell, type SurfaceEndpoint } from './world-surfaces';
import { planStair } from './surface-stairs';
import { TILE_SIZE } from './tile-size';

export const TERRACED_DEMO_SIZE = { width: 40, height: 30 };
export const TERRACED_DEMO_SPAWN = { x: 3, y: 13, surfaceId: BASE_SURFACE, elevation: 0 };
export const TERRACED_DEMO_SUMMIT = { x: 10, y: 13, surfaceId: BASE_SURFACE, elevation: 3 };
const point = (x: number, y: number): SurfaceEndpoint => ({ x, y, surfaceId: BASE_SURFACE });

export const TERRACED_DEMO_CARDINAL_FLIGHTS = [
  { id: 'terraced-demo-west', from: point(3, 13), to: point(7, 13) },
  { id: 'terraced-demo-east', from: point(17, 13), to: point(13, 13) },
  { id: 'terraced-demo-north', from: point(10, 6), to: point(10, 10) },
  { id: 'terraced-demo-south', from: point(10, 20), to: point(10, 16) },
] as const;
export const TERRACED_DEMO_SHELF_FLIGHTS = [
  { id: 'terraced-demo-shelf-one', from: point(21, 14), to: point(23, 14) },
  { id: 'terraced-demo-shelf-two', from: point(26, 14), to: point(28, 14) },
  { id: 'terraced-demo-shelf-three', from: point(28, 14), to: point(30, 14) },
] as const;

/** An isolated playable scene: a three-level plateau and three connected shelves. */
export function newTerracedTerrainDemoWorld(): WorldDocument {
  const doc = newWorldDocument(), { width, height } = TERRACED_DEMO_SIZE;
  doc.interiorBounds = { ...TERRACED_DEMO_SIZE, id: 'terraced-terrain-demo', name: 'Sopraelevazioni e scale incassate', pvp: false };
  doc.spawn = { ...TERRACED_DEMO_SPAWN };
  doc.surfaceCells = []; doc.surfaceLinks = []; doc.surfaceStairs = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const approach = y === 13 && (x < 4 || x >= 17 && x <= 21)
      || x === 10 && (y >= 3 && y <= 6 || y >= 20 && y <= 24)
      || y === 14 && x >= 17 && x <= 21;
    doc.tiles.push({ x, y, terrain: approach ? 'path' : 'grass', suppressAssets: true });
  }

  const ground = new Map<string, SurfaceCell>();
  const rect = (left: number, top: number, right: number, bottom: number, elevation: number, wallSkin?: string) => {
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      ground.set(`${x},${y}`, { x, y, surfaceId: BASE_SURFACE, elevation, material: 'grass', wallMaterial: 'rock',
        kind: 'ground', layout: 'terraced', ...(wallSkin ? { wallSkin } : {}) });
    }
  };
  // The outer three tile bands are physical walls; the summit begins at x=7/y=10.
  rect(4, 7, 16, 19, 3, 'wall-roccia');
  // Nested logical heights produce one wall band between each grass shelf.
  rect(22, 6, 35, 22, 1);
  rect(27, 10, 32, 18, 2);
  rect(29, 13, 31, 15, 3);
  doc.surfaceCells.push(...ground.values());

  for (const flight of [...TERRACED_DEMO_CARDINAL_FLIGHTS, ...TERRACED_DEMO_SHELF_FLIGHTS]) {
    const support = new World(doc.seed, 16, 'world', doc, []);
    const plan = planStair(flight.from, flight.to, (x, y, id) => support.surfaceAt(x, y, id), {
      id: flight.id, profile: 'terraced', width: TILE_SIZE, material: 'stone', wallMaterial: 'rock',
      cells: doc.surfaceCells, links: doc.surfaceLinks, stairs: doc.surfaceStairs,
    });
    doc.surfaceCells.push(...plan.cells); doc.surfaceLinks.push(...plan.links); doc.surfaceStairs.push(plan.stair);
  }
  doc.zones = [{ id: 'terraced-terrain-demo', name: 'Sopraelevazioni e scale incassate', priority: 10,
    shape: { kind: 'rect', x: 0, y: 0, width, height }, temperature: .65, moisture: .4, pvp: false, generateAssets: false,
    npcs: { density: 0, maxPerChunk: 0, weights: { slime: 0, wisp: 0, sentinel: 0 } } }];
  return doc;
}
