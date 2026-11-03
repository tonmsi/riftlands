import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { chromium,expect } from '@playwright/test';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldAsset,newWorldDocument,parseWorldDocument,resizeWorldAsset } from '../../shared/world-schema';
import { defaultProceduralSettings } from '../../shared/procedural-generation';
import { World } from '../../shared/world';
import { WorldTiles } from '../../shared/world-tiles';

test('family assets follow project folders, reveal used rows and create a subfamily from a folder',{timeout:90_000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'riftlands-family-folders-')),documentPath=join(directory,'world.json'),d=newWorldDocument(42);
  d.assets=Array.from({length:45},(_,i)=>{const a=newWorldAsset(`bush-${i}`,`Cespuglio ${String(i).padStart(2,'0')}`,'/world-assets/bush.png');a.group='Natura / Cespugli';return a;});
  const plant=newWorldAsset('plant','Pianta 2x2','/world-assets/bush.png');resizeWorldAsset(plant,2,2);plant.group='Natura / Piante';d.assets.push(plant);
  const bush=newWorldAsset('bush','Cespuglio','/world-assets/bush.png'),variant=newWorldAsset('bush-variant','Cespuglio variante','/world-assets/bush.png');variant.variantOf=bush.id;d.assets.push(bush,variant);
  d.assetFolders=['Vuota'];d.procedural=defaultProceduralSettings();
  d.procedural.bush.families[0].rules=[{id:'any',assets:['bush-44']},{id:'second',width:1,height:1,assets:['bush-44']}];
  for(let y=-8;y<8;y++)for(let x=-8;x<8;x++)d.tiles.push({x,y,terrain:'grass',suppressAssets:true});
  await writeFile(documentPath,JSON.stringify(d));await writeFile(join(directory,'dungeons.json'),'[]');
  const studio=await startWorldStudio({root:resolve('.'),documentPath,dungeonPath:join(directory,'dungeons.json'),dataPath:join(directory,'accounts.json'),port:0});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));await page.goto(studio.url);await expect(page.locator('#status')).toContainText('World Studio pronto');
    await expect(page.locator('#asset-list .asset-group[data-group="Cespuglio"] .asset-group-kind')).toHaveText('Gruppo varianti');
    await page.locator('#open-procedural').click();
    const variants=page.locator('.proc-asset-folder[data-folder="Cespuglio"]');
    await expect(variants.locator('.asset-group-kind')).toHaveText('Gruppo varianti');
    await expect(variants.locator('[name="proc-asset"]')).toHaveCount(2);
    await variants.locator('[data-select-folder]').click();await expect(variants.locator('[name="proc-asset"]:checked')).toHaveCount(2);
    await variants.locator('[data-clear-folder]').click();await expect(variants.locator('[name="proc-asset"]:checked')).toHaveCount(0);
    const folder=page.locator('.proc-asset-folder[data-folder="Natura / Cespugli"]');
    await expect(folder.locator('[name="proc-asset"]')).toHaveCount(45);
    await folder.locator('summary').click();await expect(folder).not.toHaveAttribute('open','');
    await page.locator('#proc-asset-search').fill('2 x 2');
    await expect(folder).toBeHidden();await expect(page.locator('[data-proc-asset="plant"]')).toBeVisible();
    await page.locator('[data-inspect-asset="bush-44"]').click();
    await expect(page.locator('#procedural-dialog')).toBeVisible();await expect(page.locator('#proc-asset-search')).toHaveValue('');
    await expect(page.locator('[data-proc-asset="bush-44"]')).toHaveClass(/proc-asset-highlight/);
    await expect(page.locator('[name="proc-asset"][value="bush-44"]')).toBeFocused();
    await page.locator('[data-remove-family-asset="bush-44"]').click();await expect(page.locator('#proc-used-assets [data-inspect-asset]')).toHaveCount(0);
    await page.locator('#proc-save').click();await page.locator('#proc-rule').selectOption('second');
    await expect(page.locator('[name="proc-asset"][value="bush-44"]')).not.toBeChecked();
    await page.locator('#proc-rule').selectOption('any');
    await folder.locator('[data-select-folder]').click();await expect(folder.locator('[name="proc-asset"]:checked')).toHaveCount(45);
    await page.locator('#proc-save').click();
    await folder.locator('[data-family-folder]').click();await expect(page.locator('#proc-name')).toHaveValue('Natura / Cespugli');
    await expect(page.locator('#proc-used-assets [data-inspect-asset]')).toHaveCount(45);
    await page.locator('[data-catalog-asset="bush-44"]').click();await expect(page.locator('#procedural-dialog')).not.toBeVisible();
    await expect(page.locator('#asset-catalog-dialog')).toBeVisible();
    await expect(page.locator('#asset-list [data-asset="bush-44"]')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#asset-list [data-asset="bush-44"]')).toBeFocused();
    await expect(page.locator('#asset-bulk-count')).toHaveText('1 asset selezionati');
    await page.locator('#asset-catalog-close').click();await page.locator('#apply-world').click();await expect(page.locator('#status')).toContainText('Progetto salvato con backup');
    const saved=parseWorldDocument(await readFile(documentPath,'utf8'));
    assert.equal(saved.procedural?.bush.families[1].name,'Natura / Cespugli');assert.equal(saved.procedural?.bush.families[1].rules[0].assets.length,45);
    assert.deepEqual(saved.procedural?.bush.families[0].rules[1].assets,[]);assert.equal(saved.assets.length,48);
    await page.locator('#open-procedural').click();
    await page.screenshot({path:resolve('artifacts/procedural-folders-review.png')});assert.deepEqual(errors,[]);
  }finally{await browser?.close();await studio.close();await rm(directory,{recursive:true,force:true});}
});

