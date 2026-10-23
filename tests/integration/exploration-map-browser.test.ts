import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('map fog reveals visited terrain, retains it, hides actors and separates interiors and characters', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 });
    await page.addInitScript('window.__name = value => value');
    await page.route('**/map-review', route => route.fulfill({ contentType: 'text/html', body: '<canvas style="width:300px;height:300px"></canvas>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}map-review`);
    const result = await page.evaluate(async () => {
      const { drawMinimap } = await import('/client/render/minimap.ts' as string);
      const { revealExploration } = await import('/shared/exploration.ts' as string);
      const { newNarrativeProgress } = await import('/shared/narrative.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const canvas = document.querySelector('canvas')!, world = new World(1, 16, 'world', newWorldDocument(), []);
      world.getTile = () => 'grass';
      const self = { id: 'self', x: 0, y: 0, hp: 100 }, npc = { id: 'hidden', kind: 'npc', x: 20.5 * 48, y: 1.5 * 48, hp: 100 };
      const progress = newNarrativeProgress(); revealExploration(progress, 'world', 0, 0);
      const draw = (p = progress, actors: unknown[] = [], mapId = 'world') => drawMinimap(canvas, world, self, actors, [], 4800, 1, p, mapId);
      const pixel = (tx: number, ty: number) => Array.from(canvas.getContext('2d')!.getImageData(Math.floor(150 + (tx + .5) * 3), Math.floor(150 + (ty + .5) * 3), 1, 1).data);
      draw(); const unknown = pixel(20, 1), visited = pixel(2, 2);
      draw(progress, [npc]); const hiddenActor = pixel(20, 1);
      revealExploration(progress, 'world', npc.x, npc.y); draw(); const revealed = pixel(20, 1), retained = pixel(2, 2);
      draw(progress, [npc]); const seenActor = pixel(20, 1);
      const restored = JSON.parse(JSON.stringify(progress)); draw(restored); const reloaded = pixel(20, 1);
      draw(restored, [], 'house'); const interior = pixel(20, 1);
      const other = newNarrativeProgress(); other.revision = progress.revision; draw(other); const otherCharacter = pixel(20, 1);
      return { unknown, visited, hiddenActor, revealed, retained, seenActor, reloaded, interior, otherCharacter };
    });
    assert.deepEqual(result.unknown, [17, 27, 37, 255]);
    assert.notDeepEqual(result.visited, result.unknown);
    assert.deepEqual(result.hiddenActor, result.unknown);
    assert.notDeepEqual(result.revealed, result.unknown);
    assert.deepEqual(result.retained, result.visited);
    assert.notDeepEqual(result.seenActor, result.revealed);
    assert.deepEqual(result.reloaded, result.revealed);
    assert.deepEqual(result.interior, result.unknown);
    assert.deepEqual(result.otherCharacter, result.unknown);
  } finally { await browser?.close(); await server.close(); }
});
