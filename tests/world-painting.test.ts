import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWorldPainting } from '../shared/world-painting';
import { newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { World } from '../shared/world';
import { WorldEditorHistory } from '../client/editors/world/world-editor-history';
import { terrainMaskCommands } from '../client/render/terrain-masks';
import { resolveTransition, transitionPairKey, DEFAULT_WATER_COAST, defaultCoastMotion } from '../shared/world-painting';

test('sea and mask switches survive parsing and history without changing world physics',()=>{
  const before=newWorldDocument(),history=new WorldEditorHistory();
  for(const seaEnabled of [true,false])for(const masksEnabled of [true,false]){
    const after={...before,painting:{...defaultWorldPainting(),seaEnabled,masksEnabled}};
    const parsed=parseWorldDocument(JSON.stringify(after));assert.deepEqual(parsed.painting,after.painting);
    assert.ok(history.commit(before,parsed));assert.equal(history.undo(parsed).painting,undefined);
    assert.deepEqual(history.redo(before).painting,after.painting);
    const a=new World(42,16,'world',before,[]),b=new World(42,16,'world',parsed,[]);
    for(let y=-8;y<8;y++)for(let x=-8;x<8;x++){
      assert.equal(a.getTile(x,y),b.getTile(x,y));assert.equal(a.isBlocked(x,y),b.isBlocked(x,y));
    }
  }
  for(const setting of [{seaEnabled:0},{masksEnabled:'false'},{seaEnabled:null}])
    assert.throws(()=>parseWorldDocument({...before,painting:{...defaultWorldPainting(),...setting}}),/world painting/);
});

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

test('transition rules resolve pairs, material priorities, inheritance and junctions deterministically',()=>{
  const p=defaultWorldPainting();p.curve=.25;
  const wave={smooth:true,curves:[[{x:.3,y:.2},{x:.7,y:.8}]]};
  p.maskShapes={3:wave};
  assert.equal(resolveTransition(p,['water','grass']).source,'general');
  p.materialRules={water:{curve:.8,maskShapes:{12:wave}},grass:{curve:.4}};
  const water=resolveTransition(p,['water','grass']);
  assert.equal(water.owner,'water');assert.equal(water.curve,.8);
  assert.deepEqual(water.maskShapes?.[3],wave);assert.deepEqual(water.maskShapes?.[12],wave);
  assert.equal(resolveTransition(p,['water','snow']).owner,'water');
  p.materialRules.grass!.priority=100;
  assert.equal(resolveTransition(p,['water','grass']).owner,'grass');
  const pair=transitionPairKey('grass','water');assert.equal(pair,transitionPairKey('water','grass'));
  p.pairRules={[pair]:{owner:'water',curve:.1,maskShapes:{3:{...wave,smooth:false}}}};
  const specific=resolveTransition(p,['grass','water']);
  assert.equal(specific.source,'pair');assert.equal(specific.owner,'water');assert.equal(specific.curve,.1);
  assert.equal(specific.maskShapes?.[3]?.smooth,false);assert.deepEqual(specific.maskShapes?.[12],wave);
  assert.deepEqual(resolveTransition(p,['snow','water','grass']),resolveTransition(p,['grass','water','snow']));
  delete p.pairRules[pair];assert.equal(resolveTransition(p,['grass','water']).owner,'grass');
  assert.deepEqual(parseWorldDocument({...newWorldDocument(),painting:p}).painting,p);
});

test('transition rules reject invalid pairs, owners, priorities and geometry',()=>{
  for(const extra of [
    {materialRules:{rock:{curve:.5}}},{materialRules:{water:{priority:1001}}},
    {materialRules:{water:{owner:'water'}}},{materialRules:{water:{curve:NaN}}},
    {pairRules:{'water:grass':{}}},{pairRules:{'water:water':{}}},
    {pairRules:{'grass:water':{owner:'snow'}}},{pairRules:{'grass:water':{priority:-1}}},
    {pairRules:{'grass:water':{maskShapes:{15:{curves:[],smooth:true}}}}},
  ])assert.throws(()=>parseWorldDocument({...newWorldDocument(),painting:{...defaultWorldPainting(),...extra}}),/world painting/);
});

test('water coast controls are bounded and survive document round trips',()=>{
  const doc={...newWorldDocument(),painting:{...defaultWorldPainting(),waterCoast:{...DEFAULT_WATER_COAST,seed:491,noise:2.5}}};
  assert.deepEqual(parseWorldDocument(JSON.stringify(doc)).painting,doc.painting);
  for(const invalid of [{noise:7},{noiseScale:0},{seed:1.5},{seed:Infinity},{feather:129},{shallows:513},{shallows:-1},{smoothing:NaN},{enabled:1},{shallowColor:'blue'},{featherOpacity:1.1},{shallowOpacity:-.1},{shallowSteps:33},{featherSteps:1.5}])
    assert.throws(()=>parseWorldDocument({...doc,painting:{...doc.painting,waterCoast:{...doc.painting.waterCoast,...invalid}}}),/world painting/);
  const a=new World(42,16,'world',newWorldDocument(),[]),b=new World(42,16,'world',doc,[]);
  for(let y=-8;y<8;y++)for(let x=-8;x<8;x++)assert.equal(a.getTile(x,y),b.getTile(x,y));
});

test('coast motion accepts wide independent bands and validates bounded animation settings',()=>{
  const motion=defaultCoastMotion();motion.bands=[{width:512,color:'#abcdef',opacity:1,softness:16}];
  const doc={...newWorldDocument(),painting:{...defaultWorldPainting(),waterCoast:{...DEFAULT_WATER_COAST,feather:128,shallows:512,featherSteps:32,shallowSteps:1,motion}}};
  assert.deepEqual(parseWorldDocument(JSON.stringify(doc)).painting,doc.painting);
  for(const invalid of [{enabled:1},{amplitude:129},{speed:-1},{randomness:NaN},{seed:1.1},{bands:Array(13).fill(motion.bands[0])},
    ...[{width:513},{opacity:-1},{softness:0},{softness:1.5},{color:'red'}].map(b=>({bands:[{...motion.bands[0],...b}]}))])
    assert.throws(()=>parseWorldDocument({...doc,painting:{...doc.painting,waterCoast:{...doc.painting.waterCoast,motion:{...motion,...invalid}}}}),/world painting/);
  assert.notEqual(defaultCoastMotion().bands,defaultCoastMotion().bands);
});
