import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/world';
import { TILE_SIZE } from '../shared/config';
import { newWorldAsset, newWorldDocument } from '../shared/world-schema';
import { compactWorldTiles } from '../shared/world-tiles';
import { WorldBrush } from '../shared/world-editing';

test('collision and concealment reuse cell queries without mixing support planes', () => {
  const doc = newWorldDocument(), asset = newWorldAsset('cover', 'Cover', '/world-assets/bush.svg');
  asset.cells[0] = { blocked: true, visibility: 'hide-fade' }; doc.assets.push(asset);
  doc.tiles.push({ x: -1, y: -1, terrain: 'grass' });
  doc.placements.push({ id: 'cover', assetId: asset.id, x: -1, y: -1 });
  doc.surfaceCells = [{ x: -1, y: -1, surfaceId: 'deck', elevation: 2, material: 'wood', wallMaterial: 'earth', kind: 'bridge' }];
  const world = new World(42, 16, 'world', doc, []);
  let queries = 0; const original = world.assetsIn.bind(world);
  world.assetsIn = (...args) => { queries++; return original(...args); };
  const point = { x: -TILE_SIZE / 2, y: -TILE_SIZE / 2 };
  for (let i = 0; i < 100; i++) {
    assert.equal(world.surfaceAt(-1, -1)!.blocked, true);
    assert.equal(world.surfaceAt(-1, -1, 'deck')!.blocked, false);
    assert.equal(world.isHiding(point.x, point.y), true);
    assert.equal(world.isHiding(point.x, point.y, { ...point, surfaceId: 'deck' }), false);
  }
  assert.equal(queries, 1);
  world.setBossLocked('test', true); world.surfaceAt(-1, -1); assert.equal(queries, 2);
});

test('empty cell caches invalidate on placement additions, generation edits and revision changes', () => {
  const doc = compactWorldTiles(newWorldDocument()), asset = newWorldAsset('cover', 'Cover', '/world-assets/bush.svg');
  asset.cells[0] = { blocked: false, visibility: 'hide' }; doc.assets.push(asset);
  const world = new World(42, 16, 'world', doc, []);
  assert.equal(world.isHiding(24, 24), false);
  world.authoring.addPlacement({ id: 'added', assetId: asset.id, x: 0, y: 0 });
  assert.equal(world.isHiding(24, 24), true);
  let queries = 0; const original = world.assetsIn.bind(world);
  world.assetsIn = (...args) => { queries++; return original(...args); };
  world.authoring.invalidateTileGeneration(); world.surfaceAt(0, 0); assert.equal(queries, 1);
  world.authoringRevision++; world.surfaceAt(0, 0); assert.equal(queries, 2);
  const brush = new WorldBrush(doc); brush.tile({ x: 0, y: 0 }, { terrain: 'water' });
  world.updateAuthoredTiles(doc, brush.flushTiles());
  assert.equal(world.surfaceAt(0, 0)!.material, 'water'); assert.equal(queries, 3);
});

test('cell query cache stays bounded while exploring and public arrays remain independent', () => {
  const world = new World(42, 16, 'world', newWorldDocument(), []);
  for (let i = 0; i < 3000; i++) world.surfaceAt(i, 0);
  assert.ok((world as any).tileAssetCache.size <= 2048);
  const result = world.assetsIn({ left: 0, top: 0, right: 1, bottom: 1 }, false);
  result.push({ id: 'fake', assetId: 'fake', x: 0, y: 0 });
  assert.ok(world.assetsIn({ left: 0, top: 0, right: 1, bottom: 1 }, false).every(p => p.id !== 'fake'));
});
