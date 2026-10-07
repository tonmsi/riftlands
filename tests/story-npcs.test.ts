import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldSimulation } from '../server/simulation';
import { World } from '../shared/world';
import { newWorldDocument } from '../shared/world-schema';
import { NPC_DEFINITIONS } from '../shared/npcs';
import { VENDOR_DEFINITIONS } from '../shared/vendors';
import { validNarrativeProgress } from '../shared/narrative';
import { collidesWorld } from '../shared/physics';
import { canTalkToNpc } from '../client/core/npc-interaction';
import type { Account } from '../server/store';

function fixture() {
  const doc = newWorldDocument();
  doc.npcs = [{ id: 'soldier', npcKind: 'wounded-scout', x: 1, y: 1, level: 1 }, { id: 'platos', npcKind: 'platos', x: 9, y: 1, level: 1 }];
  doc.zones = [{ id: 'platos-area', name: 'Platos', priority: 1, shape: { kind: 'circle', x: 9.5, y: 1.5, radius: 2 }, questId: 'find-platos' }];
  const world = new World(doc.seed, 16, 'world', doc, []); world.getTile = () => 'grass';
  const original = world.getChunk.bind(world);
  world.getChunk = (x, y) => ({ ...original(x, y), pickups: [], npcs: x === 0 && y === 0 ? doc.npcs.map(n => ({ ...n, id: 'authored:' + n.id, x: (n.x + .5) * 48, y: (n.y + .5) * 48 })) : [] });
  const sim = new WorldSimulation(doc.seed, 1_000_000, undefined, 'world', { world, spawn: { x: 24, y: 72 }, dungeons: [], bosses: new Map() });
  const account: Account = { id: 'alice', name: 'Alice', nameLower: 'alice', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 };
  const player = sim.addPlayer(account, 'paladin'); sim.step(.01);
  const talk = (id: string) => {
    const npc = sim.npcs.get('authored:' + id)!; Object.assign(player, { x: npc.x - 40, y: npc.y });
    sim.interact(player.id, { kind: 'talk', targetId: npc.id }); return sim.interactions.view(player.id, sim.now)!;
  };
  const choose = (id: string) => { const view = sim.interactions.view(player.id, sim.now)!; sim.interact(player.id, { kind: 'choose', sessionId: view.sessionId, choiceId: id }); return sim.interactions.view(player.id, sim.now); };
  return { sim, world, account, player, talk, choose };
}

test('wounded soldier offers Platos independently of previous quests, with provision advice and an arrival objective', () => {
  const f = fixture(); assert.match(f.talk('soldier').text, /non gli ho dato retta/);
  assert.match(f.choose('platos')!.text, /provviste/); f.choose('accept');
  assert.equal(f.account.narrative!.quests['find-platos'].status, 'active');
  f.sim.interactions.close(f.player.id); Object.assign(f.player, { x: 9.5 * 48, y: 1.5 * 48 }); f.sim.step(.01);
  assert.equal(f.account.narrative!.quests['find-platos'].status, 'completed'); assert.equal(f.player.xp, 150);
  assert.match(f.talk('soldier').text, /Sono stato ferito/); assert.doesNotMatch(f.talk('soldier').text, /Platos|provviste/);
});

test('meeting Platos directly is remembered without silently accepting or rewarding the skipped quest', () => {
  const f = fixture(); const v = f.talk('platos'); assert.match(v.text, /curiosità/);
  assert.deepEqual(f.account.narrative!.flags, ['met-platos']); assert.deepEqual(f.account.narrative!.quests, {});
  assert.equal(f.player.xp, 0); assert.match(f.choose('stones')!.text, /Warden/);
  const soldier = f.talk('soldier'); assert.match(soldier.text, /Vengo da nord/);
  assert.doesNotMatch(soldier.text, /Platos/); assert.deepEqual(soldier.choices.map(c => c.id), ['leave']);
  assert.equal(f.sim.interactions.marker(f.player.id, 'wounded-scout', f.sim.now), undefined);
  f.talk('platos'); assert.equal(f.account.narrative!.flags!.length, 1);
  const restored = JSON.parse(JSON.stringify(f.account.narrative)); assert.ok(validNarrativeProgress(restored));
  assert.deepEqual(restored.flags, ['met-platos']);
  const snapshot = f.sim.snapshotFor(f.player.id)!; assert.deepEqual(snapshot.narrative!.flags, ['met-platos']);
  assert.ok(Object.isFrozen(snapshot.narrative!.flags));
});

