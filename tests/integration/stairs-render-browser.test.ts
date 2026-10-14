import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('whole stairs replace intermediate flat tops and open bridge rails without cutting their deck', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 620, height: 500 } }), errors: string[] = [];
    await page.addInitScript('window.__name = value => value'); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/stairs-bridge-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#26382b"><canvas width="620" height="500"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}stairs-bridge-review`);
    const result = await page.evaluate(async () => {
      const { SurfaceTerrain } = await import('/client/render/surface-terrain.ts' as string);
      const { TerrainMaterials } = await import('/client/render/terrain-materials.ts' as string);
      const { EnvironmentArt } = await import('/client/render/environment-art.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const { planStair } = await import('/shared/surface-stairs.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const materials = new TerrainMaterials(), art = new EnvironmentArt(), surfaces = new SurfaceTerrain(materials, art);
      await Promise.all([materials.ready, art.ready, surfaces.rockArt.ready]);
      const doc = newWorldDocument(); doc.surfaceCells = [];
      for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) doc.surfaceCells.push({ x, y, elevation: 0, surfaceId: 'ground', kind: 'ground', material: 'grass', wallMaterial: 'rock' });
      for (let y = 3; y <= 4; y++) for (let x = 2; x <= 6; x++) doc.surfaceCells.push({ x, y, elevation: 3, surfaceId: 'bridge:review', kind: 'bridge', material: 'stone', wallMaterial: 'stone' });
      const plain = new World(12, 16, 'world', structuredClone(doc), []);
      const planned = planStair({ x: 4, y: 8, surfaceId: 'ground' }, { x: 4, y: 4, surfaceId: 'bridge:review' },
        (x: number, y: number, id: string) => plain.surfaceAt(x, y, id), { id: 'access', width: 48 });
      doc.surfaceCells.push(...planned.cells); doc.surfaceLinks = planned.links; doc.surfaceStairs = [planned.stair];
      const world = new World(12, 16, 'world', doc, []), canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
      const mini = document.createElement('canvas'); mini.width = 620; mini.height = 500; const paint = mini.getContext('2d')!;
      const background = (target: CanvasRenderingContext2D) => { target.fillStyle = '#789855'; target.fillRect(0, 0, 620, 500); };
      const pixel = (target: CanvasRenderingContext2D, x: number, y: number) => [...target.getImageData(x, y, 1, 1).data];
      const level = { elevation: 3, cells: doc.surfaceCells.filter((cell: any) => cell.kind === 'bridge') };
      background(ctx);
      surfaces.drawLevel(ctx, world, { elevation: 1, cells: planned.cells.filter((cell: any) => cell.elevation === 1) }, 1000);
      const skippedIntermediate = pixel(ctx, 216, 310);
      surfaces.drawLevel(ctx, world, level, 1000);
      const deckAtMouth = pixel(ctx, 216, 181), deckPastLanding = pixel(ctx, 216, 162);
      surfaces.drawForeground(ctx, world, level, 1000);
      const openRail = pixel(ctx, 216, 181), adjacentRail = pixel(ctx, 168, 181);
      background(paint); surfaces.drawLevel(paint, plain, level, 1000);
      const controlDeckPastLanding = pixel(paint, 216, 162);
      surfaces.drawForeground(paint, plain, level, 1000);
      const closedRail = pixel(paint, 216, 181), controlAdjacentRail = pixel(paint, 168, 181);
      surfaces.drawLinks(ctx, world);
      const middleTread = pixel(ctx, 216, 288);
      ctx.fillStyle = '#e7e9cc'; ctx.font = 'bold 16px Segoe UI'; ctx.fillText('Scala continua · accesso al ponte aperto', 34, 30);
      return { skippedIntermediate, deckAtMouth, deckPastLanding, controlDeckPastLanding, openRail, closedRail, adjacentRail, controlAdjacentRail, middleTread };
    });
    assert.deepEqual(result.skippedIntermediate, [120, 152, 85, 255], 'intermediate supports must not paint little flat grass terraces');
    assert.deepEqual(result.openRail, result.deckAtMouth, 'the actual stair entry removes the rail at its useful corridor');
    assert.notDeepEqual(result.closedRail, result.deckAtMouth, 'an unconnected bridge keeps its foreground rail');
    assert.deepEqual(result.adjacentRail, result.controlAdjacentRail, 'neighboring rails remain intact');
    assert.deepEqual(result.deckPastLanding, result.controlDeckPastLanding, 'mouth clipping must only touch rails, preserving the whole deck');
    assert.notDeepEqual(result.middleTread, result.skippedIntermediate, 'the complete structure paints all of its intermediate treads');
    assert.deepEqual(errors, []);
    mkdirSync('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/stairs-bridge-entry-review.png' });
  } finally { await browser?.close(); await server.close(); }
});
