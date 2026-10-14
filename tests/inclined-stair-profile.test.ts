import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE_SIZE } from '../shared/tile-size';
import { World } from '../shared/world';
import { newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { serializeWorldDocument } from '../shared/world-tiles';
import { BASE_SURFACE, ELEVATION_STEP, validateSurfaceData, type StairProfile } from '../shared/world-surfaces';
import { planStair, stairFootprint, stairGeometry, stairSurfaceId } from '../shared/surface-stairs';
import { collidesWorld, moveWalkingWithCollisions, moveWithCollisions } from '../shared/physics';
import { visualElevationAt } from '../shared/surface-presentation';
import { SurfaceStroke, type SurfacePaintSettings } from '../client/editors/world/elevation-editor';

function fixture(dx = 1, dy = 0, length = 1, height = 3, profile: StairProfile | undefined = 'incline', angle?: 45) {
  const document = newWorldDocument(), from = { x: 7, y: 7, surfaceId: BASE_SURFACE };
  const to = { x: from.x + dx * length, y: from.y + dy * length, surfaceId: BASE_SURFACE };
  document.placements = []; document.npcs = [];
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) document.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  document.surfaceCells = [{ ...to, elevation: height, material: 'grass', wallMaterial: 'rock', kind: 'ground' }];
  const ground = new World(document.seed, 16, 'world', document, []);
  const plan = planStair(from, to, (x, y, id) => ground.surfaceAt(x, y, id), { id: 'inclined-flight', profile, angle });
  document.surfaceCells.push(...plan.cells); document.surfaceLinks = plan.links; document.surfaceStairs = [plan.stair];
  return { document, plan, from, to, world: new World(document.seed, 16, 'world', document, []) };
}

test('continuous 45 degree stairs fill the adjacent tile and use one shared linear profile', () => {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1]]) {
    const { world, plan, from, to } = fixture(dx, dy, 1, 3, 'incline', 45), g = stairGeometry(plan.stair);
    assert.equal(g.landing, 0); assert.equal(g.run, 48); assert.equal(g.rise, 48); assert.equal(g.angle, 45);
    assert.deepEqual(stairFootprint(plan.stair).map(p => [p.x, p.y]), [[from.x, from.y], [to.x, to.y]]);
    for (const t of [.1, .4, .6, .9]) {
      const p = g.pointAt(t);
      assert.ok(Math.abs(g.elevationAt(t) - t * 3) < 1e-8);
      assert.ok(Math.abs(visualElevationAt({ ...p, ...world.surfaceState(p) }, world) - t * 3) < 1e-8);
    }
    const start = { ...g.pointAt(0), surfaceId: BASE_SURFACE, elevation: 0, radius: 15 };
    const crossed = moveWithCollisions(start, dx, dy, 48, world);
    assert.ok(Math.hypot(crossed.x - g.pointAt(1).x, crossed.y - g.pointAt(1).y) < 1e-7);
    assert.equal(crossed.elevation, 3);
    const down = moveWithCollisions({ ...crossed, radius: 15 }, -dx, -dy, 48, world);
    assert.ok(Math.hypot(down.x - start.x, down.y - start.y) < 1e-7); assert.equal(down.elevation, 0);
  }
});

test('multi-tile inclined walls stay solid below and prevent leaving the elevated sides', () => {
  const { world, plan } = fixture(1, 0, 2, 6, 'incline', 45), g = stairGeometry(plan.stair), mid = g.pointAt(.5);
  const lower = { ...mid, surfaceId: BASE_SURFACE, elevation: 0 };
  assert.equal(collidesWorld(mid.x, mid.y, 15, world, lower), true);
  const approach = { ...lower, y: lower.y - 60, radius: 15 };
  const stopped = moveWithCollisions(approach, 0, 1, 120, world);
  assert.ok(stopped.y < mid.y - 24, 'a lower route cannot pass through the inclined body');
  const above = { ...mid, surfaceId: stairSurfaceId(plan.stair), elevation: 3, radius: 15 };
  assert.equal(collidesWorld(mid.x, mid.y, 15, world, above), false);
  const edge = moveWithCollisions(above, 0, 1, 60, world);
  assert.ok(edge.y - mid.y <= 9 + 1e-8); assert.equal(edge.surfaceId, above.surfaceId);
});

test('continuous ascent and descent retain the walking screen pace without a short-stair speed gain', () => {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1]]) {
    const { world, plan } = fixture(dx, dy), g = stairGeometry(plan.stair);
    for (const sign of [-1, 1]) {
      const p = g.pointAt(.5), actor = { ...p, ...world.surfaceState(p), radius: 15 }, budget = 6;
      const moved = moveWalkingWithCollisions(actor, dx * sign, dy * sign, budget, world);
      const ax = actor.x, ay = actor.y - ELEVATION_STEP * visualElevationAt(actor, world);
      const bx = moved.x, by = moved.y - ELEVATION_STEP * visualElevationAt(moved, world);
      assert.ok(Math.abs(Math.hypot(bx - ax, by - ay) - budget) < 1e-8);
    }
  }
});

