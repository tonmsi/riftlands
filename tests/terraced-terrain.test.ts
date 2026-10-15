import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE_SIZE } from '../shared/tile-size';
import { World } from '../shared/world';
import { newWorldAsset, newWorldDocument, parseWorldDocument, resizeWorldAsset } from '../shared/world-schema';
import { SurfaceIndex, type SurfaceCell, type SurfaceEndpoint } from '../shared/world-surfaces';
import { deriveTerracedTerrain } from '../shared/terraced-terrain';
import { planStair, removeStair, stairPath, stairSpatialIssues } from '../shared/surface-stairs';
import { collidesWorld, hasLineOfSight, moveWithCollisions } from '../shared/physics';
import { sweptWorldHit } from '../shared/projectiles';
import { findSurfacePath } from '../shared/surface-navigation';
import { compactWorldTiles, serializeWorldDocument } from '../shared/world-tiles';
import { parseDungeonSurfaces } from '../shared/dungeon-surfaces';
import { compileDungeonDraft, draftFromDungeon, newDungeonDraft, parseDungeonDraft, serializeDungeonDraft } from '../shared/dungeon-draft';
import { relocateDungeon } from '../shared/dungeon-relocation';

const cell = (x: number, y: number, elevation: number): SurfaceCell => ({ x, y, elevation, surfaceId: 'ground',
  material: 'grass', wallMaterial: 'rock', kind: 'ground', layout: 'terraced' });
const center = (p: SurfaceEndpoint) => ({ x: (p.x + .5) * TILE_SIZE, y: (p.y + .5) * TILE_SIZE, surfaceId: p.surfaceId });
function fixture(height = 2, dx = 1, dy = 0, width = TILE_SIZE) {
  const document = newWorldDocument();
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) document.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  document.surfaceCells = [];
  for (let y = 4; y <= 18; y++) for (let x = 4; x <= 18; x++) document.surfaceCells.push(cell(x, y, height));
  const from = { x: dx ? dx > 0 ? 3 : 19 : 11, y: dy ? dy > 0 ? 3 : 19 : 11, surfaceId: 'ground' };
  const to = { x: from.x + dx * (height + 1), y: from.y + dy * (height + 1), surfaceId: 'ground' };
  const base = new World(document.seed, 16, 'world', document, []);
  const plan = planStair(from, to, (x, y, id) => base.surfaceAt(x, y, id), { id: 'terrace-flight', profile: 'terraced', width,
    cells: document.surfaceCells });
  document.surfaceCells.push(...plan.cells); document.surfaceLinks = plan.links; document.surfaceStairs = [plan.stair];
  return { document, from, to, plan, world: new World(document.seed, 16, 'world', document, []) };
}

test('one tile per logical level produces independent wall rings and a walkable summit', () => {
  for (const height of [1, 2, 3]) {
    const raw: SurfaceCell[] = [];
    for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) raw.push(cell(x, y, height));
    const index = new SurfaceIndex(raw);
    for (let depth = 0; depth < height; depth++) {
      const wall = index.at(depth, 5)!;
      assert.equal(wall.elevation, depth + 1); assert.equal(wall.logicalElevation, height);
      assert.equal(wall.terrainRole, 'wall'); assert.equal(wall.blocked, true); assert.equal(wall.wallMask, 8);
    }
    assert.equal(index.at(height, 5)!.elevation, height);
    assert.equal(index.at(height, 5)!.terrainRole, undefined);
    assert.equal(index.authoredAt(0, 5)!.elevation, height);
    assert.ok(raw.every(c => c.elevation === height && c.blocked === undefined), 'derivation leaves saved terrain intact');
  }
});

