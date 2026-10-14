import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE_SIZE } from '../shared/config';
import { World } from '../shared/world';
import { newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { compactWorldTiles, serializeWorldDocument } from '../shared/world-tiles';
import { BASE_SURFACE, type SurfaceCell, type SurfaceEndpoint } from '../shared/world-surfaces';
import { planStair, removeStair, stairGeometry, stairLinks, stairPath, type StairData } from '../shared/surface-stairs';
import { collidesWorld, moveWithCollisions } from '../shared/physics';
import { findSurfacePath } from '../shared/surface-navigation';
import { canInterpolateSurfaceTransition, visualElevationAt } from '../shared/surface-presentation';
import { draftFromDungeon, compileDungeonDraft, newDungeonDraft, parseDungeonDraft, serializeDungeonDraft } from '../shared/dungeon-draft';
import { relocateDungeon } from '../shared/dungeon-relocation';
import { WorldSimulation } from '../server/simulation';
import type { Account } from '../server/store';

const center = (p: SurfaceEndpoint) => ({ x: (p.x + .5) * TILE_SIZE, y: (p.y + .5) * TILE_SIZE, surfaceId: p.surfaceId });
function fixture(dx = 1, dy = 0, length = 4, width = 48, height = 3) {
  const document = newWorldDocument(), from = { x: 4, y: 4, surfaceId: BASE_SURFACE }, to = { x: 4 + dx * length, y: 4 + dy * length, surfaceId: BASE_SURFACE };
  for (let y = -2; y < 15; y++) for (let x = -2; x < 15; x++) document.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  document.surfaceCells = [];
  for (let lane = -1; lane <= 1; lane++) document.surfaceCells.push({ x: to.x - dy * lane, y: to.y + dx * lane, surfaceId: BASE_SURFACE, elevation: height, material: 'grass', wallMaterial: 'rock', kind: 'ground' });
  const ground = new World(document.seed, 16, 'world', document, []);
  const plan = planStair(from, to, (x, y, id) => ground.surfaceAt(x, y, id), { id: 'test-stair', width, cells: document.surfaceCells });
  document.surfaceCells.push(...plan.cells); document.surfaceLinks = plan.links; document.surfaceStairs = [plan.stair];
  return { document, plan, world: new World(document.seed, 16, 'world', document, []), from, to };
}

test('multi-cell stairs preserve underlying ground and carry actors through every support in both directions', () => {
  const { world, plan, from, to } = fixture();
  assert.equal(plan.cells.length, 3); assert.equal(plan.links.length, 4);
  let actor = { ...center(from), radius: 15 };
  for (let i = 1; i <= 4; i++) {
    actor = { ...actor, ...moveWithCollisions(actor, 1, 0, TILE_SIZE, world) };
    assert.ok(Math.abs(actor.x - (from.x + i + .5) * TILE_SIZE) < 1e-6);
    assert.equal(actor.surfaceId, i === 4 ? BASE_SURFACE : 'stair:test-stair');
  }
  assert.equal(world.surfaceFor(actor)!.elevation, 3);
  const finish = moveWithCollisions(actor, -1, 0, 4 * TILE_SIZE, world);
  assert.equal(finish.surfaceId, BASE_SURFACE); assert.equal(finish.elevation, 0);
  assert.ok(Math.abs(finish.x - center(from).x) < 1e-6);
  const under = center({ x: from.x + 2, y: from.y, surfaceId: BASE_SURFACE });
  assert.equal(visualElevationAt(under, world), 0);
  assert.equal(world.surfaceFor(under)!.kind, 'ground');
  assert.equal(world.surfaceFor({ ...under, surfaceId: 'stair:test-stair' })!.kind, 'stairs');
  assert.equal(world.surfaceIndex.stairFor(under), undefined, 'saved lower terrain must not borrow the walking profile');
  assert.equal(collidesWorld(under.x, under.y, 15, world, under), true, 'the solid stair body blocks the saved lower terrain');
  assert.ok(Math.abs(center(to).x - actor.x) < 1e-6);
});

test('all four orientations share one continuous foot profile and south stairs reject a collapsed projection', () => {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [0, 1]]) {
    const { world, plan, from, to } = fixture(dx, dy);
    const finish = moveWithCollisions({ ...center(from), radius: 15 }, dx, dy, 4 * TILE_SIZE, world);
    assert.ok(Math.hypot(finish.x - center(to).x, finish.y - center(to).y) < 1e-6, `${dx},${dy} should reach upper landing`);
    const g = stairGeometry(plan.stair);
    let previous = 0;
    for (let i = 0; i <= 80; i++) {
      const t = i / 80, p = g.pointAt(t), logical = world.surfaceFor({ ...p, surfaceId: i <= 9 || i >= 71 ? BASE_SURFACE : 'stair:test-stair' });
      const point = { ...p, surfaceId: logical?.surfaceId ?? BASE_SURFACE };
      const expected = g.elevationAt(t);
      assert.ok(expected >= previous); previous = expected;
      if (logical) assert.ok(Math.abs(visualElevationAt(point, world) - expected) < 1e-6, `${dx},${dy} at ${t}`);
    }
  }
  assert.throws(() => fixture(0, 1, 1, 48, 3), /allunga/);
  assert.doesNotThrow(() => fixture(0, -1, 1, 48, 3));
  const lateral = stairGeometry(fixture(1, 0, 2, 48, 3).plan.stair);
  assert.equal(lateral.landing, 24); assert.equal(lateral.run - 2 * lateral.landing, lateral.rise, 'the central flight matches the reference 1:1 diagonal');
  assert.throws(() => fixture(0, 1, 2, 48, 3), /allunga/);
  assert.doesNotThrow(() => fixture(0, 1, 3, 48, 3));
});

