import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE_SIZE } from '../shared/tile-size';
import { World } from '../shared/world';
import { newWorldDocument } from '../shared/world-schema';
import { BASE_SURFACE, type SurfaceEndpoint } from '../shared/world-surfaces';
import { planStair, stairGeometry, stairPath } from '../shared/surface-stairs';
import { collidesWorld, hasLineOfSight, moveWithCollisions } from '../shared/physics';
import { sweptWorldHit } from '../shared/projectiles';
import { findSurfacePath } from '../shared/surface-navigation';
import type { Vec2 } from '../shared/types';

const center = (p: SurfaceEndpoint) => ({ x: (p.x + .5) * TILE_SIZE, y: (p.y + .5) * TILE_SIZE, surfaceId: p.surfaceId });
function fixture({ dx = 1, dy = 0, length = 4, width = 48, low = 0, high = 3, underpass = false } = {}) {
  const document = newWorldDocument(), from = { x: 8, y: 8, surfaceId: BASE_SURFACE }, to = { x: from.x + dx * length, y: from.y + dy * length, surfaceId: BASE_SURFACE };
  document.tiles = [];
  for (let y = 0; y < 22; y++) for (let x = 0; x < 22; x++) document.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  document.surfaceCells = [];
  for (let lane = -2; lane <= 2; lane++) for (const [p, elevation] of [[from, low], [to, high]] as const)
    if (elevation) document.surfaceCells.push({ x: p.x - dy * lane, y: p.y + dx * lane, surfaceId: p.surfaceId,
      elevation, kind: 'ground', material: 'grass', wallMaterial: 'rock' });
  const base = new World(document.seed, 16, 'world', document, []);
  const plan = planStair(from, to, (x, y, id) => base.surfaceAt(x, y, id), { id: 'solid-fixture', width, underpass });
  document.surfaceCells.push(...plan.cells); document.surfaceLinks = plan.links; document.surfaceStairs = [plan.stair];
  return { document, plan, from, to, world: new World(document.seed, 16, 'world', document, []) };
}

test('a solid staircase preserves the lower terrain but blocks actors, navigation, visibility and projectiles below it', () => {
  const { world, plan } = fixture(), middle = center(stairPath(plan.stair)[2]);
  const lower = { ...middle, surfaceId: BASE_SURFACE }, a = { ...lower, y: lower.y + 2 * TILE_SIZE }, b = { ...lower, y: lower.y - 2 * TILE_SIZE };
  assert.equal(world.surfaceFor(lower)!.elevation, 0);
  assert.equal(world.surfaceFor(lower)!.blocked, false, 'no permanent blocks are painted into the saved ground');
  assert.equal(world.isBlocked(10, 8, lower), true, 'spawn and tile queries include the structural body');
  assert.equal(collidesWorld(lower.x, lower.y, 15, world, lower), true);
  assert.equal(world.canTraverse({ ...lower, y: lower.y + TILE_SIZE }, lower.x, lower.y), undefined);
  const stopped = moveWithCollisions({ ...a, radius: 15 }, 0, -1, 4 * TILE_SIZE, world);
  assert.ok(stopped.y >= lower.y + plan.stair.width / 2 + 15 - 1e-6);
  assert.equal(stopped.surfaceId, BASE_SURFACE); assert.equal(stopped.elevation, 0);
  const route = findSurfacePath(world, a, b);
  assert.ok(route, 'the lower actor may still route around the solid staircase');
  assert.ok(route.every(p => p.surfaceId !== BASE_SURFACE || !world.stairVolumes.collides(p, 0)));
  assert.equal(hasLineOfSight(a, b, world), false);
  assert.equal(world.blocksRay(10, 8, a), true);
  assert.equal(sweptWorldHit(a, b, 0, world), (2 * TILE_SIZE - plan.stair.width / 2) / (4 * TILE_SIZE));
  assert.equal(sweptWorldHit(a, b, 5, world), (2 * TILE_SIZE - plan.stair.width / 2 - 5) / (4 * TILE_SIZE));
});

test('underpass is explicit and leaves the entire lower route free without changing the ascent', () => {
  const { world, plan, from, to } = fixture({ underpass: true }), middle = center(stairPath(plan.stair)[2]);
  const a = { ...middle, surfaceId: BASE_SURFACE, y: middle.y + TILE_SIZE }, b = { ...a, y: middle.y - TILE_SIZE };
  assert.equal(collidesWorld(middle.x, middle.y, 15, world, { ...middle, surfaceId: BASE_SURFACE }), false);
  assert.equal(world.isBlocked(10, 8), false);
  assert.ok(world.canTraverse(a, middle.x, middle.y));
  const crossed = moveWithCollisions({ ...a, radius: 15 }, 0, -1, 2 * TILE_SIZE, world);
  assert.ok(Math.abs(crossed.y - b.y) < 1e-6); assert.equal(crossed.elevation, 0); assert.equal(crossed.surfaceId, BASE_SURFACE);
  assert.equal(hasLineOfSight(a, b, world), true); assert.equal(sweptWorldHit(a, b, 5, world), null);
  assert.equal(world.blocksRay(10, 8, a), false);
  const upper = moveWithCollisions({ ...center(from), radius: 15 }, 1, 0, 4 * TILE_SIZE, world);
  assert.ok(Math.abs(upper.x - center(to).x) < 1e-6); assert.equal(upper.elevation, 3);
});

