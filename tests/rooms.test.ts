import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RoomManager } from '../server/rooms';
import { AccountStore, type Account } from '../server/store';
import { World } from '../shared/world';

const account = (id: string): Account => ({ id, name: id, nameLower: id, salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 });
function setup(count = 4) {
  const manager = new RoomManager(undefined, 734291, 1_000_000);
  const accounts = Array.from({ length: count }, (_, i) => account(`player${i}`));
  for (const entry of accounts) manager.connect(entry, 'mage');
  advance(manager, 11);
  return { manager, accounts, ids: accounts.map(entry => entry.id) };
}
function advance(manager: RoomManager, seconds: number) {
  for (let i = 0; i < seconds * 10; i++) manager.step(0.1);
}

test('rooms isolate actors and terrain; transfers remove owned projectiles and old bodies', () => {
  const { manager, ids } = setup();
  const old = manager.stateFor(ids[0]);
  manager.global.projectiles.set('old-shot', { id: 'old-shot', ownerId: ids[0], x: 0, y: 0, vx: 1, vy: 0, radius: 5, damage: 5, expiresAt: manager.global.now + 1000, color: '#fff' });
  assert.ok(manager.global.projectiles.size);
  const a = manager.createMatch('arena', [[ids[0]], [ids[1]]]);
  const b = manager.createMatch('battleground', [[ids[2]], [ids[3]]]);
  assert.equal(manager.global.players.size, 0);
  assert.equal(manager.global.projectiles.size, 0);
  assert.deepEqual(manager.rooms.get(a)!.simulation.snapshotFor(ids[0])!.actors.map(actor => actor.id).sort(), ids.slice(0, 2));
  assert.ok(manager.rooms.get(b)!.simulation.players.has(ids[2]));
  assert.equal(manager.rooms.get(a)!.simulation.npcs.size, 0);
  assert.equal(manager.rooms.get(a)!.simulation.pickups.size, 0);
  const sim = manager.simulationFor(ids[0]);
  assert.equal(manager.enqueueInput(ids[0], { seq: 1, dx: 1, dy: 0, aim: 0 }, old.id, old.epoch), true);
  assert.equal(sim.connections.get(ids[0])!.inputs.length, 0);
  const current = manager.stateFor(ids[0]);
  manager.enqueueInput(ids[0], { seq: 1, dx: 1, dy: 0, aim: 0 }, current.id, current.epoch);
  assert.equal(sim.connections.get(ids[0])!.inputs.length, 1);
  for (const mode of ['arena', 'battleground'] as const) {
    const world = new World(734291, 160, mode);
    assert.equal(world.getTile(0, 0), 'grass');
    assert.equal(world.getTile(30, 0), 'rock');
    assert.deepEqual(world.getChunk(0, 0).npcs, []);
    assert.deepEqual(world.getChunk(0, 0).pickups, []);
  }
});

test('network reconnect resumes exact match body and locked class with a new input epoch', () => {
  const { manager, ids, accounts } = setup(2);
  const roomId = manager.createMatch('arena', [[ids[0]], [ids[1]]]);
  const sim = manager.simulationFor(ids[0]), actor = sim.players.get(ids[0])!;
  actor.hp = 43;
  actor.resource = 12;
  actor.cooldowns.q = sim.now + 30_000;
  const epoch = manager.stateFor(ids[0]).epoch;
  manager.disconnect(ids[0]);
  advance(manager, 1);
  const reconnected = manager.connect(accounts[0], 'warrior');
  assert.equal(reconnected, actor);
  assert.equal(actor.classId, 'mage');
  assert.equal(actor.hp, 43);
  assert.equal(actor.cooldowns.q, sim.now + 29_000);
  assert.equal(manager.stateFor(ids[0]).id, roomId);
  assert.ok(manager.stateFor(ids[0]).epoch > epoch);
});

test('voluntary exit abandons immediately; network grace lasts 20 seconds and then closes an empty team', () => {
  const voluntary = setup(2);
  const id = voluntary.manager.createMatch('arena', [[voluntary.ids[0]], [voluntary.ids[1]]]);
  voluntary.manager.disconnect(voluntary.ids[0], true);
  assert.equal(voluntary.manager.rooms.get(id)!.members.has(voluntary.ids[0]), false);
  voluntary.manager.step();
  assert.equal(voluntary.manager.rooms.size, 0);
  assert.equal(voluntary.manager.stateFor(voluntary.ids[1]).id, 'world');
  voluntary.manager.connect(voluntary.accounts[0], 'mage');
  assert.equal(voluntary.manager.stateFor(voluntary.ids[0]).id, 'world');

  const { manager, ids, accounts } = setup(2);
  manager.createMatch('battleground', [[ids[0]], [ids[1]]]);
  manager.disconnect(ids[0]);
  advance(manager, 19);
  assert.equal(manager.rooms.size, 1);
  advance(manager, 2);
  assert.equal(manager.rooms.size, 0);
  manager.connect(accounts[0], 'mage');
  assert.equal(manager.stateFor(ids[0]).id, 'world');
});

