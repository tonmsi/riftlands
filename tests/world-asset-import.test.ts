import test from 'node:test';
import assert from 'node:assert/strict';
import { importWorldAsset } from '../client/editors/world/world-asset-import';
import { newWorldAsset, newWorldDocument, resizeWorldAsset } from '../shared/world-schema';
import type { DungeonDefinition } from '../shared/dungeons';

test('reimporting bush restores the shared ID and original cell properties used by Cathedral Cave', () => {
  const installed = newWorldDocument(), bush = newWorldAsset('bush', 'Cespuglio', '/world-assets/old-hash.svg');
  resizeWorldAsset(bush, 2, 2); bush.cells[0].blocked = true; bush.cells[1].visibility = 'hide-fade';
  installed.assets.push(bush);
  const draft = newWorldDocument(); draft.assets.push(newWorldAsset('asset-random', 'bush', '/world-assets/bush.png'));
  draft.placements.push({ id: 'placement', assetId: 'asset-random', x: 5, y: 7 });
  const dungeon = { assetPlacements: [{ assetId: 'bush' }] } as unknown as DungeonDefinition;
  const asset = importWorldAsset(draft, installed, [dungeon], { name: 'bush', image: '/world-assets/bush.png', width: 48, height: 48 });
  assert.equal(asset.id, 'bush'); assert.equal(asset.image, '/world-assets/bush.png');
  assert.equal(draft.assets.length, 1); assert.equal(draft.placements[0].assetId, 'bush');
  assert.equal(asset.width, 2); assert.deepEqual(asset.cells, bush.cells);
  assert.equal(installed.assets[0].image, '/world-assets/old-hash.svg');
});

test('new imports receive readable IDs and repeated imports preserve placements and edited cells', () => {
  const draft = newWorldDocument(), installed = newWorldDocument();
  const data = { name: 'Albero', image: '/world-assets/Albero.svg', width: 96, height: 48 };
  const asset = importWorldAsset(draft, installed, [], data);
  assert.equal(asset.id, 'Albero'); asset.cells[0].blocked = true;
  draft.placements.push({ id: 'placed', assetId: asset.id, x: 1, y: 2 });
  const repeated = importWorldAsset(draft, installed, [], data);
  assert.equal(draft.assets.length, 1); assert.equal(repeated.cells[0].blocked, true);
  assert.equal(draft.placements[0].assetId, 'Albero');
});
