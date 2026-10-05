import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/world';
import { newWorldDocument } from '../shared/world-schema';
import { FISHING, validFishingCommand } from '../shared/fishing/model';
import { nearbyFishingWater, validFishingCast } from '../shared/fishing/water';
import { FishingSystem } from '../server/fishing/fishing-system';
import { WorldSimulation } from '../server/simulation';
import { collectItem, insertItem, inventoryCount } from '../shared/items';
import type { Account } from '../server/store';
import type { Actor } from '../shared/types';
import { FISH } from '../shared/fishing/model';
import { fishingRecoverySpeed } from '../shared/fishing/fight';
import { formatFishingDistance } from '../shared/fishing/distance';
function fixture(random = () => 0) {
  const document = newWorldDocument(), world = new World(document.seed, 16, 'world', document, []);
  world.getTile = (x, y) => x >= 3 && x < 9 && y >= -3 && y < 4 ? 'water' : 'grass';
  world.isBlocked = (x, y) => world.getTile(x, y) === 'water';
  world.getChunk = (cx, cy) => ({ key: `${cx},${cy}`, cx, cy, tiles: [], npcs: [], pickups: [] });
  const sim = new WorldSimulation(document.seed, 1_000_000, undefined, 'world', { world, dungeons: [], bosses: new Map(), spawn: { x: 72, y: 24 } });
  const account: Account = { id: 'alice', name: 'Alice', nameLower: 'alice', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0, gold: 10 };
  const player = sim.addPlayer(account, 'mage'); Object.assign(player, { x: 72, y: 24 });
  collectItem(account.inventory!, 'backpack-5', 1); insertItem(account.inventory!, 'fishing-rod', 1); insertItem(account.inventory!, 'slime-innards', 4);
  let now = 1_006_000, combat = 0, connected = true;
  const feedback: string[] = [], drops: string[] = [], dropTtls: number[] = [];
  const dropStacks: { itemId: string; quantity: number; baitUsesRemaining?: number }[] = [];
  const fishing = new FishingSystem({ players: sim.players, accounts: sim.accounts, world, connected: () => connected, combatAt: () => combat,
    changed: () => {}, rewardDrop: (_, stack, _now, ttl) => { drops.push(stack.itemId); dropStacks.push({ ...stack }); dropTtls.push(ttl ?? 0); }, feedback: (_, kind, stack) => feedback.push(`${kind}:${stack.itemId}`) }, random);
  const open = () => { fishing.command(player.id, { kind: 'open' }, now); return fishing.view(player.id)!.id; };
  const bait = (itemId = 'slime-innards', slot = itemId === 'gold' ? undefined : 1) => fishing.command(player.id, { kind: 'bait', sessionId: fishing.view(player.id)!.id, itemId, slot }, now);
  const cast = (x = 168) => fishing.command(player.id, { kind: 'cast', sessionId: fishing.view(player.id)!.id, x, y: 24 }, now);
  const tick = (ms = 100) => { now += ms; fishing.step(now); };
  const bite = () => { for (let i = 0; i < 25; i++) tick(); assert.equal(fishing.view(player.id)!.phase, 'bite'); };
  const reel = (held: boolean) => fishing.command(player.id, { kind: 'reel', sessionId: fishing.view(player.id)!.id, held }, now);
  const catchFish = () => { reel(true); let ticks = 0; for (; ticks < 900 && fishing.view(player.id)?.phase === 'fight'; ticks++) { assert.notEqual(formatFishingDistance(fishing.view(player.id)!.distanceM), '0,00', 'zero remaining distance never waits in fight'); reel(fishing.view(player.id)!.tension < .88); tick(); } assert.equal(fishing.view(player.id)!.outcome, 'caught'); return ticks; };
  return { world, sim, account, player, fishing, open, bait, cast, tick, bite, reel, catchFish, feedback, drops, dropStacks, dropTtls, setCombat: () => { combat = now + 1; }, disconnect: () => { connected = false; } };
}
test('fishing command validation rejects malformed payloads and nonfinite casts', () => {
  assert.ok(validFishingCommand({ kind: 'open' })); assert.ok(validFishingCommand({ kind: 'reel', sessionId: 'a', held: false }));
  for (const invalid of [{ kind: 'cast', sessionId: 'a', x: Infinity, y: 0 }, { kind: 'bait', sessionId: 'a', itemId: 'gold', slot: -1 }, { kind: 'reel', sessionId: 'a', held: 1 }, { kind: 'close', sessionId: '' }]) assert.equal(validFishingCommand(invalid), false);
});
test('shore detection accepts water casts and rejects land, excessive range and blocked approaches', () => {
  const f = fixture(); assert.ok(nearbyFishingWater(f.world, f.player)); assert.ok(validFishingCast(f.world, f.player, { x: 168, y: 24 }));
  assert.equal(validFishingCast(f.world, f.player, { x: 96, y: 24 }), false);
  assert.equal(validFishingCast(f.world, f.player, { x: 420, y: 24 }), false);
  f.world.isBlocked = x => x === 2 || x >= 3;
  assert.equal(validFishingCast(f.world, f.player, { x: 168, y: 24 }), false); assert.equal(nearbyFishingWater(f.world, f.player), undefined);
});
test('missing rod, unavailable bait, stale session and off-shore casts cannot start a round', () => {
  const f = fixture(); const rod = f.account.inventory!.slots[0]; f.account.inventory!.slots[0] = null;
  assert.throws(() => f.open(), /canna/); f.account.inventory!.slots[0] = rod; f.open();
  assert.throws(() => f.bait('healing-potion', 2), /esca/);
  assert.throws(() => f.fishing.command('alice', { kind: 'bait', sessionId: 'stale', itemId: 'gold' }, 1_006_000), /terminata/);
  f.bait(); assert.throws(() => f.fishing.command('alice', { kind: 'cast', sessionId: f.fishing.view('alice')!.id, x: 30, y: 24 }, 1_006_000), /acqua/);
});
test('bait remains mounted after withdrawal and is lost on missed hooks and broken lines', () => {
  const f = fixture(); f.open(); f.bait(); f.cast(); f.reel(true); assert.equal(f.fishing.view('alice')!.outcome, 'withdrawn');
  assert.equal(inventoryCount(f.account.inventory!, 'slime-innards'), 3);
  assert.equal(f.fishing.view('alice')!.baitUsesRemaining, 2);
  f.bait(); f.cast(); f.bite(); for (let i = 0; i < FISHING.biteWindowMs / 100 + 1; i++) f.tick();
  assert.equal(f.fishing.view('alice')!.outcome, 'missed'); assert.equal(inventoryCount(f.account.inventory!, 'slime-innards'), 3);
  f.bait(); f.cast(); f.bite(); for (let i = 0; i < 80 && f.fishing.view('alice')!.phase !== 'result'; i++) { f.reel(true); f.tick(); }
  assert.equal(f.fishing.view('alice')!.outcome, 'broken'); assert.equal(inventoryCount(f.account.inventory!, 'slime-innards'), 2); assert.equal(f.fishing.view('alice')!.baitId, undefined);
});

