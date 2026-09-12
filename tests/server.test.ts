import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLASSES, DT } from '../shared/config';
import type { Actor, ClassId } from '../shared/types';
import { AccountStore, type Account } from '../server/store';
import { sweptWorldHit, WorldSimulation } from '../server/simulation';

const account = (id: string): Account => ({
  id,
  name: id,
  nameLower: id.toLowerCase(),
  salt: 'a'.repeat(32),
  passwordHash: 'b'.repeat(128),
  xp: 0,
  kills: 0,
  deaths: 0,
  friends: [],
  requests: [],
  lastSeen: 0
});

function arena(aClass: ClassId = 'mage', bClass: ClassId = 'warrior') {
  const simulation = new WorldSimulation(734291, 1_000_000);
  simulation.world.getTile = () => 'grass';
  simulation.world.getChunk = (cx, cy) => ({ cx, cy, key: `${cx},${cy}`, tiles: [], npcs: [], pickups: [] });
  const aAccount = account('alice'), bAccount = account('bob');
  const a = simulation.addPlayer(aAccount, aClass), b = simulation.addPlayer(bAccount, bClass);
  Object.assign(a, { x: 0, y: 0, spawnProtectedUntil: 0, aim: 0 });
  Object.assign(b, { x: 60, y: 0, spawnProtectedUntil: 0, aim: Math.PI });
  simulation.step();
  return { simulation, a, b, aAccount, bAccount };
}

function advance(simulation: WorldSimulation, seconds: number) {
  for (let i = 0; i < Math.ceil(seconds / DT); i++) simulation.step();
}

function team(simulation: WorldSimulation, a: Actor, b: Actor) {
  simulation.socialAction(a.id, 'team-invite', b.id);
  simulation.socialAction(b.id, 'team-accept', a.id);
}

test('authoritative inputs are finite, sequenced and processed at most once per server tick', () => {
  const { simulation, a } = arena();
  assert.equal(simulation.enqueueInput(a.id, { seq: 1, dx: NaN, dy: 0, aim: 0 }), false);
  assert.equal(simulation.enqueueInput(a.id, { seq: 1, dx: 2, dy: 0, aim: 0 }), false);
  assert.equal(simulation.enqueueInput(a.id, { seq: 1_000_000, dx: 1, dy: 0, aim: 0 }), false);
  const start = a.x;
  for (let seq = 1; seq <= 100; seq++) assert.equal(simulation.enqueueInput(a.id, { seq, dx: -1, dy: 0, aim: 0 }), true);
  simulation.step();
  assert.ok(Math.abs(a.x - start) <= a.speed * DT + 0.01);
  assert.equal(simulation.snapshotFor(a.id)!.ack, 95);
  assert.equal(simulation.enqueueInput(a.id, { seq: 99, dx: -1, dy: 0, aim: 0 }), false);
});

test('input casts are consumed by the authoritative tick and mana/cooldowns prevent repeated casts', () => {
  const { simulation, a } = arena();
  const mana = a.resource;
  simulation.enqueueInput(a.id, { seq: 1, dx: 0, dy: 0, aim: 0, cast: 'q' });
  simulation.step();
  assert.equal(a.resource, mana - CLASSES.mage.abilities.q.cost);
  assert.ok(a.cooldowns.q > simulation.now);
  assert.equal(simulation.cast(a, 'q'), false);
  a.resource = 0;
  assert.equal(simulation.cast(a, 'e'), false);
  assert.ok(simulation.events.some(event => event.kind === 'cast'));
});

test('projectiles apply damage once and the frost projectile slows its target', () => {
  const { simulation, a, b } = arena();
  const hp = b.hp;
  simulation.cast(a, 'q');
  advance(simulation, 0.3);
  assert.ok(b.hp < hp);
  assert.ok(b.effects.some(effect => effect.kind === 'slow'));
  assert.equal(simulation.projectiles.size, 0);
  const after = b.hp;
  advance(simulation, 0.5);
  assert.equal(b.hp, after);
});

