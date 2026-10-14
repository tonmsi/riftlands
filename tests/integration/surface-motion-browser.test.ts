import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('renderer, camera and pointer share the continuous stair height while ground beneath the bridge stays flat', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } }), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript('window.__name = value => value');
    await page.route('**/motion-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas style="width:1000px;height:700px"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}motion-review`);
    const result = await page.evaluate(async () => {
      const { Renderer } = await import('/client/render/render.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newSurfaceDemoWorld } = await import('/shared/surface-demo.ts' as string);
      const doc = newSurfaceDemoWorld(), world = new World(doc.seed, 16, 'world', doc, []);
      const canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas, []);
      await renderer.spritesReady; renderer.world = world; renderer.weather = 'clear';
      const actor = { id: 'self', kind: 'player', name: 'Test', classId: 'warrior', x: 192.01, y: 360, surfaceId: 'ground', elevation: 2,
        radius: 15, hp: 100, maxHp: 100, resource: 100, maxResource: 100, aim: 0, speed: 190, level: 1, xp: 0,
        kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0,
        effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
      const baseFrame = { time: 301000, actors: [], projectiles: [], pickups: [], traps: [], events: [], selectedId: null, previewClass: 'warrior', playing: true };
      renderer.render({ ...baseFrame, self: actor, actors: [actor] });
      const initialScreen = renderer.worldToScreen(actor), pointer = renderer.screenToWorld(initialScreen.x, initialScreen.y);
      const cameraOnVisualHeight = Math.abs(initialScreen.x - 500) < .01 && Math.abs(initialScreen.y - 350) < .01;
      const ctx = canvas.getContext('2d')!, feet: { x: number; y: number }[] = [], drawOrder: string[] = [];
      const originalLevel = renderer.terrain.drawSurfaceLevel.bind(renderer.terrain);
      renderer.terrain.drawSurfaceLevel = (world: any, level: any, ...args: any[]) => {
        drawOrder.push(`surface:${level.elevation}`); originalLevel(world, level, ...args);
      };
      const originalDraw = renderer.characters.drawActor.bind(renderer.characters);
      renderer.characters.drawActor = (shown: any, ...args: any[]) => {
        const foot = new DOMPoint(shown.x, shown.y).matrixTransform(ctx.getTransform()); feet.push({ x: foot.x, y: foot.y });
        drawOrder.push(`actor:${shown.elevation}`); originalDraw(shown, ...args);
        // A small test foot mark makes later terrain occlusion observable in the final pixels.
        ctx.save(); ctx.fillStyle = '#ff00ff'; ctx.fillRect(shown.x - 2, shown.y - 2, 4, 4); ctx.restore();
      };
      const cameraTarget = { ...renderer.camera };
      const before = { ...actor, x: 191.99, elevation: 0 }, after = { ...actor, x: 192.01 };
      renderer.render({ ...baseFrame, self: before, actors: [before], cameraTarget }); const screenBefore = renderer.worldToScreen(before);
      const beforeFoot = [...ctx.getImageData(Math.round(feet[0].x), Math.round(feet[0].y), 1, 1).data], beforeImage = canvas.toDataURL();
      const beforeOrder = [...drawOrder];
      renderer.render({ ...baseFrame, self: after, actors: [after], cameraTarget }); const screenAfter = renderer.worldToScreen(after);
      const beneath = { ...actor, x: 10.5 * 48, surfaceId: 'ground', elevation: 0 };
      const deck = { ...beneath, surfaceId: 'bridge-demo', elevation: 2 };
      const beneathScreen = renderer.worldToScreen(beneath), deckScreen = renderer.worldToScreen(deck);
      renderer.destroy();
      return { cameraOnVisualHeight, pointer, actor, screenBefore, screenAfter, feet, beneathScreen, deckScreen, beforeFoot, beforeImage, beforeOrder };
    });
    assert.equal(result.cameraOnVisualHeight, true, 'camera follows the foot height between the two elevation endpoints');
    assert.ok(Math.abs(result.pointer.x - result.actor.x) < .001 && Math.abs(result.pointer.y - result.actor.y) < .001, 'pointer projection reverses the same displayed lift');
    assert.ok(Math.abs(result.screenAfter.y - result.screenBefore.y) < .1, 'crossing the collision cell boundary cannot cause a 32px jump');
    assert.ok(Math.abs(result.feet[1].y - result.feet[0].y) < .1, 'the body draw call uses the same continuous projection');
    assert.ok(Math.abs(result.feet[0].y - result.screenBefore.y) < .001);
    assert.deepEqual(result.beforeFoot, [255, 0, 255, 255], 'the lower half of the connector cannot paint over the displayed feet');
    assert.ok(result.beforeOrder.indexOf('surface:2') < result.beforeOrder.indexOf('actor:0'), 'upper connector terrain draws before the climbing body');
    assert.ok(result.beneathScreen.y - result.deckScreen.y > 20, 'over/under paths preserve their separate support');
    assert.deepEqual(errors, []);
    mkdirSync('artifacts', { recursive: true }); writeFileSync('artifacts/smooth-stair-boundary.png', Buffer.from(result.beforeImage.split(',')[1], 'base64'));
  } finally { await browser?.close(); await server.close(); }
});
