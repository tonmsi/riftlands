import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';

test('real touch swipes scroll settings without editing ranges; intentional tap, horizontal drag and keyboard still edit', { timeout: 40_000 }, async () => {
  const http = createHttpServer((request, response) => {
    if (request.url === '/range-review') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#app{padding:20px}.settings-actions{height:240px;width:280px;overflow:auto;touch-action:pan-y}.camera-options{padding:12px}label{display:block;margin:12px 0}input{display:block;width:240px;height:30px}small{display:block}details{margin:15px 0}</style><div id="app"><div class="settings-actions"></div></div>'); return;
    }
    vite.middlewares(request, response);
  });
  const vite = await createServer({ server: { middlewareMode: true, hmr: { server: http }, watch: null }, appType: 'mpa', logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${(http.address() as { port: number }).port}/range-review`);
    await page.evaluate(async () => {
      const { CameraOptions } = await import('/client/controls/camera-options.ts' as string);
      const { DeviceOptions } = await import('/client/controls/device-options.ts' as string);
      const { GameAudio } = await import('/client/core/audio.ts' as string);
      const root = document.querySelector<HTMLElement>('#app')!;
      new CameraOptions(root, { zoom: 1, viewLimit: 'standard' }, () => {});
      new DeviceOptions(root, new GameAudio(), () => {}, () => {});
      for (const details of root.querySelectorAll('details')) details.open = true;
      (window as any).edits = 0; root.addEventListener('input', () => (window as any).edits++);
    });
    const cdp = await context.newCDPSession(page);
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) => {
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    };
    const ranges = page.locator('input[type=range]'); assert.equal(await ranges.count(), 7);
    for (let i = 0; i < await ranges.count(); i++) {
      const range = ranges.nth(i); await range.evaluate(e => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(220);
      const before = await range.inputValue(), box = (await range.boundingBox())!;
      const x = box.x + box.width * .25, y = box.y + box.height / 2;
      await touch('touchStart', x, y); assert.equal(await range.inputValue(), before, 'touch down must not jump the value');
      for (let step = 1; step <= 6; step++) { await touch('touchMove', x + 2, y - step * 10); await page.waitForTimeout(25); }
      await touch('touchEnd'); assert.equal(await range.inputValue(), before, 'vertical swipe must not edit');
      if (i === 0) assert.ok(await page.locator('.settings-actions').evaluate(e => e.scrollTop) > 0, 'menu really scrolls');
    }
    assert.equal(await page.evaluate(() => (window as any).edits), 0);
    const zoom = page.locator('[data-camera-zoom]'); await zoom.evaluate(e => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(300);
    let box = (await zoom.boundingBox())!;
    await touch('touchStart', box.x + box.width * .7, box.y + 15);
    await touch('touchEnd'); assert.ok(Number(await zoom.inputValue()) > 150, 'intentional tap edits on release');
    await touch('touchStart', box.x + box.width * .7, box.y + 15);
    await touch('touchMove', box.x + box.width * .3, box.y + 16);
    await touch('touchEnd'); assert.ok(Number(await zoom.inputValue()) < 150, 'horizontal dragging edits');
    await page.mouse.click(box.x + box.width * .75, box.y + 15);
    assert.ok(Number(await zoom.inputValue()) > 150, 'mouse remains usable on a touch device');
    const current = Number(await zoom.inputValue()); await zoom.focus(); await page.keyboard.press('ArrowRight');
    assert.equal(Number(await zoom.inputValue()), current + 5);
    // A tap stopping a recent scroll must not become a range edit.
    await page.locator('.settings-actions').evaluate(e => { e.scrollTop += 1; e.dispatchEvent(new Event('scroll')); });
    const before = await zoom.inputValue(); box = (await zoom.boundingBox())!;
    await touch('touchStart', box.x + box.width * .9, box.y + 15); await touch('touchEnd'); assert.equal(await zoom.inputValue(), before);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await vite.close(); await new Promise<void>(resolve => http.close(() => resolve())); }
});
