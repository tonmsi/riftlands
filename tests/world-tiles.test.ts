import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { compactWorldTiles, serializeWorldDocument, WorldTiles, tileCode, worldTileMetrics, worldDocumentsEqual } from '../shared/world-tiles';
import { forkWorldDocument, WorldBrush } from '../shared/world-editing';
import { WorldEditorHistory } from '../client/world-editor-history';
import { World } from '../shared/world';

test('RLE preserves terrain and suppression at negative coordinates, validates runs and decodes only bounded chunks', () => {
  const document = newWorldDocument();
  for (let y = -64; y < 64; y++) for (let x = -64; x < 64; x++) document.tiles.push({ x, y, terrain: x < 0 ? 'water' : 'path', suppressAssets: true });
  document.tiles.push({ x: 1024, y: -1024, suppressAssets: true });
  const compact = parseWorldDocument(serializeWorldDocument(document)), index = new WorldTiles(compact);
  assert.equal(compact.version, 2); assert.equal(compact.tiles.length, 0);
  assert.ok(serializeWorldDocument(compact).length < JSON.stringify(document).length / 100);
  for (const tile of document.tiles) assert.equal(tileCode(index.at(tile.x, tile.y)), tileCode(tile));
  assert.equal(index.at(1025, -1024), undefined);
  const bad = structuredClone(compact); bad.tileChunks![0] = [0, 0, 0, 1000, 7, 500, 4, 2];
  assert.throws(() => parseWorldDocument(bad), /intervallo/);
  for (let i = 0; i < 300; i++) index.update([[i, 50, 0, 1024, 7]]);
  for (let i = 0; i < 300; i++) assert.equal(index.at(i * 32, 50 * 32)?.terrain, 'water');
  assert.equal(index.decodedChunkCount, 128);
});

test('large-world strokes copy only touched chunks and undo retains deltas, including removal and cross-chunk edits', () => {
  const before = compactWorldTiles(newWorldDocument());
  for (let i = 0; i < 5000; i++) before.tileChunks!.push([i - 2500, 100, 0, 1024, 7]);
  const after = forkWorldDocument(before), brush = new WorldBrush(after), history = new WorldEditorHistory();
  const reordered = forkWorldDocument(before); reordered.tileChunks!.reverse(); assert.equal(worldDocumentsEqual(before, reordered), true);
  brush.tile({ x: -1, y: 3200 }, { terrain: 'path', suppressAssets: true });
  brush.tile({ x: 0, y: 3200 }, { terrain: 'grass', suppressAssets: true });
  const changed = brush.flushTiles(); assert.equal(changed.length, 2);
  assert.equal(worldDocumentsEqual(before, after), false);
  assert.equal(before.tileChunks![0], after.tileChunks![0]);
  assert.ok(history.commit(before, after)); assert.ok(history.retainedBytes < 1000);
  const index = new WorldTiles(after); assert.equal(index.at(-1, 3200)!.terrain, 'path');
  const undo = history.undo(after); assert.equal(new WorldTiles(undo).at(-1, 3200)!.terrain, 'water');
  const redo = history.redo(undo); assert.equal(new WorldTiles(redo).at(0, 3200)!.terrain, 'grass');
  assert.ok(history.retainedBytes < 1000);
  const clear = compactWorldTiles(newWorldDocument()), clearBrush = new WorldBrush(clear);
  clearBrush.tile({ x: -2, y: -3 }, { terrain: 'grass' }); clearBrush.flushTiles();
  assert.deepEqual(worldTileMetrics(clear), { cells: 1, runs: 1 });
  const oneCell = forkWorldDocument(clear);
  clearBrush.tile({ x: -2, y: -3 }); clearBrush.flushTiles(); assert.equal(clear.tileChunks!.length, 0);
  assert.deepEqual(worldTileMetrics(clear), { cells: 0, runs: 0 });
  history.commit(oneCell, clear);
  const restored = history.undo(clear); assert.deepEqual(worldTileMetrics(restored), { cells: 1, runs: 1 });
  assert.deepEqual(worldTileMetrics(history.redo(restored)), { cells: 0, runs: 0 });
});

test('live editor tile updates invalidate affected terrain and procedural assets without rebuilding authority indices', () => {
  const d = newWorldDocument(); d.tiles.push({ x: -1, y: -1, terrain: 'grass' });
  const compact = compactWorldTiles(d), world = new World(42, 16, 'world', compact, []);
  world.getChunk(-1, -1); const next = forkWorldDocument(compact), brush = new WorldBrush(next);
  brush.tile({ x: -1, y: -1 }, { terrain: 'rock' }); world.updateAuthoredTiles(next, brush.flushTiles());
  assert.equal(world.getTile(-1, -1), 'rock'); assert.equal(world.isBlocked(-1, -1), true); assert.equal(world.authoringRevision, 1);
  next.zones.push({ id: 'named', name: 'Southern Docks', priority: 20, shape: { kind: 'rect', x: -2, y: -2, width: 4, height: 4 }, pvp: false });
  assert.equal(new World(42, 16, 'world', next, []).locationAt(0, 0), 'Southern Docks');
});
