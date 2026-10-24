import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorldDocument, newWorldAsset } from '../shared/world-schema';
import { validateWorld } from '../shared/world-validation';
import { assetAtFloor, assetInSelection, selectionRect, canPaintTerrainLevel } from '../client/editors/world/world-picking';
import { locateWorldIssue } from '../client/editors/world/world-problems';
import { newInterior } from '../shared/warps';

test('terrain painting raises one level at a time, lowers freely and picks derived cell floors', () => {
  assert.equal(canPaintTerrainLevel(0, 2), false);
  assert.equal(canPaintTerrainLevel(0, 1), true);
  assert.equal(canPaintTerrainLevel(1, 2), true);
  assert.equal(canPaintTerrainLevel(0, -2), true);
  assert.equal(canPaintTerrainLevel(2, 2), true);
  assert.equal(canPaintTerrainLevel(2, 0), true);
  assert.equal(canPaintTerrainLevel(12, 0), true);
  assert.equal(canPaintTerrainLevel(2, -1), true);
  assert.equal(canPaintTerrainLevel(2, -129), false);
  assert.equal(canPaintTerrainLevel(2, .5), false);
  const asset = newWorldAsset('a', 'a', '/world-assets/a.svg'); asset.cells[0].elevation=1;
  assert.equal(assetAtFloor(asset,0,1,{x:.5,y:.5}),true);
  assert.equal(assetAtFloor(asset,0,0,{x:.5,y:.5}),false);
  asset.cells[0].elevation=2;
  assert.equal(assetAtFloor(asset,0,2,{x:.5,y:.5}),true,'specific object floors can span multiple levels');
});

test('marquee uses image bounds, supports reverse drags and excludes hidden asset regions', () => {
  const asset = newWorldAsset('a', 'a', '/world-assets/a.svg');
  const p = { id: 'p', assetId: 'a', x: 5, y: 5 };
  const box = selectionRect({ x: 7, y: 7 }, { x: 4, y: 4 });
  assert.equal(assetInSelection(asset, p, 0, null, box), true);
  assert.equal(assetInSelection(asset, p, 0, [1], box), false);
  asset.cells[0].elevation = 1;
  assert.equal(assetInSelection(asset, p, 0, [1], box), true);
  assert.equal(assetInSelection(asset, p, 0, [0], box), false);
  assert.equal(assetInSelection(asset, p, 0, null, selectionRect({ x: 0, y: 0 }, { x: 1, y: 1 })), false);
  asset.imageTransform = { x: -2, y: 0, scale: 1 };
  assert.equal(assetInSelection(asset, p, 0, null, selectionRect({ x: 3, y: 5 }, { x: 4, y: 6 })), true);
});

test('diagnostics navigate to the correct map, floor and entity without guessing duplicate names',()=>{
  const d=newWorldDocument();d.interiors=[newInterior('house','Casa')];d.interiors[0].document.npcs=[{id:'npc-a',npcKind:'slime',x:4,y:5,level:1,elevation:2}];
  assert.deepEqual(locateWorldIssue(d,'Casa: NPC npc-a su un ostacolo.'),{mapId:'house',point:d.interiors[0].document.npcs[0],elevation:2,kind:'npc',id:'npc-a'});
  d.warps=[{id:'door',name:'Porta',from:'world',to:'house',entry:{x:1,y:2},arrival:{x:4,y:5},arrivalElevation:2,activation:'walk'}];
  assert.equal(locateWorldIssue(d,'Porta: arrivo su un ostacolo.')?.mapId,'house');
  assert.equal(locateWorldIssue(d,'Porta: arrivo su un ostacolo.')?.elevation,2);
  d.warps.push({...d.warps[0],id:'other'});assert.equal(locateWorldIssue(d,'Porta: arrivo su un ostacolo.'),undefined);
});

test('warp validation compares full trigger areas at their own elevation and checks return floors', () => {
  const d=newWorldDocument(1);
  for(let y=-3;y<=12;y++)for(let x=-3;x<=12;x++)d.tiles.push({x,y,terrain:'grass'});
  d.geometry={surfaces:[{id:'deck',x:2,y:2,width:8,height:8,elevation:1,ground:false,terrain:'grass'}],solids:[],stairs:[]};
  d.warps=[{id:'a',name:'a',from:'world',to:'world',entry:{x:4,y:4},arrival:{x:8,y:8},entryElevation:1,arrivalElevation:1,activation:'walk'},
    {id:'b',name:'b',from:'world',to:'world',entry:{x:4,y:4},arrival:{x:9,y:9},entryElevation:1,arrivalElevation:1,activation:'walk'}];
  assert.ok(validateWorld(d,[]).some(s=>s.includes('ingresso sovrapposto')));
  d.warps[1].entryElevation=0;
  assert.equal(validateWorld(d,[]).some(s=>s.includes('ingresso sovrapposto')),false);
  d.warps[1]={id:'b',name:'b',from:'world',to:'world',entry:{x:8,y:8},arrival:{x:4,y:4},entryElevation:0,arrivalElevation:1,activation:'walk',reverseId:'a'};
  d.warps[0].reverseId='b';
  assert.ok(validateWorld(d,[]).some(s=>s.includes('ritorno non coerente')));
  d.warps[1].entryElevation=1;
  assert.equal(validateWorld(d,[]).some(s=>s.includes('ritorno non coerente')),false);
  d.warps[0].entrySize={x:3,y:1}; d.warps[1].entry={x:6,y:4};
  assert.ok(validateWorld(d,[]).some(s=>s.includes('ingresso sovrapposto')));
});
