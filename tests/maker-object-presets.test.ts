import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorldAsset, newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { ensureMakerObjectAsset } from '../shared/maker-object-presets';
import { stampAsset, WorldBrush } from '../shared/world-editing';
import { World } from '../shared/world';
import { collidesWorld } from '../shared/physics';
import { TILE_SIZE } from '../shared/tile-size';

test('object presets retain legacy bushes and custom preset definitions without changing their masks or generation', () => {
  const doc = newWorldDocument(), legacy = newWorldAsset('bush', 'Cespuglio esistente', '/world-assets/bush.png');
  legacy.generation.enabled = true; legacy.generation.spacing = 0; legacy.cells[0] = { blocked: false, visibility: 'hide-fade' };
  const customized = newWorldAsset('maker-rock', 'Sasso personale', '/world-assets/maker-rock.svg'); customized.cells[0].blocked = false;
  doc.assets = [legacy, customized]; const before = structuredClone(doc.assets);
  const bush = ensureMakerObjectAsset(doc, 'bush'), rock = ensureMakerObjectAsset(doc, 'rock');
  assert.deepEqual(doc.assets.slice(0, 2), before);
  assert.equal(bush.id, 'maker-bush'); assert.equal(rock.id, 'maker-rock-2');
  assert.equal(ensureMakerObjectAsset(doc, 'bush'), bush); assert.equal(ensureMakerObjectAsset(doc, 'rock'), rock);
  for (const asset of [bush, rock]) {
    assert.equal(asset.category, 'object'); assert.equal(asset.width, 1); assert.equal(asset.height, 1);
    assert.equal(asset.generation.enabled, false); assert.equal(asset.generation.spacing, 0);
  }
  assert.deepEqual(rock.cells, [{ blocked: true, visibility: 'normal' }]);
  assert.deepEqual(bush.cells, [{ blocked: false, visibility: 'hide-fade' }]);
  assert.doesNotThrow(() => parseWorldDocument(doc));
});

test('stones and bushes stamp on a level-three plateau without repainting floors or blocking adjacent tiles', () => {
  const doc = newWorldDocument();
  doc.surfaceCells = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    doc.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
    doc.surfaceCells.push({ x, y, surfaceId: 'ground', elevation: 3, kind: 'ground', material: 'grass', wallMaterial: 'rock', blocked: false });
  }
  const originalFloor = structuredClone(doc.surfaceCells), originalTiles = structuredClone(doc.tiles);
  const rock = ensureMakerObjectAsset(doc, 'rock'), bush = ensureMakerObjectAsset(doc, 'bush');
  assert.ok(stampAsset(doc, rock, { x: 1, y: 2, elevation: 3 }, 'rock-on-plateau'));
  const brush = new WorldBrush(doc);
  assert.equal(brush.stamp(bush, { x: 2, y: 2, elevation: 3 }, 'bush-on-plateau'), true);
  assert.equal(brush.stamp(bush, { x: 3, y: 2, elevation: 3 }, 'bush-next-door'), true);
  assert.deepEqual(doc.surfaceCells, originalFloor); assert.deepEqual(doc.tiles, originalTiles);
  const world = new World(doc.seed, 16, 'world', doc, []);
  const point = (x: number, y: number) => ({ x: (x + .5) * TILE_SIZE, y: (y + .5) * TILE_SIZE, elevation: 3 });
  assert.equal(world.isBlocked(1, 2, point(1, 2)), true);
  for (const [x, y] of [[0, 2], [1, 1], [1, 3], [2, 2], [3, 2]]) {
    const position = point(x, y);
    assert.equal(collidesWorld(position.x, position.y, 15, world, position), false, `Neighbor ${x},${y} remains walkable at its original height`);
  }
  assert.equal(world.isHiding(point(2, 2).x, point(2, 2).y, point(2, 2)), true);
  assert.equal(world.surfaceAt(2, 2)?.material, 'grass'); assert.equal(world.surfaceAt(2, 2)?.elevation, 3);
});
