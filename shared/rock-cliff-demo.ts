import { newWorldDocument, type WorldDocument } from './world-schema';
import { newDungeonDraft, type DungeonDraft } from './dungeon-draft';
import { BASE_SURFACE } from './world-surfaces';

/** A separate editable example for cliffs, inner/outer joints and all four stair directions. */
export function newRockCliffDemoWorld(): WorldDocument {
  const document = newWorldDocument(), width = 26, height = 20;
  document.spawn = { x: 2, y: 5 };
  document.interiorBounds = { id: 'rock-cliff-demo', name: 'Pareti rocciose e gradoni', width, height, pvp: false };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) document.tiles.push({ x, y, terrain: x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 'rock' : 'grass', suppressAssets: true });
  document.surfaceCells = []; document.surfaceLinks = [];
  const paint = (x: number, y: number, elevation: number) => document.surfaceCells!.push({ x, y, elevation, surfaceId: BASE_SURFACE, kind: 'ground', material: 'grass', wallMaterial: 'rock' });
  const rect = (left: number, top: number, w: number, h: number, elevation: number) => { for (let y = top; y < top + h; y++) for (let x = left; x < left + w; x++) paint(x, y, elevation); };
  const stair = (id: string, x: number, y: number, toX: number, toY: number) => document.surfaceLinks!.push({ id, kind: 'stairs', from: { x, y, surfaceId: BASE_SURFACE }, to: { x: toX, y: toY, surfaceId: BASE_SURFACE } });
  rect(3, 4, 5, 3, 2); stair('east-entry', 2, 5, 3, 5);
  for (let y = 3; y <= 7; y++) for (let x = 11; x <= 15; x++) if (x === 11 || x === 15 || y === 3 || y === 7) paint(x, y, 3);
  stair('front-ring-entry', 13, 8, 13, 7);
  rect(19, 3, 4, 4, 3);
  for (let y = 4; y <= 5; y++) for (let x = 20; x <= 21; x++) document.surfaceCells!.find(c => c.x === x && c.y === y)!.elevation = 5;
  stair('west-terrace-entry', 23, 5, 22, 5); stair('upper-terrace', 22, 5, 21, 5);
  for (let y = 11; y <= 14; y++) for (let x = 3; x <= 7; x++) if (x <= 4 || y >= 13) paint(x, y, 2);
  stair('front-l-entry', 6, 15, 6, 14);
  for (let y = 11; y <= 14; y++) for (let x = 11; x <= 15; x++) if (y === 11 || x === 13) paint(x, y, 3);
  stair('side-t-entry', 12, 13, 13, 13);
  paint(20, 11, 5);
  rect(20, 14, 3, 2, 1); stair('south-entry', 21, 13, 21, 14);
  document.zones = [{ id: 'rock-demo', name: 'Pareti rocciose e gradoni', priority: 10, shape: { kind: 'rect', x: 0, y: 0, width, height }, temperature: .7, moisture: .35, pvp: false, generateAssets: false, npcs: { density: 0, maxPerChunk: 0, weights: { slime: 0, wisp: 0, sentinel: 0 } } }];
  return document;
}

export function newRockCliffDemoDungeon(): DungeonDraft {
  const document = newRockCliffDemoWorld(), draft = newDungeonDraft(26, 20);
  draft.id = 'demo-pareti-rocciose'; draft.name = 'Prova · pareti rocciose e gradoni'; draft.encounters = [];
  draft.tiles = document.tiles.map(cell => cell.terrain!);
  draft.surfaceCells = structuredClone(document.surfaceCells); draft.surfaceLinks = structuredClone(document.surfaceLinks);
  draft.entities = []; return draft;
}
