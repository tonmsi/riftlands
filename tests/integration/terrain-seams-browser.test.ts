import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('full terrain painting does not expose blue rectangular water-tile edges outside curved banks', { timeout: 60000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.addInitScript('window.__name = value => value');
    await page.route('**/outer-seams-review', route => route.fulfill({ contentType: 'text/html', body: '<body></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}outer-seams-review`);
    const results = await page.evaluate(async () => {
      const { TerrainRenderer } = await import('/client/render/terrain-renderer.ts' as string);
      const { curvePath } = await import('/client/render/water-shore.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const land = '#ddbb66', document = newWorldDocument();
      document.interiorBounds = { width: 8, height: 8, name: 'Outer seams', pvp: false };
      document.zones = [{ id: 'temperate', name: 'Temperate shore', priority: 10,
        shape: { kind: 'rect', x: 0, y: 0, width: 8, height: 8 }, temperature: .75, moisture: .65,
        generateAssets: false, npcs: { density: 0, maxPerChunk: 0, weights: { slime: 0, wisp: 0, sentinel: 0 } } }];
      const waterCells: { x: number; y: number }[] = [];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const wet = y >= 1 && y <= 6 && x >= (y < 3 ? 3 : 2) && x <= (y < 5 ? 4 : 5);
        document.tiles.push({ x, y, terrain: wet ? 'water' : 'grass' });
        if (wet) waterCells.push({ x, y });
      }
      const world = new World(23, 16, 'world', document, []);
      const canvas = window.document.createElement('canvas'); canvas.width = canvas.height = 800;
      const ctx = canvas.getContext('2d')!, renderer = new TerrainRenderer(ctx);
      await renderer.spritesReady;
      // Flat land makes every unwanted water-colored pixel measurable. Use the real water sprites and renderer order.
      renderer.materials.fill = () => land;
      renderer.environmentArt.paintGround = renderer.environmentArt.paintWater = renderer.environmentArt.drawWaterPlants = () => {};
      renderer.surfaceTerrain.drawNaturalWaterBanks = () => {};
      const originalDraw = renderer.environmentArt.draw.bind(renderer.environmentArt);
      renderer.environmentArt.draw = (ctx: CanvasRenderingContext2D, tile: string, ...args: any[]) => {
        if (tile === 'water') originalDraw(ctx, tile, ...args);
      };
      const joined = new Path2D(), banks = new Path2D();
      // Match the shore winding so their shared edges form one continuous land silhouette.
      for (const tile of document.tiles) if (tile.terrain !== 'water') {
        const x = tile.x * 48, y = tile.y * 48;
        joined.moveTo(x, y); joined.lineTo(x, y + 48); joined.lineTo(x + 48, y + 48); joined.lineTo(x + 48, y); joined.closePath();
      }
      const curves = renderer.surfaceTerrain.drawConnectedWaterBanks(ctx, world, waterCells, 'ground', 0, () => land);
      for (const [key, quarters] of curves) {
        const [x, y] = key.split(',').map(Number);
        for (const curve of quarters) if (curve) {
          const matrix = new DOMMatrix().translate(x * 48, y * 48);
          joined.addPath(curvePath(curve, true), matrix); banks.addPath(curvePath(curve), matrix);
        }
      }
      const reference = window.document.createElement('canvas'); reference.width = reference.height = 800;
      const ref = reference.getContext('2d')!;
      const results: { scale: number; phase: number; leaks: number }[] = [];
      for (const scale of [.7, .95, 1.425, 1.875]) for (const phase of [.25, .71]) {
        ctx.resetTransform(); ctx.clearRect(0, 0, 800, 800);
        ctx.setTransform(scale, 0, 0, scale, 13 + phase, 19 + phase);
        renderer.drawTerrain(world, 1000, ctx, { left: 0, top: 0, right: 383, bottom: 383 });
        ref.resetTransform(); ref.clearRect(0, 0, 800, 800);
        ref.setTransform(scale, 0, 0, scale, 13 + phase, 19 + phase);
        ref.fillStyle = land; ref.fill(joined); ref.strokeStyle = '#000'; ref.lineWidth = 18; ref.stroke(banks);
        const actual = ctx.getImageData(0, 0, 800, 800).data, expected = ref.getImageData(0, 0, 800, 800).data;
        let leaks = 0;
        for (let i = 0; i < actual.length; i += 4) if (expected[i] === 221 && expected[i + 1] === 187
          && expected[i + 2] === 102 && expected[i + 3] === 255 && actual[i + 2] > 110) leaks++;
        results.push({ scale, phase, leaks });
      }
      return results;
    });
    assert.deepEqual(results.filter(result => result.leaks), [], JSON.stringify(results));
  } finally { await browser?.close(); await server.close(); }
});

test('river banks and elevated ground hide underlying water at fractional zoom', { timeout: 60000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.addInitScript('window.__name = (value) => value');
    await page.route('**/seams-review', route => route.fulfill({ contentType: 'text/html', body: '<body></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}seams-review`);
    const results = await page.evaluate(async () => {
      const { SurfaceTerrain } = await import('/client/render/surface-terrain.ts' as string);
      const { curvePath } = await import('/client/render/water-shore.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const land = '#ddbb66', water = '#00aaff';
      const surface = new SurfaceTerrain({ fill: () => land, color: () => land }, { paintGround() {} });
      surface.pathEdgeStyle = 'current';
      const document = newWorldDocument();
      document.interiorBounds = { width: 8, height: 8, name: 'Seams', pvp: false };
      const waterCells: { x: number; y: number }[] = [];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const wet = x >= (y < 3 ? 3 : 2) && x <= (y < 5 ? 4 : 5);
        document.tiles.push({ x, y, terrain: wet ? 'water' : 'grass' });
        if (wet) waterCells.push({ x, y });
      }
      const world = new World(23, 16, 'world', document, []);
      const plate = newWorldDocument();
      plate.interiorBounds = document.interiorBounds;
      plate.surfaceCells = [];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        plate.tiles.push({ x, y, terrain: 'water' });
        if (x >= 2 && x <= 5 && y >= 2 && y <= 5) plate.surfaceCells.push({
          x, y, surfaceId: 'ground', elevation: 2, material: 'path', wallMaterial: 'earth', kind: 'ground' });
      }
      const plateWorld = new World(23, 16, 'world', plate, []);
      const results: { scale: number; mode: string; bankLeaks: number; plateLeaks: number }[] = [];
      for (const zoom of [.7, .95, 1.25]) for (const dpr of [1, 1.5]) for (const mode of ['uniform', 'mixed', 'pattern']) {
        const scale = zoom * dpr, tx = 13.25, ty = 19.6;
        const canvas = window.document.createElement('canvas'); canvas.width = canvas.height = 800;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = water; ctx.fillRect(0, 0, 800, 800);
        ctx.setTransform(scale, 0, 0, scale, tx, ty);
        const texture = window.document.createElement('canvas'); texture.width = texture.height = 2;
        const textureCtx = texture.getContext('2d')!;
        textureCtx.fillStyle = land; textureCtx.fillRect(0, 0, 2, 2);
        textureCtx.fillStyle = '#d8b260'; textureCtx.fillRect(0, 0, 1, 1);
        const pattern = ctx.createPattern(texture, 'repeat')!;
        const curves = surface.drawConnectedWaterBanks(ctx, world, waterCells, 'ground', 0,
          (x: number, y: number, corner: number) => mode === 'uniform' || (x + y + corner) % 2 === 0 ? land
            : mode === 'pattern' ? pattern : '#d8b260');
        const reference = window.document.createElement('canvas'); reference.width = reference.height = 800;
        const ref = reference.getContext('2d')!;
        ref.setTransform(scale, 0, 0, scale, tx, ty);
        const joined = new Path2D(), banks = new Path2D();
        for (const [key, quarters] of curves) {
          const [x, y] = key.split(',').map(Number);
          for (const curve of quarters) if (curve) {
            const matrix = new DOMMatrix().translate(x * 48, y * 48);
            joined.addPath(curvePath(curve, true), matrix);
            banks.addPath(curvePath(curve), matrix);
          }
        }
        ref.fillStyle = land; ref.fill(joined);
        // Ignore the intentional shading at the real shoreline, checking only solid land.
        ref.strokeStyle = '#000'; ref.lineWidth = 18; ref.stroke(banks);
        const actual = ctx.getImageData(0, 0, 800, 800).data;
        const expected = ref.getImageData(0, 0, 800, 800).data;
        let bankLeaks = 0;
        for (let i = 0; i < actual.length; i += 4) if (expected[i] === 221 && expected[i + 1] === 187
          && expected[i + 2] === 102 && expected[i + 3] === 255 && actual[i + 2] > 110) bankLeaks++;
        let plateLeaks = 0;
        for (const wallMaterial of ['earth', 'brick']) {
          ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = water; ctx.fillRect(0, 0, 800, 800);
          ctx.setTransform(scale, 0, 0, scale, tx, ty);
          surface.drawGroundLevel(ctx, plateWorld, { elevation: 2, cells: plate.surfaceCells.map((cell: any) => ({ ...cell, wallMaterial })) });
          const pixels = ctx.getImageData(0, 0, 800, 800).data;
          for (let y = Math.ceil((120 - 32) * scale + ty); y < Math.floor((264 - 32) * scale + ty); y++)
            for (let x = Math.ceil(120 * scale + tx); x < Math.floor(264 * scale + tx); x++)
              if (pixels[(y * 800 + x) * 4 + 2] > 110) plateLeaks++;
        }
        results.push({ scale, mode, bankLeaks, plateLeaks });
      }
      return results;
    });
    assert.deepEqual(results.filter(result => result.bankLeaks || result.plateLeaks), [], JSON.stringify(results));
  } finally {
    await browser?.close();
    await server.close();
  }
});
