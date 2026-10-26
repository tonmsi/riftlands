import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('renderer blends clear, rain, sleet and snow across authored temperature zones and suppresses indoor weather', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 } }), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message)); await page.addInitScript('window.__name = value => value');
    await page.route('**/weather-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#17231c;color:#eee;font:16px system-ui"><canvas style="width:480px;height:320px"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}weather-review`);
    const result = await page.evaluate(async () => {
      const { Renderer } = await import('/client/render/render.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const doc = newWorldDocument();
      doc.zones = [
        { id: 'warm', name: 'Caldo', priority: 1, shape: { kind: 'rect', x: 0, y: -20, width: 20, height: 40 }, temperature: .8 },
        { id: 'cold', name: 'Freddo', priority: 1, shape: { kind: 'rect', x: -20, y: -20, width: 20, height: 40 }, temperature: .1 },
      ];
      for (let y = -20; y < 20; y++) for (let x = -20; x < 20; x++) doc.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
      const canvas = document.querySelector('canvas')!, renderer: any = new Renderer(canvas, []);
      await renderer.spritesReady; renderer.world = new World(42, 16, 'world', doc, []);
      const self = { id: 'self', kind: 'player', x: 24, y: 24, name: 'Prova meteo', classId: 'warrior', radius: 15, hp: 100, maxHp: 100, resource: 100, maxResource: 100,
        aim: 0, speed: 200, level: 1, xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
      let time = 1000, rain = 0, snow = 0;
      const drawRain = renderer.drawRain.bind(renderer), drawSnow = renderer.drawSnow.bind(renderer);
      renderer.drawRain = (t: number, amount: number) => { rain = amount; drawRain(t, amount); };
      renderer.drawSnow = (t: number, amount: number) => { snow = amount; drawSnow(t, amount); };
      const frame = () => { rain = snow = 0; renderer.render({ time, self, actors: [self], projectiles: [], pickups: [], traps: [], events: [], selectedId: null, previewClass: 'warrior', playing: true }); };
      const advance = (frames: number) => { for (let i = 0; i < frames; i++) { time += 100; frame(); } };
      const captures: { title: string; src: string }[] = [];
      frame(); captures.push({ title: 'Sereno · inizio transizione', src: canvas.toDataURL() });
      advance(400); const warm = { rain, snow, kind: renderer.weather }; captures.push({ title: 'Pioggia · cielo coperto', src: canvas.toDataURL() });
      self.x = -24;
      // Sample the mixed phase rather than assuming a particular user-tuned fade duration.
      for (let i = 0; i < 200; i++) { advance(1); if (rain > .1 && snow > .3) break; }
      const mixed = { rain, snow, kind: renderer.weather }; captures.push({ title: 'Acquaneve · transizione', src: canvas.toDataURL() });
      advance(200); const cold = { rain, snow, kind: renderer.weather }; captures.push({ title: 'Neve · copertura più leggera', src: canvas.toDataURL() });
      let maxChange = 0, previousSnow = snow;
      for (let i = 0; i < 100; i++) { self.x = i % 2 ? -24 : 24; advance(1); maxChange = Math.max(maxChange, Math.abs(snow - previousSnow)); previousSnow = snow; }
      renderer.world.authoring.document.interiorBounds = { id: 'room', name: 'Interno', width: 40, height: 40 }; frame();
      const indoor = { rain, snow, kind: renderer.weather };
      renderer.destroy(); canvas.style.display = 'none';
      const gallery = document.createElement('div'); gallery.style.cssText = 'display:grid;grid-template-columns:480px 480px;gap:12px;padding:12px';
      for (const shot of captures) {
        const section = document.createElement('section'), title = document.createElement('p'), image = new Image();
        title.textContent = shot.title; image.src = shot.src; image.style.width = '480px'; await image.decode(); section.append(title, image); gallery.append(section);
      }
      document.body.append(gallery);
      return { warm, mixed, cold, maxChange, indoor };
    });
    assert.ok(result.warm.rain > .99 && result.warm.snow === 0);
    assert.ok(result.mixed.rain > .1 && result.mixed.snow > .1); assert.equal(result.mixed.kind, 'sleet');
    assert.ok(result.cold.snow > .99 && result.cold.rain < .01); assert.ok(result.maxChange < .101);
    assert.deepEqual(result.indoor, { rain: 0, snow: 0, kind: 'clear' }); assert.deepEqual(errors, []);
    await mkdir(resolve('.tmp'), { recursive: true });
    await page.screenshot({ path: resolve('.tmp/weather-transition-review.png'), fullPage: true });
  } finally { await browser?.close(); await server.close(); }
});
