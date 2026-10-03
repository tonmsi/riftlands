import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { OrderedSaveWriter, writeAtomic } from '../server/save-writer';
import { AccountStore } from '../server/store';
import { RoomManager } from '../server/rooms';
import type { GameplayPersistence } from '../server/gameplay-persistence';
import { TILE_SIZE } from '../shared/config';
import { shapeBounds } from '../shared/world-authoring';
import { collidesWorld } from '../shared/physics';
import { ARENA_GATE } from '../shared/arena';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function delayedWriter() {
  const writes: { path: string; json: string; done: ReturnType<typeof deferred> }[] = [];
  const writer = new OrderedSaveWriter(async (path, json) => {
    const done = deferred(); writes.push({ path, json, done }); await done.promise;
  });
  return { writer, writes };
}

test('disk writes stay sequential; only adjacent pending snapshots coalesce', async () => {
  const { writer, writes } = delayedWriter();
  const value = { revision: 1 };
  writer.write('accounts', value); value.revision = 999;
  await nextTurn();
  writer.write('accounts', { revision: 2 });
  const completionOrder: number[] = [];
  const olderBarrier = writer.drain().then(() => { completionOrder.push(2); });
  writer.write('accounts', { revision: 3 });
  const newerBarrier = writer.drain().then(() => { completionOrder.push(3); });
  writer.write('dungeon', { revision: 4 });
  writer.write('accounts', { revision: 5 });
  const all = writer.drain();
  assert.equal(writes.length, 1); assert.equal(JSON.parse(writes[0].json).revision, 1);
  writes[0].done.resolve(); await nextTurn();
  assert.deepEqual(writes.map(write => write.path), ['accounts', 'accounts']);
  assert.equal(JSON.parse(writes[1].json).revision, 3);
  let olderFinished = false; void olderBarrier.then(() => { olderFinished = true; });
  await nextTurn(); assert.equal(olderFinished, false);
  writes[1].done.resolve(); await Promise.all([olderBarrier, newerBarrier]); await nextTurn();
  assert.deepEqual(completionOrder, [2, 3], 'coalesced saves preserve confirmation order');
  assert.equal(writes[2].path, 'dungeon');
  writes[2].done.resolve(); await nextTurn();
  assert.equal(writes[3].path, 'accounts'); assert.equal(JSON.parse(writes[3].json).revision, 5);
  writes[3].done.resolve(); await all;
});

test('drain is a barrier for earlier requests and does not wait for later ones', async () => {
  const { writer, writes } = delayedWriter();
  writer.write('accounts', { revision: 1 }); await nextTurn();
  const barrier = writer.drain();
  writer.write('dungeon', { revision: 2 });
  writes[0].done.resolve(); await barrier; await nextTurn();
  assert.equal(writes.length, 2);
  writes[1].done.resolve(); await writer.drain();
});

test('a failed disk write rejects barriers, reports once and blocks later saves', async () => {
  const done = deferred(), reported: Error[] = [], paths: string[] = [];
  const writer = new OrderedSaveWriter(async path => { paths.push(path); await done.promise; throw new Error('disk unavailable'); });
  writer.onFailure(error => reported.push(error));
  writer.write('accounts', { revision: 1 }); writer.write('dungeon', { revision: 2 });
  const first = assert.rejects(writer.drain(), /accounts/), second = assert.rejects(writer.drain(), /accounts/);
  await nextTurn(); done.resolve(); await Promise.all([first, second]);
  assert.deepEqual(paths, ['accounts']); assert.equal(reported.length, 1);
  assert.match(String(reported[0].cause), /disk unavailable/);
  assert.throws(() => writer.write('accounts', {}), /accounts/);
  await assert.rejects(writer.drain(), /accounts/);
});

