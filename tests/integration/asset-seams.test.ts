import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

test('asset masks and clips have no tile seams at fractional sizes and game zoom', { timeout: 30_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 650, height: 650 } });
    await page.addInitScript('window.__name = value => value');
    await page.route('**/seam-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#1f2924"></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}seam-review`);
    const result = await page.evaluate(async () => {
      const { newWorldAsset, resizeWorldAsset } = await import('/shared/world-schema.ts' as string);
      const { makeAssetFadeMask } = await import('/client/render/world-asset-fade.ts' as string);
      const { assetCellRegions, clipAssetCells } = await import('/client/render/asset-cell-regions.ts' as string);
      const a = newWorldAsset('roof', 'Copertura', '/world-assets/test.svg'); resizeWorldAsset(a, 12, 12);
      a.cells.forEach((cell: any) => cell.visibility = 'fade'); a.fade = { opacity: .28, feather: 0, durationMs: 0 };
      const mask = makeAssetFadeMask(a, 1024, 997, 'fade');
      const data = mask.getContext('2d')!.getImageData(0, 0, mask.width, mask.height).data;
      let gaps = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) gaps++;
      const differences = [];
      for (const scale of [.64, .95, 1.425]) {
        const canvas = window.document.createElement('canvas'); canvas.width = canvas.height = 1000;
        const ctx = canvas.getContext('2d')!;
        ctx.translate(.33, .71); ctx.scale(scale, scale);
        ctx.fillStyle = '#a94537'; ctx.fillRect(0, 0, 576, 576);
        const original = ctx.getImageData(0, 0, 1000, 1000).data;
        ctx.clearRect(-1, -1, 1600, 1600); ctx.save(); ctx.beginPath();
        for (const r of assetCellRegions(a, () => true)) ctx.rect(r.x * 48, r.y * 48, r.width * 48, r.height * 48);
        ctx.clip(); ctx.fillRect(0, 0, 576, 576); ctx.restore();
        const clipped = ctx.getImageData(0, 0, 1000, 1000).data;
        let interiorDifferences = 0;
        for (let y = 2; y < Math.floor(576 * scale) - 2; y++) for (let x = 2; x < Math.floor(576 * scale) - 2; x++) {
          const i = (y * 1000 + x) * 4;
          for (let c = 0; c < 4; c++) if (original[i + c] !== clipped[i + c]) interiorDifferences++;
        }
        differences.push(interiorDifferences);
      }
      // A mixed mask still has a clean, completely opaque interior for every selected cell.
      a.cells.forEach((cell: any, i: number) => cell.visibility = i % 12 < 6 ? 'fade' : 'hide-fade');
      const mixed = makeAssetFadeMask(a, 1024, 997, 'fade').getContext('2d')!.getImageData(0, 0, 1024, 997).data;
      let mixedGaps = 0;
      for (let y = 0; y < 997; y++) for (let x = 0; x < 1024; x++) if (mixed[(y * 1024 + x) * 4 + 3] !== (x < 512 ? 255 : 0)) mixedGaps++;
      a.cells.forEach((cell: any, i: number) => cell.visibility = (i % 12 + Math.floor(i / 12)) % 3 ? 'normal' : 'fade');
      const canvas = window.document.createElement('canvas'); canvas.width = canvas.height = 900;
      const ctx = canvas.getContext('2d')!; ctx.translate(.33, .71); ctx.scale(.95, .95);
      ctx.fillStyle = '#a94537'; ctx.fillRect(0, 0, 576, 576);
      const original = ctx.getImageData(0, 0, 900, 900).data;
      ctx.clearRect(-1, -1, 1000, 1000);
      for (const overhead of [false, true]) {
        ctx.save();
        clipAssetCells(ctx, a, { x: 0, y: 0 }, 48, (cell: any) => (cell.visibility !== 'normal') === overhead);
        ctx.fillRect(0, 0, 576, 576); ctx.restore();
      }
      const split = ctx.getImageData(0, 0, 900, 900).data;
      let splitDifferences = 0;
      for (let y = 2; y < 545; y++) for (let x = 2; x < 545; x++) {
        const i = (y * 900 + x) * 4;
        for (let c = 0; c < 4; c++) if (original[i + c] !== split[i + c]) splitDifferences++;
      }
      const { WORLD_DOCUMENT } = await import('/shared/world-content.ts' as string);
      const { WorldAssetArt } = await import('/client/render/world-asset-art.ts' as string);
      const bridge = WORLD_DOCUMENT.assets.find((asset: any) => asset.name === 'Ponte Fortificato in Rovina');
      if (!bridge) throw new Error('Missing bridge fixture');
      const art = new WorldAssetArt(); art.image(bridge);
      await new Promise<void>((resolve, reject) => {
        const deadline = performance.now() + 5000;
        const check = () => { if (art.image(bridge)) resolve(); else if (performance.now() > deadline) reject(new Error('Bridge image timeout')); else setTimeout(check, 20); }; check();
      });
      const bridgeDifferences: { count: number; maximum: number }[] = [];
      for (const [scale, x, y] of [[.95, .33, .71], [1.9, .13, .87], [.64, .81, .22], [1.425, .58, .32]]) {
        const sample = window.document.createElement('canvas'); sample.width = sample.height = 1300;
        const paint = sample.getContext('2d')!; paint.translate(x, y); paint.scale(scale, scale);
        const placement = { id: 'bridge', assetId: bridge.id, x: 0, y: 0 };
        art.draw(paint, bridge, placement);
        const originalBridge = paint.getImageData(0, 0, 1300, 1300).data;
        paint.clearRect(-2, -2, 2100, 2100);
        for (const overhead of [false, true]) {
          paint.save(); clipAssetCells(paint, bridge, placement, 48, (cell: any) => (cell.visibility !== 'normal') === overhead);
          art.draw(paint, bridge, placement); paint.restore();
        }
        const splitBridge = paint.getImageData(0, 0, 1300, 1300).data;
        let count = 0, maximum = 0;
        for (let i = 0; i < splitBridge.length; i++) if (originalBridge[i] !== splitBridge[i]) {
          count++; maximum = Math.max(maximum, Math.abs(originalBridge[i] - splitBridge[i]));
        }
        bridgeDifferences.push({ count, maximum });
        if (scale === .95) window.document.body.append(sample);
      }
      return { gaps, differences, mixedGaps, splitDifferences, bridgeDifferences };
    });
    assert.equal(result.gaps, 0); assert.equal(result.mixedGaps, 0);
    assert.deepEqual(result.differences, [0, 0, 0]);
    assert.equal(result.splitDifferences, 0);
    // Canvas texture sampling can round premultiplied colors by one unit when a clip is active.
    assert.ok(result.bridgeDifferences.every(d => d.maximum <= 1), JSON.stringify(result.bridgeDifferences));
    mkdirSync(resolve('test-results'), { recursive: true });
    await page.screenshot({ path: resolve('test-results/asset-bridge-no-seams.png') });
  } finally { await browser?.close(); await server.close(); }
});
