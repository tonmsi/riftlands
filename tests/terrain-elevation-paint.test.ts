import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainElevationBrush } from '../shared/terrain-elevation-editing';
import { terrainCliffs } from '../shared/terrain-cliffs';
import { newWorldDocument, newWorldAsset, parseWorldDocument } from '../shared/world-schema';
import { World } from '../shared/world';
import { forkWorldDocument } from '../shared/world-editing';
import { WorldEditorHistory } from '../client/editors/world/world-editor-history';
import { repairWorldAssetPaths } from '../shared/world-asset-paths';
import { ensureTerrainAccess, stairEndpoints } from '../shared/terrain-access';
import { tiledStairRect } from '../shared/elevation-editing';
import { cliffAsset, installCliffAssets } from '../shared/cliff-assets';

const bounds = { left: -5, top: -5, right: 8, bottom: 8 };
test('lower inside corners use the supplied 180 and 270 degree sprites', () => {
  const document = newWorldDocument(), brush = new TerrainElevationBrush(document);
  for (let x = -3; x <= 3; x++) brush.paint({ x, y: 0 }, 'grass', 1, 0);
  brush.paint({ x: 0, y: 1 }, 'grass', 1, 0); brush.flush(true);
  const cliffs = terrainCliffs(bounds,document.geometry!.surfaces,()=>0);
  assert.deepEqual(cliffs.find(c=>c.x===-1&&c.y===1)!.parts,[{variant:'90corner-180'}]);
  assert.deepEqual(cliffs.find(c=>c.x===1&&c.y===1)!.parts,[{variant:'90corner-270'}]);
});

test('automatic cliffs use editable catalog cells for collision, projectiles and hiding', () => {
  const document = newWorldDocument();
  for (let y = -8; y < 8; y++) for (let x = -8; x < 8; x++) document.tiles.push({ x, y, terrain: 'grass' });
  const brush = new TerrainElevationBrush(document); brush.paint({ x:0,y:0 },'grass',1,0); brush.flush(true);
  assert(installCliffAssets(document)); assert.equal(installCliffAssets(document),false);
  const asset = cliffAsset(document,'centro-sinistra');
  let world = new World(1,16,'world',document,[]);
  assert.equal(world.elevation.blocked(-24,24,0,0),true);
  asset.cells[0] = { blocked:false,visibility:'hide-fade' }; asset.layer = 'ground';
  const restored = parseWorldDocument(JSON.stringify(document));
  world = new World(1,16,'world',restored,[]);
  assert.equal(world.elevation.blocked(-24,24,0,0),false);
  assert.equal(world.elevation.projectileSolids({left:-1,top:0,right:0,bottom:1},0).length,0);
  assert.equal(world.isHiding(-24,24,0),true); assert.equal(world.isHiding(-24,24,1),false);
  assert.equal(cliffAsset(restored,'centro-sinistra').layer,'ground');
  assert.equal(cliffAsset(restored,'centro-destra').cells[0].blocked,true);
  const invalid = structuredClone(restored); invalid.cliffAssets!['centro-sinistra'] = 'missing';
  assert.throws(()=>parseWorldDocument(invalid));
});

test('cliff collision masks subdivide a single exterior tile', () => {
  const document = newWorldDocument();
  for (let y=-3;y<3;y++) for(let x=-3;x<3;x++) document.tiles.push({x,y,terrain:'grass'});
  const brush = new TerrainElevationBrush(document); brush.paint({x:0,y:0},'grass',1,0); brush.flush(true);
  installCliffAssets(document); const asset=cliffAsset(document,'centro-sinistra');
  asset.width=2;asset.columns=2;asset.cells=[{blocked:true,visibility:'normal'},{blocked:false,visibility:'hide'}];
  const world=new World(1,16,'world',parseWorldDocument(document),[]);
  assert.equal(world.elevation.blocked(-36,24,0,0),true);
  assert.equal(world.elevation.blocked(-12,24,0,0),false);
  assert.equal(world.isHiding(-12,24,0),true);
});
test('straight cliff faces use complete centre sprites, never sliced corner sprites', () => {
  const document = newWorldDocument(), brush = new TerrainElevationBrush(document);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) brush.paint({ x, y }, 'grass', 1, 0);
  brush.flush(true);
  const cliffs = terrainCliffs(bounds, document.geometry!.surfaces, () => 0);
  for (const c of cliffs.filter(c => c.y === 4 && c.x >= 0 && c.x < 4)) assert.deepEqual(c.parts, [{ variant: 'basso-centro' }]);
  for (const c of cliffs.filter(c => c.x === -1 && c.y >= 0 && c.y < 4)) assert.deepEqual(c.parts, [{ variant: 'centro-sinistra' }]);
});

