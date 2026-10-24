import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorldStair } from '../shared/elevation';
import { World } from '../shared/world';
import { newWorldAsset,newWorldDocument } from '../shared/world-schema';

test('passage query reads indexed stairs and placed PNGs without building collision geometry',()=>{
  const stair:WorldStair={id:'passage',x:0,y:0,width:4,height:1,axis:'x',from:0,to:1,appearance:'passage'};
  const document=newWorldDocument(),asset=newWorldAsset('stairs','Scala','/world-assets/test.png');
  asset.geometry={surfaces:[],solids:[],stairs:[{...stair,width:1,from:-1,to:0}]};document.assets.push(asset);
  document.placements.push({id:'placed',assetId:asset.id,x:0,y:0,baseElevation:1});
  document.geometry={surfaces:[],solids:[],stairs:[stair]};
  const world=new World(1,16,'world',document,[]);
  world.elevation.geometry=()=>{throw new Error('Full geometry must not be used');};
  world.elevation.cliffs=()=>{throw new Error('Cliffs must not be constructed');};
  world.assetsIn=()=>{throw new Error('No procedural generation needed for placed stairs');};
  const result=world.elevation.stairsIn({left:.25,top:.25,right:.75,bottom:.75});
  assert.deepEqual(result.map(s=>[s.id,s.from,s.to]),[['passage',0,1],['placed/passage',0,1]]);
  assert.deepEqual(world.elevation.stairsIn({left:20,top:20,right:21,bottom:21}),[]);
});
