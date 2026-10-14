import test from 'node:test';
import assert from 'node:assert/strict';
import raw from '../shared/custom-dungeons.json';
import { ACTOR_CATALOG } from '../shared/actor-catalog';
import { unpackDungeonCatalog } from '../shared/dungeon-storage';
import { runtimeDungeonData } from '../scripts/runtime-dungeon-data';

test('runtime dungeon projection preserves definitions and boss overrides while editor drafts stay intact', () => {
  const before = JSON.stringify(raw), projected = runtimeDungeonData(before), source = JSON.parse(projected);
  assert.ok(projected.length < before.length * .7);
  assert.ok(source.every((entry: any) => !Object.hasOwn(entry, 'draft')));
  assert.equal(JSON.stringify(raw), before);
  const complete = unpackDungeonCatalog(raw, ACTOR_CATALOG);
  const expected = complete.map(({ draft: _draft, ...runtime }) => runtime);
  assert.deepEqual(unpackDungeonCatalog(source, ACTOR_CATALOG, false), expected);
  assert.deepEqual(unpackDungeonCatalog(raw, ACTOR_CATALOG, false), expected);
  assert.ok(complete.every(entry => entry.draft && entry.draft.tiles.length > 0));
  assert.throws(() => runtimeDungeonData('{}'), /non valido/);
});
