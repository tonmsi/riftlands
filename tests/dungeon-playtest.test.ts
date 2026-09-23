import test from 'node:test';
import assert from 'node:assert/strict';
import { createDungeonPlaytest } from '../client/dungeon-playtest';
import { compileDungeonDraft, validateDungeonDraft } from '../shared/dungeon-draft';
import { parseDungeonFile } from '../shared/dungeon-import';
import { DUNGEON_BY_BOSS_ID, DUNGEON_DEFINITIONS, dungeonFlames } from '../shared/dungeons';
import { BOSS_BY_ID } from '../shared/bosses';
import { moveWithCollisions } from '../shared/physics';
import { studioDraft } from './fixtures/studio-draft';
import type { Actor } from '../shared/types';

function ready() {
  const draft = studioDraft();
  draft.tiles[3 * draft.width] = 'grass';
  draft.tiles[3 * draft.width + draft.width - 1] = 'grass';
  draft.tiles[4] = 'grass'; draft.tiles[(draft.height - 1) * draft.width + 4] = 'grass';
  draft.entities.push({ id: 'trigger', kind: 'activation', template: '', label: 'Attivazione', x: 2, y: 3, radius: 15, level: 1 });
  draft.entities.push({ id: 'fire', kind: 'flame', template: '', label: 'Fiamma', x: 6, y: 4, radius: 15, level: 1 });
  return draft;
}
const damage = (p: ReturnType<typeof createDungeonPlaytest>, target: Actor, amount: number, attacker = p.player) =>
  (p.simulation as unknown as { damage(target: Actor, attacker: Actor, amount: number): boolean }).damage(target, attacker, amount);

test('local game is isolated, has exactly two grass tiles around the map, and starts outside', () => {
  const draft = ready(), before = JSON.stringify(draft), catalog = [...DUNGEON_DEFINITIONS], bosses = [...BOSS_BY_ID], encounters = [...DUNGEON_BY_BOSS_ID];
  const p = createDungeonPlaytest(draft), b = p.definition.layout.bounds;
  assert.equal(p.player.x, (b.minTx - 1.5) * 48);
  for (let y = b.minTy - 2; y <= b.maxTy + 2; y++) for (let x = b.minTx - 2; x <= b.maxTx + 2; x++) {
    if (x < b.minTx || x > b.maxTx || y < b.minTy || y > b.maxTy) assert.equal(p.world.getTile(x, y), 'grass');
  }
  assert.equal(p.world.getTile(b.minTx - 3, b.minTy), 'rock');
  assert.equal(p.world.getTile(b.maxTx + 3, b.maxTy), 'rock');
  assert.equal(p.world.getTile(b.minTx, b.minTy - 3), 'rock');
  assert.equal(p.world.getTile(b.maxTx, b.maxTy + 3), 'rock');
  assert.equal(p.simulation.npcs.size, 1);
  assert.deepEqual(DUNGEON_DEFINITIONS, catalog); assert.deepEqual([...BOSS_BY_ID], bosses); assert.deepEqual([...DUNGEON_BY_BOSS_ID], encounters);
  assert.equal(JSON.stringify(draft), before);
});

test('walking through an activation closes grass entrances on every side until victory, with physical collisions', () => {
  const p = createDungeonPlaytest(ready()), sim = p.simulation, e = [...sim.bosses.values()][0];
  const gates = p.definition.passages.filter(p => p.id.startsWith('opening-')).flatMap(p => p.tiles);
  assert.equal(gates.length, 4);
  for (const t of gates) assert.equal(p.world.getTile(t.x, t.y), 'grass');
  for (let i = 0; i < 75; i++) p.step(1 / 30, { dx: 1, dy: 0, aim: 0 });
  assert.equal(e.ownerId, p.player.id);
  for (const t of gates) assert.equal(p.world.getTile(t.x, t.y), 'rock');
  const b = p.definition.layout.bounds;
  const stopped = moveWithCollisions({ x: (b.minTx + 1.5) * 48, y: (b.minTy + 3.5) * 48, radius: 15 }, -1, 0, 500, p.world);
  assert.ok(stopped.x >= (b.minTx + 1) * 48 + 15);
  damage(p, e.boss, 100000);
  assert.equal(e.ownerId, undefined);
  for (const t of gates) assert.equal(p.world.getTile(t.x, t.y), 'grass');
});

for (const diesFirst of ['leader', 'teammate'] as const) test(`team encounter survives ${diesFirst} death and blocks reentry until completion`, () => {
  const p = createDungeonPlaytest(ready()), sim = p.simulation, e = [...sim.bosses.values()][0];
  const teammate = sim.addPlayer({ ...sim.accounts.get(p.player.id)!, id: 'teammate', name: 'Compagno' }, 'mage');
  p.player.teamId = teammate.teamId = 'local-team';
  Object.assign(p.player, p.definition.encounter.activationPoints![0]);
  Object.assign(teammate, p.definition.spawnPoints.party[0]);
  for (let i = 0; i < 155; i++) sim.step();
  assert.equal(e.participantIds.size, 2);
  const eliminated = diesFirst === 'leader' ? p.player : teammate;
  const survivor = diesFirst === 'leader' ? teammate : p.player;
  damage(p, e.boss, 10);
  const bossHp = e.boss.hp;
  damage(p, eliminated, 100000, e.boss);
  assert.equal(e.ownerId, p.player.id); assert.equal(p.world.isBossLocked(e.boss.id), true);
  assert.equal(e.lockState(eliminated).relation, 'eliminated');
  for (let i = 0; i < 3; i++) sim.step();
  assert.equal(e.boss.hp, bossHp, 'a dead participant does not reset the boss');
  assert.equal(e.isActiveParticipant(survivor.id), true);
  eliminated.deadUntil = sim.now;
  sim.step();
  assert.ok(eliminated.hp > 0);
  Object.assign(eliminated, { x: survivor.x, y: survivor.y });
  assert.equal(e.canDamage(eliminated), false);
  sim.step();
  assert.deepEqual({ x: eliminated.x, y: eliminated.y }, e.dungeon.encounter.ejectTo);
  assert.equal(e.lockState().locked, true);
  damage(p, e.boss, 100000, survivor);
  assert.equal(e.lockState().locked, false);
  assert.equal(e.isEliminated(eliminated.id), false);
});

