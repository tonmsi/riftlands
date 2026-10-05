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
import { canCollectItem, collectItem, insertItem, newInventory, validInventory } from '../shared/items';
import { VENDOR_DEFINITIONS } from '../shared/vendors';
import { questStatus } from '../shared/narrative';
import { DIALOGUE_DEFINITIONS, QUEST_DEFINITIONS } from '../shared/narrative';
import { ITEM_DEFINITIONS } from '../shared/items';
import { NPC_LOOT_TABLES } from '../shared/loot';
import { LOOT_ITEM_TTL, validInteractionCommand } from '../shared/interactions';
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

test('Nereo gives one private fishing rod per character without replacing a full inventory', () => {
  const f = fixture(); insertItem(f.a.inventory!, 'slime-innards', 3);
  const view = f.talk(); assert.ok(view.choices.some(choice => choice.id === 'fishing'));
  f.sim.interact(f.a.id, { kind: 'choose', sessionId: view.sessionId, choiceId: 'fishing' });
  assert.equal(f.a.inventory!.slots[0]!.itemId, 'slime-innards');
  const rod = [...f.sim.interactions.drops.values()].filter(drop => drop.stack.itemId === 'fishing-rod');
  assert.equal(rod.length, 1); assert.equal(rod[0].ownerId, f.a.id);
  assert.ok(f.a.narrative!.gifts!.includes('nereo-first-rod'));
  assert.equal(f.sim.interactions.visibleDrops(f.b.id, f.sim.now, 500).some(drop => drop.stack.itemId === 'fishing-rod'), false);
  assert.equal(f.talk().choices.some(choice => choice.id === 'fishing'), false);
  assert.ok(f.sim.snapshotFor(f.a.id)!.narrative!.gifts!.includes('nereo-first-rod'));
});

