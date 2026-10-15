import test from 'node:test';
import assert from 'node:assert/strict';
import { newTerracedTerrainDemoWorld, TERRACED_DEMO_CARDINAL_FLIGHTS, TERRACED_DEMO_SHELF_FLIGHTS, TERRACED_DEMO_SIZE, TERRACED_DEMO_SPAWN } from '../shared/terraced-terrain-demo';
import { parseWorldDocument } from '../shared/world-schema';
import { serializeWorldDocument } from '../shared/world-tiles';
import { World } from '../shared/world';
import { TILE_SIZE } from '../shared/tile-size';
import { moveWithCollisions } from '../shared/physics';
import { stairSpatialIssues } from '../shared/surface-stairs';
import { findSurfacePath } from '../shared/surface-navigation';
import type { SurfaceEndpoint } from '../shared/world-surfaces';

const center = (p: SurfaceEndpoint) => ({ x: (p.x + .5) * TILE_SIZE, y: (p.y + .5) * TILE_SIZE, surfaceId: p.surfaceId });

test('the playable terraced scene roundtrips all seven flights and keeps fresh independent documents', () => {
  const doc = newTerracedTerrainDemoWorld(), restored = parseWorldDocument(serializeWorldDocument(doc));
  assert.equal(restored.surfaceStairs?.length, 7);
  assert.deepEqual(restored.surfaceCells, doc.surfaceCells);
  assert.deepEqual(restored.spawn, TERRACED_DEMO_SPAWN);
  assert.equal(doc.tiles.length, TERRACED_DEMO_SIZE.width * TERRACED_DEMO_SIZE.height);
  assert.ok(doc.tiles.every(t => t.suppressAssets));
  const world = new World(doc.seed, 16, 'world', doc, []);
  for (const stair of doc.surfaceStairs!) assert.deepEqual(stairSpatialIssues(stair, (x, y, id) => world.surfaceAt(x, y, id)), []);
  const wall = world.surfaceAt(4, 12)!;
  assert.equal(wall.terrainRole, 'wall'); assert.equal(wall.elevation, 1); assert.equal(wall.blocked, true);
  assert.equal(world.surfaceAt(5, 12)!.elevation, 2);
  assert.equal(world.surfaceAt(6, 12)!.elevation, 3);
  assert.equal(world.surfaceAt(7, 12)!.blocked, false);
  doc.surfaceCells![0].elevation = 0; doc.spawn.x = 0;
  const fresh = newTerracedTerrainDemoWorld();
  assert.equal(fresh.surfaceCells![0].elevation, 3); assert.equal(fresh.spawn.x, 3);
});

test('the player climbs and descends the plateau through all four incised directions', () => {
  const doc = newTerracedTerrainDemoWorld(), world = new World(doc.seed, 16, 'world', doc, []);
  for (const { from, to } of TERRACED_DEMO_CARDINAL_FLIGHTS) {
    const dx = Math.sign(to.x - from.x), dy = Math.sign(to.y - from.y), distance = 4 * TILE_SIZE;
    const climbed = moveWithCollisions({ ...center(from), radius: 15 }, dx, dy, distance, world);
    assert.equal(climbed.surfaceId, 'ground'); assert.equal(climbed.elevation, 3);
    assert.ok(Math.hypot(climbed.x - center(to).x, climbed.y - center(to).y) < 1e-6);
    const descended = moveWithCollisions({ ...climbed, radius: 15 }, -dx, -dy, distance, world);
    assert.equal(descended.elevation, 0);
    assert.ok(Math.hypot(descended.x - center(from).x, descended.y - center(from).y) < 1e-6);
  }
  const blocked = moveWithCollisions({ ...center({ x: 3, y: 12, surfaceId: 'ground' }), radius: 15 }, 1, 0, 4 * TILE_SIZE, world);
  assert.ok(blocked.x <= 4 * TILE_SIZE - 15, 'the player cannot enter the rocky band beside the stairs');
});

test('the connected shelves permit continuous traversal across their shared upper landing', () => {
  const doc = newTerracedTerrainDemoWorld(), world = new World(doc.seed, 16, 'world', doc, []);
  for (const [index, { from, to }] of TERRACED_DEMO_SHELF_FLIGHTS.entries()) {
    const climbed = moveWithCollisions({ ...center(from), radius: 15, elevation: index }, 1, 0, 2 * TILE_SIZE, world);
    assert.equal(climbed.elevation, index + 1); assert.equal(climbed.surfaceId, 'ground');
    assert.ok(Math.abs(climbed.x - center(to).x) < 1e-6);
  }
  const start = center(TERRACED_DEMO_SHELF_FLIGHTS[0].from), summit = center(TERRACED_DEMO_SHELF_FLIGHTS[2].to);
  const climbed = moveWithCollisions({ ...start, radius: 15 }, 1, 0, 9 * TILE_SIZE, world);
  assert.equal(climbed.elevation, 3); assert.ok(Math.abs(climbed.x - summit.x) < 1e-6);
  const descended = moveWithCollisions({ ...climbed, radius: 15 }, -1, 0, 9 * TILE_SIZE, world);
  assert.equal(descended.elevation, 0); assert.ok(Math.abs(descended.x - start.x) < 1e-6);
  const path = findSurfacePath(world, center(TERRACED_DEMO_SPAWN), summit, 15, 4096);
  assert.ok(path?.some(p => p.surfaceId === 'stair:terraced-demo-shelf-three'));
});