test('45 degree authoring validates the chosen banks without silently changing their heights', () => {
  assert.throws(() => fixture(1, 0, 1, 1, 'incline', 45), /3 livelli ogni tile/);
  assert.throws(() => fixture(1, 0, 2, 3, 'incline', 45), /3 livelli ogni tile/);
  assert.doesNotThrow(() => fixture(1, 0, 2, 6, 'incline', 45));
  assert.throws(() => fixture(0, 1, 1, 3, 'incline', 45), /allunga.*sud/);
  assert.doesNotThrow(() => fixture(0, 1, 2, 3));
});

test('profile persists through world export while historical stairs keep their previous landings', () => {
  const { document, plan } = fixture(1, 0, 2, 6);
  const restored = parseWorldDocument(serializeWorldDocument(document));
  assert.equal(restored.surfaceStairs![0].profile, 'incline');
  assert.equal(stairGeometry(restored.surfaceStairs![0]).landing, 0);
  const historical = { ...plan.stair }; delete historical.profile;
  assert.equal(stairGeometry(historical).landing, 24);
  assert.equal(stairGeometry({ ...historical, profile: 'landings' }).landing, 24);
  assert.throws(() => validateSurfaceData(document.surfaceCells, document.surfaceLinks,
    [{ ...plan.stair, profile: 'fake' }]), /profilo/);
});

const paintSettings: SurfacePaintSettings = { elevation: 1, material: 'grass', wallMaterial: 'rock', surfaceId: BASE_SURFACE, blocked: false };
test('raising a legacy rock tile does not copy its implicit terrain blockage into the new walkable top', () => {
  const document = newWorldDocument(); document.placements = []; document.npcs = [];
  document.tiles.push({ x: 2, y: 3, terrain: 'rock', suppressAssets: true });
  const before = new World(document.seed, 16, 'world', document, []);
  assert.equal(before.surfaceAt(2, 3)!.blocked, true);
  new SurfaceStroke(document, p => before.surfaceAt(p.x, p.y, p.surfaceId)).paint({ x: 2, y: 3 }, 'raise-height', paintSettings);
  assert.equal(document.surfaceCells![0].blocked, undefined);
  assert.equal(new World(document.seed, 16, 'world', document, []).surfaceAt(2, 3)!.blocked, false);
});

test('relative changes preserve explicit blocking and floor painting can explicitly clear it', () => {
  const document = newWorldDocument();
  document.surfaceCells = [{ x: 2, y: 3, surfaceId: BASE_SURFACE, elevation: 1, material: 'rock', wallMaterial: 'rock', kind: 'ground', blocked: true }];
  const stroke = new SurfaceStroke(document);
  stroke.paint({ x: 2, y: 3 }, 'raise-height', paintSettings);
  assert.equal(document.surfaceCells[0].blocked, true);
  stroke.paintMaterial({ x: 2, y: 3 }, 'path');
  assert.equal(document.surfaceCells[0].blocked, true, 'a material-only API call preserves an intentional custom blocker');
  stroke.paintMaterial({ x: 2, y: 3 }, 'path', false);
  assert.equal(document.surfaceCells[0].blocked, undefined);
  assert.equal(document.surfaceCells[0].elevation, 2);
});

test('floor painting changes the selected deck without replacing the ground or changing its height', () => {
  const document = newWorldDocument();
  document.surfaceCells = [
    { x: 3, y: 4, surfaceId: BASE_SURFACE, elevation: 0, material: 'grass', wallMaterial: 'earth', kind: 'ground' },
    { x: 3, y: 4, surfaceId: 'deck', elevation: 4, material: 'wood', wallMaterial: 'wood', wallSkin: 'wall-roccia', kind: 'bridge', blocked: true },
  ];
  const lowerBefore = structuredClone(document.surfaceCells[0]);
  new SurfaceStroke(document).paintMaterial({ x: 3, y: 4, surfaceId: 'deck' }, 'stone', false);
  assert.deepEqual(document.surfaceCells[0], lowerBefore);
  assert.deepEqual(document.surfaceCells[1], { x: 3, y: 4, surfaceId: 'deck', elevation: 4, material: 'stone', wallMaterial: 'wood', wallSkin: 'wall-roccia', kind: 'bridge' });
});

test('a stone floor on a legacy rock tile creates a flat walkable surface instead of a rock obstacle', () => {
  const document = newWorldDocument(); document.placements = []; document.npcs = [];
  document.tiles.push({ x: 3, y: 4, terrain: 'rock', suppressAssets: true });
  const before = new World(document.seed, 16, 'world', document, []);
  new SurfaceStroke(document, p => before.surfaceAt(p.x, p.y, p.surfaceId)).paintMaterial({ x: 3, y: 4 }, 'stone', false);
  assert.equal(document.surfaceCells![0].material, 'stone'); assert.equal(document.surfaceCells![0].elevation, 0);
  assert.equal(document.surfaceCells![0].kind, 'ground'); assert.equal(document.surfaceCells![0].blocked, undefined);
  const after = new World(document.seed, 16, 'world', document, []);
  assert.equal(after.surfaceAt(3, 4)!.blocked, false);
  assert.equal(collidesWorld(3.5 * TILE_SIZE, 4.5 * TILE_SIZE, 0, after), false);
});
