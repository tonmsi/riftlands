import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeGeometry } from '../shared/bridge-geometry';
import type { SurfaceCell, SurfaceEndpoint } from '../shared/world-surfaces';

function deck(x: number, y: number, surfaceId = 'deck', elevation = 3): SurfaceCell {
  return { x, y, surfaceId, elevation, material: 'stone', wallMaterial: 'stone', kind: 'bridge' };
}
const lookup = (cells: SurfaceCell[]) => (x: number, y: number, id: string) => cells.find(c => c.x === x && c.y === y && c.surfaceId === id);

test('a wide bridge draws only the perimeter of its complete footprint', () => {
  const cells = Array.from({ length: 12 }, (_, i) => deck(i % 4, Math.floor(i / 4)));
  const geometry = bridgeGeometry(cells);
  assert.equal(geometry.edges.length, 14);
  assert.equal(geometry.corners.length, 4);
  assert.ok(geometry.corners.every(corner => corner.kind === 'convex'));
  assert.ok(geometry.edges.every(edge => edge.direction === 'north' ? edge.cell.y === 0
    : edge.direction === 'south' ? edge.cell.y === 2 : edge.direction === 'west' ? edge.cell.x === 0 : edge.cell.x === 3));
});

test('L shapes and T junctions join their interior and classify inward corners', () => {
  const elbow = [deck(0, 0), deck(1, 0), deck(1, 1)], shape = bridgeGeometry(elbow);
  assert.equal(shape.edges.length, 8);
  assert.equal(shape.corners.filter(corner => corner.kind === 'concave').length, 1);
  const junction = bridgeGeometry([deck(0, 0), deck(1, 0), deck(2, 0), deck(1, 1)]);
  assert.equal(junction.edges.length, 10);
  assert.equal(junction.corners.filter(corner => corner.kind === 'concave').length, 2);
});

test('a plaza ring retains the inside perimeter and a gap never creates a phantom connection', () => {
  const ring = Array.from({ length: 9 }, (_, i) => deck(i % 3, Math.floor(i / 3))).filter(c => c.x !== 1 || c.y !== 1);
  const geometry = bridgeGeometry(ring);
  assert.equal(geometry.edges.length, 16);
  assert.equal(geometry.corners.filter(corner => corner.kind === 'concave').length, 4);
  const split = bridgeGeometry([deck(0, 0), deck(2, 0)]);
  assert.equal(split.edges.length, 8);
  assert.equal(split.corners.length, 8);
});

test('only same-height cells on the same plane remove a border, including outside the viewport', () => {
  const current = deck(-2, -3), right = deck(-1, -3), below = deck(-2, -2, 'other'), above = deck(-2, -4, 'deck', 4);
  const shape = bridgeGeometry([current], lookup([current, right, below, above]));
  assert.deepEqual(shape.edges.map(edge => edge.direction), ['north', 'south', 'west']);
});

test('a physical entry opens just its border while stairs to lower planes remain protected', () => {
  const current = deck(0, 0), bank = { ...deck(-1, 0, 'ground'), kind: 'ground' as const }, lower = deck(0, 1, 'lower', 1);
  const exits: SurfaceEndpoint[] = [{ x: -1, y: 0, surfaceId: 'ground' }, { x: 0, y: 1, surfaceId: 'lower' }];
  const shape = bridgeGeometry([current], lookup([current, bank, lower]), () => exits);
  assert.deepEqual(shape.edges.filter(edge => edge.entrance).map(edge => edge.direction), ['west']);
  assert.equal(shape.edges.find(edge => edge.direction === 'south')!.entrance, false);
});
