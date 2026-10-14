import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE_SIZE } from '../shared/tile-size';
import { ELEVATION_STEP, type SurfaceStair } from '../shared/world-surfaces';
import { World } from '../shared/world';
import { newWorldDocument } from '../shared/world-schema';
import { planStair, stairGeometry, stairSurfaceId } from '../shared/surface-stairs';
import { moveWalkingWithCollisions, moveWithCollisions } from '../shared/physics';
import { visualElevationAt } from '../shared/surface-presentation';
import { walkingStepDistance } from '../shared/stair-walking';
import type { Vec2 } from '../shared/types';

function fixture(dx = 0, dy = -1, length = 1, height = 3, underpass = false, legacy = false) {
  const document = newWorldDocument(), from = { x: 8, y: 8, surfaceId: 'ground' }, to = { x: 8 + dx * length, y: 8 + dy * length, surfaceId: 'ground' };
  document.placements = []; document.npcs = [];
  for (let y = 0; y < 25; y++) for (let x = 0; x < 25; x++) document.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  document.surfaceCells = [];
  for (let lane = -1; lane <= 1; lane++) document.surfaceCells.push({ x: to.x - dy * lane, y: to.y + dx * lane,
    surfaceId: 'ground', elevation: height, material: 'grass', wallMaterial: 'rock', kind: 'ground' });
  const ground = new World(document.seed, 16, 'world', document, []);
  let stair: SurfaceStair;
  if (legacy) {
    stair = { id: 'old-flight', kind: 'stairs', from: { ...from, elevation: 0 }, to: { ...to, elevation: height }, width: 48 };
    document.surfaceLinks = [{ id: stair.id, kind: 'stairs', from, to }];
  } else {
    const plan = planStair(from, to, (x, y, id) => ground.surfaceAt(x, y, id), { id: 'walking-flight', underpass });
    stair = plan.stair; document.surfaceCells.push(...plan.cells); document.surfaceLinks = plan.links; document.surfaceStairs = [stair];
  }
  return { world: new World(document.seed, 16, 'world', document, []), stair, document };
}
function actorAt(world: World, stair: SurfaceStair, t: number, radius = 15) {
  const p = stairGeometry(stair).pointAt(t), tx = Math.floor(p.x / TILE_SIZE), ty = Math.floor(p.y / TILE_SIZE);
  const id = world.surfaceIndex.at(tx, ty, stairSurfaceId(stair)) ? stairSurfaceId(stair) : 'ground';
  return { ...p, ...world.surfaceState({ ...p, surfaceId: id }), radius };
}
const screen = (p: Vec2, world: World) => ({ x: p.x, y: p.y - ELEVATION_STEP * visualElevationAt(p, world) });
function screenDistance(a: Vec2, b: Vec2, world: World) {
  const sa = screen(a, world), sb = screen(b, world);
  return Math.hypot(sb.x - sa.x, sb.y - sa.y);
}

test('short north stairs spend walking time on the full visible path in ascent and descent', () => {
  const { world, stair } = fixture(), g = stairGeometry(stair);
  assert.equal(g.rise / (g.run - 2 * g.landing), 2);
  for (const sign of [1, -1]) {
    const actor = actorAt(world, stair, .5), budget = 190 / 30;
    const moved = moveWalkingWithCollisions(actor, 0, -sign, budget, world);
    assert.ok(Math.abs(screenDistance(actor, moved, world) - budget) < 1e-8, 'screen pace remains 190px/s');
    assert.ok(Math.abs(Math.abs(moved.y - actor.y) - budget / 3) < 1e-8);
    const probe = moveWithCollisions(actor, 0, -sign, budget, world);
    assert.ok(Math.abs(Math.abs(probe.y - actor.y) - budget) < 1e-8, 'world-distance probes retain exact displacement');
  }
});

