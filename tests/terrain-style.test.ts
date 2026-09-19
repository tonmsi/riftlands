import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shorelineMask } from '../client/terrain-style';
import { World } from '../shared/world';

test('shoreline retains all eight neighbours, including inward and isolated corners', () => {
  assert.equal(shorelineMask(() => 'water', 0, 0), 0);
  assert.equal(shorelineMask(() => 'grass', 0, 0), 255);
  assert.equal(shorelineMask((x, y) => x === -1 && y === -1 ? 'grass' : 'water', 0, 0), 128);
  assert.equal(shorelineMask((x, y) => y < 0 || x < 0 ? 'path' : 'water', 0, 0) & 15, 9);
});

test('shoreline is independent of chunk cache and traversal at negative boundaries', () => {
  const a = new World(72, 2), b = new World(72, 2);
  for (const [x, y] of [[-16, -16], [15, 16], [-33, 31], [64, -1]]) {
    const expected = shorelineMask((tx, ty) => a.getTile(tx, ty), x, y);
    b.getChunk(Math.floor(x / 16), Math.floor(y / 16));
    b.getChunk(Math.floor(x / 16) - 1, Math.floor(y / 16) - 1);
    assert.equal(shorelineMask((tx, ty) => b.getTile(tx, ty), x, y), expected);
  }
});