test('queue overload fails explicitly instead of keeping unbounded pending saves', async () => {
  const done = deferred(), paths: string[] = [];
  const writer = new OrderedSaveWriter(async path => { paths.push(path); await done.promise; }, 2);
  writer.write('active', {}); await nextTurn();
  writer.write('accounts', {}); writer.write('dungeon', {}); writer.write('dungeon', { latest: true });
  const rejected = assert.rejects(writer.drain(), /piena/);
  assert.throws(() => writer.write('third', {}), /piena/);
  let settled = false;
  const finalDrain = assert.rejects(writer.drain(), /piena/).then(() => { settled = true; });
  await nextTurn(); assert.equal(settled, false, 'shutdown must finish the in-flight replacement even after overload');
  done.resolve(); await rejected; await nextTurn();
  await finalDrain;
  assert.deepEqual(paths, ['active']); await assert.rejects(writer.drain(), /piena/);
});

test('atomic backend replaces valid JSON and cleans temporary files after rename failure', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-save-backend-'));
  try {
    const path = join(directory, 'accounts.json'); writeFileSync(path, '{"revision":1}');
    await writeAtomic(path, '{"revision":2}');
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { revision: 2 }); assert.equal(existsSync(`${path}.tmp`), false);
    const blocked = join(directory, 'blocked'); mkdirSync(blocked); writeFileSync(join(blocked, 'keep'), 'old data');
    await assert.rejects(writeAtomic(blocked, '{}'));
    assert.equal(readFileSync(join(blocked, 'keep'), 'utf8'), 'old data'); assert.equal(existsSync(`${blocked}.tmp`), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('live registration waits for the account file and persisted progress survives reload', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-async-store-'));
  const gate = deferred(), started = deferred();
  let delay = false;
  const writer = new OrderedSaveWriter(async (path, json) => {
    if (delay && path.endsWith('accounts.json')) { started.resolve(); await gate.promise; }
    await writeAtomic(path, json);
  });
  try {
    const path = join(directory, 'accounts.json'), store = new AccountStore(path, writer);
    await store.drain(); delay = true;
    let confirmed = false;
    const registration = store.registerAsync('Alice', 'test-password').then(result => { confirmed = true; return result; });
    await started.promise; assert.equal(confirmed, false); assert.equal(existsSync(path), false);
    gate.resolve(); const { account, token } = await registration;
    assert.equal(new AccountStore(path).verifyJwt(token)?.sub, account.id);
    account.xp = 78; account.gold = 42; account.inventory!.slots[0] = { itemId: 'slime-innards', quantity: 3 };
    store.touch(); store.flush(); await store.drain();
    const restored = new AccountStore(path).accounts.get(account.id)!;
    assert.equal(restored.xp, 78); assert.equal(restored.gold, 42); assert.deepEqual(restored.inventory, account.inventory);
  } finally { gate.resolve(); await writer.drain(); rmSync(directory, { recursive: true, force: true }); }
});

test('cancelled password work cannot register an account after shutdown begins', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-abort-auth-'));
  try {
    const store = new AccountStore(join(directory, 'accounts.json')), controller = new AbortController();
    const registering = store.registerAsync('Alice', 'test-password', controller.signal);
    controller.abort(); await assert.rejects(registering, { name: 'AbortError' });
    assert.equal(store.accounts.size, 0); assert.equal(existsSync(store.path), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('registration rejects instead of issuing a token when saving the account fails', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-register-failure-'));
  try {
    const writer = new OrderedSaveWriter(async (path, json) => {
      if (path.endsWith('accounts.json')) throw new Error('disk unavailable');
      await writeAtomic(path, json);
    });
    const store = new AccountStore(join(directory, 'accounts.json'), writer); await store.drain();
    await assert.rejects(store.registerAsync('Alice', 'test-password'), /Salvataggio fallito/);
    assert.equal(existsSync(store.path), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function pendingRoom() {
  const saved = deferred();
  let saveRequests = 0;
  const entries = ['alice', 'bruno'].map(id => ({ id, name: id, nameLower: id, salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 }));
  const persistence: GameplayPersistence = {
    accounts: new Map(entries.map(entry => [entry.id, entry])), bossStates: {},
    touch() {}, flush() { saveRequests++; }, flushBosses() {}, drain: () => saved.promise,
  };
  const rooms = new RoomManager(persistence, 734291, 1_000_000);
  entries.forEach(entry => rooms.connect(entry, 'mage')); rooms.global.now += 11_000;
  return { saved, entries, rooms, persistence, saveRequests: () => saveRequests };
}

test('arena entry waits for persistence and reserves players against duplicate requests', async () => {
  const { saved, rooms } = pendingRoom();
  const creating = rooms.createMatch('arena', [['alice'], ['bruno']]);
  assert.equal(rooms.rooms.size, 0); assert.equal(rooms.stateFor('alice').id, 'world');
  await assert.rejects(rooms.createMatch('arena', [['alice'], ['bruno']]), /duplicati/);
  saved.resolve(); const id = await creating;
  assert.equal(rooms.stateFor('alice').id, id); assert.equal(rooms.global.players.size, 0);
});

test('pending entry cancels on disconnect, renewed combat, reconnect or server shutdown', async () => {
  for (const reason of ['disconnect', 'combat', 'reconnect', 'shutdown']) {
    const { saved, rooms, entries } = pendingRoom();
    const creating = rooms.createMatch('arena', [['alice'], ['bruno']]);
    const rejected = assert.rejects(creating, /annullato/);
    if (reason === 'disconnect') rooms.disconnect('alice');
    else if (reason === 'combat') rooms.global.connections.get('alice')!.combatAt = rooms.global.now;
    else if (reason === 'reconnect') rooms.connect(entries[0], 'warrior');
    else rooms.stopTransfers();
    saved.resolve(); await rejected;
    assert.equal(rooms.rooms.size, 0); assert.equal(rooms.global.players.size, 2);
  }
});

test('failed return checkpoint leaves both players in the world and releases reservations', async () => {
  const { rooms, persistence } = pendingRoom();
  persistence.drain = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(rooms.createMatch('arena', [['alice'], ['bruno']]), /disk unavailable/);
  assert.equal(rooms.rooms.size, 0); assert.equal(rooms.global.players.size, 2);
  assert.equal(rooms.stateFor('alice').id, 'world');
  persistence.drain = async () => {};
  await rooms.createMatch('arena', [['alice'], ['bruno']]);
  assert.equal(rooms.rooms.size, 1);
});

test('leaving the authored arena gate while saving cancels entry even after immediate reentry', async () => {
  const { saved, rooms, saveRequests } = pendingRoom(), world = rooms.global.world;
  const zone = world.authoring.document.zones.find(zone => zone.arenaId)!;
  assert.ok(zone, 'current authored world needs an arena entrance');
  const bounds = shapeBounds(zone.shape), positions: { x: number; y: number }[] = [];
  for (let ty = Math.floor(bounds.top); ty <= bounds.bottom && positions.length < 2; ty++)
    for (let tx = Math.floor(bounds.left); tx <= bounds.right && positions.length < 2; tx++) {
      const point = { x: (tx + .5) * TILE_SIZE, y: (ty + .5) * TILE_SIZE };
      if (world.arenaAt(point.x, point.y) && !collidesWorld(point.x, point.y, 15, world)
        && positions.every(other => Math.hypot(other.x - point.x, other.y - point.y) > 32)) positions.push(point);
    }
  assert.equal(positions.length, 2);
  const alice = rooms.global.players.get('alice')!, outside = { x: alice.x, y: alice.y };
  assert.equal(world.arenaAt(outside.x, outside.y), undefined);
  Object.assign(alice, positions[0]); Object.assign(rooms.global.players.get('bruno')!, positions[1]);
  const countdownSteps = Math.ceil(ARENA_GATE.countdownMs * 30 / 1000) + 3;
  for (let i = 0; i < countdownSteps; i++) rooms.step();
  assert.equal(saveRequests(), 1, 'transfer is waiting for the requested save');
  assert.equal(rooms.rooms.size, 0); assert.equal(rooms.gateStateFor('alice')!.phase, 'countdown');
  Object.assign(alice, outside); rooms.step(); Object.assign(alice, positions[0]); rooms.step();
  saved.resolve(); await nextTurn(); assert.equal(rooms.rooms.size, 0);
  for (let i = 0; i < countdownSteps; i++) rooms.step();
  await nextTurn(); assert.equal(rooms.rooms.size, 1, JSON.stringify({ gate: rooms.gateStateFor('alice'), notice: rooms.takeNotice('alice') }));
});
