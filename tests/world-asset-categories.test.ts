import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorldAsset, newWorldDocument, parseWorldDocument, resizeWorldAsset, setWorldAssetCategory, worldAssetCategory, worldAssetLayer } from '../shared/world-schema';
import { canStampAsset, paintAssetCell, stampAsset, WorldBrush } from '../shared/world-editing';
import { elevationAssetRise, planElevationAsset, stampElevationAsset } from '../shared/world-asset-surfaces';
import { World } from '../shared/world';
import { planStair } from '../shared/surface-stairs';
import { WorldAuthoring } from '../shared/world-authoring';

const asset = (id: string) => newWorldAsset(id, id, `/world-assets/${id}.png`);
function fixture() {
  const document = newWorldDocument();
  for (let y = -2; y <= 8; y++) for (let x = -2; x <= 8; x++) document.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  return document;
}

test('catalog categories infer old annotations without migrating them and explicit choices take precedence', () => {
  const a = asset('legacy');
  assert.equal(worldAssetCategory(a), 'object');
  a.layer = 'ground'; assert.equal(worldAssetCategory(a), 'floor');
  a.cells[0].blocked = true; assert.equal(worldAssetCategory(a), 'elevation');
  const document = fixture(); document.assets.push(a);
  const restored = parseWorldDocument(document).assets[0];
  assert.equal(restored.category, undefined); assert.equal(restored.elevation, undefined); assert.equal(restored.cells[0].blocked, true);
  setWorldAssetCategory(a, 'floor');
  assert.equal(worldAssetCategory(a), 'floor'); assert.equal(worldAssetLayer(a), 'ground');
  assert.deepEqual(a.cells, [{ blocked: false, visibility: 'normal' }]);
  a.layer = 'object'; assert.equal(worldAssetLayer(a), 'ground', 'explicit category determines rendering');
  setWorldAssetCategory(a, 'elevation'); assert.equal(elevationAssetRise(a), 48);
  setWorldAssetCategory(a, 'object'); assert.equal(a.layer, 'object');
});

test('asset semantics and elevation settings survive export with strict category and height validation', () => {
  const document = fixture(), a = asset('plateau'); setWorldAssetCategory(a, 'elevation');
  a.elevation = { height: 6, material: 'grass', wallMaterial: 'rock', wallSkin: 'wall-roccia' }; document.assets.push(a);
  assert.deepEqual(parseWorldDocument(JSON.stringify(document)).assets[0], a);
  for (const height of [0, 17, 1.2]) {
    a.elevation.height = height; assert.throws(() => parseWorldDocument(document), /rialzo/);
  }
  a.elevation.height = 3;
  a.elevation.material = 'water'; assert.throws(() => parseWorldDocument(document), /rialzo/); a.elevation.material = 'rock';
  a.elevation.wallSkin = '../escape'; assert.throws(() => parseWorldDocument(document), /rialzo/); delete a.elevation.wallSkin;
  (a as any).category = 'unknown'; assert.throws(() => parseWorldDocument(document), /categoria/);
});

test('an explicitly flat floor is walkable even when the older terrain or asset mask was a wall', () => {
  const document = fixture(), floor = asset('floor'); setWorldAssetCategory(floor, 'floor'); document.assets.push(floor);
  document.tiles.find(p => p.x === 2 && p.y === 2)!.terrain = 'rock';
  floor.cells[0] = { blocked: true, visibility: 'hide-fade' };
  assert.ok(stampAsset(document, floor, { x: 2, y: 2 }, 'floor-instance'));
  const world = new World(document.seed, 16, 'world', parseWorldDocument(document), []);
  assert.equal(world.surfaceAt(2, 2)!.blocked, false); assert.equal(world.isHiding(120, 120), false);
  paintAssetCell(floor, 0, 0, 'wall'); assert.deepEqual(floor.cells[0], { blocked: false, visibility: 'normal' });
});

