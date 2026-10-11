import test from 'node:test';
import assert from 'node:assert/strict';
import { WarpKeys } from '../server/warp-keys';
import { newWorldDocument } from '../shared/world-schema';
import { setWarpReturn, warpPosition } from '../shared/warps';
import type { Inventory } from '../shared/items';
import { WARP_KEY_OPEN_MS } from '../shared/warp-keys';

const inventory = (): Inventory => ({ version: 1, capacity: 1, slots: [null] });
function fixture() {
  const project = newWorldDocument(1);
  const warp = { id: 'door', name: 'Porta', from: 'world', to: 'world', entry: { x: 1, y: 1 }, arrival: { x: 8, y: 8 }, activation: 'walk' as const,
    keyGate: { id: 'key-door', mapId: 'world', position: { x: 3, y: 3 } } };
  project.warps = [warp]; setWarpReturn(project, warp, true, 'return');
  return { project, warp, keys: new WarpKeys(project), point: warpPosition(warp.keyGate.position) };
}
test('key requirement is optional and specific to its passage', () => {
  const { warp, keys } = fixture(), bag = inventory();
  assert.equal(keys.canPass({ ...warp, keyGate: undefined }, bag, 100), true);
  assert.equal(keys.canPass(warp, bag, 100), false);
  bag.warpKeys = [{ id: 'another-key', name: 'Altra chiave' }];
  assert.equal(keys.canPass(warp, bag, 100), false);
});
test('paired passage has one pickup, authoritative map and distance, and one holder', () => {
  const { keys, point } = fixture(), first = inventory(), second = inventory();
  assert.equal(keys.pickups('world', 100).length, 1);
  assert.equal(keys.collect('key-door', first, 'house', point, 144, 100), false);
  assert.equal(keys.collect('key-door', first, 'world', { x: 9999, y: 9999 }, 144, 100), false);
  assert.equal(keys.collect('key-door', first, 'world', point, 144, 100), true);
  assert.equal(keys.collect('key-door', second, 'world', point, 144, 100), false);
  assert.equal(first.warpKeys?.length, 1);
});
test('using the key opens both directions for exactly five minutes then restores its pickup', () => {
  const { project, warp, keys, point } = fixture(), bag = inventory(), other = inventory();
  keys.collect('key-door', bag, 'world', point, 0, 100);
  keys.open(warp, bag, 200);
  assert.deepEqual(bag.warpKeys, []);
  assert.equal(keys.canPass(project.warps![1], other, 201), true);
  keys.open(warp, other, 300);
  assert.equal(keys.views(300)[0].openedUntil, 200 + WARP_KEY_OPEN_MS);
  assert.equal(keys.pickups('world', 200 + WARP_KEY_OPEN_MS - 1).length, 0);
  keys.expire(200 + WARP_KEY_OPEN_MS);
  assert.equal(keys.canPass(warp, other, 200 + WARP_KEY_OPEN_MS), false);
  assert.deepEqual(keys.pickups('world', 200 + WARP_KEY_OPEN_MS)[0], { id: 'key-door', name: 'Chiave · Porta', ...point });
});
