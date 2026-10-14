import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE_SIZE } from '../shared/config';
import { World } from '../shared/world';
import { newWorldAsset, newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { compactWorldTiles, serializeWorldDocument } from '../shared/world-tiles';
import { collidesWorld, hasLineOfSight, moveWithCollisions, resolveActorCollisions } from '../shared/physics';
import { findSurfacePath } from '../shared/surface-navigation';
import { newSurfaceDemoDungeon } from '../shared/dungeon-surface-demo';
import { copySurfacePoint } from '../shared/world-surfaces';
import { validFishingCast } from '../shared/fishing/water';
import { projectActor } from '../shared/snapshot-actor';
import { SnapshotEncoder, SnapshotDecoder } from '../shared/snapshot-stream';
import { canStampAsset, stampAsset, WorldBrush } from '../shared/world-editing';
import type { Actor, Vec2 } from '../shared/types';
import { WorldSimulation } from '../server/simulation';
import { newSurfaceDemoWorld } from '../shared/surface-demo';
import type { Account } from '../server/store';
import { validateWorld } from '../shared/world-validation';
import { planBridge } from '../client/editors/surface-authoring';
import { sweptWorldHit } from '../shared/projectiles';

function fixture() {
  const draft = newSurfaceDemoDungeon(), document = newWorldDocument();
  document.tiles = draft.tiles.map((terrain, i) => ({ x: i % draft.width, y: Math.floor(i / draft.width), terrain, suppressAssets: true }));
  document.surfaceCells = structuredClone(draft.surfaceCells); document.surfaceLinks = structuredClone(draft.surfaceLinks);
  const world = new World(42, 16, 'world', document, []);
  return { world, document };
}
const point = (x: number, y: number, surfaceId = 'ground'): Vec2 => ({ x: (x + .5) * TILE_SIZE, y: (y + .5) * TILE_SIZE, surfaceId });

test('surface metadata survives terrain compaction and rejects malformed links without changing legacy maps', () => {
  const { document } = fixture(); document.surfaceCells![0].wallSkin = 'wall-roccia';
  const compact = compactWorldTiles(document), restored = parseWorldDocument(serializeWorldDocument(compact));
  assert.deepEqual(restored.surfaceCells, document.surfaceCells); assert.deepEqual(restored.surfaceLinks, document.surfaceLinks);
  assert.deepEqual(parseWorldDocument(serializeWorldDocument(newWorldDocument())).surfaceCells, undefined);
  const bad = structuredClone(document); bad.surfaceLinks![0].to.x += 4;
  assert.throws(() => parseWorldDocument(bad), /adiacenti/);
  const material = structuredClone(document); material.surfaceCells![0].elevation = 17;
  assert.throws(() => parseWorldDocument(material), /quota/);
  for (const wallSkin of ['', '../wall-roccia', 'Wall-Roccia', 'wall_roccia', 4, 'x'.repeat(65)]) {
    const invalid = structuredClone(document); (invalid.surfaceCells![0] as any).wallSkin = wallSkin;
    assert.throws(() => parseWorldDocument(invalid), /Superfici non valide/);
  }
});

test('world validation accepts a level footbridge over blocked water, preserving traversal and rejecting terrain intersections', () => {
  const document = newWorldDocument();
  document.spawn = { x: 0, y: 8, surfaceId: 'ground', elevation: 0 };
  for (let y = 6; y <= 10; y++) for (let x = -2; x <= 6; x++) {
    document.tiles.push({ x, y, terrain: y === 8 && x >= 1 && x <= 3 ? 'water' : 'grass', suppressAssets: true });
  }
  const banks = new World(document.seed, 16, 'world', document, []);
  const plan = planBridge({ x: 0, y: 8 }, { x: 4, y: 8 }, p => banks.surfaceAt(p.x, p.y, p.surfaceId), { material: 'wood', wallMaterial: 'wood' });
  document.surfaceCells = plan.cells; document.surfaceLinks = plan.links;
  assert.deepEqual(validateWorld(document, []), []);
  const world = new World(document.seed, 16, 'world', document, []);
  assert.equal(world.surfaceAt(2, 8)!.blocked, true);
  const deck = moveWithCollisions({ ...point(0, 8), radius: 13 }, 1, 0, 2 * TILE_SIZE, world);
  assert.equal(deck.surfaceId, plan.cells[0].surfaceId); assert.equal(deck.elevation, 0);
  assert.equal(world.isBlocked(2, 8, deck), false);
  const finish = moveWithCollisions({ ...deck, radius: 13 }, 1, 0, 2 * TILE_SIZE, world);
  assert.equal(finish.surfaceId, 'ground'); assert.ok(Math.abs(finish.x - point(4, 8).x) < 1e-6);
  for (const ground of [
    { material: 'grass' as const, elevation: 0 },
    { material: 'rock' as const, elevation: 0, blocked: true },
    { material: 'water' as const, elevation: 1 },
  ]) {
    const obstructed = structuredClone(document);
    obstructed.surfaceCells!.push({ x: 2, y: 8, surfaceId: 'ground', kind: 'ground', wallMaterial: 'earth', ...ground });
    assert.ok(validateWorld(obstructed, []).some(issue => issue.startsWith('Ponte ')), `${ground.material} at height ${ground.elevation} must intersect the deck`);
  }
});

test('water-level footbridges permit sight and projectile sweeps while deck walls, uncovered water and higher ground still block', () => {
  const document = newWorldDocument();
  for (let y = 7; y <= 10; y++) for (let x = -1; x <= 5; x++) {
    document.tiles.push({ x, y, terrain: (y === 8 && x >= 1 && x <= 3) || (y === 9 && x === 2) ? 'water' : 'grass', suppressAssets: true });
  }
  const banks = new World(document.seed, 16, 'world', document, []);
  const plan = planBridge({ x: 0, y: 8 }, { x: 4, y: 8 }, p => banks.surfaceAt(p.x, p.y, p.surfaceId), { material: 'wood', wallMaterial: 'wood' });
  document.surfaceCells = plan.cells; document.surfaceLinks = plan.links;
  const world = new World(document.seed, 16, 'world', document, []), from = point(0, 8), to = point(4, 8);
  assert.equal(world.surfaceAt(2, 8)!.blocked, true, 'the water remains impassable on its own plane');
  assert.equal(hasLineOfSight(from, to, world), true);
  assert.equal(sweptWorldHit(from, to, 4, world), null);
  assert.equal(hasLineOfSight(point(0, 9), point(4, 9), world), false, 'water without a deck still blocks');
  assert.notEqual(sweptWorldHit(point(0, 9), point(4, 9), 4, world), null);
  const blocked = structuredClone(document), wall = newWorldAsset('deck-wall', 'Parete', '/world-assets/waystone.svg');
  wall.cells[0].blocked = true; blocked.assets.push(wall);
  blocked.placements.push({ id: 'deck-wall', assetId: wall.id, x: 2, y: 8, surfaceId: plan.cells[0].surfaceId, elevation: 0 });
  const blockedWorld = new World(blocked.seed, 16, 'world', blocked, []);
  assert.equal(hasLineOfSight(from, to, blockedWorld), false, 'a wall placed on the deck still blocks');
  assert.notEqual(sweptWorldHit(from, to, 4, blockedWorld), null);
  const raised = structuredClone(document);
  raised.surfaceCells!.push({ x: 2, y: 8, surfaceId: 'ground', kind: 'ground', elevation: 1, material: 'rock', wallMaterial: 'rock' });
  const raisedWorld = new World(raised.seed, 16, 'world', raised, []);
  assert.equal(hasLineOfSight(from, to, raisedWorld), false, 'higher ground blocks even when a deck overlaps');
  assert.notEqual(sweptWorldHit(from, to, 4, raisedWorld), null);
});

test('stairs, bridge entries and ramps carry support while the independent underpass stays at ground level', () => {
  const { world } = fixture();
  const climb = moveWithCollisions({ ...point(3, 7), radius: 15 }, 1, 0, 9 * TILE_SIZE, world);
  assert.equal(climb.surfaceId, 'bridge-demo'); assert.equal(climb.elevation, 2);
  const finish = moveWithCollisions({ ...climb, radius: 15 }, 1, 0, 6 * TILE_SIZE, world);
  assert.equal(finish.surfaceId, 'ground'); assert.equal(finish.elevation, 0);
  const below = moveWithCollisions({ ...point(10, 11), radius: 15 }, 0, -1, 8 * TILE_SIZE, world);
  assert.equal(below.surfaceId, 'ground'); assert.equal(below.elevation, 0);
  assert.equal(world.surfaceAt(9, 6)!.material, 'water', 'painting the deck preserves the water underneath');
  const cliff = moveWithCollisions({ ...point(3, 5), radius: 15 }, 1, 0, 100, world);
  assert.ok(cliff.x < 4 * TILE_SIZE, 'unconnected cliff cannot be climbed');
  const rail = moveWithCollisions({ ...point(11, 6, 'bridge-demo'), radius: 15 }, 0, -1, 100, world);
  assert.ok(rail.y >= 6 * TILE_SIZE + 15, 'deck edge is a wall for the upper actor');
});

test('a bounded navigation path uses the stairs and bridge rather than crossing cliffs or changing planes at overlap', () => {
  const { world, document } = fixture();
  const route = findSurfacePath(world, point(3, 7), point(16, 7), 15);
  assert.ok(route?.some(p => p.surfaceId === 'bridge-demo'));
  assert.equal(route?.at(-1)?.elevation, 2);
  document.surfaceLinks = [];
  assert.equal(findSurfacePath(new World(42, 16, 'world', document, []), point(3, 7), point(16, 7), 15, 256), undefined);
  assert.equal(findSurfacePath(world, point(3, 7), point(16, 7), 15, 1), undefined, 'search budget bounds work');
});

test('overlapping upper and lower actors neither repel each other nor share line of sight or snapshot support', () => {
  const { world } = fixture();
  const actor = (id: string, p: Vec2): Actor => ({ id, ...p, ...world.surfaceState(p), radius: 15, hp: 100,
    kind: 'player', name: id, classId: 'warrior', maxHp: 100, resource: 0, maxResource: 100, aim: 0, speed: 200,
    level: 1, xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0, deadUntil: 0,
    spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } });
  const lower = actor('lower', point(10, 7)), upper = actor('upper', point(10, 7, 'bridge-demo'));
  assert.equal(hasLineOfSight(lower, upper, world), false);
  resolveActorCollisions([lower, upper], world);
  assert.equal(lower.x, upper.x); assert.equal(lower.y, upper.y);
  assert.deepEqual(copySurfacePoint(projectActor(upper)), { surfaceId: 'bridge-demo', elevation: 2 });
  assert.equal(collidesWorld(upper.x, upper.y, upper.radius, world, upper), false);
});