test('remote talk cannot mark Platos as met, and story flags remain personal', () => {
  const f = fixture(); assert.throws(() => f.sim.interact(f.player.id, { kind: 'talk', targetId: 'authored:platos' }));
  assert.equal(f.account.narrative!.flags, undefined); f.talk('platos');
  const bob: Account = { ...f.account, id: 'bob', name: 'Bob', nameLower: 'bob', narrative: undefined, characters: undefined };
  const other = f.sim.addPlayer(bob, 'mage'); const npc = f.sim.npcs.get('authored:soldier')!; Object.assign(other, { x: npc.x - 40, y: npc.y });
  f.sim.interact(other.id, { kind: 'talk', targetId: npc.id });
  assert.match(f.sim.interactions.view(other.id, f.sim.now)!.text, /Platos/);
  assert.equal(bob.narrative?.flags, undefined);
  assert.equal(validNarrativeProgress({ version: 1, quests: {}, flags: ['invalid flag'] }), false);
});

test('every neutral NPC except vendors moves and pauses inside its authored radius', () => {
  const doc = newWorldDocument(); const neutral = Object.entries(NPC_DEFINITIONS).filter(([, n]) => n.disposition === 'neutral');
  const world = new World(doc.seed, 16, 'world', doc, []); world.getTile = () => 'grass';
  const original = world.getChunk.bind(world);
  world.getChunk = (x, y) => ({ ...original(x, y), pickups: [], npcs: x === 0 && y === 0 ? neutral.map(([kind], i) => ({ id: kind, npcKind: kind as keyof typeof NPC_DEFINITIONS, x: 24 + i * 100, y: 24, level: 1 })) : [] });
  const sim = new WorldSimulation(doc.seed, 1_000_000, undefined, 'world', { world, spawn: { x: 24, y: 100 }, dungeons: [], bosses: new Map() });
  sim.addPlayer({ id: 'walker', name: 'Walker', nameLower: 'walker', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 }, 'paladin'); sim.step(.01);
  const moved = new Set<string>(), paused = new Set<string>();
  for (let i = 0; i < 300; i++) {
    sim.step(.1);
    for (const [id, spec] of neutral) {
      const npc = sim.npcs.get(id)!, home = sim.npcMeta.get(id)!.home;
      if (spec.dialogueId && VENDOR_DEFINITIONS[spec.dialogueId]) { assert.equal(npc.x, home.x); assert.equal(npc.y, home.y); continue; }
      assert.ok(spec.speed > 0 && spec.behavior); assert.ok(Math.hypot(npc.x - home.x, npc.y - home.y) <= spec.behavior!.radius + .01);
      if (npc.spriteMoving) moved.add(id); else paused.add(id);
    }
  }
  for (const [id, spec] of neutral) if (!spec.dialogueId || !VENDOR_DEFINITIONS[spec.dialogueId]) { assert.ok(moved.has(id), id); assert.ok(paused.has(id), id); }
});

test('NPC interaction opens dialogue only within range and line of sight', () => {
  const f = fixture(), npc = { ...f.sim.npcs.get('authored:soldier')!, x: 72, y: 72 };
  assert.equal(canTalkToNpc({ ...f.player, x: npc.x - 145 }, npc, f.world), false);
  assert.equal(canTalkToNpc({ ...f.player, x: npc.x - 144 }, npc, f.world), true);
  assert.equal(canTalkToNpc({ ...f.player, hp: 0 }, npc, f.world), false);
  f.world.getTile = (x) => x === 0 ? 'rock' : 'grass';
  assert.equal(canTalkToNpc(f.player, npc, f.world), false);
});

test('soldier and Platos are authored on walkable cells', () => {
  const world = new World();
  for (const kind of ['wounded-scout', 'platos']) {
    const n = world.authoring.document.npcs.find(n => n.npcKind === kind)!;
    assert.ok(n); assert.equal(collidesWorld((n.x + .5) * 48, (n.y + .5) * 48, 18, world), false);
  }
});
