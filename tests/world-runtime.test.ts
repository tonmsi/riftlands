import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorldDocument, newWorldAsset } from '../shared/world-schema';
import { World } from '../shared/world';
import { TILE_SIZE } from '../shared/config';
import { relocateForWorldChange, worldSpawn } from '../server/world-runtime';
import { RoomManager } from '../server/rooms';
import type { Account } from '../server/store';
import { INSTALLED_DUNGEON_DEFINITIONS } from '../shared/dungeons';
import type { GameplayPersistence } from '../server/gameplay-persistence';
import { newInterior } from '../shared/warps';

function document() {
  const d = newWorldDocument();
  for (let y = -6; y <= 15; y++) for (let x = -6; x <= 15; x++) d.tiles.push({ x, y, terrain: 'grass' });
  d.spawn = { x: 8, y: 8 };
  d.dungeons = INSTALLED_DUNGEON_DEFINITIONS.map(d => ({ dungeonId: d.id, x: 0, y: 0, enabled: false }));
  return d;
}
const world = (d: ReturnType<typeof document>) => new World(d.seed, 16, 'world', d, []);
const player = () => ({ x: 2.5 * TILE_SIZE, y: 2.5 * TILE_SIZE, elevation: 0, surfaceId: 'terrain' });
const account = (id: string): Account => ({ id, name: id, nameLower: id, salt: 'a'.repeat(32), passwordHash: 'b'.repeat(128), xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 });

test('runtime publication leaves a player on unchanged terrain, including biome/NPC and neighboring obstacle changes', () => {
  const before = document(), after = document(), actor = player();
  after.zones.push({ id: 'biome', name: 'Bosco', priority: 0, shape: { kind: 'circle', x: 2, y: 2, radius: 5 }, temperature: .2 });
  after.npcs.push({ id: 'monster', npcKind: 'slime', x: 5, y: 5, level: 1 });
  after.tiles.find(t => t.x === 3 && t.y === 2)!.terrain = 'rock';
  assert.equal(relocateForWorldChange(actor, world(before), world(after)), false);
  assert.deepEqual(actor, player());
});

test('walkable tile changes preserve X/Y; changed positive and zero heights update the floor', () => {
  const before = document(), after = document(), actor = player();
  after.tiles.find(t => t.x === 2 && t.y === 2)!.terrain = 'mud';
  assert.equal(relocateForWorldChange(actor, world(before), world(after)), false);
  after.geometry = { surfaces: [{ id: 'raised', x: 2, y: 2, width: 1, height: 1, ground: true, elevation: 2, terrain: 'grass' }], solids: [], stairs: [] };
  assert.equal(relocateForWorldChange(actor, world(before), world(after)), true);
  assert.equal(actor.elevation, 2); assert.equal(actor.x, player().x); assert.equal(actor.y, player().y);
  assert.equal(relocateForWorldChange(actor, world(after), world(before)), true);
  assert.equal(actor.elevation, 0); assert.equal(actor.x, player().x);
});

test('a newly negative floor or rock sends the player to the NEW first-entry spawn', () => {
  for (const kind of ['negative', 'rock', 'asset'] as const) {
    const before = document(), after = document(), actor = player();
    after.spawn = { x: 10, y: 10 };
    if (kind === 'negative') after.geometry = { surfaces: [{ id: 'pit', x: 2, y: 2, width: 1, height: 1, ground: true, elevation: -1, terrain: 'grass' }], solids: [], stairs: [] };
    if (kind === 'rock') after.tiles.find(t => t.x === 2 && t.y === 2)!.terrain = 'rock';
    if (kind === 'asset') {
      const a = newWorldAsset('wall', 'Wall', '/world-assets/wall.svg'); a.cells[0].blocked = true;
      after.assets.push(a); after.placements.push({ id: 'wall', assetId: a.id, x: 2, y: 2 });
    }
    const next = world(after);
    assert.equal(relocateForWorldChange(actor, world(before), next), true, kind);
    assert.equal(actor.x, worldSpawn(next).x, kind); assert.equal(actor.y, worldSpawn(next).y, kind);
    assert.equal(actor.elevation, 0, kind);
  }
});

test('an unchanged negative floor is left alone and a suspended deck preserves its supported level', () => {
  const d = document(); d.geometry = { surfaces: [{ id: 'pit', x: 2, y: 2, width: 1, height: 1, ground: true, elevation: -1, terrain: 'grass' }], solids: [], stairs: [] };
  const actor = { ...player(), elevation: -1 };
  assert.equal(relocateForWorldChange(actor, world(d), world(structuredClone(d))), false);
  d.geometry.surfaces.push({ id: 'bridge', x: 2, y: 2, width: 1, height: 1, elevation: 2, terrain: 'grass' });
  actor.elevation = 2;
  const next = structuredClone(d); next.geometry!.surfaces[0].elevation = -2;
  assert.equal(relocateForWorldChange(actor, world(d), world(next)), false);
  assert.equal(actor.elevation, 2);
});

