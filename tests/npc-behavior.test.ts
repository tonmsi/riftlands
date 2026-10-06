import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldSimulation } from '../server/simulation';
import { World, chunkCoords } from '../shared/world';
import { newWorldDocument } from '../shared/world-schema';
import { NPC_COMBAT, type NpcKind } from '../shared/npcs';
import type { Actor } from '../shared/types';
import { engineBundle } from './fixtures/dungeon-engine';

function fixture(kinds: NpcKind[] = ['sentinel'], dungeon = false) {
  const bundle = dungeon ? engineBundle() : undefined;
  const document = newWorldDocument();
  const world = new World(document.seed, 16, 'world', document, bundle ? [bundle.definition] : []);
  world.getTile = () => 'grass';
  const origin = bundle?.definition.spawnPoints.party[0] ?? { x: 0, y: 0 };
  const spawns = kinds.map((npcKind, index) => ({ id: `${bundle ? `dungeon:${bundle.definition.id}:` : ''}mob-${index}`, npcKind,
    x: origin.x + 40 + index * 100, y: origin.y, level: 1 }));
  const { cx, cy } = chunkCoords(origin.x, origin.y);
  // A single authored population, without procedural mobs or pickups.
  world.getChunk = (x, y) => ({ cx: x, cy: y, key: `${x},${y}`, tiles: [], npcs: x === cx && y === cy ? spawns : [], pickups: [] });
  const sim = new WorldSimulation(document.seed, 1_000_000, undefined, 'world', { world, spawn: origin,
    dungeons: bundle ? [bundle.definition] : [], bosses: new Map(bundle?.bosses.map(boss => [boss.id, boss]) ?? []) });
  const player = sim.addPlayer({ id: 'alice', name: 'Alice', nameLower: 'alice', salt: '', passwordHash: '', xp: 0,
    kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 }, 'warrior');
  Object.assign(player, origin, { spawnProtectedUntil: 0 });
  sim.step(.01);
  const mobs = spawns.map(spawn => sim.npcs.get(spawn.id)!);
  for (const mob of mobs) sim.npcMeta.get(mob.id)!.nextAttack = sim.now;
  const internal = sim as unknown as { rebuildCells(): void; stepNpcs(dt: number): void; damage(target: Actor, attacker: Actor, amount: number): boolean; resetDungeonMobs(): void; pruneCaches(): void; updateChunks(): void };
  const advance = (ms: number) => { sim.now += ms; internal.rebuildCells(); internal.stepNpcs(ms / 1000); };
  const damage = (mob: Actor, amount = 1) => internal.damage(mob, player, amount);
  return { sim, player, mobs, advance, damage, internal, bundle };
}

for (const kind of ['slime', 'sentinel'] as const) test(`${kind} stops before its species-specific melee windup, and cancels if the target leaves`, () => {
  const { sim, player, mobs: [mob], advance, damage } = fixture([kind]);
  if (kind === 'slime') damage(mob);
  const hp = player.hp, position = { x: mob.x, y: mob.y };
  advance(1);
  assert.equal(player.hp, hp);
  advance(NPC_COMBAT[kind].windupMs - 1);
  assert.equal(player.hp, hp);
  assert.deepEqual({ x: mob.x, y: mob.y }, position);
  advance(1);
  assert.ok(player.hp < hp);
  const injured = player.hp;
  advance(NPC_COMBAT[kind].cooldownMs);
  player.x -= 100;
  advance(NPC_COMBAT[kind].windupMs);
  assert.equal(player.hp, injured);
  assert.equal(sim.npcMeta.get(mob.id)!.windup, undefined);
});

test('a chasing melee mob cannot damage before it stops and completes its pause', () => {
  const { player, mobs: [mob], advance } = fixture();
  mob.x = 100;
  const hp = player.hp;
  for (let i = 0; i < 4; i++) { advance(100); assert.equal(player.hp, hp); }
  assert.ok(mob.x > NPC_COMBAT.sentinel.attackRange);
  advance(100); // Arrives in reach this tick, still moving.
  assert.equal(player.hp, hp);
  advance(1); // Starts the stationary windup.
  advance(NPC_COMBAT.sentinel.windupMs - 1);
  assert.equal(player.hp, hp);
  advance(1);
  assert.ok(player.hp < hp);
});

