import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore, type Account } from '../server/store';
import { WorldSimulation } from '../server/simulation';
import { RUINS, inRuins, ruinsRoadCenter } from '../shared/ruins';
import { RUINS_WARDEN } from '../shared/bosses';
import { World, chunkCoords } from '../shared/world';
import { collidesWorld, hasLineOfSight, moveWithCollisions } from '../shared/physics';

const account = (id: string): Account => ({ id, name: id, nameLower: id, salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 });
function fixture(store?: AccountStore) {
  const aa = store ? store.register('Killer', 'test-password').account : account('killer');
  const bb = store ? store.register('Observer', 'test-password').account : account('observer');
  const sim = new WorldSimulation(734291, 1_000_000, store);
  const a = sim.addPlayer(aa, 'warrior'), b = sim.addPlayer(bb, 'mage');
  Object.assign(a, { x: RUINS.x, y: RUINS.y + 60, aim: -Math.PI / 2, spawnProtectedUntil: 0 });
  Object.assign(b, { x: RUINS.x + 100, y: RUINS.y + 80, spawnProtectedUntil: 0 });
  sim.step(0.1);
  const encounter = sim.bosses.get(RUINS_WARDEN.id)!;
  const boss = encounter.boss;
  const kill = () => { boss.hp = 1; assert.equal(sim.cast(a, 'basic'), true); assert.equal(boss.hp, 0); };
  return { sim, a, b, aa, bb, boss, encounter, kill };
}
function advance(sim: WorldSimulation, seconds: number) { for (let i = 0; i < Math.round(seconds * 10); i++) sim.step(0.1); }

test('boss death creates private physical loot; observer only sees corpse and cannot collect', () => {
  const { sim, a, b, aa, bb, boss, kill } = fixture();
  kill();
  assert.equal(aa.gold ?? 0, 0);
  assert.equal(sim.snapshotFor(a.id)!.goldDrops!.length, 1);
  assert.equal(sim.snapshotFor(b.id)!.goldDrops!.length, 0);
  assert.equal(sim.snapshotFor(b.id)!.actors.find(actor => actor.id === RUINS_WARDEN.id)!.hp, 0);
  Object.assign(b, { x: boss.x, y: boss.y }); advance(sim, 1);
  assert.equal(bb.gold ?? 0, 0);
  assert.equal(sim.bosses.get(RUINS_WARDEN.id)!.state.drops.length, 1);
  Object.assign(b, { x: boss.x + 100, y: boss.y + 80 });
  Object.assign(a, { x: boss.x, y: boss.y }); sim.step();
  assert.equal(aa.gold, RUINS_WARDEN.reward.gold);
  assert.equal(sim.bosses.get(RUINS_WARDEN.id)!.state.drops.length, 0);
  advance(sim, 1);
  assert.equal(aa.gold, RUINS_WARDEN.reward.gold);
});

test('disconnected and dead owners cannot collect; reconnect preserves ownership', () => {
  const { sim, a, aa, boss, kill } = fixture(); kill();
  Object.assign(a, { x: boss.x, y: boss.y }); sim.disconnectPlayer(a.id); advance(sim, 1);
  assert.equal(aa.gold ?? 0, 0);
  sim.addPlayer(aa, 'warrior'); a.hp = 0; a.deadUntil = sim.now + 5000; sim.step();
  assert.equal(aa.gold ?? 0, 0);
  a.hp = a.maxHp; a.deadUntil = 0; sim.step();
  assert.equal(aa.gold, RUINS_WARDEN.reward.gold);
});

test('corpse survives chunk eviction; boss respawns only after sixty seconds', () => {
  const { sim, a, b, boss, kill } = fixture(); kill();
  Object.assign(a, { x: 0, y: 0 }); Object.assign(b, { x: 60, y: 60 });
  advance(sim, 59);
  assert.equal(boss.hp, 0);
  assert.equal(sim.npcs.get(RUINS_WARDEN.id), boss);
  Object.assign(a, { x: RUINS.x, y: RUINS.y + 200 }); sim.step(0.1);
  assert.equal(sim.snapshotFor(a.id)!.actors.find(actor => actor.id === RUINS_WARDEN.id)!.hp, 0);
  advance(sim, 1);
  assert.equal(boss.hp, RUINS_WARDEN.hp);
  assert.equal(boss.deadUntil, 0);
  assert.equal(sim.bosses.get(RUINS_WARDEN.id)!.state.drops.length, 1);
});

test('unclaimed loot expires without becoming public or crediting anyone', () => {
  const { sim, a, b, aa, bb, kill } = fixture(); kill();
  Object.assign(a, { x: 0, y: 0 }); Object.assign(b, { x: 60, y: 60 }); advance(sim, 121);
  assert.equal(sim.bosses.get(RUINS_WARDEN.id)!.state.drops.length, 0);
  assert.equal(aa.gold ?? 0, 0); assert.equal(bb.gold ?? 0, 0);
});