test('empty retrieval keeps gold and item bait mounted without duplicate refunds', () => {
  for (const item of ['gold', 'slime-innards']) for (const automatic of [false, true]) {
    const f = fixture(() => .99); f.open(); f.bait(item); f.cast();
    if (automatic) for (let i = 0; i < FISHING.emptyWaitMs / 100 + 1; i++) f.tick();
    else f.reel(true);
    assert.equal(f.fishing.view('alice')!.outcome, 'withdrawn');
    assert.equal(f.account.gold, item === 'gold' ? 9 : 10); assert.equal(inventoryCount(f.account.inventory!, 'slime-innards'), item === 'gold' ? 4 : 3);
    assert.equal(f.fishing.view('alice')!.baitId, item);
    f.reel(true); f.tick(); f.fishing.close('alice');
    assert.equal(f.account.gold, 10); assert.equal(inventoryCount(f.account.inventory!, 'slime-innards'), item === 'gold' ? 4 : 3);
    assert.deepEqual(f.drops, []);
  }
});

test('amplified distance uses comma decimals and reaches zero only at the landing threshold', () => {
  assert.equal(FISHING.catchDistanceM, 1.5);
  assert.equal(formatFishingDistance(2.6), '5,50');
  assert.equal(formatFishingDistance(2.499), '5,00');
  assert.equal(formatFishingDistance(1.5), '0,00');
  assert.equal(formatFishingDistance(1.1), '0,00');
  assert.equal(formatFishingDistance(1.501), '0,01');
  assert.equal(formatFishingDistance(1.50001), '0,01');
  assert.equal(formatFishingDistance(undefined), '—');
  const f = fixture(); f.open(); f.bait(); f.cast(); f.bite(); f.catchFish();
  assert.equal(f.fishing.view('alice')!.distanceM, 1.5);
  assert.equal(formatFishingDistance(f.fishing.view('alice')!.distanceM), '0,00');
});

