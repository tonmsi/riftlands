import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('hybrid terrain keeps authored edits, material cliffs and both bridge paths consistent', { timeout: 60000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.addInitScript('window.__name = (value) => value');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/surface-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#202b29"><canvas style="width:1000px;height:700px"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}surface-review`);
    const result = await page.evaluate(async () => {
      const { TerrainRenderer } = await import('/client/render/terrain-renderer.ts' as string);
      const { Renderer } = await import('/client/render/render.ts' as string);
      const { EnvironmentArt } = await import('/client/render/environment-art.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { drawMinimap } = await import('/client/render/minimap.ts' as string);
      const canvas = document.querySelector('canvas')!; canvas.width = 1000; canvas.height = 700;
      const ctx = canvas.getContext('2d')!, terrain = new TerrainRenderer(ctx);
      await terrain.spritesReady;
      const { TerrainMaterials } = await import('/client/render/terrain-materials.ts' as string);
      const materials = new TerrainMaterials();
      await materials.ready;
      for (const material of ['grass', 'path', 'rock', 'sand', 'wood', 'mud', 'snow', 'ice']) {
        const fill = materials.fill(ctx, material, materials.color(material));
        if (typeof fill === 'string') throw new Error(`Missing texture for ${material}`);
        ctx.fillStyle = fill; ctx.fillRect(0, 0, 384, 384);
        const pixels = ctx.getImageData(0, 0, 384, 384).data;
        const colors = new Set<string>();
        for (let i = 0; i < pixels.length; i += 64) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
        if (colors.size < 10) throw new Error(`Flat material instead of texture: ${material}`);
      }
      ctx.clearRect(0, 0, 1000, 700);
      const doc = newWorldDocument(); doc.interiorBounds = { width: 16, height: 12, name: 'Surface review', pvp: false };
      for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) doc.tiles.push({ x, y, terrain: 'grass' });
      doc.surfaceCells = [];
      for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) doc.surfaceCells.push({ x, y, surfaceId: 'ground', elevation: 2, material: 'grass', wallMaterial: 'rock', kind: 'ground' });
      for (let y = 2; y <= 4; y++) for (let x = 6; x <= 8; x++) doc.surfaceCells.push({ x, y, surfaceId: 'ground', elevation: 2, material: 'stone', wallMaterial: 'brick', kind: 'ground' });
      doc.surfaceCells.push({ x: 5, y: 3, surfaceId: 'bridge-demo', elevation: 2, material: 'wood', wallMaterial: 'wood', kind: 'bridge' });
      doc.surfaceLinks = [
        { id: 'stairs-demo', kind: 'stairs', from: { x: 3, y: 5, surfaceId: 'ground' }, to: { x: 3, y: 4, surfaceId: 'ground' } },
        { id: 'bridge-west', kind: 'bridge-entry', from: { x: 4, y: 3, surfaceId: 'ground' }, to: { x: 5, y: 3, surfaceId: 'bridge-demo' } },
        { id: 'bridge-east', kind: 'bridge-entry', from: { x: 5, y: 3, surfaceId: 'bridge-demo' }, to: { x: 6, y: 3, surfaceId: 'ground' } },
      ];
      const world = new World(23, 16, 'world', doc, []), bounds = { left: 0, top: 0, right: 768, bottom: 576 };
      terrain.drawEditorTerrain(world, 1000, ctx, bounds);
      const rockWall = [...ctx.getImageData(137, 222, 1, 1).data];
      const brickWall = [...ctx.getImageData(335, 222, 1, 1).data];
      const projectedTop = [...ctx.getImageData(110, 75, 1, 1).data];
      ctx.clearRect(0, 0, 1000, 700);
      terrain.drawEditorTerrain(world, 1000, ctx, bounds, { projectElevation: false });
      const gridTop = [...ctx.getImageData(110, 75, 1, 1).data];

      const bridge = terrain.surfaceLevels(world, bounds).find((level: any) => level.elevation === 2)!;
      const deck = { ...bridge, cells: bridge.cells.filter((cell: any) => cell.kind === 'bridge') };
      const underneath = { x: 264, y: 168, surfaceId: 'ground', elevation: 0 };
      const above = { ...underneath, surfaceId: 'bridge-demo', elevation: 2 };
      ctx.clearRect(0, 0, 1000, 700); terrain.drawSurfaceLevel(world, deck, 2000, ctx, [above]);
      const opaque = ctx.getImageData(264, 128, 1, 1).data[3];
      ctx.clearRect(0, 0, 1000, 700); terrain.drawSurfaceLevel(world, deck, 2100, ctx, [underneath]);
      ctx.clearRect(0, 0, 1000, 700); terrain.drawSurfaceLevel(world, deck, 2500, ctx, [underneath]);
      const faded = ctx.getImageData(264, 128, 1, 1).data[3];
      ctx.clearRect(0, 0, 1000, 700); terrain.drawSurfaceLevel(world, deck, 2600, ctx, [above]);
      ctx.clearRect(0, 0, 1000, 700); terrain.drawSurfaceLevel(world, deck, 3000, ctx, [above]);
      const recovered = ctx.getImageData(264, 128, 1, 1).data[3];

      const editorView = { camera: { x: 384, y: 288 }, width: 768, height: 576, dpr: 1, zoom: 1 };
      ctx.clearRect(0, 0, 1000, 700); terrain.drawCachedTerrain(world, editorView, 4000);
      const before = canvas.toDataURL();
      const originalTile = world.getTile.bind(world);
      world.getTile = (x: number, y: number) => x === 12 && y === 9 ? 'water' : originalTile(x, y);
      world.authoringRevision++;
      ctx.clearRect(0, 0, 1000, 700); terrain.drawCachedTerrain(world, editorView, 4000);
      const cacheUpdated = canvas.toDataURL() !== before;

      const art = new EnvironmentArt(); let queries = 0, isWater = true;
      const mutableWater = { authoringRevision: 0, getTile() { queries++; return isWater ? 'water' : 'grass'; } };
      art.paintWater(ctx, bounds, mutableWater); queries = 0; art.paintWater(ctx, bounds, mutableWater);
      const warmQueries = queries;
      isWater = false; mutableWater.authoringRevision++; queries = 0; art.paintWater(ctx, bounds, mutableWater);
      const revisionQueries = queries;

      const waterRockDocument = newWorldDocument();
      waterRockDocument.interiorBounds = { width: 8, height: 8, name: 'Water rocks', pvp: false };
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) waterRockDocument.tiles.push({ x, y,
        terrain: x >= 3 && x <= 4 && y >= 3 && y <= 4 ? 'rock' : 'water' });
      const waterRockWorld = new World(42, 16, 'world', waterRockDocument, []);
      const waterRockCanvas = document.createElement('canvas'); waterRockCanvas.width = waterRockCanvas.height = 384;
      const waterRockPainter = new TerrainRenderer(waterRockCanvas.getContext('2d')!); await waterRockPainter.spritesReady;
      waterRockPainter.drawTerrain(waterRockWorld, 5000, waterRockCanvas.getContext('2d')!, { left: 0, top: 0, right: 384, bottom: 384 });
      const waterRockCorner = [...waterRockCanvas.getContext('2d')!.getImageData(146, 146, 1, 1).data];
      const waterRockShore = waterRockPainter.surfaceTerrain.waterEdges(waterRockWorld, 3, 2).mask;
      const waterRockPhysical = waterRockWorld.getTile(3, 3) === 'rock' && waterRockWorld.isBlocked(3, 3);
      const originalRockTile = waterRockWorld.getTile.bind(waterRockWorld);
      waterRockWorld.getTile = (x: number, y: number) => x === 2 && y === 3 ? 'grass' : originalRockTile(x, y);
      waterRockWorld.authoringRevision++;
      const coastalRockShore = waterRockPainter.surfaceTerrain.waterEdges(waterRockWorld, 3, 2).mask;
      const coastalRockBank = waterRockPainter.surfaceTerrain.waterEdges(waterRockWorld,3,2).banks[2];
      const grassBank = waterRockPainter.surfaceTerrain.waterEdges(waterRockWorld,1,3).banks[1];
      const rockyDocument = newWorldDocument();
      for(let y=0;y<3;y++) for(let x=0;x<3;x++) rockyDocument.tiles.push({x,y,terrain:y===1?'water':'grass'});
      rockyDocument.surfaceCells = [{x:1,y:0,surfaceId:'ground',elevation:0,material:'rock',wallMaterial:'earth',kind:'ground'}];
      const authoredRockBank = waterRockPainter.surfaceTerrain.waterEdges(new World(42,16,'world',rockyDocument,[]),1,1).banks[0];

      const renderer = new Renderer(canvas, []); await renderer.spritesReady; renderer.world = world;
      const actor = { id: 'review-player', kind: 'player', classId: 'warrior', name: 'Review', ...above, radius: 15, hp: 100,
        maxHp: 100, resource: 100, maxResource: 100, aim: 0, level: 1, xp: 0, kills: 0, deaths: 0, speed: 170,
        teamId: null, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
      renderer.render({ time: 301000, self: actor, actors: [actor], projectiles: [], pickups: [], traps: [], events: [], selectedId: null, previewClass: 'warrior', playing: true });
      const screen = renderer.worldToScreen(actor), unprojected = renderer.screenToWorld(screen.x, screen.y);
      const pointerCorrect = Math.abs(unprojected.x - actor.x) < .001 && Math.abs(unprojected.y - actor.y) < .001;
      renderer.destroy();
      ctx.setTransform(1.4, 0, 0, 1.4, 40, 60); terrain.drawEditorTerrain(world, 5000, ctx, bounds);
      const miniDocument = newWorldDocument();
      miniDocument.surfaceCells = [{ x: 3, y: 3, surfaceId: 'ground', elevation: 0, material: 'water', wallMaterial: 'earth', kind: 'ground' },
        { x: 4, y: 3, surfaceId: 'bridge', elevation: 2, material: 'wood', wallMaterial: 'wood', kind: 'bridge' }];
      for (let y = -8; y <= 8; y++) for (let x = -8; x <= 8; x++) miniDocument.tiles.push({ x, y, terrain: 'grass' });
      const miniCanvas = document.createElement('canvas'); miniCanvas.style.cssText = 'position:fixed;left:0;top:0;width:160px;height:160px;opacity:0;pointer-events:none'; document.body.append(miniCanvas);
      drawMinimap(miniCanvas, new World(42, 16, 'world', miniDocument, []), null, [], [], 768);
      const minimapWater = [...miniCanvas.getContext('2d')!.getImageData(115, 115, 1, 1).data];
      const minimapBridge = [...miniCanvas.getContext('2d')!.getImageData(125, 115, 1, 1).data]; miniCanvas.remove();
      return { rockWall, brickWall, projectedTop, gridTop, opaque, faded, recovered, cacheUpdated, warmQueries, revisionQueries, pointerCorrect,
        patternsLoaded: terrain.materials.images.size, minimapWater, minimapBridge, waterRockCorner, waterRockShore, waterRockPhysical, coastalRockShore,
        coastalRockBank, grassBank, authoredRockBank };
    });
    assert.notDeepEqual(result.rockWall, result.brickWall, 'natural and masonry cliffs have distinct materials');
    assert.notDeepEqual(result.projectedTop, result.gridTop, 'editor can keep paint cells aligned while the game projects elevation');
    assert.equal(result.opaque, 255, 'the deck remains opaque for a player above');
    assert.ok(result.faded > 30 && result.faded < 130, 'a player below activates the existing opacity transition');
    assert.equal(result.recovered, 255, 'the deck recovers opacity when the player moves above');
    assert.ok(result.cacheUpdated, 'same-world authoring revisions invalidate the terrain bitmap');
    assert.equal(result.warmQueries, 0);
    assert.ok(result.revisionQueries > 0, 'water detail eligibility refreshes after an authored edit');
    assert.ok(result.pointerCorrect, 'pointer conversion reverses elevation for the controlled surface');
    assert.ok(result.minimapWater[1] > result.minimapWater[0] + 30 && result.minimapWater[2] > result.minimapWater[0] + 30, 'minimap sees authored water over the legacy grass tile');
    assert.ok(result.minimapBridge[0] > result.minimapBridge[2] + 30, 'minimap displays the upper wooden deck');
    assert.ok(result.waterRockPhysical, 'water scenery retains the original rock tile and collision');
    assert.equal(result.waterRockShore, 0, 'an isolated water rock group creates no artificial square bank');
    assert.ok(result.waterRockCorner[1] > result.waterRockCorner[0] + 30 && result.waterRockCorner[2] > result.waterRockCorner[0] + 30,
      'water is painted beneath the exposed corners of isolated rocks');
    assert.ok(result.coastalRockShore & 4, 'a rock touching land keeps its normal backing after an authored revision');
    assert.deepEqual(result.coastalRockBank,result.grassBank,'decorative rocks over grass keep the same warm bank palette and texture');
    assert.equal(result.authoredRockBank.kind,'rock','an authored rock surface retains its mineral bank');
    assert.deepEqual(errors, []);
    mkdirSync('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/hybrid-surfaces-review.png' });
  } finally { await browser?.close(); await server.close(); }
});