test('material and support remain independent and asset edits target the selected surface', () => {
  const { document } = fixture(); const base = newWorldAsset('wall', 'Wall', '/world-assets/waystone.svg'); base.cells[0].blocked = true;
  document.assets.push(base);
  stampAsset(document, base, { x: 10, y: 7, surfaceId: 'ground' }, 'lower');
  assert.equal(canStampAsset(document, base, { x: 10, y: 7, surfaceId: 'bridge-demo', elevation: 2 }), true);
  stampAsset(document, base, { x: 10, y: 7, surfaceId: 'bridge-demo', elevation: 2 }, 'upper');
  new WorldBrush(document).erase({ x: 10, y: 7, surfaceId: 'bridge-demo' });
  assert.deepEqual(document.placements.map(p => p.id), ['lower']);
  const world = new World(42, 16, 'world', document, []);
  assert.equal(world.isBlocked(10, 7), true); assert.equal(world.isBlocked(10, 7, point(10, 7, 'bridge-demo')), false);
  document.surfaceCells!.push({ x: 2, y: 2, surfaceId: 'ground', elevation: 1, material: 'rock', wallMaterial: 'rock', kind: 'ground' });
  assert.equal(new World(42, 16, 'world', document, []).surfaceAt(2, 2)!.blocked, false, 'authored rock is a material, not an implicit obstacle');
});

