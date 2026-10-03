import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotEncoder, SnapshotDecoder, type SnapshotPacket } from '../shared/snapshot-stream';
import { projectActor } from '../shared/snapshot-actor';
import { SnapshotBuffer } from '../client/snapshots';
import { WorldSimulation } from '../server/simulation';
import type { Actor, Snapshot } from '../shared/types';
import { SnapshotPrivateState } from '../server/snapshot-private-state';
import type { Account } from '../server/store';

const room = { id: 'world', epoch: 1 };
function actor(id: string, x = 0): Actor {
  return { id, x, y: 0, kind: 'player', name: id, classId: 'mage', radius: 15, hp: 110, maxHp: 110,
    resource: 120, maxResource: 120, aim: 0, speed: 190, level: 1, xp: 0, kills: 0, deaths: 0,
    teamId: null, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0,
    effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
}
function frame(): Snapshot {
  const self = actor('self');
  return { type: 'snapshot', tick: 1, time: 1000, ack: 0, self, actors: [self, actor('other', 200)],
    projectiles: [], pickups: [], events: [], online: 2, activeChunks: 1, gold: 10,
    inventory: { version: 1, capacity: 1, slots: [null] }, narrative: { version: 1, quests: {} } };
}
const wire = (packet: SnapshotPacket): SnapshotPacket => JSON.parse(JSON.stringify(packet));
function deliver(encoder: SnapshotEncoder, decoder: SnapshotDecoder, snapshot: Snapshot, identity = room) {
  const prepared = encoder.prepare(snapshot, identity);
  const decoded = decoder.decode(wire(prepared.packet)); prepared.commit();
  return { decoded, packet: prepared.packet };
}

test('network projection excludes server-only properties and detaches mutable state', () => {
  const source = Object.assign(actor('self'), { serverSecret: 'private', futureField: 42 });
  const projected = projectActor(source);
  assert.equal('serverSecret' in projected, false); assert.equal('futureField' in projected, false);
  source.cooldowns.q = 999; source.effects.push({ kind: 'root', until: 2000 });
  assert.equal(projected.cooldowns.q, 0); assert.deepEqual(projected.effects, []);
});

test('private snapshot views are detached, reused until changed and isolated per player', () => {
  const cache = new SnapshotPrivateState();
  const account = { inventory: frame().inventory, narrative: frame().narrative } as Account;
  const first = cache.read('a', account), same = cache.read('a', account);
  assert.deepEqual(Object.keys(first).sort(), ['inventory', 'narrative']);
  assert.equal(first.inventory, same.inventory); assert.equal(first.narrative, same.narrative);
  account.inventory!.slots[0] = { itemId: 'slime-innards', quantity: 4 };
  account.narrative!.quests['quest'] = { status: 'active', objectives: {} }; account.narrative!.revision = 1;
  const changed = cache.read('a', account);
  assert.deepEqual(first.inventory.slots, [null]); assert.deepEqual(first.narrative.quests, {});
  assert.equal(changed.inventory.slots[0]!.quantity, 4); assert.equal(changed.narrative.quests['quest'].status, 'active');
  assert.deepEqual(cache.read('b').inventory.slots, [null]);
  assert.throws(() => { changed.inventory.slots[0]!.quantity = 999; }, TypeError);
  cache.prune(new Map()); assert.notEqual(cache.read('a', account).inventory, changed.inventory);
});

test('keyframes reconstruct complete actors; unchanged metadata and private data are omitted', () => {
  const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder(), snapshot = frame();
  const first = deliver(encoder, decoder, snapshot);
  assert.deepEqual(first.decoded, snapshot); assert.equal(first.packet.base, null);
  assert.equal(first.packet.actorUpdates.some(update => update.id === 'self'), false);
  const second = deliver(encoder, decoder, { ...snapshot, tick: 2, time: 1067 });
  assert.deepEqual(second.packet.actorUpdates, []);
  assert.equal(Object.hasOwn(second.packet, 'inventory'), false);
  assert.equal(Object.hasOwn(second.packet, 'narrative'), false);
  assert.equal(Object.hasOwn(second.packet, 'gold'), false);
  assert.deepEqual(second.decoded.inventory, snapshot.inventory); assert.equal(second.decoded.gold, 10);
  assert.equal(second.decoded.narrative, undefined);
});

test('movement, cooldowns, effects, class and optional field removal survive JSON deltas', () => {
  const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder(), snapshot = frame();
  const remote = snapshot.actors[1]; remote.questMarker = 'active'; remote.dialogueId = 'old-fisher'; remote.spriteMoving = true;
  const first = deliver(encoder, decoder, snapshot).decoded;
  remote.x = 220; remote.hp = 95; remote.classId = 'warrior'; remote.cooldowns.q = 3000;
  remote.effects = [{ kind: 'slow', until: 5000 }]; delete remote.questMarker; delete remote.dialogueId; delete remote.spriteMoving;
  const result = deliver(encoder, decoder, snapshot);
  assert.deepEqual(result.decoded.actors[1], remote);
  assert.equal(result.packet.actorUpdates[0].metadata?.classId, 'warrior');
  assert.ok(result.packet.actorUpdates[0].clear?.includes('questMarker'));
  assert.equal(first.actors[1].x, 200); assert.equal(first.actors[1].cooldowns.q, 0);
  // Consumer changes must not corrupt the decoder's private baseline.
  result.decoded.actors[1].cooldowns.q = -1;
  assert.equal(deliver(encoder, decoder, snapshot).decoded.actors[1].cooldowns.q, 3000);
});

test('actors leave interest and reenter with full metadata; reused identifiers do not retain fields', () => {
  const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder(), snapshot = frame();
  deliver(encoder, decoder, snapshot);
  const result = deliver(encoder, decoder, { ...snapshot, actors: [snapshot.self] });
  assert.deepEqual(result.packet.removedActors, ['other']); assert.equal(result.decoded.actors.length, 1);
  snapshot.actors[1] = { ...actor('other', 450), name: 'New actor' };
  assert.deepEqual(deliver(encoder, decoder, snapshot).decoded.actors[1], snapshot.actors[1]);
});

test('unsent packets do not advance actor, inventory or narrative baselines', () => {
  const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder(), snapshot = frame();
  deliver(encoder, decoder, snapshot);
  snapshot.actors[1].x = 250; snapshot.inventory!.slots[0] = { itemId: 'slime-innards', quantity: 3 };
  snapshot.narrative!.revision = 1;
  const unsent = encoder.prepare(snapshot, room);
  snapshot.actors[1].x = 270; snapshot.inventory!.slots[0]!.quantity = 4;
  const delivered = deliver(encoder, decoder, snapshot);
  assert.equal(delivered.packet.sequence, 2); assert.equal(delivered.decoded.actors[1].x, 270);
  assert.equal(delivered.decoded.inventory!.slots[0]!.quantity, 4);
  assert.equal(delivered.decoded.narrative!.revision, 1);
  assert.equal(unsent.packet.inventory!.slots[0]!.quantity, 3);
  assert.throws(unsent.commit, /baseline already advanced/);
});

test('room epoch and reconnect force full state; stale room packets are rejected', () => {
  const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder(), snapshot = frame();
  const first = deliver(encoder, decoder, snapshot);
  const arena = { id: 'match', epoch: 2 }; decoder.reset(arena);
  assert.throws(() => decoder.decode(wire(first.packet)), /another room/);
  const switched = deliver(encoder, decoder, snapshot, arena);
  assert.equal(switched.packet.base, null); assert.deepEqual(switched.decoded, snapshot);
  const reconnect = new SnapshotEncoder(); decoder.reset(arena);
  assert.equal(deliver(reconnect, decoder, snapshot, arena).packet.sequence, 1);
});

test('missing baseline is rejected and the periodic keyframe restores all state', () => {
  const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder(), snapshot = frame();
  deliver(encoder, decoder, snapshot);
  const lost = encoder.prepare(snapshot, room); lost.commit();
  const next = encoder.prepare(snapshot, room); assert.throws(() => decoder.decode(wire(next.packet)), /baseline unavailable/); next.commit();
  for (let i = 3; i < 75; i++) { const prepared = encoder.prepare(snapshot, room); prepared.commit(); }
  const recovered = deliver(encoder, decoder, snapshot);
  assert.equal(recovered.packet.base, null); assert.deepEqual(recovered.decoded, snapshot);
});

test('128 moving actors use materially less payload than complete snapshots', () => {
  const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder(), snapshot = frame();
  snapshot.actors = [snapshot.self, ...Array.from({ length: 127 }, (_, i) => actor(`remote-${i}`, i * 20))];
  deliver(encoder, decoder, snapshot);
  for (const actor of snapshot.actors) { actor.x += 5; actor.y += 2; }
  const result = deliver(encoder, decoder, snapshot);
  assert.ok(JSON.stringify(result.packet).length < JSON.stringify(snapshot).length * .25);
  assert.deepEqual(result.decoded.actors, snapshot.actors);
});

test('decoded frames feed interpolation without changing previous buffered state', () => {
  const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder(), snapshot = frame(), buffer = new SnapshotBuffer();
  buffer.push(deliver(encoder, decoder, snapshot).decoded, 0);
  snapshot.time += 67; snapshot.actors[1].x += 20;
  buffer.push(deliver(encoder, decoder, snapshot).decoded, 67);
  const result = buffer.sample(80)!;
  assert.ok(result.actors.find(a => a.id === 'other')!.x >= 200);
  assert.ok(result.actors.find(a => a.id === 'other')!.x <= 220);
});

test('interest selection preserves corpses and distant teammates, filters hidden enemies and events', () => {
  const sim = new WorldSimulation(734291, 1_000_000, undefined, 'battleground');
  for (const id of ['self', 'corpse', 'hidden', 'ally', 'far']) sim.addPlayer({ id, name: id, nameLower: id, salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 }, 'mage');
  Object.assign(sim.players.get('self')!, { x: 0, y: 0, teamId: 'party' });
  Object.assign(sim.players.get('corpse')!, { x: 250, y: 0, hp: 0 });
  Object.assign(sim.players.get('hidden')!, { x: 350, y: 0, hidden: true });
  Object.assign(sim.players.get('ally')!, { x: 9000, y: 0, teamId: 'party' });
  Object.assign(sim.players.get('far')!, { x: 6000, y: 0 });
  sim.npcs.set('npc-ally', { ...actor('npc-ally', 9000), kind: 'npc', teamId: 'party' });
  sim.events.push({ id: 'private-cast', kind: 'cast', actorId: 'hidden', x: 350, y: 0, at: sim.now, duration: 500, radius: 10, color: '#fff' });
  const result = sim.snapshotFor('self')!;
  assert.deepEqual(new Set(result.actors.map(a => a.id)), new Set(['self', 'corpse', 'ally', 'npc-ally']));
  assert.equal(result.events.length, 0);
});
