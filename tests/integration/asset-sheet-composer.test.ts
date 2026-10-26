import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdtemp,writeFile,readFile,rm,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldAsset,newWorldDocument,resizeWorldAsset } from '../../shared/world-schema';

test('select a 3x3 tile box, extract eight frames and move one independently into a new transparent sheet', {timeout:90_000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'riftlands-sheet-compose-')),id=`codex-sheet-${randomUUID()}`;
  const options={root:resolve('.'),documentPath:join(dir,'world.json'),dungeonPath:join(dir,'dungeons.json'),dataPath:join(dir,'accounts.json'),port:0};
  const doc=newWorldDocument(),asset=newWorldAsset(id,'Bandiere','/world-assets/bush.png');resizeWorldAsset(asset,12,6);doc.assets=[asset];
  await writeFile(options.documentPath,JSON.stringify(doc));await writeFile(options.dungeonPath,'[]');
  const studio=await startWorldStudio(options);let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;const files=new Set<string>();
  try {
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(studio.url);await expect(page.locator('#status')).toContainText('World Studio pronto');await page.locator(`[data-asset="${id}"]`).click();await page.locator('#asset-expand').click();
    const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=120;c.height=60;const ctx=c.getContext('2d')!;for(let i=0;i<8;i++){ctx.fillStyle=i===0?'#ff0000':i===1?'#0000ff':'#00ff00';ctx.fillRect(i%4*30+5,Math.floor(i/4)*30+5,10,10);}return c.toDataURL().split(',')[1];});
    await page.locator('#asset-sprite-file').setInputFiles({name:`${id}-source.png`,mimeType:'image/png',buffer:Buffer.from(png,'base64')});await expect(page.locator('#asset-sprite-source')).toContainText('120 × 60');
    files.add(`/world-assets/${id}-source.png`);files.add(`/world-assets/${id}-spritesheet.png`);
    await page.locator('#asset-sheet-open').click();await expect(page.locator('#asset-sheet-source')).toBeVisible();
    await expect(page.locator('#asset-sheet-columns')).toHaveValue('12');await expect(page.locator('#asset-sheet-rows')).toHaveValue('6');
    const r=await page.locator('#asset-sheet-source').boundingBox();assert.ok(r);const s=Math.min((r.width-20)/120,(r.height-20)/60),x=r.x+(r.width-120*s)/2,y=r.y+(r.height-60*s)/2;
    await page.mouse.move(x+s,y+s);await page.mouse.down();await page.mouse.move(x+29*s,y+29*s,{steps:6});await page.mouse.up();await expect(page.locator('#asset-sheet-selection')).toContainText('3 × 3 tile');
    await page.locator('#asset-sheet-add').click();await expect(page.locator('#asset-sheet-result')).toContainText('30 × 30 px');
    await page.locator('#asset-sheet-split').click();await expect(page.locator('#asset-sheet-frames button')).toHaveCount(8);
    const f=await page.locator('#asset-sheet-frame').boundingBox();assert.ok(f);const scale=Math.min((f.width-20)/30,(f.height-20)/30),fx=f.x+f.width/2,fy=f.y+f.height/2;
    await page.mouse.move(fx,fy);await page.mouse.down();await page.mouse.move(fx+3*scale,fy+2*scale,{steps:4});await page.mouse.up();
    await expect(page.locator('#asset-sheet-x')).toHaveValue('3');await expect(page.locator('#asset-sheet-y')).toHaveValue('2');
    await page.locator('#asset-sheet-frames button').nth(1).click();await expect(page.locator('#asset-sheet-x')).toHaveValue('0');await page.locator('#asset-sheet-x').fill('-2');
    await page.locator('#asset-sheet-frames button').first().click();await expect(page.locator('#asset-sheet-x')).toHaveValue('3');await expect(page.locator('#asset-sheet-y')).toHaveValue('2');
    await mkdir(resolve('.tmp'),{recursive:true});await page.screenshot({path:resolve('.tmp/asset-sheet-composer-review.png')});
    await page.locator('#asset-sheet-save').click();await expect(page.locator('#status')).toContainText('Spritesheet creato');await expect(page.locator('#asset-sheet-source')).not.toBeVisible();await expect(page.locator('#asset-sprite-count')).toHaveValue('8');
    await page.locator('#asset-preview-close').click();await expect(page.locator('#asset-width')).toHaveValue('3');await expect(page.locator('#asset-height')).toHaveValue('3');
    const download=page.waitForEvent('download');await page.locator('#export-world').click();const packed=JSON.parse(await readFile((await(await download).path())!,'utf8')),saved=packed.document.assets[0];files.add(saved.image);
    assert.deepEqual(saved.animation,{frameWidth:30,frameHeight:30,frames:8,frameMs:130,loop:true,randomStart:false});assert.equal(saved.cells.length,9);assert.equal(saved.width,3);assert.equal(saved.height,3);
    const pixels=await page.evaluate(async src=>{const image=new Image();image.src=src;await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);return {width:c.width,height:c.height,blank:[...ctx.getImageData(6,6,1,1).data],first:[...ctx.getImageData(9,9,1,1).data],second:[...ctx.getImageData(33,5,1,1).data]};},saved.image);
    assert.deepEqual(pixels,{width:120,height:60,blank:[0,0,0,0],first:[255,0,0,255],second:[0,0,255,255]});
    assert.equal((await readFile(resolve('public/world-assets',`${id}-source.png`))).toString('base64'),png);
    await page.locator('#undo').click();await expect(page.locator('#asset-width')).toHaveValue('12');await expect(page.locator('#asset-height')).toHaveValue('6');await expect(page.locator('#asset-sprite-enabled')).not.toBeChecked();
    await page.locator('#redo').click();await expect(page.locator('#asset-width')).toHaveValue('3');await page.locator('#apply-world').click();await expect(page.locator('#status')).toContainText('Progetto salvato');assert.deepEqual(JSON.parse(await readFile(options.documentPath,'utf8')).assets[0],saved);
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await studio.close();for(const src of files)if(src.startsWith(`/world-assets/${id}-`))await rm(resolve('public',src.slice(1)),{force:true});await rm(dir,{recursive:true,force:true});}
});