test('one consumable bait supports exactly three valid casts and does not recharge when selected again', () => {
  const f = fixture(); f.open(); f.bait();
  assert.equal(f.fishing.view('alice')!.baitUsesRemaining, 3);
  assert.throws(() => f.cast(30), /acqua/); assert.equal(f.fishing.view('alice')!.baitUsesRemaining, 3);
  for (let remaining = 2; remaining >= 0; remaining--) {
    f.cast(); f.bite(); f.catchFish();
    assert.equal(inventoryCount(f.account.inventory!, 'slime-innards'), 3);
    if (remaining) { assert.equal(f.fishing.view('alice')!.baitUsesRemaining, remaining); f.bait(); assert.equal(f.fishing.view('alice')!.baitUsesRemaining, remaining); }
    else { assert.equal(f.fishing.view('alice')!.baitId, undefined); assert.throws(() => f.cast(), /esca/); }
  }
  assert.equal(inventoryCount(f.account.inventory!, 'fish-pike'), 3);
});

test('one- and two-use bait is destroyed on every session exit without a refund or ground drop', () => {
  for (const casts of [1, 2]) for (const exit of ['close', 'movement', 'combat', 'death', 'disconnect']) {
    const f = fixture(); f.open(); f.bait();
    for (let i = 0; i < casts; i++) { f.cast(); f.reel(true); }
    assert.equal(f.fishing.view('alice')!.baitUsesRemaining, 3 - casts);
    if (exit === 'close') f.fishing.close('alice');
    else { if (exit === 'movement') f.player.x += 40; if (exit === 'combat') f.setCombat(); if (exit === 'death') f.player.hp = 0; if (exit === 'disconnect') f.disconnect(); f.tick(); }
    assert.equal(f.fishing.view('alice'), null);
    assert.equal(inventoryCount(f.account.inventory!, 'slime-innards'), 3); assert.deepEqual(f.drops, []);
  }
});

test('used bait never spawns on the ground even if the bag is full', () => {
  const f = fixture(); f.open(); f.bait(); f.cast(); f.reel(true);
  insertItem(f.account.inventory!, 'healing-potion', 60); f.fishing.close('alice');
  assert.deepEqual(f.drops, []); assert.deepEqual(f.dropStacks, []);
  assert.equal(inventoryCount(f.account.inventory!, 'slime-innards'), 3);
});

test('switching used bait discards it, while an unused bait is returned intact', () => {
  const f = fixture(); f.open(); f.bait(); f.fishing.close('alice'); assert.equal(inventoryCount(f.account.inventory!, 'slime-innards'), 4);
  f.open(); f.bait(); f.cast(); f.reel(true); f.bait('gold');
  assert.equal(inventoryCount(f.account.inventory!, 'slime-innards'), 3); assert.deepEqual(f.drops, []);
  f.fishing.close('alice'); assert.equal(f.account.gold, 10);
});

test('gold supports repeated casts and is refunded only once when unmounted', () => {
  const f = fixture(); f.open(); f.bait('gold');
  for (let i = 0; i < 4; i++) { f.cast(); f.reel(true); assert.equal(f.fishing.view('alice')!.baitId, 'gold'); assert.equal(f.account.gold, 9); }
  f.fishing.close('alice'); f.fishing.close('alice'); assert.equal(f.account.gold, 10);
});
test('controlled recovery catches one fish, consumes one organic bait and never replays a catch', () => {
  const f = fixture(); f.open(); f.bait(); f.cast(); f.bite(); f.catchFish();
  assert.equal(inventoryCount(f.account.inventory!, 'slime-innards'), 3); assert.equal(inventoryCount(f.account.inventory!, 'fish-pike'), 1);
  f.reel(true); f.tick(); assert.equal(inventoryCount(f.account.inventory!, 'fish-pike'), 1);
  assert.deepEqual(f.feedback, ['consume:slime-innards', 'collect:fish-pike']);
});
test('gold lures remain reusable after a catch and are lost on failure', () => {
  const f = fixture(); f.open(); f.bait('gold'); f.cast(); f.bite(); f.catchFish();
  assert.equal(f.account.gold, 9); assert.equal(f.fishing.view('alice')!.baitId, 'gold');
  f.bait('gold'); assert.equal(f.account.gold, 9); f.cast(); f.bite(); for (let i = 0; i < 80 && f.fishing.view('alice')!.phase !== 'result'; i++) { f.reel(true); f.tick(); }
  assert.equal(f.fishing.view('alice')!.outcome, 'broken'); assert.equal(f.account.gold, 9);
});