test('cardinal ascent and descent compensate visible expansion without ever boosting ground speed', () => {
  for (const [dx, dy, length] of [[0, -1, 1], [0, -1, 4], [1, 0, 1], [-1, 0, 4], [0, 1, 4]]) {
    const { world, stair } = fixture(dx, dy, length), g = stairGeometry(stair);
    const slope = g.rise / (g.run - 2 * g.landing), projected = Math.hypot(dx, dy - slope);
    for (const sign of [1, -1]) {
      const actor = actorAt(world, stair, .5), budget = 5;
      const moved = moveWalkingWithCollisions(actor, dx * sign, dy * sign, budget, world);
      const physical = Math.hypot(moved.x - actor.x, moved.y - actor.y);
      assert.ok(Math.abs(physical - budget / Math.max(1, projected)) < 1e-8, `${dx},${dy} direction ${sign}`);
      assert.ok(physical <= budget + 1e-8, 'a compressed projection never grants a world-speed boost');
      assert.ok(screenDistance(actor, moved, world) <= budget + 1e-8);
    }
  }
});

test('flat landings and their phase boundaries are integrated exactly across one call or many ticks', () => {
  for (const [dx, dy, length] of [[0, -1, 1], [0, -1, 4], [1, 0, 1], [0, 1, 4]]) {
    const { world, stair } = fixture(dx, dy, length), g = stairGeometry(stair);
    const slope = g.rise / (g.run - 2 * g.landing), k = Math.max(1, Math.hypot(dx, dy - slope));
    const budget = 2 * g.landing + (g.run - 2 * g.landing) * k + 16;
    for (const sign of [1, -1]) {
      const source = actorAt(world, stair, sign > 0 ? 0 : 1);
      source.x -= dx * sign * 8; source.y -= dy * sign * 8;
      const expected = g.pointAt(sign > 0 ? 1 : 0);
      expected.x += dx * sign * 8; expected.y += dy * sign * 8;
      const once = moveWalkingWithCollisions(source, dx * sign, dy * sign, budget, world);
      let many = source;
      for (let left = budget; left > 1e-8;) {
        const part = Math.min(190 / 30, left); left -= part;
        many = { ...many, ...moveWalkingWithCollisions(many, dx * sign, dy * sign, part, world) };
      }
      assert.ok(Math.hypot(once.x - expected.x, once.y - expected.y) < 1e-7, `one call ${dx},${dy},${sign}`);
      assert.ok(Math.hypot(many.x - once.x, many.y - once.y) < 1e-7, `tick partitions ${dx},${dy},${sign}`);
    }
  }
});

test('crossing into a steep flight spends only the inclined part of the substep at its slower stride', () => {
  const { world, stair } = fixture(), g = stairGeometry(stair);
  const actor = actorAt(world, stair, (g.landing - 2) / g.run);
  const moved = moveWalkingWithCollisions(actor, 0, -1, 5, world);
  assert.ok(Math.abs(actor.y - moved.y - 3) < 1e-8, 'two flat pixels and one inclined pixel spend five walking pixels');
  assert.ok(Math.abs(screenDistance(actor, moved, world) - 5) < 1e-8);
  const flat = actorAt(world, stair, 0);
  assert.equal(walkingStepDistance(flat, 0, -1, 5, world), 5);
});

test('analog input retains its magnitude and diagonal motion uses the actual projected direction', () => {
  const { world, stair } = fixture(0, -1, 4), actor = actorAt(world, stair, .5, 1);
  const moved = moveWalkingWithCollisions(actor, 0, -.4, 5, world);
  assert.ok(Math.abs(screenDistance(actor, moved, world) - 2) < 1e-8);
  const diagonal = moveWalkingWithCollisions(actor, .2, -.2, 5, world);
  assert.ok(Math.abs(screenDistance(actor, diagonal, world) - 5 * Math.hypot(.2, -.2)) < 1e-8);
});

test('a collision slide recalculates stair pace for the surviving axis', () => {
  const { world, stair } = fixture(), actor = actorAt(world, stair, .5);
  actor.x += 8.5;
  const moved = moveWalkingWithCollisions(actor, 1, -1, 6, world);
  assert.ok(Math.abs(moved.x - actor.x) < 1e-8);
  assert.ok(Math.abs(actor.y - moved.y - 2) < 1e-8, 'the vertical slide uses metric 3 rather than the diagonal metric');
  assert.ok(Math.abs(screenDistance(actor, moved, world) - 6) < 1e-8);
});

