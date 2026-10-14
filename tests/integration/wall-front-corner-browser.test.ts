import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('complete front modules fit cliff heights and generic corners reflect correctly with mixed PNG resolutions', { timeout: 60_000 }, async () => {
  const originals = ['body', 'front', 'corner'].map(name => ({ name, bytes: readFileSync(`public/terrain-walls/wall-roccia/${name}.png`) }));
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1080, height: 610 } }), errors: string[] = [];
    await page.addInitScript('window.__name = value => value'); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/front-corner-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#18231c"><canvas id="samples" width="700" height="350" style="display:none"></canvas><canvas id="review" width="1080" height="610"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}front-corner-review`);
    const result = await page.evaluate(async () => {
      const { WallSpriteArt } = await import('/client/render/wall-sprite-art.ts' as string);
      const { completeWallSpriteParts, parseWallSpriteKitCatalog } = await import('/shared/wall-sprite-kits.ts' as string);
      const { SurfaceTerrain } = await import('/client/render/surface-terrain.ts' as string);
      const { TerrainMaterials } = await import('/client/render/terrain-materials.ts' as string);
      const { EnvironmentArt } = await import('/client/render/environment-art.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const png = (width: number, height: number, colors: string[], horizontal = false) => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const paint = canvas.getContext('2d')!;
        colors.forEach((color, i) => {
          paint.fillStyle = color;
          if (horizontal) paint.fillRect(i * width / colors.length, 0, width / colors.length + 1, height);
          else paint.fillRect(0, i * height / colors.length, width, height / colors.length + 1);
        });
        return { image: canvas.toDataURL('image/png'), width, height };
      };
      const parts = completeWallSpriteParts({ body: png(1254, 1254, ['#884488', '#440044']),
        front: png(381, 409, ['#f00000', '#c02020', '#a04040']), corner: png(381, 409, ['#00cc00', '#0000cc'], true) });
      const full = { id: 'mixed-wall', name: 'Mixed wall', material: 'rock', tileSize: 1254, levelHeight: 418, pixelated: true, parts };
      const { front: completeFront, ...patternParts } = parts;
      const repeated = { ...full, id: 'pattern-wall', parts: patternParts };
      const synthetic = new WallSpriteArt({ version: 1, kits: [full, repeated], issues: [] });
      await synthetic.ready;
      const canvas = document.querySelector<HTMLCanvasElement>('#samples')!, ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#1b1b1b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const pixel = (x: number, y: number) => [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data];
      const face = (skin: string, x: number, y: number, height: number, left = false, right = false) => {
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, 48, height); ctx.clip();
        synthetic.paintFace(ctx, { x: 0, y: 0, surfaceId: 'ground', elevation: height / 16, material: 'grass', wallMaterial: 'rock', kind: 'ground', wallSkin: skin },
          [{ x: 0, y: 0 }, { x: 48, y: 0 }], x, y, height, undefined, undefined, { left, right });
        ctx.restore();
      };
      const frontBands = [16, 48, 96].map((height, i) => {
        const x = 40 + i * 100; face('mixed-wall', x, 30, height);
        return [1 / 6, 1 / 2, 5 / 6].map(t => [pixel(x + 4, 30 + height * t), pixel(x + 44, 30 + height * t)]);
      });
      const outsideFront = [pixel(39, 35), pixel(88, 35), pixel(44, 46), pixel(244, 126)];
      face('mixed-wall', 40, 160, 48, true); face('mixed-wall', 140, 160, 48, false, true); face('mixed-wall', 240, 160, 48, true, true);
      const fullCorners = [pixel(46, 180), pixel(82, 180), pixel(146, 180), pixel(182, 180), pixel(246, 180), pixel(282, 180)];
      face('pattern-wall', 40, 240, 48, true); face('pattern-wall', 140, 240, 48, false, true);
      const patternCorners = [pixel(42, 250), pixel(50, 250), pixel(142, 250), pixel(150, 250)];

      const catalog = parseWallSpriteKitCatalog(await (await fetch('/terrain-walls/catalog.json')).json());
      const actual = new WallSpriteArt(catalog), materials = new TerrainMaterials(), art = new EnvironmentArt();
      const surfaces = new SurfaceTerrain(materials, art, actual);
      await Promise.all([actual.ready, materials.ready, art.ready, surfaces.rockArt.ready]);
      const draft = newWorldDocument(); draft.surfaceCells = [];
      for (let y = 0; y <= 7; y++) for (let x = 0; x <= 14; x++) draft.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
      for (const [start, elevation] of [[2, 3], [8, 6]]) for (let y = 2; y <= 4; y++) for (let x = start; x <= start + 3; x++)
        draft.surfaceCells.push({ x, y, surfaceId: 'ground', elevation, kind: 'ground', material: 'grass', wallMaterial: 'rock', wallSkin: 'wall-roccia' });
      const world = new World(draft.seed, 16, 'world', draft, []), plain = structuredClone(draft);
      plain.surfaceCells.forEach((cell: any) => { delete cell.wallSkin; }); const plainWorld = new World(draft.seed, 16, 'world', plain, []);
      const supports = [world, plainWorld].map(map => [[1, 3], [2, 3], [9, 3]].map(([x, y]) => {
        const cell = map.surfaceAt(x, y); return { elevation: cell.elevation, blocked: cell.blocked };
      }));
      const cliffTraversal = [world, plainWorld].map(map => !!map.canTraverse({ x: 72, y: 168, surfaceId: 'ground', elevation: 0 }, 120, 168));
      const review = document.querySelector<HTMLCanvasElement>('#review')!, paint = review.getContext('2d')!;
      paint.fillStyle = '#18231c'; paint.fillRect(0, 0, review.width, review.height);
      paint.fillStyle = '#e4ead7'; paint.font = '24px Segoe UI'; paint.fillText('Roccia · front.png e corner.png originali', 28, 38);
      paint.font = '16px Segoe UI'; paint.fillText('Faccia completa e angoli specchiati · terreno e collisioni restano indipendenti', 28, 65);
      paint.save(); paint.translate(20, 90); paint.scale(1.8, 1.8);
      paint.fillStyle = materials.fill(paint, 'grass', materials.color('grass')); paint.fillRect(0, 0, 590, 270);
      for (const level of surfaces.levels(world, { left: 0, top: 0, right: 650, bottom: 400 })) surfaces.drawLevel(paint, world, level, 1000);
      paint.restore(); paint.fillStyle = '#e4ead7'; paint.font = '18px Segoe UI';
      paint.fillText('3 quote · 48 px', 225, 585); paint.fillText('6 quote · 96 px', 745, 585);
      return { frontBands, outsideFront, fullCorners, patternCorners, supports, cliffTraversal,
        actualParts: catalog.kits.find((kit: any) => kit.id === 'wall-roccia')!.parts, issues: catalog.issues };
    });
    const colors = [[240, 0, 0, 255], [192, 32, 32, 255], [160, 64, 64, 255]];
    for (const bands of result.frontBands) assert.deepEqual(bands, colors.map(color => [color, color]), 'front fills one complete face at each height despite the older body resolution');
    assert.deepEqual(result.outsideFront, Array(4).fill([27, 27, 27, 255]), 'face modules remain inside their geometric footprint');
    const green = [0, 204, 0, 255], blue = [0, 0, 204, 255];
    assert.deepEqual(result.fullCorners, [green, blue, blue, green, green, green], 'left and right terminals use opposite orientations');
    assert.deepEqual(result.patternCorners, [green, blue, blue, green], 'reflection also works when corner artwork is a repeating body-scale pattern');
    assert.deepEqual(result.supports[0], result.supports[1]); assert.deepEqual(result.cliffTraversal, [false, false]);
    assert.equal(result.actualParts.front!.width, 381); assert.equal(result.actualParts.body!.width, 1254);
    assert.equal(result.actualParts['corner-right']!.flipX, true); assert.deepEqual(result.issues, []); assert.deepEqual(errors, []);
    mkdirSync('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/wall-roccia-front-corner.png' });
    for (const original of originals) assert.deepEqual(readFileSync(`public/terrain-walls/wall-roccia/${original.name}.png`), original.bytes);
  } finally { await browser?.close(); await server.close(); }
});
