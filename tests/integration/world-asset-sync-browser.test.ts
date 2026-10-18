import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldAsset, newWorldDocument } from '../../shared/world-schema';

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
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('applicato');
    const before = JSON.parse(await readFile(documentPath, 'utf8'));
    const moved = join(root, 'public/world-assets/Cartella nuova'); await mkdir(moved);
    await rename(join(folder, 'muro chiaro.svg'), join(moved, 'muro chiaro.svg'));
    await page.reload(); await expect(page.locator('#status')).toContainText('Riparati automaticamente 1 percorsi');
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('applicato');
    const after = JSON.parse(await readFile(documentPath, 'utf8'));
    assert.equal(after.assets[0].id, before.assets[0].id);
    assert.equal(decodeURIComponent(after.assets[0].image), '/world-assets/Cartella nuova/muro chiaro.svg');
    // Imported archives may contain several different images with the same basename.
    const svg = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="${color}"/></svg>`;
    await writeFile(join(root, 'public/world-assets/collision.svg'), svg('red'));
    const imported = newWorldDocument();
    const first = newWorldAsset('original-id', 'Prima immagine', '/world-assets/old/collision.svg'); first.cells[0].visibility = 'hide-fade';
    const second = newWorldAsset('second-id', 'Seconda immagine', '/world-assets/other/collision.svg');
    imported.assets.push(first, second);
    imported.placements.push({ id: 'placed', assetId: first.id, x: 4, y: 4 });
    const payload = { format: 'riftlands-world-project', document: imported, images: {
      [first.image]: `data:image/svg+xml;base64,${Buffer.from(svg('blue')).toString('base64')}`,
      [second.image]: `data:image/svg+xml;base64,${Buffer.from(svg('green')).toString('base64')}`,
    } };
    await page.locator('#world-file').setInputFiles({ name: 'conflicting-world.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
    await expect(page.locator('#status')).toContainText('Progetto importato');
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('applicato');
    const restored = JSON.parse(await readFile(documentPath, 'utf8'));
    assert.equal(restored.assets[0].id, first.id); assert.equal(restored.assets[0].cells[0].visibility, 'hide-fade');
    assert.equal(restored.placements[0].assetId, first.id);
    assert.notEqual(restored.assets[0].image, restored.assets[1].image);
    assert.equal(await readFile(join(root, 'public/world-assets/collision.svg'), 'utf8'), svg('red'));
    assert.equal(await readFile(join(root, 'public', restored.assets[0].image.slice(1)), 'utf8'), svg('blue'));
    assert.equal(await readFile(join(root, 'public', restored.assets[1].image.slice(1)), 'utf8'), svg('green'));
    assert.deepEqual(errors, []);
  } finally {await browser?.close();await studio?.close();await rm(root,{recursive:true,force:true});}
});
