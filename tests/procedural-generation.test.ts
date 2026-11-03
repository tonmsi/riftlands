import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProceduralSettings, proceduralAsset } from '../shared/procedural-generation';
import { newWorldDocument, newWorldAsset, resizeWorldAsset, parseWorldDocument } from '../shared/world-schema';
import { compactWorldTiles, WorldTiles, serializeWorldDocument } from '../shared/world-tiles';
import { WorldAuthoring } from '../shared/world-authoring';
import { World } from '../shared/world';
import { sceneryGroups } from '../client/render/terrain-style';
import { cliffAsset } from '../shared/cliff-assets';

function fixture() {
  const d=newWorldDocument(42);d.procedural=defaultProceduralSettings();
  d.assets=['normal','cold','wide'].map(id=>newWorldAsset(id,id,`/world-assets/${id}.png`));resizeWorldAsset(d.assets[2],3,2);
  const section=d.procedural.rock;section.families[0].rules=[{id:'any',assets:['normal']},{id:'wide',width:3,height:2,assets:['wide']}];
  section.families.push({id:'cold',name:'Freddo',temperature:[0,.2],elevation:[2,5],temperatureBlend:.2,elevationBlend:2,rules:[{id:'any',assets:['cold']}]});
  return d;
}
const sample={x:3,y:4,temperature:.1,elevation:3,width:1,height:1};
test('specific footprints, environmental families, explicit JS and default-only overrides select the correct pool',()=>{
  const d=fixture();assert.equal(proceduralAsset(d,'rock',sample)?.id,'cold');
  assert.equal(proceduralAsset(d,'rock',{...sample,defaultOnly:true})?.id,'normal');
  assert.equal(proceduralAsset(d,'rock',{...sample,temperature:.9})?.id,'normal');
  assert.equal(proceduralAsset(d,'rock',{...sample,elevation:10})?.id,'normal');
  assert.equal(proceduralAsset(d,'rock',{...sample,width:3,height:2})?.id,'wide');
  assert.equal(proceduralAsset(d,'rock',{...sample,width:2,height:2}),undefined);
  d.procedural!.rock.useFamilies=false;assert.equal(proceduralAsset(d,'rock',sample)?.id,'normal');
  d.procedural!.rock.useJs=true;assert.equal(proceduralAsset(d,'rock',sample),undefined);
});
test('blend mixes families reproducibly and is independent of asset order',()=>{
  const d=fixture(),ids=new Set<string>();
  for(let x=0;x<200;x++){
    const s={...sample,x,temperature:.3};const chosen=proceduralAsset(d,'rock',s)?.id;ids.add(chosen!);
    assert.equal(proceduralAsset({...d,assets:[...d.assets].reverse()},'rock',s)?.id,chosen);
  }assert.deepEqual(ids,new Set(['normal','cold']));
});
test('configuration and per-stroke family overrides survive validation and compact round-trip',()=>{
  const d=fixture();d.tiles=[{x:-2,y:3,terrain:'rock',defaultFamilyOnly:true,suppressAssets:true},{x:0,y:0,terrain:'grass',bushStyle:'png',defaultFamilyOnly:true,suppressAssets:true}];
  const restored=parseWorldDocument(serializeWorldDocument(d));assert.deepEqual(restored.procedural,d.procedural);
  const tiles=new WorldTiles(restored);assert.equal(tiles.at(-2,3)?.defaultFamilyOnly,true);assert.equal(tiles.at(0,0)?.bushStyle,'png');
  const bad=structuredClone(d);bad.procedural!.rock.families[0].rules[0].assets=['missing'];assert.throws(()=>parseWorldDocument(bad),/riferimento asset/);
  const badRange=structuredClone(d);badRange.procedural!.rock.families[1].elevation=[5,2];assert.throws(()=>parseWorldDocument(badRange),/famiglia procedurale/);
});
test('3×2 rock groups partition tiles once, including negative macro cells and query-order changes',()=>{
  const footprints=[{width:3,height:2}],tile=()=> 'rock' as const;
  const groups=[];for(let y=-6;y<6;y+=2)for(let x=-6;x<6;x+=2)groups.push(...sceneryGroups(tile,x,y,footprints));
  const covered=new Set<string>();for(const g of groups){assert.equal(g.width,3);assert.equal(g.height,2);for(let y=g.y;y<g.y+g.height;y++)for(let x=g.x;x<g.x+g.width;x++){const key=`${x},${y}`;assert.ok(!covered.has(key));covered.add(key);}}
  assert.equal(covered.size,144);
});
test('generated plants use family assets and actual geometry, preserve query determinism and fallback to JS',()=>{
  const d=fixture();d.procedural!.plant.families[0].rules[0].assets=['normal'];d.procedural!.plant.density=1;d.procedural!.bush.density=0;d.assets[0].cells[0].blocked=true;
  const bounds={left:0,top:0,right:32,bottom:32},env={tile:()=> 'grass' as const,temperature:()=>.5,moisture:()=>.5,elevation:()=>0,reserved:()=>false};
  const a=new WorldAuthoring(d),placements=a.assetsIn(bounds,env,d.seed);assert.ok(placements.length);assert.ok(placements.every(p=>p.assetId==='normal'));
  const b=new WorldAuthoring(d);b.assetsIn({left:-32,top:-32,right:0,bottom:0},env,d.seed);assert.deepEqual(b.assetsIn(bounds,env,d.seed),placements);
  d.procedural!.plant.useJs=true;assert.ok(new WorldAuthoring(d).assetsIn(bounds,env,d.seed).every(p=>p.assetId.startsWith('procedural-plant')));
  const w=new World(42,160,'world',compactWorldTiles(d),[]);const first=w.assetsIn(bounds,false)[0];if(first)assert.ok(w.authoring.assets.has(first.assetId));
});
test('cliff family selection shares temperature, elevation and fallback with physics',()=>{
  const d=fixture();d.procedural!.cliff.families[0].rules=[{id:'edge',cliffVariant:'alto-centro',assets:['normal']}];
  const cliff={x:0,y:0,base:0,elevation:2,parts:[{variant:'alto-centro' as const}]};
  assert.equal(cliffAsset(d,'alto-centro',cliff).id,'normal');d.procedural!.cliff.useJs=true;
  assert.ok(cliffAsset(d,'alto-centro',cliff).id.startsWith('procedural-cliff'));
});