test('retagging an existing floor restores walkability without rewriting terrain or placements at runtime', () => {
  const document = fixture(), floor = asset('old-floor'); floor.layer = 'ground'; floor.cells[0].blocked = true;
  resizeWorldAsset(floor, 2, 1);
  document.assets.push(floor); document.placements.push({ id: 'existing-floor', assetId: floor.id, x: 2, y: 2 });
  document.surfaceCells = [{ x: 3, y: 2, surfaceId: 'ground', elevation: 2, kind: 'ground', material: 'path', wallMaterial: 'rock', blocked: true },
    { x: 2, y: 2, surfaceId: 'deck', elevation: 5, kind: 'bridge', material: 'wood', wallMaterial: 'wood', blocked: true }];
  document.tiles.find(p => p.x === 2 && p.y === 2)!.terrain = 'rock';
  assert.equal(new World(document.seed, 16, 'world', document, []).surfaceAt(2, 2)!.blocked, true);
  setWorldAssetCategory(floor, 'floor');
  const snapshot = structuredClone(document), authoring = new WorldAuthoring(document);
  assert.equal(authoring.hasFloorAt(2, 2), true); assert.equal(authoring.hasFloorAt(2, 2, 'deck'), false); assert.equal(authoring.hasFloorAt(4, 2), false);
  const world = new World(document.seed, 16, 'world', document, []);
  assert.equal(world.surfaceAt(2, 2)!.blocked, false); assert.equal(world.surfaceAt(3, 2)!.blocked, false);
  assert.equal(world.surfaceAt(3, 2)!.elevation, 2); assert.equal(world.surfaceAt(2, 2, 'deck')!.blocked, true);
  assert.deepEqual(document, snapshot, 'runtime semantics do not migrate map data');
  const stone = asset('stone'); stone.cells[0].blocked = true; document.assets.push(stone);
  document.placements.push({ id: 'stone', assetId: stone.id, x: 2, y: 2 });
  assert.equal(new World(document.seed, 16, 'world', document, []).surfaceAt(2, 2)!.blocked, true, 'objects retain their own collision on a floor');
});

test('floor painting retains elevation, a deck and objects on its selected plane', () => {
  const document = fixture(), floor = asset('floor'), stone = asset('stone'); setWorldAssetCategory(floor, 'floor');
  document.assets.push(floor, stone);
  document.surfaceCells = [{ x: 2, y: 2, surfaceId: 'ground', elevation: 3, kind: 'ground', material: 'grass', wallMaterial: 'rock' },
    { x: 4, y: 4, surfaceId: 'deck', elevation: 5, kind: 'bridge', material: 'wood', wallMaterial: 'wood' }];
  document.placements.push({ id: 'stone', assetId: stone.id, x: 2, y: 2, elevation: 3 });
  const brush = new WorldBrush(document);
  assert.equal(brush.stamp(floor, { x: 2, y: 2, surfaceId: 'ground', elevation: 3 }, 'floor-ground'), true);
  assert.equal(brush.stamp(floor, { x: 4, y: 4, surfaceId: 'deck', elevation: 5 }, 'floor-deck'), true);
  assert.deepEqual(document.placements.map(p => p.id), ['stone', 'floor-ground', 'floor-deck']);
  assert.equal(document.surfaceCells[0].elevation, 3); assert.equal(document.surfaceCells[1].kind, 'bridge');
  assert.equal(document.surfaceCells[1].elevation, 5); assert.equal(document.surfaceCells.length, 2);
});

test('a plateau stamp creates walkable elevated terrain and keeps ground objects, NPCs and spawn attached', () => {
  const document = fixture(), plateau = asset('plateau'), stone = asset('stone');
  stone.generation.spacing = 0;
  resizeWorldAsset(plateau, 2, 1); setWorldAssetCategory(plateau, 'elevation'); document.assets.push(plateau, stone);
  plateau.cells.forEach(cell => { cell.blocked = true; cell.visibility = 'hide-fade'; });
  document.placements.push({ id: 'stone', assetId: stone.id, x: 2, y: 2 });
  document.npcs.push({ id: 'npc', npcKind: 'slime', level: 1, x: 3, y: 2 }); document.spawn = { x: 2, y: 2 };
  assert.equal(new WorldBrush(document).stamp(plateau, { x: 2, y: 2 }, 'height'), true);
  assert.equal(document.placements.length, 2, 'the PNG is retained as a top-face decoration');
  assert.deepEqual(document.placements[1], { id: 'height', assetId: plateau.id, x: 2, y: 2, surfaceId: 'ground', elevation: 3 });
  assert.equal(document.placements[0].elevation, 3); assert.equal(document.npcs[0].elevation, 3); assert.equal(document.spawn.elevation, 3);
  assert.equal(document.surfaceCells!.length, 2); assert.equal(stampElevationAsset(document, plateau, { x: 2, y: 2 }), false, 'same stamp does not accumulate height');
  const restored = parseWorldDocument(document), world = new World(document.seed, 16, 'world', restored, []);
  assert.equal(world.surfaceAt(2, 2)!.elevation, 3); assert.equal(world.surfaceAt(2, 2)!.blocked, false);
  assert.equal(world.isHiding(120, 120), false, 'elevation artwork never conceals or blocks the walkable top');
  assert.equal(world.surfaceAt(1, 2)!.elevation, 0); assert.equal(world.surfaceAt(1, 2)!.blocked, false);
  assert.equal(canStampAsset(document, stone, { x: 3, y: 2, surfaceId: 'ground', elevation: 3 }), true);
});

