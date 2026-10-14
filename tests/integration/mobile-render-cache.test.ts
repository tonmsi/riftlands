import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

test('touch renderer reuses static planes through fishing zoom and invalidates edits', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
    const page = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, deviceScaleFactor: 3 });
    await page.addInitScript('window.__name = value => value');
    await page.route('**/mobile-cache-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas style="width:844px;height:390px"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}mobile-cache-review`);
    const result = await page.evaluate(async () => {
      const { Renderer } = await import('/client/render/render.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const doc = newWorldDocument(); doc.surfaceCells = [];
      for (let y = -12; y <= 12; y++) for (let x = -18; x <= 18; x++) doc.tiles.push({ x, y, terrain: 'grass' });
      for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) doc.surfaceCells.push({ x, y, surfaceId: 'ground', elevation: 2, material: 'grass', wallMaterial: 'rock', kind: 'ground' });
      const renderer = new Renderer(document.querySelector('canvas')!, []);
      await renderer.spritesReady; await new Promise(requestAnimationFrame);
      const world = new World(37, 16, 'world', doc, []); renderer.world = world;
      let terrainBuilds = 0, groundBuilds = 0;
      const terrain = renderer.terrain, surfaces = terrain.surfaceTerrain;
      const originalTerrain = terrain.drawTerrain.bind(terrain), originalGround = surfaces.drawGroundLevel.bind(surfaces);
      terrain.drawTerrain = (...args: any[]) => { terrainBuilds++; return originalTerrain(...args); };
      surfaces.drawGroundLevel = (...args: any[]) => { groundBuilds++; return originalGround(...args); };
      const self = { id: 'self', kind: 'player', classId: 'mage', name: 'Probe', x: 72, y: 72, surfaceId: 'ground', elevation: 2,
        radius: 15, hp: 100, maxHp: 100, resource: 100, maxResource: 100, aim: 0, level: 1, xp: 0, effects: [], cooldowns: {}, teamId: null };
      const frame: any = { self, actors: [self], time: 301000, projectiles: [], pickups: [], traps: [], events: [], selectedId: null, previewClass: 'mage', playing: true };
      renderer.render(frame);
      // Allow bounded offscreen prefetch to complete before testing stationary zoom.
      for (let i = 0; i < 100; i++) renderer.render(frame);
      const warmTerrain = terrainBuilds, warmGround = groundBuilds;
      for (const phase of ['fight', undefined]) for (let i = 0; i < 30; i++) {
        frame.fishing = phase ? { phase } : undefined;
        frame.time += 1000 / 60; renderer.lastTime = performance.now() - 1000 / 60; renderer.render(frame);
      }
      const zoomTerrain = terrainBuilds, zoomGround = groundBuilds;
      world.authoringRevision++; renderer.render(frame);
      const editedTerrain = terrainBuilds, editedGround = groundBuilds;
      const screen = renderer.worldToScreen(self), restored = renderer.screenToWorld(screen.x, screen.y);
      const pixels = terrain.groundPixels;
      renderer.destroy();
      return { warmTerrain, warmGround, zoomTerrain, zoomGround, editedTerrain, editedGround, dpr: renderer.dpr,
        pointerError: Math.hypot(restored.x - self.x, restored.y - self.y), pixels, released: terrain.groundPixels };
    });
    assert.equal(result.dpr, 1.25);
    assert.equal(result.zoomTerrain, result.warmTerrain, 'zoom must not repaint the complete base terrain');
    assert.equal(result.zoomGround, result.warmGround, 'static ground must not rerasterize every frame');
    assert.ok(result.editedTerrain > result.zoomTerrain && result.editedGround > result.zoomGround, 'authoring changes invalidate both caches');
    assert.ok(result.pointerError < .001, 'lower raster density and camera zoom preserve logical picking');
    assert.ok(result.pixels > 0 && result.pixels <= 3_000_000);
    assert.equal(result.released, 0, 'destroy releases cached planes');
  } finally { await browser?.close(); await server.close(); }
});

test('mobile lobby loads without rendering the hidden world canvas', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/client/render/render.ts*', async route => {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({ response, body: body + '\nglobalThis.__worldDraws = 0; const originalProbeRender = Renderer.prototype.render; Renderer.prototype.render = function(frame) { globalThis.__worldDraws++; return originalProbeRender.call(this, frame); };' });
    });
    await page.goto(server.resolvedUrls!.local[0], { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.lobby')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-ref=menu-boot]')).toBeHidden();
    await expect(page.locator('.world-stage')).toBeHidden();
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => (globalThis as any).__worldDraws), 0);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
