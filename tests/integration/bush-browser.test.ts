import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldDocument, newWorldAsset, parseWorldDocument } from '../../shared/world-schema';
import { WorldTiles } from '../../shared/world-tiles';

test('grass brush keeps PNG and JS bushes through undo, export and reload; legacy terrain uses PNG', { timeout: 90_000 }, async () => {
  const fixture = newWorldDocument(42), bush = newWorldAsset('bush', 'Cespuglio', '/world-assets/bush.png');
  bush.generation = { ...bush.generation, enabled: true, density: 1, spacing: 0 };
  bush.cells[0].visibility = 'hide-fade'; fixture.assets.push(bush);
  fixture.zones.push({ id: 'climate', name: 'Clima', priority: 1, shape: { kind: 'rect', x: -20, y: -20, width: 40, height: 40 }, temperature: .6, moisture: .8 });
  for (let y = -20; y <= 20; y++) for (let x = -20; x <= 20; x++) fixture.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  const directory = await mkdtemp(join(tmpdir(), 'riftlands-bush-'));
  await writeFile(join(directory, 'world.json'), JSON.stringify(fixture)); await writeFile(join(directory, 'dungeons.json'), '[]');
  const studio = await startWorldStudio({ root: resolve('.'), documentPath: join(directory, 'world.json'), dungeonPath: join(directory, 'dungeons.json'), dataPath: join(directory, 'accounts.json'), port: 0 });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message)); await page.addInitScript('window.__name = value => value');
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await page.locator('[data-tool="terrain"]').click(); await page.locator('#terrain').selectOption('grass');
    await page.locator('#brush-radius').fill('0'); await expect(page.locator('#bush-js')).not.toBeChecked();
    const box = (await page.locator('#map').boundingBox())!;
    const paint = async (x: number, y: number) => { await page.mouse.click(box.x + box.width / 2 + (x + .5) * 24, box.y + box.height / 2 + (y + .5) * 24); };
    const exported = async () => {
      const download = page.waitForEvent('download'); await page.locator('#export-world').click();
      await (await download).saveAs(join(directory, 'export.json'));
      return parseWorldDocument(JSON.parse(await readFile(join(directory, 'export.json'), 'utf8')).document);
    };
    await paint(3, 3); await page.locator('#bush-js').check(); await paint(6, 3);
    let tiles = new WorldTiles(await exported());
    assert.equal(tiles.at(3, 3)?.bushStyle, 'png'); assert.equal(tiles.at(6, 3)?.bushStyle, 'js');
    await page.locator('#undo').click(); tiles = new WorldTiles(await exported()); assert.equal(tiles.at(6, 3)?.bushStyle, undefined);
    await page.locator('#redo').click(); tiles = new WorldTiles(await exported()); assert.equal(tiles.at(6, 3)?.bushStyle, 'js');
    await expect.poll(() => page.evaluate(async () => {
      const { loadWorldCheckpoint } = await import('/client/editors/world/world-editor-storage.ts' as string);
      const { WorldTiles } = await import('/shared/world-tiles.ts' as string);
      const saved = await loadWorldCheckpoint(); return saved ? new WorldTiles(saved.document).at(6, 3)?.bushStyle : undefined;
    })).toBe('js');
    await page.reload(); await expect(page.locator('#status')).toContainText('Bozza locale recuperata');
    tiles = new WorldTiles(await exported()); assert.equal(tiles.at(3, 3)?.bushStyle, 'png'); assert.equal(tiles.at(6, 3)?.bushStyle, 'js');
    const pixels = await page.evaluate(async () => {
      const { TerrainRenderer } = await import('/client/render/terrain-renderer.ts' as string);
      const { WorldAssetArt } = await import('/client/render/world-asset-art.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const { terrainBushAsset } = await import('/shared/bush.ts' as string);
      const makeCanvas = () => { const c = document.createElement('canvas'); c.width = c.height = 192; return c; };
      const canvas = makeCanvas(), ctx = canvas.getContext('2d', { willReadFrequently: true })!, renderer = new TerrainRenderer(ctx);
      await renderer.spritesReady;
      const draft = newWorldDocument(42);
      for (let y = -8; y < 8; y++) for (let x = -8; x < 8; x++) draft.tiles.push({ x, y, terrain: x === 0 && y === 0 ? 'bush' : 'grass', suppressAssets: true });
      const tile = draft.tiles.find((t: any) => t.x === 0 && t.y === 0)!;
      const draw = () => { ctx.clearRect(0, 0, 192, 192); ctx.setTransform(1, 0, 0, 1, 72, 72); renderer.drawTerrain(new World(42, 16, 'world', draft, []), 0, ctx, { left: -72, top: -72, right: 120, bottom: 120 }); return new Uint8ClampedArray(ctx.getImageData(0, 0, 192, 192).data); };
      const legacy = draw(), art = new WorldAssetArt(); await art.ready(terrainBushAsset);
      const reference = makeCanvas(), paint = reference.getContext('2d')!; paint.translate(72, 72);
      const placement = { id: 'bush', assetId: terrainBushAsset.id, x: 0, y: 0 };
      art.draw(paint, terrainBushAsset, placement);
      const expected = paint.getImageData(0, 0, 192, 192).data; let opaque = 0, matching = 0;
      for (let i = 0; i < expected.length; i += 4) if (expected[i + 3] >= 220) {
        const tolerance = 257 - expected[i + 3];
        opaque++; if ([0, 1, 2].every(c => Math.abs(expected[i + c] - legacy[i + c]) <= tolerance)) matching++;
      }
      tile.bushStyle = 'js'; const js = draw();
      let changed = 0; for (let i = 0; i < js.length; i += 4) if (js[i] !== legacy[i] || js[i + 1] !== legacy[i + 1]) changed++;
      // The generated JS route also goes through asset masks and private hiding fades.
      terrainBushAsset.cells[0].visibility = 'hide-fade'; terrainBushAsset.fade = { opacity: .28, feather: 0, durationMs: 0 };
      const jsPlacement = { ...placement, bushJs: true };
      paint.setTransform(1, 0, 0, 1, 72, 72); paint.clearRect(-72, -72, 192, 192); art.draw(paint, terrainBushAsset, jsPlacement);
      const alpha = () => { const data = paint.getImageData(0, 0, 192, 192).data; let sum = 0; for (let i = 3; i < data.length; i += 4) sum += data[i]; return sum; };
      const full = alpha(); paint.clearRect(-72, -72, 192, 192); art.draw(paint, terrainBushAsset, jsPlacement, 1, 48, 0, 0, 1); const faded = alpha();
      renderer.dispose(); return { opaque, matching, changed, full, faded };
    });
    assert.ok(pixels.opaque > 50, JSON.stringify(pixels)); assert.equal(pixels.matching, pixels.opaque, 'legacy terrain must draw the PNG without recoloring it');
    assert.ok(pixels.changed > 100); assert.ok(pixels.full > 0 && pixels.faded < pixels.full * .8);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await studio.close(); await rm(directory, { recursive: true, force: true }); }
});
