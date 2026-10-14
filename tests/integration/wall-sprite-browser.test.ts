import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('PNG wall modules repeat at every height, select true corners, and preserve staircase access', { timeout: 90_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 650 } }), errors: string[] = [];
    await page.addInitScript('window.__name = value => value'); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/wall-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#17201a"><canvas width="1100" height="650"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}wall-review`);
    const result = await page.evaluate(async () => {
      const { WallSpriteArt } = await import('/client/render/wall-sprite-art.ts' as string);
      const { SurfaceTerrain } = await import('/client/render/surface-terrain.ts' as string);
      const { TerrainMaterials } = await import('/client/render/terrain-materials.ts' as string);
      const { EnvironmentArt } = await import('/client/render/environment-art.ts' as string);
      const { rockStairGeometry } = await import('/client/render/rock-cliff-geometry.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const png = (width: number, height: number, color: string, second?: string) => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
        if (second) { ctx.fillStyle = second; ctx.fillRect(0, height / 2, width, height / 2); }
        return { image: canvas.toDataURL('image/png'), width, height };
      };
      const full = { id: 'test-wall', name: 'Test wall', material: 'rock', tileSize: 48, levelHeight: 16, pixelated: true,
        parts: { body: png(48, 16, '#dd1100', '#2200dd'), cap: png(48, 4, '#eecc00'), foot: png(48, 4, '#115511'),
          'corner-left': png(48, 16, '#cc11cc'), 'corner-right': png(48, 16, '#00cccc'),
          'inner-corner-left': png(48, 16, '#aa6600'), 'inner-corner-right': png(48, 16, '#ff6600'),
          'side-left': png(48, 16, '#22aa22'), 'side-right': png(48, 16, '#117711'),
          back: png(48, 4, '#aaccff'), 'stairs-tread': png(48, 8, '#11cc99'),
          'stairs-riser': png(48, 4, '#115544'), 'stairs-border': png(6, 6, '#bbaa77'),
          'stairs-landing': png(48, 8, '#118866') } };
      const transparent = { ...full, id: 'test-transparent', parts: { body: png(48, 16, '#00000000') } };
      const stoneKit = { ...full, id: 'test-stone', material: 'stone' };
      const kit = new WallSpriteArt({ version: 1, kits: [full, transparent, stoneKit], issues: [] });
      const materials = new TerrainMaterials(), art = new EnvironmentArt(), surfaces = new SurfaceTerrain(materials, art, kit);
      await Promise.all([kit.ready, materials.ready, art.ready, surfaces.rockArt.ready]);
      const draft = newWorldDocument(); draft.surfaceCells = [];
      for (let y = 3; y <= 5; y++) for (let x = 2; x <= 6; x++) draft.surfaceCells.push({ x, y, elevation: 3,
        surfaceId: 'ground', kind: 'ground', material: 'grass', wallMaterial: 'rock', wallSkin: 'test-wall' });
      for (let y = 3; y <= 5; y++) for (let x = 16; x <= 20; x++) draft.surfaceCells.push({ x, y, elevation: 3,
        surfaceId: 'ground', kind: 'ground', material: 'grass', wallMaterial: 'stone', wallSkin: 'test-stone' });
      draft.surfaceLinks = [
        { id: 'front-stair', kind: 'stairs', from: { x: 4, y: 6, surfaceId: 'ground' }, to: { x: 4, y: 5, surfaceId: 'ground' } },
        { id: 'stone-stair', kind: 'stairs', from: { x: 18, y: 6, surfaceId: 'ground' }, to: { x: 18, y: 5, surfaceId: 'ground' } },
      ];
      const world = new World(12, 16, 'world', draft, []);
      const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#789855'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const pixel = (x: number, y: number) => [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data];
      for (const level of surfaces.levels(world, { left: 0, top: 0, right: 1100, bottom: 450 })) surfaces.drawLevel(ctx, world, level, 1000);
      const repeatedBands = [244, 252, 260, 268].map(y => pixel(170, y));
      const convexLeft = pixel(105, 260), convexRight = pixel(328, 260), internalJoint = pixel(150, 260);
      const cap = pixel(170, 239), foot = pixel(170, 283), side = pixel(93, 220), aperture = pixel(216, 256);
      const stoneLeft = pixel(780, 260), stoneRight = pixel(995, 260), stoneBody = pixel(840, 260);
      const stoneSide = pixel(765, 220), stoneAperture = pixel(888, 256), outsideStone = pixel(750, 260);
      surfaces.drawLinks(ctx, world);
      const from = { x: 4, y: 6, surfaceId: 'ground', kind: 'ground', material: 'grass', wallMaterial: 'earth', elevation: 0 };
      const to = draft.surfaceCells.find((cell: any) => cell.x === 4 && cell.y === 5)!;
      const geometry = rockStairGeometry(from, to)!;
      const step = geometry.treads[2].top, center = { x: step.reduce((sum: number, p: any) => sum + p.x, 0) / 4,
        y: step.reduce((sum: number, p: any) => sum + p.y, 0) / 4 };
      const tread = pixel(center.x, center.y), bareApproach = pixel(216, 319);
      // Four cardinal neighbors with missing diagonals create four concave rims on the center cell.
      const inwardDraft = newWorldDocument(); inwardDraft.surfaceCells = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({
        x: 10 + dx, y: 8 + dy, surfaceId: 'ground', elevation: 3, kind: 'ground', material: 'grass', wallMaterial: 'rock', wallSkin: 'test-wall' }));
      const inwardWorld = new World(12, 16, 'world', inwardDraft, []), usedInner: string[] = [];
      const originalFace = kit.paintFace.bind(kit);
      kit.paintFace = (paint: CanvasRenderingContext2D, cell: any, profile: any, x: number, y: number,
        height: number, contour?: any, inner?: 'left' | 'right', terminals?: { left: boolean; right: boolean; innerLeft?: boolean; innerRight?: boolean }) => {
        if (inner) usedInner.push(inner); return originalFace(paint, cell, profile, x, y, height, contour, inner, terminals);
      };
      for (const level of surfaces.levels(inwardWorld, { left: 0, top: 0, right: 700, bottom: 600 })) surfaces.drawLevel(ctx, inwardWorld, level, 1000);
      const inwardPixels = ctx.getImageData(400, 280, 210, 220).data;
      let composedInnerPixels = 0;
      for (let i = 0; i < inwardPixels.length; i += 4) if (inwardPixels[i + 1] === 102 && inwardPixels[i + 2] === 0
        && (inwardPixels[i] === 170 || inwardPixels[i] === 255)) composedInnerPixels++;
      const squareInwardDraft = newWorldDocument();
      squareInwardDraft.surfaceCells = inwardDraft.surfaceCells.map((cell: any) => ({ ...cell, x: cell.x + 6,
        wallMaterial: 'stone', wallSkin: 'test-stone' }));
      const squareInwardWorld = new World(12, 16, 'world', squareInwardDraft, []);
      for (const level of surfaces.levels(squareInwardWorld, { left: 0, top: 0, right: 1100, bottom: 600 })) surfaces.drawLevel(ctx, squareInwardWorld, level, 1000);
      const stoneInnerLeft = pixel(830, 402), stoneInnerRight = pixel(751, 402);
      // Verify inner artwork on an isolated concave extrusion as well as the automatic selection above.
      ctx.save(); ctx.translate(650, 100);
      const profile = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, 10); ctx.lineTo(10, 58); ctx.lineTo(0, 48); ctx.closePath(); ctx.clip();
      originalFace(ctx, to, profile, 0, 0, 48, undefined, 'left'); ctx.restore();
      const innerPixel = pixel(655, 125);
      const fallbackSamples = (skin?: string) => {
        const fallbackDraft = newWorldDocument(); fallbackDraft.surfaceCells = draft.surfaceCells.map((cell: any) => ({ ...cell, wallSkin: skin }));
        const fallbackWorld = new World(12, 16, 'world', fallbackDraft, []);
        const canvas = document.createElement('canvas'); canvas.width = 500; canvas.height = 400;
        const paint = canvas.getContext('2d')!;
        for (const level of surfaces.levels(fallbackWorld, { left: 0, top: 0, right: 500, bottom: 400 })) surfaces.drawLevel(paint, fallbackWorld, level, 1000);
        return [244, 252, 260, 283].map(y => [...paint.getImageData(170, y, 1, 1).data]);
      };
      const ordinary = fallbackSamples(), transparentFallback = fallbackSamples('test-transparent');
      const broken = new WallSpriteArt({ version: 1, kits: [{ ...full, id: 'missing-body', parts: { body: { image: '/missing-wall.png', width: 48, height: 16 } } }], issues: [] });
      await broken.ready; const brokenFallsBack = !broken.kit({ ...to, wallSkin: 'missing-body' });
      const unknownFallsBack = !kit.kit({ ...to, wallSkin: 'missing-folder' });
      ctx.fillStyle = '#e3e9d0'; ctx.font = '20px Segoe UI'; ctx.fillText('PNG · corpo ripetuto · angoli esterni/interni · apertura scale', 75, 48);
      return { repeatedBands, convexLeft, convexRight, internalJoint, cap, foot, side, aperture, tread, bareApproach,
        stoneLeft, stoneRight, stoneBody, stoneSide, stoneAperture, outsideStone, stoneInnerLeft, stoneInnerRight,
        usedInner, innerPixel, composedInnerPixels, ordinary, transparentFallback, brokenFallsBack, unknownFallsBack };
    });
    assert.deepEqual(result.repeatedBands, [[221, 17, 0, 255], [34, 0, 221, 255], [221, 17, 0, 255], [34, 0, 221, 255]], 'body repeats by elevation band instead of stretching to the full height');
    assert.deepEqual(result.convexLeft, [204, 17, 204, 255]); assert.deepEqual(result.convexRight, [0, 204, 204, 255]);
    assert.deepEqual(result.internalJoint, [221, 17, 0, 255], 'internal joints do not acquire a corner module');
    assert.deepEqual(result.cap, [238, 204, 0, 255]); assert.deepEqual(result.foot, [17, 85, 17, 255]);
    assert.deepEqual(result.side, [34, 170, 34, 255]);
    assert.deepEqual(result.stoneLeft, [204, 17, 204, 255]); assert.deepEqual(result.stoneRight, [0, 204, 204, 255]);
    assert.deepEqual(result.stoneBody, [221, 17, 0, 255]); assert.deepEqual(result.stoneSide, [34, 170, 34, 255]);
    assert.deepEqual(result.stoneAperture, [120, 152, 85, 255], 'a rectangular masonry kit leaves its staircase opening clear');
    assert.deepEqual(result.outsideStone, [120, 152, 85, 255], 'rectangular wall tiles remain clipped to their own face');
    assert.deepEqual(result.stoneInnerLeft, [170, 102, 0, 255]); assert.deepEqual(result.stoneInnerRight, [255, 102, 0, 255]);
    assert.deepEqual(result.aperture, [120, 152, 85, 255], 'PNG body and cap preserve the physical opening');
    assert.deepEqual(result.tread, [17, 204, 153, 255]); assert.deepEqual(result.bareApproach, [120, 152, 85, 255]);
    assert.ok(result.usedInner.includes('left') && result.usedInner.includes('right'), 'concave topology selects both inner corner variants');
    assert.ok(result.composedInnerPixels > 5, 'inner modules remain visible after neighboring front faces and tops are painted');
    assert.deepEqual(result.innerPixel, [170, 102, 0, 255]);
    for (const [index, pixel] of result.transparentFallback.entries()) {
      assert.equal(pixel[3], 255, 'transparent body pixels retain an opaque fallback');
      for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(pixel[channel] - result.ordinary[index][channel]) <= 2,
        'missing optional parts retain the existing artwork within canvas compositing rounding');
    }
    assert.equal(result.brokenFallsBack, true); assert.equal(result.unknownFallsBack, true); assert.deepEqual(errors, []);
    mkdirSync('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/wall-sprite-kit-review.png' });
  } finally { await browser?.close(); await server.close(); }
});