test('room publication preserves live actors and progression, updates collision hosts and advances input epochs', () => {
  const before = document();
  const rooms = new RoomManager(undefined, before.seed, 1_000_000, before);
  const a = account('alice'), actor = rooms.connect(a, 'mage'); Object.assign(actor, player());
  const epoch = rooms.stateFor(a.id).epoch, ref = rooms.global.world;
  const next = structuredClone(before); next.spawn = { x: 10, y: 10 };
  next.tiles.find(t => t.x === 2 && t.y === 2)!.terrain = 'rock';
  rooms.applyProject(next, rooms.prepareProject(next));
  assert.equal(rooms.global.players.get(a.id), actor);
  assert.equal(rooms.global.world, ref, 'interaction and fishing systems retain the updated World reference');
  assert.equal(actor.x, 10 * TILE_SIZE); assert.equal(actor.y, 10 * TILE_SIZE);
  assert.equal(a.body!.x, actor.x); assert.equal(actor.hp, actor.maxHp);
  assert.ok(rooms.stateFor(a.id).epoch > epoch);
  assert.equal(rooms.global.world.getTile(2, 2), 'rock');
  assert.equal(rooms.global.snapshotFor(a.id)!.self.x, actor.x);
});

test('offline positions, interior floors and return checkpoints use the new geometry and spawn', () => {
  const d = document(), a = account('offline');
  const interior = newInterior('house', 'Casa', 16, 16); interior.document = document(); interior.document.spawn = { x: 8, y: 8 };
  d.interiors = [interior];
  const store: GameplayPersistence = { accounts: new Map([[a.id, a]]), bossStates: {}, touch() {}, flush() {}, flushBosses() {}, async drain() {} };
  const first = new RoomManager(store, d.seed, 1_000_000, d);
  Object.assign(first.connect(a, 'mage'), player()); first.checkpoint();
  a.location = { mapId: 'house', returnTo: player() };
  const offline = new RoomManager(store, d.seed, 1_000_001, d), next = structuredClone(d);
  next.spawn = { x: 10, y: 10 };
  next.tiles.find(t => t.x === 2 && t.y === 2)!.terrain = 'rock';
  next.interiors![0].document.geometry = { surfaces: [{ id: 'raised', x: 2, y: 2, width: 1, height: 1, ground: true, terrain: 'grass', elevation: 2 }], solids: [], stairs: [] };
  offline.applyProject(next, offline.prepareProject(next));
  assert.equal(a.body!.x, player().x); assert.equal(a.body!.elevation, 2);
  assert.equal(a.location!.returnTo.x, 10 * TILE_SIZE);
  const removed = structuredClone(next); removed.interiors = []; removed.spawn = { x: 12, y: 12 };
  offline.applyProject(removed, offline.prepareProject(removed));
  assert.equal(a.location, undefined); assert.equal(a.body!.x, 12 * TILE_SIZE);
});

test('removing an occupied interior sends its connected player to the new global first-entry spawn', () => {
  const d = document(), interior = newInterior('house', 'Casa', 16, 16);
  interior.document = document(); d.interiors = [interior];
  const rooms = new RoomManager(undefined, d.seed, 1_000_000, d), a = account('indoors');
  a.location = { mapId: 'house', returnTo: player() };
  rooms.connect(a, 'mage'); assert.equal(rooms.stateFor(a.id).mapId, 'house');
  const next = structuredClone(d); next.interiors = []; next.spawn = { x: 12, y: 12 };
  rooms.applyProject(next, rooms.prepareProject(next));
  assert.equal(rooms.stateFor(a.id).id, 'world');
  assert.equal(rooms.global.players.get(a.id)!.x, 12 * TILE_SIZE);
  assert.equal(a.location, undefined);
});

test('publication rejects a blocked or negative first-entry spawn before changing live state', () => {
  const d = document(), rooms = new RoomManager(undefined, d.seed, 1_000_000, d), next = structuredClone(d);
  next.tiles.find(t => t.x === 8 && t.y === 8)!.terrain = 'rock';
  assert.throws(() => rooms.prepareProject(next), /Spawn non calpestabile/);
  assert.equal(rooms.project, d);
});

test('a publication away from the player preserves movement input, room epoch and the actor instance', () => {
  const d = document(), rooms = new RoomManager(undefined, d.seed, 1_000_000, d), a = account('unchanged');
  const actor = rooms.connect(a, 'mage'); Object.assign(actor, player());
  const state = rooms.stateFor(a.id);
  assert.equal(rooms.enqueueInput(a.id, { seq: 1, dx: 1, dy: 0, aim: 0 }, state.id, state.epoch), true);
  const input = rooms.global.connections.get(a.id)!.inputs[0];
  const next = structuredClone(d); next.tiles.find(t => t.x === 14 && t.y === 14)!.terrain = 'rock';
  const changed = rooms.applyProject(next, rooms.prepareProject(next));
  assert.equal(changed.has(a.id), false);
  assert.equal(rooms.stateFor(a.id).epoch, state.epoch);
  assert.equal(rooms.global.connections.get(a.id)!.inputs[0], input);
  assert.equal(rooms.global.players.get(a.id), actor);
  assert.equal(actor.x, player().x);
});
