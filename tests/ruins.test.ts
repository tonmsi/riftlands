import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore, type Account } from '../server/store';
import { WorldSimulation } from '../server/simulation';
import { RUINS, inRuins, ruinsRoadCenter } from '../shared/ruins';
import { World, chunkCoords } from '../shared/world';
import { collidesWorld, hasLineOfSight } from '../shared/physics';

const account = (id: string): Account => ({ id, name: id, nameLower: id, salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 });
function fixture(store?: AccountStore) {
  const aa = store ? store.register('Killer', 'test-password').account : account('killer');
  const bb = store ? store.register('Observer', 'test-password').account : account('observer');
  const sim = new WorldSimulation(734291, 1_000_000, store);
  const a = sim.addPlayer(aa, 'warrior'), b = sim.addPlayer(bb, 'mage');
  Object.assign(a, { x: RUINS.x, y: RUINS.y + 60, aim: -Math.PI / 2, spawnProtectedUntil: 0 });
  Object.assign(b, { x: RUINS.x + 100, y: RUINS.y + 80, spawnProtectedUntil: 0 });
  sim.step(0.1);
  const boss = sim.ruins!.boss;
  const kill = () => { boss.hp = 1; assert.equal(sim.cast(a, 'basic'), true); assert.equal(boss.hp, 0); };
  return { sim, a, b, aa, bb, boss, kill };
}
function advance(sim: WorldSimulation, seconds: number) { for (let i = 0; i < Math.round(seconds * 10); i++) sim.step(0.1); }

test('boss death creates private physical loot; observer only sees corpse and cannot collect', () => {
  const { sim, a, b, aa, bb, boss, kill } = fixture();
  kill();
  assert.equal(aa.gold ?? 0, 0);
  assert.equal(sim.snapshotFor(a.id)!.goldDrops!.length, 1);
  assert.equal(sim.snapshotFor(b.id)!.goldDrops!.length, 0);
  assert.equal(sim.snapshotFor(b.id)!.actors.find(actor => actor.id === RUINS.bossId)!.hp, 0);
  Object.assign(b, { x: boss.x, y: boss.y }); advance(sim, 1);
  assert.equal(bb.gold ?? 0, 0);
  assert.equal(sim.ruins!.state.drops.length, 1);
  Object.assign(b, { x: boss.x + 100, y: boss.y + 80 });
  Object.assign(a, { x: boss.x, y: boss.y }); sim.step();
  assert.equal(aa.gold, RUINS.gold);
  assert.equal(sim.ruins!.state.drops.length, 0);
  advance(sim, 1);
  assert.equal(aa.gold, RUINS.gold);
});

test('disconnected and dead owners cannot collect; reconnect preserves ownership', () => {
  const { sim, a, aa, boss, kill } = fixture(); kill();
  Object.assign(a, { x: boss.x, y: boss.y }); sim.disconnectPlayer(a.id); advance(sim, 1);
  assert.equal(aa.gold ?? 0, 0);
  sim.addPlayer(aa, 'warrior'); a.hp = 0; a.deadUntil = sim.now + 5000; sim.step();
  assert.equal(aa.gold ?? 0, 0);
  a.hp = a.maxHp; a.deadUntil = 0; sim.step();
  assert.equal(aa.gold, RUINS.gold);
});

test('corpse survives chunk eviction; boss respawns only after sixty seconds', () => {
  const { sim, a, b, boss, kill } = fixture(); kill();
  Object.assign(a, { x: 0, y: 0 }); Object.assign(b, { x: 60, y: 60 });
  advance(sim, 59);
  assert.equal(boss.hp, 0);
  assert.equal(sim.npcs.get(RUINS.bossId), boss);
  Object.assign(a, { x: RUINS.x, y: RUINS.y + 200 }); sim.step(0.1);
  assert.equal(sim.snapshotFor(a.id)!.actors.find(actor => actor.id === RUINS.bossId)!.hp, 0);
  advance(sim, 1);
  assert.equal(boss.hp, RUINS.hp);
  assert.equal(boss.deadUntil, 0);
  assert.equal(sim.ruins!.state.drops.length, 1);
});

test('unclaimed loot expires without becoming public or crediting anyone', () => {
  const { sim, a, b, aa, bb, kill } = fixture(); kill();
  Object.assign(a, { x: 0, y: 0 }); Object.assign(b, { x: 60, y: 60 }); advance(sim, 121);
  assert.equal(sim.ruins!.state.drops.length, 0);
  assert.equal(aa.gold ?? 0, 0); assert.equal(bb.gold ?? 0, 0);
});

test('disk restart preserves corpse, timer and loot; collection commits wallet and removal together', () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-loot-'));
  try {
    const path = join(directory, 'accounts.json');
    const store = new AccountStore(path);
    const { sim, a, aa, kill } = fixture(store); kill();
    const end = sim.ruins!.state.respawnAt;
    const restoredStore = new AccountStore(path);
    const restored = new WorldSimulation(734291, sim.now + 1000, restoredStore);
    assert.equal(restored.ruins!.boss.hp, 0);
    assert.equal(restored.ruins!.state.respawnAt, end);
    const owner = restored.addPlayer(restoredStore.accounts.get(a.id)!, 'warrior');
    Object.assign(owner, restored.ruins!.state.corpse); restored.step();
    const saved = new AccountStore(path);
    assert.equal(saved.accounts.get(aa.id)!.gold, RUINS.gold);
    assert.equal(saved.ruins!.drops.length, 0);
    const secondRestart = new WorldSimulation(734291, restored.now + 1000, saved);
    const again = secondRestart.addPlayer(saved.accounts.get(aa.id)!, 'warrior');
    Object.assign(again, secondRestart.ruins!.state.corpse); secondRestart.step();
    assert.equal(saved.accounts.get(aa.id)!.gold, RUINS.gold);
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
  for (const mode of ['arena', 'battleground'] as const) assert.equal(new WorldSimulation(734291, 0, undefined, mode).ruins, undefined);
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
    if (sim.ruins!.windup) seen.add(sim.ruins!.windup.kind);
  }
  assert.deepEqual([...seen].sort(), ['charge', 'nova', 'slam']);
});

test('heavy attack is telegraphed, deals no early damage and can be dodged', () => {
  const { sim, a, b, boss } = fixture();
  Object.assign(b, { x: 0, y: 0 });
  Object.assign(a, { x: boss.x, y: boss.y + 120 });
  for (let i = 0; i < 60 && !sim.ruins!.windup; i++) sim.step(0.1);
  assert.ok(sim.ruins!.windup);
  const hp = a.hp;
  sim.step(0.1);
  assert.equal(a.hp, hp);
  const resolves = sim.ruins!.windup!.resolvesAt;
  Object.assign(a, { x: boss.x + 250, y: boss.y });
  while (sim.now <= resolves + 100) sim.step(0.1);
  assert.equal(a.hp, hp);
});
