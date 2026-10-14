import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms';
import { BossEncounter, findBossPath } from '../server/boss-encounter';
import type { Account } from '../server/store';
import { newWorldDocument } from '../shared/world-schema';
import { newInterior, warpPosition } from '../shared/warps';
import { INSTALLED_DUNGEON_DEFINITIONS } from '../shared/dungeons';
import { World } from '../shared/world';
import type { Vec2 } from '../shared/types';
import type { BossWindup } from '../shared/bosses';
import { engineFixture } from './fixtures/dungeon-engine';

const account = (id: string): Account => ({ id, name: id, nameLower: id, salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 });
const advance = (manager: RoomManager) => { for (let i = 0; i < 12; i++) manager.step(.05); };
function project() {
  const document = newWorldDocument(); document.spawn = { x: 10, y: 10 };
  document.dungeons = INSTALLED_DUNGEON_DEFINITIONS.map(d => ({ dungeonId: d.id, x: 0, y: 0, enabled: false }));
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) document.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  document.zones = [{ id: 'safe', name: 'Test', priority: 1, shape: { kind: 'rect', x: 0, y: 0, width: 24, height: 24 }, pvp: false, generateAssets: false,
    npcs: { density: 0, maxPerChunk: 0, weights: { slime: 0, wisp: 0, sentinel: 0 } } }];
  return document;
}

test('warp proximity distinguishes decks and transfers preserve return support while clearing stale arrival layers', () => {
  const document = project(); document.interiors = [newInterior('house', 'Terrazza', 12, 12)];
  document.surfaceCells = [{ x: 2, y: 2, surfaceId: 'bridge', elevation: 2, material: 'wood', wallMaterial: 'wood', kind: 'bridge' }];
  document.interiors[0].document.surfaceCells = [{ x: 4, y: 4, surfaceId: 'terrace', elevation: 3, material: 'stone', wallMaterial: 'brick', kind: 'bridge' }];
  document.warps = [
    { id: 'in', name: 'Entra', from: 'world', to: 'house', entry: { x: 2, y: 2, surfaceId: 'bridge', elevation: 2 }, arrival: { x: 4, y: 4, surfaceId: 'terrace', elevation: 3 }, activation: 'interact' },
    { id: 'out', name: 'Esci', from: 'house', to: 'world', entry: { x: 4, y: 4, surfaceId: 'terrace', elevation: 3 }, arrival: { x: 9, y: 9 }, activation: 'interact' },
  ];
  const manager = new RoomManager(undefined, document.seed, 1_000_000, document), user = account('walker');
  manager.connect(user, 'warrior'); advance(manager);
  const actor = manager.global.players.get(user.id)!;
  Object.assign(actor, warpPosition({ x: 2, y: 2 }), { surfaceId: 'ground', elevation: 0 });
  let state = manager.stateFor(user.id);
  assert.throws(() => manager.interact(user.id, { kind: 'warp', warpId: 'in' }, state.id, state.epoch), /Avvicinati/);
  Object.assign(actor, warpPosition(document.warps[0].entry));
  manager.interact(user.id, { kind: 'warp', warpId: 'in' }, state.id, state.epoch); advance(manager);
  let indoor = manager.simulationFor(user.id).players.get(user.id)!;
  assert.equal(indoor.surfaceId, 'terrace'); assert.equal(indoor.elevation, 3);
  assert.deepEqual(user.location!.returnTo, warpPosition(document.warps[0].entry));
  manager.returnToWorld(user.id);
  assert.equal(manager.global.players.get(user.id)!.surfaceId, 'bridge'); assert.equal(manager.global.players.get(user.id)!.elevation, 2);
  Object.assign(manager.global.players.get(user.id)!, warpPosition({ x: 10, y: 10 }), { surfaceId: 'ground', elevation: 0 }); advance(manager);
  Object.assign(manager.global.players.get(user.id)!, warpPosition(document.warps[0].entry));
  state = manager.stateFor(user.id); manager.interact(user.id, { kind: 'warp', warpId: 'in' }, state.id, state.epoch); advance(manager);
  indoor = manager.simulationFor(user.id).players.get(user.id)!;
  Object.assign(indoor, warpPosition({ x: 6, y: 6 }), { surfaceId: 'ground', elevation: 0 }); advance(manager);
  Object.assign(indoor, warpPosition(document.warps[1].entry));
  state = manager.stateFor(user.id); manager.interact(user.id, { kind: 'warp', warpId: 'out' }, state.id, state.epoch); advance(manager);
  const returned = manager.global.players.get(user.id)!;
  assert.equal(returned.surfaceId ?? 'ground', 'ground'); assert.equal(returned.elevation ?? 0, 0);
  assert.equal(returned.x, 9 * 48 + 24); assert.equal(user.location, undefined);
});