test('painted bushes and plants use the same family footprint rules, collision masks and catalog definitions',()=>{
  for(const kind of ['bush','plant'] as const){
    const d=newWorldDocument(42);d.procedural=defaultProceduralSettings();d.procedural.bush.density=d.procedural.plant.density=0;
    const a=newWorldAsset('large','Large foliage','/world-assets/large.png');resizeWorldAsset(a,2,2);a.cells[0].blocked=true;d.assets.push(a);
    d.procedural[kind].families[0].rules=[{id:'2x2',width:2,height:2,assets:[a.id]}];
    for(let y=0;y<6;y++)for(let x=0;x<6;x++)d.tiles.push({x,y,terrain:kind,bushStyle:'png',suppressAssets:true,defaultFamilyOnly:true});
    const restored=parseWorldDocument(serializeWorldDocument(d)),w=new World(42,160,'world',restored,[]),bounds={left:0,top:0,right:6,bottom:6};
    const placements=w.assetsIn(bounds,false).filter(p=>p.id.startsWith('scenery:'));
    assert.equal(placements.length,9);assert.ok(placements.every(p=>p.assetId===a.id));
    assert.equal(w.elevation.blocked(24,24,0,0),true);assert.equal(w.elevation.blocked(72,24,0,0),false);
    assert.deepEqual(w.assetsIn({left:2,top:2,right:4,bottom:4},false),placements.filter(p=>p.x===2&&p.y===2));
    const changed=structuredClone(restored);changed.assets[0].image='/world-assets/replacement.png';
    const next=new World(42,160,'world',changed,[]);assert.equal(next.authoring.assets.get(next.assetsIn(bounds,false)[0].assetId)?.image,'/world-assets/replacement.png');
  }
});

test('painted plants blend biome families and retain the explicit default and JS overrides',()=>{
  const d=newWorldDocument(42);d.procedural=defaultProceduralSettings();d.procedural.plant.density=d.procedural.bush.density=0;
  d.assets=['default-plant','cold-plant'].map(id=>newWorldAsset(id,id,`/world-assets/${id}.png`));
  const s=d.procedural.plant;s.families[0].rules[0].assets=['default-plant'];
  s.families.push({id:'cold',name:'Cold',temperature:[0,.2],elevation:[0,0],temperatureBlend:.2,elevationBlend:1,rules:[{id:'any',assets:['cold-plant']}]});
  d.zones=[{id:'cold-zone',name:'Cold',priority:1,shape:{kind:'rect',x:0,y:0,width:12,height:6},temperature:.1}];
  for(let y=0;y<6;y++)for(let x=0;x<12;x++)d.tiles.push({x,y,terrain:'plant',bushStyle:x===0?'js':'png',suppressAssets:true,defaultFamilyOnly:x>=6});
  const saved=parseWorldDocument(serializeWorldDocument(d)),w=new World(42,160,'world',saved,[]),placements=w.assetsIn({left:0,top:0,right:12,bottom:6},false);
  assert.ok(placements.some(p=>p.x>0&&p.x<6&&p.assetId==='cold-plant'));
  assert.ok(placements.filter(p=>p.x>=6).every(p=>p.assetId==='default-plant'));
  assert.ok(placements.filter(p=>p.x===0).every(p=>p.assetId.startsWith('procedural-plant')));
  assert.equal(new WorldTiles(saved).at(10,1)?.terrain,'plant');
});

test('plant painting remains valid on raised terrain and queries assets at the painted level',()=>{
  const d=newWorldDocument(42);d.procedural=defaultProceduralSettings();d.procedural.plant.density=d.procedural.bush.density=0;
  const a=newWorldAsset('alpine','Alpine plant','/world-assets/alpine.png');d.assets.push(a);d.procedural.plant.families[0].rules[0].assets=[a.id];
  d.tiles=[{x:2,y:2,terrain:'plant',bushStyle:'png',suppressAssets:true}];
  d.geometry={surfaces:[{id:'raised',x:2,y:2,width:1,height:1,elevation:2,terrain:'plant',ground:true,painted:true}],solids:[],stairs:[]};
  const restored=parseWorldDocument(serializeWorldDocument(d)),w=new World(42,160,'world',restored,[]);
  const plants=w.assetsIn({left:2,top:2,right:3,bottom:3},false);assert.equal(plants.length,1);assert.equal(plants[0].assetId,'alpine');assert.equal(plants[0].baseElevation,2);
});
