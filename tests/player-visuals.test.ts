import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTOR_CATALOG, defaultPlayerVisual, parseActorCatalog, playerDrawSize } from '../shared/actor-catalog';

test('player sizes default to 48, persist per class and reject invalid classes and dimensions', () => {
  const catalog = structuredClone(ACTOR_CATALOG); delete catalog.playerDrawSizes; delete catalog.playerSkins;
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

test('player skins persist idle, movement, attacks and shadows and validate references', () => {
  const catalog = structuredClone(ACTOR_CATALOG);
  delete catalog.playerDrawSizes;
  catalog.playerSkins = { mage: 'player-mage' };
  catalog.skins['player-mage'] = defaultPlayerVisual(catalog, 'mage');
  const visual = catalog.skins['player-mage'];
  visual.drawSize = 80;
  visual.animations.basic = { ...visual.animations.moving, loop: false };
  visual.shadow.opacity = 0;
  const saved = parseActorCatalog(JSON.parse(JSON.stringify(catalog)));
  assert.deepEqual(saved.playerSkins, catalog.playerSkins);
  assert.deepEqual(saved.skins['player-mage'], visual);
  assert.equal(playerDrawSize(saved, 'mage'), 80);
  for (const invalid of [{ mage: 'missing' }, { unknown: 'player-mage' }, [], null])
    assert.throws(() => parseActorCatalog({ ...catalog, playerSkins: invalid }));
});
