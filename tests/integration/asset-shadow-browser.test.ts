import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldDocument, newWorldAsset, parseWorldDocument } from '../../shared/world-schema';

test('expanded asset editor persists shadows and downloads a transparent PNG; renderer caches and fades them', { timeout: 90_000 }, async () => {
  const doc = newWorldDocument(); doc.assets.push(newWorldAsset('prop', 'Oggetto prova', '/world-assets/shadow-test.svg'));
  for (const id of ['variant', 'sibling']) {
    const a = newWorldAsset(id, id, `/world-assets/${id}.svg`); a.variantOf = 'prop'; doc.assets.push(a);
  }
  const directory = await mkdtemp(join(tmpdir(), 'riftlands-shadow-'));
  await writeFile(join(directory, 'world.json'), JSON.stringify(doc)); await writeFile(join(directory, 'dungeons.json'), '[]');
  const studio = await startWorldStudio({ root: resolve('.'), documentPath: join(directory, 'world.json'), dungeonPath: join(directory, 'dungeons.json'), dataPath: join(directory, 'accounts.json'), port: 0 });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript('window.__name = value => value');
    await page.route('**/world-assets/shadow-test.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="40" y="10" width="20" height="80" fill="#cc4422"/></svg>' }));
    await page.route(/\/world-assets\/(variant|sibling)\.svg$/, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="15" fill="green"/></svg>' }));
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await page.locator('#asset-list [data-asset="prop"]').click();
    await page.locator('#asset-expand').click();
    await expect(page.locator('#asset-preview-dialog')).toBeVisible();
    await expect(page.locator('#asset-shadow-kind')).toHaveValue('silhouette');
    await page.locator('#asset-shadow-kind').selectOption('ellipse');
    await page.locator('#asset-shadow-enabled').check();
    await page.locator('#asset-shadow-opacity').fill('60');
    await page.locator('#asset-shadow-update').click();
    await expect(page.locator('#asset-shadow-opacity')).toHaveValue('60');
    const downloading = page.waitForEvent('download'); await page.locator('#asset-shadow-png').click();
    const png = await downloading; assert.equal(png.suggestedFilename(), 'prop-ombra.png');
    await png.saveAs(join(directory, 'shadow.png'));
    assert.deepEqual([...(await readFile(join(directory, 'shadow.png'))).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    await page.screenshot({ path: resolve('test-results/asset-shadow-editor.png') });
    await page.locator('#asset-preview-close').click();
    await page.locator('#undo').click(); await expect(page.locator('#asset-shadow-enabled')).not.toBeChecked();
    await page.locator('#redo').click(); await expect(page.locator('#asset-shadow-enabled')).toBeChecked();
    const exporting = page.waitForEvent('download'); await page.locator('#export-world').click();
    await (await exporting).saveAs(join(directory, 'export.json'));
    const saved = parseWorldDocument(JSON.parse(await readFile(join(directory, 'export.json'), 'utf8')).document);
    assert.equal(saved.assets[0].shadow?.opacity, .6);
    // Group members inherit live settings, while an edit affects only the selected artwork.
    await page.locator('#asset-list [data-asset="variant"]').click();
    await page.locator('#asset-expand').click();
    await expect(page.locator('#asset-shadow-inherit')).toBeChecked();
    await expect(page.locator('#asset-shadow-opacity')).toHaveValue('60');
    const inheritedPng = page.waitForEvent('download'); await page.locator('#asset-shadow-png').click();
    assert.equal((await inheritedPng).suggestedFilename(), 'variant-ombra.png');
    await page.locator('#asset-shadow-opacity').fill('30');
    await page.locator('#asset-shadow-update').click();
    await expect(page.locator('#asset-shadow-inherit')).not.toBeChecked();
    await expect(page.locator('#asset-shadow-opacity')).toHaveValue('30');
    await page.locator('#asset-preview-close').click();
    await page.locator('#asset-list [data-asset="prop"]').click();
    await expect(page.locator('#asset-shadow-opacity')).toHaveValue('60');
    await page.locator('#asset-shadow-opacity').fill('80'); await page.locator('#asset-shadow-update').click();
    await page.locator('#asset-list [data-asset="sibling"]').click();
    await expect(page.locator('#asset-shadow-opacity')).toHaveValue('80');
    await page.locator('#asset-shadow-enabled').uncheck(); await page.locator('#asset-shadow-update').click();
    await expect(page.locator('#asset-shadow-enabled')).not.toBeChecked();
    await page.locator('#asset-list [data-asset="variant"]').click();
    await expect(page.locator('#asset-shadow-opacity')).toHaveValue('30');
    const groupExporting = page.waitForEvent('download'); await page.locator('#export-world').click();
    await (await groupExporting).saveAs(join(directory, 'group.json'));
    const grouped = parseWorldDocument(JSON.parse(await readFile(join(directory, 'group.json'), 'utf8')).document);
    assert.equal(grouped.assets.find(a => a.id === 'prop')!.shadow?.opacity, .8);
    assert.equal(grouped.assets.find(a => a.id === 'variant')!.shadow?.opacity, .3);
    assert.equal(grouped.assets.find(a => a.id === 'sibling')!.shadow, null);
    await expect.poll(() => page.evaluate(async () => {
      const { loadWorldCheckpoint } = await import('/client/editors/world/world-editor-storage.ts' as string);
      const checkpoint = await loadWorldCheckpoint();
      return checkpoint?.document.assets.find((a: { id: string }) => a.id === 'variant')?.shadow?.opacity;
    })).toBe(.3);
    await page.reload(); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await page.locator('#recover-world-draft').click();
    await expect(page.locator('#status')).toContainText('Bozza precedente ripristinata');
    await page.locator('#asset-list [data-asset="variant"]').click();
    await expect(page.locator('#asset-shadow-opacity')).toHaveValue('30');
    await page.locator('#asset-expand').click();
    await page.locator('#asset-shadow-inherit').check(); await page.locator('#asset-shadow-update').click();
    await expect(page.locator('#asset-shadow-opacity')).toHaveValue('80');
    await expect(page.locator('#asset-shadow-inherit')).toBeChecked();
    await page.locator('#asset-preview-close').click();
    await page.locator('#asset-list [data-asset="sibling"]').click();
    await expect(page.locator('#asset-shadow-enabled')).not.toBeChecked();
    const result = await page.evaluate(async () => {
      const { WorldAssetArt } = await import('/client/render/world-asset-art.ts' as string);
      const { newWorldAsset, DEFAULT_ASSET_SHADOW } = await import('/shared/world-schema.ts' as string);
      const a = newWorldAsset('prop', 'Prova', '/world-assets/shadow-test.svg'), art = new WorldAssetArt();
      a.shadow = { ...DEFAULT_ASSET_SHADOW, kind: 'ellipse', y: .88, height: .16, opacity: .6 }; await art.ready(a);
      const image = art.image(a)!, raw = art.image(a, false)!;
      const pixel = image.getContext('2d')!.getImageData(Math.floor(image.width * .5), Math.floor(image.height * .3), 1, 1).data;
      if (pixel[0] !== 204 || pixel[1] !== 68 || pixel[2] !== 34 || pixel[3] !== 255) throw new Error('Shadow composition changed the original artwork');
      const alpha = (c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(Math.floor(c.width * .3), Math.floor(c.height * .88), 1, 1).data[3];
      const cached = image === art.image(a), hit = art.hit(a, { x: 0, y: 0 }, .3, .88);
      a.cells[0].visibility = 'fade'; a.fade = { opacity: .2, feather: 0, durationMs: 0 };
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
      const ctx = canvas.getContext('2d')!, p = { id: 'p', assetId: a.id, x: 0, y: 0 };
      art.draw(ctx, a, p, 1, 96, 0, 1); const faded = alpha(canvas);
      a.shadow.opacity = .2; ctx.clearRect(0, 0, 96, 96); art.draw(ctx, a, p, 1, 96, 0, 1);
      const changedFade = alpha(canvas), changedImage = image !== art.image(a);
      const { rasterizeAssetShadow } = await import('/client/render/world-asset-shadow.ts' as string);
      // Two separate feet must remain separate in a projected silhouette, unlike an ellipse.
      const feet = document.createElement('canvas'); feet.width = feet.height = 100;
      const paint = feet.getContext('2d')!; paint.fillRect(20, 0, 10, 100); paint.fillRect(70, 0, 10, 100);
      const settings = { ...DEFAULT_ASSET_SHADOW, x: .5, y: .9, width: 1, height: .3, softness: 0, skew: 0, opacity: .6 };
      const silhouette = rasterizeAssetShadow(100, 100, settings, feet);
      const sample = (c: HTMLCanvasElement, x: number, y: number) => c.getContext('2d')!.getImageData(x, y, 1, 1).data[3];
      const slanted = rasterizeAssetShadow(100, 100, { ...settings, skew: .2 }, feet);
      const silhouetteAsset = art.image({ ...a, shadow: settings })!;
      const originalPixel = silhouetteAsset.getContext('2d')!.getImageData(Math.floor(silhouetteAsset.width * .5), Math.floor(silhouetteAsset.height * .3), 1, 1).data;
      if (originalPixel[0] !== 204 || originalPixel[3] !== 255) throw new Error('Silhouette composition changed the original artwork');
      return { cached, hit, raw: alpha(raw), shadow: alpha(image), faded, changedFade, changedImage,
        feet: [sample(silhouette, 25, 65), sample(silhouette, 50, 65), sample(silhouette, 75, 65)],
        slanted: [sample(slanted, 25, 65), sample(slanted, 42, 65)] };
    });
    assert.equal(result.cached, true); assert.equal(result.hit, false); assert.equal(result.raw, 0);
    assert.ok(result.shadow > 30); assert.ok(result.faded > 0 && result.faded < result.shadow);
    assert.ok(result.changedFade < result.faded); assert.equal(result.changedImage, true);
    assert.deepEqual(result.feet, [153, 0, 153]); assert.deepEqual(result.slanted, [0, 153]);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await studio.close(); await rm(directory, { recursive: true, force: true }); }
});
