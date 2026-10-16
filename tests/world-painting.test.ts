import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWorldPainting } from '../shared/world-painting';
import { newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { World } from '../shared/world';
import { WorldEditorHistory } from '../client/editors/world/world-editor-history';
import { terrainMaskCommands } from '../client/render/terrain-masks';

test('painting survives parsing, export and history without changing procedural terrain or climate', () => {
  const before = newWorldDocument(), after = structuredClone(before);
  after.painting = defaultWorldPainting();
  after.painting.materials.grass = { color: '#aa4488', intensity: 0, size: 2 };
  after.painting.edges = 'legacy';
  after.painting.maskShapes = {12:{smooth:true,curves:[[{x:.3,y:.2},{x:.6,y:.8}]]}};
  const parsed = parseWorldDocument(JSON.stringify(after));
  assert.deepEqual(parsed.painting, after.painting);
  assert.equal(parseWorldDocument(before).painting, undefined);
  const history = new WorldEditorHistory();
  assert.ok(history.commit(before, parsed));
  assert.equal(history.undo(parsed).painting, undefined);
  assert.deepEqual(history.redo(before).painting, after.painting);
  const a = new World(42, 16, 'world', before, []), b = new World(42, 16, 'world', parsed, []);
  for (let y = -16; y < 16; y++) for (let x = -16; x < 16; x++) {
    assert.equal(a.getTile(x,y), b.getTile(x,y));
    assert.equal(a.getTemperature(x,y), b.getTemperature(x,y));
    assert.equal(a.isBlocked(x,y), b.isBlocked(x,y));
  }
});

test('individual contours remain bounded data and produce distinct cached geometry commands', () => {
  const shape={smooth:false,curves:[[{x:.3,y:.2},{x:.7,y:.8}]]};
  assert.notEqual(terrainMaskCommands(12,48,1,shape),terrainMaskCommands(12,48,1));
  assert.match(terrainMaskCommands(12,100,1,shape),/L30 20 L70 80/);
  assert.match(terrainMaskCommands(12,100,1,{...shape,smooth:true}),/Q30 20/);
  for (const maskShapes of [
    {0:shape}, {15:shape}, {99:shape}, {5:shape},
    {12:{...shape,curves:[]}}, {12:{...shape,curves:[Array(9).fill({x:.5,y:.5})]}},
    {12:{...shape,curves:[[{x:Infinity,y:.5}]]}}, {12:{...shape,curves:[[{x:.5,y:-1}]]}},
  ]) assert.throws(()=>parseWorldDocument({...newWorldDocument(),painting:{...defaultWorldPainting(),maskShapes}}),/world painting/);
});

test('painting rejects invalid palettes and unbounded effects, including nested interiors', () => {
  for (const [property, value] of [['color', 'red'], ['size', 0], ['size', 3], ['intensity', -1], ['intensity', Infinity]] as const) {
    const doc = newWorldDocument(); doc.painting = defaultWorldPainting();
    Object.assign(doc.painting.materials.water, { [property]: value });
    assert.throws(() => parseWorldDocument(doc), /world painting/);
  }
  for (const setting of [{ curve: NaN }, { curve: 2 }, { edges: 'unknown' }, { materials: {} }]) {
    assert.throws(() => parseWorldDocument({ ...newWorldDocument(), painting: { ...defaultWorldPainting(), ...setting } }), /world painting/);
  }
  const doc = newWorldDocument();
  doc.interiors = [{ id:'room', name:'Room', width:24, height:24,
    document: { ...newWorldDocument(), painting: { ...defaultWorldPainting(), curve: -1 } } }];
  assert.throws(() => parseWorldDocument(doc), /world painting/);
});