test('automatic access has real two-way movement and is reused across material changes', () => {
  const document = newWorldDocument();
  for (let y = -8; y < 8; y++) for (let x = -8; x < 8; x++) document.tiles.push({ x, y, terrain: 'grass' });
  const brush = new TerrainElevationBrush(document); brush.paint({ x: 0, y: 0 }, 'grass', 1, 0); brush.flush(true);
  assert.deepEqual(ensureTerrainAccess(document, new World(1, 16, 'world', document, []), brush.raisedPoints), { added: 1, missing: 0 });
  const stair = document.geometry!.stairs[0], world = new World(1, 16, 'world', document, []);
  assert.equal(stair.tiled, true);
  assert([stair.x,stair.y,stair.width,stair.height].every(Number.isInteger));
  assert.equal(stair.axis === 'x' ? stair.height : stair.width, 1);
  const endpoints = stairEndpoints(stair);
  let actor = { x: endpoints[0].x * 48, y: endpoints[0].y * 48, elevation: stair.from };
  for (const direction of [1, -1]) {
    const start = endpoints[direction === 1 ? 0 : 1], end = endpoints[direction === 1 ? 1 : 0];
    for (let i = 1; i <= 40; i++) {
      const next = { x: (start.x + (end.x - start.x) * i / 40) * 48, y: (start.y + (end.y - start.y) * i / 40) * 48 };
      const state = world.elevation.transition(actor, next, 15);
      assert(state, `stair passage blocked at step ${i} direction ${direction}`);
      actor = { ...next, elevation: state.elevation! };
    }
    assert.equal(actor.elevation, end.elevation);
  }
  assert.deepEqual(ensureTerrainAccess(document, world, [{ x: 0, y: 0, elevation: 1 }]), { added: 0, missing: 0 });
  assert.equal(document.geometry!.stairs.length, 1);
});

test('manual stairs snap to whole tiles and support a wider passage', () => {
  assert.deepEqual(tiledStairRect({ x: .75, y: .25 }, { x: .75, y: .25 }, 'y', .25), { x: 0, y: 0, width: 1, height: 3 });
  assert.deepEqual(tiledStairRect({ x: .75, y: .25 }, { x: .75, y: .25 }, 'x', 3), { x: 0, y: 0, width: 3, height: 3 });
  const document = newWorldDocument();
  for (let y = -8; y < 8; y++) for (let x = -8; x < 8; x++) document.tiles.push({ x, y, terrain: 'grass' });
  const brush = new TerrainElevationBrush(document);
  for (let x = -2; x <= 2; x++) brush.paint({ x, y: 0 }, 'grass', 1, 0);
  brush.flush(true);
  document.geometry!.stairs.push({ id: 'wide', ...tiledStairRect({ x: -1, y: 0 }, { x: -1, y: 2 }, 'y', 3), from: 1, to: 0, axis: 'y', tiled: true });
  const world = new World(1, 16, 'world', document, []);
  for (const x of [-.5,.5,1.5]) {
    const result = world.elevation.transition({ x: x*48, y: 1.4*48, elevation: 1 }, { x: x*48, y: 1.6*48 }, 15);
    assert.equal(result?.elevation, 0);
  }
  const invalid = structuredClone(document); invalid.geometry!.stairs[0].width = .5;
  assert.throws(() => parseWorldDocument(invalid));
});

test('disconnected raised islands receive separate access stairs', () => {
  const document = newWorldDocument();
  for (let y = -8; y < 12; y++) for (let x = -8; x < 12; x++) document.tiles.push({ x, y, terrain: 'grass' });
  const brush = new TerrainElevationBrush(document);
  brush.paint({ x: 0, y: 0 }, 'grass', 1, 0); brush.paint({ x: 6, y: 0 }, 'snow', 2, 0); brush.flush(true);
  assert.deepEqual(ensureTerrainAccess(document, new World(1, 16, 'world', document, []), brush.raisedPoints), { added: 2, missing: 0 });
  assert.equal(document.geometry!.stairs.length, 2);
});
test('a single raised tile has eight exterior cliffs with correct sprite orientation', () => {
  const document = newWorldDocument(), brush = new TerrainElevationBrush(document);
  brush.paint({ x: 0, y: 0 }, 'snow', 1, 0); brush.flush(true);
  const cliffs = terrainCliffs(bounds, document.geometry!.surfaces, () => 0);
  assert.equal(cliffs.length, 8);
  const expected = new Map([['-1,-1','alto-sinistra'],['0,-1','alto-centro'],['1,-1','alto-destra'],['-1,0','centro-sinistra'],['1,0','centro-destra'],['-1,1','basso-sinistra'],['0,1','basso-centro'],['1,1','basso-destra']]);
  for (const c of cliffs) { assert.equal(c.elevation, 1); assert.equal(c.base, 0); assert.equal(c.parts.length, 1); assert(c.parts.every(p => p.variant === expected.get(`${c.x},${c.y}`))); }
  assert.equal(parseWorldDocument(document).geometry!.surfaces[0].painted, true);
});

