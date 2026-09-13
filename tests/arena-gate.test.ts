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

test('one player waits; two players stay a full second then enter one NPC-free arena', () => {
  const { manager, ids, enter } = setup();
  enter(0); advance(manager, 2);
  assert.equal(manager.gateStateFor(ids[0])!.phase, 'waiting');
  assert.equal(manager.rooms.size, 0);
  enter(1); manager.step(0.1);
  assert.equal(manager.snapshotFor(ids[0])!.arenaGate!.phase, 'countdown');
  advance(manager, 0.9);
  assert.equal(manager.rooms.size, 0);
  manager.step(0.1);
  assert.equal(manager.rooms.size, 1);
  assert.equal(manager.stateFor(ids[0]).id, manager.stateFor(ids[1]).id);
  const snapshot = manager.snapshotFor(ids[0])!;
  assert.equal(snapshot.actors.length, 2);
  assert.ok(snapshot.actors.every(actor => actor.kind === 'player'));
  assert.equal(snapshot.pickups.length, 0);
  assert.equal(snapshot.arenaGate, undefined);
  assert.ok(snapshot.matchEndsAt);
  assert.equal(snapshot.self.y, 0);
});

test('leaving even on the final tick cancels; reentry starts a new full second', () => {
  const { manager, ids, enter } = setup();
  enter(0); enter(1); manager.step(0.1); advance(manager, 0.9);
  manager.global.players.get(ids[1])!.x = 180;
  manager.step(0.1);
  assert.equal(manager.rooms.size, 0);
  assert.equal(manager.gateStateFor(ids[0])!.phase, 'waiting');
  enter(1); manager.step(0.1); advance(manager, 0.9);
  assert.equal(manager.rooms.size, 0);
  manager.step(0.1);
  assert.equal(manager.rooms.size, 1);
});

test('disconnection or renewed combat cancels pairing and cannot drag a third player in early', () => {
  const { manager, ids, enter } = setup(3);
  enter(0); enter(1); manager.step(0.1); advance(manager, 0.5);
  manager.disconnect(ids[1]); enter(2); manager.step(0.1);
  advance(manager, 0.5);
  assert.equal(manager.rooms.size, 0);
  manager.global.connections.get(ids[0])!.combatAt = manager.global.now;
  advance(manager, 1);
  assert.equal(manager.rooms.size, 0);
  assert.equal(manager.gateStateFor(ids[0])!.phase, 'combat');
});

test('return does not trigger an automatic rematch; both players must exit and reenter', () => {
  const { manager, ids, enter } = setup();
  enter(0); enter(1); advance(manager, 1.2);
  const room = manager.stateFor(ids[0]).id;
  manager.closeMatch(room);
  advance(manager, 12);
  assert.equal(manager.rooms.size, 0);
  assert.equal(manager.gateStateFor(ids[0])!.phase, 'reenter');
  for (const id of ids) manager.global.players.get(id)!.x = 180;
  manager.step(0.1); enter(0); enter(1); advance(manager, 1.2);
  assert.equal(manager.rooms.size, 1);
});

test('four players form separate 1v1s, never a larger match', () => {
  const { manager, ids, enter } = setup(4);
  for (let i = 0; i < 4; i++) enter(i);
  advance(manager, 2.5);
  assert.equal(manager.rooms.size, 2);
  for (const room of manager.rooms.values()) assert.equal(room.members.size, 2);
  assert.equal(new Set(ids.map(id => manager.stateFor(id).id)).size, 2);
});

test('same global team can duel as opponents and the original group is restored', () => {
  const { manager, ids, enter } = setup();
  manager.socialAction(ids[0], 'team-invite', ids[1]);
  manager.socialAction(ids[1], 'team-accept', ids[0]);
  const teamId = manager.global.players.get(ids[0])!.teamId;
  enter(0); enter(1); advance(manager, 1.2);
  const sim = manager.simulationFor(ids[0]);
  assert.notEqual(sim.players.get(ids[0])!.teamId, sim.players.get(ids[1])!.teamId);
  sim.players.get(ids[1])!.hp = 0;
  manager.step(0.1);
  assert.equal(manager.rooms.size, 0);
  assert.match(manager.takeNotice(ids[0])!, /Vittoria/);
  assert.equal(manager.takeNotice(ids[0]), undefined);
  assert.equal(manager.global.players.get(ids[0])!.teamId, teamId);
});

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
