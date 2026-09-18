import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium, expect, type Browser } from '@playwright/test';
import { AccountStore, publicAccount } from '../../server/store';

test('HUD settings on desktop/mobile and renderer entity churn', { timeout: 90_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-client-load-'));
  const store = new AccountStore(join(directory, 'accounts.json'));
  const user = store.register('HudTester', 'test-password'); store.flush();
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: resolve('.'), windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: store.path }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ended = once(child, 'close');
  let browser: Browser | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timeout')), 15000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('Riftlands:')) { clearTimeout(timer); resolve(); } });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exit ${code}`)); });
    });
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 }, hasTouch: mobile });
      await context.addInitScript(({ token, profile }) => {
        localStorage.setItem('riftlands.jwt', token); localStorage.setItem('riftlands.profile', JSON.stringify(profile));
        // Keep the emulated mobile viewport in portrait.
        Element.prototype.requestFullscreen = async () => {};
      }, { token: user.token, profile: publicAccount(user.account) });
      const page = await context.newPage(); const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${port}`); await page.locator('[data-ref=join]').click();
      await expect(page.locator('.game-hud')).toBeVisible();
      await expect(page.locator('.player-network [data-ref=online]')).toHaveText('1');
      assert.equal(await page.locator('[data-ref=coords], .map-coordinates, .map-actions, .map-network').count(), 0);
      await page.getByRole('button', { name: 'Impostazioni', exact: true }).click();
      await expect(page.locator('.settings-panel')).toBeVisible();
      await expect(page.locator('.settings-panel .fullscreen-toggle')).toBeVisible();
      await expect(page.locator('.settings-panel [data-ref=leave]')).toBeVisible();
      const audio = page.locator('.settings-panel button[aria-pressed]');
      await audio.click(); await expect(audio).toHaveAttribute('aria-pressed', 'true');
      const box = (await page.locator('.settings-toggle').boundingBox())!;
      assert.equal(box.width, box.height);
      const panel = (await page.locator('.settings-panel').boundingBox())!;
      assert.ok(panel.x >= 0 && panel.x + panel.width <= (mobile ? 390 : 1440));
      await page.screenshot({ path: `test-results/settings-${mobile ? 'mobile' : 'desktop'}.png` });
      await page.keyboard.press('Escape'); await expect(page.locator('.settings-panel')).toBeHidden();
      if (!mobile) {
        const result = await page.evaluate(async () => {
          const renderPath = '/client/render.ts', simPath = '/shared/config.ts';
          const { Renderer } = await import(renderPath);
          const { WORLD_SEED } = await import(simPath);
          const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:1280px;height:720px'; document.body.append(canvas);
          const renderer = new Renderer(canvas); await renderer.spritesReady; renderer.setSeed(WORLD_SEED);
          const self = { id: 'self', x: 0, y: 0, kind: 'player', classId: 'mage', name: 'Self', radius: 15, hp: 100, maxHp: 100, resource: 100, maxResource: 100, aim: 0, level: 1, xp: 0, effects: [], cooldowns: {}, teamId: null };
          const frame: any = { self, actors: [], projectiles: [], pickups: [], traps: [], events: [], time: 1000, selectedId: null, previewClass: 'mage', playing: true };
          const timings: number[] = [], crowdedTimings: number[] = []; let maxCache = 0;
          frame.events = Array.from({ length: 1000 }, (_, i) => ({ id: `hit-${i}`, kind: 'hit', targetId: `crowd-0-${i}`, x: 10000, y: 10000, at: 1000, duration: 1000 }));
          for (let batch = 0; batch < 80; batch++) {
            const visibleCount = batch < 40 ? 300 : 2000;
            frame.actors = Array.from({ length: 2000 }, (_, i) => ({ ...self, id: `crowd-${batch}-${i}`, kind: i % 2 ? 'npc' : 'player', npcKind: i % 2 ? 'slime' : undefined, x: i < visibleCount ? (i % 40) * 22 - 440 : 10000, y: i < visibleCount ? Math.floor(i / 40) * 10 - 250 : 10000 }));
            frame.time += 16;
            const start = performance.now(); renderer.render(frame); (batch < 40 ? timings : crowdedTimings).push(performance.now() - start);
            maxCache = Math.max(maxCache, renderer.classMotion.size);
          }
          frame.actors = []; renderer.render(frame);
          const retained = renderer.classMotion.size;
          renderer.destroy(); canvas.remove();
          timings.sort((a, b) => a - b); crowdedTimings.sort((a, b) => a - b);
          return { medianMs: timings[20], p95Ms: timings[38], crowdedMedianMs: crowdedTimings[20], crowdedP95Ms: crowdedTimings[38], maxCache, retained };
        });
        console.log('Synthetic crowd: 2000 entities, 300 / 2000 on screen', result);
        assert.ok(result.maxCache <= 2001); assert.ok(result.retained <= 1, 'departed entity animations are released');
      }
      await page.getByRole('button', { name: 'Impostazioni', exact: true }).click();
      await page.locator('.settings-panel [data-ref=leave]').click();
      if (mobile) await page.locator('[data-exit]').click();
      await expect(page.locator('.lobby')).toBeVisible();
      assert.deepEqual(errors, []); await context.close();
    }
  } finally {
    await browser?.close(); child.kill(); await ended;
  }
});
