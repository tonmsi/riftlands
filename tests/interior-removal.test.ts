import test from 'node:test';
import assert from 'node:assert/strict';
import { mapDocument, newDungeonInterior, newInterior, removeInterior, setWarpReturn } from '../shared/warps';
import { newWorldAsset, newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { worldDungeons } from '../shared/world-validation';
import { serializeWorldDocument } from '../shared/world-tiles';
import { forkWorldDocument } from '../shared/world-editing';
import { WorldEditorHistory } from '../client/editors/world/world-editor-history';
import { engineBundle } from './fixtures/dungeon-engine';

test('removing an interior deletes all contents and passages, preserves other maps, and supports undo', () => {
  const project = newWorldDocument(), house = newInterior('house', 'Casa'), keep = newInterior('keep', 'Locanda');
  project.assets = [newWorldAsset('chair', 'Sedia', '/world-assets/chair.svg')];
  house.document.placements = [{ id: 'chair', assetId: 'chair', x: 1, y: 1 }];
  house.document.npcs = [{ id: 'npc', npcKind: 'wisp', level: 1, x: 2, y: 2 }];
  house.document.tiles = [{ x: 1, y: 1, terrain: 'grass' }];
  project.interiors = [house, keep];
  project.warps = [
    { id: 'entry', name: 'Ingresso', from: 'world', to: 'house', entry: { x: 1, y: 1 }, arrival: { x: 2, y: 2 }, activation: 'walk' },
    { id: 'cross', name: 'Altra stanza', from: 'keep', to: 'house', entry: { x: 1, y: 1 }, arrival: { x: 2, y: 2 }, activation: 'walk' },
    { id: 'internal', name: 'Passaggio interno', from: 'house', to: 'house', entry: { x: 3, y: 3 }, arrival: { x: 4, y: 4 }, activation: 'walk' },
    { id: 'keep-entry', name: 'Locanda', from: 'world', to: 'keep', entry: { x: 5, y: 5 }, arrival: { x: 2, y: 2 }, activation: 'walk' },
  ];
  setWarpReturn(project, project.warps[0], true, 'exit');
  const before = parseWorldDocument(project), next = forkWorldDocument(before), history = new WorldEditorHistory();
  removeInterior(next, 'house'); history.commit(before, next);
  assert.deepEqual(next.interiors?.map(m => m.id), ['keep']);
  assert.deepEqual(next.warps?.map(w => w.id), ['keep-entry']);
  assert.deepEqual(next.assets, before.assets);
  assert.deepEqual(mapDocument(next, 'keep'), mapDocument(before, 'keep'));
  assert.deepEqual(history.undo(next), before);
  const restored = parseWorldDocument(serializeWorldDocument(history.redo(before)));
  assert.deepEqual(restored.interiors?.map(m => m.id), ['keep']);
  assert.deepEqual(restored.warps?.map(w => w.id), ['keep-entry']);
  const snapshot = structuredClone(restored);
  assert.throws(() => removeInterior(restored, 'world'), /mappa interna/);
  assert.throws(() => removeInterior(restored, 'missing'), /mappa interna/);
  assert.deepEqual(restored, snapshot);
});

test('removing a dungeon interior never reactivates its legacy placement in the world', () => {
  const source = engineBundle().definition;
  for (const outside of [undefined, { dungeonId: source.id, x: 90, y: 70, enabled: true, pvp: false }]) {
    const project = newWorldDocument();
    project.interiors = [newDungeonInterior('crypt', source)];
    if (outside) project.dungeons.push({ ...outside });
    assert.deepEqual(worldDungeons(project, [source]), []);
    removeInterior(project, 'crypt');
    const saved = parseWorldDocument(serializeWorldDocument(project));
    assert.deepEqual(worldDungeons(saved, [source]), []);
    assert.equal(saved.dungeons[0].enabled, false);
    if (outside) assert.deepEqual(saved.dungeons[0], { ...outside, enabled: false });
  }
});