test('elevation artwork uses a real stamp anchor and the brush indexes it for subsequent editing', () => {
  const document = fixture(), plateau = asset('plateau'); setWorldAssetCategory(plateau, 'elevation'); document.assets.push(plateau);
  const p = stampAsset(document, plateau, { x: 2, y: 2, elevation: 0 }, 'art');
  assert.equal(p, document.placements[0]); assert.equal(p!.elevation, 3);
  plateau.elevation!.height = 4;
  assert.equal(stampAsset(document, plateau, { x: 2, y: 2 }, 'replacement-id'), p);
  assert.equal(document.placements.length, 1); assert.equal(p!.elevation, 4);
  const brush = new WorldBrush(document);
  assert.equal(brush.stamp(plateau, { x: 4, y: 4 }, 'new-art'), true);
  brush.erase({ x: 4, y: 4, surfaceId: 'ground' });
  assert.deepEqual(document.placements.map(placement => placement.id), ['art']);
  assert.equal(document.surfaceCells!.find(cell => cell.x === 4 && cell.y === 4)!.elevation, 4, 'removing the decoration preserves the terrain');
  const snapshot = structuredClone(document);
  assert.equal(stampElevationAsset(document, plateau, { x: 6, y: 6 }, 'art'), false, 'duplicate IDs cannot create a partial terrain stamp');
  assert.deepEqual(document, snapshot);
});

test('elevation stamps reject structural intersections and fail without partially changing the document', () => {
  const document = fixture(), plateau = asset('plateau'); setWorldAssetCategory(plateau, 'elevation'); document.assets.push(plateau);
  document.surfaceCells = [{ x: 2, y: 2, surfaceId: 'ground', elevation: 3, kind: 'ground', material: 'rock', wallMaterial: 'rock' },
    { x: 4, y: 4, surfaceId: 'deck', elevation: 2, kind: 'bridge', material: 'wood', wallMaterial: 'wood' }];
  const world = new World(document.seed, 16, 'world', document, []);
  const flight = planStair({ x: 0, y: 2, surfaceId: 'ground' }, { x: 2, y: 2, surfaceId: 'ground' },
    (x, y, id) => world.surfaceAt(x, y, id), { id: 'flight' });
  document.surfaceCells.push(...flight.cells); document.surfaceLinks = flight.links; document.surfaceStairs = [flight.stair];
  const before = structuredClone(document);
  for (const p of [{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 4, y: 4 }, { x: 4, y: 4, surfaceId: 'deck' }]) {
    assert.equal(planElevationAsset(document, plateau, p), undefined); assert.equal(stampElevationAsset(document, plateau, p), false);
    assert.deepEqual(document, before);
  }
});

test('inferred legacy elevations retain their original image placement and blocked mask until explicitly converted', () => {
  const document = fixture(), oldWall = asset('old-wall'); oldWall.layer = 'ground'; oldWall.cells[0].blocked = true; document.assets.push(oldWall);
  assert.equal(worldAssetCategory(oldWall), 'elevation'); assert.ok(stampAsset(document, oldWall, { x: 2, y: 2 }, 'legacy'));
  assert.equal(document.surfaceCells, undefined); assert.equal(document.placements.length, 1);
  assert.equal(new World(document.seed, 16, 'world', document, []).surfaceAt(2, 2)!.blocked, true);
});
