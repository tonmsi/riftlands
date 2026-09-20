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
      const cornerCanvas = document.createElement('canvas');
      cornerCanvas.width = cornerCanvas.height = 48;
      const cornerCtx = cornerCanvas.getContext('2d')!;
      cornerCtx.fillStyle = '#224466'; cornerCtx.fillRect(0, 0, 48, 48);
      art.roundTerrainCorner(cornerCtx, 0, 0, 0, '#aaccee');
      const roundedCorner = [...cornerCtx.getImageData(0, 0, 1, 1).data];
      const roundedCenter = [...cornerCtx.getImageData(24, 24, 1, 1).data];
      const quietSeam = art.drawTerrainSeam(cornerCtx, 24, 24, .2);
      const decoratedSeam = art.drawTerrainSeam(cornerCtx, 24, 24, .9);
      return {
        openCorner: [...ctx.getImageData(8, 8, 1, 1).data],
        isolatedCorner: [...ctx.getImageData(15 * 56 + 8, 15 * 56 + 8, 1, 1).data],
        isolatedCenter: [...ctx.getImageData(15 * 56 + 32, 15 * 56 + 32, 1, 1).data],
        roundedCorner, roundedCenter,
        quietSeam, decoratedSeam,
      };
    });
    assert.equal(result.isolatedCenter[3], 255, 'water interiors remain opaque');
    assert.ok(result.isolatedCenter[1] > result.isolatedCenter[0] + 20 && result.isolatedCenter[2] > result.isolatedCenter[0] + 20,
      'painted interiors retain the water palette without bank or foam leaking into the center');
    assert.notDeepEqual(result.isolatedCorner, result.isolatedCenter, 'exposed corners are cut into curved banks');
    assert.notDeepEqual(result.roundedCorner, result.roundedCenter, 'terrain transitions replace only the rounded corner');
    assert.equal(result.quietSeam, 0, 'most dungeon seams remain visually quiet');
    assert.ok(result.decoratedSeam >= 2 && result.decoratedSeam <= 3,
      'selected dungeon seams receive two or three small hand-drawn stones');
    mkdirSync('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/shoreline-masks.png' });
    const performance = await page.evaluate(async () => {
      const { Renderer } = await import('/client/render.ts' as string);
      const canvas = document.querySelector('canvas')!;
      const renderer = new Renderer(canvas);
      await renderer.spritesReady;
      renderer.destroy();
      const ctx = renderer.ctx;
      ctx.setTransform(.95, 0, 0, .95, -2500.25, -2700.75);
      renderer.bounds = { left: 2500 / .95, top: 2700 / .95, right: 3700 / .95, bottom: 3600 / .95 };
      renderer.drawTerrain(1200);
      const sprites = new Set(renderer.environmentArt.cache.values());
      const stillFrame = canvas.toDataURL();
      const frames: number[] = [];
      for (let i = 0; i < 30; i++) {
        const start = window.performance.now();
        renderer.drawTerrain(1200 + i * 16);
        frames.push(window.performance.now() - start);
      }
      const rebuilt = [...renderer.environmentArt.cache.values()].filter(sprite => !sprites.has(sprite)).length;
      renderer.drawTerrain(12000);
      return {
        rebuilt, still: stillFrame === canvas.toDataURL(), maxMs: Math.max(...frames),
        meanMs: frames.reduce((a, b) => a + b, 0) / frames.length,
      };
    });
    assert.equal(performance.rebuilt, 0, 'a warmed viewport never churns its terrain atlas');
    assert.ok(performance.still, 'water brush strokes remain static as time advances');
    assert.ok(performance.maxMs < 250, `terrain render stalled: ${performance.maxMs} ms`);
    console.log('Terrain CPU render timings (headless Chrome):', performance);
    await page.screenshot({ path: 'artifacts/world-terrain.png' });
    const water = await page.evaluate(async () => {
      const { EnvironmentArt } = await import('/client/environment-art.ts' as string);
      const { TERRAIN, shorelineMask } = await import('/client/terrain-style.ts' as string);
      const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
      const art = new EnvironmentArt();
      let queries = 0;
      const world = { getTile(x: number, y: number) { queries++; return x >= 2 && x < 22 && y >= 2 && y < 16 ? 'water' : 'grass'; } };
      const bounds = { left: 0, top: 0, right: 1200, bottom: 900 };
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 1200, 900);
      art.paintWater(ctx, bounds, world);
      const pixels = ctx.getImageData(0, 0, 1200, 900).data;
      let painted = 0, escaped = 0;
      for (let y = 0; y < 900; y++) for (let x = 0; x < 1200; x++) {
        if (!pixels[(y * 1200 + x) * 4 + 3]) continue;
        painted++;
        if (x < 96 || x >= 1056 || y < 96 || y >= 768) escaped++;
      }
      queries = 0; art.paintWater(ctx, bounds, world);
      const warmQueries = queries;
      ctx.fillStyle = TERRAIN.grass; ctx.fillRect(0, 0, 1200, 900);
      for (let y = 2; y < 16; y++) for (let x = 2; x < 22; x++) {
        const shore = shorelineMask(world.getTile, x, y);
        art.draw(ctx, 'water', x * 48, y * 48, .5, shore);
      }
      art.paintWater(ctx, bounds, world);
      for (let y = 2; y < 16; y++) for (let x = 2; x < 22; x++) {
        const shore = shorelineMask(world.getTile, x, y);
        art.drawWaterPlants(ctx, x * 48, y * 48, ((x * 37 + y * 17) % 100) / 100, shore);
      }
      return {
        painted, escaped, warmQueries,
        noOpenWaterLilies: art.drawWaterPlants(ctx, 0, 0, .99, 0),
        quietEdge: art.drawWaterPlants(ctx, 0, 0, .6, 1),
        populatedEdge: art.drawWaterPlants(ctx, 0, 0, .9, 1),
        populatedCorner: art.drawWaterPlants(ctx, 0, 0, .6, 9),
      };
    });
    assert.ok(water.painted > 4000, 'open water has broad multi-cell brush marks');
    assert.equal(water.escaped, 0, 'water paint never reaches banks or land');
    assert.equal(water.warmQueries, 0, 'water paint eligibility is cached');
    assert.equal(water.noOpenWaterLilies, 0, 'lilies do not populate open water');
    assert.equal(water.quietEdge, 0, 'most straight shoreline cells remain clear');
    assert.ok(water.populatedEdge >= 1, 'some shoreline cells receive lilies');
    assert.ok(water.populatedCorner >= 2, 'sheltered corners receive lily clusters');
    await page.screenshot({ path: 'artifacts/water-painterly.png' });
    const dungeon = await page.evaluate(async () => {
      const { Renderer, drawMinimap } = await import('/client/render.ts' as string);
      const { DUNGEON_DEFINITIONS } = await import('/shared/dungeons.ts' as string);
      const renderer = new Renderer(document.querySelector('canvas'));
      await renderer.spritesReady; renderer.destroy();
      const area = DUNGEON_DEFINITIONS[0].area;
      renderer.ctx.setTransform(1, 0, 0, 1, 600 - area.x, 450 - area.y);
      renderer.bounds = { left: area.x - 600, top: area.y - 450, right: area.x + 600, bottom: area.y + 450 };
      renderer.drawTerrain(1200);
      const map = document.createElement('canvas');
      map.style.cssText = 'position:fixed;right:12px;bottom:12px;width:240px;height:240px;border:2px solid #ddd';
      document.body.append(map);
      drawMinimap(map, renderer.world, { x: area.x, y: area.y }, []);
      return {
        stoneWash: renderer.environmentArt.washes.has('stone'),
        sharedRock: [...renderer.environmentArt.cache.keys()].some(key => key.startsWith('rock:')),
      };
    });
    assert.ok(dungeon.stoneWash, 'dungeon floors receive the neutral painterly wash');
    assert.ok(dungeon.sharedRock, 'dungeon rocks use the shared procedural scenery atlas');
    await page.screenshot({ path: 'artifacts/dungeon-terrain.png' });
    await page.evaluate(async () => {
      const { Renderer } = await import('/client/render.ts' as string);
      const { DUNGEON_DEFINITIONS } = await import('/shared/dungeons.ts' as string);
      const canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas);
      await renderer.spritesReady; renderer.destroy();
      const area = DUNGEON_DEFINITIONS[0].area;
      const entranceY = area.y + 500;
      renderer.ctx.setTransform(1, 0, 0, 1, 600 - area.x, 450 - entranceY);
      renderer.bounds = { left: area.x - 600, top: entranceY - 450, right: area.x + 600, bottom: entranceY + 450 };
      renderer.drawTerrain(1200);
    });
    await page.screenshot({ path: 'artifacts/dungeon-entrance.png', clip: { x: 450, y: 90, width: 300, height: 760 } });
    await page.evaluate(async () => {
      const { Renderer } = await import('/client/render.ts' as string);
      const { DUNGEON_DEFINITIONS } = await import('/shared/dungeons.ts' as string);
      const canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas);
      await renderer.spritesReady; renderer.destroy();
      const area = DUNGEON_DEFINITIONS.at(-1)!.area;
      renderer.ctx.setTransform(1, 0, 0, 1, 600 - area.x, 450 - area.y);
      renderer.bounds = { left: area.x - 600, top: area.y - 450, right: area.x + 600, bottom: area.y + 450 };
      renderer.drawTerrain(1200);
    });
    await page.screenshot({ path: 'artifacts/dungeon-scenery-underlay.png' });
    const outpost = await page.evaluate(async () => {
      const { Renderer } = await import('/client/render.ts' as string);
      const canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas);
      await renderer.spritesReady; renderer.destroy();
      const centerY = -220;
      renderer.ctx.setTransform(1, 0, 0, 1, 600, 450 - centerY);
      renderer.bounds = { left: -600, top: centerY - 450, right: 600, bottom: centerY + 450 };
      renderer.drawTerrain(1200);
      return {
        grassBank: [...renderer.ctx.getImageData(409, 141, 1, 1).data],
        pathBank: [...renderer.ctx.getImageData(451, 141, 1, 1).data],
      };
    });
    assert.ok(outpost.grassBank[0] + 30 < outpost.pathBank[0],
      'a mixed shoreline keeps grass and path backing in separate rounded corners');
    await page.screenshot({ path: 'artifacts/outpost-terrain.png' });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});
