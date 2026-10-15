import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('tile walls carve all four stair corridors, keep side walls and clip PNGs to the summit', { timeout: 60_000 }, async () => {
  const installed = readFileSync('shared/custom-world.json', 'utf8');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } });
    const errors: string[] = [];
    await page.addInitScript('window.__name = value => value'); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/terraced-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#15251f"><canvas width="1440" height="1040"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}terraced-review`);
    const result = await page.evaluate(async () => {
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument, newWorldAsset, resizeWorldAsset, parseWorldDocument } = await import('/shared/world-schema.ts' as string);
      const { WorldElevationEditor, elevationControls, SurfaceStroke } = await import('/client/editors/world/elevation-editor.ts' as string);
      const { SurfaceTerrain } = await import('/client/render/surface-terrain.ts' as string);
      const { TerrainMaterials } = await import('/client/render/terrain-materials.ts' as string);
      const { EnvironmentArt } = await import('/client/render/environment-art.ts' as string);
      const { clipElevationAssetTop } = await import('/client/render/world-asset-art.ts' as string);
      const { moveWithCollisions } = await import('/shared/physics.ts' as string);
      const doc = newWorldDocument(); doc.surfaceCells = [];
      for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) doc.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
      for (let y = 6; y <= 18; y++) for (let x = 6; x <= 18; x++) doc.surfaceCells.push({ x, y, surfaceId: 'ground',
        kind: 'ground', elevation: 3, material: 'grass', wallMaterial: 'rock', layout: 'terraced', wallSkin: 'wall-roccia' });
      // An L-shaped two-level region exercises convex and reentrant wall joins.
      for (let y = 6; y <= 17; y++) for (let x = 23; x <= 30; x++) if (x <= 26 || y >= 12)
        doc.surfaceCells.push({ x, y, surfaceId: 'ground', kind: 'ground', elevation: 2, material: 'grass', wallMaterial: 'rock', layout: 'terraced' });
      let world = new World(doc.seed, 16, 'world', doc, []);
      const materials = new TerrainMaterials(), art = new EnvironmentArt(), terrain = new SurfaceTerrain(materials, art);
      await Promise.all([materials.ready, art.ready, terrain.rockArt.ready, terrain.wallArt.ready]);
      const scratch = document.createElement('canvas'); scratch.width = 1600; scratch.height = 1200;
      const paint = scratch.getContext('2d')!;
      const bounds = { left: 0, top: 0, right: 1536, bottom: 1152 };
      const drawWalls = (project = false) => { paint.clearRect(0, 0, 1600, 1200);
        for (const level of terrain.levels(world, bounds)) terrain.drawGroundLevel(paint, world, level, project); };
      const alphaAt = (x: number, y: number) => paint.getImageData(Math.round(x), Math.round(y), 1, 1).data[3];
      drawWalls(); const closed = alphaAt(6.5 * 48, 12.5 * 48);
      const controls = document.createElement('main'); controls.hidden = true; controls.innerHTML = elevationControls; document.body.append(controls);
      const editor = new WorldElevationEditor(controls, (change: () => void) => { change(); world = new World(doc.seed, 16, 'world', doc, []); }, () => doc, () => world, () => {});
      const ends = [[5, 12, 9, 12], [19, 12, 15, 12], [12, 19, 12, 15], [12, 5, 12, 9]];
      const walked: number[] = [];
      for (const [x, y, tx, ty] of ends) {
        // The first two clicks are away from the wall: authoring snaps to its two banks.
        editor.click({ x: x === 5 ? 3 : x, y, surfaceId: 'ground' });
        editor.click({ x: x === 5 ? 11 : tx, y: ty, surfaceId: 'ground' });
        const actor = { x: (x + .5) * 48, y: (y + .5) * 48, surfaceId: 'ground', elevation: 0, radius: 15 };
        const finish = moveWithCollisions(actor, Math.sign(tx - x), Math.sign(ty - y), 4 * 48, world);
        walked.push(finish.elevation);
      }
      parseWorldDocument(JSON.stringify(doc)); drawWalls();
      const openings = ends.map(([x, y, tx, ty]) => {
        const dx = Math.sign(tx - x), dy = Math.sign(ty - y);
        return [1, 2, 3].map(i => alphaAt((x + dx * i + .5) * 48, (y + dy * i + .5) * 48));
      });
      const sideWall = alphaAt(6.5 * 48, 11.5 * 48);
      const asset = newWorldAsset('summit-png', 'Sommità', '/world-assets/montagna/roccia-tile.png');
      asset.category = 'elevation'; resizeWorldAsset(asset, 13, 13);
      paint.clearRect(0, 0, 1600, 1200); paint.save();
      clipElevationAssetTop(paint, world, asset, { id: 'summit-art', assetId: asset.id, x: 6, y: 6, elevation: 3 });
      paint.fillStyle = '#ff00ff'; paint.fillRect(0, 0, 1600, 1200); paint.restore();
      const pngTop = alphaAt(12.5 * 48, 12.5 * 48 - 48), pngWall = alphaAt(6.5 * 48, 10.5 * 48 - 16);
      const pngLanding = alphaAt(9.25 * 48, 12.5 * 48 - 48);
      drawWalls(true); terrain.drawLinks(paint, world);
      const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#365a3e'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save(); ctx.translate(-100, -90); ctx.scale(.93, .93); ctx.drawImage(scratch, 0, 0);
      ctx.strokeStyle = '#172a2633'; ctx.lineWidth = 1;
      for (let x = 0; x < 32; x++) for (let y = 0; y < 24; y++) {
        const c = world.surfaceAt(x, y); ctx.strokeRect(x * 48, y * 48 - c.elevation * 16, 48, 48);
      }
      ctx.restore(); ctx.fillStyle = '#15251fe8'; ctx.fillRect(0, 0, 1440, 72);
      ctx.fillStyle = '#f0e6c9'; ctx.font = '24px Segoe UI'; ctx.fillText('Rialzo a quota 3 · tre fasce fisiche · quattro scale incassate', 28, 35);
      ctx.font = '17px Segoe UI'; ctx.fillText('Una cella di parete per quota; a destra, raccordi di un rialzo a L.', 28, 60);
      const count = doc.surfaceStairs?.length, profiles = doc.surfaceStairs?.map((s: { profile: string }) => s.profile);
      new SurfaceStroke(doc).paint({ x: 7, y: 12, surfaceId: 'ground' }, 'clear-link', {
        elevation: 3, material: 'grass', wallMaterial: 'rock', surfaceId: 'ground', blocked: false });
      world = new World(doc.seed, 16, 'world', doc, []); drawWalls();
      return { closed, openings, sideWall, count, profiles, walked, pngTop, pngWall, pngLanding,
        restored: alphaAt(7.5 * 48, 12.5 * 48), remaining: doc.surfaceStairs?.length };
    });
    assert.equal(result.closed, 255); assert.equal(result.count, 4);
    assert.deepEqual(result.profiles, ['terraced', 'terraced', 'terraced', 'terraced']);
    assert.deepEqual(result.walked, [3, 3, 3, 3]);
    assert.ok(result.openings.every((flight: number[]) => flight.every(alpha => alpha === 0)), JSON.stringify(result.openings));
    assert.equal(result.sideWall, 255); assert.equal(result.pngTop, 255); assert.equal(result.pngWall, 0);
    assert.equal(result.pngLanding, 255, 'the summit reaches its edge without an extra stone landing');
    assert.equal(result.restored, 255); assert.equal(result.remaining, 3);
    assert.deepEqual(errors, []); assert.equal(readFileSync('shared/custom-world.json', 'utf8'), installed);
    mkdirSync('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/terraced-terrain.png' });
  } finally { await browser?.close(); await server.close(); }
});