test('solid bodies and the walking profile agree in all four orientations and for partial outer lanes', () => {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [0, 1]]) for (const width of [40, 48, 96, 144]) {
    const { world, plan, from, to } = fixture({ dx, dy, width }), middle = center(stairPath(plan.stair)[2]);
    const side = { x: middle.x - dy * (width / 2 + 64), y: middle.y + dx * (width / 2 + 64), surfaceId: BASE_SURFACE, radius: 15 };
    const stopped = moveWithCollisions(side, dy, -dx, width + 128, world);
    const lateral = stairGeometry(plan.stair).lateralAt(stopped);
    assert.ok(lateral >= width / 2 + 15 - 1e-6, `${dx},${dy},width${width}: a lower actor cannot enter the side`);
    const laneOffset = width / 2 - 16;
    const first = { ...center(from), x: center(from).x - dy * laneOffset, y: center(from).y + dx * laneOffset, radius: 15 };
    const climbed = moveWithCollisions(first, dx, dy, 4 * TILE_SIZE, world);
    assert.ok(Math.hypot(climbed.x - (center(to).x - dy * laneOffset), climbed.y - (center(to).y + dx * laneOffset)) < 1e-6);
    assert.equal(climbed.elevation, 3);
    const descended = moveWithCollisions({ ...climbed, radius: 15 }, -dx, -dy, 4 * TILE_SIZE, world);
    assert.ok(Math.hypot(descended.x - first.x, descended.y - first.y) < 1e-6); assert.equal(descended.elevation, 0);
  }
});

test('a short flight stays climbable before its discrete support changes and keeps its flat approach free', () => {
  for (const [dx, dy, length, high] of [[1, 0, 1, 3], [-1, 0, 1, 3], [0, -1, 1, 3], [0, 1, 2, 1]]) {
    const { world, plan, from, to } = fixture({ dx, dy, length, high }), g = stairGeometry(plan.stair);
    const first = { ...center(from), x: center(from).x - dx * 18, y: center(from).y - dy * 18, radius: 15 };
    assert.equal(collidesWorld(first.x, first.y, first.radius, world, first), false);
    let actor: Vec2 & { radius: number } = first;
    for (let distance = 0; distance < length * TILE_SIZE + 18; distance += 2)
      actor = { ...actor, ...moveWithCollisions(actor, dx, dy, Math.min(2, length * TILE_SIZE + 18 - distance), world) };
    assert.ok(Math.hypot(actor.x - center(to).x, actor.y - center(to).y) < 1e-6, `${dx},${dy}: climb reaches the high landing`);
    assert.equal(actor.elevation, high);
    const lowFlat = g.pointAt(g.landing / g.run / 2);
    const flatEntry = { ...lowFlat, x: lowFlat.x - dy * 40, y: lowFlat.y + dx * 40, surfaceId: BASE_SURFACE };
    assert.ok(world.canTraverse(flatEntry, lowFlat.x, lowFlat.y), 'the flat lower approach may be entered laterally');
    const slope = g.pointAt((g.landing + 1) / g.run);
    const flank = { ...slope, x: slope.x - dy * 40, y: slope.y + dx * 40, surfaceId: BASE_SURFACE };
    assert.equal(world.canTraverse(flank, slope.x, slope.y), undefined, 'the inclined part cannot be entered from below the flank');
  }
});

test('geometric clearance never turns unused portions of a support cell into solid walls', () => {
  const { world, plan } = fixture({ width: 40 }), p = center(stairPath(plan.stair)[2]);
  // All three probes occupy the same ground cell, but only the middle one lies inside the body.
  assert.equal(collidesWorld(p.x, p.y + 23, 1, world, { ...p, surfaceId: BASE_SURFACE }), false);
  assert.equal(collidesWorld(p.x, p.y + 19, 1, world, { ...p, surfaceId: BASE_SURFACE }), true);
  const a = { x: p.x - 10, y: p.y + 23, surfaceId: BASE_SURFACE }, b = { x: p.x + 10, y: p.y + 23, surfaceId: BASE_SURFACE };
  assert.ok(world.canTraverse(a, b.x, b.y));
  assert.equal(hasLineOfSight(a, b, world), true); assert.equal(sweptWorldHit(a, b, 1, world), null);
  assert.equal(world.blocksRay(10, 8, a, a), false);
});

