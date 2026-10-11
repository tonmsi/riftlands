import { INSTALLED_DUNGEON_DEFINITIONS as DUNGEON_DEFINITIONS } from '../shared/dungeons';
import test from 'node:test';
import assert from 'node:assert/strict';
import { newDungeonDraft, parseDungeonDraft, compileDungeonDraft, draftFromDungeon } from '../shared/dungeon-draft';
import { roomShapeIssues } from '../shared/dungeon-rooms';
import { relocateDungeon } from '../shared/dungeon-relocation';
import { newWorldDocument } from '../shared/world-schema';
import { World } from '../shared/world';
import { collidesWorld, hasLineOfSight, moveWithCollisions } from '../shared/physics';
import { sweptWorldHit } from '../shared/projectiles';
import { WorldSimulation } from '../server/simulation';
import { RoomManager } from '../server/rooms';
import { warpPosition } from '../shared/warps';

function fixture() {
  const draft = newDungeonDraft(); draft.origin = { x: 0, y: 0 };
  draft.entities = [{ id: 'boss', kind: 'boss', template: '', label: 'Boss', x: 18, y: 12, level: 1, radius: 36 }];
  draft.rooms = [{ id: 'library', name: 'Biblioteca', tiles: [] }];
  for (let y = 3; y <= 8; y++) for (let x = 3; x <= 8; x++) if (x <= 5 || y >= 6) draft.rooms[0].tiles.push({ x, y });
  const definition = compileDungeonDraft(draft).definition;
  const document = newWorldDocument(); document.spawn = { x: 4, y: 4 };
  const world = new World(document.seed, 16, 'world', document, [definition]);
  return { draft, definition, document, world };
}
test('free room masks survive draft compilation, import and relocation without affecting terrain', () => {
  const { draft, definition } = fixture();
  assert.deepEqual(parseDungeonDraft(JSON.stringify(draft)).rooms, draft.rooms);
  assert.deepEqual(draftFromDungeon(definition).rooms, draft.rooms);
  const moved = relocateDungeon(definition, { x: -12, y: 20 });
  assert.deepEqual(moved.rooms![0].tiles[0], { x: -9, y: 23 });
  const duplicate = structuredClone(draft); duplicate.rooms!.push({ ...duplicate.rooms![0], id: 'other' });
  assert.throws(() => parseDungeonDraft(JSON.stringify(duplicate)));
  assert.equal(roomShapeIssues([{ id: 'a', name: 'A', tiles: [{ x: 1, y: 1 }, { x: 9, y: 9 }] }]).length, 1);
});
test('room boundaries block walking, sliding, sight, projectiles and dashes in both directions', () => {
  const { world } = fixture(), inside = { ...warpPosition({ x: 4, y: 4 }), radius: 15 }, outside = { ...warpPosition({ x: 7, y: 4 }), radius: 15 };
  assert.equal(world.sameRoom(inside, outside), false); assert.equal(hasLineOfSight(inside, outside, world), false);
  assert.equal(collidesWorld(inside.x, inside.y, 15, world), false);
  const moved = moveWithCollisions(inside, 1, 0, 300, world); assert.equal(world.sameRoom(inside, moved), true);
  const back = moveWithCollisions(outside, -1, 0, 300, world); assert.equal(world.sameRoom(outside, back), true);
  assert.notEqual(sweptWorldHit(inside, outside, 7, world), null);
  assert.equal(world.roomAt(...Object.values(warpPosition({ x: 7, y: 7 })) as [number, number]), 'nuovo-dungeon:library');
});
test('snapshots hide teammates and contents in other rooms and reveal them after a warp', () => {
  const { definition, document, world } = fixture();
  const simulation = new WorldSimulation(document.seed, 10000, undefined, 'world', { world, spawn: warpPosition(document.spawn), dungeons: [], bosses: new Map() });
  const account = (id: string) => ({ id, name: id, nameLower: id, salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 });
  const a = simulation.addPlayer(account('a'), 'warrior'), b = simulation.addPlayer(account('b'), 'warrior');
  Object.assign(a, warpPosition({ x: 4, y: 4 }), { teamId: 'team' }); Object.assign(b, warpPosition({ x: 7, y: 4 }), { teamId: 'team' });
  simulation.pickups.set('outside', { id: 'outside', ...warpPosition({ x: 9, y: 4 }), radius: 12, kind: 'heal' });
  assert.equal(simulation.snapshotFor('a')!.actors.some(actor => actor.id === 'b'), false); assert.equal(simulation.snapshotFor('a')!.pickups.length, 0);
  Object.assign(a, warpPosition({ x: 8, y: 4 })); simulation.step(.05);
  assert.equal(simulation.snapshotFor('a')!.actors.some(actor => actor.id === 'b'), true);
  assert.equal(simulation.snapshotFor('a')!.pickups.some(p => p.id === 'outside'), true);
  // Isolate the fixture from installed authoring maps and their collision masks.
  document.dungeons = DUNGEON_DEFINITIONS.map(d=>({dungeonId:d.id,x:0,y:0,enabled:false}));
  document.warps = [{ id: 'room-door', name: 'Biblioteca → comune', from: 'world', to: 'world', entry: { x: 4, y: 4 }, arrival: { x: 7, y: 4 }, activation: 'interact' }];
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) document.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  document.spawn = { x: 10, y: 10 };
  const manager = new RoomManager(undefined, document.seed, 10000, document);
  for (const [tile, room] of world.roomTiles) manager.global.world.roomTiles.set(tile, room);
  manager.global.world.rooms.push(...world.rooms); manager.connect(account('traveler'), 'warrior');
  manager.step(.05);
  Object.assign(manager.simulationFor('traveler').players.get('traveler')!, warpPosition({ x: 4, y: 4 }));
  const state = manager.stateFor('traveler'); manager.interact('traveler', { kind: 'warp', warpId: 'room-door' }, state.id, state.epoch);
  for (let i = 0; i < 12; i++) manager.step(.05);
  const actor = manager.simulationFor('traveler').players.get('traveler')!; assert.equal(manager.simulationFor('traveler').world.roomAt(actor.x, actor.y), '');
});
