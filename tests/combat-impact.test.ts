import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldSimulation } from '../server/simulation';
import { CLASSES } from '../shared/config';
import type { ClassId } from '../shared/types';
import type { Account } from '../server/store';

const account = (id: string): Account => ({ id, name: id, nameLower: id, salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 });
function fixture(classId: ClassId = 'warrior') {
  const sim = new WorldSimulation(1, 1_000_000, undefined, 'battleground');
  sim.world.getTile = () => 'grass';
  sim.world.getChunk = (cx, cy) => ({ cx, cy, key: `${cx},${cy}`, tiles: [], npcs: [], pickups: [] });
  const source = sim.addPlayer(account('source'), classId), target = sim.addPlayer(account('target'), 'warrior');
  Object.assign(source, { x: 0, y: 0, aim: 0, spawnProtectedUntil: 0, resource: 100 });
  Object.assign(target, { x: 60, y: 0, spawnProtectedUntil: 0 });
  sim.step(.01);
  return { sim, source, target };
}

test('melee and area contacts carry the skill palette and position independently from floating damage', () => {
  const { sim, source, target } = fixture();
  assert.ok(sim.cast(source, 'basic'));
  const hit = sim.events.find(event => event.impact)!;
  assert.equal(hit.impact!.kind, 'melee'); assert.equal(hit.impact!.outcome, 'hit');
  assert.equal(hit.impact!.color, CLASSES.warrior.abilities.basic.color);
  assert.equal(hit.x, target.x); assert.equal(hit.impact!.x, target.x - target.radius); assert.equal(hit.impact!.aim, 0);
  assert.equal(hit.amount, Math.round(CLASSES.warrior.abilities.basic.damage * (1 - CLASSES.warrior.armor)));
  source.loadout = undefined; // Catalog fixture exposes the area ability independently of build slots.
  assert.ok(sim.cast(source, 'r'));
  const area = sim.events.find(event => event.impact?.kind === 'area')!;
  assert.equal(area.impact!.x, target.x);
  const snapshot = sim.snapshotFor(source.id)!;
  assert.deepEqual(snapshot.events.find(event => event.id === hit.id)!.impact, hit.impact);
  assert.notEqual(snapshot.events.find(event => event.id === hit.id)!.impact, hit.impact);
});

test('shield absorption has a separate impact without changing the existing damage reduction', () => {
  const { sim, source, target } = fixture();
  target.effects.push({ kind: 'shield', until: sim.now + 5000 });
  sim.cast(source, 'basic');
  const hit = sim.events.find(event => event.impact)!;
  assert.equal(hit.impact!.outcome, 'shield');
  assert.equal(hit.amount, Math.round(CLASSES.warrior.abilities.basic.damage * (1 - CLASSES.warrior.armor) * .4));
  assert.equal(target.hp, target.maxHp - hit.amount!);
});

test('ranged hits use the swept contact instead of the projectile endpoint or the attacker position', () => {
  const { sim, source, target } = fixture('mage'); target.x = 80;
  sim.cast(source, 'basic');
  for (let i = 0; i < 4 && sim.projectiles.size; i++) sim.step(.1);
  const hit = sim.events.find(event => event.impact)!;
  assert.equal(hit.impact!.kind, 'projectile'); assert.equal(hit.impact!.outcome, 'hit');
  assert.ok(Math.abs(hit.impact!.x - (target.x - target.radius)) < .001);
  assert.equal(hit.impact!.color, CLASSES.mage.abilities.basic.color);
  assert.equal(sim.projectiles.size, 0);
});

test('walls stop ranged and melee attacks with a ricochet and no fake damage or target flash', () => {
  for (const classId of ['warrior', 'mage'] as const) {
    const { sim, source, target } = fixture(classId); target.x = 130;
    sim.world.getTile = tx => tx === 1 ? 'rock' : 'grass';
    sim.cast(source, 'basic');
    if (classId === 'mage') for (let i = 0; i < 4 && sim.projectiles.size; i++) sim.step(.1);
    const wall = sim.events.find(event => event.impact?.outcome === 'wall')!;
    assert.ok(wall); assert.equal(wall.impact!.kind, classId === 'mage' ? 'projectile' : 'melee');
    assert.ok(Math.abs(wall.impact!.x - 48) < .001);
    assert.equal(wall.amount, undefined); assert.equal(wall.targetId, undefined); assert.equal(target.hp, target.maxHp);
  }
});

test('misses, cooldown rejections and projectiles expiring in empty space have no impact', () => {
  const { sim, source, target } = fixture('mage'); target.y = 300;
  assert.ok(sim.cast(source, 'basic')); assert.equal(sim.cast(source, 'basic'), false);
  for (let i = 0; i < 30; i++) sim.step(.1);
  assert.equal(sim.events.some(event => event.impact), false);
});
