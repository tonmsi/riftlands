import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldSimulation } from '../server/simulation';
import { World } from '../shared/world';
import { newWorldDocument } from '../shared/world-schema';
import { CLASSES, TILE_SIZE } from '../shared/config';
import { SOUL_QUEST_ID, SOUL_HEALTH_MULTIPLIER, SOUL_FAREWELL_MS } from '../shared/soul-escort';
import { ACTOR_CATALOG } from '../shared/actor-catalog';
import type { Account } from '../server/store';

function fixture(destination = true) {
  const doc = newWorldDocument();
  doc.npcs.push({ id: 'soul-guide', npcKind: 'fallen-soldier', x: 2, y: 0, level: 1 });
  if (destination) doc.zones.push({ id: 'home', name: 'Casa dei soldati', priority: 1,
    shape: { kind: 'rect', x: 6, y: 0, width: 2, height: 2 }, questId: SOUL_QUEST_ID });
  const world = new World(doc.seed, 16, 'world', doc, []); world.getTile = () => 'grass';
  const chunk = world.getChunk.bind(world);
  world.getChunk = (x, y) => ({ ...chunk(x, y), npcs: x === 0 && y === 0 ? [{ id: 'authored:soul-guide', npcKind: 'fallen-soldier', x: 120, y: 24, level: 1 }] : [], pickups: [] });
  const environment = { world, dungeons: [], bosses: new Map(), spawn: { x: 24, y: 24 } };
  const sim = new WorldSimulation(doc.seed, 1_000_000, undefined, 'world', environment);
  const account: Account = { id: 'escort', name: 'Viaggiatore', nameLower: 'viaggiatore', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 };
  const player = sim.addPlayer(account, 'mage'); Object.assign(player, { x: 72, y: 24, spawnProtectedUntil: 0 }); sim.step(.01);
  const talk = () => { sim.interact(player.id, { kind: 'talk', targetId: 'authored:soul-guide' }); return sim.interactions.view(player.id, sim.now)!; };
  const accept = () => { const v = talk(); sim.interact(player.id, { kind: 'choose', sessionId: v.sessionId, choiceId: 'accept' }); return v; };
  return { sim, world, doc, environment, account, player, talk, accept };
}

test('fallen soldier is stationary, has static artwork, and only accepts an escort with an authored destination', () => {
  const f = fixture(false); const npc = f.sim.npcs.get('authored:soul-guide')!;
  assert.match(f.talk().text, /Uccidimi/);
  assert.throws(f.accept, /luogo di riposo/);
  assert.equal(f.account.narrative!.quests[SOUL_QUEST_ID], undefined);
  assert.equal(f.player.maxHp, CLASSES.mage.maxHp);
  for (let i = 0; i < 60; i++) f.sim.step(.1);
  assert.equal(npc.x, 120); assert.equal(npc.y, 24); assert.equal(npc.spriteMoving, false);
  const visual = ACTOR_CATALOG.skins[ACTOR_CATALOG.npcSkins!['fallen-soldier']!];
  assert.equal(visual.animations.idle.columns, 1); assert.equal(visual.animations.idle.loop, false);
});

test('acceptance closes dialogue, grants map and applies one health bonus without healing away damage or stacking', () => {
  const f = fixture(); f.player.hp = f.player.maxHp / 2;
  const accepted = f.accept();
  assert.equal(f.sim.interactions.view(f.player.id, f.sim.now), null);
  assert.ok(f.account.narrative!.flags!.includes('world-map'));
  const maxHp = Math.round(CLASSES.mage.maxHp * SOUL_HEALTH_MULTIPLIER);
  assert.equal(f.player.maxHp, maxHp); assert.equal(f.player.hp, maxHp / 2);
  assert.equal(f.sim.snapshotFor(f.player.id)!.self.soulEscort, true);
  assert.equal(f.sim.snapshotFor(f.player.id)!.actors.find(actor => actor.npcKind === 'fallen-soldier')!.hp, 0);
  assert.throws(f.talk, /Eren riposa/);
  const other: Account = { ...f.account, id: 'other', name: 'Altro', characters: undefined, narrative: undefined, body: undefined };
  const observer = f.sim.addPlayer(other, 'mage'); Object.assign(observer, { x: 72, y: 24 });
  const otherSoldier = f.sim.snapshotFor(other.id)!.actors.find(actor => actor.npcKind === 'fallen-soldier')!;
  assert.ok(otherSoldier.hp > 0); assert.equal(otherSoldier.questMarker, 'available');
  assert.throws(() => f.sim.interact(f.player.id, { kind: 'choose', sessionId: accepted.sessionId, choiceId: 'accept' }));
  assert.equal(f.player.maxHp, maxHp);
  f.sim.checkpoint();
  const restored = new WorldSimulation(f.doc.seed, f.sim.now, undefined, 'world', f.environment).addPlayer(f.account, 'mage');
  assert.equal(restored.maxHp, maxHp); assert.equal(restored.hp, maxHp / 2); assert.equal(restored.soulEscort, true);
});

