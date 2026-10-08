import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTOR_CATALOG, parseActorCatalog, playerDrawSize } from '../shared/actor-catalog';

test('player sizes default to 48, persist per class and reject invalid classes and dimensions', () => {
  const catalog = structuredClone(ACTOR_CATALOG); delete catalog.playerDrawSizes;
  assert.equal(playerDrawSize(catalog, 'mage'), 48);
  catalog.playerDrawSizes = { mage: 96, hunter: 72 };
  const saved = parseActorCatalog(JSON.parse(JSON.stringify(catalog)));
  assert.equal(playerDrawSize(saved, 'mage'), 96); assert.equal(playerDrawSize(saved, 'hunter'), 72);
  assert.equal(playerDrawSize(saved, 'warrior'), 48);
  assert.deepEqual(saved.bosses, catalog.bosses); assert.deepEqual(saved.npcSkins, catalog.npcSkins);
  for (const invalid of [{ mage: 0 }, { hunter: 1001 }, { mage: NaN }, { mage: '96' }, { unknown: 96 }, []]) {
    assert.throws(() => parseActorCatalog({ ...catalog, playerDrawSizes: invalid }));
  }
});
