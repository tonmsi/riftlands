import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('terrain renders all shoreline masks and a natural landscape at fractional zoom', { timeout: 60000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // A blank same-origin document loads just the production drawing modules.
    await page.route('**/terrain-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas id="review" style="width:1200px;height:900px"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}terrain-review`);
    const result = await page.evaluate(async () => {
      const { EnvironmentArt } = await import('/client/environment-art.ts' as string);
      const { TERRAIN } = await import('/client/terrain-style.ts' as string);
      const canvas = document.querySelector('canvas')!;
      canvas.width = 1200; canvas.height = 900;
      const ctx = canvas.getContext('2d')!, art = new EnvironmentArt();
      ctx.fillStyle = TERRAIN.grass; ctx.fillRect(0, 0, 1200, 900);
      for (let mask = 0; mask < 256; mask++) {
        const x = (mask % 16) * 56 + 8, y = Math.floor(mask / 16) * 56 + 8;
        art.draw(ctx, 'water', x, y, 0.5, mask);
      }
      return {
        openCorner: [...ctx.getImageData(8, 8, 1, 1).data],
        isolatedCorner: [...ctx.getImageData(15 * 56 + 8, 15 * 56 + 8, 1, 1).data],
        isolatedCenter: [...ctx.getImageData(15 * 56 + 32, 15 * 56 + 32, 1, 1).data],
      };
    });
    assert.deepEqual(result.openCorner, result.isolatedCenter, 'water interiors remain connected');
    assert.notDeepEqual(result.isolatedCorner, result.isolatedCenter, 'exposed corners are cut into curved banks');
    mkdirSync('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/shoreline-masks.png' });
    await page.evaluate(async () => {
      const { Renderer } = await import('/client/render.ts' as string);
      const renderer = new Renderer(document.querySelector('canvas'));
      await renderer.spritesReady;
      renderer.destroy();
      const ctx = renderer.ctx;
      ctx.setTransform(.95, 0, 0, .95, -2500.25, -2700.75);
      renderer.bounds = { left: 2500 / .95, top: 2700 / .95, right: 3700 / .95, bottom: 3600 / .95 };
      renderer.drawTerrain(1200);
    });
    await page.screenshot({ path: 'artifacts/world-terrain.png' });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});
