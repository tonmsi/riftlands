import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorldAsset,newWorldDocument,subdivideWorldAsset,parseWorldDocument,assetCellColumns } from '../shared/world-schema';
import { World } from '../shared/world';
import { installCliffAssets,cliffAsset } from '../shared/cliff-assets';
import { TerrainElevationBrush } from '../shared/terrain-elevation-editing';
import { sweptWorldHit } from '../shared/projectiles';
import { setAssetPassage,removeGeometry } from '../shared/elevation-editing';

function scene(){const document=newWorldDocument();for(let y=-8;y<8;y++)for(let x=-8;x<8;x++)document.tiles.push({x,y,terrain:'grass'});return document;}
test('upper cliff cells support an elevated player beside the plateau, while lower cells do not',()=>{
  const document=scene(),brush=new TerrainElevationBrush(document);brush.paint({x:0,y:0},'grass',1,0);brush.flush(true);installCliffAssets(document);
  const asset=cliffAsset(document,'centro-sinistra');subdivideWorldAsset(asset,4);
  // Keep the outer strip blocked. The inner three quarters belong to the upper floor.
  for(let row=0;row<4;row++)for(let col=1;col<4;col++)asset.cells[row*4+col]={blocked:false,visibility:'normal',elevation:1};
  let world=new World(1,16,'world',parseWorldDocument(document),[]);
  assert.equal(world.elevation.blocked(-18,24,15,1),false);
  assert.equal(world.elevation.transition({x:2,y:24,elevation:1},{x:-18,y:24},15)?.elevation,1);
  assert.equal(world.elevation.blocked(-18,24,15,0),true);
  assert.equal(world.elevation.blocked(-42,24,0,1),true);
  assert.equal(world.elevation.transition({x:-60,y:24,elevation:0},{x:-18,y:24},15),null);
  for(let row=0;row<4;row++)for(let col=1;col<4;col++)asset.cells[row*4+col].elevation=0;
  world=new World(1,16,'world',document,[]);
  assert.equal(world.elevation.blocked(-18,24,15,1),true);assert.equal(world.elevation.blocked(-18,24,15,0),false);
});

test('normal PNG cells can create separate upper, base and lower floors relative to placement',()=>{
  const document=scene(),asset=newWorldAsset('png','PNG','/world-assets/test.png');asset.width=asset.columns=3;asset.cells=[{blocked:false,visibility:'hide-fade',elevation:1},{blocked:false,visibility:'normal',elevation:0},{blocked:false,visibility:'normal',elevation:-1}];
  document.assets.push(asset);document.placements.push({id:'placed',assetId:asset.id,x:2,y:2,baseElevation:2});
  const restored=parseWorldDocument(JSON.stringify(document)),world=new World(1,16,'world',restored,[]);
  for(const [x,e]of [[2.5,3],[3.5,2],[4.5,1]]){assert.equal(world.elevation.blocked(x*48,2.5*48,15,e),false);assert.equal(world.elevation.at(x*48,2.5*48,e).elevation,e);}
  assert.equal(world.isHiding(2.5*48,2.5*48,3),true);assert.equal(world.isHiding(2.5*48,2.5*48,2),false);
  assert.notEqual(sweptWorldHit({x:1*48,y:2.5*48},{x:5*48,y:2.5*48},1,world,2),null);
});

test('negative cell floors replace ground and cannot be entered without stairs',()=>{
  const document=scene(),asset=newWorldAsset('png','PNG','/world-assets/test.png');asset.cells[0]={blocked:false,visibility:'normal',elevation:-1};
  document.assets.push(asset);document.placements.push({id:'placed',assetId:asset.id,x:2,y:2});
  const world=new World(1,16,'world',document,[]);
  assert.equal(world.elevation.blocked(2.5*48,2.5*48,15,-1),false);assert.equal(world.elevation.blocked(2.5*48,2.5*48,15,0),true);
  assert.equal(world.elevation.transition({x:1.5*48,y:2.5*48,elevation:0},{x:2.5*48,y:2.5*48},15),null);
});

test('subdivision preserves cell floors and rejects merging different floors without losing data',()=>{
  const asset=newWorldAsset('png','PNG','/world-assets/test.png');asset.cells[0].elevation=1;subdivideWorldAsset(asset,4);
  assert.equal(asset.cells.length,16);assert(asset.cells.every(c=>c.elevation===1));
  asset.cells[0].elevation=0;const before=structuredClone(asset);assert.throws(()=>subdivideWorldAsset(asset,1),/quote diverse/);assert.deepEqual(asset,before);
  const document=scene();document.assets.push(asset);asset.cells[0].elevation=.5;assert.throws(()=>parseWorldDocument(document));
  asset.cells[0].elevation=127;document.placements.push({id:'out',assetId:asset.id,x:0,y:0,baseElevation:1});assert.throws(()=>parseWorldDocument(document),/fuori intervallo/);
});

test('explicit cell floors override coarse asset geometry in the painted footprint',()=>{
  const document=scene(),asset=newWorldAsset('png','PNG','/world-assets/test.png');
  asset.geometry={surfaces:[],solids:[{id:'old-wall',x:0,y:0,width:1,height:1,base:0,top:2}],stairs:[]};subdivideWorldAsset(asset,2);
  for(const c of asset.cells){c.elevation=1;c.blocked=false;}
  document.assets.push(asset);document.placements.push({id:'placed',assetId:asset.id,x:2,y:2});
  const world=new World(1,16,'world',document,[]);assert.equal(world.elevation.blocked(2.5*48,2.5*48,15,1),false);
  assert.equal(assetCellColumns(asset),2);
});

test('an ordinary PNG can link two floors bidirectionally without a stone stair image',()=>{
  const document=scene(),asset=newWorldAsset('pass','Passaggio','/world-assets/test.png');asset.width=asset.columns=3;
  asset.cells=Array.from({length:3},()=>({blocked:true,visibility:'normal'}));
  setAssetPassage(asset,{id:'asset-passage',x:0,y:0,width:3,height:1,from:0,to:1,axis:'x',appearance:'passage'});
  document.assets.push(asset);document.placements.push({id:'placed',assetId:asset.id,x:1,y:2});
  const restored=parseWorldDocument(JSON.stringify(document)),world=new World(1,16,'world',restored,[]);
  assert.equal(world.elevation.transition({x:2.4*48,y:2.5*48,elevation:0},{x:2.6*48,y:2.5*48},15)?.elevation,1);
  assert.equal(world.elevation.transition({x:2.6*48,y:2.5*48,elevation:1},{x:2.4*48,y:2.5*48},15)?.elevation,0);
  assert.equal(restored.assets[0].geometry!.stairs[0].appearance,'passage');
  removeGeometry(asset,'stairs','asset-passage');assert.equal(asset.geometry!.surfaces.length,0);
});

test('terrain passages retain physics without requiring stair artwork',()=>{
  const document=scene(),brush=new TerrainElevationBrush(document);for(let y=0;y<3;y++)for(let x=0;x<3;x++)brush.paint({x,y},'grass',1,0);brush.flush(true);
  document.geometry!.stairs.push({id:'passage',x:-1,y:1,width:3,height:1,axis:'x',from:0,to:1,appearance:'passage',tiled:true});
  const world=new World(1,16,'world',parseWorldDocument(document),[]);
  assert.equal(world.elevation.transition({x:.4*48,y:1.5*48,elevation:0},{x:.6*48,y:1.5*48},15)?.elevation,1);
  assert.equal(world.elevation.transition({x:.6*48,y:1.5*48,elevation:1},{x:.4*48,y:1.5*48},15)?.elevation,0);
});
