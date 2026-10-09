import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldSimulation } from '../server/simulation';
import { World } from '../shared/world';
import { newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { validateWorld } from '../shared/world-validation';
import { QUEST_DEFINITIONS, acceptQuest, questCompletions, newNarrativeProgress } from '../shared/narrative';
import { collidesWorld, hasLineOfSight } from '../shared/physics';
import { TILE_SIZE } from '../shared/config';
import type { Account } from '../server/store';

function fixture() {
  const document = newWorldDocument();
  document.npcs.push({ id: 'scout', npcKind: 'north-scout', x: 1, y: 1, level: 1 });
  document.zones.push({ id: 'road', name: 'Strada', priority: 1, shape: { kind: 'rect', x: 3, y: 0, width: 3, height: 3 }, questId: 'north-road' });
  const world = new World(document.seed, 16, 'world', document, []); world.getTile = () => 'grass';
  const getChunk = world.getChunk.bind(world);
  world.getChunk = (x, y) => ({ ...getChunk(x, y), npcs: x === 0 && y === 0 ? [{ id: 'authored:scout', npcKind: 'north-scout', x: 72, y: 72, level: 1 }] : [], pickups: [] });
  const sim = new WorldSimulation(document.seed, 1_000_000, undefined, 'world', { world, dungeons: [], bosses: new Map(), spawn: { x: 24, y: 72 } });
  const a: Account = { id: 'alice', name: 'Alice', nameLower: 'alice', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 };
  const player = sim.addPlayer(a, 'paladin'); sim.step(.01);
  const talk = () => { sim.interact(a.id, { kind: 'talk', targetId: 'authored:scout' }); return sim.interactions.view(a.id, sim.now)!; };
  const unlock = () => { a.narrative!.quests['stinking-bait'] = { status: 'completed', objectives: {}, completions: 1, completedAt: sim.now - 600_000 }; };
  const accept = () => { unlock(); const v = talk(); sim.interact(a.id, { kind: 'choose', sessionId: v.sessionId, choiceId: 'accept' }); sim.interactions.close(a.id); };
  return { sim, world, a, player, talk, unlock, accept };
}

test('scout offers an optional quest without requiring Nereo and remembers Nereo in the alternate dialogue', () => {
  const f = fixture(); assert.match(f.talk().text, /Un’altra Leggenda/);
  assert.equal(f.sim.interactions.marker(f.a.id, 'north-scout', f.sim.now), 'available');
  assert.ok(f.talk().choices.some(c => c.id === 'accept'));
  f.unlock(); assert.match(f.talk().text, /Nereo/);
  f.accept(); assert.equal(f.a.narrative!.quests['north-road'].status, 'active');
});

test('entering the linked area completes and rewards exactly once without kills, items or a return trip', () => {
  const f = fixture(); f.accept(); const xp = f.player.xp, bag = structuredClone(f.a.inventory);
  Object.assign(f.player, { x: 3 * TILE_SIZE - 1, y: 72 }); f.sim.step(.01);
  assert.equal(f.a.narrative!.quests['north-road'].status, 'active');
  Object.assign(f.player, { x: 3 * TILE_SIZE, y: 72 }); f.sim.step(.01);
  assert.equal(f.a.narrative!.quests['north-road'].status, 'completed');
  assert.equal(f.player.xp - xp, 100); assert.equal(f.player.kills, 0); assert.deepEqual(f.a.inventory, bag);
  f.sim.step(.01); f.sim.step(.01);
  assert.equal(questCompletions(f.a.narrative!.quests['north-road']), 1); assert.equal(f.player.xp - xp, 100);
  assert.equal(f.sim.snapshotFor(f.a.id)!.narrative!.quests['north-road'].status, 'completed');
});

test('visiting before accepting, visiting while dead, and visiting offline do not complete a quest', () => {
  const f = fixture(); Object.assign(f.player, { x: 168, y: 72 }); f.sim.step(.01);
  assert.equal(Object.hasOwn(f.a.narrative!.quests, 'north-road'), false);
  Object.assign(f.player, { x: 24, y: 72 }); f.accept();
  Object.assign(f.player, { x: 168, y: 72, hp: 0, deadUntil: f.sim.now + 60_000 }); f.sim.step(.01);
  assert.equal(f.a.narrative!.quests['north-road'].status, 'active');
  f.player.hp = f.player.maxHp; f.sim.connections.get(f.a.id)!.connected = false; f.sim.interactions.step(f.sim.now);
  assert.equal(f.a.narrative!.quests['north-road'].status, 'active');
});

test('moving the World Maker area moves the completion trigger, and overlapping areas cannot duplicate rewards', () => {
  const f = fixture(); f.accept();
  f.world.authoring.document.zones[0].shape = { kind: 'circle', x: 8, y: 2, radius: 1 };
  Object.assign(f.player, { x: 168, y: 72 }); f.sim.step(.01);
  assert.equal(f.a.narrative!.quests['north-road'].status, 'active');
  f.world.authoring.document.zones.push({ ...f.world.authoring.document.zones[0], id: 'duplicate' });
  const xp = f.player.xp; Object.assign(f.player, { x: 8 * TILE_SIZE, y: 2 * TILE_SIZE }); f.sim.step(.01);
  assert.equal(f.player.xp - xp, 100); assert.equal(questCompletions(f.a.narrative!.quests['north-road']), 1);
});

test('zone links survive parsing; invalid exploration links are reported by World Maker validation', () => {
  const f = fixture(); assert.equal(parseWorldDocument(f.world.authoring.document).zones[0].questId, 'north-road');
  f.world.authoring.document.zones[0].questId = 'stinking-bait';
  assert.ok(validateWorld(f.world.authoring.document, []).some(issue => issue.includes('missione di esplorazione')));
  const progress = newNarrativeProgress(); acceptQuest(progress, QUEST_DEFINITIONS['north-road']);
  assert.equal(progress.quests['north-road'].status, 'active');
});