test('fishing recognizes authored water level without casting through a raised platform', () => {
  const document = newWorldDocument();
  for (let y = -2; y <= 2; y++) for (let x = 0; x <= 5; x++) document.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  document.surfaceCells = [{ x: 2, y: 0, surfaceId: 'ground', elevation: 1, material: 'water', wallMaterial: 'earth', kind: 'ground' },
    { x: 1, y: 0, surfaceId: 'ground', elevation: 1, material: 'grass', wallMaterial: 'rock', kind: 'ground' }];
  const world = new World(42, 16, 'world', document, []);
  assert.equal(validFishingCast(world, point(1, 0), point(2, 0)), true);
  assert.equal(validFishingCast(world, point(0, 0), point(2, 0)), false);
});

const account = (id: string): Account => ({ id, name: id, nameLower: id, salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 });
function simulation(populate = false) {
  const document = newSurfaceDemoWorld(); document.zones[0].pvp = true;
  const world = new World(42, 16, 'world', document, []);
  world.getChunk = (cx, cy) => ({ cx, cy, key: `${cx},${cy}`, tiles: [], pickups: [], npcs: populate && cx === 0 && cy === 0
    ? [{ id: 'sentinel', ...point(3, 7), npcKind: 'sentinel', level: 1, settings: { aggroRadius: 1000, leashRadius: 1000, speed: 190 } }] : [] });
  const sim = new WorldSimulation(42, 1_000_000, undefined, 'world', { world, dungeons: [], bosses: new Map(), spawn: point(3, 7) });
  return { world, sim };
}

test('an authoritative NPC follows the staircase and bridge to a player on the upper platform', () => {
  const { sim, world } = simulation(true), player = sim.addPlayer(account('target'), 'warrior');
  Object.assign(player, point(16, 7), world.surfaceState(point(16, 7)), { spawnProtectedUntil: 0 });
  for (let i = 0; i < 220; i++) sim.step();
  const npc = sim.npcs.get('sentinel')!;
  assert.equal(npc.elevation, 2); assert.ok(npc.x > 14 * TILE_SIZE, `NPC must use the bridge, got ${npc.x}, ${npc.y} @${npc.surfaceId}`);
  assert.ok(player.hp < player.maxHp, 'NPC reaches the target and attacks only once on its plane');
});