test('adjacent materials share the plateau and repainting splits compact runs without losing mass', () => {
  const document = newWorldDocument(), brush = new TerrainElevationBrush(document);
  for (let x = 0; x < 100; x++) brush.paint({ x, y: 0 }, 'grass', 14, 0);
  brush.flush(true);
  assert.equal(document.geometry!.surfaces.length, 1);
  assert.equal(document.geometry!.surfaces[0].width, 100);
  const repaint = new TerrainElevationBrush(document);
  repaint.paint({ x: 2, y: 0 }, 'path', 14, 0); repaint.flush(true);
  assert.equal(document.geometry!.surfaces.length, 3);
  assert.equal(document.geometry!.solids.length, 3);
  const cliffs = terrainCliffs({ ...bounds, right: 102 }, document.geometry!.surfaces, () => 0);
  assert(!cliffs.some(c => c.y === 0 && c.x >= 0 && c.x < 100));
  assert(document.geometry!.solids.every(s => s.base === 0 && s.top === 14));
});

test('restoring terrain removes its height and regenerates only the remaining exterior border', () => {
  const document = newWorldDocument(), brush = new TerrainElevationBrush(document);
  brush.paint({ x: 0, y: 0 }, 'grass', 1, 0); brush.paint({ x: 1, y: 0 }, 'snow', 1, 0); brush.flush(true);
  assert.equal(terrainCliffs(bounds, document.geometry!.surfaces, () => 0).length, 10);
  const restore = new TerrainElevationBrush(document);
  restore.paint({ x: 1, y: 0 }, undefined, 0, 0); restore.flush(true);
  assert.equal(terrainCliffs(bounds, document.geometry!.surfaces, () => 0).length, 8);
  assert.equal(document.geometry!.surfaces.length, 1);
});

test('exterior cliffs block lower movement and shots, allow shots at the top and stairs carve an access', () => {
  const document = newWorldDocument();
  for (let y = -5; y < 8; y++) for (let x = -5; x < 8; x++) document.tiles.push({ x, y, terrain: 'grass' });
  const brush = new TerrainElevationBrush(document); brush.paint({ x: 0, y: 0 }, 'grass', 1, 0); brush.flush(true);
  let world = new World(1, 16, 'world', document, []);
  assert.equal(world.elevation.blocked(-24, 24, 0, 0), true);
  assert.equal(world.elevation.blocked(24, 24, 0, 1), false);
  assert.equal(world.elevation.projectileSolids({ left: -1, top: 0, right: 0, bottom: 1 }, 0).length, 1);
  assert.equal(world.elevation.projectileSolids({ left: -1, top: 0, right: 0, bottom: 1 }, 1).length, 0);
  document.geometry!.stairs.push({ id: 'access', x: -2, y: 0, width: 3, height: 1, from: 0, to: 1, axis: 'x' });
  world = new World(1, 16, 'world', document, []);
  assert.equal(world.elevation.blocked(-24, 24, 0, 0), false);
});

test('height changes are isolated and undo restores the previous document', () => {
  const before = newWorldDocument(), document = forkWorldDocument(before), brush = new TerrainElevationBrush(document);
  brush.paint({ x: -4, y: 7 }, 'grass', 2, 0); brush.flush(); brush.flush(true);
  const history = new WorldEditorHistory(); history.commit(before, document);
  assert.equal(before.geometry, undefined);
  assert.deepEqual(history.undo(document), before);
  assert.equal(history.redo(before).geometry!.surfaces[0].elevation, 2);
});

test('path repair preserves catalog identity and leaves ambiguous moves unresolved', () => {
  const document = newWorldDocument();
  document.assets.push(newWorldAsset('rock', 'Roccia', '/world-assets/Old%20Rock.PNG'));
  document.assets[0].image = '/world-assets/Old%20Rock.PNG';
  const id = document.assets[0].id, cells = document.assets[0].cells;
  assert.equal(repairWorldAssetPaths(document, [{ image: '/world-assets/montagna/Old%20Rock.PNG' }]), 1);
  assert.equal(document.assets[0].id, id); assert.equal(document.assets[0].cells, cells);
  document.assets[0].image = '/world-assets/Old%20Rock.PNG';
  assert.equal(repairWorldAssetPaths(document, [{ image: '/world-assets/a/Old%20Rock.PNG' }, { image: '/world-assets/b/Old%20Rock.PNG' }]), 0);
});
