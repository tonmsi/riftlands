import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldSimulation } from '../server/simulation';
import type { Account } from '../server/store';
import { OUTPOST, inOutpost, OUTPOST_HUTS } from '../shared/outpost';
import { ARENA_GATE, insideArenaGate } from '../shared/arena';
import { World } from '../shared/world';
import { collidesWorld } from '../shared/physics';

const account = (id: string): Account => ({ id, name: id, nameLower: id, salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 });
function combat() {
  const sim = new WorldSimulation(734291, 1_000_000);
  const aa = account('a'), bb = account('b');
  const a = sim.addPlayer(aa, 'warrior'), b = sim.addPlayer(bb, 'warrior');
  Object.assign(a, { x: 0, y: 260, spawnProtectedUntil: 0, aim: Math.PI / 2 });
  Object.assign(b, { x: 0, y: 310, spawnProtectedUntil: 0, aim: -Math.PI / 2 });
  sim.step();
  return { sim, a, b, aa, bb };
}

test('compact sanctuary contains spawn, huts and arena; the first point outside is PvP', () => {
  assert.ok(OUTPOST.radius <= 220);
  assert.equal(inOutpost({ x: 0, y: 220 }), true);
  assert.equal(inOutpost({ x: 0, y: 220.01 }), false);
  assert.ok(Math.hypot(ARENA_GATE.x, ARENA_GATE.y) + ARENA_GATE.radius < OUTPOST.radius);
  const world = new World();
  for (const hut of OUTPOST_HUTS) assert.equal(collidesWorld(hut.x + 24, hut.y + 24, 15, world), true);
  for (const point of [{ x: 0, y: 221 }, { x: 221, y: 24 }, { x: -221, y: 24 }, { x: 0, y: -221 }]) assert.equal(collidesWorld(point.x, point.y, 15, world), false);
  const sim = new WorldSimulation();
  for (let i = 0; i < 20; i++) {
    const actor = sim.addPlayer(account(`spawn${i}`), 'mage');
    assert.equal(inOutpost(actor), true);
    assert.equal(insideArenaGate(actor), false);
    assert.equal(collidesWorld(actor.x, actor.y, actor.radius, sim.world), false);
  }
});

test('sanctuary rejects offensive spells without spending resources; opponents outside take damage', () => {
  const { sim, a, b } = combat();
  a.y = 200; b.y = 260; sim.step();
  assert.equal(sim.cast(a, 'basic'), false);
  assert.equal(a.cooldowns.basic, 0);
  const hp = a.hp;
  assert.equal(sim.cast(b, 'basic'), true);
  assert.equal(a.hp, hp);
  a.y = 230; sim.step();
  assert.equal(sim.cast(a, 'basic'), true);
  assert.ok(b.hp < b.maxHp);
});

test('spawn protection ends immediately on crossing the boundary, and never returns on reentry', () => {
  const { sim, a } = combat();
  a.y = 219;
  a.spawnProtectedUntil = sim.now + 5000;
  sim.enqueueInput(a.id, { seq: 1, dx: 0, dy: 1, aim: 0 });
  sim.step(0.1);
  assert.ok(a.y > OUTPOST.radius);
  assert.equal(a.spawnProtectedUntil, 0);
  assert.equal(sim.isSafeProtected(a), false);
  a.y = 210;
  sim.step();
  assert.equal(a.spawnProtectedUntil, 0);
});

test('PvP combat tag persists on reentry and reconnect, then expires after eight seconds without hits', () => {
  const { sim, a, b, aa } = combat();
  sim.cast(a, 'basic');
  assert.equal(a.pvpUntil, sim.now + OUTPOST.combatMs);
  a.y = 200; b.y = 260; sim.step();
  assert.equal(sim.isSafeProtected(a), false);
  const hp = a.hp;
  sim.cast(b, 'basic');
  assert.ok(a.hp < hp);
  sim.disconnectPlayer(a.id);
  const returned = sim.addPlayer(aa, 'warrior');
  assert.equal(returned.pvpUntil, a.pvpUntil);
  for (let i = 0; i < 81; i++) sim.step(0.1);
  assert.equal(sim.isSafeProtected(a), true);
  const protectedHp = a.hp;
  sim.cast(b, 'basic');
  assert.equal(a.hp, protectedHp);
});

test('blocked frost projectiles and orphan traps cannot apply damage, slow or root inside sanctuary', () => {
  const { sim, a, b } = combat();
  a.y = 200; b.y = 280; sim.step();
  const hp = a.hp;
  sim.projectiles.set('frost', { id: 'frost', ownerId: b.id, x: 0, y: 230, vx: 0, vy: -400, radius: 6, damage: 25, slow: 2000, expiresAt: sim.now + 2000, color: '#fff' });
  sim.step(0.1);
  sim.traps.set('orphan', { id: 'orphan', ownerId: 'gone', teamId: null, x: a.x, y: a.y, radius: 30, damage: 30, duration: 2500, expiresAt: sim.now + 2000, color: '#fff' });
  sim.step(0.1);
  assert.equal(a.hp, hp);
  assert.equal(a.effects.some(effect => effect.kind === 'slow' || effect.kind === 'root'), false);
});

test('respawn clears combat tag and returns inside sanctuary', () => {
  const { sim, a } = combat();
  a.hp = 0; a.deadUntil = sim.now; a.pvpUntil = sim.now + 8000;
  sim.step();
  assert.equal(inOutpost(a), true);
  assert.equal(a.pvpUntil, 0);
  assert.equal(sim.isSafeProtected(a), true);
});
