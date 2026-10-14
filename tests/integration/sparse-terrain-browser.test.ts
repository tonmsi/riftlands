import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('sparse terrain preview shows open land and plant-free ice contacts', { timeout: 60000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 960, height: 672 } });
    await page.addInitScript('window.__name = (value) => value');
    await page.route('**/sparse-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas width="960" height="672"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}sparse-review`);
    const result = await page.evaluate(async () => {
      const { TerrainRenderer } = await import('/client/render/terrain-renderer.ts' as string);
      const { SurfaceTerrain } = await import('/client/render/surface-terrain.ts' as string);
      const { TerrainMaterials } = await import('/client/render/terrain-materials.ts' as string);
      const { EnvironmentArt } = await import('/client/render/environment-art.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const doc = newWorldDocument(); doc.interiorBounds = { width: 20, height: 14, name: 'Sparse terrain', pvp: false };
      for (let y = 0; y < 14; y++) for (let x = 0; x < 20; x++) {
        const terrain = x >= 14 ? (y < 5 || (x >= 17 && y < 8) ? 'ice' : 'water') : x >= 12 ? 'water' : y === 7 || y === 8 ? 'path' : 'grass';
        doc.tiles.push({ x, y, terrain });
      }
      const world = new World(23, 16, 'world', doc, []);
      const ctx = document.querySelector('canvas')!.getContext('2d')!;
      const renderer = new TerrainRenderer(ctx); await renderer.spritesReady;
      renderer.drawEditorTerrain(world, 1000, ctx, { left: 0, top: 0, right: 960, bottom: 672 });
      const first = ctx.canvas.toDataURL();
      renderer.drawEditorTerrain(world, 1000, ctx, { left: 0, top: 0, right: 960, bottom: 672 });
      const surfaces = new SurfaceTerrain(new TerrainMaterials(), new EnvironmentArt());
      return { stable: first === ctx.canvas.toDataURL(), frozenPlants: surfaces.waterPlantsMask(world, 14, 5, 255), warmPlants: surfaces.waterPlantsMask(world, 12, 10, 255) };
    });
    assert.equal(result.stable, true); assert.equal(result.frozenPlants, 0); assert.equal(result.warmPlants, 255);
    mkdirSync('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/sparse-terrain-review.png' });
  } finally { await browser?.close(); await server.close(); }
});
