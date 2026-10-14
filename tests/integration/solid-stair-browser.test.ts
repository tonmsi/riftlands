import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('solid stairs stop a lateral ground entry; suspended stairs preserve that underpass and normal ascent', { timeout: 90_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 650 } }), errors: string[] = [];
    await page.addInitScript('window.__name = value => value'); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/solid-stair-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#17201a"><canvas width="1100" height="650"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}solid-stair-review`);
    const result = await page.evaluate(async () => {
      const { SurfaceTerrain } = await import('/client/render/surface-terrain.ts' as string);
      const { WallSpriteArt } = await import('/client/render/wall-sprite-art.ts' as string);
      const { TerrainMaterials } = await import('/client/render/terrain-materials.ts' as string);
      const { EnvironmentArt } = await import('/client/render/environment-art.ts' as string);
      const { authoredRockStairGeometry } = await import('/client/render/rock-cliff-geometry.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const { newTerrainReferenceDemoWorld } = await import('/shared/terrain-reference-demo.ts' as string);
      const { planStair } = await import('/shared/surface-stairs.ts' as string);
      const { collidesWorld, moveWithCollisions } = await import('/shared/physics.ts' as string);
      const source = document.createElement('canvas'); source.width = 48; source.height = 16;
      const sourcePaint = source.getContext('2d')!; sourcePaint.fillStyle = '#6f7884'; sourcePaint.fillRect(0, 0, 48, 16);
      const kit = new WallSpriteArt({ version: 1, issues: [], kits: [{ id: 'stair-body', name: 'Body test', material: 'rock',
        tileSize: 48, levelHeight: 16, pixelated: true,
        parts: { body: { image: source.toDataURL('image/png'), width: 48, height: 16 } } }] });
      const materials = new TerrainMaterials(), art = new EnvironmentArt(), surfaces = new SurfaceTerrain(materials, art, kit);
      await Promise.all([kit.ready, materials.ready, art.ready, surfaces.rockArt.ready]);
      const fixture = (underpass?: boolean) => {
        const doc = newWorldDocument(); doc.interiorBounds = { width: 12, height: 12, name: 'Stair body', pvp: false };
        for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) doc.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
        doc.surfaceCells = [3, 4, 5].map(y => ({ x: 8, y, elevation: 3, surfaceId: 'ground', kind: 'ground',
          material: 'grass', wallMaterial: 'rock', wallSkin: 'stair-body' }));
        const bankWorld = new World(doc.seed, 16, 'world', doc, []);
        const plan = planStair({ x: 4, y: 4, surfaceId: 'ground' }, { x: 8, y: 4, surfaceId: 'ground' },
          (x: number, y: number, id: string) => bankWorld.surfaceAt(x, y, id),
          { id: 'body-flight', width: 48, ...(underpass !== undefined ? { underpass } : {}), cells: doc.surfaceCells });
        doc.surfaceCells.push(...plan.cells); doc.surfaceLinks = plan.links; doc.surfaceStairs = [plan.stair];
        return { world: new World(doc.seed, 16, 'world', doc, []), stair: plan.stair };
      };
      const solid = fixture(), explicitSolid = fixture(false), suspended = fixture(true);
      const entry = { x: 6.5 * 48, y: 6.5 * 48, surfaceId: 'ground', elevation: 0, radius: 15 };
      const groundAttempt = (world: any) => moveWithCollisions(entry, 0, -1, 96, world);
      const stopped = groundAttempt(solid.world), stoppedExplicit = groundAttempt(explicitSolid.world);
      const under = groundAttempt(suspended.world);
      const ascent = (world: any) => moveWithCollisions({ x: 4.5 * 48, y: 4.5 * 48, surfaceId: 'ground', elevation: 0, radius: 15 }, 1, 0, 192, world);
      const solidClimb = ascent(solid.world), suspendedClimb = ascent(suspended.world);
      const probe = { x: 6.5 * 48, y: 4.5 * 48, surfaceId: 'ground', elevation: 0 };
      const solidCollision = collidesWorld(probe.x, probe.y, 15, solid.world, probe);
      const suspendedCollision = collidesWorld(probe.x, probe.y, 15, suspended.world, probe);
      const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#789855'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const draw = (world: any, offset: number) => {
        ctx.save(); ctx.translate(offset, 0);
        for (const level of surfaces.levels(world, { left: 0, top: 0, right: 580, bottom: 580 })) surfaces.drawLevel(ctx, world, level, 1000);
        surfaces.drawLinks(ctx, world); ctx.restore();
      };
      draw(solid.world, 0); draw(suspended.world, 500);
      const pixel = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
      const solidBody = pixel(312, 228), suspendedBody = pixel(812, 228);
      // Mutating the existing object must invalidate the cached solid geometry.
      const mutable = { ...solid.stair }, scratch = document.createElement('canvas'); scratch.width = 580; scratch.height = 400;
      const paint = scratch.getContext('2d')!;
      surfaces.rockArt.drawAuthoredStairs(paint, mutable);
      const cachedSolidAlpha = paint.getImageData(312, 228, 1, 1).data[3];
      mutable.underpass = true; paint.clearRect(0, 0, scratch.width, scratch.height);
      surfaces.rockArt.drawAuthoredStairs(paint, mutable);
      const cachedSuspendedAlpha = paint.getImageData(312, 228, 1, 1).data[3];
      const referenceDoc = newTerrainReferenceDemoWorld(), reference = new World(referenceDoc.seed, 16, 'world', referenceDoc, []);
      const bridgeUnder = moveWithCollisions({ x: 17.5 * 48, y: 15.5 * 48, surfaceId: 'ground', elevation: 0, radius: 15 }, 0, -1, 6 * 48, reference);
      const mark = (point: any, offset: number) => {
        ctx.save(); ctx.fillStyle = '#d92337'; ctx.beginPath(); ctx.arc(point.x + offset, point.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      };
      mark(stopped, 0); mark(under, 500);
      ctx.fillStyle = '#e8eddb'; ctx.font = '20px Segoe UI'; ctx.fillText('Scala solida · ingresso laterale bloccato', 55, 55);
      ctx.fillText('Scala sospesa · passaggio esplicito sotto', 550, 55);
      ctx.font = '16px Segoe UI'; ctx.fillText('Entrambe conservano la salita e i pianerottoli.', 285, 520);
      return { stopped, stoppedExplicit, under, solidClimb, suspendedClimb, solidCollision, suspendedCollision,
        solidBody, suspendedBody, cachedSolidAlpha, cachedSuspendedAlpha, bridgeUnder,
        solidSide: authoredRockStairGeometry(solid.stair).sideFace.length,
        suspendedSide: authoredRockStairGeometry(suspended.stair).sideFace.length };
    });
    assert.ok(result.stopped.y >= 255 - 1e-6, 'a radius15 actor cannot enter the solid body through its south side');
    assert.deepEqual(result.stoppedExplicit, result.stopped, 'missing and false underpass flags are equally solid');
    assert.equal(result.solidCollision, true); assert.equal(result.suspendedCollision, false);
    assert.ok(Math.abs(result.under.y - 216) < 1e-6); assert.equal(result.under.elevation, 0); assert.equal(result.under.surfaceId, 'ground');
    for (const climb of [result.solidClimb, result.suspendedClimb]) {
      assert.ok(Math.abs(climb.x - 408) < 1e-6); assert.equal(climb.surfaceId, 'ground'); assert.equal(climb.elevation, 3);
    }
    assert.notDeepEqual(result.solidBody, [120, 152, 85, 255]);
    assert.deepEqual(result.suspendedBody, [120, 152, 85, 255], 'a suspended flight draws no solid triangle with either base art or PNG body');
    assert.ok(result.solidSide > 0); assert.equal(result.suspendedSide, 0);
    assert.equal(result.cachedSolidAlpha, 255); assert.equal(result.cachedSuspendedAlpha, 0, 'same-object toggling invalidates the cached geometry');
    assert.ok(Math.abs(result.bridgeUnder.x - 840) < 1e-6 && Math.abs(result.bridgeUnder.y - 456) < 1e-6);
    assert.equal(result.bridgeUnder.surfaceId, 'ground'); assert.equal(result.bridgeUnder.elevation, 0);
    assert.deepEqual(errors, []);
    mkdirSync('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/solid-and-suspended-stairs.png' });
  } finally { await browser?.close(); await server.close(); }
});