test('disk restart preserves corpse, timer and loot; collection commits wallet and removal together', () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-loot-'));
  try {
    const path = join(directory, 'accounts.json');
    const store = new AccountStore(path);
    const { sim, a, aa, kill } = fixture(store); kill();
    const end = sim.bosses.get(RUINS_WARDEN.id)!.state.respawnAt;
    const restoredStore = new AccountStore(path);
    const restored = new WorldSimulation(734291, sim.now + 1000, restoredStore);
    assert.equal(restored.bosses.get(RUINS_WARDEN.id)!.boss.hp, 0);
    assert.equal(restored.bosses.get(RUINS_WARDEN.id)!.state.respawnAt, end);
    const owner = restored.addPlayer(restoredStore.accounts.get(a.id)!, 'warrior');
    Object.assign(owner, restored.bosses.get(RUINS_WARDEN.id)!.state.corpse); restored.step();
    const saved = new AccountStore(path);
    assert.equal(saved.accounts.get(aa.id)!.gold, RUINS_WARDEN.reward.gold);
    assert.equal(saved.bossStates[RUINS_WARDEN.id].drops.length, 0);
    const secondRestart = new WorldSimulation(734291, restored.now + 1000, saved);
    const again = secondRestart.addPlayer(saved.accounts.get(aa.id)!, 'warrior');
    Object.assign(again, secondRestart.bosses.get(RUINS_WARDEN.id)!.state.corpse); secondRestart.step();
    assert.equal(saved.accounts.get(aa.id)!.gold, RUINS_WARDEN.reward.gold);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('old JSON accounts default to zero gold and malformed balances fail closed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-gold-schema-'));
  try {
    const path = join(directory, 'accounts.json');
    const store = new AccountStore(path); store.register('OldAccount', 'test-password');
    const original = JSON.parse(readFileSync(path, 'utf8'));
    delete original.accounts[0].gold;
    writeFileSync(path, JSON.stringify(original));
    assert.equal([...new AccountStore(path).accounts.values()][0].gold, 0);
    original.accounts[0].gold = -1; writeFileSync(path, JSON.stringify(original));
    assert.throws(() => new AccountStore(path), /Saldo gold/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('legacy single-ruins JSON migrates to the generic boss-state map without losing loot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-boss-migration-'));
  try {
    const path = join(directory, 'accounts.json'), store = new AccountStore(path);
    const { kill } = fixture(store); kill();
    const legacy = JSON.parse(readFileSync(path, 'utf8'));
    legacy.ruins = legacy.bosses[RUINS_WARDEN.id];
    for (const drop of legacy.ruins.drops) delete drop.bossId;
    delete legacy.bosses;
    writeFileSync(path, JSON.stringify(legacy));
    const migrated = new AccountStore(path);
    assert.equal(migrated.bossStates[RUINS_WARDEN.id].drops.length, 1);
    assert.equal(migrated.bossStates[RUINS_WARDEN.id].drops[0].bossId, RUINS_WARDEN.id);
    migrated.flush();
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    assert.ok(saved.bosses[RUINS_WARDEN.id]); assert.equal(saved.ruins, undefined);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('ruins terrain has a winding walkable road, solid ruins and no procedural spawns in the courtyard', () => {
  const world = new World();
  let oldStraightTiles = 0, samples = 0;
  for (let y = -350; y >= RUINS.y + 350; y -= 48) {
    assert.equal(collidesWorld(ruinsRoadCenter(y), y, 15, world), false);
    oldStraightTiles += Number(world.getTile(0, Math.floor(y / 48)) === 'path'); samples++;
  }
  assert.ok(oldStraightTiles < samples * 0.7, 'the old straight north strip must not remain the primary route');
  assert.equal(collidesWorld(RUINS.x, RUINS.y, 28, world), false);
  assert.equal(hasLineOfSight({ x: -250, y: RUINS.y - 120 }, { x: 0, y: RUINS.y - 120 }, world), false);
  const center = chunkCoords(RUINS.x, RUINS.y);
  for (let cx = center.cx - 1; cx <= center.cx + 1; cx++) for (let cy = center.cy - 1; cy <= center.cy + 1; cy++) {
    const chunk = world.getChunk(cx, cy);
    for (const spawn of [...chunk.npcs, ...chunk.pickups]) assert.equal(inRuins(spawn, 220), false);
  }
  for (const mode of ['arena', 'battleground'] as const) assert.equal(new WorldSimulation(734291, 0, undefined, mode).bosses.size, 0);
});

test('boss navigates around a pillar even without initial line of sight', () => {
  const { sim, a, b, boss } = fixture();
  Object.assign(b, { x: 0, y: 0 });
  Object.assign(boss, { x: -250, y: RUINS.y - 120 });
  Object.assign(a, { x: 0, y: RUINS.y - 120 });
  assert.equal(hasLineOfSight(boss, a, sim.world), false);
  const initial = Math.hypot(a.x - boss.x, a.y - boss.y);
  advance(sim, 3);
  assert.ok(Math.hypot(a.x - boss.x, a.y - boss.y) < initial);
  assert.ok(hasLineOfSight(boss, a, sim.world));
});

test('boss rotates through slam, charge and nova telegraphs', () => {
  const { sim, a, b, boss } = fixture();
  Object.assign(b, { x: 0, y: 0 });
  const seen = new Set<string>();
  for (let i = 0; i < 350 && seen.size < 3; i++) {
    Object.assign(a, { x: boss.x + 64, y: boss.y, hp: a.maxHp, deadUntil: 0 });
    sim.step(0.1);
    const windup = sim.bosses.get(RUINS_WARDEN.id)!.windup;
    if (windup) seen.add(windup.kind);
  }
  assert.deepEqual([...seen].sort(), ['charge', 'nova', 'slam']);
});

test('first entrant seals the arena: owner stays inside and every other player stays outside', () => {
  const { sim, a, b, boss, encounter } = fixture();
  assert.equal(encounter.ownerId, a.id);
  assert.deepEqual(sim.snapshotFor(a.id)!.bossLocks, [{ bossId: RUINS_WARDEN.id, locked: true, ownerId: a.id }]);
  for (const tile of RUINS_WARDEN.arena.sealedTiles) assert.equal(sim.world.getTile(tile.x, tile.y), 'rock');

  Object.assign(a, moveWithCollisions(a, 0, 1, 900, sim.world));
  assert.equal(inRuins(a), true, 'the owner must not cross the sealed southern entrance');
  Object.assign(b, RUINS_WARDEN.arena.exit);
  Object.assign(b, moveWithCollisions(b, 0, -1, 900, sim.world));
  assert.equal(inRuins(b), false, 'an outsider must not cross into the sealed arena');

  const hp = boss.hp;
  Object.assign(b, { aim: -Math.PI / 2 });
  assert.equal(sim.cast(b, 'basic'), true); advance(sim, 1);
  assert.equal(boss.hp, hp, 'only the encounter owner can damage the boss');
});

test('victory opens the room; owner death fails and resets the encounter', () => {
  const won = fixture(); won.kill();
  assert.equal(won.encounter.ownerId, undefined);
  for (const tile of RUINS_WARDEN.arena.sealedTiles) assert.equal(won.sim.world.getTile(tile.x, tile.y), 'path');

  const failed = fixture();
  failed.boss.hp = 100;
  failed.a.hp = 0; failed.a.deadUntil = failed.sim.now + 5000;
  failed.sim.step();
  assert.equal(failed.encounter.ownerId, undefined);
  assert.equal(failed.boss.hp, RUINS_WARDEN.hp);
  for (const tile of RUINS_WARDEN.arena.sealedTiles) assert.equal(failed.sim.world.getTile(tile.x, tile.y), 'path');
});

test('reconnect within grace keeps the lock; disconnect expiry opens and resets the room', () => {
  const { sim, a, aa, boss, encounter } = fixture();
  a.hp = a.maxHp = 10_000;
  sim.disconnectPlayer(a.id); advance(sim, 19);
  assert.equal(encounter.ownerId, a.id);
  sim.addPlayer(aa, 'warrior');
  assert.equal(encounter.ownerId, a.id);
  sim.disconnectPlayer(a.id); advance(sim, 21);
  assert.equal(encounter.ownerId, undefined);
  assert.equal(boss.hp, RUINS_WARDEN.hp);
  assert.equal(sim.world.isBossLocked(RUINS_WARDEN.id), false);
});

test('heavy attack is telegraphed, deals no early damage and can be dodged', () => {
  const { sim, a, b, boss } = fixture();
  Object.assign(b, { x: 0, y: 0 });
  Object.assign(a, { x: boss.x, y: boss.y + 120 });
  const encounter = sim.bosses.get(RUINS_WARDEN.id)!;
  for (let i = 0; i < 60 && !encounter.windup; i++) sim.step(0.1);
  assert.ok(encounter.windup);
  const hp = a.hp;
  sim.step(0.1);
  assert.equal(a.hp, hp);
  const resolves = encounter.windup!.resolvesAt;
  Object.assign(a, { x: boss.x + 250, y: boss.y });
  while (sim.now <= resolves + 100) sim.step(0.1);
  assert.equal(a.hp, hp);
});