test('stair corridors use actor radius, prevent side exits and support widths across partial tiles', () => {
  for (const width of [40, 48, 96, 144]) {
    const { world, plan } = fixture(1, 0, 4, width), p = center(stairPath(plan.stair)[2]);
    assert.equal(collidesWorld(p.x, p.y, 15, world, p), false);
    assert.equal(collidesWorld(p.x, p.y + width / 2 - 14, 15, world, p), true);
    const side = moveWithCollisions({ ...p, radius: 15 }, 0, 1, 2 * TILE_SIZE, world);
    assert.ok(side.y - p.y <= width / 2 - 15 + 1e-6);
    assert.equal(side.surfaceId, 'stair:test-stair');
    if (width > 48) assert.equal(plan.cells.length, 9, 'wide stairs allocate partial edge supports without changing ground');
  }
});

test('wide one-cell stair entrances never open the unused part of an outer bank cell', () => {
  const { world, from, to } = fixture(1, 0, 1, 96, 3);
  const outside = { ...center(from), y: center(from).y + 58, radius: 15 };
  const stopped = moveWithCollisions(outside, 1, 0, TILE_SIZE, world);
  assert.equal(stopped.elevation, 0);
  assert.ok(stopped.x < center(to).x - 20);
  const inside = { ...center(from), y: center(from).y + 30, radius: 15 };
  const crossed = moveWithCollisions(inside, 1, 0, TILE_SIZE, world);
  assert.equal(crossed.elevation, 3);
  assert.ok(Math.abs(crossed.x - center(to).x) < 1e-6);
});

test('authoring refuses intersecting flights even when one-cell stairs have no intermediate support', () => {
  const { document, plan } = fixture(1, 0, 1);
  document.surfaceCells!.find(c => c.x === 5 && c.y === 5)!.elevation = 0;
  const world = new World(document.seed, 16, 'world', document, []);
  assert.throws(() => planStair({ x: 5, y: 5, surfaceId: 'ground' }, { x: 5, y: 4, surfaceId: 'ground' },
    (x, y, id) => world.surfaceAt(x, y, id), { id: 'crossing', stairs: [plan.stair], cells: document.surfaceCells, links: document.surfaceLinks }), /incrocia/);
});

test('navigation and snapshot interpolation follow all adjacent generated stair edges', () => {
  const { world, plan, from, to } = fixture();
  const path = findSurfacePath(world, center(from), center(to));
  assert.ok(path); assert.equal(path.filter(p => p.surfaceId === 'stair:test-stair').length, 3);
  for (const link of stairLinks(plan.stair)) {
    const a = { ...center(link.from), ...world.surfaceState(center(link.from)) }, b = { ...center(link.to), ...world.surfaceState(center(link.to)) };
    assert.equal(canInterpolateSurfaceTransition(a, b, world), true);
    assert.equal(canInterpolateSurfaceTransition(b, a, world), true);
  }
  assert.equal(canInterpolateSurfaceTransition(center(from), { ...center(to), elevation: 3 }, world), false);
});

test('an authoritative NPC climbs a long staircase using the intermediate supports', () => {
  const { document, from, to } = fixture();
  for (let x = to.x + 1; x <= to.x + 3; x++) for (let y = to.y - 1; y <= to.y + 1; y++) document.surfaceCells!.push({ x, y, surfaceId: BASE_SURFACE, kind: 'ground', elevation: 3, material: 'grass', wallMaterial: 'rock' });
  const world = new World(document.seed, 16, 'world', document, []), target = { ...to, x: to.x + 2 };
  world.getChunk = (cx, cy) => ({ cx, cy, key: `${cx},${cy}`, tiles: [], pickups: [], npcs: cx === 0 && cy === 0
    ? [{ id: 'stair-sentinel', ...center(from), npcKind: 'sentinel', level: 1, settings: { aggroRadius: 1000, leashRadius: 1000, speed: 190 } }] : [] });
  const sim = new WorldSimulation(42, 1_000_000, undefined, 'world', { world, dungeons: [], bosses: new Map(), spawn: center(from) });
  const account: Account = { id: 'stair-target', name: 'Target', nameLower: 'target', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 };
  const player = sim.addPlayer(account, 'warrior');
  Object.assign(player, center(target), world.surfaceState(center(target)), { spawnProtectedUntil: 0 });
  let sawIntermediate = false;
  for (let i = 0; i < 180; i++) { sim.step(); sawIntermediate ||= sim.npcs.get('stair-sentinel')?.surfaceId === 'stair:test-stair'; }
  const npc = sim.npcs.get('stair-sentinel')!;
  assert.equal(sawIntermediate, true); assert.equal(npc.elevation, 3); assert.equal(npc.surfaceId, BASE_SURFACE);
  assert.ok(player.hp < player.maxHp, 'the NPC reaches and attacks the player on the upper landing');
});

