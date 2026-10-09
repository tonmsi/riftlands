import { relocateDungeon } from '../shared/dungeon-relocation';
import { collidesWorld, moveWithCollisions, hasLineOfSight } from '../shared/physics';
import { roomBrush, roomRectangle } from '../shared/dungeon-room-editing';
import { dungeonRoomContains, dungeonRoomAt } from '../shared/dungeon-topology';
import test from 'node:test';
import assert from 'node:assert/strict';
import { newDungeonDraft, parseDungeonDraft, serializeDungeonDraft } from '../shared/dungeon-draft';
import { buildDungeonBundle } from '../shared/dungeon-install';
import { BOSS_TEMPLATES } from '../shared/boss-templates';
import { registerEngineBundle } from './fixtures/dungeon-engine';
import { DungeonInstanceWorld } from '../shared/dungeon-instance';
import { dungeonShadowVisible, topologyPosition } from '../shared/dungeon-topology';
import { RoomManager } from '../server/rooms';
import { TILE_SIZE } from '../shared/config';
import { createDungeonPlaytest } from '../client/editors/dungeon/dungeon-playtest';
import type { Account } from '../server/store';

function fixture() {
  const draft = newDungeonDraft(32, 18); draft.id = 'topology-test'; draft.origin = { x: 256, y: 256 };
  draft.encounters = [{ id: 'first', name: 'Primo', x: 0, y: 0, width: 14, height: 18 }, { id: 'second', name: 'Secondo', x: 18, y: 0, width: 14, height: 18 }];
  draft.entities = [7, 25].map((x, i) => ({ id: `boss-${i}`, kind: 'boss' as const, template: BOSS_TEMPLATES[0].id, label: 'Boss', x, y: 10, radius: 28, level: 1, aggroRadius: 48, encounterId: i ? 'second' : 'first' }));
  draft.topology = { entry: { x: 3, y: 3 }, exit: { x: 28, y: 3 }, worldExit: { x: 0, y: 0 },
    rooms: [{ id: 'first', name: 'Ingresso', floor: 0, x: 0, y: 0, width: 14, height: 18 }, { id: 'second', name: 'Profondità', floor: -1, x: 18, y: 0, width: 14, height: 18 }],
    warps: [{ id: 'down', from: { x: 8, y: 3 }, to: { x: 20, y: 3 } }, { id: 'up', from: { x: 20, y: 3 }, to: { x: 8, y: 3 } }],
    shadows: [{ x: 19, y: 6, width: 11, height: 10, revealRadius: 2 }] };
  const bundle = buildDungeonBundle(draft, [], { checkPlacement: false });
  return { draft, bundle };
}
test('multiple floors, warp reachability and world exit survive draft serialization', () => {
  const { draft, bundle } = fixture();
  assert.deepEqual(parseDungeonDraft(serializeDungeonDraft(draft)).topology, draft.topology);
  assert.deepEqual(bundle.definition.topology, draft.topology);
  const world = new DungeonInstanceWorld(bundle.definition);
  assert.equal(world.getTile(256 + 16, 256 + 3), 'rock');
  assert.equal(world.getTile(256 + 20, 256 + 3), 'path');
  assert.equal(world.pvpAt(0, 0), false);
  const malformed = structuredClone(draft); malformed.topology!.rooms[1].x = 10;
  assert.throws(() => parseDungeonDraft(JSON.stringify(malformed)), /non validi/);
  const disconnected = structuredClone(draft); disconnected.topology!.warps = [];
  assert.throws(() => buildDungeonBundle(disconnected, [], { checkPlacement: false }), /raggiungibile/);
});
test('shadow visibility reveals nearby content and conceals it again at a distance', () => {
  const { draft } = fixture(), t = draft.topology!, origin = draft.origin;
  const target = topologyPosition(origin, { x: 25, y: 10 });
  assert.equal(dungeonShadowVisible(t, origin, target, target), true);
  assert.equal(dungeonShadowVisible(t, origin, topologyPosition(origin, t.entry), target), false);
});
test('an L-shaped room roundtrips and its cut-out is solid void for movement and visibility', () => {
  const { draft } = fixture(), room = draft.topology!.rooms[0];
  for (let y=0;y<=6;y++) roomBrush(draft,room.id,{x:9,y},{x:13,y},true);
  assert.equal(dungeonRoomContains(room,10,3),false);
  assert.equal(dungeonRoomContains(room,10,9),true);
  assert.deepEqual(parseDungeonDraft(serializeDungeonDraft(draft)).topology!.rooms[0].tiles,room.tiles);
  const bundle=buildDungeonBundle(draft,[],{checkPlacement:false}), world=new DungeonInstanceWorld(bundle.definition);
  assert.equal(world.getTile(266,259),'rock');
  assert.equal(dungeonRoomAt(bundle.definition.topology!,draft.origin,topologyPosition(draft.origin,{x:10,y:3})),undefined);
  const actor={...topologyPosition(draft.origin,{x:8,y:3}),radius:15};
  const moved=moveWithCollisions(actor,1,0,100,world);
  assert.ok(moved.x < (draft.origin.x+9)*TILE_SIZE);
  assert.equal(hasLineOfSight(actor,topologyPosition(draft.origin,{x:10,y:3}),world),false);
  roomBrush(draft,room.id,{x:10,y:3},{x:10,y:3},false);
  assert.equal(dungeonRoomContains(room,10,3),true);
});
test('a new floor automatically allocates separate storage and preserves existing terrain', () => {
  const draft=newDungeonDraft(24,18);
  draft.topology={entry:{x:3,y:3},exit:{x:4,y:3},rooms:[{id:'old',name:'Old',floor:0,x:0,y:0,width:24,height:18}],warps:[],shadows:[]};
  const terrain=[...draft.tiles];
  const room=roomRectangle(draft,{x:2,y:2},{x:7,y:7},-1);
  assert.equal(room.floor,-1); assert.equal(room.width,6); assert.equal(room.height,6);
  assert.ok(room.x>=24||room.y>=18);
  for(let y=0;y<18;y++)for(let x=0;x<24;x++)assert.equal(draft.tiles[y*draft.width+x],terrain[y*24+x]);
  assert.doesNotThrow(()=>parseDungeonDraft(serializeDungeonDraft(draft)));
});
test('touching rooms on different floors cannot be entered by walking or seen through', () => {
  const { bundle }=fixture(), t=bundle.definition.topology!;
  t.rooms[0]={id:'a',name:'A',floor:0,x:0,y:0,width:16,height:18};
  t.rooms[1]={id:'b',name:'B',floor:-1,x:16,y:0,width:16,height:18};
  const world=new DungeonInstanceWorld(bundle.definition), actor={...topologyPosition({x:256,y:256},{x:15,y:3}),radius:15};
  const moved=moveWithCollisions(actor,1,0,100,world);
  assert.ok(moved.x<(256+16)*TILE_SIZE);
  assert.equal(hasLineOfSight(actor,topologyPosition({x:256,y:256},{x:16,y:3}),world),false);
});
test('instant PvE transfer uses arena epochs, warps floors and exits to a different world point', async () => {
  const { bundle } = fixture(), cleanup = registerEngineBundle(bundle);
  // Register the second encounter as well for authority construction.
  const { BOSS_BY_ID } = await import('../shared/bosses');
  BOSS_BY_ID.set(bundle.bosses[1].id, bundle.bosses[1]);
  try {
    const manager = new RoomManager(undefined, 734291, 1_000_000);
    const account: Account = { id: 'traveler', name: 'Traveler', nameLower: 'traveler', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0, gold: 0 };
    manager.connect(account, 'warrior');
    for (let i = 0; i < 110; i++) manager.step(.1);
    Object.assign(manager.global.players.get(account.id)!, bundle.definition.area);
    const oldEpoch = manager.stateFor(account.id).epoch;
    await manager.enterDungeon(account.id, bundle.definition.id);
    assert.equal(manager.stateFor(account.id).dungeonId, bundle.definition.id);
    assert.ok(manager.stateFor(account.id).epoch > oldEpoch);
    const room = manager.rooms.get(`dungeon:${bundle.definition.id}`)!;
    assert.equal(room.startsAt, undefined);
    assert.equal(manager.global.players.has(account.id), false);
    const actor = room.simulation.players.get(account.id)!;
    const origin = { x: 256, y: 256 }, t = bundle.definition.topology!;
    assert.deepEqual({ x: actor.x, y: actor.y }, topologyPosition(origin, t.entry));
    for (let i = 0; i < 15; i++) manager.step(.1);
    const activeBoss = room.simulation.bosses.get(bundle.bosses[0].id)!;
    activeBoss.ownerId = actor.id; activeBoss.participantIds.add(actor.id);
    actor.hp = actor.maxHp = 10000;
    Object.assign(actor, topologyPosition(origin, t.warps[0].from)); manager.step(.1);
    assert.ok(actor.hp > 0, 'using a warp during a boss fight must not kill the player');
    assert.equal(activeBoss.isActiveParticipant(actor.id), false);
    assert.equal(activeBoss.ownerId, undefined);
    assert.deepEqual({ x: actor.x, y: actor.y }, topologyPosition(origin, t.warps[0].to));
    assert.equal(manager.snapshotFor(account.id)!.actors.some(a => a.id === bundle.bosses[0].id), false);
    for (let i = 0; i < 15; i++) manager.step(.1);
    assert.deepEqual({ x: actor.x, y: actor.y }, topologyPosition(origin, t.warps[0].to));
    room.simulation.awardXp(account.id, 25);
    // Pick a guaranteed walkable destination, distinct from the entrance.
    let destination = { x: 0, y: 0 };
    for (let x = 0; x < 40; x++) if (!collidesWorld((x+.5)*TILE_SIZE,.5*TILE_SIZE,actor.radius,manager.global.world)) { destination = { x, y: 0 }; break; }
    t.worldExit = destination;
    Object.assign(actor, topologyPosition(origin, t.exit));
    room.simulation.accounts.get(account.id)!.gold = 77;
    manager.step(.1);
    assert.equal(manager.stateFor(account.id).id, 'world', JSON.stringify({ notice: manager.takeNotice(account.id), position: { x: actor.x, y: actor.y }, exit: topologyPosition(origin, t.exit), now: manager.global.now }));
    const returned = manager.global.players.get(account.id)!;
    assert.deepEqual({ x: returned.x, y: returned.y }, topologyPosition({ x: 0, y: 0 }, destination));
    assert.equal(account.gold, 77);
    assert.equal(account.characters!.warrior!.xp, 25);
    assert.equal(manager.takeMatchResult(account.id), undefined);
  } finally { cleanup(); BOSS_BY_ID.delete(bundle.bosses[1].id); }
});
test('offline playtest enters a closed room directly and traverses its warp', () => {
  const { draft } = fixture(), preview = createDungeonPlaytest(draft);
  const origin = { x: 256, y: 256 };
  assert.deepEqual({ x: preview.player.x, y: preview.player.y }, topologyPosition(origin, draft.topology!.entry));
  const input = { dx: 0, dy: 0, aim: 0, attack: false };
  for (let i = 0; i < 15; i++) preview.step(.1, input);
  Object.assign(preview.player, topologyPosition(origin, draft.topology!.warps[0].from));
  preview.step(.1, input);
  assert.equal(preview.player.x, topologyPosition(origin, draft.topology!.warps[0].to).x);
});

 test('isolated portal placement centers on the clicked world tile and keeps an independent exit', () => {
  const { bundle } = fixture();
  const placement = { x: 133, y: 30, worldExit: { x: 142, y: 32 } };
  const moved = relocateDungeon(bundle.definition, placement);
  assert.deepEqual(moved.layout.bounds, bundle.definition.layout.bounds);
  assert.equal(moved.area.x, (placement.x + .5) * TILE_SIZE);
  assert.equal(moved.area.y, (placement.y + .5) * TILE_SIZE);
  assert.deepEqual(moved.topology?.worldExit, placement.worldExit);
  assert.deepEqual(moved.topology?.entry, bundle.definition.topology?.entry);
  const again = relocateDungeon(moved, { x: -20, y: 10 });
  assert.equal(again.area.x, -19.5 * TILE_SIZE);
  assert.deepEqual(again.topology?.worldExit, placement.worldExit);
 });
