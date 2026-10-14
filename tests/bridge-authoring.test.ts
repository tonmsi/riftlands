import test from 'node:test';
import assert from 'node:assert/strict';
import { planBridge, planBridgeRoute } from '../client/editors/surface-authoring';
import { BASE_SURFACE, validateSurfaceData, type SurfaceCell } from '../shared/world-surfaces';
import type { Vec2 } from '../shared/types';

function ground(x: number, y: number, elevation = 3): SurfaceCell {
  return { x, y, elevation, surfaceId: BASE_SURFACE, kind: 'ground', material: 'grass', wallMaterial: 'rock' };
}
const lookup = (cells: readonly SurfaceCell[]) => (p: Vec2) => cells.find(c => c.x === p.x && c.y === p.y && c.surfaceId === (p.surfaceId ?? BASE_SURFACE));
const columns = (cells: readonly SurfaceCell[]) => (x: number, y: number) => cells.filter(c => c.x === x && c.y === y);
const settings = { material: 'wood', wallMaterial: 'wood' } as const;

test('three-lane bridges validate each bank and link every lane without replacing the terrain below', () => {
  const banks = [-1, 0, 1].flatMap(y => [ground(0, y), ground(4, y)]);
  const below = [1, 2, 3].flatMap(x => [-1, 0, 1].map(y => ({ ...ground(x, y, 0), material: 'water' as const })));
  const terrain = [...banks, ...below], before = structuredClone(terrain);
  const plan = planBridge({ x: 0, y: 0 }, { x: 4, y: 0 }, lookup(terrain), { ...settings, widthTiles: 3 });
  assert.equal(plan.cells.length, 9); assert.equal(plan.links.length, 6);
  assert.deepEqual(new Set(plan.cells.map(c => c.y)), new Set([-1, 0, 1]));
  assert.deepEqual(terrain, before);
  assert.doesNotThrow(() => validateSurfaceData([...terrain, ...plan.cells], plan.links));
  assert.throws(() => planBridge({ x: 0, y: 0 }, { x: 4, y: 0 }, lookup(terrain.filter(c => c.x !== 4 || c.y !== 1)), { ...settings, widthTiles: 3 }), /Tutte le corsie/);
});

test('two-lane bridges have a stable positive-side footprint when reversing a drag', () => {
  const banks = [0, 1].flatMap(y => [ground(-4, y), ground(0, y)]);
  const forward = planBridge({ x: -4, y: 0 }, { x: 0, y: 0 }, lookup(banks), { ...settings, widthTiles: 2 });
  const reverse = planBridge({ x: 0, y: 0 }, { x: -4, y: 0 }, lookup(banks), { ...settings, widthTiles: 2 });
  assert.equal(forward.cells[0].surfaceId, reverse.cells[0].surfaceId);
  assert.deepEqual(new Set(forward.cells.map(c => `${c.x},${c.y}`)), new Set(reverse.cells.map(c => `${c.x},${c.y}`)));
});

test('wide L routes fill the entire elbow and their entries meet banks on both axes', () => {
  const banks = [-1, 0, 1].flatMap(offset => [ground(0, offset), ground(4 + offset, 4)]);
  const plan = planBridge({ x: 0, y: 0 }, { x: 4, y: 4 }, lookup(banks), { ...settings, widthTiles: 3, route: 'horizontal-first' });
  for (const x of [3, 4, 5]) for (const y of [-1, 0, 1]) assert.ok(plan.cells.some(c => c.x === x && c.y === y), `missing elbow ${x},${y}`);
  assert.equal(plan.links.length, 6);
  assert.doesNotThrow(() => validateSurfaceData([...banks, ...plan.cells], plan.links));
  const turned = planBridge({ x: 0, y: 0 }, { x: 4, y: 4 }, lookup([ground(0, 0), ground(4, 4)]), { ...settings, route: 'vertical-first' });
  assert.ok(turned.cells.some(c => c.x === 0 && c.y === 3));
  assert.equal(turned.cells.some(c => c.x === 3 && c.y === 0), false);
});

test('all lanes and bends are checked against raised ground and existing independent bridges', () => {
  const banks = [0, 1].flatMap(y => [ground(0, y), ground(4, y)]), obstruction = ground(2, 1, 3);
  assert.throws(() => planBridge({ x: 0, y: 0 }, { x: 4, y: 0 }, lookup([...banks, obstruction]), { ...settings, widthTiles: 2 }), /attraversa terreno/);
  const existing: SurfaceCell = { ...ground(2, 1), kind: 'bridge', surfaceId: 'old' };
  assert.throws(() => planBridge({ x: 0, y: 0 }, { x: 4, y: 0 }, lookup(banks), { ...settings, widthTiles: 2, existingAt: columns([existing]) }), /ponte esistente/);
});

test('explicit extension can form a T while preserving old deck cells and lower ground', () => {
  const original = [1, 2, 3].map(x => ({ ...ground(x, 0), surfaceId: 'deck', kind: 'bridge' as const }));
  const banks = [ground(2, 3), original[1]], underneath = ground(2, 1, 0), terrain = [...original, ...banks, underneath];
  const before = structuredClone(terrain);
  const plan = planBridge(original[1], banks[0], lookup(terrain), { ...settings, id: 'deck', extendExisting: true, existingAt: columns(terrain) });
  assert.deepEqual(plan.cells.map(c => [c.x, c.y]), [[2, 1], [2, 2]]);
  assert.equal(plan.links.length, 1, 'adjacent deck cells connect on the same plane without a redundant link');
  assert.deepEqual(terrain, before);
  assert.doesNotThrow(() => validateSurfaceData([...original, banks[0], underneath, ...plan.cells], plan.links));
  const overlapping = planBridge({ x: 0, y: 0 }, { x: 4, y: 0 }, lookup([...terrain, ground(0, 0), ground(4, 0)]), {
    ...settings, id: 'deck', extendExisting: true, existingAt: columns(terrain),
  });
  assert.equal(overlapping.cells.length, 0);
  assert.equal(overlapping.links.length, 2);
});

test('route planning supports explicit waypoints with bounded cells and valid adjacent links', () => {
  const banks = [ground(0, 0), ground(6, 2)];
  const plan = planBridgeRoute(banks[0], [{ x: 3, y: 0 }, { x: 3, y: 2 }], banks[1], lookup(banks), settings);
  assert.ok(plan.cells.some(c => c.x === 3 && c.y === 1));
  assert.doesNotThrow(() => validateSurfaceData([...banks, ...plan.cells], plan.links));
  assert.throws(() => planBridgeRoute(banks[0], [{ x: 2, y: 2 }], banks[1], lookup(banks), settings), /orizzontale o in verticale/);
});
