import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldDocument, newWorldAsset } from '../../shared/world-schema';

test('marquee selects objects across floors, moves and deletes a group, and lowers high terrain', { timeout: 90_000 }, async () => {
  const fixture = newWorldDocument(1);
  for (let y = -20; y <= 20; y++) for (let x = -20; x <= 20; x++) fixture.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  fixture.assets.push(newWorldAsset('stone', 'Pietra', '/world-assets/marquee.svg'));
  fixture.placements.push({ id: 'a', assetId: 'stone', x: 3, y: 3 }, { id: 'b', assetId: 'stone', x: 5, y: 3, baseElevation: 2 });
  fixture.npcs.push({ id: 'npc', npcKind: 'slime', x: 4, y: 5, level: 1 });
  fixture.zones.push({ id: 'zone', name: 'Zona', priority: 1, shape: { kind: 'rect', x: 2, y: 2, width: 11, height: 5 } });
  fixture.geometry = { surfaces: [{ id: 'high', x: 9, y: 3, width: 3, height: 3, ground: true, terrain: 'grass', elevation: 2 }],
    solids: [{ id: 'high-mass', x: 9, y: 3, width: 3, height: 3, base: 0, top: 2 }],
    stairs: [{ id: 'manual-stair', x: 11, y: 4, width: 1, height: 3, from: 2, to: 0, axis: 'y', tiled: true }] };
  const directory = await mkdtemp(join(tmpdir(), 'riftlands-marquee-'));
  await writeFile(join(directory, 'world.json'), JSON.stringify(fixture));
  await writeFile(join(directory, 'dungeons.json'), '[]');
  const studio = await startWorldStudio({ root: resolve('.'), documentPath: join(directory, 'world.json'), dungeonPath: join(directory, 'dungeons.json'), dataPath: join(directory, 'accounts.json'), port: 0 });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/world-assets/marquee.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="brown"/></svg>' }));
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    const checkpoint = () => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('riftlands.world-maker.v1', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      return new Promise<any>((resolve, reject) => { const tx = db.transaction('drafts'), r = tx.objectStore('drafts').get('project'); tx.oncomplete = () => { db.close(); resolve(r.result); }; tx.onerror = () => reject(tx.error); });
    });
    const point = async (x: number, y: number) => { const b = (await page.locator('#map').boundingBox())!; return { x: b.x + b.width / 2 + x * 24, y: b.y + b.height / 2 + y * 24 }; };
    const drag = async (x: number, y: number, xx: number, yy: number) => {
      const a = await point(x, y), b = await point(xx, yy);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
    };
    await page.locator('#home').click();
    // Stairs remain directly selectable inside a zone and over a raised surface.
    const stairPoint = await point(11.5, 4.5); await page.mouse.click(stairPoint.x, stairPoint.y);
    await expect(page.locator('#elevation-inspector')).toBeVisible();
    await expect(page.locator('#elevation-shape')).toHaveValue('stairs|manual-stair');
    await expect(page.locator('#elevation-selection-summary')).toContainText('Scala 2 → 0');
    await page.locator('#elevation-delete').click();
    await expect.poll(async () => (await checkpoint())?.document.geometry.stairs.length).toBe(0);
    await page.locator('#undo').click();
    await expect.poll(async () => (await checkpoint()).document.geometry.stairs.length).toBe(1);
    await page.locator('[data-tool="select"]').click();
    await page.keyboard.down('Alt');await page.mouse.click(stairPoint.x, stairPoint.y);await page.keyboard.up('Alt');
    await expect(page.locator('#zone-inspector')).toBeVisible();
    // A zone outranks both the raised surface and its automatic exterior cliffs.
    for (const [x, y] of [[10.5, 4.5], [8.5, 4.5]]) {
      const p = await point(x, y); await page.mouse.click(p.x, p.y);
      await expect(page.locator('#zone-inspector')).toBeVisible();
      await expect(page.locator('[data-tool="select"]')).toHaveAttribute('aria-pressed', 'true');
    }
    await page.locator('#elevation-active').fill('2'); await page.locator('#elevation-active').dispatchEvent('change');
    await page.locator('#elevation-view').selectOption('active');
    const highPoint = await point(10.5, 4.5); await page.mouse.click(highPoint.x, highPoint.y);
    await expect(page.locator('#zone-inspector')).toBeVisible();
    await page.locator('#elevation-view').selectOption('all');
    const assetPoint = await point(3.5, 3.5); await page.mouse.click(assetPoint.x, assetPoint.y);
    await expect(page.locator('#selection-title')).toHaveText('Pietra');
    await page.locator('#home').click();
    await drag(2, 2, 7, 7);
    await expect(page.locator('#selection-title')).toHaveText('3 oggetti selezionati');
    await page.locator('#home').click();
    await drag(3.5, 3.5, 4.5, 4.5);
    await expect.poll(async () => (await checkpoint())?.document.placements.find((p: any) => p.id === 'a')?.x).toBe(4);
    const moved = (await checkpoint()).document;
    assert.equal(moved.placements.find((p: any) => p.id === 'b').x, 6);
    assert.equal(moved.npcs[0].x, 5); assert.equal(moved.zones[0].shape.x, 2);
    await page.locator('#selection-delete').click();
    await expect.poll(async () => (await checkpoint()).document.placements.length).toBe(0);
    assert.equal((await checkpoint()).document.npcs.length, 0);
    assert.equal((await checkpoint()).document.zones.length, 1);
    assert.equal((await checkpoint()).document.geometry.surfaces[0].elevation, 2);
    await page.locator('#undo').click();
    await expect.poll(async () => (await checkpoint()).document.placements.length).toBe(2);
    await page.locator('[data-tool="terrain"]').click();
    await page.locator('#terrain-elevation').fill('0');
    await page.locator('#brush-radius').fill('0');
    await page.locator('#home').click();
    const p = await point(10.5, 4.5); await page.mouse.click(p.x, p.y);
    await expect.poll(async () => (await checkpoint()).document.geometry.surfaces.some((s: any) => s.elevation === 0 && s.x === 10 && s.y === 4)).toBe(true);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await studio.close(); await rm(directory, { recursive: true, force: true }); }
});