test('arrival completes once, removes bonus safely and anchors the farewell at the designer destination', () => {
  const f = fixture(); f.accept(); f.player.hp = f.player.maxHp / 2;
  f.player.x = 6 * TILE_SIZE - 1; f.sim.interactions.step(f.sim.now);
  assert.equal(f.account.narrative!.quests[SOUL_QUEST_ID].status, 'active');
  f.player.x = 6 * TILE_SIZE; f.sim.interactions.step(f.sim.now);
  assert.equal(f.account.narrative!.quests[SOUL_QUEST_ID].status, 'completed');
  assert.equal(f.player.maxHp, CLASSES.mage.maxHp); assert.equal(f.player.hp, CLASSES.mage.maxHp / 2);
  assert.equal(f.player.soulEscort, undefined); assert.equal(f.player.xp, 200);
  const snapshot = f.sim.snapshotFor(f.player.id)!;
  assert.equal(snapshot.self.soulFarewellAt, f.sim.now); assert.equal(snapshot.self.soulFarewellX, 6 * TILE_SIZE);
  f.player.x += 100; f.sim.interactions.step(f.sim.now);
  assert.equal(f.player.soulFarewellX, 6 * TILE_SIZE); assert.equal(f.player.xp, 200);
  f.sim.now += SOUL_FAREWELL_MS; f.sim.step(.01);
  assert.equal(f.player.soulFarewellAt, undefined);
});

test('dead or disconnected escorts cannot finish, and living arrival works after resuming', () => {
  const f = fixture(); f.accept(); Object.assign(f.player, { x: 6 * TILE_SIZE, hp: 0, deadUntil: f.sim.now + 60_000 });
  f.sim.interactions.step(f.sim.now); assert.equal(f.account.narrative!.quests[SOUL_QUEST_ID].status, 'active');
  f.player.hp = f.player.maxHp; f.sim.connections.get(f.player.id)!.connected = false;
  f.sim.interactions.step(f.sim.now); assert.equal(f.account.narrative!.quests[SOUL_QUEST_ID].status, 'active');
  f.sim.connections.get(f.player.id)!.connected = true; f.sim.interactions.step(f.sim.now);
  assert.equal(f.account.narrative!.quests[SOUL_QUEST_ID].status, 'completed');
});

test('bonus follows the selected character and does not apply in arena simulations', () => {
  const f = fixture(); f.accept(); f.player.hp = f.player.maxHp / 2;
  f.sim.addPlayer(f.account, 'warrior'); assert.equal(f.player.maxHp, CLASSES.warrior.maxHp); assert.equal(f.player.soulEscort, undefined);
  f.sim.addPlayer(f.account, 'mage'); assert.equal(f.player.maxHp, Math.round(CLASSES.mage.maxHp * SOUL_HEALTH_MULTIPLIER));
  f.sim.checkpoint();
  const arena = new WorldSimulation(f.doc.seed, f.sim.now, undefined, 'arena', f.environment);
  const arenaPlayer = arena.addPlayer(structuredClone(f.account), 'mage');
  assert.equal(arenaPlayer.maxHp, CLASSES.mage.maxHp); assert.equal(arenaPlayer.soulEscort, undefined);
});

test('completed farewell is discarded on disconnect, reconnect and switching characters', () => {
  for (const action of ['disconnect', 'switch'] as const) {
    const f = fixture(); f.accept(); f.player.x = 6 * TILE_SIZE; f.sim.interactions.step(f.sim.now);
    assert.notEqual(f.player.soulFarewellAt, undefined);
    if (action === 'disconnect') {
      f.sim.disconnectPlayer(f.player.id);
      assert.equal(f.player.soulFarewellAt, undefined);
      // Reconnect before the body expires: the same actor must not replay the scene.
      assert.equal(f.sim.addPlayer(f.account, 'mage'), f.player);
    } else { f.sim.addPlayer(f.account, 'warrior'); f.sim.addPlayer(f.account, 'mage'); }
    const snapshot = f.sim.snapshotFor(f.player.id)!;
    for (const actor of [snapshot.self, ...snapshot.actors.filter(a => a.id === f.player.id)]) {
      assert.equal(actor.soulFarewellAt, undefined); assert.equal(actor.soulFarewellX, undefined); assert.equal(actor.soulFarewellY, undefined);
      assert.equal(actor.soulEscort, undefined);
    }
    assert.equal(f.account.narrative!.quests[SOUL_QUEST_ID].status, 'completed');
    f.sim.interactions.step(f.sim.now); assert.equal(f.player.soulFarewellAt, undefined);
    const restarted = new WorldSimulation(f.doc.seed, f.sim.now, undefined, 'world', f.environment);
    assert.equal(restarted.addPlayer(f.account, 'mage').soulFarewellAt, undefined);
    assert.equal(f.account.narrative!.quests[SOUL_QUEST_ID].completions, 1);
  }
});
