import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { World } from '../shared/world';
import { WorldBrush } from '../shared/world-editing';
import { TerrainElevationBrush } from '../shared/terrain-elevation-editing';

test('water canvas stays empty, including roads and camp pickups', () => {
  const document = newWorldDocument(); document.baseTerrain = 'water';
  const world = new World(1, 160, 'world', parseWorldDocument(document), []);
  for (const [x,y] of [[0,0],[-1,0],[48,48],[-96,144],[1000,-1000]]) {
    const chunk = world.getChunk(x,y);
    assert.ok(chunk.tiles.every(t => t === 'water'));
    assert.deepEqual(chunk.npcs, []); assert.deepEqual(chunk.pickups, []);
  }
  assert.equal(world.elevation.baseAt(0,0), -1);
});

test('painted land and elevated terrain survive export on a water canvas; restore returns water', () => {
  const document = newWorldDocument(); document.baseTerrain = 'water';
  const tiles = new WorldBrush(document), heights = new TerrainElevationBrush(document);
  tiles.tile({x:3,y:4}, {terrain:'grass',suppressAssets:true});
  heights.paint({x:3,y:4}, 'grass', 3, 0); heights.flush(true); tiles.flushTiles();
  let world = new World(1,160,'world',parseWorldDocument(document),[]);
  assert.equal(world.getTile(3,4),'grass');
  assert.equal(world.elevation.terrainElevationAt(3.5,4.5),3);
  assert.equal(world.getTile(4,4),'water');
  const restore = new WorldBrush(document), restoreHeight = new TerrainElevationBrush(document);
  restore.tile({x:3,y:4}); restoreHeight.paint({x:3,y:4},undefined,0,0); restoreHeight.flush(true); restore.flushTiles();
  world = new World(1,160,'world',parseWorldDocument(document),[]);
  assert.equal(world.getTile(3,4),'water');
  assert.equal(world.elevation.terrainElevationAt(3.5,4.5),-1);
});