test('procedural workspace edits families, moves painting and persists configuration with undo and reload',{timeout:90_000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'riftlands-procedural-')),documentPath=join(directory,'world.json');
  const d=newWorldDocument(42);d.assets=[newWorldAsset('plant','Pianta test','/world-assets/bush.png')];
  for(let y=-8;y<8;y++)for(let x=-8;x<8;x++)d.tiles.push({x,y,terrain:'grass',suppressAssets:true});
  await writeFile(documentPath,JSON.stringify(d));await writeFile(join(directory,'dungeons.json'),'[]');
  const studio=await startWorldStudio({root:resolve('.'),documentPath,dungeonPath:join(directory,'dungeons.json'),dataPath:join(directory,'accounts.json'),port:0});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));await page.goto(studio.url);await expect(page.locator('#status')).toContainText('World Studio pronto');
    await page.locator('#open-procedural').click();await expect(page.locator('#procedural-dialog')).toBeVisible();await expect(page.locator('#proc-js')).not.toBeChecked();
    await expect(page.locator('#procedural-dialog #world-painting-panel')).toHaveCount(1);await expect(page.locator('.world-palette #world-painting-panel')).toHaveCount(0);
    await page.locator('#world-painting-panel > summary').click();await page.locator('#painting-grass-color').fill('#8aab66');await page.locator('#painting-grass-color').dispatchEvent('change');
    await page.getByRole('button',{name:'Piante',exact:true}).click();await page.locator('[name="proc-asset"][value="plant"]').check();await page.locator('#proc-save').click();
    await page.locator('#proc-add-family').click();await page.locator('#proc-name').fill('Piante fredde');await page.locator('#proc-temp-max').fill('.25');await page.locator('#proc-height-min').fill('2');await page.locator('#proc-temp-blend').fill('.15');await page.locator('#proc-save').click();
    await expect(page.locator('#proc-name')).toHaveValue('Piante fredde');
    await page.locator('#proc-height-min').fill('8');await page.locator('#proc-height-max').fill('2');await page.locator('#proc-save').click();await expect(page.locator('#proc-feedback')).toContainText('famiglia procedurale');
    await page.locator('#proc-height-min').fill('2');await page.locator('#proc-height-max').fill('6');await page.locator('#proc-save').click();
    await page.locator('#procedural-close').click();await page.locator('#undo').click();await page.locator('#open-procedural').click();await expect(page.locator('#proc-height-max')).toHaveValue('4');
    await page.locator('#procedural-close').click();await page.locator('#redo').click();
    await page.locator('#apply-world').click();await expect(page.locator('#status')).toContainText('Progetto salvato con backup');
    const saved=parseWorldDocument(await readFile(documentPath,'utf8'));assert.equal(saved.procedural?.plant.useJs,false);assert.equal(saved.procedural?.plant.families[1].name,'Piante fredde');assert.equal(saved.procedural?.plant.families[1].elevation[1],6);assert.deepEqual(saved.procedural?.plant.families[0].rules[0].assets,['plant']);
    await page.reload();await expect(page.locator('#status')).toContainText('World Studio pronto');await page.locator('#open-procedural').click();await page.getByRole('button',{name:'Piante',exact:true}).click();await expect(page.locator('#proc-family option')).toHaveCount(2);
    assert.equal(saved.painting?.materials.grass.color,'#8aab66');await page.screenshot({path:process.env.PROCEDURAL_SCREENSHOT??join(directory,'procedural-panel.png')});assert.deepEqual(errors,[]);
  }finally{await browser?.close();await studio.close();await rm(directory,{recursive:true,force:true});}
});

