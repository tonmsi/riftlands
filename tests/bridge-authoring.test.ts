import test from 'node:test';
import assert from 'node:assert/strict';
import { addSuspendedSurface, updateGeometry } from '../shared/elevation-editing';
import { emptyGeometry, circleSupported, type WorldSurface } from '../shared/elevation';
import { newWorldDocument } from '../shared/world-schema';
import { World } from '../shared/world';
import { validateWorld } from '../shared/world-validation';
import { TILE_SIZE } from '../shared/config';

const deck: WorldSurface = { id: 'bridge', x: 0, y: 0, width: 8, height: 2, elevation: 1, ground: false, terrain: 'path' };
function fixture() {
  const document = newWorldDocument(1);
  document.geometry = emptyGeometry();
  for (let y = -5; y < 6; y++) for (let x = -5; x < 12; x++) document.tiles.push({ x, y, terrain: 'grass' });
  document.geometry.surfaces.push(
    { id: 'left', x: 0, y: 0, width: 2, height: 2, elevation: 1, ground: true, painted: true, terrain: 'grass' },
    { id: 'right', x: 6, y: 0, width: 2, height: 2, elevation: 1, ground: true, painted: true, terrain: 'grass' },
  );
  return document;
}

test('bridge fills the gap across cliff borders with continuous support and a free underpass', () => {
  const document = fixture(), before = structuredClone(document.geometry!.surfaces);
  const parts = addSuspendedSurface(document, deck);
  assert.deepEqual(parts, [{ ...deck, x: 2, width: 4 }]);
  assert.deepEqual(document.geometry!.surfaces.slice(0, 2), before);
  const world = new World(1, 16, 'world', document, []);
  // Includes both cliff rings and both joints, with a nonzero player footprint.
  for (let x = 1; x <= 7; x += .125) assert.equal(world.elevation.blocked(x * TILE_SIZE, TILE_SIZE, 12, 1), false, `upper x=${x}`);
  assert.equal(world.elevation.blocked(4 * TILE_SIZE, TILE_SIZE, 12, 0), false);
  assert.equal(world.elevation.blocked(4 * TILE_SIZE, -.5 * TILE_SIZE, 12, 1), true);
  assert.equal(validateWorld(document, []).some(issue => issue.includes('Superfici sovrapposte')), false);
});

test('updating an old overlapping bridge repairs it without clipping floors at other elevations', () => {
  const document = fixture();
  document.geometry!.surfaces.push({ ...deck, id: 'upper', elevation: 2 }, deck);
  updateGeometry(document, 'surfaces', deck);
  assert.deepEqual(document.geometry!.surfaces.find(s => s.id === 'bridge'), { ...deck, x: 2, width: 4 });
  assert.equal(document.geometry!.surfaces.find(s => s.id === 'upper')!.width, 8);
  assert.equal(validateWorld(document, []).some(issue => issue.includes('Superfici sovrapposte')), false);
});

test('irregular joints produce unique fragments without gaps; fully covered decks add nothing', () => {
  const owner = { geometry: emptyGeometry() };
  owner.geometry.surfaces.push({ ...deck, id: 'island', x: 3, y: .5, width: 2, height: 1 });
  const parts = addSuspendedSurface(owner, deck);
  assert.equal(parts.length, 4);
  assert.equal(new Set(owner.geometry.surfaces.map(s => s.id)).size, 5);
  for (let x = .5; x < 8; x += .25) assert.equal(circleSupported(x, 1, .2, owner.geometry.surfaces), true);
  assert.deepEqual(addSuspendedSurface(owner, { ...deck, id: 'duplicate' }), []);
});
