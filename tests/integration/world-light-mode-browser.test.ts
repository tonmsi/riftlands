import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldDocument, newWorldAsset, parseWorldDocument } from '../../shared/world-schema';
import { defaultWorldPainting } from '../../shared/world-painting';

test('light mode is an editor preference; export and apply preserve game effects', { timeout: 90_000 }, async () => {
  const fixture = newWorldDocument(42);
  fixture.spawn = { x: 4, y: 4 };
  fixture.painting = { ...defaultWorldPainting(), seaEnabled: true, masksEnabled: true };
  const bush = newWorldAsset('bush', 'Cespuglio', '/world-assets/bush.png');
  bush.cells[0].visibility = 'hide-fade'; fixture.assets.push(bush);
  fixture.placements.push({ id: 'bush-1', assetId: bush.id, x: 2, y: 2 });
  for (let y = -10; y < 10; y++) for (let x = -10; x < 10; x++) fixture.tiles.push({ x, y, terrain: x < 0 ? 'water' : 'grass', suppressAssets: true });
  const directory = await mkdtemp(join(tmpdir(), 'riftlands-light-mode-'));
  const documentPath = join(directory, 'world.json');
  await writeFile(documentPath, JSON.stringify(fixture));
  await writeFile(join(directory, 'dungeons.json'), '[]');
  const studio = await startWorldStudio({ root: resolve('.'), documentPath, dungeonPath: join(directory, 'dungeons.json'), dataPath: join(directory, 'accounts.json'), port: 0 });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(studio.url);
    await expect(page.locator('#status')).toContainText('World Studio pronto');
    const exported = async () => {
      const downloading = page.waitForEvent('download'); await page.locator('#export-world').click();
      await (await downloading).saveAs(join(directory, 'export.json'));
      return parseWorldDocument(JSON.parse(await readFile(join(directory, 'export.json'), 'utf8')).document);
    };
    const original = await exported();
    await expect(page.locator('header #light-mode')).toBeVisible();
    await expect(page.locator('#light-mode')).not.toBeChecked();
    await page.locator('#light-mode').check();
    await expect.poll(() => page.locator('#map').evaluate((c: HTMLCanvasElement) => c.width / c.getBoundingClientRect().width)).toBeCloseTo(1, 1);
    assert.deepEqual(await exported(), original, 'toggling preview must not mutate any project fields');
    await page.locator('#apply-world').click();
    await expect(page.locator('#status')).toContainText('Progetto salvato con backup');
    const installed = parseWorldDocument(JSON.parse(await readFile(documentPath, 'utf8')));
    assert.deepEqual(installed.painting, original.painting);
    assert.equal(installed.painting!.seaEnabled, true);
    assert.equal(installed.painting!.masksEnabled, true);
    assert.equal('lightMode' in installed, false);
    await page.reload();
    await expect(page.locator('#status')).toContainText('World Studio pronto');
    await expect(page.locator('#light-mode')).toBeChecked();
    await page.locator('#light-mode').uncheck();
    await expect.poll(() => page.locator('#map').evaluate((c: HTMLCanvasElement) => c.width / c.getBoundingClientRect().width)).toBeCloseTo(2, 1);
    assert.deepEqual((await exported()).painting, original.painting);

    const rendering = await page.evaluate(async () => {
      const { drawWorldEditorMap } = await import('/client/editors/world/world-editor-canvas.ts' as string);
      const { WorldLightArt } = await import('/client/editors/world/world-light-art.ts' as string);
      const { TerrainRenderer } = await import('/client/render/terrain-renderer.ts' as string);
      const { WorldAssetArt } = await import('/client/render/world-asset-art.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument, newWorldAsset } = await import('/shared/world-schema.ts' as string);
      const { defaultWorldPainting } = await import('/shared/world-painting.ts' as string);
      const doc = newWorldDocument(42);
      doc.painting = { ...defaultWorldPainting(), seaEnabled: true, masksEnabled: true };
      const tree = newWorldAsset('tree', 'Tree', '/world-assets/bush.png');
      tree.width = tree.height = tree.columns = tree.rows = 4;
      tree.cells = Array.from({ length: 16 }, () => ({ blocked: false, visibility: 'hide-fade' }));
      tree.shadow = { kind: 'ellipse', skew: 0, x: .5, y: .9, width: 1, height: .3, opacity: .5, softness: .5 };
      const fire = newWorldAsset('fire', 'Fire', '/world-assets/bush.png'); fire.visual = { kind: 'fire', style: 'campfire' };
      doc.assets.push(tree, fire);
      doc.placements.push({ id: 'tree-1', assetId: tree.id, x: 0, y: 0, baseElevation: 0 }, { id: 'fire-1', assetId: fire.id, x: 5, y: 0, baseElevation: 0 });
      for (let y = -12; y < 12; y++) for (let x = -12; x < 12; x++) doc.tiles.push({ x, y, terrain: x < 0 ? 'water' : 'grass', suppressAssets: true });
      const world = new World(42, 16, 'world', doc, []), art = new WorldAssetArt();
      await art.ready(tree);
      const thumbnail = new WorldLightArt(art).image(tree)!;
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:240px'; document.body.append(canvas);
      const options = { lightMode: true, painting: true, grid: false, cells: false, zones: false, npcs: false, selected: null, gesture: null, pointerTile: null, tool: 'select' };
      const counts = { terrain: 0, sea: 0, detailedAssets: 0, lightAssets: 0, shadows: 0 };
      const terrain = TerrainRenderer.prototype.drawTerrain, sea = TerrainRenderer.prototype.drawCoastMotion;
      const draw = WorldAssetArt.prototype.draw, lightDraw = WorldLightArt.prototype.draw, image = art.image;
      TerrainRenderer.prototype.drawTerrain = function (...args: any[]) { counts.terrain++; return terrain.apply(this, args); };
      TerrainRenderer.prototype.drawCoastMotion = function (...args: any[]) { counts.sea++; return sea.apply(this, args); };
      WorldAssetArt.prototype.draw = function (...args: any[]) { counts.detailedAssets++; return draw.apply(this, args); };
      WorldLightArt.prototype.draw = function (...args: any[]) { counts.lightAssets++; return lightDraw.apply(this, args); };
      art.image = function (a: any, shadow = true) { if (shadow) counts.shadows++; return image.call(this, a, shadow); };
      try {
        const view = { x: 96, y: 96, scale: 24 };
        const animated = drawWorldEditorMap(canvas, world, doc, view, art, options);
        const first = { ...counts };
        drawWorldEditorMap(canvas, world, doc, view, art, options);
        const cached = { ...counts };
        drawWorldEditorMap(canvas, world, doc, { ...view, scale: 2 }, art, options);
        const distant = { ...counts };
        drawWorldEditorMap(canvas, world, doc, view, art, { ...options, lightMode: false });
        return { animated, first, cached, distant, normal: { ...counts }, width: thumbnail.width, height: thumbnail.height };
      } finally {
        TerrainRenderer.prototype.drawTerrain = terrain; TerrainRenderer.prototype.drawCoastMotion = sea;
        WorldAssetArt.prototype.draw = draw; WorldLightArt.prototype.draw = lightDraw; art.image = image; canvas.remove();
      }
    });
    assert.equal(rendering.animated, false);
    assert.deepEqual(rendering.first, { terrain: 0, sea: 0, detailedAssets: 0, lightAssets: 2, shadows: 0 });
    assert.deepEqual(rendering.cached, rendering.first, 'static lightweight assets must be cached');
    assert.equal(rendering.distant.detailedAssets, 0);
    assert.ok(rendering.normal.terrain > 0 && rendering.normal.sea > 0 && rendering.normal.detailedAssets > 0, JSON.stringify(rendering));
    assert.ok(rendering.width <= 64 && rendering.height <= 64);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await studio.close(); await rm(directory, { recursive: true, force: true });
  }
});
