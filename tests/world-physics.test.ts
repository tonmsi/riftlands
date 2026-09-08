import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT, TILE_SIZE } from '../shared/config';
import { World, chunkCoords, isSolid } from '../shared/world';
import { collidesWorld, hasLineOfSight, movementSpeed, moveWithCollisions, resolveActorCollisions, segmentCircleHit, terrainSpeed } from '../shared/physics';
import { interpolateActors, reconcile } from '../client/prediction';
import type { Actor, TileKind } from '../shared/types';

class TestWorld extends World {
  constructor(private tiles: Record<string, TileKind> = {}) { super(); }
  override getTile(x: number, y: number): TileKind { return this.tiles[`${x},${y}`] ?? 'grass'; }
}
function actor(id = 'a', x = 0, y = 0): Actor {
  return { id, x, y, kind: 'player', name: id, classId: 'mage', radius: 15, hp: 110, maxHp: 110, resource: 120, maxResource: 120, aim: 0, speed: 190, level: 1, xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
}
test('chunks are reproducible regardless of traversal order, including negative and distant coordinates', () => {
  const a = new World(72), b = new World(72);
  for (const [x, y] of [[0, 0], [-1, -2], [8712, -7211], [-31, 47]]) {
    a.getChunk(x + 1, y); b.getChunk(x - 1, y - 1);
    assert.deepEqual(a.getChunk(x, y), b.getChunk(x, y));
  }
  assert.notDeepEqual(a.getChunk(3, 4).tiles, new World(73).getChunk(3, 4).tiles);
  assert.deepEqual(chunkCoords(-1, -769), { cx: -1, cy: -2 });
});
test('terrain cache stays bounded and regeneration matches evicted chunks', () => {
  const world = new World(99, 5), first = world.getChunk(0, 0);
  for (let i = 1; i <= 100; i++) world.getChunk(i, -i);
  assert.equal(world.cacheSize, 5); assert.deepEqual(world.getChunk(0, 0), first);
});
test('generated NPCs and pickups are valid and spawn clearing and roads stay traversable', () => {
  const world = new World();
  for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) {
    const chunk = world.getChunk(x, y);
    assert.equal(chunk.tiles.length, 256);
    for (const spawn of [...chunk.npcs, ...chunk.pickups]) assert.equal(collidesWorld(spawn.x, spawn.y, 15, world), false);
  }
  for (let t = -500; t < 500; t++) { assert.equal(isSolid(world.getTile(0, t)), false); assert.equal(isSolid(world.getTile(t, 0)), false); }
  assert.equal(collidesWorld(0, 0, 15, world), false);
});
test('movement normalizes diagonals, slides along walls, and cannot tunnel during a dash', () => {
  const floor = new TestWorld(), start = { x: 20, y: 20, radius: 10 };
  const diagonal = moveWithCollisions(start, 1, 1, 100, floor);
  assert.ok(Math.abs(Math.hypot(diagonal.x - start.x, diagonal.y - start.y) - 100) < 1e-8);
  const wall = new TestWorld({ '1,0': 'rock', '1,1': 'rock', '1,2': 'rock' });
  const dash = moveWithCollisions(start, 1, 0, 300, wall); assert.ok(dash.x <= 38);
  const sliding = moveWithCollisions(start, 1, 1, 65, wall); assert.ok(sliding.x < 39); assert.ok(sliding.y > 50);
  assert.equal(collidesWorld(-2, -2, 5, new TestWorld({ '-1,-1': 'water' })), true);
});
test('projectile sweep catches targets between ticks and chooses earliest intersection', () => {
  assert.equal(segmentCircleHit({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0 }, 10), 0.4);
  assert.equal(segmentCircleHit({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 11 }, 10), null);
  assert.equal(segmentCircleHit({ x: 50, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 0 }, 10), 0);
});
test('line of sight rejects walls and diagonal corner cracks', () => {
  assert.equal(hasLineOfSight({ x: 10, y: 10 }, { x: 130, y: 10 }, new TestWorld({ '1,0': 'rock' })), false);
  assert.equal(hasLineOfSight({ x: 24, y: 24 }, { x: 72, y: 72 }, new TestWorld({ '1,0': 'rock' })), false);
  assert.equal(hasLineOfSight({ x: -24, y: -24 }, { x: 120, y: 120 }, new TestWorld()), true);
});
test('overlapping actors separate without entering world geometry', () => {
  const actors = [actor('a', 20, 20), actor('b', 20, 20)];
  const world = new TestWorld({ '1,0': 'rock' }); resolveActorCollisions(actors, world);
  assert.ok(Math.hypot(actors[0].x - actors[1].x, actors[0].y - actors[1].y) >= 29.9);
  for (const a of actors) assert.equal(collidesWorld(a.x, a.y, a.radius, world), false);
});
test('movement modifiers expire and dead actors cannot move', () => {
  const a = actor(); a.effects = [{ kind: 'haste', until: 2000 }, { kind: 'slow', until: 1000 }];
  assert.equal(movementSpeed(a, 500), 190 * 1.35 * 0.55); assert.equal(movementSpeed(a, 3000), 190);
  assert.equal(terrainSpeed(a, new TestWorld({ '0,0': 'mud' })), 0.65);
  a.hp = 0; assert.equal(movementSpeed(a, 500), 0);
});
test('reconciliation replays only unacknowledged inputs, once, from authoritative state', () => {
  const pending = [1, 2, 3].map(seq => ({ seq, dx: 1, dy: 0, aim: 0 }));
  const result = reconcile(actor(), 2, pending, new TestWorld(), 1000);
  assert.equal(result.pending.length, 1); assert.equal(result.pending[0].seq, 3);
  assert.ok(Math.abs(result.actor.x - 190 * DT) < 1e-8);
  const repeated = reconcile(actor(), 2, result.pending, new TestWorld(), 1000);
  assert.equal(repeated.actor.x, result.actor.x);
  assert.equal(reconcile(actor(), 3, pending, new TestWorld(), 1000).actor.x, 0);
});
test('remote interpolation uses shortest angular arc and never lerps a respawn teleport', () => {
  const a = actor(); a.aim = Math.PI - 0.1;
  const b = { ...a, x: 100, aim: -Math.PI + 0.1 };
  const middle = interpolateActors([a], [b], 0.5)[0]; assert.equal(middle.x, 50); assert.ok(Math.abs(middle.aim - Math.PI) < 1e-8);
  assert.equal(interpolateActors([a], [{ ...b, x: 1000 }], 0.5)[0].x, 1000);
});