test('flames are dormant before activation, lethal during combat, and reopen the dungeon on death', () => {
  const p = createDungeonPlaytest(ready()), sim = p.simulation, e = [...sim.bosses.values()][0], flame = dungeonFlames(p.definition)[0];
  Object.assign(p.player, flame); sim.step(); assert.equal(p.player.hp, p.player.maxHp);
  Object.assign(p.player, p.definition.encounter.activationPoints![0]); sim.step();
  for (let i = 0; i < 9; i++) sim.step(.1);
  assert.ok(e.ownerId);
  Object.assign(p.player, flame); sim.step(); assert.equal(p.player.hp, 0); assert.equal(e.ownerId, undefined);
  for (let i = 0; i < 160; i++) sim.step();
  assert.equal(p.player.hp, p.player.maxHp); assert.equal(e.ownerId, undefined);
  assert.ok(p.player.x < p.definition.layout.bounds.minTx * 48);
});

test('all powerups and powerdowns survive runtime import and apply through the game pickup system', () => {
  const draft = ready();
  for (const [i, kind] of (['heal', 'haste', 'power', 'weakness'] as const).entries()) draft.entities.push({ id: kind, kind: 'pickup', template: kind, label: kind, x: 8 + i, y: 4, radius: 12, level: 1 });
  const compiled = compileDungeonDraft(draft);
  const imported = parseDungeonFile(JSON.stringify(compiled)).draft;
  assert.deepEqual(compileDungeonDraft(imported).definition.pickupSpawns, compiled.definition.pickupSpawns);
  const p = createDungeonPlaytest(draft), sim = p.simulation;
  Object.assign(p.player, p.definition.encounter.activationPoints![0]); sim.step();
  p.player.hp = 20;
  for (const pickup of [...sim.pickups.values()]) { Object.assign(p.player, { x: pickup.x, y: pickup.y }); sim.step(); }
  assert.equal(p.player.hp, 55);
  assert.deepEqual(p.player.effects.map(e => e.kind).sort(), ['haste', 'power', 'weakness']);
  assert.equal(sim.pickups.size, 0);
});

test('real abilities damage bosses, and boss AI retaliates in local play', () => {
  const draft = ready(); draft.entities.push({ id: 'slime', kind: 'npc', template: 'slime', label: 'Gelatina', x: 8, y: 5, radius: 13, level: 1 });
  const p = createDungeonPlaytest(draft, 'mage'), sim = p.simulation, e = [...sim.bosses.values()][0];
  Object.assign(p.player, p.definition.encounter.activationPoints![0]); sim.step();
  Object.assign(p.player, { x: e.boss.x - 100, y: e.boss.y });
  const hp = e.boss.hp;
  let bossDamaged = false;
  for (let i = 0; i < 180; i++) { p.step(1 / 30, { dx: 0, dy: 0, aim: Math.atan2(e.boss.y - p.player.y, e.boss.x - p.player.x), cast: 'basic' }); bossDamaged ||= e.boss.hp < hp; }
  assert.ok(bossDamaged);
  assert.ok(p.player.hp < p.player.maxHp || p.player.deaths > 0);
});

test('border flames, including long barriers, cannot be exported; internal flames remain valid', () => {
  const draft = ready(), flame = draft.entities.find(e => e.kind === 'flame')!;
  flame.x = 0; flame.y = 3;
  assert.ok(validateDungeonDraft(draft).some(i => i.includes('fiamma sul bordo')));
  assert.throws(() => compileDungeonDraft(draft), /bordo/);
  flame.x = draft.width - 2; flame.span = 2;
  assert.ok(validateDungeonDraft(draft).some(i => i.includes('fiamma sul bordo')));
});

test('authored NPCs use real combat and preview rejects entrances disconnected from the playable area', () => {
  const draft = ready();
  draft.entities.push({ id: 'slime', kind: 'npc', template: 'slime', label: 'Gelatina', x: 8, y: 3, radius: 13, level: 1 });
  const p = createDungeonPlaytest(draft, 'mage'), npc = p.simulation.npcs.get('slime')!;
  Object.assign(p.player, p.definition.encounter.activationPoints![0]); p.simulation.step();
  Object.assign(p.player, { x: npc.x - 100, y: npc.y });
  for (let i = 0; i < 35; i++) p.step(1 / 30, { dx: 0, dy: 0, aim: Math.atan2(npc.y - p.player.y, npc.x - p.player.x), cast: 'basic' });
  assert.ok(npc.hp < npc.maxHp);
  const closed = studioDraft(); closed.tiles[3 * closed.width] = 'rock'; closed.tiles[0] = 'grass';
  assert.throws(() => createDungeonPlaytest(closed), /collegalo agli spawn/);
});
