import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldSimulation } from '../server/simulation';
import { AccountStore, type Account } from '../server/store';
import { RoomManager } from '../server/rooms';
import { World } from '../shared/world';
import { newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { insertItem, newInventory, validInventory } from '../shared/items';
import { questStatus } from '../shared/narrative';
import { DIALOGUE_DEFINITIONS, QUEST_DEFINITIONS } from '../shared/narrative';
import { ITEM_DEFINITIONS } from '../shared/items';
import { NPC_LOOT_TABLES } from '../shared/loot';
import { validInteractionCommand } from '../shared/interactions';
import type { Actor } from '../shared/types';

const account = (id: string): Account => ({ id, name: id, nameLower: id, salt: 'a'.repeat(32), passwordHash: 'b'.repeat(128), xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 });
function fixture(random = () => 0) {
  const document = newWorldDocument(); document.npcs.push({ id: 'fisher', npcKind: 'old-fisher', x: 2, y: 0, level: 1 });
  const world = new World(document.seed, 16, 'world', document, []); world.getTile = () => 'grass';
  const getChunk = world.getChunk.bind(world);
  world.getChunk = (cx, cy) => ({ ...getChunk(cx, cy), npcs: cx === 0 && cy === 0 ? [{ id: 'authored:fisher', npcKind: 'old-fisher', x: 120, y: 24, level: 1 }] : [], pickups: [] });
  const sim = new WorldSimulation(document.seed, 1_000_000, undefined, 'world', { world, dungeons: [], bosses: new Map(), spawn: { x: 0, y: 0 }, lootRandom: random });
  const a = account('alice'), b = account('bob');
  const player = sim.addPlayer(a, 'mage'), other = sim.addPlayer(b, 'mage');
  Object.assign(player, { x: 72, y: 24, aim: 0, spawnProtectedUntil: 0 }); Object.assign(other, { x: -200, y: 24, spawnProtectedUntil: 0 });
  sim.step(.01);
  const npc = sim.npcs.get('authored:fisher')!;
  const talk = () => { sim.interact(a.id, { kind: 'talk', targetId: npc.id }); return sim.interactions.view(a.id, sim.now)!; };
  const accept = () => { const view = talk(); sim.interact(a.id, { kind: 'choose', sessionId: view.sessionId, choiceId: 'accept' }); sim.interactions.close(a.id); };
  const kill = () => {
    const slime: Actor = { ...npc, id: `slime:${sim.npcs.size}`, npcKind: 'slime', disposition: 'hostile', dialogueId: undefined, x: player.x + 50, y: player.y, hp: 10, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
    sim.npcs.set(slime.id, slime);
    (sim as unknown as { damage(target: Actor, attacker: Actor, amount: number): boolean }).damage(slime, player, 1000);
    return slime;
  };
  return { sim, world, a, b, player, other, npc, talk, accept, kill };
}

test('authored neutral NPC wanders near home, remains invulnerable and has a per-player quest outline', () => {
  const { sim, a, b, npc, player, accept } = fixture();
  assert.equal(npc.dialogueId, 'old-fisher'); const point = { x: npc.x, y: npc.y }, hp = npc.hp;
  assert.equal(sim.snapshotFor(a.id)!.actors.find(actor => actor.id === npc.id)!.questMarker, 'available');
  accept();
  assert.equal(sim.snapshotFor(a.id)!.actors.find(actor => actor.id === npc.id)!.questMarker, 'active');
  assert.equal(sim.snapshotFor(b.id)!.actors.find(actor => actor.id === npc.id)!.questMarker, 'available');
  Object.assign(player, point);
  (sim as unknown as { damage(target: Actor, attacker: Actor, amount: number): boolean }).damage(npc, player, 1000);
  const home = sim.npcMeta.get(npc.id)!.home;
  let moved = false, paused = false;
  for (let i = 0; i < 600; i++) {
    sim.step(.1); moved ||= Math.hypot(npc.x - point.x, npc.y - point.y) > 10; paused ||= npc.spriteMoving === false;
    assert.ok(Math.hypot(npc.x - home.x, npc.y - home.y) <= 96);
  }
  assert.equal(npc.hp, hp); assert.ok(moved); assert.ok(paused); assert.ok([0, 1, 2, 3].includes(npc.spriteRow!));
});

test('slime deaths unlock 50% loot only while the killer has the active quest', () => {
  let value = .499999, rolls = 0;
  const { sim, a, b, accept, kill, player, other } = fixture(() => { rolls++; return value; });
  kill(); assert.equal(sim.interactions.drops.size, 0); assert.equal(rolls, 0);
  accept(); const slime = kill(); assert.equal(sim.interactions.drops.size, 1);
  assert.equal(sim.interactions.visibleDrops(b.id, sim.now, 900).length, 0, 'another player cannot steal quest loot');
  Object.assign(other, { x: slime.x, y: slime.y }); sim.step(.01); assert.equal(b.inventory!.slots[0], null);
  Object.assign(other, { x: -200 }); Object.assign(player, { x: slime.x, y: slime.y }); sim.step(.01);
  assert.deepEqual(a.inventory!.slots[0], { itemId: 'slime-innards', quantity: 1 });
  value = .5; kill(); assert.equal(sim.interactions.drops.size, 0, 'exact 50% boundary rejects');
  value = 0; kill(); assert.equal(sim.interactions.drops.size, 1);
  a.narrative!.quests['stinking-bait'].status = 'completed'; a.narrative!.quests['stinking-bait'].completedAt = sim.now; kill(); assert.equal(sim.interactions.drops.size, 1);
  assert.equal(rolls, 3);
});

test('deliveries accept partial stacks, retain excess, reject replays, and block a completed quest during its cooldown', () => {
  const { sim, a, talk, accept, npc } = fixture(); accept();
  insertItem(a.inventory!, 'slime-innards', 1); const first = talk();
  sim.interact(a.id, { kind: 'use-item', sessionId: first.sessionId, slot: 0, itemId: 'slime-innards' });
  assert.equal(a.inventory!.slots[0], null); assert.equal(sim.interactions.view(a.id, sim.now)!.request!.remaining, 2);
  assert.throws(() => sim.interact(a.id, { kind: 'use-item', sessionId: first.sessionId, slot: 0, itemId: 'slime-innards' }));
  insertItem(a.inventory!, 'slime-innards', 5); const second = talk();
  sim.interact(a.id, { kind: 'use-item', sessionId: second.sessionId, slot: 0, itemId: 'slime-innards' });
  assert.equal(a.inventory!.slots[0]!.quantity, 3); assert.equal(questStatus(a.narrative!, 'stinking-bait', sim.now), 'completed');
  assert.equal(a.narrative!.quests['stinking-bait'].objectives['innards-delivered'], 3);
  assert.equal(a.narrative!.quests['stinking-bait'].completions, 1);
  const after = talk(); assert.equal(after.request, undefined); assert.ok(!after.choices.some(choice => choice.id === 'accept'));
  assert.throws(() => sim.interact(a.id, { kind: 'choose', sessionId: after.sessionId, choiceId: 'accept' }));
  assert.throws(() => sim.interact(a.id, { kind: 'use-item', sessionId: after.sessionId, slot: 0, itemId: 'slime-innards' }));
  assert.equal(a.inventory!.slots[0]!.quantity, 3);
  assert.equal(sim.snapshotFor(a.id)!.actors.find(actor => actor.id === npc.id)!.questMarker, 'completed');
});

test('good fishing triggers a curse without changing the completed friendship on the next conversation', () => {
  const { sim, a, talk, accept } = fixture(); accept(); insertItem(a.inventory!, 'slime-innards', 3);
  const request = talk(); sim.interact(a.id, { kind: 'use-item', sessionId: request.sessionId, slot: 0, itemId: 'slime-innards' });
  const thanks = sim.interactions.view(a.id, sim.now)!;
  sim.interact(a.id, { kind: 'choose', sessionId: thanks.sessionId, choiceId: 'leave' });
  const curse = sim.interactions.view(a.id, sim.now)!; assert.match(curse.text, /Ti maledico/);
  assert.equal(questStatus(a.narrative!, 'stinking-bait', sim.now), 'completed');
  sim.interact(a.id, { kind: 'choose', sessionId: curse.sessionId, choiceId: 'leave' });
  assert.equal(sim.interactions.view(a.id, sim.now), null);
  assert.match(talk().text, /Sono contento di rivederti/);
});

test('moving away from a wandering character closes the conversation before a stale delivery can consume an item', () => {
  const { sim, a, player, npc, talk, accept } = fixture(); accept(); insertItem(a.inventory!, 'slime-innards', 3);
  const request = talk();
  sim.enqueueInput(a.id, { seq: 1, dx: -1, dy: 0, aim: 0 });
  sim.step(.1); assert.ok(player.x < 72, 'movement continues during dialogue');
  player.x = npc.x - 160; sim.step(.01);
  assert.equal(sim.interactions.view(a.id, sim.now), null);
  assert.throws(() => sim.interact(a.id, { kind: 'use-item', sessionId: request.sessionId, slot: 0, itemId: 'slime-innards' }));
  assert.equal(a.inventory!.slots[0]!.quantity, 3);
});

test('conversation validates distance, line of sight, life, connection, combat and expiration', () => {
  const { sim, a, player, npc, talk, world } = fixture();
  player.x = 400; assert.throws(talk); player.x = 72;
  world.getTile = (x, y) => x === 1 && y === 0 ? 'rock' : 'grass'; assert.throws(talk); world.getTile = () => 'grass';
  player.hp = 0; assert.throws(talk); player.hp = player.maxHp;
  const view = talk(); sim.connections.get(a.id)!.combatAt = sim.now + 1;
  assert.throws(() => sim.interact(a.id, { kind: 'choose', sessionId: view.sessionId, choiceId: 'accept' }));
  assert.equal(sim.interactions.view(a.id, sim.now), null);
  sim.now += 2; const next = talk(); sim.now += 120_000;
  assert.throws(() => sim.interact(a.id, { kind: 'choose', sessionId: next.sessionId, choiceId: 'accept' }));
  talk(); sim.disconnectPlayer(a.id); assert.equal(sim.interactions.view(a.id, sim.now), null);
  assert.throws(() => sim.interact(a.id, { kind: 'talk', targetId: npc.id }));
});

test('discard is public, collectible exactly once, and expires after ten seconds', () => {
  const { sim, a, b, player, other } = fixture(); insertItem(a.inventory!, 'slime-innards', 5);
  assert.throws(() => sim.interact(a.id, { kind: 'drop-item', slot: 0, itemId: 'slime-innards', quantity: 6 }));
  sim.interact(a.id, { kind: 'drop-item', slot: 0, itemId: 'slime-innards', quantity: 2 });
  const drop = [...sim.interactions.drops.values()][0]; assert.equal(drop.expiresAt - sim.now, 10_000);
  assert.equal(a.inventory!.slots[0]!.quantity, 3); assert.equal(sim.interactions.visibleDrops(b.id, sim.now, 900).length, 1);
  Object.assign(player, { x: drop.x, y: drop.y }); sim.step(.01); assert.equal(a.inventory!.slots[0]!.quantity, 3, 'dropper does not immediately reclaim');
  Object.assign(other, { x: drop.x, y: drop.y }); player.x = -100; sim.step(.01);
  assert.equal(sim.interactions.drops.size, 0); assert.equal(b.inventory!.slots[0]!.quantity, 2);
  sim.step(.01); assert.equal(b.inventory!.slots[0]!.quantity, 2);
  sim.interact(a.id, { kind: 'drop-item', slot: 0, itemId: 'slime-innards', quantity: 3 });
  const expiry = [...sim.interactions.drops.values()][0].expiresAt;
  player.x = -500; other.x = -1000;
  sim.now = expiry - 1; sim.interactions.step(sim.now); assert.equal(sim.interactions.drops.size, 1);
  sim.interactions.step(expiry); assert.equal(sim.interactions.drops.size, 0);
});

test('full, dead and disconnected collectors leave loot intact; drop limits never lose inventory', () => {
  const { sim, a, b, player, other } = fixture(); insertItem(a.inventory!, 'slime-innards', 2);
  sim.interact(a.id, { kind: 'drop-item', slot: 0, itemId: 'slime-innards', quantity: 1 });
  const drop = [...sim.interactions.drops.values()][0]; player.x = -400; Object.assign(other, { x: drop.x, y: drop.y, hp: 0 });
  sim.step(.01); assert.equal(sim.interactions.drops.size, 1); other.hp = other.maxHp;
  insertItem(b.inventory!, 'slime-innards', 9999); sim.step(.01); assert.equal(sim.interactions.drops.size, 1);
  b.inventory!.slots[0] = null; sim.disconnectPlayer(b.id); sim.step(.01); assert.equal(sim.interactions.drops.size, 1);
  for (let i = 0; i < 2048; i++) sim.interactions.drops.set(String(i), { ...drop, id: String(i) });
  assert.throws(() => sim.interact(a.id, { kind: 'drop-item', slot: 0, itemId: 'slime-innards', quantity: 1 }));
  assert.equal(a.inventory!.slots[0]!.quantity, 1);
});

test('inventory stacks atomically and fills existing stacks before future backpack slots', () => {
  const inventory = { ...newInventory(), capacity: 2, slots: [null, { itemId: 'slime-innards', quantity: 9998 }] };
  assert.ok(validInventory(inventory)); assert.equal(insertItem(inventory, 'slime-innards', 1), true);
  assert.deepEqual(inventory.slots, [null, { itemId: 'slime-innards', quantity: 9999 }]);
  assert.equal(insertItem(inventory, 'slime-innards', 10000), false); assert.equal(inventory.slots[0], null);
  assert.equal(validInventory({ ...inventory, slots: [{ itemId: 'unknown', quantity: 1 }, null] }), false);
  for (const command of [{ kind: 'drop-item', slot: -1, itemId: 'slime-innards', quantity: 1 }, { kind: 'drop-item', slot: 0, itemId: 'slime-innards', quantity: 1.5 }, { kind: 'choose', sessionId: '', choiceId: 'accept' }]) assert.equal(validInteractionCommand(command), false);
});

test('legacy accounts gain empty inventory without resetting progress; quests and stacks survive reload', () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-quest-store-')), path = join(directory, 'accounts.json');
  try {
    const old = { ...account('legacy'), xp: 240, gold: 35, kills: 4 };
    writeFileSync(path, JSON.stringify({ version: 2, accounts: [old] }));
    const store = new AccountStore(path), entry = store.accounts.get(old.id)!;
    assert.deepEqual(entry.inventory, newInventory()); assert.equal(entry.xp, 240); assert.equal(entry.gold, 35);
    insertItem(entry.inventory!, 'slime-innards', 7); entry.narrative!.quests['stinking-bait'] = { status: 'completed', objectives: { 'innards-delivered': 3 } };
    store.touch(); store.flush(); const reloaded = new AccountStore(path).accounts.get(old.id)!;
    assert.deepEqual(reloaded.inventory, entry.inventory); assert.deepEqual(reloaded.narrative, entry.narrative); assert.equal(reloaded.kills, 4);
    const corrupt = JSON.parse(readFileSync(path, 'utf8')); corrupt.accounts[0].inventory.slots[0].quantity = -1; writeFileSync(path, JSON.stringify(corrupt));
    assert.throws(() => new AccountStore(path), /Inventario o missioni/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('room epochs reject stale interactions and arena accounts cannot mutate world inventory', async () => {
  const manager = new RoomManager(undefined, 734291, 1_000_000), a = account('alice'), b = account('bob');
  manager.connect(a, 'mage'); manager.connect(b, 'mage');
  insertItem(a.inventory!, 'slime-innards', 4);
  const old = manager.stateFor(a.id), command = { kind: 'drop-item', slot: 0, itemId: 'slime-innards', quantity: 1 } as const;
  assert.equal(manager.interact(a.id, command, old.id, old.epoch - 1), false); assert.equal(a.inventory!.slots[0]!.quantity, 4);
  manager.global.now += 11_000;
  await manager.createMatch('arena', [[a.id], [b.id]]); const room = manager.stateFor(a.id);
  assert.equal(manager.interact(a.id, command, old.id, old.epoch), false);
  assert.throws(() => manager.interact(a.id, command, room.id, room.epoch), /istanza/);
  manager.simulationFor(a.id).accounts.get(a.id)!.inventory!.slots[0]!.quantity = 1;
  assert.equal(a.inventory!.slots[0]!.quantity, 4, 'temporary arena inventory is independent');
});

test('quest giver is authored content accepted by the world boundary parser', () => {
  const document = newWorldDocument(); document.npcs.push({ id: 'fisher', npcKind: 'old-fisher', x: 3, y: 1, level: 1 });
  assert.deepEqual(parseWorldDocument(document).npcs, document.npcs);
  const world = new World(document.seed, 16, 'world', document, []);
  assert.ok(world.getChunk(0, 0).npcs.some(npc => npc.id === 'authored:fisher' && npc.x === 168 && npc.y === 72));
});

test('dialogue and loot content reference real nodes, quests and item definitions', () => {
  for (const quest of Object.values(QUEST_DEFINITIONS)) {
    assert.ok(Object.hasOwn(ITEM_DEFINITIONS, quest.objective.itemId)); assert.ok(quest.objective.quantity > 0);
  }
  for (const dialogue of Object.values(DIALOGUE_DEFINITIONS)) {
    assert.ok(Object.hasOwn(QUEST_DEFINITIONS, dialogue.questId));
    for (const entry of dialogue.entries) { assert.ok(Object.hasOwn(dialogue.nodes, entry.node)); assert.ok(Object.hasOwn(QUEST_DEFINITIONS, entry.condition.questId)); }
    for (const node of Object.values(dialogue.nodes)) {
      assert.equal(new Set(node.choices.map(choice => choice.id)).size, node.choices.length);
      for (const choice of node.choices) {
        if (choice.next) assert.ok(Object.hasOwn(dialogue.nodes, choice.next));
        if (choice.action) assert.ok(Object.hasOwn(QUEST_DEFINITIONS, choice.action.questId));
      }
      if (node.itemRequest) for (const next of [node.itemRequest.completedNext, node.itemRequest.progressNext]) assert.ok(Object.hasOwn(dialogue.nodes, next));
    }
  }
  for (const rules of Object.values(NPC_LOOT_TABLES)) for (const rule of rules) {
    assert.ok(Object.hasOwn(ITEM_DEFINITIONS, rule.itemId)); assert.ok(rule.chance >= 0 && rule.chance <= 1);
    if (rule.condition) assert.ok(Object.hasOwn(QUEST_DEFINITIONS, rule.condition.questId));
  }
});


test('Nereo marker and dialogue reopen at the five-minute boundary for only the eligible player', () => {
  const { sim, a, b, npc, talk, accept, kill } = fixture();
  accept(); insertItem(a.inventory!, 'slime-innards', 6);
  const request = talk();
  sim.interact(a.id, { kind: 'use-item', sessionId: request.sessionId, slot: 0, itemId: 'slime-innards' });
  const completedAt = a.narrative!.quests['stinking-bait'].completedAt!;
  b.narrative!.quests['stinking-bait'] = { status: 'completed', objectives: { 'innards-delivered': 3 }, completions: 1, completedAt: completedAt + 1000 };
  sim.now = completedAt + 5 * 60 * 1000 - 1;
  assert.equal(sim.interactions.marker(a.id, 'old-fisher', sim.now), 'completed');
  assert.ok(!talk().choices.some(choice => choice.id === 'accept'));
  sim.now++;
  assert.equal(sim.snapshotFor(a.id)!.actors.find(actor => actor.id === npc.id)!.questMarker, 'available');
  assert.equal(sim.interactions.marker(b.id, 'old-fisher', sim.now), 'completed');
  assert.ok(talk().choices.some(choice => choice.id === 'accept'));
  kill(); assert.equal(sim.interactions.drops.size, 0);
  accept(); kill(); assert.equal(sim.interactions.drops.size, 1);
  const repeat = talk();
  sim.interact(a.id, { kind: 'use-item', sessionId: repeat.sessionId, slot: 0, itemId: 'slime-innards' });
  assert.equal(a.narrative!.quests['stinking-bait'].completions, 2);
  assert.equal(a.inventory!.slots[0], null);
  assert.ok(!talk().choices.some(choice => choice.id === 'accept'));
});
