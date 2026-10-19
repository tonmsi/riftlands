import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraElevation,elevationCameraZoom } from '../client/render/elevation-camera';
import type { WorldStair } from '../shared/elevation';
import { World } from '../shared/world';
import { newWorldAsset,newWorldDocument } from '../shared/world-schema';

const stair:WorldStair={id:'passage',x:0,y:0,width:4,height:1,axis:'x',from:0,to:1,appearance:'passage'};
const at=(x:number,y=.5,elevation=0)=>({x:x*48,y:y*48,elevation});
test('camera height follows passage length without jumping at the discrete floor change',()=>{
  assert.equal(cameraElevation(at(1),[stair]),.25);
  assert.equal(cameraElevation(at(2, .5,0),[stair]),.5);
  assert.equal(cameraElevation(at(2, .5,1),[stair]),.5);
  assert.equal(cameraElevation(at(3, .5,1),[stair]),.75);
  assert.equal(cameraElevation(at(4, .5,1),[stair]),1);
  assert.equal(cameraElevation(at(1),[{...stair,width:8}]),.125);
});
test('camera respects reversed stairs, vertical passages and unrelated floors',()=>{
  assert.equal(cameraElevation(at(1,.5,1),[{...stair,from:1,to:-1}]),.5);
  assert.equal(cameraElevation(at(.5,3,1),[{...stair,axis:'y',width:1,height:4}]),.75);
  assert.equal(cameraElevation(at(1,.5,2),[stair]),2);
  assert.equal(cameraElevation(at(1,2,0),[stair]),0);
});
test('elevation zoom is subtle, supports negative floors and stays bounded on tall mountains',()=>{
  assert.equal(elevationCameraZoom(0),1);
  assert(elevationCameraZoom(1)<1&&elevationCameraZoom(1)>.96);
  assert(elevationCameraZoom(-1)>1);
  assert(elevationCameraZoom(127)>=.88);
  assert(elevationCameraZoom(-128)<=1.12);
});

test('camera passage query reads indexed stairs and placed PNGs without building collision geometry',()=>{
  const document=newWorldDocument(),asset=newWorldAsset('stairs','Scala','/world-assets/test.png');
  asset.geometry={surfaces:[],solids:[],stairs:[{...stair,width:1,from:-1,to:0}]};document.assets.push(asset);
  document.placements.push({id:'placed',assetId:asset.id,x:0,y:0,baseElevation:1});
  document.geometry={surfaces:[],solids:[],stairs:[stair]};
  const world=new World(1,16,'world',document,[]);
  world.elevation.geometry=()=>{throw new Error('Full geometry must not be used by camera');};
  world.elevation.cliffs=()=>{throw new Error('Cliffs must not be constructed by camera');};
  world.assetsIn=()=>{throw new Error('No procedural generation needed for placed stairs');};
  const result=world.elevation.stairsIn({left:.25,top:.25,right:.75,bottom:.75});
  assert.deepEqual(result.map(s=>[s.id,s.from,s.to]),[['passage',0,1],['placed/passage',0,1]]);
  assert.deepEqual(world.elevation.stairsIn({left:20,top:20,right:21,bottom:21}),[]);
});