test('arena bodies use the base plane and restore the elevated global return position', async () => {
  const document = project(); document.spawn = { x: 10, y: 10, surfaceId: 'bridge', elevation: 2 };
  document.surfaceCells = [{ x: 10, y: 10, surfaceId: 'bridge', elevation: 2, material: 'wood', wallMaterial: 'wood', kind: 'bridge' }];
  const manager = new RoomManager(undefined, document.seed, 1_000_000, document), a = account('a'), b = account('b');
  manager.connect(a, 'warrior'); manager.connect(b, 'mage');
  for (let i = 0; i < 110; i++) manager.step(.1);
  const returnX = manager.global.players.get(a.id)!.x;
  const roomId = await manager.createMatch('arena', [[a.id], [b.id]]);
  const arena = manager.rooms.get(roomId)!;
  for (const actor of arena.simulation.players.values()) {
    assert.equal(actor.surfaceId ?? 'ground', 'ground'); assert.equal(actor.elevation ?? 0, 0);
  }
  manager.closeMatch(roomId);
  assert.equal(manager.global.players.get(a.id)!.surfaceId, 'bridge'); assert.equal(manager.global.players.get(a.id)!.elevation, 2);
  assert.equal(manager.global.players.get(a.id)!.x, returnX);
});

test('boss area attacks and private loot respect the plane, and corpse support survives encounter restoration', t => {
  const fixture = engineFixture(); t.after(fixture.cleanup);
  const { boss, encounter, player, account: user, bundle } = fixture;
  const document = newWorldDocument(), tx = Math.floor(boss.x / 48), ty = Math.floor(boss.y / 48);
  document.surfaceCells = [];
  for (let y = ty - 2; y <= ty + 2; y++) for (let x = tx - 2; x <= tx + 2; x++)
    document.surfaceCells.push({ x, y, surfaceId: 'boss-deck', elevation: 2, material: 'stone', wallMaterial: 'brick', kind: 'bridge' });
  const world = new World(document.seed, 16, 'world', document, [bundle.definition]);
  Object.assign(boss, { surfaceId: 'boss-deck', elevation: 2 });
  Object.assign(player, { x: boss.x, y: boss.y, surfaceId: 'ground', elevation: 0 });
  const probe = encounter as unknown as { resolveWindup(now: number, players: typeof player[], world: World, damage: (target: typeof player, amount: number) => void): void };
  const windup = (): BossWindup => ({ bossId: boss.id, kind: 'slam', x: boss.x, y: boss.y, surfaceId: 'boss-deck', elevation: 2, radius: 120, damage: 30, startedAt: 0, resolvesAt: 1 });
  let hits = 0;
  assert.equal(encounter.canDamage(player), false);
  encounter.windup = windup(); probe.resolveWindup(2, [player], world, () => hits++); assert.equal(hits, 0);
  Object.assign(player, { surfaceId: 'boss-deck', elevation: 2 });
  assert.equal(encounter.canDamage(player), true);
  encounter.windup = windup(); probe.resolveWindup(2, [player], world, () => hits++); assert.equal(hits, 1);
  boss.hp = 0; encounter.killed(player.id, fixture.sim.now, world);
  assert.equal(encounter.state.corpse.surfaceId, 'boss-deck'); assert.equal(encounter.state.drops[0].elevation, 2);
  const restored = new BossEncounter(encounter.definition, fixture.sim.now + 1, structuredClone(encounter.state), undefined, bundle.definition);
  assert.equal(restored.boss.surfaceId, 'boss-deck'); assert.equal(restored.boss.elevation, 2);
  Object.assign(player, { surfaceId: 'ground', elevation: 0 });
  encounter.collect(player, user, true, fixture.sim.now + 1000, world); assert.equal(user.gold, 0);
  Object.assign(player, { surfaceId: 'boss-deck', elevation: 2 });
  encounter.collect(player, user, true, fixture.sim.now + 1000, world); assert.equal(user.gold, encounter.definition.reward.gold);
});

test('boss pathfinding requires authored access when crossing a ground height boundary', t => {
  const fixture = engineFixture(); t.after(fixture.cleanup);
  const { boss, bundle, encounter } = fixture;
  const document = newWorldDocument(), tx = Math.floor(boss.x / 48), ty = Math.floor(boss.y / 48);
  document.surfaceCells = [];
  for (let y = ty - 3; y <= ty + 3; y++) for (let x = tx + 1; x <= tx + 6; x++)
    document.surfaceCells.push({ x, y, surfaceId: 'ground', elevation: 1, material: 'grass', wallMaterial: 'rock', kind: 'ground' });
  const goal: Vec2 = { x: (tx + 3.5) * 48, y: (ty + .5) * 48, surfaceId: 'ground', elevation: 1 };
  let world = new World(document.seed, 16, 'world', document, [bundle.definition]);
  assert.deepEqual(findBossPath(encounter.definition, boss, goal, world, bundle.definition), []);
  document.surfaceLinks = [{ id: 'boss-ramp', kind: 'ramp', from: { x: tx, y: ty, surfaceId: 'ground' }, to: { x: tx + 1, y: ty, surfaceId: 'ground' } }];
  world = new World(document.seed, 16, 'world', document, [bundle.definition]);
  const path = findBossPath(encounter.definition, boss, goal, world, bundle.definition);
  assert.ok(path.length); assert.equal(path.at(-1)!.elevation, 1);
});