test('bait profiles change species probabilities while fish size affects the fight', () => {
  for (const [item, slot, species] of [['gold', undefined, 'fish-pike'], ['slime-innards', 1, 'fish-catfish'], ['healing-potion', 2, 'fish-perch']] as const) {
    const f = fixture(() => .5); insertItem(f.account.inventory!, 'healing-potion', 1); f.open(); f.bait(item, slot); f.cast();
    for (let i = 0; i < 43; i++) f.tick(); f.reel(true);
    assert.equal(f.fishing.view('alice')!.fishId, species);
  }
});
test('full bags receive a private ground catch, and reel input expires without a client release', () => {
  const f = fixture(); insertItem(f.account.inventory!, 'healing-potion', 60); f.open(); f.bait('gold'); f.cast(); f.bite();
  f.reel(true); for (let i = 0; i < 10; i++) f.tick(); assert.equal(f.fishing.view('alice')!.reeling, false);
  f.catchFish(); assert.deepEqual(f.drops, ['fish-pike']); assert.equal(f.account.gold, 9);
  assert.deepEqual(f.dropTtls, [FISHING.catchDropTtlMs]);
});
test('combat, death, movement and disconnect end an active cast with the mounted bait consumed', () => {
  for (const reason of ['combat', 'death', 'movement', 'disconnect']) {
    const f = fixture(); f.open(); f.bait(); f.cast();
    if (reason === 'combat') f.setCombat(); if (reason === 'death') f.player.hp = 0; if (reason === 'movement') f.player.x += 40; if (reason === 'disconnect') f.disconnect();
    f.tick(); assert.equal(f.fishing.view('alice'), null); assert.equal(inventoryCount(f.account.inventory!, 'slime-innards'), 3);
  }
});

test('uncast bait is returned on close, bait switching is atomic and excluded objects are rejected', () => {
  const f = fixture(); insertItem(f.account.inventory!, 'backpack-2', 1); f.open();
  assert.throws(() => f.bait('backpack-2', 2), /esca/); assert.throws(() => f.bait('fishing-rod', 0), /esca/);
  f.bait(); assert.equal(inventoryCount(f.account.inventory!, 'slime-innards'), 3);
  f.bait(); assert.equal(inventoryCount(f.account.inventory!, 'slime-innards'), 3);
  f.bait('gold'); assert.equal(inventoryCount(f.account.inventory!, 'slime-innards'), 4); assert.equal(f.account.gold, 9);
  f.fishing.close('alice'); assert.equal(f.account.gold, 10);
});
test('slack below 55% increases distance then unhooks the fish without requiring zero tension', () => {
  const f = fixture(); f.open(); f.bait(); f.cast(); f.bite(); f.reel(true); f.reel(false);
  const start = f.fishing.view('alice')!.distanceM!;
  for (let i = 0; i < 40 && f.fishing.view('alice')!.phase === 'fight'; i++) f.tick();
  assert.equal(f.fishing.view('alice')!.outcome, 'escaped'); assert.ok(f.fishing.view('alice')!.distanceM! > start); assert.equal(inventoryCount(f.account.inventory!, 'slime-innards'), 3);
});
test('distance controls recovery duration; heavier fish recover slower and high tension increases recovery speed', () => {
  const durations = [168, 312].map(x => { const f = fixture(); f.open(); f.bait(); f.cast(x); f.bite(); return f.catchFish(); });
  assert.ok(durations[1] > durations[0] * 1.8);
  const fish = FISH[1]; assert.ok(fishingRecoverySpeed(.9, fish, 8) < fishingRecoverySpeed(.9, fish, 3));
  assert.ok(fishingRecoverySpeed(.9, fish, 8) > fishingRecoverySpeed(.6, fish, 8));
  const f = fixture(() => .5); f.open(); f.bait(); f.cast(); for (let i = 0; i < 43; i++) f.tick(); f.catchFish();
  assert.ok(f.fishing.view('alice')!.tension > .8); assert.equal(f.fishing.view('alice')!.rarity, 'rare');
});
test('casts can end with no bite and never award a fish', () => {
  const f = fixture(() => .99); f.open(); f.bait(); f.cast();
  for (let i = 0; i < FISHING.emptyWaitMs / 100 + 1; i++) f.tick();
  assert.equal(f.fishing.view('alice')!.noBite, true); assert.equal(f.fishing.view('alice')!.phase, 'result');
  assert.equal(f.account.inventory!.slots.some(stack => stack?.itemId.startsWith('fish-')), false);
});
test('simulation publishes only the owner’s fishing state and disables attack casts', () => {
  const f = fixture(); f.sim.now = 1_006_000;
  const other = { ...f.account, id: 'bob', name: 'Bob', nameLower: 'bob', characters: undefined, inventory: undefined, narrative: undefined };
  f.sim.addPlayer(other, 'mage');
  f.sim.interact('alice', { kind: 'fishing', command: { kind: 'open' } });
  assert.equal(f.sim.snapshotFor('alice')!.fishing!.phase, 'ready'); assert.equal(f.sim.snapshotFor('bob')!.fishing, null);
  f.sim.enqueueInput('alice', { seq: 1, dx: 0, dy: 0, aim: 0, cast: 'basic' }); f.sim.step(.1);
  assert.equal(f.player.cooldowns.basic, 0);
});
