import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPLORATION_RADIUS, revealExploration, tileExplored } from '../shared/exploration';
import { newNarrativeProgress, validNarrativeProgress } from '../shared/narrative';
import { TILE_SIZE } from '../shared/config';
import { World } from '../shared/world';
import { newWorldDocument } from '../shared/world-schema';
import { WorldSimulation } from '../server/simulation';
import type { Account } from '../server/store';

test('exploration reveals a local disk, crosses negative chunk boundaries and persists compactly', () => {
  const progress = newNarrativeProgress();
  assert.ok(revealExploration(progress, 'world', -1, -1));
  assert.ok(tileExplored(progress.exploration, 'world', -1, -1));
  assert.ok(tileExplored(progress.exploration, 'world', -1 + EXPLORATION_RADIUS, -1));
  assert.equal(tileExplored(progress.exploration, 'world', EXPLORATION_RADIUS, -1), false);
  assert.equal(tileExplored(progress.exploration, 'world', 4, 4), false);
  assert.equal(tileExplored(progress.exploration, 'house', -1, -1), false);
  const revision = progress.revision;
  assert.equal(revealExploration(progress, 'world', -1, -1), false);
  assert.equal(progress.revision, revision);
  revealExploration(progress, 'world', 20 * TILE_SIZE, 0);
  const restored = JSON.parse(JSON.stringify(progress));
  assert.ok(validNarrativeProgress(restored));
  assert.ok(tileExplored(restored.exploration, 'world', -1, -1));
  assert.ok(tileExplored(restored.exploration, 'world', 20, 0));
  assert.equal(tileExplored(restored.exploration, 'world', 10, 0), false, 'teleports do not reveal a connecting route');
  assert.ok(JSON.stringify(restored.exploration).length < 1000);
  for (const exploration of [[], { 'world:0,0': 'invalid' }, { 'invalid key': '0'.repeat(64) }]) {
    assert.equal(validNarrativeProgress({ ...progress, exploration }), false);
  }
  assert.ok(validNarrativeProgress({ version: 1, quests: {}, flags: ['world-map'] }), 'legacy saves remain valid');
});

test('authoritative discovery starts at login, stays personal, survives reconnect and separates characters and maps', () => {
  const document = newWorldDocument(), world = new World(document.seed, 16, 'world', document, []);
  world.getTile = () => 'grass';
  const sim = new WorldSimulation(document.seed, 1_000_000, undefined, 'world', { world, dungeons: [], bosses: new Map(), spawn: { x: 24, y: 24 } });
  const account: Account = { id: 'explorer', name: 'Explorer', nameLower: 'explorer', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 };
  const actor = sim.addPlayer(account, 'mage');
  assert.ok(tileExplored(sim.snapshotFor(actor.id)!.narrative!.exploration, 'world', 0, 0));
  const snapshot = sim.snapshotFor(actor.id)!.narrative!;
  Object.assign(actor, { x: 20 * TILE_SIZE, y: 24 }); sim.step(.01);
  assert.ok(tileExplored(account.narrative!.exploration, 'world', 20, 0));
  assert.equal(tileExplored(snapshot.exploration, 'world', 20, 0), false, 'previous snapshots remain immutable');
  assert.ok(Object.isFrozen(snapshot.exploration));
  sim.disconnectPlayer(actor.id); sim.addPlayer(account, 'mage');
  assert.ok(tileExplored(account.narrative!.exploration, 'world', 0, 0));
  sim.addPlayer(account, 'paladin');
  assert.equal(tileExplored(account.narrative!.exploration, 'world', 0, 0), false);
  sim.addPlayer(account, 'mage');
  assert.ok(tileExplored(account.narrative!.exploration, 'world', 0, 0));
  account.location = { mapId: 'house', returnTo: { x: 24, y: 24 } }; sim.step(.01);
  assert.ok(tileExplored(account.narrative!.exploration, 'house', 20, 0));
  assert.equal(tileExplored(account.narrative!.exploration, 'house', 0, 0), false);
  Object.assign(actor, { x: 40 * TILE_SIZE, hp: 0, deadUntil: sim.now + 60_000 }); sim.step(.01);
  assert.equal(tileExplored(account.narrative!.exploration, 'house', 40, 0), false);
  actor.hp = actor.maxHp; sim.disconnectPlayer(actor.id); sim.step(.01);
  assert.equal(tileExplored(account.narrative!.exploration, 'house', 40, 0), false);
});
