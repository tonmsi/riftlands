import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE_SIZE } from '../shared/config';
import { SurfaceIndex, type SurfaceCell } from '../shared/world-surfaces';
import { naturalEdgeInset, surfaceContour, type ContourPoint } from '../client/render/surface-contours';
import { SurfaceTerrain } from '../client/render/surface-terrain';
import type { TerrainMaterials } from '../client/render/terrain-materials';
import type { EnvironmentArt } from '../client/render/environment-art';
import type { World } from '../shared/world';

function cell(x: number, y: number, options: Partial<SurfaceCell> = {}): SurfaceCell {
  return { x, y, elevation: 3, kind: 'ground', surfaceId: 'ground', material: 'grass', wallMaterial: 'earth', ...options };
}
function contour(current: SurfaceCell, cells: SurfaceCell[]) {
  return surfaceContour(current, (dx, dy) => cells.find(n => n.x === current.x + dx && n.y === current.y + dy));
}
function inside(point: ContourPoint, polygon: ContourPoint[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

test('natural isolated platforms have rounded silhouettes and retain the central playable footprint', () => {
  const current = cell(-3, 7), shape = contour(current, [current])!;
  assert.equal(shape.corners.every(corner => corner.length === 5), true);
  assert.equal(inside({ x: .5, y: .5 }, shape.outline), false);
  for (const x of [12, 24, 36]) for (const y of [12, 24, 36]) assert.equal(inside({ x, y }, shape.outline), true);
  assert.ok(shape.outline.every(point => point.x >= 0 && point.x <= TILE_SIZE && point.y >= 0 && point.y <= TILE_SIZE));
  assert.ok(shape.southFace.every((point, index, points) => !index || point.x >= points[index - 1].x), 'the cliff profile never doubles back');
});

test('masonry, bridges and zero-height ground keep their existing rectangular geometry', () => {
  for (const options of [{ wallMaterial: 'brick' as const }, { wallMaterial: 'stone' as const }, { wallMaterial: 'wood' as const },
    { kind: 'bridge' as const, surfaceId: 'bridge-test' }, { elevation: 0 }]) {
    const current = cell(2, 2, options);
    assert.equal(contour(current, [current]), undefined);
  }
});

test('adjacent natural tops meet without holes and share their irregular exposed rim', () => {
  const a = cell(-2, 3), b = cell(-1, 3), cells = [a, b];
  const left = contour(a, cells)!, right = contour(b, cells)!;
  const last = left.edges.north.at(-1)!, first = right.edges.north[0];
  assert.equal(a.x * TILE_SIZE + last.x, b.x * TILE_SIZE + first.x);
  assert.equal(last.y, first.y);
  assert.deepEqual(left.edges.east[0], { x: TILE_SIZE, y: first.y });
  assert.equal(left.exposed.east, false); assert.equal(right.exposed.west, false);
  for (let y = 4; y < TILE_SIZE - 4; y += .5) {
    assert.equal(inside({ x: TILE_SIZE - .05, y }, left.outline), true);
    assert.equal(inside({ x: .05, y }, right.outline), true);
  }
  assert.equal(left.edges.south[0].y, right.edges.south.at(-1)!.y);
});

test('north-south joints share the same side profile across negative coordinates', () => {
  const a = cell(-4, -2), b = cell(-4, -1), cells = [a, b];
  const top = contour(a, cells)!, bottom = contour(b, cells)!;
  assert.equal(top.edges.east.at(-1)!.x, bottom.edges.east[0].x);
  assert.equal(top.edges.west[0].x, bottom.edges.west.at(-1)!.x);
  assert.equal(top.edges.south[0].y, TILE_SIZE);
  assert.equal(bottom.edges.north[0].y, 0);
  for (let x = 4; x < TILE_SIZE - 4; x += .5) {
    assert.equal(inside({ x, y: TILE_SIZE - .05 }, top.outline), true);
    assert.equal(inside({ x, y: .05 }, bottom.outline), true);
  }
});

test('inner corners receive a bounded curved transition and diagonal platforms stay joined', () => {
  const current = cell(0, 0), north = cell(0, -1), west = cell(-1, 0);
  const shape = contour(current, [current, north, west])!;
  assert.equal(shape.inlets.length, 1);
  assert.equal(shape.inlets[0].lowerElevation, 0);
  assert.equal(inside({ x: -1, y: -1 }, shape.inlets[0].outline), true);
  assert.equal(inside({ x: -8, y: -8 }, shape.inlets[0].outline), false);
  assert.ok(shape.inlets[0].outline.every(point => point.x >= -9 && point.y >= -9 && point.x <= 0 && point.y <= 0));
  const diagonal = cell(1, 1), joined = contour(current, [current, diagonal])!;
  assert.equal(joined.corners[2].length, 0);
  assert.equal(inside({ x: TILE_SIZE - .05, y: TILE_SIZE - .05 }, joined.outline), true);
});

test('natural ground meets constructed top edges flush and does not curve into their footprint', () => {
  const a = cell(0, 0), masonry = cell(1, 0, { wallMaterial: 'brick' });
  const shape = contour(a, [a, masonry])!;
  assert.equal(shape.edges.north.at(-1)!.y, 0);
  assert.equal(shape.edges.south[0].y, TILE_SIZE);
  assert.equal(shape.edges.east.every(point => point.x === TILE_SIZE), true);
  assert.equal(shape.inlets.length, 0);
});

test('edge deviation is continuous at world sample boundaries and remains small', () => {
  for (const coordinate of [-48, -12, 0, 12, 48]) {
    assert.ok(Math.abs(naturalEdgeInset(coordinate - .00001, 48, true) - naturalEdgeInset(coordinate + .00001, 48, true)) < .00001);
    const inset = naturalEdgeInset(coordinate, -48, true);
    assert.ok(inset >= .7 && inset <= 2.5);
    assert.equal(inset, naturalEdgeInset(coordinate, -48, true));
  }
});

test('overview surface levels inspect only sparse metadata, keep dungeon overrides and elevation overflow', () => {
  const original = cell(5, 5), override = cell(5, 5, { elevation: 4, wallMaterial: 'brick' });
  const bridge = cell(5, 5, { kind: 'bridge', surfaceId: 'bridge-test', elevation: 5 });
  const overflow = cell(2, 1005), outside = cell(2, 1007), matchingBase = cell(4, 4, { elevation: 0 });
  const index = new SurfaceIndex([original, bridge, overflow, outside, matchingBase, override]);
  let lookups = 0, tiles = 0;
  const at = index.at.bind(index);
  index.at = (x, y, id) => { lookups++; return at(x, y, id); };
  index.atColumn = () => { throw new Error('Overview must not scan empty map columns'); };
  const world = { authoring: { document: { surfaceCells: [original, bridge, overflow, outside, matchingBase] } },
    dungeons: [{ surfaceCells: [override] }], surfaceIndex: index, authoringRevision: 0,
    getTile() { tiles++; return 'grass'; } } as unknown as World;
  const painter = new SurfaceTerrain({} as TerrainMaterials, {} as EnvironmentArt);
  const bounds = { left: 0, top: 0, right: TILE_SIZE * 1000, bottom: TILE_SIZE * 1000 };
  const levels = painter.levels(world, bounds);
  assert.deepEqual(levels.map(level => level.elevation), [3, 4, 5]);
  assert.equal(levels[0].cells[0], overflow, 'projected cells below the logical viewport remain visible');
  assert.equal(levels[1].cells[0], override, 'the active dungeon cell wins at the shared key');
  assert.equal(levels[2].cells[0], bridge, 'stacked surfaces retain their identity');
  assert.equal(lookups, 4, 'the million-column viewport costs one lookup per unique sparse visible cell');
  assert.equal(tiles, 1, 'only redundant base ground needs a legacy tile comparison');
  assert.equal(painter.levels(world, bounds), levels, 'unchanged viewport uses the cache');
  assert.deepEqual(painter.levels(world, bounds, 'bridge').flatMap(level => level.cells), [bridge]);
  world.authoringRevision++;
  assert.notEqual(painter.levels(world, bounds), levels, 'authored revisions refresh sparse visibility');
});