test('rays above a local slope slice pass while lower rays hit at the exact continuous threshold', () => {
  const { world, plan } = fixture(), g = stairGeometry(plan.stair);
  const atQuarter = g.pointAt(.25), atThreeQuarters = g.pointAt(.75);
  const cross = (p: { x: number; y: number }, height: number) => {
    const a = { x: p.x, y: p.y + 60, elevation: height }, b = { x: p.x, y: p.y - 60, elevation: height };
    return { a, b, hit: sweptWorldHit(a, b, 0, world), visible: hasLineOfSight(a, b, world) };
  };
  const aboveLowSlope = cross(atQuarter, 1);
  assert.equal(aboveLowSlope.hit, null); assert.equal(aboveLowSlope.visible, true);
  const belowHighSlope = cross(atThreeQuarters, 1);
  assert.equal(belowHighSlope.hit, .3); assert.equal(belowHighSlope.visible, false);
  assert.equal(cross(atThreeQuarters, 3).hit, null);
  const tangent = g.pointAt((g.landing + (g.run - 2 * g.landing) / 3) / g.run);
  assert.equal(cross(tangent, 1).hit, null, 'a ray exactly on the local top plane does not enter the solid body');
  assert.equal(world.blocksRay(Math.floor(tangent.x / TILE_SIZE), Math.floor(tangent.y / TILE_SIZE),
    { x: tangent.x, y: tangent.y + 60, elevation: 1 }, tangent), false);
  const a = { x: g.pointAt(0).x, y: g.pointAt(0).y, elevation: 1 }, b = { x: g.pointAt(.875).x, y: g.pointAt(.875).y, elevation: 1 };
  const expected = (g.landing + (g.run - 2 * g.landing) / 3) / (g.run * .875);
  assert.ok(Math.abs(sweptWorldHit(a, b, 0, world)! - expected) < 1e-9);
});

test('another elevated bridge is blocked only where its height intersects the body, while the stair owns its profile', () => {
  const { document, plan } = fixture({ low: 3, high: 6 }), p = center(stairPath(plan.stair)[2]);
  for (const [id, height] of [['upper-deck', 7], ['buried-deck', 1]] as const)
    for (let y = 6; y <= 10; y++) document.surfaceCells!.push({ x: 10, y, surfaceId: id, elevation: height, kind: 'bridge', material: 'wood', wallMaterial: 'wood', blocked: false });
  const world = new World(document.seed, 16, 'world', document, []);
  assert.equal(collidesWorld(p.x, p.y, 0, world, { ...p, surfaceId: 'upper-deck' }), false);
  assert.equal(collidesWorld(p.x, p.y, 0, world, { ...p, surfaceId: 'buried-deck' }), true);
  assert.equal(collidesWorld(p.x, p.y, 0, world, { ...p, surfaceId: BASE_SURFACE }), true, 'a solid stair from3 to6 does not create a tunnel at0');
  assert.equal(collidesWorld(p.x, p.y, 15, world, p), false);
  const next = center(stairPath(plan.stair)[3]);
  assert.equal(world.stairBodyHit(p, next, 5), null, 'shots on the stair do not hit their own continuous body');
  assert.equal(sweptWorldHit(p, next, 5, world), null);
});

test('historical adjacent connectors gain a solid smoothstep body without losing movement or their saved underlay', () => {
  const { document, from, to } = fixture({ length: 1 });
  delete document.surfaceStairs; document.surfaceLinks = [{ id: 'legacy', kind: 'ramp', from, to }];
  const world = new World(document.seed, 16, 'world', document, []), a = center(from), b = center(to);
  const climbed = moveWithCollisions({ ...a, radius: 15 }, 1, 0, TILE_SIZE, world);
  assert.ok(Math.abs(climbed.x - b.x) < 1e-6); assert.equal(climbed.elevation, 3);
  const descended = moveWithCollisions({ ...climbed, radius: 15 }, -1, 0, TILE_SIZE, world);
  assert.ok(Math.abs(descended.x - a.x) < 1e-6); assert.equal(descended.elevation, 0);
  const x = a.x + TILE_SIZE / 4, start = { x, y: a.y + 60, elevation: 0 }, end = { x, y: a.y - 60, elevation: 0 };
  assert.equal(world.canTraverse({ ...start, surfaceId: BASE_SURFACE }, x, a.y), undefined);
  assert.equal(hasLineOfSight(start, end, world), false); assert.equal(sweptWorldHit(start, end, 0, world), .3);
  assert.equal(sweptWorldHit({ ...start, elevation: 1 }, { ...end, elevation: 1 }, 0, world), null, 'smoothstep at one quarter is below1');
  const before = { x: a.x - 18, y: a.y, surfaceId: BASE_SURFACE, radius: 15 };
  assert.ok(Math.abs(moveWithCollisions(before, 1, 0, TILE_SIZE + 18, world).x - b.x) < 1e-6);
});

test('the spatial index limits body queries to local structures', () => {
  const { world, plan } = fixture(), g = stairGeometry(plan.stair);
  assert.equal(world.stairVolumes.at(g.pointAt(.5)).length, 1);
  assert.equal(world.stairVolumes.at({ x: 10000, y: -10000 }, 15).length, 0);
});
