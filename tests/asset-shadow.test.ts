import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ASSET_SHADOW, newWorldAsset, newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { importWorldAsset } from '../client/editors/world/world-asset-import';
import { WorldAuthoring } from '../shared/world-authoring';

test('asset shadows survive project export and reimport without changing other assets', () => {
  const doc = newWorldDocument(), a = newWorldAsset('tree', 'Albero', '/world-assets/tree.png');
  a.shadow = { ...DEFAULT_ASSET_SHADOW }; doc.assets.push(a);
  const parsed = parseWorldDocument(JSON.stringify(doc));
  const imported = importWorldAsset(parsed, doc, [], { name: 'Albero', image: a.image, width: 100, height: 200 });
  assert.deepEqual(imported.shadow, DEFAULT_ASSET_SHADOW);
  assert.equal(newWorldAsset('other', 'Altro', '/world-assets/other.png').shadow, undefined);
  delete imported.shadow;
  assert.equal(parseWorldDocument(JSON.stringify(parsed)).assets[0].shadow, undefined);
});

test('asset shadow validation rejects malformed and unbounded raster settings', () => {
  const doc = newWorldDocument(), a = newWorldAsset('tree', 'Albero', '/world-assets/tree.png'); doc.assets.push(a);
  for (const key of ['x', 'y', 'width', 'height', 'opacity', 'softness']) for (const value of [-1, 1.01, NaN, Infinity, '0.5', undefined]) {
    a.shadow = { ...DEFAULT_ASSET_SHADOW, [key]: value } as typeof DEFAULT_ASSET_SHADOW;
    assert.throws(() => parseWorldDocument(doc), /ombra/);
  }
  for (const invalid of [{ kind: 'triangle' }, { skew: 1.01 }, { skew: -1.01 }]) {
    a.shadow = { ...DEFAULT_ASSET_SHADOW, ...invalid } as typeof DEFAULT_ASSET_SHADOW;
    assert.throws(() => parseWorldDocument(doc), /ombra/);
  }
});

test('variants inherit shadow settings, preserve overrides and explicitly disable shadows across snapshots', () => {
  const doc = newWorldDocument(), root = newWorldAsset('root', 'Capogruppo', '/world-assets/root.png');
  root.shadow = { ...DEFAULT_ASSET_SHADOW, opacity: .7 };
  const inherited = newWorldAsset('inherited', 'Ereditata', '/world-assets/other.png'); inherited.variantOf = root.id;
  const custom = structuredClone(inherited); custom.id = 'custom'; custom.shadow = { ...DEFAULT_ASSET_SHADOW, opacity: .2 };
  const off = structuredClone(inherited); off.id = 'off'; off.shadow = null;
  doc.assets.push(root, inherited, custom, off);
  const snapshot = () => new WorldAuthoring(parseWorldDocument(JSON.stringify(doc)));
  assert.equal(snapshot().assets.get('inherited')!.shadow?.opacity, .7);
  assert.equal(snapshot().assets.get('custom')!.shadow?.opacity, .2);
  assert.equal(snapshot().assets.get('off')!.shadow, undefined);
  root.shadow.opacity = .4;
  assert.equal(snapshot().assets.get('inherited')!.shadow?.opacity, .4);
  assert.equal(snapshot().assets.get('custom')!.shadow?.opacity, .2);
  assert.equal(inherited.shadow, undefined);
  assert.equal(snapshot().assets.get('inherited')!.image, inherited.image);
  delete custom.shadow;
  assert.equal(snapshot().assets.get('custom')!.shadow?.opacity, .4);
});
