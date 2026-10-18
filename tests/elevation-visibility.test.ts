import test from 'node:test';
import assert from 'node:assert/strict';
import { assetVisible, exposedSurfaceParts, filterGeometry, floorVisible, parseVisibleFloors, shapeVisible } from '../client/editors/world/elevation-visibility';
import { emptyGeometry } from '../shared/elevation';
import { newWorldAsset } from '../shared/world-schema';

test('visibility supports every floor, disjoint signed floors and an empty selection', () => {
  assert.equal(floorVisible(null, -128), true); assert.equal(floorVisible(null, 127), true);
  const filter = parseVisibleFloors(' 2, -1, 0, 2, 14 ');
  assert.deepEqual(filter, [-1, 0, 2, 14]); assert.equal(floorVisible(filter, 1), false);
  assert.equal(floorVisible(parseVisibleFloors(''), 0), false);
  for (const value of ['1.5', '128', '-129', '0,', '0 2', 'hello']) assert.throws(() => parseVisibleFloors(value));
});
test('isolated floors leave holes where terrain mass replaces a lower surface', () => {
  const g = emptyGeometry();
  const lower = { id: 'lower', x: 0, y: 0, width: 2, height: 1, elevation: 1, ground: true };
  g.surfaces.push(lower, { id: 'upper', x: 0, y: 0, width: 1, height: 1, elevation: 2, ground: true });
  g.solids.push({ id: 'upper-mass', x: 0, y: 0, width: 1, height: 1, base: 1, top: 2 });
  assert.deepEqual(exposedSurfaceParts(lower, g).map(s => [s.x, s.width]), [[1, 1]]);
  const visible = filterGeometry(g, [1]);
  assert.equal(visible.surfaces.length, 1); assert.equal(visible.surfaces[0].x, 1);
  assert.equal(visible.solids.length, 0); assert.equal(filterGeometry(g, null), g);
});
test('bridges retain the lower surface; solids and stair halves respect chosen floors', () => {
  const g = emptyGeometry();
  g.surfaces.push({ id: 'ground', x: 0, y: 0, width: 2, height: 1, elevation: 0 }, { id: 'bridge', x: 0, y: 0, width: 2, height: 1, elevation: 2 });
  g.solids.push({ id: 'pillar', x: 0, y: 0, width: .25, height: .25, base: 0, top: 2 });
  g.stairs.push({ id: 'stairs', x: 0, y: 0, width: 4, height: 2, from: 0, to: 2, axis: 'x' });
  assert.equal(filterGeometry(g, [0]).surfaces[0].width, 2);
  assert.equal(shapeVisible(g.solids[0], [1]), true); assert.equal(shapeVisible(g.solids[0], [2]), false);
  const upper = filterGeometry(g, [2]); assert.equal(upper.stairs[0].x, 2); assert.equal(upper.stairs[0].width, 2);
  assert.equal(filterGeometry(g, [0, 2]).stairs[0].width, 4);
});
test('assets can be visible through a relative upper floor while their base is hidden', () => {
  const a = newWorldAsset('bridge', 'Ponte', '/world-assets/test.png');
  a.geometry = emptyGeometry(); a.geometry.surfaces.push({ id: 'deck', x: 0, y: 0, width: 1, height: 1, elevation: 2 });
  assert.equal(assetVisible(a, 5, [7]), true); assert.equal(assetVisible(a, 5, [0, 2]), false);
  assert.equal(assetVisible(a, 5, null), true);
});
