import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shorelineMask, sceneryGroups, groundColor, bushColor, mapTerrainColor, TERRAIN } from '../client/terrain-style';
import { World } from '../shared/world';

test('minimap shares grass, foliage variants and water colors with the world', () => {
  for (const moisture of [.2, .45, .7]) assert.equal(mapTerrainColor('grass', moisture, 0), groundColor(moisture));
  for (const variation of [0, .4, .9]) assert.equal(mapTerrainColor('bush', .5, variation), bushColor(variation));
  assert.equal(new Set([0, .4, .9].map(bushColor)).size, 3);
  assert.equal(mapTerrainColor('water', .5, 0), TERRAIN.water);
});

test('scenery uses only square 1x1 or 2x2 footprints with exactly four samples', () => {
  for (const [x, y] of [[0, 0], [-17, 15], [99999, -99999]]) {
    let samples = 0;
    const groups = sceneryGroups(() => { samples++; return 'rock'; }, x, y);
    assert.equal(samples, 4, 'even infinite obstacle regions cost only four reads');
    assert.deepEqual(groups, [{ x: Math.floor(x / 2) * 2, y: Math.floor(y / 2) * 2, width: 2, height: 2, tile: 'rock' }]);
    assert.deepEqual(sceneryGroups(() => 'rock', groups[0].x + 1, groups[0].y + 1), groups);
  }
});

test('mixed blocks never merge materials, holes, horizontal strips or vertical strips', () => {
  for (const tiles of [ ['rock', 'grass', 'rock', 'grass'], ['bush', 'bush', 'grass', 'grass'],
    ['rock', 'bush', 'rock', 'bush'], ['bush', 'bush', 'bush', 'grass'] ] as const) {
    const groups = sceneryGroups((x, y) => tiles[y * 2 + x], 0, 0);
    const expected = tiles.flatMap((tile, i) => tile === 'grass' ? [] : [{ x: i % 2, y: Math.floor(i / 2), width: 1, height: 1, tile }]);
    assert.deepEqual(groups, expected);
  }
});

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