test('projectiles and dropped items preserve their plane instead of hitting or being collected underneath', () => {
  const { sim, world } = simulation(), owner = account('mage'), shooter = sim.addPlayer(owner, 'mage');
  const lower = sim.addPlayer(account('lower'), 'warrior'), upper = sim.addPlayer(account('upper'), 'warrior');
  for (const [actor, position] of [[shooter, point(10, 7, 'bridge-demo')], [lower, point(10, 7)], [upper, point(12, 7, 'bridge-demo')]] as const)
    Object.assign(actor, position, world.surfaceState(position), { spawnProtectedUntil: 0, aim: 0 });
  sim.step(); const lowerHp = lower.hp, upperHp = upper.hp;
  assert.equal(sim.cast(shooter, 'basic'), true);
  const projectile = [...sim.projectiles.values()][0]; assert.equal(projectile.elevation, 2); assert.equal(projectile.surfaceId, 'bridge-demo');
  Object.assign(shooter, point(10, 7), world.surfaceState(point(10, 7)));
  for (let i = 0; i < 12; i++) sim.step();
  assert.equal(lower.hp, lowerHp); assert.ok(upper.hp < upperHp);
  Object.assign(shooter, point(10, 7, 'bridge-demo'), world.surfaceState(point(10, 7, 'bridge-demo')));
  owner.inventory!.slots[0] = { itemId: 'healing-potion', quantity: 1 };
  sim.interact(owner.id, { kind: 'drop-item', itemId: 'healing-potion', slot: 0, quantity: 1 });
  const drop = [...sim.interactions.drops.values()][0]; assert.equal(drop.elevation, 2); assert.equal(drop.surfaceId, 'bridge-demo');
  Object.assign(lower, { x: drop.x, y: drop.y });
  for (let i = 0; i < 36; i++) sim.step();
  assert.ok(sim.interactions.drops.has(drop.id), 'the lower player cannot collect the upper drop');
});

test('network keyframes and deltas carry transitions between a bridge and its lower passage', () => {
  const { sim, world } = simulation(), observer = sim.addPlayer(account('observer'), 'warrior'), remote = sim.addPlayer(account('remote'), 'mage');
  Object.assign(observer, point(10, 7), world.surfaceState(point(10, 7)), { spawnProtectedUntil: 0 });
  Object.assign(remote, point(10, 7, 'bridge-demo'), world.surfaceState(point(10, 7, 'bridge-demo')), { spawnProtectedUntil: 0 });
  const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder(), room = { id: 'world', epoch: 1 }; decoder.reset(room);
  sim.step(); let packet = encoder.prepare(sim.snapshotFor(observer.id)!, room);
  let decoded = decoder.decode(JSON.parse(JSON.stringify(packet.packet))); packet.commit();
  assert.deepEqual(copySurfacePoint(decoded.actors.find(a => a.id === remote.id)!), { surfaceId: 'bridge-demo', elevation: 2 });
  Object.assign(remote, point(12, 7), world.surfaceState(point(12, 7))); sim.step();
  packet = encoder.prepare(sim.snapshotFor(observer.id)!, room); assert.notEqual(packet.packet.base, null);
  decoded = decoder.decode(JSON.parse(JSON.stringify(packet.packet))); packet.commit();
  assert.deepEqual(copySurfacePoint(decoded.actors.find(a => a.id === remote.id)!), { surfaceId: 'ground', elevation: 0 });
});

test('an upper trap remains on its support after the hunter descends and ignores a player underneath', () => {
  const { sim, world } = simulation(), hunter = sim.addPlayer(account('hunter'), 'hunter'); hunter.loadout = undefined;
  const lower = sim.addPlayer(account('under-trap'), 'warrior'), upper = sim.addPlayer(account('over-trap'), 'warrior');
  for (const [actor, position] of [[hunter, point(10, 7, 'bridge-demo')], [lower, point(11, 7)], [upper, point(11, 7, 'bridge-demo')]] as const)
    Object.assign(actor, position, world.surfaceState(position), { spawnProtectedUntil: 0, aim: 0 });
  assert.equal(sim.cast(hunter, 'q'), true); const trap = [...sim.traps.values()][0]; assert.equal(trap.elevation, 2);
  Object.assign(hunter, point(10, 7), world.surfaceState(point(10, 7)));
  const lowerHp = lower.hp, upperHp = upper.hp; sim.step();
  assert.equal(lower.hp, lowerHp); assert.ok(upper.hp < upperHp); assert.ok(upper.effects.some(e => e.kind === 'root'));
});
