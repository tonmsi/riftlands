import test from 'node:test';
import assert from 'node:assert/strict';
import { MAZE_STALKER } from '../shared/bosses';
import { MAZE_DUNGEON, dungeonFlames, dungeonStoneTiles, insideDungeon } from '../shared/dungeons';
import { collidesWorld, moveWithCollisions } from '../shared/physics';
import { World, chunkCoords } from '../shared/world';
import { WorldSimulation } from '../server/simulation';
import type { Account } from '../server/store';
import type { Actor, Vec2 } from '../shared/types';

const account = (id: string): Account => ({ id, name: id, nameLower: id, salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 });
const advance = (simulation: WorldSimulation, seconds: number) => {
  for (let step = 0; step < Math.ceil(seconds * 10); step++) simulation.step(0.1);
};

function moveTo(actor: Actor, target: Vec2, world: World): void {
  const dx = target.x - actor.x, dy = target.y - actor.y, distance = Math.hypot(dx, dy);
  Object.assign(actor, moveWithCollisions(actor, dx, dy, distance, world));
  assert.ok(Math.hypot(actor.x - target.x, actor.y - target.y) < 1, `unreachable maze waypoint ${target.x},${target.y}`);
}

test('ashen maze is a traversable serpentine layout with a lockable inner sanctum', () => {
  const world = new World();
  assert.equal(world.getTile(75, 0), 'rock');
  assert.equal(world.getTile(75, 6), 'path');
  assert.equal(world.getTile(80, -6), 'path');
  assert.equal(world.getTile(80, 0), 'rock');
  assert.equal(world.getTile(85, 6), 'path');

  const explorer = { x: 3330, y: 24, radius: 15 } as Actor;
  for (const waypoint of [
    { x: 3550, y: 24 }, { x: 3550, y: 312 }, { x: 3700, y: 312 },
    { x: 3790, y: 312 }, { x: 3790, y: -216 }, { x: 3940, y: -216 },
    { x: 3940, y: 312 }, { x: 4160, y: 312 }, { x: 4160, y: 0 },
  ]) moveTo(explorer, waypoint, world);

  for (const tile of dungeonStoneTiles(MAZE_DUNGEON)) assert.equal(world.getTile(tile.x, tile.y), 'path');
  assert.deepEqual(dungeonFlames(MAZE_DUNGEON), [], 'a fully closed sanctum does not need flame guards');
  world.setBossLocked(MAZE_DUNGEON.bossId, true);
  for (const tile of dungeonStoneTiles(MAZE_DUNGEON)) assert.equal(world.getTile(tile.x, tile.y), 'rock');

  const center = chunkCoords(MAZE_DUNGEON.area.x, MAZE_DUNGEON.area.y);
  for (let cx = center.cx - 1; cx <= center.cx + 1; cx++) for (let cy = center.cy - 1; cy <= center.cy + 1; cy++) {
    for (const spawn of [...world.getChunk(cx, cy).npcs, ...world.getChunk(cx, cy).pickups]) {
      assert.equal(insideDungeon(MAZE_DUNGEON, spawn, MAZE_DUNGEON.spawnExclusionMargin), false);
    }
  }
});

test('maze boss uses its own nearest-target and distance-aware combat behavior', () => {
  const simulation = new WorldSimulation(734291, 1_000_000);
  const a = simulation.addPlayer(account('maze-a'), 'warrior');
  const b = simulation.addPlayer(account('maze-b'), 'mage');
  simulation.socialAction(a.id, 'team-invite', b.id);
  simulation.socialAction(b.id, 'team-accept', a.id);
  const spawn = MAZE_DUNGEON.spawnPoints.boss;
  Object.assign(a, { x: spawn.x, y: spawn.y - 60, spawnProtectedUntil: 0 });
  Object.assign(b, { x: spawn.x, y: spawn.y + 60, spawnProtectedUntil: 0 });
  simulation.step(0.1);
  advance(simulation, MAZE_DUNGEON.encounter.preparationMs / 1000 + 0.1);

  const encounter = simulation.bosses.get(MAZE_STALKER.id)!;
  assert.equal(encounter.ownerId, a.id);
  Object.assign(a, { x: spawn.x, y: spawn.y + 155, hp: a.maxHp });
  Object.assign(b, { x: spawn.x, y: spawn.y + 70, hp: b.maxHp });
  encounter.recordDamage(a.id, 10_000);
  simulation.step(0.1);
  assert.equal(encounter.targetId, b.id, 'nearest targeting ignores the distant participant with more threat');

  Object.assign(b, { x: spawn.x, y: spawn.y + 250, hp: b.maxHp });
  advance(simulation, 0.7);
  assert.equal(encounter.windup?.kind, 'charge', 'distance-aware pattern opens with a corridor charge');
  assert.equal(MAZE_STALKER.skin, 'maze-stalker', 'an unknown skin exercises the procedural renderer fallback');
});
