import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('continuous 45 degree stairs meet PNG rock walls without a base slab and keep feet and camera continuous', { timeout: 60_000 }, async () => {
  const installedBefore = readFileSync('shared/custom-world.json', 'utf8');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } }), errors: string[] = [];
    await page.addInitScript('window.__name = value => value'); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/incline-render-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas style="width:1100px;height:760px"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}incline-render-review`);
    const result = await page.evaluate(async () => {
      const { Renderer } = await import('/client/render/render.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const { planStair, stairGeometry } = await import('/shared/surface-stairs.ts' as string);
      const { moveWalkingWithCollisions } = await import('/shared/physics.ts' as string);
      const doc = newWorldDocument(); doc.placements = []; doc.npcs = []; doc.surfaceCells = [];
      for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) doc.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
      for (let y = 6; y <= 10; y++) for (let x = 7; x <= 11; x++) doc.surfaceCells.push({ x, y, elevation: 3,
        material: 'grass', wallMaterial: 'rock', wallSkin: 'wall-roccia', surfaceId: 'ground', kind: 'ground' });
      const paths = [[4, 8], [5, 8], [6, 8], [9, 11], [9, 12], [9, 13], [12, 7], [13, 7]];
      for (const [x, y] of paths) doc.tiles.find((t: any) => t.x === x && t.y === y)!.terrain = 'path';
      const banks = new World(doc.seed, 16, 'world', doc, []);
      const endpoints = [[6, 8, 7, 8, 'stairs'], [9, 11, 9, 10, 'stairs'], [12, 7, 11, 7, 'ramp']];
      doc.surfaceStairs = []; doc.surfaceLinks = [];
      for (const [x, y, tx, ty, kind] of endpoints) {
        const plan = planStair({ x, y, surfaceId: 'ground' }, { x: tx, y: ty, surfaceId: 'ground' },
          (x: number, y: number, id: string) => banks.surfaceAt(x, y, id), { id: `review-${doc.surfaceStairs.length}`, kind, profile: 'incline', angle: 45 });
        doc.surfaceCells.push(...plan.cells); doc.surfaceLinks.push(...plan.links); doc.surfaceStairs.push(plan.stair);
      }
      const world = new World(doc.seed, 16, 'world', doc, []), canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas);
      await renderer.spritesReady; renderer.world = world; renderer.weather = 'clear'; renderer.setCameraSettings({ zoom: 2, viewLimit: 'close' });
      const side = stairGeometry(doc.surfaceStairs[0]), front = stairGeometry(doc.surfaceStairs[1]);
      const actorAt = (g: any, t: number, id: string) => {
        const p = g.pointAt(t); return { ...p, ...world.surfaceState(p), id, kind: 'player', name: '', classId: 'warrior',
          radius: 15, hp: 100, maxHp: 100, resource: 100, maxResource: 100, aim: 0, speed: 190, level: 1, xp: 0,
          kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0,
          effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
      };
      const frame = { time: 301000, actors: [], projectiles: [], pickups: [], traps: [], events: [], selectedId: null, previewClass: 'warrior', playing: true };
      const midpoint = actorAt(side, .49, 'self'); renderer.render({ ...frame, self: midpoint, actors: [midpoint] });
      const initialScreen = renderer.worldToScreen(midpoint), pointer = renderer.screenToWorld(initialScreen.x, initialScreen.y);
      const cameraCentered = Math.abs(initialScreen.x - 550) < .01 && Math.abs(initialScreen.y - 380) < .01;
      const cameraTarget = { ...renderer.camera }, ctx = canvas.getContext('2d')!, feet: { x: number; y: number }[] = [];
      const originalDraw = renderer.characters.drawActor.bind(renderer.characters);
      renderer.characters.drawActor = (actor: any, ...args: any[]) => {
        const foot = new DOMPoint(actor.x, actor.y).matrixTransform(ctx.getTransform()); feet.push({ x: foot.x, y: foot.y });
        originalDraw(actor, ...args); ctx.save(); ctx.fillStyle = '#ff00ff'; ctx.fillRect(actor.x - 2, actor.y - 2, 4, 4); ctx.restore();
      };
      const before = actorAt(side, .4999, 'self'), after = actorAt(side, .5001, 'self');
      renderer.render({ ...frame, self: before, actors: [before], cameraTarget }); const beforeScreen = renderer.worldToScreen(before);
      const footPixel = [...ctx.getImageData(Math.round(feet[0].x), Math.round(feet[0].y), 1, 1).data];
      renderer.render({ ...frame, self: after, actors: [after], cameraTarget }); const afterScreen = renderer.worldToScreen(after);
      renderer.characters.drawActor = originalDraw;
      const walked = moveWalkingWithCollisions({ ...side.pointAt(0), ...world.surfaceState(side.pointAt(0)), radius: 15 }, 1, 0, 48 * Math.SQRT2, world);
      const scratch = document.createElement('canvas'); scratch.width = 800; scratch.height = 700;
      const paint = scratch.getContext('2d')!, surfaces = renderer.terrain.surfaceTerrain;
      surfaces.drawLinks(paint, world);
      const base = side.pointAt(-.2), bareBaseAlpha = paint.getImageData(Math.round(base.x), Math.round(base.y), 1, 1).data[3];
      const face = side.pointAt(.75), pngBodyAlpha = paint.getImageData(Math.round(face.x), Math.round(face.y + 12), 1, 1).data[3];
      const bodyKitLoaded = !!surfaces.wallArt.kit(doc.surfaceCells[0]);
      const composition = { x: 9 * 48, y: 9 * 48 - 20 }; renderer.camera.x = composition.x; renderer.camera.y = composition.y;
      const actors = [actorAt(side, 1.6, 'self'), actorAt(front, .6, 'front')];
      renderer.render({ ...frame, self: actors[0], actors, cameraTarget: composition });
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#15261ecc'; ctx.fillRect(24, 22, 1052, 78);
      ctx.fillStyle = '#edf1de'; ctx.font = '22px Segoe UI'; ctx.fillText('Parete inclinata calpestabile · scale e rampa a 45°', 42, 54);
      ctx.font = '16px Segoe UI'; ctx.fillText('PNG wall-roccia · 1 tile di corsa / 3 livelli · terreno libero alla base', 42, 82); ctx.restore();
      renderer.destroy();
      return { cameraCentered, pointer, midpoint, beforeScreen, afterScreen, feet, footPixel, bareBaseAlpha, pngBodyAlpha, bodyKitLoaded, walked, end: side.pointAt(1) };
    });
    assert.equal(result.cameraCentered, true);
    assert.ok(Math.hypot(result.pointer.x - result.midpoint.x, result.pointer.y - result.midpoint.y) < .001);
    assert.ok(Math.hypot(result.afterScreen.x - result.beforeScreen.x, result.afterScreen.y - result.beforeScreen.y) < .05, 'the discrete cell transition keeps a continuous visible path');
    assert.ok(Math.hypot(result.feet[0].x - result.beforeScreen.x, result.feet[0].y - result.beforeScreen.y) < .001);
    assert.deepEqual(result.footPixel, [255, 0, 255, 255], 'PNG terrain cannot cover the climbing feet');
    assert.equal(result.bareBaseAlpha, 0, 'the lower approach receives no additional stone slab');
    assert.equal(result.pngBodyAlpha, 255); assert.equal(result.bodyKitLoaded, true);
    assert.ok(Math.hypot(result.walked.x - result.end.x, result.walked.y - result.end.y) < 1e-7);
    assert.equal(result.walked.elevation, 3); assert.deepEqual(errors, []);
    assert.equal(readFileSync('shared/custom-world.json', 'utf8'), installedBefore);
    mkdirSync('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/inclined-stair-45.png' });
  } finally { await browser?.close(); await server.close(); }
});
