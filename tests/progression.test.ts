import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLASSES, levelFromXp, xpForLevel, xpProgress } from '../shared/config';
import { newCharacter, equippedAbility, DEVELOPER_XP } from '../shared/progression';
import { AccountStore, characterFor, saveCharacterBuild, type Account } from '../server/store';
import { WorldSimulation } from '../server/simulation';
import { RoomManager } from '../server/rooms';
import { newWorldDocument } from '../shared/world-schema';
import { World } from '../shared/world';
import { insertItem } from '../shared/items';
import { QUEST_DEFINITIONS, questReward } from '../shared/narrative';

const account = (): Account => ({ id: 'alice', name: 'Alice', nameLower: 'alice', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 });
function simulation() {
  const document = newWorldDocument(), world = new World(document.seed, 16, 'world', document, []);
  world.getTile = () => 'grass'; world.pvpAt = () => true;
  world.getChunk = (cx, cy) => ({ cx, cy, key: `${cx},${cy}`, tiles: [], npcs: [], pickups: [] });
  return new WorldSimulation(document.seed, 1_000_000, undefined, 'world', { world, bosses: new Map(), dungeons: [], spawn: { x: 0, y: 0 } });
}
test('increasing XP thresholds are exact at every boundary and HUD progress uses the current level', () => {
  for (let level = 1; level < 20; level++) {
    const threshold = xpForLevel(level);
    assert.equal(levelFromXp(threshold - 1), level);
    assert.equal(levelFromXp(threshold), level + 1);
    assert.equal(xpProgress(threshold).fraction, level === 19 ? 1 : 0);
    assert.equal(xpProgress(threshold).required, level === 19 ? 0 : 100 + level * 40);
  }
  assert.equal(levelFromXp(DEVELOPER_XP), 20);
  assert.equal(levelFromXp(DEVELOPER_XP + 100_000), 20);
  assert.equal(xpProgress(DEVELOPER_XP).fraction, 1);
});
test('switching classes preserves independent XP, quest history, inventory and build under the same name', () => {
  const sim = simulation(), a = account(), mage = sim.addPlayer(a, 'mage');
  sim.awardXp(a.id, xpForLevel(9));
  mage.loadout = { q: 'r', e: 'e' }; insertItem(a.inventory!, 'slime-innards', 3);
  a.narrative!.quests['stinking-bait'] = { status: 'completed', objectives: {}, completions: 2 };
  sim.checkpoint();
  const warrior = sim.addPlayer(a, 'warrior');
  assert.equal(warrior.name, 'Alice'); assert.equal(warrior.level, 1); assert.equal(warrior.xp, 0);
  assert.equal(a.inventory!.slots[0], null); assert.deepEqual(a.narrative!.quests, {});
  sim.awardXp(a.id, 100);
  const restored = sim.addPlayer(a, 'mage');
  assert.equal(restored.level, 10); assert.deepEqual(restored.loadout, { q: 'r', e: 'e' });
  assert.equal(a.inventory!.slots[0]!.quantity, 3); assert.equal(a.narrative!.quests['stinking-bait'].completions, 2);
  assert.equal(characterFor(a, 'warrior').xp, 100);
});
test('a restart preserves all class progress and paid builds', () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-progression-'));
  try {
    const store = new AccountStore(join(directory, 'accounts.json')), a = store.register('Alice', 'password').account;
    const mage = characterFor(a, 'mage'); mage.xp = xpForLevel(9); a.gold = 30;
    saveCharacterBuild(a, 'mage', { q: 'r', e: 'e' });
    assert.equal(saveCharacterBuild(a, 'mage', { q: 'q', e: 'e' }), 10);
    characterFor(a, 'warrior').xp = 100;
    store.touch(); store.flush();
    const restored = new AccountStore(store.path).accounts.get(a.id)!;
    assert.equal(restored.gold, 20); assert.equal(characterFor(restored, 'mage').xp, xpForLevel(9));
    assert.deepEqual(characterFor(restored, 'mage').loadout, { q: 'q', e: 'e' });
    assert.equal(characterFor(restored, 'warrior').xp, 100);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('build changes validate unlocks, cost once, allow free reorder and reject insufficient gold without mutations', () => {
  const a = account(), c = characterFor(a, 'mage');
  assert.throws(() => saveCharacterBuild(a, 'mage', { q: 'e', e: null }));
  c.xp = 100; assert.equal(saveCharacterBuild(a, 'mage', { q: 'e', e: null }), 0);
  assert.throws(() => saveCharacterBuild(a, 'mage', { q: 'q', e: null }));
  assert.equal(c.loadout.q, 'e'); a.gold = 20;
  assert.equal(saveCharacterBuild(a, 'mage', { q: 'q', e: null }), 10);
  assert.equal(saveCharacterBuild(a, 'mage', { q: 'q', e: null }), 0);
  c.xp = xpForLevel(4); assert.equal(saveCharacterBuild(a, 'mage', { q: 'e', e: 'q' }), 0);
  assert.equal(saveCharacterBuild(a, 'mage', { q: 'q', e: 'e' }), 0);
  assert.throws(() => saveCharacterBuild(a, 'mage', { q: 'r', e: 'e' }));
  assert.throws(() => saveCharacterBuild(a, 'mage', { q: 'q', e: 'q' }));
});
test('locked casts are rejected and frost/ultimate mechanics follow the ability when placed in another slot', () => {
  const sim = simulation(), a = account(), player = sim.addPlayer(a, 'mage');
  assert.equal(sim.cast(player, 'e'), false); assert.equal(sim.cast(player, 'r'), false);
  sim.awardXp(a.id, xpForLevel(9)); player.loadout = { q: 'r', e: 'q' };
  assert.equal(equippedAbility(player, 'q')!.kind, 'shield');
  assert.equal(sim.cast(player, 'e'), true); assert.equal([...sim.projectiles.values()][0].slow, 2000);
  const hunter = sim.addPlayer(a, 'hunter');
  assert.equal(hunter.level, 20); assert.equal(hunter.maxHp, CLASSES.hunter.maxHp); assert.equal(hunter.speed, CLASSES.hunter.speed);
  hunter.loadout = { q: 'r', e: 'e' }; hunter.resource = 100; hunter.cooldowns.q = 0;
  const count = sim.projectiles.size;
  assert.equal(sim.cast(hunter, 'q'), true); sim.step(.1); assert.ok(sim.projectiles.size >= count + 2);
  sim.awardXp(a.id, 1000); assert.equal(hunter.level, 20);
  const c = characterFor(a, 'hunter'); a.gold = 20;
  saveCharacterBuild(a, 'hunter', { q: 'q', e: 'e' });
  assert.equal(saveCharacterBuild(a, 'hunter', { q: 'r', e: 'e' }), 10);
});
test('ordinary PvP kills grant zero XP while PvE kills grant experience', () => {
  const sim = simulation(), a = account(), player = sim.addPlayer(a, 'mage');
  const enemy = sim.addPlayer({ ...account(), id: 'bob' }, 'warrior'); enemy.spawnProtectedUntil = 0;
  const damage = (target: typeof enemy) => (sim as unknown as { damage(target: typeof enemy, source: typeof player, amount: number): boolean }).damage(target, player, 9999);
  damage(enemy); assert.equal(player.xp, 0);
  const npc = { ...enemy, id: 'slime', kind: 'npc' as const, hp: 10, npcKind: 'slime' as const, teamId: null };
  sim.npcs.set(npc.id, npc); damage(npc); assert.equal(player.xp, 23);
});
test('arena grants no XP and only completed battlegrounds reward the persistent character', async () => {
  for (const mode of ['arena', 'battleground'] as const) {
    const rooms = new RoomManager(undefined, 734291, 1_000_000), a = account(), b = { ...account(), id: 'bob' };
    rooms.connect(a, 'mage'); rooms.connect(b, 'warrior');
    rooms.global.now += 10_001;
    const room = await rooms.createMatch(mode, [[a.id], [b.id]], 10);
    const transient = rooms.simulationFor(a.id); transient.accounts.get(a.id)!.narrative!.quests['temporary'] = { status: 'completed', objectives: {} };
    rooms.closeMatch(room, 'timeout');
    assert.equal(characterFor(a, 'mage').xp, mode === 'arena' ? 0 : 100);
    assert.equal(characterFor(b, 'warrior').xp, mode === 'arena' ? 0 : 100);
    assert.equal(characterFor(a, 'mage').narrative.quests.temporary, undefined);
  }
});
test('Nereo repeats every five minutes, halves XP to a floor and pays gold only on the first completion', () => {
  const sim = simulation(), a = account(), player = sim.addPlayer(a, 'mage');
  const npc = { ...player, id: 'fisher', kind: 'npc' as const, npcKind: 'old-fisher' as const, dialogueId: 'old-fisher', disposition: 'neutral' as const, x: 20 };
  sim.npcs.set(npc.id, npc);
  const expected = [150, 75, 37, 18, 9, 5, 5];
  for (const [index, xp] of expected.entries()) {
    const talk = () => { sim.interact(a.id, { kind: 'talk', targetId: npc.id }); return sim.interactions.view(a.id, sim.now)!; };
    let view = talk(); sim.interact(a.id, { kind: 'choose', sessionId: view.sessionId, choiceId: 'accept' });
    insertItem(a.inventory!, 'slime-innards', 3); view = talk();
    const before = player.xp;
    sim.interact(a.id, { kind: 'use-item', sessionId: view.sessionId, slot: 0, itemId: 'slime-innards' });
    assert.equal(player.xp - before, xp); assert.equal(a.gold, 20);
    assert.throws(() => sim.interact(a.id, { kind: 'use-item', sessionId: view.sessionId, slot: 0, itemId: 'slime-innards' }));
    assert.equal(questReward(QUEST_DEFINITIONS['stinking-bait'], index).xp, xp);
    sim.now += 300_000;
  }
  sim.addPlayer(a, 'warrior'); assert.deepEqual(a.narrative!.quests, {});
  assert.equal(newCharacter('hunter').xp, DEVELOPER_XP);
});