test('match progress is temporary and return restores global health, position and cooldowns', () => {
  const { manager, ids, accounts } = setup(2);
  const original = manager.global.players.get(ids[0])!;
  original.hp = 37;
  original.cooldowns.q = manager.global.now + 60_000;
  const before = structuredClone(original);
  const room = manager.createMatch('arena', [[ids[0]], [ids[1]]]);
  Object.assign(manager.simulationFor(ids[0]).players.get(ids[0])!, { hp: 1, xp: 9999, kills: 100, x: 400 });
  manager.simulationFor(ids[0]).checkpoint();
  manager.checkpoint();
  assert.equal(accounts[0].xp, before.xp);
  assert.equal(accounts[0].body!.hp, before.hp);
  manager.closeMatch(room);
  const restored = manager.global.players.get(ids[0])!;
  assert.equal(restored.hp, before.hp);
  assert.equal(restored.x, before.x);
  assert.equal(restored.cooldowns.q, before.cooldowns.q);
  assert.equal(restored.kills, before.kills);
  assert.equal(manager.global.awayPlayers.size, 0);
  manager.closeMatch(room); // Idempotent closure.
});

test('arena elimination closes the instance; BG respawns and expires at its deadline', () => {
  const arena = setup(2);
  arena.manager.createMatch('arena', [[arena.ids[0]], [arena.ids[1]]]);
  arena.manager.simulationFor(arena.ids[0]).players.get(arena.ids[0])!.hp = 0;
  arena.manager.step();
  assert.equal(arena.manager.rooms.size, 0);
  const { manager, ids } = setup(2);
  const id = manager.createMatch('battleground', [[ids[0]], [ids[1]]], 10);
  const sim = manager.simulationFor(ids[1]), actor = sim.players.get(ids[1])!;
  actor.hp = 0;
  actor.deadUntil = sim.now + 1000;
  advance(manager, 2);
  assert.equal(actor.hp, actor.maxHp);
  assert.equal(actor.x, 700);
  advance(manager, 9);
  assert.equal(manager.rooms.has(id), false);
  assert.equal(manager.global.players.size, 2);
});

test('invalid rosters, dead players, combat and duplicate memberships fail without partial transfer', () => {
  const { manager, ids } = setup(2);
  assert.throws(() => manager.createMatch('arena', [[ids[0]], [ids[0]]]));
  assert.throws(() => manager.createMatch('arena', [[ids[0]], ['missing']]));
  manager.global.players.get(ids[0])!.hp = 0;
  assert.throws(() => manager.createMatch('arena', [[ids[0]], [ids[1]]]));
  manager.global.players.get(ids[0])!.hp = 50;
  manager.global.connections.get(ids[0])!.combatAt = manager.global.now;
  assert.throws(() => manager.createMatch('arena', [[ids[0]], [ids[1]]]));
  assert.equal(manager.global.players.size, 2);
  assert.equal(manager.rooms.size, 0);
});

test('global logout retains the vulnerable body for the existing grace period', () => {
  const { manager, ids, accounts } = setup(2);
  const body = manager.global.players.get(ids[0]);
  manager.disconnect(ids[0], true);
  assert.equal(manager.global.players.get(ids[0]), body);
  advance(manager, 1);
  assert.equal(manager.connect(accounts[0], 'mage'), body);
  manager.disconnect(ids[0]);
  advance(manager, 21);
  assert.equal(manager.global.players.has(ids[0]), false);
});

test('parties survive instance absence, retain online presence and cannot change match teams', () => {
  const { manager, ids } = setup(2);
  manager.socialAction(ids[0], 'team-invite', ids[1]);
  manager.socialAction(ids[1], 'team-accept', ids[0]);
  const teamId = manager.global.players.get(ids[0])!.teamId;
  const room = manager.createMatch('arena', [[ids[0]], [ids[1]]]);
  advance(manager, 16);
  assert.equal(manager.socialFor(ids[0]).team!.members.every(member => member.online), true);
  assert.throws(() => manager.socialAction(ids[0], 'team-leave'));
  manager.closeMatch(room);
  assert.equal(manager.global.players.get(ids[0])!.teamId, teamId);
});

test('return slots are reserved while players are in matches', () => {
  const { manager, ids } = setup(2);
  const room = manager.createMatch('arena', [[ids[0]], [ids[1]]]);
  // Populate the capacity accounting without running 128 clients.
  for (let i = 0; i < 126; i++) manager.global.awayPlayers.add(`reserved${i}`);
  assert.throws(() => manager.connect(account('overflow'), 'mage'));
  manager.closeMatch(room);
  assert.equal(manager.global.players.size, 2);
});

test('restart restores global return data, never match coordinates or temporary XP', () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-rooms-'));
  try {
    const path = join(directory, 'accounts.json'), store = new AccountStore(path);
    const a = store.register('Alice', 'test-password').account;
    const b = store.register('Bruno', 'test-password').account;
    const manager = new RoomManager(store);
    manager.connect(a, 'mage'); manager.connect(b, 'mage'); advance(manager, 11);
    const x = manager.global.players.get(a.id)!.x;
    manager.createMatch('arena', [[a.id], [b.id]]);
    manager.simulationFor(a.id).players.get(a.id)!.xp = 9000;
    manager.checkpoint(); store.flush();
    const restoredStore = new AccountStore(path), restarted = new RoomManager(restoredStore);
    const player = restarted.connect(restoredStore.accounts.get(a.id)!, 'mage');
    assert.equal(player.x, x);
    assert.equal(player.xp, 0);
    assert.equal(restarted.stateFor(a.id).id, 'world');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