test('convex and concave corners connect through their cardinal masks and terrain edits rebuild rings', () => {
  const raw: SurfaceCell[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (!(x >= 4 && y < 4)) raw.push(cell(x, y, 2));
  const before = deriveTerracedTerrain(raw);
  assert.equal(before.get('0,0')!.wallMask, 9, 'external corner joins north and west');
  assert.equal(before.get('3,4')!.elevation, 2);
  assert.equal(before.get('3,4')!.wallMask, 3, 'inner ring connects around the concave notch');
  const next = new SurfaceIndex(raw.filter(c => c.x !== 2 || c.y !== 4));
  assert.equal(next.at(3, 4)!.elevation, 1, 'removing terrain immediately exposes an inner wall');
  assert.equal(next.at(3, 4)!.wallMask, 8);
  const legacy = { ...cell(20, 20, 3), layout: undefined };
  assert.deepEqual(new SurfaceIndex([legacy]).at(20, 20), legacy, 'historical single-cell platforms retain their top');
});

test('integrated stairs cross exactly their wall bands in every orientation, width and direction', () => {
  for (const height of [1, 2, 3]) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const width of [48, 96, 144]) {
    const { world, document, from, to, plan } = fixture(height, dx, dy, width);
    assert.equal(stairPath(plan.stair).length, height + 2);
    assert.deepEqual(stairSpatialIssues(plan.stair, (x, y, id) => world.surfaceAt(x, y, id)), []);
    const climbed = moveWithCollisions({ ...center(from), radius: 15 }, dx, dy, (height + 1) * TILE_SIZE, world);
    assert.ok(Math.hypot(climbed.x - center(to).x, climbed.y - center(to).y) < 1e-6, `${height}/${dx}/${dy}/${width}`);
    assert.equal(climbed.surfaceId, 'ground'); assert.equal(climbed.elevation, height);
    const descended = moveWithCollisions({ ...climbed, radius: 15 }, -dx, -dy, (height + 1) * TILE_SIZE, world);
    assert.ok(Math.hypot(descended.x - center(from).x, descended.y - center(from).y) < 1e-6);
    const path = findSurfacePath(world, center(from), center(to));
    assert.equal(path?.filter(p => p.surfaceId === 'stair:terrace-flight').length, height);
    assert.ok(document.surfaceCells!.filter(c => c.kind === 'ground').every(c => c.elevation === height), 'stairs preserve logical height');
    const support = center(stairPath(plan.stair)[1]);
    assert.equal(collidesWorld(support.x, support.y, 15, world, support), false);
    assert.equal(collidesWorld(support.x, support.y, 15, world, { ...support, surfaceId: 'ground' }), true);
  }
});

test('removing stairs restores physical walls and ordinary floors cannot erase their collision', () => {
  const { document, from, to, plan } = fixture();
  assert.equal(removeStair(document, plan.stair.id), true);
  const floor = newWorldAsset('floor', 'Floor', '/world-assets/waystone.svg'); floor.category = 'floor';
  document.assets.push(floor); document.placements.push({ id: 'wall-floor', assetId: floor.id, x: 4, y: 11 });
  const world = new World(document.seed, 16, 'world', document, []), wall = world.surfaceAt(4, 11)!;
  assert.equal(wall.terrainRole, 'wall'); assert.equal(wall.blocked, true);
  const climbed = moveWithCollisions({ ...center(from), radius: 15 }, 1, 0, 3 * TILE_SIZE, world);
  assert.ok(climbed.x <= 4 * TILE_SIZE - 15);
  assert.equal(sweptWorldHit(center(from), center(to), 0, world), 1 / 6);
});

test('terraced plans reject gaps, extra length, suspended bodies and non-grid widths', () => {
  const { document, from, to, plan } = fixture(); removeStair(document, plan.stair.id);
  const world = new World(document.seed, 16, 'world', document, []), lookup = (x: number, y: number, id: string) => world.surfaceAt(x, y, id);
  for (const settings of [{ underpass: true }, { width: 40 }])
    assert.throws(() => planStair(from, to, lookup, { id: 'invalid', profile: 'terraced', ...settings }), /incassata/);
  assert.throws(() => planStair(from, { ...to, x: to.x + 1 }, lookup, { id: 'long', profile: 'terraced' }), /pianerottoli/);
  const changed = structuredClone(document); changed.surfaceCells!.find(c => c.x === 5 && c.y === 11)!.elevation = 0;
  const edited = new World(document.seed, 16, 'world', changed, []);
  assert.throws(() => planStair(from, to, (x, y, id) => edited.surfaceAt(x, y, id), { id: 'gap', profile: 'terraced' }), /fascia|pianerottoli/);
});