test('family usage is interactive and terrain brush paints plants and bush footprint rules',{timeout:90_000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'riftlands-family-paint-')),documentPath=join(directory,'world.json'),d=newWorldDocument(42);
  d.procedural=defaultProceduralSettings();d.procedural.bush.density=d.procedural.plant.density=0;
  for(const kind of ['bush','plant'] as const){const a=newWorldAsset(`${kind}-large`,`${kind} 2x2`,'/world-assets/bush.png');resizeWorldAsset(a,2,2);d.assets.push(a);d.procedural[kind].families[0].rules=[{id:'large',width:2,height:2,assets:[a.id]}];}
  for(let y=-12;y<12;y++)for(let x=-12;x<12;x++)d.tiles.push({x,y,terrain:'grass',suppressAssets:true});
  await writeFile(documentPath,JSON.stringify(d));await writeFile(join(directory,'dungeons.json'),'[]');
  const studio=await startWorldStudio({root:resolve('.'),documentPath,dungeonPath:join(directory,'dungeons.json'),dataPath:join(directory,'accounts.json'),port:0});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));await page.goto(studio.url);await expect(page.locator('#status')).toContainText('World Studio pronto');
    await expect(page.locator('#terrain option[value="plant"]')).toHaveText('Piante');
    await page.locator('#open-procedural').click();await expect(page.locator('#proc-used-assets')).toContainText('bush 2x2');await expect(page.locator('#proc-used-assets')).toContainText('In uso');
    if(process.env.PROCEDURAL_SCREENSHOT)await page.screenshot({path:process.env.PROCEDURAL_SCREENSHOT.replace('.png','-assigned.png')});
    await page.locator('[data-edit-asset="bush-large"]').click();await expect(page.locator('#asset-name')).toHaveValue('bush 2x2');await expect(page.locator('#asset-inspector')).toBeVisible();
    await page.locator('#open-procedural').click();await page.locator('#proc-name').fill('Cespugli dipinti');await page.locator('#proc-paint-family').click();await expect(page.locator('#terrain')).toHaveValue('bush');await expect(page.locator('#procedural-default-only')).toBeChecked();
    await page.locator('#brush-radius').fill('2');let box=(await page.locator('#map').boundingBox())!;
    await page.mouse.click(box.x+box.width/2+3.5*24,box.y+box.height/2+3.5*24);
    await page.locator('#open-procedural').click();await page.getByRole('button',{name:'Piante',exact:true}).click();await expect(page.locator('#proc-used-assets')).toContainText('plant 2x2');await page.locator('#proc-paint-family').click();
    await expect(page.locator('#terrain')).toHaveValue('plant');await expect(page.locator('#terrain-family-assets img')).toHaveCount(1);
    box=(await page.locator('#map').boundingBox())!;await page.mouse.click(box.x+box.width/2-3.5*24,box.y+box.height/2-3.5*24);
    await page.locator('#apply-world').click();await expect(page.locator('#status')).toContainText('Progetto salvato con backup');
    const saved=parseWorldDocument(await readFile(documentPath,'utf8')),tiles=new WorldTiles(saved),world=new World(42,160,'world',saved,[]);
    assert.equal(saved.procedural?.bush.families[0].name,'Cespugli dipinti');
    assert.equal(tiles.at(3,3)?.terrain,'bush');assert.equal(tiles.at(-4,-4)?.terrain,'plant');assert.equal(tiles.at(-4,-4)?.defaultFamilyOnly,true);
    const placements=world.assetsIn({left:-8,top:-8,right:8,bottom:8},false);assert.ok(placements.some(p=>p.assetId==='plant-large'));assert.ok(placements.some(p=>p.assetId==='bush-large'));
    if(process.env.PROCEDURAL_SCREENSHOT)await page.screenshot({path:process.env.PROCEDURAL_SCREENSHOT.replace('.png','-map.png')});
    const bush=placements.find(p=>p.assetId==='bush-large')!;await page.locator('[data-tool="select"]').click();box=(await page.locator('#map').boundingBox())!;
    await page.mouse.click(box.x+box.width/2+(bush.x+1)*24,box.y+box.height/2+(bush.y+1)*24);await expect(page.locator('#asset-name')).toHaveValue('bush 2x2');await expect(page.locator('#asset-inspector')).toBeVisible();
    await page.reload();await expect(page.locator('#status')).toContainText('World Studio pronto');assert.deepEqual(errors,[]);
  }finally{await browser?.close();await studio.close();await rm(directory,{recursive:true,force:true});}
});
