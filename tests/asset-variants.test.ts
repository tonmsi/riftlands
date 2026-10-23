import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorldAsset, newWorldDocument, parseWorldDocument, resizeWorldAsset } from '../shared/world-schema';
import { WorldAuthoring, type GenerationEnvironment } from '../shared/world-authoring';
import { assetVariants, pickAssetVariant } from '../shared/asset-variants';
import { assetGroup } from '../client/editors/world/world-asset-catalog';

const env: GenerationEnvironment = { tile: () => 'grass', temperature: () => .5, moisture: () => .5, reserved: () => false };
const bounds = { left: -15, top: -15, right: 15, bottom: 15 };
function fixture() {
  const d = newWorldDocument(42), bush = newWorldAsset('bush', 'Cespuglio', '/world-assets/bush.png');
  bush.generation = { ...bush.generation, enabled: true, density: .35, spacing: 0 };
  bush.cells[0].visibility = 'hide-fade'; d.assets.push(bush);
  for (let y = -20; y < 20; y++) for (let x = -20; x < 20; x++) d.tiles.push({ x, y, terrain: 'grass', suppressAssets: true, bushStyle: 'png' });
  return d;
}
test('random bush pool preserves density, survives export and is independent of catalog and query order', () => {
  const d = fixture(), solo = new WorldAuthoring(d).assetsIn(bounds, env, d.seed);
  for (let i = 0; i < 3; i++) {
    const a = newWorldAsset(`variant-${i}`, `Variante ${i}`, `/world-assets/variant-${i}.png`);
    a.variantOf = 'bush'; a.cells[0].visibility = 'hide-fade'; d.assets.push(a);
  }
  const parsed = parseWorldDocument(JSON.stringify(d)), authoring = new WorldAuthoring(parsed);
  const placements = authoring.assetsIn(bounds, env, d.seed);
  assert.deepEqual(placements.map(p => [p.id, p.x, p.y]), solo.map(p => [p.id, p.x, p.y]));
  assert.equal(new Set(placements.map(p => p.assetId)).size, 4);
  assert.ok(placements.every(p => authoring.cell(p, p.x + .5, p.y + .5)?.visibility === 'hide-fade'));
  const reverse = new WorldAuthoring({ ...parsed, assets: [...parsed.assets].reverse() });
  reverse.assetsIn({ left: 100, top: 100, right: 130, bottom: 130 }, env, d.seed);
  assert.deepEqual(reverse.assetsIn(bounds, env, d.seed), placements);
  assert.equal(assetGroup(parsed.assets[0], parsed.assets), 'Cespuglio');
  assert.equal(assetGroup(parsed.assets[2], parsed.assets), 'Cespuglio');
  const pool = assetVariants(parsed.assets, parsed.assets[2]);
  for (const p of placements) assert.equal(pickAssetVariant(pool, p.x, p.y, 42).id, authoring.terrainBushAt(p.x, p.y).id);
  assert.equal(new Set(placements.map(p => authoring.terrainBushAt(p.x, p.y).id)).size, 4);
  for (const tile of parsed.tiles) tile.bushStyle = 'js';
  assert.ok(new WorldAuthoring(parsed).assetsIn(bounds, env, d.seed).every(p => p.bushJs));
});
test('variants keep their geometry and obey the main asset climate, terrain and generation switch', () => {
  const d = fixture(), a = newWorldAsset('wide', 'Cespuglio largo', '/world-assets/wide.png');
  a.variantOf = 'bush'; resizeWorldAsset(a, 2, 1); a.cells[1].blocked = true; d.assets.push(a);
  let authoring = new WorldAuthoring(d), placements = authoring.assetsIn(bounds, env, d.seed);
  assert.ok(placements.some(p => p.assetId === a.id));
  for (const p of placements.filter(p => p.assetId === a.id)) assert.equal(authoring.cell(p, p.x + 1.5, p.y + .5)?.blocked, true);
  assert.deepEqual(new WorldAuthoring(d).assetsIn(bounds, { ...env, reserved: () => true }, d.seed), []);
  d.assets[0].generation.temperature = [.8, 1];
  assert.equal(new WorldAuthoring(d).assetsIn(bounds, env, d.seed).length, 0);
  d.assets[0].generation.temperature = [0, 1]; d.assets[0].generation.enabled = false;
  assert.equal(new WorldAuthoring(d).assetsIn(bounds, env, d.seed).length, 0);
});
test('variant groups reject dangling references, self references, chains and cycles', () => {
  const d = fixture(), a = newWorldAsset('a', 'A', '/world-assets/a.png'); d.assets.push(a);
  for (const parent of ['missing', 'a', 1, null]) {
    (a as any).variantOf = parent; assert.throws(() => parseWorldDocument(d), /gruppo varianti/);
  }
  a.variantOf = 'bush'; d.assets[0].variantOf = 'a';
  assert.throws(() => parseWorldDocument(d), /gruppo varianti/);
  delete d.assets[0].variantOf;
  const b = newWorldAsset('b', 'B', '/world-assets/b.png'); b.variantOf = 'a'; d.assets.push(b);
  assert.throws(() => parseWorldDocument(d), /gruppo varianti/);
});
