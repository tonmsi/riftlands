import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldDocument } from '../../shared/world-schema';

test('maker synchronizes nested folders without duplicates and serves their images', {timeout:60_000}, async()=>{
  const root=await mkdtemp(join(tmpdir(),'riftlands-folder-browser-'));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let studio: Awaited<ReturnType<typeof startWorldStudio>> | undefined;
  try {
    await Promise.all(['client','shared'].map(name=>cp(resolve(name),join(root,name),{recursive:true})));
    await cp(resolve('world-maker.html'),join(root,'world-maker.html'));
    const folder=join(root,'public','world-assets','Muri','Pietra');await mkdir(folder,{recursive:true});
    await writeFile(join(folder,'muro chiaro.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="gray"/></svg>');
    const documentPath=join(root,'world.json'),dungeonPath=join(root,'dungeons.json');
    await writeFile(documentPath,JSON.stringify(newWorldDocument()));await writeFile(dungeonPath,'[]');
    studio=await startWorldStudio({root,documentPath,dungeonPath,dataPath:join(root,'accounts.json'),port:0});
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(studio.url);await expect(page.locator('#status')).toContainText('World Studio pronto');
    await page.locator('#sync-asset-folders').click();await expect(page.locator('#status')).toContainText('Aggiunti 1 asset');
    await expect(page.locator('#asset-list [data-group="Muri / Pietra"]')).toBeVisible();
    await expect(page.locator('#asset-list [data-asset]')).toHaveCount(1);
    const response=await page.request.get(new URL('/world-assets/Muri/Pietra/muro%20chiaro.svg',studio.url).href);assert.equal(response.status(),200);
    await page.locator('#sync-asset-folders').click();await expect(page.locator('#status')).toContainText('Nessuna nuova immagine');
    await expect(page.locator('#asset-list [data-asset]')).toHaveCount(1);assert.deepEqual(errors,[]);
  } finally {await browser?.close();await studio?.close();await rm(root,{recursive:true,force:true});}
});
