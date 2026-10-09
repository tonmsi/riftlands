import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms';
import type { Account } from '../server/store';
import { ARENA_GATE } from '../shared/arena';
import { World } from '../shared/world';
import { hasLineOfSight, moveWithCollisions } from '../shared/physics';

function setup(count = 2) {
  const manager = new RoomManager(undefined, 734291, 1_000_000);
  const ids = Array.from({ length: count }, (_, i) => `duelist${i}`);
  const accounts: Account[] = ids.map(id => ({ id, name: id, nameLower: id, salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 }));
  for (const account of accounts) manager.connect(account, 'mage');
  advance(manager, 11);
  const enter = (index: number) => Object.assign(manager.global.players.get(ids[index])!, { x: -50 + index * 35, y: ARENA_GATE.y });
  return { manager, ids, accounts, enter };
}
function advance(manager: RoomManager, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) manager.step(0.1);
}

test('pillars block movement and shots, maps are mirrored and contain no NPCs or pickups', () => {
  const world = new World(734291, 160, 'arena');
  for (let y = -8; y <= 7; y++) for (let x = -10; x <= 9; x++) assert.equal(world.getTile(x, y), world.getTile(-x - 1, -y - 1));
  assert.equal(world.getTile(-3, -3), 'rock');
  assert.equal(hasLineOfSight({ x: -200, y: -144 }, { x: 200, y: -144 }, world), false);
  const moved = moveWithCollisions({ x: -200, y: -144, radius: 15 }, 1, 0, 120, world);
  assert.ok(moved.x <= -159);
  for (let cx = -1; cx <= 1; cx++) for (let cy = -1; cy <= 1; cy++) {
    assert.equal(world.getChunk(cx, cy).npcs.length, 0);
    assert.equal(world.getChunk(cx, cy).pickups.length, 0);
  }
});
