import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorldDocument,newWorldAsset,subdivideWorldAsset,resizeWorldAsset,parseWorldDocument,worldAssetImageBounds,assetCellColumns,assetCellRows } from '../shared/world-schema';
import { placementBounds } from '../shared/world-authoring';
import { World } from '../shared/world';
import { sweptWorldHit } from '../shared/projectiles';
import { assetCellRegions } from '../client/render/asset-cell-regions';
import { installCliffAssets,cliffAsset } from '../shared/cliff-assets';

test('subdividing a PNG changes only behavior cells, preserving size, image bounds and geometry',()=>{
  const asset=newWorldAsset('png','PNG','/world-assets/test.png');resizeWorldAsset(asset,2,3);
  asset.imageTransform={x:.2,y:-.1,scale:1.5};
  asset.geometry={surfaces:[{id:'top',x:0,y:0,width:2,height:3,elevation:1}],solids:[],stairs:[]};
  const before=structuredClone(asset), p={id:'placed',assetId:asset.id,x:4,y:5};
  subdivideWorldAsset(asset,4);
  assert.equal(asset.width,2);assert.equal(asset.height,3);assert.equal(asset.columns,2);assert.equal(asset.rows,3);
  assert.equal(assetCellColumns(asset),8);assert.equal(assetCellRows(asset),12);assert.equal(asset.cells.length,96);
  assert.deepEqual(worldAssetImageBounds(asset),worldAssetImageBounds(before));
  assert.deepEqual(placementBounds(p,asset),placementBounds(p,before));assert.deepEqual(asset.geometry,before.geometry);
});

test('refinement inherits properties and coarsening retains all blocked and visibility properties',()=>{
  const asset=newWorldAsset('png','PNG','/world-assets/test.png');asset.cells[0]={blocked:true,visibility:'hide-fade'};
  subdivideWorldAsset(asset,8); assert(asset.cells.every(c=>c.blocked&&c.visibility==='hide-fade'));
  asset.cells=asset.cells.map(()=>({blocked:false,visibility:'normal'}));
  asset.cells[0]={blocked:true,visibility:'hide'};asset.cells[63]={blocked:false,visibility:'fade'};
  subdivideWorldAsset(asset,1);assert.deepEqual(asset.cells,[{blocked:true,visibility:'hide-fade'}]);
});

test('resizing a subdivided object preserves fine cells in world coordinates',()=>{
  const asset=newWorldAsset('png','PNG','/world-assets/test.png');subdivideWorldAsset(asset,4);
  asset.cells[5]={blocked:true,visibility:'hide'};
  resizeWorldAsset(asset,2,1);
  assert.equal(asset.cells.length,32);assert.deepEqual(asset.cells[9],{blocked:true,visibility:'hide'});
  assert(asset.cells.slice(4,8).every(c=>!c.blocked));
});

test('fine PNG cells drive exact movement, projectile collision, hiding and visibility masks',()=>{
  const document=newWorldDocument(),asset=newWorldAsset('png','PNG','/world-assets/test.png');
  for(let y=0;y<8;y++) for(let x=0;x<8;x++) document.tiles.push({x,y,terrain:'grass'});
  subdivideWorldAsset(asset,4);asset.cells[0]={blocked:true,visibility:'normal'};asset.cells[1]={blocked:false,visibility:'hide-fade'};
  document.assets.push(asset);document.placements.push({id:'placed',assetId:asset.id,x:3,y:3});
  const world=new World(1,16,'world',parseWorldDocument(JSON.stringify(document)),[]);
  assert.equal(world.elevation.blocked(3.125*48,3.125*48,1,0),true);
  assert.equal(world.elevation.blocked(3.375*48,3.125*48,1,0),false);
  assert.equal(world.elevation.blocked(3.625*48,3.5*48,15,0),false);
  assert.equal(world.isHiding(3.375*48,3.125*48,0),true);assert.equal(world.isHiding(3.625*48,3.125*48,0),false);
  assert.notEqual(sweptWorldHit({x:2*48,y:3.125*48},{x:5*48,y:3.125*48},1,world),null);
  assert.equal(sweptWorldHit({x:2*48,y:3.625*48},{x:5*48,y:3.625*48},1,world),null);
  assert.deepEqual(assetCellRegions(asset,c=>c.visibility==='hide-fade'),[{x:.25,y:0,width:.25,height:.25}]);
});

test('cliff PNGs use the same subdivision without changing their exterior tile size',()=>{
  const document=newWorldDocument();installCliffAssets(document);const asset=cliffAsset(document,'centro-sinistra');
  subdivideWorldAsset(asset,4);assert.equal(asset.width,1);assert.equal(asset.height,1);assert.equal(asset.cells.length,16);
  assert.equal(parseWorldDocument(document).assets.find(a=>a.id===asset.id)!.cellSubdivision,4);
});

test('old assets remain one cell per tile and malformed subdivisions are rejected',()=>{
  const document=newWorldDocument(),asset=newWorldAsset('png','PNG','/world-assets/test.png');document.assets.push(asset);
  assert.equal(parseWorldDocument(document).assets[0].cells.length,1);
  assert.throws(()=>subdivideWorldAsset(asset,3));subdivideWorldAsset(asset,4);asset.cells.pop();assert.throws(()=>parseWorldDocument(document));
});

test('fractional PNG sizes keep finite visibility regions after subdivision',()=>{
  const asset=newWorldAsset('small','Piccolo','/world-assets/test.png');resizeWorldAsset(asset,.25,.25);
  asset.cells[0].visibility='fade';subdivideWorldAsset(asset,4);
  assert.deepEqual(assetCellRegions(asset,c=>c.visibility==='fade'),[{x:0,y:0,width:.25,height:.25}]);
});

test('whole-tile obstacle queries include blocked fine cells away from the tile origin',()=>{
  const document=newWorldDocument(),asset=newWorldAsset('png','PNG','/world-assets/test.png');
  document.tiles.push({x:3,y:3,terrain:'grass'});subdivideWorldAsset(asset,4);asset.cells[5].blocked=true;
  document.assets.push(asset);document.placements.push({id:'placed',assetId:asset.id,x:3,y:3});
  assert.equal(new World(1,16,'world',document,[]).isBlocked(3,3),true);
});
