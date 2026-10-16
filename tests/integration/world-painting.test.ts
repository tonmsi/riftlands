import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldDocument } from '../../shared/world-schema';

test('World Painting previews, undoes, exports, installs and reloads its palette', { timeout:60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(),'riftlands-painting-')), root = resolve('.');
  const options = { root: directory, port:0, documentPath:join(directory,'world.json'), dungeonPath:join(directory,'dungeons.json'), dataPath:join(directory,'accounts.json') };
  const doc = newWorldDocument();
  for (let y=-15;y<15;y++) for(let x=-20;x<20;x++) doc.tiles.push({x,y,terrain:y < -4 ? 'water' : x < -3 ? 'grass' : x < 5 ? 'path' : y > 6 ? 'ice' : 'snow'});
  await Promise.all([cp(join(root,'client'),join(directory,'client'),{recursive:true}),cp(join(root,'shared'),join(directory,'shared'),{recursive:true}),
    cp(join(root,'world-maker.html'),join(directory,'world-maker.html')),mkdir(join(directory,'public/world-assets'),{recursive:true}),
    writeFile(options.documentPath,JSON.stringify(doc)),writeFile(options.dungeonPath,'[]')]);
  const studio = await startWorldStudio(options);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel:'chrome', headless:true });
    const page = await browser.newPage({viewport:{width:1640,height:1100}}), errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript('window.__name = (value) => value');
    await page.goto(studio.url);await expect(page.locator('#status')).toContainText('World Studio pronto');
    const masks = await page.evaluate(async () => {
      const { terrainMaskCommands } = await import('/client/render/terrain-masks.ts' as string);
      const canvas = document.createElement('canvas'); canvas.width=canvas.height=64;
      const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
      const results=[];
      for(let mask=0;mask<16;mask++) {
        ctx.clearRect(0,0,64,64);ctx.fill(new Path2D(terrainMaskCommands(mask,64,1)),'evenodd');
        results.push([[3,3],[60,3],[60,60],[3,60]].map(([x,y])=>ctx.getImageData(x,y,1,1).data[3]>128));
      }
      return results;
    });
    for(let mask=0;mask<16;mask++) assert.deepEqual(masks[mask],[0,1,2,3].map(bit=>!!(mask & 1<<bit)));
    const seams = await page.evaluate(async () => {
      const { PaintedTerrain } = await import('/client/render/painted-terrain.ts' as string);
      const { defaultWorldPainting } = await import('/shared/world-painting.ts' as string);
      const painting=defaultWorldPainting(), results=[];
      const art={draw(){},drawSnowFringe(){},paintWater(){},paintGround(){}};
      for(const scale of [.65,.95,1,1.3,1.5,2]) {
        const canvas=document.createElement('canvas');canvas.width=500;canvas.height=260;
        const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
        ctx.setTransform(scale,0,0,scale,.37,100.29);
        new PaintedTerrain().draw(ctx,{left:0,top:-100,right:800,bottom:200},painting,art,
          (_x:number,y:number)=>y<0?'grass':'path',(s:string)=>s==='path'?'#c8b080':'#608050',{getTemperature:()=>1});
        const row=ctx.getImageData(1,Math.floor(100.29+12*scale),498,1).data;let wrong=0;
        for(let i=0;i<row.length;i+=4)if(Math.abs(row[i]-200)>2||Math.abs(row[i+1]-176)>2||Math.abs(row[i+2]-128)>2)wrong++;
        results.push({scale,wrong});
      }
      return results;
    });
    for(const seam of seams) assert.equal(seam.wrong,0,'no backing color may leak at shared mask edges: '+JSON.stringify(seam));
    await page.locator('.palette-navigation button').filter({hasText:'Painting'}).click();
    await expect(page.locator('#painting-masks')).toBeVisible();
    await page.locator('#painting-grass-color').fill('#aabb66');
    await page.locator('#painting-grass-color').dispatchEvent('change');
    await page.locator('#painting-water-size').fill('1.5');
    await page.locator('#painting-water-size').dispatchEvent('change');
    await page.locator('#painting-snow-intensity').fill('0');
    await page.locator('#painting-snow-intensity').dispatchEvent('change');
    await page.locator('#painting-curve').fill('0.5');
    await page.locator('#painting-curve').dispatchEvent('change');
    await page.locator('#painting-edges').selectOption('legacy');
    await page.locator('#undo').click();await expect(page.locator('#painting-edges')).toHaveValue('masks');
    await page.locator('#redo').click();await expect(page.locator('#painting-edges')).toHaveValue('legacy');
    await page.locator('#painting-edges').selectOption('masks');
    await page.locator('#painting-edit-masks').click();
    await page.locator('#mask-choice').selectOption('12');
    await page.locator('#mask-wave').click();
    const editorBox=(await page.locator('#mask-editor-canvas').boundingBox())!;
    const point=(x:number,y:number)=>({x:editorBox.x+(24+x*432)*editorBox.width/480,y:editorBox.y+(24+y*432)*editorBox.height/480});
    const from=point(.2,.33),to=point(.25,.7);
    await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y);await page.mouse.up();
    await page.locator('#mask-apply').click();
    await expect(page.locator('#mask-edit-status')).toContainText('salvata');
    await page.locator('#mask-choice').selectOption('10');
    await page.locator('#mask-angular').click();
    await page.locator('#mask-contour').selectOption('1');await page.locator('#mask-wave').click();
    await page.locator('#mask-smooth').uncheck();await page.locator('#mask-apply').click();
    await mkdir(join(root,'artifacts'),{recursive:true});
    await page.screenshot({path:join(root,'artifacts/world-painting-mask-editor.png')});
    await page.locator('#mask-choice').selectOption('12');await page.locator('#mask-reset').click();
    await page.locator('#mask-close').click();await page.locator('#undo').click();
    await page.locator('#show-grid').uncheck();
    await mkdir(join(root,'artifacts'),{recursive:true});
    await page.screenshot({path:join(root,'artifacts/world-painting.png')});
    await page.locator('#apply-world').click();await expect(page.locator('#status')).toContainText('Progetto applicato');
    const saved = JSON.parse(await readFile(options.documentPath,'utf8'));
    assert.equal(saved.painting.materials.grass.color,'#aabb66');assert.equal(saved.painting.materials.water.size,1.5);
    assert.equal(saved.painting.materials.snow.intensity,0);assert.equal(saved.painting.curve,.5);assert.equal(saved.painting.edges,'masks');
    assert.equal(saved.painting.maskShapes[12].curves[0].length,4);
    assert.ok(Math.abs(saved.painting.maskShapes[12].curves[0][0].x-.25)<.01);
    assert.ok(Math.abs(saved.painting.maskShapes[12].curves[0][0].y-.7)<.01);
    assert.equal(saved.painting.maskShapes[10].smooth,false);
    assert.deepEqual(saved.painting.maskShapes[10].curves.map((c:unknown[])=>c.length),[4,4]);
    const download = page.waitForEvent('download');await page.locator('#export-world').click();
    const archive = join(directory,'painting.project.json');await (await download).saveAs(archive);
    assert.deepEqual(JSON.parse(await readFile(archive,'utf8')).document.painting,saved.painting);
    await page.locator('#painting-reset').click();await expect(page.locator('#painting-grass-color')).toHaveValue('#91ad69');
    await page.locator('#world-file').setInputFiles(archive);await expect(page.locator('#status')).toContainText('Progetto importato');
    await expect(page.locator('#painting-grass-color')).toHaveValue('#aabb66');
    await page.reload();await expect(page.locator('#status')).toContainText('World Studio pronto');
    await expect(page.locator('#painting-grass-color')).toHaveValue('#aabb66');
    await expect(page.locator('#painting-water-size')).toHaveValue('1.5');
    await page.locator('.palette-navigation button').filter({hasText:'Painting'}).click();
    await page.locator('#painting-edit-masks').click();await page.locator('#mask-choice').selectOption('10');
    await expect(page.locator('#mask-smooth')).not.toBeChecked();await expect(page.locator('#mask-contour option')).toHaveCount(2);
    await page.locator('#mask-close').click();
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();await studio.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\'));
    await rm(directory,{recursive:true,force:true});
  }
});
