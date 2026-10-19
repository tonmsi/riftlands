import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeAssetOpacity, surfaceOpacity } from '../client/render/bridge-visibility';
import { emptyGeometry, validGeometry, type WorldSurface } from '../shared/elevation';
import { TILE_SIZE } from '../shared/config';
import { newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { serializeWorldDocument } from '../shared/world-tiles';
import { addSuspendedSurface, updateGeometry } from '../shared/elevation-editing';
import { World } from '../shared/world';

const bridge: WorldSurface = { id: 'deck', x: 2, y: 2, width: 4, height: 2, elevation: 1, ground: false, transparent: true, inheritAssetVisuals: true };
test('transparent decks remain supported, preserve the underpass and persist their visual settings', () => {
  const document = newWorldDocument(1); document.geometry = emptyGeometry();
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) document.tiles.push({ x, y, terrain: 'grass' });
  addSuspendedSurface(document, bridge);
  const restored = parseWorldDocument(serializeWorldDocument(document));
  assert.deepEqual(restored.geometry!.surfaces[0], bridge);
  const world = new World(1, 16, 'world', restored, []);
  for (const elevation of [0, 1]) assert.equal(world.elevation.blocked(4*TILE_SIZE, 3*TILE_SIZE, 12, elevation), false);
  assert.equal(world.elevation.blocked(7*TILE_SIZE, 3*TILE_SIZE, 12, 1), true);
  updateGeometry(document, 'surfaces', { ...bridge, inheritAssetVisuals: false });
  assert.equal(document.geometry!.surfaces[0].inheritAssetVisuals, false);
  assert.equal(document.geometry!.surfaces[0].transparent, true);
});

test('only supported asset instances inherit the active underpass opacity; bridge opt-out and other floors remain opaque', () => {
  const under = { x: 4*TILE_SIZE, y: 3*TILE_SIZE, elevation: 0 };
  assert.equal(surfaceOpacity(bridge, under), .35);
  assert.equal(surfaceOpacity(bridge, { ...under, elevation: 1 }), 1);
  assert.equal(surfaceOpacity(bridge, { ...under, x: 7*TILE_SIZE }), 1);
  assert.equal(surfaceOpacity(bridge, null), 1);
  const active = [bridge].filter(s => surfaceOpacity(s, under) < 1);
  const footprint = { x: 3, y: 2, width: 1, height: 1 };
  assert.equal(bridgeAssetOpacity(footprint, 1, active), .35);
  assert.equal(bridgeAssetOpacity(footprint, 0, active), 1);
  assert.equal(bridgeAssetOpacity(footprint, 2, active), 1);
  assert.equal(bridgeAssetOpacity({ ...footprint, x: 7 }, 1, active), 1);
  assert.equal(bridgeAssetOpacity(footprint, 1, [{ ...bridge, inheritAssetVisuals: false }]), 1);
  assert.equal(bridgeAssetOpacity(footprint, 1, [{ ...bridge, inheritAssetVisuals: undefined }]), .35);
  assert.equal(bridgeAssetOpacity(footprint, 1, [{ ...bridge, ground: true }]), 1);
});

test('bridge visual fields reject malformed imported values and survive automatic joint clipping', () => {
  const geometry = { ...emptyGeometry(), surfaces: [bridge] };
  assert.equal(validGeometry(geometry), true);
  for (const field of ['transparent', 'inheritAssetVisuals']) assert.equal(validGeometry({ ...geometry, surfaces: [{ ...bridge, [field]: 'yes' }] }), false);
  const owner = { geometry: { ...emptyGeometry(), surfaces: [{ ...bridge, id: 'existing', width: 1, ground: true }] } };
  const parts = addSuspendedSurface(owner, bridge);
  assert.ok(parts.length > 0);
  assert.ok(parts.every(s => s.transparent && s.inheritAssetVisuals));
});
