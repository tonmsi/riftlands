import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { parseWorldDocument } from '../../shared/world-schema';

test('the nine cliff PNGs reassemble the source, preserve directional alpha frames and load in the terrain tools', { timeout: 90_000 }, async () => {
  const before = readFileSync('shared/custom-world.json', 'utf8');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1280 } }), errors: string[] = [];
    await page.addInitScript('window.__name = value => value'); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/wall-grid-review', route => route.fulfill({ contentType: 'text/html', body: '<canvas width="1000" height="600"></canvas>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}wall-grid-review`);
    const result = await page.evaluate(async () => {
      const { WallSpriteArt } = await import('/client/render/wall-sprite-art.ts' as string);
      const { parseWallSpriteKitCatalog, completeWallSpriteParts } = await import('/shared/wall-sprite-kits.ts' as string);
      const { SurfaceTerrain } = await import('/client/render/surface-terrain.ts' as string);
      const { TerrainMaterials } = await import('/client/render/terrain-materials.ts' as string);
      const { EnvironmentArt } = await import('/client/render/environment-art.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const names = ['back-left', 'back', 'back-right', 'side-left', 'center', 'side-right', 'corner-left', 'front', 'corner-right'];
      const catalog = parseWallSpriteKitCatalog(await (await fetch('/terrain-walls/catalog.json')).json());
      const actual = catalog.kits.find((kit: any) => kit.id === 'wall-roccia-grid')!;
      const load = async (url: string) => { const image = new Image(); image.src = url; await image.decode(); return image; };
      const source = await load('/terrain-walls/wall-roccia-grid/cliff-grid-source.png');
      const pieces = await Promise.all(names.map(name => load(actual.parts[name].image)));
      const original = document.createElement('canvas'), joined = document.createElement('canvas');
      original.width = joined.width = source.naturalWidth; original.height = joined.height = source.naturalHeight;
      const originalPaint = original.getContext('2d')!, joinedPaint = joined.getContext('2d')!;
      originalPaint.drawImage(source, 0, 0);
      const xs = [0, 395, 791], ys = [0, 394, 789];
      pieces.forEach((piece, index) => joinedPaint.drawImage(piece, xs[index % 3], ys[Math.floor(index / 3)]));
      const a = originalPaint.getImageData(0, 0, original.width, original.height).data;
      const b = joinedPaint.getImageData(0, 0, joined.width, joined.height).data;
      let mismatchedChannels = 0, mismatchedAlpha = 0, maxDelta = 0; const mismatchSamples: number[][] = [];
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) {
        mismatchedChannels++; maxDelta = Math.max(maxDelta, Math.abs(a[i] - b[i]));
        if (i % 4 === 3) mismatchedAlpha++;
        if (mismatchSamples.length < 8) mismatchSamples.push([i, a[i], b[i]]);
      }

      // Transparent frames and asymmetric markers expose accidental trimming, repetition or reflection.
      const png = (rectangles: [number, number, number, number, string][]) => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
        const paint = canvas.getContext('2d')!;
        for (const [x, y, width, height, color] of rectangles) { paint.fillStyle = color; paint.fillRect(x, y, width, height); }
        return { image: canvas.toDataURL('image/png'), width: 48, height: 48 };
      };
      const parts = completeWallSpriteParts({
        'back-left': png([[0, 0, 12, 48, '#00cc00'], [12, 0, 12, 48, '#0000cc']]),
        back: png([[0, 0, 48, 8, '#eecc00']]),
        'back-right': png([[24, 0, 12, 48, '#cc6600'], [36, 0, 12, 48, '#6600cc']]),
        // Isolated bottom-row spill must not become part of the wall's predominant vertical band.
        'side-left': png([[0, 0, 12, 24, '#117711'], [0, 24, 12, 24, '#22aa22'], [45, 47, 3, 1, '#ff0000']]),
        center: png([[0, 0, 48, 48, '#ff00ff']]),
        'side-right': png([[36, 0, 12, 24, '#009999'], [36, 24, 12, 24, '#00cccc'], [0, 47, 3, 1, '#ff0000']]),
        'corner-left': png([[0, 0, 12, 48, '#cc11cc']]),
        front: png([[0, 24, 48, 12, '#dd1100'], [0, 36, 48, 12, '#ff6600']]),
        'corner-right': png([[36, 0, 12, 48, '#00dddd']]),
      });
      const paddedParts = completeWallSpriteParts({ ...parts, body: undefined,
        front: png([[0, 12, 48, 12, '#dd1100'], [0, 24, 48, 12, '#ff6600'], [0, 46, 48, 2, '#ffffff01']]),
        'corner-left': png([[0, 0, 12, 36, '#cc11cc'], [0, 46, 12, 2, '#ffffff01']]),
        'corner-right': png([[36, 0, 12, 36, '#00dddd'], [36, 46, 12, 2, '#ffffff01']]),
      });
      const synthetic = new WallSpriteArt({ version: 1, issues: [], kits: [
        { id: 'asymmetric-grid', name: 'Grid', material: 'rock', tileSize: 48, levelHeight: 16, pixelated: true, layout: 'grid-3x3', parts },
        { id: 'padded-grid', name: 'Padded grid', material: 'rock', tileSize: 48, levelHeight: 16, pixelated: true, layout: 'grid-3x3', parts: paddedParts },
      ] });
      const actualArt = new WallSpriteArt(catalog); await Promise.all([synthetic.ready, actualArt.ready]);
      const cell = { x: 0, y: 0, surfaceId: 'ground', elevation: 3, material: 'grass', wallMaterial: 'rock', kind: 'ground', wallSkin: 'asymmetric-grid' };
      const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#1b1b1b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const pixel = (x: number, y: number) => [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data];
      const contour = (north: boolean, west: boolean, east: boolean, nw = false, ne = false) => ({
        outline: [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 48 }, { x: 0, y: 48 }],
        edges: { north: [{ x: 0, y: 0 }, { x: 48, y: 0 }], south: [], east: [], west: [] },
        corners: [nw ? [{ x: 0, y: 0 }, { x: 10, y: 0 }] : [], ne ? [{ x: 38, y: 0 }, { x: 48, y: 10 }] : [], [], []],
        exposed: { north, west, east, south: false }, southFace: [], inlets: [],
      });
      const tops = [contour(true, false, false), contour(true, true, false, true), contour(true, false, true, false, true),
        contour(false, true, false), contour(false, false, true), contour(false, false, false), contour(true, true, true, true, true)];
      tops.forEach((outline, index) => synthetic.paintRim(ctx, cell, outline, 30 + index * 70, 30));
      const rimSamples = [pixel(54, 27), pixel(54, 50), pixel(97, 50), pixel(109, 50), pixel(129, 50),
        pixel(209, 50), pixel(221, 50), pixel(176, 50), pixel(235, 34), pixel(235, 66), pixel(264, 50),
        pixel(361, 34), pixel(361, 66), pixel(316, 50), pixel(404, 50),
        pixel(447, 50), pixel(459, 50), pixel(489, 50), pixel(501, 50)];
      const face = (x: number, height: number, left = false, right = false) => {
        ctx.save(); ctx.beginPath(); ctx.rect(x - 48, 127, 144, height + 3); ctx.clip();
        synthetic.paintFace(ctx, cell, [{ x: 0, y: 0 }, { x: 48, y: 0 }], x, 130, height, undefined, undefined, { left, right }); ctx.restore();
      };
      const faceBands = [16, 48, 96].map((height, index) => {
        const x = 30 + index * 80; face(x, height);
        return [1 / 4, 5 / 8, 7 / 8].map(t => pixel(x + 24, 130 + height * t));
      });
      face(300, 96, true); face(380, 96, false, true); face(460, 96, true, true);
      const cornerSamples = [pixel(297, 190), pixel(340, 190), pixel(386, 190), pixel(431, 190), pixel(457, 190), pixel(511, 190), pixel(484, 190)];
      const paddedFace = (x: number, left: boolean, right: boolean) => {
        ctx.save(); ctx.beginPath(); ctx.rect(x - 48, 297, 144, 99); ctx.clip();
        synthetic.paintFace(ctx, { ...cell, wallSkin: 'padded-grid' }, [{ x: 0, y: 0 }, { x: 48, y: 0 }],
          x, 300, 96, undefined, undefined, { left, right }); ctx.restore();
      };
      paddedFace(30, false, false); paddedFace(110, true, false); paddedFace(190, false, true);
      const paddedFootSamples = [pixel(54, 316), pixel(54, 348), pixel(54, 380), pixel(54, 395),
        pixel(107, 395), pixel(152, 395), pixel(196, 395), pixel(241, 395)];
      // The source strip follows the sloped face, retaining its north-to-south bands.
      synthetic.paintFlank(ctx, cell, [{ x: 0, y: 0 }, { x: 0, y: 48 }], 600, 130, 96, 'west');
      synthetic.paintFlank(ctx, cell, [{ x: 48, y: 0 }, { x: 48, y: 48 }], 700, 130, 96, 'east');
      const flankSamples = [pixel(597, 190), pixel(597, 214), pixel(751, 190), pixel(751, 214)];
      const actualFlankCoverage = (['west', 'east'] as const).map(side => {
        const flank = document.createElement('canvas'); flank.width = 48; flank.height = 180;
        const paint = flank.getContext('2d')!, west = side === 'west';
        actualArt.paintFlank(paint, { ...cell, wallSkin: 'wall-roccia-grid' },
          [{ x: west ? 0 : 48, y: 0 }, { x: west ? 0 : 48, y: 48 }], west ? 24 : -24, 10, 96, side);
        return [0, 1, 2].map(third => {
          const data = paint.getImageData(0, 10 + third * 48, flank.width, 48).data;
          let painted = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) painted++;
          return painted;
        });
      });
      const actualSideExtents = (['west', 'east'] as const).map(side => {
        const drawing = document.createElement('canvas'); drawing.width = drawing.height = 160;
        const paint = drawing.getContext('2d')!;
        actualArt.paintRim(paint, { ...cell, wallSkin: 'wall-roccia-grid' }, contour(false, side === 'west', side === 'east'), 56, 56);
        const data = paint.getImageData(0, 72, drawing.width, 16).data;
        let left = drawing.width, right = -1;
        for (let y = 0; y < 16; y++) for (let x = 0; x < drawing.width; x++) if (data[(y * drawing.width + x) * 4 + 3] >= 16) {
          left = Math.min(left, x); right = Math.max(right, x);
        }
        return side === 'west' ? { exterior: 56 - left, interior: right - 56 + 1 }
          : { exterior: right - 103, interior: 104 - left };
      });
      const actualFaceFeet = [16, 48, 96, 192].map(height => {
        return [{ left: false, right: false }, { left: true, right: false }, { left: false, right: true }].map(terminals => {
          const face = document.createElement('canvas'); face.width = 68; face.height = height + 20;
          const paint = face.getContext('2d')!; paint.save(); paint.beginPath(); paint.rect(10, 10, 48, height); paint.clip();
          actualArt.paintFace(paint, { ...cell, elevation: height / 16, wallSkin: 'wall-roccia-grid' },
            [{ x: 0, y: 0 }, { x: 48, y: 0 }], 10, 10, height, undefined, undefined, terminals); paint.restore();
          const data = paint.getImageData(10, 10, 48, height).data;
          let lastRow = -1;
          for (let y = 0; y < height; y++) for (let x = 0; x < 48; x++) if (data[(y * 48 + x) * 4 + 3] >= 16) lastRow = y;
          return { height, gap: height - lastRow - 1 };
        });
      });
      const materials = new TerrainMaterials(), environment = new EnvironmentArt(), surfaces = new SurfaceTerrain(materials, environment, synthetic);
      await Promise.all([materials.ready, environment.ready, surfaces.rockArt.ready]);
      materials.fill = () => '#789855'; environment.paintGround = () => {};
      const cliffDraft = newWorldDocument(); cliffDraft.surfaceCells = [];
      for (let y = 2; y <= 4; y++) for (let x = 2; x <= 6; x++) cliffDraft.surfaceCells.push({
        ...cell, x, y, wallSkin: 'asymmetric-grid' });
      cliffDraft.surfaceLinks = [{ id: 'open-front', kind: 'stairs', from: { x: 4, y: 5, surfaceId: 'ground' },
        to: { x: 4, y: 4, surfaceId: 'ground' } }];
      const gridWorld = new World(cliffDraft.seed, 16, 'world', cliffDraft, []), ordinaryDraft = structuredClone(cliffDraft);
      ordinaryDraft.surfaceCells.forEach((surface: any) => { delete surface.wallSkin; });
      const ordinaryWorld = new World(ordinaryDraft.seed, 16, 'world', ordinaryDraft, []);
      let mode = 'grid'; const rockCalls = { grid: { face: 0, flank: 0, rim: 0 }, ordinary: { face: 0, flank: 0, rim: 0 } };
      for (const [method, counter] of [['paintFace', 'face'], ['paintFlank', 'flank'], ['paintRim', 'rim']] as const) {
        const original = surfaces.rockArt[method].bind(surfaces.rockArt);
        surfaces.rockArt[method] = (...args: any[]) => {
          rockCalls[mode as keyof typeof rockCalls][counter]++; return original(...args);
        };
      }
      const render = (world: any) => {
        const drawing = document.createElement('canvas'); drawing.width = drawing.height = 430;
        const paint = drawing.getContext('2d')!; paint.fillStyle = '#202020'; paint.fillRect(0, 0, drawing.width, drawing.height);
        for (const level of surfaces.levels(world, { left: 0, top: 0, right: 430, bottom: 430 })) surfaces.drawGroundLevel(paint, world, level);
        return (x: number, y: number) => [...paint.getImageData(x, y, 1, 1).data];
      };
      const gridPixel = render(gridWorld);
      const exteriorSamples = { north: gridPixel(168, 46), west: gridPixel(90, 108), east: gridPixel(342, 108),
        inside: [gridPixel(168, 57), gridPixel(104, 108), gridPixel(328, 108), gridPixel(216, 120), gridPixel(134, 143), gridPixel(298, 143)],
        corners: [gridPixel(90, 239), gridPixel(342, 239)], front: gridPixel(168, 239),
        clearMargin: gridPixel(168, 203), stairMouth: gridPixel(216, 228) };
      let worldFrontLastRow = -1;
      for (let y = 192; y < 240; y++) {
        const color = gridPixel(168, y);
        if (color[0] === 255 && color[1] === 102 && color[2] === 0) worldFrontLastRow = y;
      }
      const cornerJoinGaps = [90, 342].map(x => {
        let gaps = 0;
        for (let y = 178; y < 240; y++) {
          const color = gridPixel(x, y);
          if (color[0] === 32 && color[1] === 32 && color[2] === 32) gaps++;
        }
        return gaps;
      });
      const horseshoeDraft = newWorldDocument(); horseshoeDraft.surfaceCells = [];
      for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) if (x === 2 || x === 6 || y === 6)
        horseshoeDraft.surfaceCells.push({ ...cell, x, y, wallSkin: 'asymmetric-grid' });
      const horseshoePixel = render(new World(horseshoeDraft.seed, 16, 'world', horseshoeDraft, []));
      const horseshoeSamples = {
        crossbar: [horseshoePixel(147, 258), horseshoePixel(149, 268), horseshoePixel(285, 258), horseshoePixel(283, 268)],
        ownOverlap: [horseshoePixel(142, 216), horseshoePixel(289, 216)],
      };
      const separatedDraft = newWorldDocument(); separatedDraft.surfaceCells = [];
      for (const y of [7, 11]) for (let x = 2; x <= 4; x++)
        separatedDraft.surfaceCells.push({ ...cell, x, y, elevation: 12, wallSkin: 'asymmetric-grid' });
      const separatedPixel = render(new World(separatedDraft.seed, 16, 'world', separatedDraft, []));
      const projectedTopSamples = [separatedPixel(168, 308), separatedPixel(168, 354)];
      mode = 'ordinary'; const ordinaryPixel = render(ordinaryWorld);
      const ordinaryMargin = ordinaryPixel(168, 203);
      return { mismatchedChannels, mismatchedAlpha, maxDelta, mismatchSamples, sourceSize: [source.width, source.height],
        loadedActual: !!actualArt.kit({ ...cell, wallSkin: 'wall-roccia-grid' }), layout: actual.layout, rimSamples, faceBands, cornerSamples, paddedFootSamples, flankSamples, actualFlankCoverage, actualFaceFeet,
        rockCalls, exteriorSamples, cornerJoinGaps, horseshoeSamples, projectedTopSamples, actualSideExtents, worldFrontGap: 239 - worldFrontLastRow, ordinaryMargin };
    });
    assert.deepEqual(result.sourceSize, [1186, 1183]);
    assert.equal(result.loadedActual, true); assert.equal(result.layout, 'grid-3x3');
    const empty = [27, 27, 27, 255], green = [0, 204, 0, 255], blue = [0, 0, 204, 255];
    assert.deepEqual(result.rimSamples, [[238, 204, 0, 255], empty, green, blue, empty,
      [204, 102, 0, 255], [102, 0, 204, 255], empty, [17, 119, 17, 255], [34, 170, 34, 255], empty,
      [0, 153, 153, 255], [0, 204, 204, 255], empty, empty, green, blue, [204, 102, 0, 255], [102, 0, 204, 255]],
    'north corners retain their real directions, sides retain frame margins, and center never fills terrain');
    for (const bands of result.faceBands) assert.deepEqual(bands, [empty, [221, 17, 0, 255], [255, 102, 0, 255]],
      'each face fits its complete canvas once at any elevation, including the authored transparent half');
    assert.deepEqual(result.cornerSamples, [[204, 17, 204, 255], [221, 17, 0, 255], [221, 17, 0, 255], [0, 221, 221, 255], [204, 17, 204, 255], [0, 221, 221, 255], empty],
      'south corners sit outside the edge while front artwork fills their uncovered inward joins');
    assert.deepEqual(result.paddedFootSamples, [empty, [221, 17, 0, 255], [255, 102, 0, 255], [255, 102, 0, 255],
      [204, 17, 204, 255], [255, 102, 0, 255], [255, 102, 0, 255], [0, 221, 221, 255]],
    'a shared meaningful foot fills the real wall height while preserving horizontal and upper alpha margins and ignoring faint footer halos');
    assert.deepEqual(result.flankSamples, [[17, 119, 17, 255], [34, 170, 34, 255], [0, 153, 153, 255], [0, 204, 204, 255]],
      'both flank strips follow the sloped face with their authored north-to-south bands');
    for (const [side, coverage] of result.actualFlankCoverage.entries()) for (const [third, painted] of coverage.entries())
      assert.ok(painted > 0, `${side ? 'east' : 'west'} real flank must cover vertical third ${third}: ${coverage}`);
    for (const [side, extent] of result.actualSideExtents.entries()) {
      assert.ok(extent.exterior >= 8 && extent.exterior <= 30, `${side ? 'east' : 'west'} main rock band keeps a proportionate exterior width: ${JSON.stringify(extent)}`);
      assert.ok(extent.interior <= 3, 'isolated source spill cannot push rock farther than the slight overlap into the elevated grass');
    }
    for (const feet of result.actualFaceFeet) for (const [index, { height, gap }] of feet.entries()) {
      const tolerance = index === 0 ? 1 : Math.ceil(height * 6 / 344 + 1);
      assert.ok(gap <= tolerance, `${['front', 'corner-left', 'corner-right'][index]} must meet the ground at ${height}px: gap ${gap}px (tolerance ${tolerance}px)`);
    }
    assert.deepEqual(result.rockCalls.grid, { face: 0, flank: 0, rim: 0 }, 'the grid perimeter owns its artwork without the previous rock backing');
    for (const calls of Object.values(result.rockCalls.ordinary)) assert.ok(calls > 0, 'ordinary rock surfaces retain every existing rock painter');
    assert.deepEqual([result.exteriorSamples.north, result.exteriorSamples.west, result.exteriorSamples.east],
      [[238, 204, 0, 255], [17, 119, 17, 255], [0, 153, 153, 255]], 'the north and side PNG bands sit outside the elevated tile');
    assert.deepEqual(result.exteriorSamples.inside, Array(6).fill([120, 152, 85, 255]), 'grass beyond the slight perimeter overlap remains free of rock, including isolated footer spill');
    assert.deepEqual(result.exteriorSamples.corners, [[204, 17, 204, 255], [0, 221, 221, 255]], 'front corners extend outside the plateau edges');
    assert.deepEqual(result.cornerJoinGaps, [0, 0], 'exterior side bands join the front corners continuously down to the ground');
    assert.deepEqual(result.exteriorSamples.front, [255, 102, 0, 255], 'the front remains visible below the plateau');
    assert.equal(result.worldFrontGap, 0, 'the front uses the actual ground endpoint even when the old contour edge waves inward');
    assert.deepEqual(result.exteriorSamples.clearMargin, [32, 32, 32, 255], 'transparent grid pixels expose the terrain beneath without an old wall');
    assert.notDeepEqual(result.ordinaryMargin, result.exteriorSamples.clearMargin, 'ordinary walls preserve their backing');
    assert.deepEqual(result.exteriorSamples.stairMouth, [32, 32, 32, 255], 'the exterior wall keeps the physical stair opening clear');
    assert.deepEqual(result.horseshoeSamples.crossbar, Array(4).fill([120, 152, 85, 255]),
      'inner arm flanks remain beneath the raised bottom crossbar of a U-shaped plateau');
    assert.deepEqual(result.horseshoeSamples.ownOverlap, [[0, 204, 204, 255], [34, 170, 34, 255]],
      'the same arms retain their own slight rim overlap after the top is painted');
    assert.deepEqual(result.projectedTopSamples, [[221, 17, 0, 255], [120, 152, 85, 255]],
      'a tall front stays visible in the gap and remains beneath the projected top of a separate plateau to its south');

    await page.goto(`${server.resolvedUrls!.local[0]}surface-lab.html?scene=reference&wallSkin=wall-roccia-grid`);
    await expect(page.locator('#lab-wall-skin')).toHaveValue('wall-roccia-grid');
    await expect(page.locator('#lab-support')).toContainText('Quota 0', { timeout: 20_000 });
    mkdirSync('artifacts/cliff-analysis', { recursive: true }); await page.screenshot({ path: 'artifacts/cliff-analysis/wall-roccia-grid-lab.png' });
    const download = async () => {
      const pending = page.waitForEvent('download'); await page.locator('#lab-download').click();
      return parseWorldDocument(readFileSync((await (await pending).path())!, 'utf8'));
    };
    const gridMap = await download(); assert.ok(gridMap.surfaceCells!.some(cell => cell.wallSkin === 'wall-roccia-grid'));
    assert.ok(gridMap.surfaceCells!.filter(cell => cell.kind === 'bridge').every(cell => cell.wallSkin === undefined));
    await page.locator('#lab-wall-skin').selectOption(''); const ordinaryMap = await download();
    assert.deepEqual(gridMap.surfaceCells!.map(({ wallSkin, ...cell }) => cell), ordinaryMap.surfaceCells);
    assert.deepEqual(gridMap.surfaceLinks, ordinaryMap.surfaceLinks); assert.deepEqual(gridMap.surfaceStairs, ordinaryMap.surfaceStairs);
    await page.goto(`${server.resolvedUrls!.local[0]}world-maker.html`);
    for (const id of ['surface-wall-skin', 'asset-elevation-wall-skin']) await expect(page.locator(`#${id} option[value="wall-roccia-grid"]`)).toHaveCount(1);
    await page.goto(`${server.resolvedUrls!.local[0]}dungeon-maker.html`);
    await expect(page.locator('#dungeon-wall-skin option[value="wall-roccia-grid"]')).toHaveCount(1);
    assert.deepEqual(errors, []); assert.equal(readFileSync('shared/custom-world.json', 'utf8'), before);
    assert.equal(result.mismatchedChannels, 0,
      `nine PNGs reconstruct every decoded source pixel: ${JSON.stringify({ alpha: result.mismatchedAlpha, delta: result.maxDelta, samples: result.mismatchSamples })}`);
  } finally { await browser?.close(); await server.close(); }
});
