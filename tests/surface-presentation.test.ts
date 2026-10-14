import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE_SIZE } from '../shared/config';
import { ELEVATION_STEP } from '../shared/world-surfaces';
import { World } from '../shared/world';
import { newSurfaceDemoWorld } from '../shared/surface-demo';
import { moveWithCollisions } from '../shared/physics';
import { surfacePresentationAt, visualElevationAt, canInterpolateSurfaceTransition } from '../shared/surface-presentation';
import { LocalMovementView } from '../client/core/motion';
import { interpolateActor } from '../client/core/prediction';
import type { Actor } from '../shared/types';

function fixture(): World { const doc = newSurfaceDemoWorld(); return new World(doc.seed, 16, 'world', doc, []); }
function actor(x: number, elevation = 0, surfaceId = 'ground'): Actor {
  return { id: 'self', x, y: 7.5 * TILE_SIZE, surfaceId, elevation, kind: 'player', name: 'Test', classId: 'mage',
    radius: 15, hp: 100, maxHp: 100, resource: 100, maxResource: 100, aim: 0, speed: 190, level: 1,
    xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0, deadUntil: 0,
    spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
}

test('climbing and descending traverse a continuous foot height while simulation support remains integer', () => {
  const world = fixture(); let current = actor(3.5 * TILE_SIZE);
  let height = visualElevationAt(current, world), logicalChanges = 0;
  assert.equal(height, 0);
  for (const direction of [1, -1]) for (let i = 0; i < TILE_SIZE; i++) {
    const next = { ...current, ...moveWithCollisions(current, direction, 0, 1, world) };
    if (next.elevation !== current.elevation) logicalChanges++;
    assert.ok(next.elevation === 0 || next.elevation === 2);
    const shown = visualElevationAt(next, world);
    assert.equal(surfacePresentationAt(next, world).drawPlane, 2, 'the connector is painted before the body throughout the climb');
    assert.ok(Math.abs((shown - height) * ELEVATION_STEP) < 1.01, `displayed step was ${(shown - height) * ELEVATION_STEP}px`);
    height = shown; current = next;
  }
  assert.equal(logicalChanges, 2); assert.equal(height, 0); assert.equal(current.elevation, 0);
});

test('link orientation does not change the visual slope and ramps have the same continuous boundary', () => {
  const world = fixture();
  for (const x of [17.5 * TILE_SIZE, 18 * TILE_SIZE - .001, 18 * TILE_SIZE + .001, 18.5 * TILE_SIZE]) {
    const point = actor(x, x < 18 * TILE_SIZE ? 2 : 0);
    const mirrored = actor((22 - x / TILE_SIZE) * TILE_SIZE, point.elevation);
    assert.ok(Math.abs(visualElevationAt(point, world) - visualElevationAt(mirrored, world)) < 1e-9);
  }
  const doc = newSurfaceDemoWorld();
  doc.surfaceCells = [{ x: 2, y: 3, surfaceId: 'ground', elevation: 2, material: 'grass', wallMaterial: 'rock', kind: 'ground' }];
  doc.surfaceLinks = [{ id: 'vertical', kind: 'stairs', from: { x: 2, y: 2, surfaceId: 'ground' }, to: { x: 2, y: 3, surfaceId: 'ground' } }];
  const vertical = new World(doc.seed, 16, 'world', doc, []);
  assert.equal(visualElevationAt({ x: 2.5 * TILE_SIZE, y: 3 * TILE_SIZE, elevation: 2 }, vertical), 1);
  assert.equal(visualElevationAt({ x: 2.5 * TILE_SIZE, y: 3.5 * TILE_SIZE, elevation: 2 }, vertical), 2);
});

test('unlinked cliffs and the ground below a bridge never borrow the height above them', () => {
  const world = fixture();
  for (let x = 8 * TILE_SIZE; x <= 14 * TILE_SIZE - 1; x++) {
    assert.equal(visualElevationAt(actor(x), world), 0);
    assert.equal(surfacePresentationAt(actor(x), world).drawPlane, 0);
    assert.equal(visualElevationAt(actor(x, 2, 'bridge-demo'), world), 2);
  }
  assert.equal(visualElevationAt({ x: 4 * TILE_SIZE - 1, y: 5.5 * TILE_SIZE, elevation: 0 }, world), 0);
  assert.equal(visualElevationAt({ x: 4 * TILE_SIZE + 1, y: 5.5 * TILE_SIZE, elevation: 2 }, world), 2);
});

test('local ticks and remote snapshots keep interpolation across a connector without changing authoritative support', () => {
  const world = fixture(), before = actor(4 * TILE_SIZE - 2), after = actor(4 * TILE_SIZE + 4, 2);
  assert.equal(canInterpolateSurfaceTransition(before, after, world), true);
  const local = new LocalMovementView(); local.reset(before); local.advance(before, after, world);
  const shown = local.sample(after, .25, 0);
  assert.equal(shown.x, before.x + 1.5); assert.equal(shown.elevation, 2); assert.equal(after.x, 196);
  assert.ok(Math.abs(visualElevationAt(shown, world) - visualElevationAt({ ...shown, elevation: 0 }, world)) < 1e-9);
  const remote = interpolateActor(before, after, .25, world);
  assert.equal(remote.x, shown.x); assert.equal(remote.elevation, 2);
  const corrected = { ...after, x: after.x + 1 };
  local.correct(after, corrected, world); assert.equal(local.sample(corrected, .25, 0).x, shown.x);
});

test('plane changes without an adjacent connector still reset presentation, including an over/under teleport', () => {
  const world = fixture(), below = actor(10.5 * TILE_SIZE), above = actor(below.x, 2, 'bridge-demo');
  assert.equal(canInterpolateSurfaceTransition(below, above, world), false);
  const view = new LocalMovementView(); view.reset(below); view.advance(below, above, world);
  assert.equal(view.sample(above, 0, 0).x, above.x);
  assert.equal(interpolateActor(below, above, .2, world).elevation, 2);
  const unlinked = actor(4 * TILE_SIZE + 4, 2); unlinked.y = 5.5 * TILE_SIZE;
  const previous = { ...unlinked, x: 4 * TILE_SIZE - 2, elevation: 0 };
  assert.equal(canInterpolateSurfaceTransition(previous, unlinked, world), false);
  assert.equal(interpolateActor(previous, unlinked, .2, world).x, unlinked.x);
  assert.equal(canInterpolateSurfaceTransition(actor(3.5 * TILE_SIZE), actor(4.5 * TILE_SIZE + 200, 2), world), false);
});