test('ranged mobs fire immediately without a melee windup', () => {
  const { sim, mobs: [mob], advance } = fixture(['wisp']);
  advance(1);
  assert.equal(sim.projectiles.size, 1);
  assert.equal(sim.npcMeta.get(mob.id)!.windup, undefined);
});

test('slimes ignore proximity; a lethal hit provokes only nearby slimes, which calm down after the attacker leaves', () => {
  const { sim, player, mobs, advance, damage } = fixture(['slime', 'slime', 'slime', 'slime', 'slime']);
  const hp = player.hp, positions = mobs.map(mob => mob.x);
  advance(2000);
  assert.equal(player.hp, hp);
  assert.deepEqual(mobs.map(mob => mob.x), positions);
  damage(mobs[0], 999);
  for (const mob of mobs.slice(1, 4)) assert.equal(sim.npcMeta.get(mob.id)!.aggroTargetId, player.id);
  assert.equal(sim.npcMeta.get(mobs[4].id)!.aggroTargetId, undefined);
  player.x -= 1000;
  advance(1);
  for (const mob of mobs) assert.equal(sim.npcMeta.get(mob.id)!.aggroTargetId, undefined);
});

test('world corpses remain for two minutes, then respawn without aggro', () => {
  const { sim, mobs: [mob], advance, damage } = fixture(['slime']);
  damage(mob, 999);
  assert.equal(mob.deadUntil - sim.now, NPC_COMBAT.slime.respawnMs);
  advance(NPC_COMBAT.slime.respawnMs - 1);
  assert.equal(mob.hp, 0);
  advance(1);
  assert.equal(mob.hp, mob.maxHp);
  assert.equal(sim.npcMeta.get(mob.id)!.aggroTargetId, undefined);
});

test('dungeon corpses survive idle boss ticks and unload/cache expiry; a wipe resets them', () => {
  const { sim, player, mobs: [mob], damage, internal, bundle } = fixture(['sentinel'], true);
  assert.ok(mob);
  damage(mob, 999);
  const encounter = sim.bosses.get(bundle!.definition.bossId)!;
  encounter.step(sim.now + 180_000, .01, [], () => false, sim.world, () => {});
  internal.resetDungeonMobs();
  assert.equal(mob.hp, 0); // An idle boss resetting its pose is not a dungeon reset.
  player.x -= 10_000;
  sim.now += 25_000; internal.updateChunks();
  assert.equal(sim.npcs.has(mob.id), false);
  sim.now += 400_000; internal.pruneCaches();
  Object.assign(player, bundle!.definition.spawnPoints.party[0]);
  internal.updateChunks();
  assert.equal(sim.npcs.get(mob.id)!.hp, 0);
  encounter.ownerId = player.id; encounter.participantIds.add(player.id);
  encounter.participantDied(player.id, sim.world);
  internal.resetDungeonMobs();
  assert.equal(sim.npcs.get(mob.id)!.hp, mob.maxHp);
});

test('dungeon mobs respawn with the boss after the completed dungeon cooldown', () => {
  const { sim, mobs: [mob], damage, internal, bundle } = fixture(['sentinel'], true);
  damage(mob, 999);
  const encounter = sim.bosses.get(bundle!.definition.bossId)!;
  encounter.boss.hp = 0; encounter.state.respawnAt = sim.now + 100;
  encounter.step(sim.now + 99, .01, [], () => false, sim.world, () => {});
  internal.resetDungeonMobs(); assert.equal(mob.hp, 0);
  encounter.step(sim.now + 100, .01, [], () => false, sim.world, () => {});
  internal.resetDungeonMobs(); assert.equal(mob.hp, mob.maxHp);
});
