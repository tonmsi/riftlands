import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listWorldAssetFiles } from '../scripts/world-asset-files';
import { syncWorldAssetFiles } from '../client/editors/world/world-asset-sync';
import { newWorldDocument, newWorldAsset, resizeWorldAsset, parseWorldDocument, validWorldAssetImage } from '../shared/world-schema';
import { assetGroup } from '../client/editors/world/world-asset-catalog';

test('folder synchronization discovers nested art, is idempotent and preserves existing properties', async () => {
  const root=await mkdtemp(join(tmpdir(),'riftlands-asset-sync-'));
  try {
    const folder=join(root,'public','world-assets','Muri','Pietra');await mkdir(folder,{recursive:true});
    await writeFile(join(folder,'muro chiaro.PNG'),'image');await writeFile(join(folder,'note.txt'),'ignored');
    await writeFile(join(root,'public','world-assets','pavimento.svg'),'<svg/>');
    const files=await listWorldAssetFiles(root);assert.equal(files.length,2);
    const document=newWorldDocument(),existing=newWorldAsset('floor','Pavimento','/world-assets/pavimento.svg');
    resizeWorldAsset(existing,2,1);existing.cells[0].blocked=true;document.assets=[existing];
    assert.deepEqual(syncWorldAssetFiles(document,files),{added:1,repaired:0});assert.equal(document.assets[0],existing);
    assert.deepEqual(syncWorldAssetFiles(document,files),{added:0,repaired:0});
    document.placements=[{id:'first',assetId:existing.id,x:0,y:0,pivotY:0},{id:'second',assetId:existing.id,x:0,y:0,pivotY:1}];
    const parsed=parseWorldDocument(JSON.stringify(document));assert.equal(parsed.assets[0].cells[0].blocked,true);
    assert.deepEqual(parsed.placements.map(p=>p.pivotY),[0,1]);
    assert.throws(()=>parseWorldDocument(JSON.stringify({...document,placements:[{...document.placements[0],pivotY:2}]})));
    assert.equal(assetGroup(parsed.assets[1]),'Muri / Pietra');assert.equal(parsed.assets[1].columns,1);
    assert.equal(parsed.assets[1].cells[0].blocked,false);
    const moved=files.find(f=>f.name==='pavimento')!;moved.image='/world-assets/Muri/pavimento.svg';
    assert.deepEqual(syncWorldAssetFiles(document,files),{added:0,repaired:1});assert.equal(existing.image,moved.image);assert.equal(existing.cells[0].blocked,true);
    assert.equal(validWorldAssetImage('/world-assets/%2e%2e/private.svg'),false);
    assert.equal(validWorldAssetImage('/world-assets/Muri%5cprivate.png'),false);
  } finally {await rm(root,{recursive:true,force:true});}
});