test('rays use the opened stair corridor while the rock beside partial outer lanes remains solid', () => {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const { world, plan } = fixture(2, dx, dy, 96), middle = center(stairPath(plan.stair)[1]);
    const origin = { ...middle, elevation: 1 }, side = (offset: number) => ({ ...origin, x: origin.x - dy * offset, y: origin.y + dx * offset });
    assert.equal(sweptWorldHit(origin, side(38), 0, world), null, 'the trench contains an uninterrupted opening');
    assert.equal(hasLineOfSight(origin, side(38), world), true);
    assert.equal(sweptWorldHit(origin, side(60), 0, world), .8, 'the remaining half of the outside wall lane begins at the corridor edge');
    assert.equal(hasLineOfSight(origin, side(60), world), false);
    assert.equal(sweptWorldHit(origin, side(60), 5, world), 43 / 60, 'sweeps include the projectile radius at the cut edge');
  }
});

test('saved terrain and descriptors survive compaction and dungeon parsing; derived fields stay out of saved maps', () => {
  const { document, plan } = fixture();
  const restored = parseWorldDocument(serializeWorldDocument(compactWorldTiles(document)));
  assert.deepEqual(restored.surfaceCells, document.surfaceCells); assert.deepEqual(restored.surfaceStairs, [plan.stair]);
  const dungeon = parseDungeonSurfaces(document, { minTx: 0, minTy: 0, maxTx: 23, maxTy: 23 });
  assert.deepEqual(dungeon.surfaceCells, document.surfaceCells); assert.deepEqual(dungeon.surfaceStairs, [plan.stair]);
  assert.ok(restored.surfaceCells!.every(c => !('terrainRole' in c) && !('logicalElevation' in c)));
  const invalid = structuredClone(document); (invalid.surfaceCells![0] as any).layout = 'other';
  assert.throws(() => parseWorldDocument(invalid), /Superfici/);
  const draft = newDungeonDraft(24, 24); draft.id = 'terraced-roundtrip'; draft.encounters = [];
  draft.surfaceCells = document.surfaceCells; draft.surfaceLinks = document.surfaceLinks; draft.surfaceStairs = document.surfaceStairs;
  const asset = newWorldAsset('terraced-top', 'Terraced top', '/world-assets/waystone.svg');
  resizeWorldAsset(asset, 15, 15); asset.category = 'elevation';
  asset.elevation = { height: 2, material: 'grass', wallMaterial: 'rock' };
  draft.assetPlacements = [{ id: 'terraced-top-placement', assetId: asset.id, x: 4, y: 4, surfaceId: 'ground', elevation: 2 }];
  const imported = parseDungeonDraft(serializeDungeonDraft(draft)), definition = compileDungeonDraft(imported, [asset]).definition;
  assert.equal(definition.assetPlacements![0].elevation, 2, 'the summit PNG retains its logical lift even when its anchor is on the outer wall');
  const moved = relocateDungeon(definition, { x: 60, y: 80 }), roundtrip = draftFromDungeon(moved);
  assert.deepEqual(roundtrip.surfaceStairs, [plan.stair]);
  assert.deepEqual(roundtrip.surfaceCells, document.surfaceCells);
  assert.equal(moved.surfaceStairs![0].from.x, plan.stair.from.x + 60);
  assert.equal(moved.surfaceCells![0].layout, 'terraced');
});

test('import rejects a terraced flight whose logical landing has become a derived wall', () => {
  const { document, to } = fixture();
  const changed = structuredClone(document);
  changed.surfaceCells!.find(c => c.x === to.x && c.y === to.y - 1 && c.kind === 'ground')!.elevation = 1;
  const landing = new SurfaceIndex(changed.surfaceCells).at(to.x, to.y)!;
  assert.equal(landing.elevation, 2); assert.equal(landing.logicalElevation, 2);
  assert.equal(landing.terrainRole, 'wall');
  assert.throws(() => parseWorldDocument(changed), /pianerottolo incassato/);
});