test('swept projectile collision stops at walls before actors behind them', () => {
  const { simulation, a, b } = arena();
  b.x = 170;
  simulation.world.getTile = tx => tx === 1 ? 'rock' : 'grass';
  simulation.step();
  const hp = b.hp;
  simulation.cast(a, 'basic');
  advance(simulation, 0.7);
  assert.equal(b.hp, hp);
  assert.equal(simulation.projectiles.size, 0);
});

test('exact circular world sweeps detect grazing corners and stop diagonal dashes at the first wall', () => {
  const { simulation, a, b } = arena('warrior');
  b.x = 1000;
  simulation.world.getTile = (tx, ty) => tx === 1 && ty === 1 ? 'rock' : 'grass';
  const hit = sweptWorldHit({ x: 20, y: 47 }, { x: 80, y: 47 }, 2, simulation.world);
  assert.ok(hit !== null && hit < 0.5);
  a.aim = Math.PI / 4;
  simulation.cast(a, 'e');
  assert.ok(a.x < 48 && a.y < 48);
});

test('warrior generates rage from hits, spends it on abilities and decays out of combat', () => {
  const { simulation, a, b } = arena('warrior', 'paladin');
  assert.equal(simulation.cast(a, 'q'), false);
  simulation.cast(a, 'basic');
  assert.equal(a.resource, 12);
  a.cooldowns.basic = 0;
  simulation.cast(a, 'basic');
  a.cooldowns.basic = 0;
  simulation.cast(a, 'basic');
  assert.equal(a.resource, 36);
  assert.equal(simulation.cast(a, 'q'), true);
  assert.equal(a.resource, 23);
  b.x = 500;
  advance(simulation, 7);
  assert.ok(a.resource < 23);
});

test('melee detects overlapping hitboxes across a spatial bucket boundary', () => {
  const { simulation, a, b } = arena('warrior', 'mage');
  a.x = 115; b.x = 200;
  simulation.step();
  const hp = b.hp;
  simulation.cast(a, 'basic');
  assert.ok(b.hp < hp, 'The target hitbox intersects the cone even when its centre is in the next bucket');
});

test('dash stops before another character and damages first enemy contact', () => {
  const { simulation, a, b } = arena('warrior');
  b.x = 100;
  simulation.step();
  const hp = b.hp;
  simulation.cast(a, 'e');
  assert.ok(a.x <= b.x - a.radius - b.radius);
  assert.ok(b.hp < hp);
  assert.ok(a.x > 60);
});

test('team invitations require consent and block friendly melee/projectile damage', () => {
  const { simulation, a, b } = arena('warrior', 'mage');
  simulation.socialAction(a.id, 'team-invite', b.id);
  assert.equal(b.teamId, null);
  assert.equal(simulation.socialFor(b.id).teamInvites.length, 1);
  simulation.socialAction(b.id, 'team-accept', a.id);
  assert.equal(a.teamId, b.teamId);
  const hp = b.hp;
  simulation.cast(a, 'basic');
  assert.equal(b.hp, hp);
  const selfHp = a.hp;
  simulation.cast(b, 'basic');
  advance(simulation, 0.3);
  assert.equal(a.hp, selfHp);
});

test('paladin heals nearby teammates and the shield reduces incoming damage by 60 percent', () => {
  const { simulation, a, b } = arena('paladin', 'mage');
  team(simulation, a, b);
  a.hp -= 60;
  b.hp -= 60;
  simulation.cast(a, 'e');
  assert.equal(a.hp, a.maxHp - 22);
  assert.equal(b.hp, b.maxHp - 22);
  simulation.cast(a, 'r');
  assert.ok(a.effects.some(effect => effect.kind === 'shield'));
  assert.ok(b.effects.some(effect => effect.kind === 'shield'));
  simulation.socialAction(b.id, 'team-leave');
  const hp = b.hp;
  simulation.cast(a, 'basic');
  assert.equal(hp - b.hp, Math.round(CLASSES.paladin.abilities.basic.damage * (1 - CLASSES.mage.armor) * 0.4));
});