test('slime deaths unlock 50% loot only while the killer has the active quest', () => {
  let value = .499999;
  const { sim, a, b, accept, kill, player, other } = fixture(() => value);
  const questDrops = () => [...sim.interactions.drops.values()].filter(drop => drop.stack.itemId === 'slime-innards');
  kill(); assert.equal(questDrops().length, 0);
  accept(); const slime = kill(); assert.equal(questDrops().length, 1);
  assert.equal(sim.interactions.visibleDrops(b.id, sim.now, 900).length, 0, 'another player cannot steal quest loot');
  Object.assign(other, { x: slime.x, y: slime.y }); sim.step(.01); assert.equal(b.inventory!.slots[0], null);
  Object.assign(other, { x: -200 }); sim.now += 1000;
  Object.assign(player, { x: questDrops()[0].x, y: questDrops()[0].y }); sim.step(.01);
  assert.deepEqual(a.inventory!.slots[0], { itemId: 'slime-innards', quantity: 1 });
  value = .5; kill(); assert.equal(questDrops().length, 0, 'exact 50% boundary rejects');
  value = 0; kill(); assert.equal(questDrops().length, 1);
  a.narrative!.quests['stinking-bait'].status = 'completed'; a.narrative!.quests['stinking-bait'].completedAt = sim.now; kill(); assert.equal(questDrops().length, 1);
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

test('backpacks upgrade a full bag without losing contents; stored bags never expand capacity', () => {
  const inventory = newInventory(); insertItem(inventory, 'slime-innards', 9999);
  assert.ok(collectItem(inventory, 'backpack-2', 1));
  assert.equal(inventory.backpackId, 'backpack-2'); assert.equal(inventory.capacity, 2);
  insertItem(inventory, 'healing-potion', 20);
  assert.ok(collectItem(inventory, 'backpack-3', 1));
  assert.deepEqual(inventory.slots, [{ itemId: 'slime-innards', quantity: 9999 }, { itemId: 'healing-potion', quantity: 20 }, { itemId: 'backpack-2', quantity: 1 }]);
  assert.equal(inventory.capacity, 3); assert.ok(validInventory(inventory));
  const before = structuredClone(inventory);
  assert.equal(collectItem(inventory, 'backpack-2', 1), false); assert.deepEqual(inventory, before);
  assert.equal(collectItem(inventory, 'backpack-5', 2), false); assert.deepEqual(inventory, before);
  assert.ok(collectItem(inventory, 'backpack-5', 1)); assert.equal(inventory.capacity, 5);
  assert.ok(collectItem(inventory, 'backpack-4', 1)); assert.equal(inventory.capacity, 5);
  assert.equal(inventory.backpackId, 'backpack-5'); assert.ok(validInventory(inventory));
  assert.equal(validInventory({ ...inventory, capacity: 6, slots: [...inventory.slots, null] }), false);
  assert.equal(validInventory({ ...inventory, backpackId: 'backpack-2' }), false);
  assert.equal(insertItem(inventory, 'gold', 1), false);
});

test('mob currency bypasses full inventory; backpack upgrades on contact and smaller bags remain normal loot', () => {
  const { sim, a, b, player, other, kill } = fixture(() => .99);
  insertItem(a.inventory!, 'slime-innards', 9999);
  const slime = kill();
  const drop = (id: string, itemId: string, quantity = 1) => sim.interactions.drops.set(id, { id, x: slime.x, y: slime.y, stack: { itemId, quantity }, ownerId: a.id, expiresAt: sim.now + LOOT_ITEM_TTL });
  drop('gold', 'gold', 7); drop('bag', 'backpack-3');
  Object.assign(other, { x: slime.x, y: slime.y }); sim.step(.01);
  assert.equal(b.gold ?? 0, 0); assert.equal(b.inventory!.capacity, 1);
  Object.assign(player, { x: slime.x, y: slime.y }); sim.step(.01);
  assert.equal(a.gold, 7); assert.equal(a.inventory!.capacity, 3); assert.equal(a.inventory!.backpackId, 'backpack-3');
  assert.equal(a.inventory!.slots[0]!.quantity, 9999);
  drop('small', 'backpack-2'); sim.step(.01);
  assert.deepEqual(a.inventory!.slots[1], { itemId: 'backpack-2', quantity: 1 }); assert.equal(a.inventory!.capacity, 3);
  insertItem(a.inventory!, 'healing-potion', 20); drop('no-room', 'backpack-2'); sim.step(.01);
  assert.ok(sim.interactions.drops.has('no-room')); assert.equal(a.inventory!.capacity, 3);
  drop('upgrade', 'backpack-4'); sim.step(.01);
  assert.equal(a.inventory!.backpackId, 'backpack-4'); assert.ok(a.inventory!.slots.some(stack => stack?.itemId === 'backpack-3'));
  assert.ok(sim.interactions.drops.has('no-room'), 'old backpack takes the newly added slot, without destroying the smaller ground bag');
});

test('loot tables give hostile mobs currency and healing potions without requiring a quest; bags are sold by vendors', () => {
  const { sim, a, b, kill } = fixture(); kill();
  const items = [...sim.interactions.drops.values()];
  assert.deepEqual(items.map(drop => drop.stack.itemId), ['gold', 'healing-potion']);
  for (const drop of items) { assert.equal(drop.ownerId, a.id); assert.equal(drop.expiresAt - sim.now, LOOT_ITEM_TTL); }
  assert.equal(sim.interactions.visibleDrops(b.id, sim.now, 900).length, 0);
  for (const kind of ['slime', 'wisp', 'sentinel']) {
    assert.ok(NPC_LOOT_TABLES[kind].some(rule => rule.itemId === 'gold'));
    assert.ok(NPC_LOOT_TABLES[kind].some(rule => rule.itemId === 'healing-potion'));
    assert.ok(NPC_LOOT_TABLES[kind].every(rule => !ITEM_DEFINITIONS[rule.itemId].backpackSlots));
  }
});

test('collection availability preserves currency, matching stacks and upgrades even when every slot is occupied', () => {
  const inventory = newInventory(); insertItem(inventory, 'healing-potion', 19);
  assert.ok(canCollectItem(inventory, 'healing-potion', 1)); assert.equal(canCollectItem(inventory, 'healing-potion', 2), false);
  assert.equal(canCollectItem(inventory, 'slime-innards', 1), false); assert.ok(canCollectItem(inventory, 'gold', 1));
  assert.ok(canCollectItem(inventory, 'backpack-2', 1));
  assert.equal(canCollectItem(inventory, 'unknown', 1), false);
});

test('vendor validates server prices, balance, capacity and session tokens; upgrades replace the equipped bag', () => {
  const { sim, a, player, npc } = fixture();
  const merchant: Actor = { ...npc, id: 'vendor', name: 'Ada, mercante', npcKind: 'outpost-vendor', dialogueId: 'outpost-shop' };
  sim.npcs.set(merchant.id, merchant); a.gold = 200; insertItem(a.inventory!, 'slime-innards', 9999);
  const talk = () => { sim.interact(a.id, { kind: 'talk', targetId: merchant.id }); return sim.interactions.view(a.id, sim.now)!; };
  const first = talk(); assert.equal(first.shop!.length, 6);
  const buy = { kind: 'buy-item', sessionId: first.sessionId, offerId: 'bag-2' } as const;
  sim.interact(a.id, buy); assert.equal(a.gold, 190); assert.equal(a.inventory!.backpackId, 'backpack-2');
  assert.throws(() => sim.interact(a.id, buy), /terminata/); assert.equal(a.gold, 190);
  let next = sim.interactions.view(a.id, sim.now)!;
  assert.match(next.shop!.find(offer => offer.id === 'bag-2')!.disabledReason!, /già/);
  assert.throws(() => sim.interact(a.id, { ...buy, sessionId: next.sessionId }), /già/);
  sim.interact(a.id, { ...buy, sessionId: next.sessionId, offerId: 'bag-3' });
  assert.equal(a.gold, 165); assert.equal(a.inventory!.capacity, 3); assert.ok(a.inventory!.slots.every(stack => !stack || !ITEM_DEFINITIONS[stack.itemId].backpackSlots));
  next = sim.interactions.view(a.id, sim.now)!;
  sim.interact(a.id, { ...buy, sessionId: next.sessionId, offerId: 'potion' }); assert.equal(a.gold, 162);
  next = sim.interactions.view(a.id, sim.now)!; const before = structuredClone(a.inventory);
  assert.throws(() => sim.interact(a.id, { ...buy, sessionId: next.sessionId, offerId: 'made-up' }));
  a.gold = 0;
  assert.throws(() => sim.interact(a.id, { ...buy, sessionId: next.sessionId, offerId: 'bag-5' }), /insufficienti/); assert.deepEqual(a.inventory, before);
  a.gold = 200; a.inventory!.slots[1]!.quantity = 20; insertItem(a.inventory!, 'backpack-2', 1);
  assert.throws(() => sim.interact(a.id, { ...buy, sessionId: next.sessionId, offerId: 'potion' }), /pieno/); assert.equal(a.gold, 200);
  player.x = merchant.x + 200;
  assert.throws(() => sim.interact(a.id, { ...buy, sessionId: next.sessionId, offerId: 'bag-5' }), /Avvicinati/); assert.equal(a.gold, 200);
  for (const vendor of Object.values(VENDOR_DEFINITIONS)) for (const offer of vendor.offers) {
    assert.ok(ITEM_DEFINITIONS[offer.itemId]); assert.ok(Number.isSafeInteger(offer.price) && offer.price > 0);
  }
});

test('consumables heal once, clamp to max HP and reject stale slots, dead players and cooldown spam', () => {
  const { sim, a, player } = fixture(); insertItem(a.inventory!, 'healing-potion', 4);
  const command = { kind: 'consume-item', slot: 0, itemId: 'healing-potion' } as const;
  assert.ok(validInteractionCommand(command)); assert.throws(() => sim.interact(a.id, command), /massimo/);
  assert.equal(a.inventory!.slots[0]!.quantity, 4);
  player.hp = 10; sim.interact(a.id, command); assert.equal(player.hp, 50); assert.equal(a.inventory!.slots[0]!.quantity, 3);
  assert.ok(sim.events.some(event => event.kind === 'heal' && event.targetId === a.id && event.amount === 40));
  assert.throws(() => sim.interact(a.id, command), /Attendi/); assert.equal(player.hp, 50);
  sim.now += 4000; player.hp = player.maxHp - 5; sim.interact(a.id, command); assert.equal(player.hp, player.maxHp);
  assert.equal(a.inventory!.slots[0]!.quantity, 2);
  player.hp = 0; sim.now += 4000; assert.throws(() => sim.interact(a.id, command));
  player.hp = 10; assert.throws(() => sim.interact(a.id, { ...command, itemId: 'backpack-2' }));
  sim.disconnectPlayer(a.id); assert.throws(() => sim.interact(a.id, command)); assert.equal(a.inventory!.slots[0]!.quantity, 2);
});

test('quest rewards stay on the ground and private; completion replay cannot duplicate items', () => {
  const { sim, a, b, player, other, talk, accept } = fixture(); accept(); insertItem(a.inventory!, 'slime-innards', 3);
  const request = talk(), command = { kind: 'use-item', sessionId: request.sessionId, slot: 0, itemId: 'slime-innards' } as const;
  sim.interact(a.id, command);
  const rewards = [...sim.interactions.drops.values()];
  assert.deepEqual(rewards.map(drop => drop.stack.itemId), ['backpack-2', 'healing-potion']);
  assert.equal(a.inventory!.capacity, 1); assert.equal(a.inventory!.slots[0], null); assert.equal(a.gold, 20);
  assert.equal(sim.interactions.visibleDrops(b.id, sim.now, 900).length, 0);
  assert.throws(() => sim.interact(a.id, command)); assert.equal(sim.interactions.drops.size, 2);
  player.x = -200; Object.assign(other, { x: rewards[0].x, y: rewards[0].y }); sim.now += 1100; sim.step(.01);
  assert.equal(b.inventory!.capacity, 1); assert.equal(sim.interactions.drops.size, 2);
  Object.assign(player, { x: rewards[0].x, y: rewards[0].y }); sim.step(.01); assert.equal(a.inventory!.backpackId, 'backpack-2');
  Object.assign(player, { x: rewards[1].x, y: rewards[1].y }); sim.step(.01);
  assert.ok(a.inventory!.slots.some(stack => stack?.itemId === 'healing-potion'));
  sim.now = a.narrative!.quests['stinking-bait'].completedAt! + 300_000;
  Object.assign(player, { x: 72, y: 24 }); accept(); insertItem(a.inventory!, 'slime-innards', 3);
  const next = talk(); const slot = a.inventory!.slots.findIndex(stack => stack?.itemId === 'slime-innards');
  sim.interact(a.id, { kind: 'use-item', sessionId: next.sessionId, slot, itemId: 'slime-innards' });
  assert.deepEqual([...sim.interactions.drops.values()].map(drop => drop.stack.itemId), ['healing-potion']);
  assert.equal(a.gold, 20, 'gold stays first-completion only');
  assert.equal(sim.interactions.view(a.id, sim.now)!.rewardGold, 0, 'repeat rewards visibly show zero gold');
});

test('melee loot appears outside the killer pickup radius and is not collected where the mob died', () => {
  const { sim, a, player, kill } = fixture(); const victim = kill();
  const drops = [...sim.interactions.drops.values()]; assert.ok(drops.length);
  for (const drop of drops) {
    assert.ok(Math.hypot(drop.x - player.x, drop.y - player.y) > player.radius + 10);
    assert.ok(Math.hypot(drop.x - victim.x, drop.y - victim.y) >= 40);
  }
  Object.assign(player, { x: victim.x, y: victim.y }); sim.now += 1000; sim.step(.01);
  assert.equal(sim.interactions.drops.size, drops.length); assert.equal(a.gold ?? 0, 0);
  Object.assign(player, { x: drops[0].x, y: drops[0].y }); sim.step(.01); assert.equal(a.gold, drops[0].stack.quantity);
});

test('inventory feedback confirms only successful actions, is private and expires without replaying a purchase', () => {
  const { sim, a, b, player, npc } = fixture(); insertItem(a.inventory!, 'healing-potion', 2);
  assert.throws(() => sim.interact(a.id, { kind: 'consume-item', itemId: 'healing-potion', slot: 0 })); assert.deepEqual(sim.interactions.feedback(a.id, sim.now), []);
  player.hp = 20; sim.interact(a.id, { kind: 'consume-item', itemId: 'healing-potion', slot: 0 });
  assert.equal(sim.snapshotFor(a.id)!.inventoryActions![0].kind, 'consume'); assert.deepEqual(sim.snapshotFor(b.id)!.inventoryActions, []);
  sim.interact(a.id, { kind: 'drop-item', itemId: 'healing-potion', slot: 0, quantity: 1 });
  assert.equal(sim.interactions.feedback(a.id, sim.now)[1].kind, 'drop');
  const vendor: Actor = { ...npc, id: 'merchant', npcKind: 'outpost-vendor', dialogueId: 'outpost-shop' }; sim.npcs.set(vendor.id, vendor); a.gold = 30;
  sim.interact(a.id, { kind: 'talk', targetId: vendor.id }); const sessionId = sim.interactions.view(a.id, sim.now)!.sessionId;
  const command = { kind: 'buy-item', sessionId, offerId: 'bag-3' } as const;
  sim.interact(a.id, command); assert.throws(() => sim.interact(a.id, command));
  assert.equal(sim.interactions.feedback(a.id, sim.now).filter(action => action.kind === 'purchase').length, 1);
  sim.now += 2500; assert.deepEqual(sim.interactions.feedback(a.id, sim.now), []);
});

test('ground loot limit rejects the delivery before consuming objectives or awarding XP', () => {
  const { sim, a, player, talk, accept } = fixture(); accept(); insertItem(a.inventory!, 'slime-innards', 3);
  for (let i = 0; i < 2047; i++) sim.interactions.drops.set(String(i), { id: String(i), x: player.x, y: player.y, stack: { itemId: 'gold', quantity: 1 }, expiresAt: sim.now + LOOT_ITEM_TTL });
  const request = talk();
  assert.throws(() => sim.interact(a.id, { kind: 'use-item', sessionId: request.sessionId, slot: 0, itemId: 'slime-innards' }), /Troppi oggetti/);
  assert.equal(a.inventory!.slots[0]!.quantity, 3); assert.equal(a.xp, 0); assert.equal(a.gold ?? 0, 0);
  assert.equal(a.narrative!.quests['stinking-bait'].status, 'active');
});

test('legacy accounts gain empty inventory without resetting progress; quests and stacks survive reload', () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-quest-store-')), path = join(directory, 'accounts.json');
  try {
    const old = { ...account('legacy'), xp: 240, gold: 35, kills: 4 };
    writeFileSync(path, JSON.stringify({ version: 2, accounts: [old] }));
    const store = new AccountStore(path), entry = store.accounts.get(old.id)!;
    assert.deepEqual(entry.inventory, newInventory()); assert.equal(entry.xp, 240); assert.equal(entry.gold, 35);
    insertItem(entry.inventory!, 'slime-innards', 7); collectItem(entry.inventory!, 'backpack-3', 1); insertItem(entry.inventory!, 'backpack-2', 1);
    entry.narrative!.quests['stinking-bait'] = { status: 'completed', objectives: { 'innards-delivered': 3 } };
    store.touch(); store.flush(); const reloaded = new AccountStore(path).accounts.get(old.id)!;
    assert.deepEqual(reloaded.inventory, entry.inventory); assert.deepEqual(reloaded.narrative, entry.narrative); assert.equal(reloaded.kills, 4);
    const corrupt = JSON.parse(readFileSync(path, 'utf8')); corrupt.accounts[0].inventory.slots[0].quantity = -1; writeFileSync(path, JSON.stringify(corrupt));
    assert.throws(() => new AccountStore(path), /Inventario o missioni/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('loading old accounts discards worn bait without changing fresh items, characters or gold', () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-bait-cleanup-')), path = join(directory, 'accounts.json');
  try {
    const store = new AccountStore(path), entry = store.register('BaitCleanup', 'test-password').account;
    entry.gold = 23;
    for (const [classId, remaining] of [['mage', 2], ['hunter', 1]] as const) {
      const inventory = entry.characters![classId]!.inventory;
      collectItem(inventory, 'backpack-3', 1); insertItem(inventory, 'slime-innards', 7);
      inventory.slots[1] = Object.assign({ itemId: 'slime-innards', quantity: 1 }, { baitUsesRemaining: remaining });
      insertItem(inventory, 'fishing-rod', 1);
    }
    store.touch(); store.flush();
    const loaded = new AccountStore(path), migrated = loaded.accounts.get(entry.id)!;
    for (const classId of ['mage', 'hunter'] as const) {
      const character = migrated.characters![classId]!;
      assert.equal(character.inventory.slots[0]!.quantity, 7); assert.equal(character.inventory.slots[1], null);
      assert.equal(character.inventory.slots[2]!.itemId, 'fishing-rod'); assert.equal(character.xp, entry.characters![classId]!.xp);
    }
    assert.equal(migrated.gold, 23); loaded.flush();
    assert.equal(readFileSync(path, 'utf8').includes('baitUsesRemaining'), false);
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
    for (const reward of quest.reward?.items ?? []) {
      assert.ok(Object.hasOwn(ITEM_DEFINITIONS, reward.itemId)); assert.ok(Number.isSafeInteger(reward.quantity) && reward.quantity > 0 && reward.quantity <= ITEM_DEFINITIONS[reward.itemId].maxStack);
    }
  }
  for (const dialogue of Object.values(DIALOGUE_DEFINITIONS)) {
    assert.ok(Object.hasOwn(QUEST_DEFINITIONS, dialogue.questId));
    for (const entry of dialogue.entries) { assert.ok(Object.hasOwn(dialogue.nodes, entry.node)); if (entry.condition.kind === 'quest-status') assert.ok(Object.hasOwn(QUEST_DEFINITIONS, entry.condition.questId)); }
    for (const node of Object.values(dialogue.nodes)) {
      assert.equal(new Set(node.choices.map(choice => choice.id)).size, node.choices.length);
      for (const choice of node.choices) {
        if (choice.next) assert.ok(Object.hasOwn(dialogue.nodes, choice.next));
        if (choice.action?.kind === 'accept-quest') assert.ok(Object.hasOwn(QUEST_DEFINITIONS, choice.action.questId));
        if (choice.action?.kind === 'give-item') assert.ok(Object.hasOwn(ITEM_DEFINITIONS, choice.action.itemId));
      }
      if (node.itemRequest) for (const next of [node.itemRequest.completedNext, node.itemRequest.progressNext]) assert.ok(Object.hasOwn(dialogue.nodes, next));
    }
  }
  for (const rules of Object.values(NPC_LOOT_TABLES)) for (const rule of rules) {
    assert.ok(Object.hasOwn(ITEM_DEFINITIONS, rule.itemId)); assert.ok(rule.chance >= 0 && rule.chance <= 1);
    if (rule.condition?.kind === 'quest-status') assert.ok(Object.hasOwn(QUEST_DEFINITIONS, rule.condition.questId));
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
  const questDrops = () => [...sim.interactions.drops.values()].filter(drop => drop.stack.itemId === 'slime-innards');
  kill(); assert.equal(questDrops().length, 0);
  accept(); kill(); assert.equal(questDrops().length, 1);
  const repeat = talk();
  sim.interact(a.id, { kind: 'use-item', sessionId: repeat.sessionId, slot: 0, itemId: 'slime-innards' });
  assert.equal(a.narrative!.quests['stinking-bait'].completions, 2);
  assert.equal(a.inventory!.slots[0], null);
  assert.ok(!talk().choices.some(choice => choice.id === 'accept'));
});