test('legacy smoothstep stairs follow the same walking-time budget and remain tick-partition independent', () => {
  for (const [dx, dy] of [[0, -1], [1, 0]]) {
    const { world, stair } = fixture(dx, dy, 1, 3, false, true);
    const actor = actorAt(world, stair, .2, 1), budget = 19;
    const once = moveWalkingWithCollisions(actor, dx, dy, budget, world);
    let many = actor;
    for (let i = 0; i < 19; i++) many = { ...many, ...moveWalkingWithCollisions(many, dx, dy, 1, world) };
    assert.ok(Math.hypot(once.x - many.x, once.y - many.y) < 1e-7);
    let arc = 0, previous = screen(actor, world);
    for (let i = 1; i <= 2000; i++) {
      const t = i / 2000, p = { x: actor.x + (once.x - actor.x) * t, y: actor.y + (once.y - actor.y) * t, surfaceId: 'ground' };
      const current = screen(p, world); arc += Math.hypot(current.x - previous.x, current.y - previous.y); previous = current;
    }
    assert.ok(Math.abs(arc - budget) < 1e-5, `${dx},${dy}: integrated visible arc equals time budget`);
  }
});

test('suspended tops use compensation while lower ground and bridge supports retain ordinary pace', () => {
  const { world, stair, document } = fixture(0, -1, 4, 3, true);
  const above = actorAt(world, stair, .5), top = moveWalkingWithCollisions(above, 0, -1, 5, world);
  assert.ok(Math.abs(screenDistance(above, top, world) - 5) < 1e-8);
  const beneath = { ...stairGeometry(stair).pointAt(.5), surfaceId: 'ground', elevation: 0, radius: 8 };
  assert.equal(walkingStepDistance(beneath, 0, -1, 5, world), 5);
  const lower = moveWalkingWithCollisions(beneath, 1, 0, 40, world);
  assert.ok(Math.abs(lower.x - beneath.x - 40) < 1e-8);
  document.surfaceCells!.push({ x: 15, y: 15, surfaceId: 'bridge:pace', elevation: 3, material: 'wood', wallMaterial: 'wood', kind: 'bridge' });
  const bridged = new World(document.seed, 16, 'world', document, []);
  const bridgeActor = { x: 15.5 * TILE_SIZE, y: 15.5 * TILE_SIZE, surfaceId: 'bridge:pace', elevation: 3, radius: 8 };
  assert.equal(walkingStepDistance(bridgeActor, 1, 0, 5, bridged), 5);
  assert.ok(Math.abs(moveWalkingWithCollisions(bridgeActor, 1, 0, 5, bridged).x - bridgeActor.x - 5) < 1e-8);
  assert.equal(walkingStepDistance({ ...bridgeActor, surfaceId: 'ground', elevation: 0 }, 1, 0, 5, bridged), 5);
});

test('solid lower stair bodies remain blocked and walking does not change canonical collision displacement', () => {
  const { world, stair } = fixture(1, 0, 4), p = stairGeometry(stair).pointAt(.5);
  const lower = { ...p, y: p.y - 44, surfaceId: 'ground', elevation: 0, radius: 8 };
  const walked = moveWalkingWithCollisions(lower, 0, 1, 88, world), pushed = moveWithCollisions(lower, 0, 1, 88, world);
  assert.deepEqual(walked, pushed);
  assert.ok(walked.y < p.y - 24);
  const flat = { x: 2.5 * TILE_SIZE, y: 2.5 * TILE_SIZE, radius: 15 };
  for (const [dx, dy, distance] of [[1, 0, 20], [.3, -.4, 30], [1, 1, 19], [0, 0, 12], [1, 0, 0]])
    assert.deepEqual(moveWalkingWithCollisions(flat, dx, dy, distance, world), moveWithCollisions(flat, dx, dy, distance, world));
});
