import test from 'node:test';
import assert from 'node:assert/strict';
import { assetSpriteFrame, spritesheetLayout, validAssetSpritesheet } from '../shared/asset-sprites';
import { newWorldAsset, newWorldDocument, parseWorldDocument, worldAssetImageBounds } from '../shared/world-schema';

const animation = { frameWidth: 64, frameHeight: 32, frames: 3, frameMs: 100, loop: true, randomStart: false };
test('rectangular frames keep their proportions and base without resizing collision cells', () => {
  const a = newWorldAsset('sheet','Fontana','/world-assets/fountain.png');
  a.width = a.height = 2; a.animation = animation;
  const cells = structuredClone(a.cells);
  assert.deepEqual(worldAssetImageBounds(a),{x:0,y:1,width:2,height:1});
  a.animation = {...animation,frameWidth:32,frameHeight:64};
  assert.deepEqual(worldAssetImageBounds(a),{x:.5,y:0,width:1,height:2});
  a.imageTransform = {x:1,y:-1,scale:2};
  assert.deepEqual(worldAssetImageBounds(a),{x:2,y:-1,width:2,height:4});
  assert.deepEqual(a.cells,cells); assert.equal(a.width,2); assert.equal(a.height,2);
});
test('asset sprite frames use row-major sheets, partial last rows, looping and deterministic phase offsets', () => {
  assert.deepEqual(spritesheetLayout(animation,128,64),{columns:2,rows:2});
  assert.deepEqual([0,99,100,200,300,600].map(t=>assetSpriteFrame(animation,t)),[0,0,1,2,0,0]);
  assert.equal(assetSpriteFrame({...animation,loop:false},99999),2);
  assert.equal(assetSpriteFrame({...animation,randomStart:true},0,.5),1);
  assert.equal(assetSpriteFrame({...animation,randomStart:true,loop:false},0,.9),0);
  assert.throws(()=>spritesheetLayout(animation,127,64),/multipli/);
  assert.throws(()=>spritesheetLayout({...animation,frames:5},128,64),/numero/);
});
test('sprite configuration roundtrips without changing collision cells, image size or transforms', () => {
  const a = newWorldAsset('sheet','Fontana','/world-assets/fountain.png'); a.animation=animation;
  a.cells[0]={blocked:true,visibility:'hide-fade'}; a.imageTransform={x:-.2,y:-.1,scale:1.3};
  const doc=newWorldDocument(); doc.assets=[a];doc.placements=[{id:'one',assetId:a.id,x:0,y:0}];
  assert.deepEqual(parseWorldDocument(JSON.stringify(doc)).assets[0],a);
  for(const patch of [{frameWidth:0},{frameHeight:1.5},{frames:129},{frameMs:0},{loop:1},{randomStart:'yes'}])assert.equal(validAssetSpritesheet({...animation,...patch}),false);
  assert.throws(()=>parseWorldDocument({...doc,assets:[{...a,image:'/world-assets/fountain.svg'}]}),/spritesheet/);
  assert.throws(()=>parseWorldDocument({...doc,assets:[{...a,visual:{kind:'fire',style:'brazier'}}]}),/spritesheet/);
});