test('death records kills and XP, then respawns with temporary protection removed on attack', () => {
  const { simulation, a, b, aAccount, bAccount } = arena('warrior', 'mage');
  b.hp = 1;
  simulation.cast(a, 'basic');
  assert.equal(b.hp, 0);
  assert.equal(aAccount.kills, 1);
  assert.equal(bAccount.deaths, 1);
  assert.equal(aAccount.xp, 50);
  advance(simulation, 5.1);
  assert.equal(b.hp, b.maxHp);
  assert.ok(b.spawnProtectedUntil > simulation.now);
  simulation.cast(b, 'basic');
  assert.equal(b.spawnProtectedUntil, 0);
});

test('friend requests require explicit acceptance and persist reciprocal friendships', () => {
  const { simulation, a, b, aAccount, bAccount } = arena();
  assert.throws(() => simulation.socialAction(b.id, 'friend-accept', a.id));
  simulation.socialAction(a.id, 'friend-request', b.id);
  assert.deepEqual(bAccount.requests, [a.id]);
  assert.deepEqual(aAccount.friends, []);
  simulation.socialAction(b.id, 'friend-accept', a.id);
  assert.deepEqual(aAccount.friends, [b.id]);
  assert.deepEqual(bAccount.friends, [a.id]);
  simulation.socialAction(a.id, 'friend-remove', b.id);
  assert.deepEqual(aAccount.friends, []);
  assert.deepEqual(bAccount.friends, []);
});

test('disconnect keeps a combat body for 20 seconds; reconnect and class changes cannot heal it', () => {
  const { simulation, a, aAccount } = arena();
  a.hp = 22;
  a.resource = 30;
  a.cooldowns.q = simulation.now + 9000;
  const position = { x: a.x, y: a.y };
  simulation.disconnectPlayer(a.id);
  advance(simulation, 1);
  assert.equal(simulation.players.has(a.id), true);
  const sameBody = simulation.addPlayer(aAccount, 'warrior');
  assert.equal(sameBody, a);
  assert.equal(a.hp, 34);
  assert.equal(a.resource, 0);
  assert.deepEqual({ x: a.x, y: a.y }, position);
  assert.ok(a.cooldowns.q > simulation.now);
  simulation.disconnectPlayer(a.id);
  advance(simulation, 20.1);
  assert.equal(simulation.players.has(a.id), false);
  const savedHp = aAccount.body!.hp;
  const restored = simulation.addPlayer(aAccount, 'warrior');
  assert.equal(restored.hp, savedHp);
});

test('team leader transfers after disconnect grace while offline membership survives reconnect', () => {
  const { simulation, a, b, aAccount } = arena();
  team(simulation, a, b);
  simulation.disconnectPlayer(a.id);
  advance(simulation, 20.2);
  assert.equal(simulation.socialFor(b.id).team!.leaderId, b.id);
  assert.equal(simulation.socialFor(b.id).team!.members.find(member => member.id === a.id)!.online, false);
  simulation.addPlayer(aAccount, 'mage');
  assert.equal(simulation.socialFor(a.id).team!.leaderId, b.id);
});

test('bush concealment filters enemies and social nearby lists, but nearby or revealed enemies appear', () => {
  const { simulation, a, b } = arena();
  b.x = 500;
  b.hidden = true;
  assert.equal(simulation.snapshotFor(a.id)!.actors.some(actor => actor.id === b.id), false);
  assert.equal(simulation.socialFor(a.id).nearby.some(actor => actor.id === b.id), false);
  b.revealedUntil = simulation.now + 2000;
  assert.equal(simulation.snapshotFor(a.id)!.actors.some(actor => actor.id === b.id), true);
  b.revealedUntil = 0;
  b.x = 80;
  assert.equal(simulation.snapshotFor(a.id)!.actors.some(actor => actor.id === b.id), true);
});

