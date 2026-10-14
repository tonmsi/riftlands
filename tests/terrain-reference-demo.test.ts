import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE_SIZE } from '../shared/config';
import { World } from '../shared/world';
import { newTerrainReferenceDemoWorld, newTerrainReferenceDemoDungeon, REFERENCE_BRIDGE } from '../shared/terrain-reference-demo';
import { parseWorldDocument } from '../shared/world-schema';
import { serializeWorldDocument } from '../shared/world-tiles';
import { validateDungeonDraft } from '../shared/dungeon-draft';
import { findSurfacePath } from '../shared/surface-navigation';
import { moveWithCollisions } from '../shared/physics';
import { visualElevationAt } from '../shared/surface-presentation';

const center = (x: number, y: number, surfaceId = 'ground') => ({ x: (x + .5) * TILE_SIZE, y: (y + .5) * TILE_SIZE, surfaceId });
test('the complete comparison scene roundtrips structures and keeps every route reachable', () => {
  const doc = newTerrainReferenceDemoWorld(), restored = parseWorldDocument(serializeWorldDocument(doc));
  assert.equal(restored.surfaceStairs?.length, 6);
  assert.ok(restored.assets.some(a => a.id === 'reference-oak'));
  assert.ok(restored.assets.some(a => a.id === 'reference-cottage'));
  const world = new World(doc.seed, 16, 'world', doc, []);
  const path = findSurfacePath(world, center(3, 10), center(24, 18), 15, 4096);
  assert.ok(path?.some(p => p.surfaceId?.startsWith('stair:')));
  assert.ok(path?.some(p => p.surfaceId === REFERENCE_BRIDGE));
  assert.deepEqual(validateDungeonDraft(newTerrainReferenceDemoDungeon(), doc.assets), []);
});
test('the reference scene shows continuous ascent and a separate walkable lower bridge route', () => {
  const doc = newTerrainReferenceDemoWorld(), world = new World(doc.seed, 16, 'world', doc, []);
  const actor = { ...center(4, 10), radius: 15 };
  const midway = moveWithCollisions(actor, 1, 0, TILE_SIZE, world);
  assert.equal(midway.surfaceId, 'stair:reference-west-stair');
  assert.ok(Math.abs(visualElevationAt(midway, world) - 1.5) < 1e-6);
  const end = moveWithCollisions({ ...midway, radius: 15 }, 1, 0, TILE_SIZE, world);
  assert.equal(end.surfaceId, 'ground'); assert.equal(end.elevation, 3);
  const below = moveWithCollisions({ ...center(17, 15), radius: 15 }, 0, -1, 4 * TILE_SIZE, world);
  assert.equal(below.surfaceId, 'ground'); assert.equal(below.elevation, 0);
  assert.equal(world.surfaceFor(center(17, 11, REFERENCE_BRIDGE))!.elevation, 3);
});