test('stairs survive world compaction, dungeon import/export and relocation, and removal is atomic', () => {
  const { document, plan } = fixture();
  const restored = parseWorldDocument(serializeWorldDocument(compactWorldTiles(document)));
  assert.deepEqual(restored.surfaceStairs, document.surfaceStairs);
  const draft = newDungeonDraft(16, 16); draft.id = 'stair-roundtrip'; draft.encounters = [];
  draft.surfaceCells = document.surfaceCells; draft.surfaceLinks = document.surfaceLinks; draft.surfaceStairs = document.surfaceStairs;
  const imported = parseDungeonDraft(serializeDungeonDraft(draft));
  assert.deepEqual(imported.surfaceStairs, draft.surfaceStairs);
  const definition = compileDungeonDraft(imported).definition, moved = relocateDungeon(definition, { x: 60, y: 80 });
  const roundtrip = draftFromDungeon(moved);
  assert.deepEqual(roundtrip.surfaceStairs, plan.stair ? [plan.stair] : []);
  assert.equal(moved.surfaceStairs![0].from.x, plan.stair.from.x + 60);
  assert.equal(moved.surfaceStairs![0].from.y, plan.stair.from.y + 80);
  assert.equal(removeStair(restored, plan.stair.id), true);
  assert.deepEqual(restored.surfaceStairs, []); assert.deepEqual(restored.surfaceLinks, []);
  assert.ok(restored.surfaceCells!.every(c => c.kind === 'ground'));
  assert.equal(removeStair(restored, plan.stair.id), false);
});

test('parsers reject incomplete staircase ownership and legacy adjacent links remain supported', () => {
  const { document } = fixture();
  const missing = structuredClone(document); missing.surfaceLinks!.pop();
  assert.throws(() => parseWorldDocument(missing), /intermedi/);
  const orphan = structuredClone(document); delete orphan.surfaceStairs;
  assert.throws(() => parseWorldDocument(orphan), /struttura/);
  const legacy = newWorldDocument(); legacy.tiles = document.tiles;
  legacy.surfaceCells = [{ x: 5, y: 4, surfaceId: BASE_SURFACE, elevation: 3, material: 'grass', wallMaterial: 'rock', kind: 'ground' }];
  legacy.surfaceLinks = [{ id: 'legacy-south', kind: 'stairs', from: { x: 5, y: 3, surfaceId: BASE_SURFACE }, to: { x: 5, y: 4, surfaceId: BASE_SURFACE } }];
  assert.doesNotThrow(() => parseWorldDocument(legacy));
  const world = new World(42, 16, 'world', legacy, []), finish = moveWithCollisions({ ...center(legacy.surfaceLinks[0].from), radius: 15 }, 0, 1, TILE_SIZE, world);
  assert.equal(finish.elevation, 3);
});

test('erasing a staircase clears content on its support and returns its spawn to a surviving landing', () => {
  const { document, plan } = fixture(), support = 'stair:test-stair';
  const content = [{ surfaceId: support }, { surfaceId: BASE_SURFACE }, { surfaceId: 'another-deck' }];
  const data: StairData = { ...structuredClone(document), placements: structuredClone(content), npcs: structuredClone(content),
    assetPlacements: structuredClone(content), entities: structuredClone(content), spawn: { ...plan.cells[0] } };
  const ground = structuredClone(document.surfaceCells!.filter(c => c.kind === 'ground'));
  assert.equal(removeStair(data, plan.stair.id), true);
  for (const key of ['placements', 'npcs', 'assetPlacements', 'entities'] as const)
    assert.deepEqual(data[key], content.slice(1), `${key}: objects on other planes survive`);
  assert.deepEqual(data.surfaceCells, ground, 'terrain and both landings survive');
  assert.deepEqual(data.spawn, plan.stair.from);
  assert.doesNotThrow(() => parseWorldDocument({ ...document, ...data, assetPlacements: undefined, entities: undefined,
    placements: [], npcs: [] }));
});