test('generated chunks unload after players move away and NPC death cooldown survives sleep', () => {
  const simulation = new WorldSimulation(734291, 1_000_000);
  simulation.world.getTile = () => 'grass';
  simulation.world.getChunk = (cx, cy) => ({ cx, cy, key: `${cx},${cy}`, tiles: [], pickups: [], npcs: cx === 0 && cy === 0 ? [{ id: 'test-slime', x: 300, y: 300, npcKind: 'slime', level: 1 }] : [] });
  const actor = simulation.addPlayer(account('alice'), 'mage');
  const npc = simulation.npcs.get('test-slime')!;
  npc.hp = 0;
  npc.deadUntil = simulation.now + 100_000;
  actor.x = 10_000;
  actor.y = 10_000;
  advance(simulation, 21);
  assert.equal(simulation.activeChunks.has('0,0'), false);
  assert.equal(simulation.npcs.has(npc.id), false);
  actor.x = 0;
  actor.y = 0;
  advance(simulation, 0.7);
  assert.equal(simulation.npcs.get(npc.id)!.hp, 0);
  assert.equal(simulation.npcs.get(npc.id)!.deadUntil, npc.deadUntil);
});

test('pickups grant positive and negative effects which expire on server time', () => {
  const { simulation, a } = arena();
  simulation.pickups.set('power-test', { id: 'power-test', x: a.x, y: a.y, kind: 'power', radius: 12 });
  simulation.step();
  assert.equal(simulation.pickups.has('power-test'), false);
  assert.ok(a.effects.some(effect => effect.kind === 'power'));
  simulation.pickups.set('weak-test', { id: 'weak-test', x: a.x, y: a.y, kind: 'weakness', radius: 12 });
  simulation.step();
  assert.ok(a.effects.some(effect => effect.kind === 'weakness'));
  advance(simulation, 10.1);
  assert.equal(a.effects.length, 0);
});

test('generated pickups regenerate only after their authoritative cooldown', () => {
  const simulation = new WorldSimulation(734291, 1_000_000);
  simulation.world.getTile = () => 'grass';
  simulation.world.getChunk = (cx, cy) => ({ cx, cy, key: `${cx},${cy}`, tiles: [], npcs: [], pickups: cx === 0 && cy === 0 ? [{ id: 'source', x: 0, y: 0, radius: 12, kind: 'heal' }] : [] });
  const player = simulation.addPlayer(account('alice'), 'mage');
  Object.assign(player, { x: 0, y: 0, hp: 50 });
  simulation.step();
  assert.equal(player.hp, 85);
  assert.equal(simulation.pickups.has('source'), false);
  player.x = 300;
  advance(simulation, 34);
  assert.equal(simulation.pickups.has('source'), false);
  advance(simulation, 2);
  assert.equal(simulation.pickups.has('source'), true);
});

test('accounts register, login with password and JWT, and fail closed on corrupt files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-store-'));
  const path = join(directory, 'accounts.json');
  try {
    const store = new AccountStore(path);

    // Registrazione utente
    const first = store.register('Alice', 'passwordSegreta123');
    assert.equal(first.account.name, 'Alice');
    assert.equal(first.account.nameLower, 'alice');
    assert.equal(first.token.split('.').length, 3, 'Il token è un JWT valido con 3 parti');

    // Verifica che la password in chiaro e il JWT non siano salvati nel JSON
    const content = readFileSync(path, 'utf8');
    assert.equal(content.includes('passwordSegreta123'), false);
    assert.equal(content.includes(first.token), false);

    // Ricaricamento da file e verifica JWT
    const restored = new AccountStore(path).authenticateJwt(first.token);
    assert.equal(restored.account.id, first.account.id);
    assert.equal(restored.account.name, 'Alice');

    // Login con credenziali corrette (case-insensitive)
    const loginOk = store.login('alice', 'passwordSegreta123');
    assert.equal(loginOk.account.id, first.account.id);

    // Rifiuto password errata
    assert.throws(() => store.login('Alice', 'password-sbagliata'));

    // Rifiuto JWT errato o manomesso
    assert.throws(() => store.authenticateJwt('header.payload.signatureFalsa'));

    // Rifiuto nome duplicato case-insensitive
    assert.throws(() => store.register('alice', 'altraPassword456'));

    // Fail closed su file JSON danneggiato
    writeFileSync(path, '{broken');
    assert.throws(() => new AccountStore(path), /Ripristina/);
    assert.equal(readFileSync(path, 'utf8'), '{broken');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});