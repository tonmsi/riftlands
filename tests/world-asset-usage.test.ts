import test from 'node:test';
import assert from 'node:assert/strict';
import { worldAssetUsage } from '../client/editors/world/world-asset-usage';
import { newWorldAsset, newWorldDocument } from '../shared/world-schema';
import { newInterior, newDungeonInterior } from '../shared/warps';
import { engineBundle } from './fixtures/dungeon-engine';

test('asset usage indexes all maps without conflating equal coordinates or changing the project', () => {
  const project = newWorldDocument(), house = newInterior('house', 'Casa', 8, 8);
  project.assets = [newWorldAsset('tree', 'Albero', '/world-assets/tree.svg'), newWorldAsset('unused', 'Libero', '/world-assets/tree.svg')];
  project.placements = [{ id: 'outside', assetId: 'tree', x: 2, y: 2 }];
  house.document.placements = [{ id: 'inside', assetId: 'tree', x: 2, y: 2 }]; project.interiors = [house];
  const before = JSON.stringify(project), usage = worldAssetUsage(project, []);
  assert.deepEqual(usage.get('tree')?.map(location => [location.mapId, location.mapName, location.placement.id]), [
    ['world', 'Mondo', 'outside'], ['house', 'Casa', 'inside'],
  ]);
  assert.equal(usage.has('unused'), false); assert.equal(JSON.stringify(project), before);
});

test('asset usage includes relocated dungeon instances only in the enabled map', () => {
  const project = newWorldDocument(), definition = engineBundle().definition;
  const dungeon = { ...definition, assetPlacements: [{ id: 'tree-instance', assetId: 'tree', x: definition.layout.bounds.minTx + 2, y: definition.layout.bounds.minTy + 2 }] };
  project.assets = [newWorldAsset('tree', 'Albero', '/world-assets/tree.svg')];
  const house = newDungeonInterior('indoor', dungeon); project.interiors = [house];
  const locations = worldAssetUsage(project, [dungeon]).get('tree')!;
  assert.equal(locations.length, 1); assert.equal(locations[0].mapId, 'indoor');
  assert.equal(locations[0].source, 'dungeon'); assert.equal(locations[0].placement.x, 4); assert.equal(locations[0].placement.y, 4);
  house.document.dungeons[0].enabled = false;
  project.dungeons = [{ dungeonId: dungeon.id, x: 0, y: 0, enabled: false }];
  assert.equal(worldAssetUsage(project, [dungeon]).has('tree'), false);
});
