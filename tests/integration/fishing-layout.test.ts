import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

test('fishing layout and popup locks work on PC, portrait and landscape touch', { timeout: 90000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true }); mkdirSync('test-results', { recursive: true });
    for (const [width, height] of [[1440, 900], [390, 844], [844, 390], [667, 375]]) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 1000, hasTouch: width < 1000 }), page = await context.newPage();
      await page.addInitScript('window.__name = value => value');
      await page.route('**/fishing-layout', route => route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>' }));
      await page.route('**/api/lobby', route => route.fulfill({ json: { account: null, friends: [], leaderboard: [] } }));
      await page.goto(`${server.resolvedUrls!.local[0]}fishing-layout`);
      await page.evaluate(async () => {
        for (const file of ['styles/style.css', 'styles/mobile.css', 'ui/hud/team.css', 'ui/lobby/lobby.css', 'ui/hud/hud.css', 'ui/interactions/interactions.css', 'fishing/fishing.css']) await import(`/client/${file}`);
        const { GameUI } = await import('/client/ui/ui.ts' as string), { MobileControls } = await import('/client/controls/mobile-controls.ts' as string), { CLASSES } = await import('/shared/config.ts' as string);
        const { FishingUI } = await import('/client/fishing/fishing-ui.ts' as string), { World } = await import('/shared/world.ts' as string);
        const root = document.querySelector<HTMLElement>('#app')!, noop = () => {};
        const ui = new GameUI(root, { joinCredentials: noop, joinSaved: noop, logout: noop, leave: noop, social: noop, select: noop, cast: noop, interact: noop, releaseControls: noop }); ui.setAssetProgress(1, 1, 0); ui.setPlaying(true);
        new MobileControls(root, { enabled: () => true, ability: (slot: 'basic' | 'q' | 'e' | 'r') => CLASSES.mage.abilities[slot], move: noop, aim: noop, cast: noop });
        const world = new World(); world.getTile = (x: number) => x > 1 ? 'water' : 'grass'; world.isBlocked = (x: number) => x > 1;
        const commands: unknown[] = [];
        const fishing = new FishingUI(root.querySelector('.game-hud')!, () => world, (x: number, y: number) => ({ x, y }), (command: unknown) => commands.push(command));
        const self = { id: 'self', name: 'Pescatore', kind: 'player', classId: 'mage', level: 1, xp: 0, kills: 0, deaths: 0, teamId: null, x: 0, y: 0, aim: 0, speed: 190, radius: 15, hp: 110, maxHp: 110, resource: 120, maxResource: 120, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
        const snapshot = { type: 'snapshot', tick: 1, time: Date.now(), ack: 0, self, actors: [self], projectiles: [], pickups: [], events: [], online: 1, activeChunks: 1, gold: 99,
          inventory: { version: 1, capacity: 5, backpackId: 'backpack-5', slots: [{ itemId: 'fishing-rod', quantity: 1 }, { itemId: 'slime-innards', quantity: 8 }, { itemId: 'healing-potion', quantity: 4 }, { itemId: 'backpack-2', quantity: 1 }, { itemId: 'fish-pike', quantity: 2 }] },
          fishing: { id: 'layout', phase: 'fight', distanceM: 2.6, tension: .97, danger: .8, progress: .4, reeling: false, baitId: 'gold', message: 'Tieni per recuperare · Rilascia per allentare' } };
        ui.setSnapshot(snapshot, 24); fishing.update(snapshot); (window as any).fishingLayout = { fishing, snapshot, commands };
      });
      await expect(page.locator('[data-ref=ability-bar]')).toBeHidden(); await expect(page.locator('.fishing-meter')).toBeVisible();
      await expect(page.locator('[data-fishing-help]')).toContainText('5,50');
      assert.equal(await page.locator('.fishing-ui').evaluate(el => getComputedStyle(el, '::before').animationName), 'fishing-comic');
      const selectors = ['.fishing-status', '.fishing-meter', '.fishing-baits', '.fishing-reel', ...(width < 1000 ? ['.mobile-joystick'] : [])];
      const boxes = await Promise.all(selectors.map(selector => page.locator(selector).boundingBox()));
      boxes.forEach((box, index) => assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, `${selectors[index]} fits ${width}x${height}`));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!;
        assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${selectors[i]} and ${selectors[j]} do not overlap at ${width}x${height}`);
      }
      const list = page.locator('[data-fishing-baits]'); await list.evaluate(node => { node.scrollLeft = node.scrollWidth; }); await expect(page.locator('[data-bait=gold]')).toBeInViewport();
      await page.evaluate(() => { const f = (window as any).fishingLayout; f.snapshot.fishing.tension = 1; f.fishing.update(f.snapshot); });
      await page.waitForTimeout(180);
      const meter = page.locator('.fishing-line-meter'), fill = page.locator('.fishing-line-meter>i');
      assert.equal(await fill.evaluate(el => getComputedStyle(el).left), '0px');
      const frame = (await meter.boundingBox())!, paint = (await fill.boundingBox())!;
      assert.ok(Math.abs(frame.width - paint.width) < 1 && Math.abs(frame.height - paint.height) < 1, '100% tension fills the whole bar on PC and touch');
      await page.screenshot({ path: `test-results/fishing-layout-${width}x${height}.png` });
      await page.evaluate(() => { const f = (window as any).fishingLayout; Object.assign(f.snapshot.fishing, { phase: 'result', outcome: 'caught', fishId: 'fish-pike', weightKg: 2.75, catchId: 'capture-1' }); f.fishing.update(f.snapshot); });
      const plaque = page.locator('.fishing-catch'); await expect(plaque).toBeVisible();
      await expect(page.locator('.fishing-catch-confetti i')).toHaveCount(72);
      if (width < 1000) await page.touchscreen.tap(width * .8, height * .5); else await page.mouse.click(width * .8, height * .5);
      await page.keyboard.press('Escape'); await expect(plaque).toBeVisible();
      await page.evaluate(() => { const f = (window as any).fishingLayout; f.fishing.press(); f.fishing.close(); });
      assert.equal(await page.evaluate(() => (window as any).fishingLayout.commands.length), 0, 'popup blocks direct reel and close commands');
      if (width === 1440) {
        await page.waitForTimeout(400);
        const earlyWeight = parseFloat((await page.locator('[data-catch-weight]').textContent())!);
        assert.ok(earlyWeight < 1, 'weight starts slowly');
        await expect(page.locator('[data-catch-weight]')).toHaveText('2.75 kg');
        await page.waitForTimeout(1500); await expect(plaque).toBeVisible();
      }
      await expect(page.locator('.fishing-catch-dismiss')).toHaveText('Tocca per continuare');
      await page.screenshot({ path: `test-results/fishing-catch-layout-${width}x${height}.png` });
      if (width < 1000) await page.touchscreen.tap(width * .8, height * .5);
      else await page.mouse.click(width * .8, height * .5);
      await expect(plaque).toBeHidden();
      await page.evaluate(() => { const f = (window as any).fishingLayout; f.fishing.update(f.snapshot); });
      await expect(plaque).toBeHidden();
      await page.evaluate(() => { const f = (window as any).fishingLayout; f.snapshot.fishing.catchId = 'capture-2'; f.fishing.update(f.snapshot); });
      await expect(plaque).toBeVisible();
      if (width < 1000) await plaque.tap(); else await plaque.click();
      await expect(plaque).toBeVisible();
      await expect(page.locator('.fishing-catch-dismiss')).toHaveText('Tocca per continuare');
      if (width < 1000) await plaque.tap(); else await plaque.click();
      await expect(plaque).toBeHidden();
      for (const [outcome, title] of [['broken', 'Filo spezzato!'], ['escaped', 'Pesce slamato!'], ['missed', 'Ferrata mancata!']]) {
        await page.evaluate(outcome => { const f = (window as any).fishingLayout; Object.assign(f.snapshot.fishing, { outcome, resultId: `loss-${outcome}`, baitId: undefined }); f.fishing.update(f.snapshot); }, outcome);
        await expect(plaque).toBeVisible(); await expect(plaque).toHaveClass(/is-lost/);
        await expect(page.locator('[data-catch-name]')).toHaveText(title); await expect(page.locator('.fishing-loss-symbol')).toBeVisible(); await expect(page.locator('[data-catch-weight]')).toBeHidden();
        await expect(page.locator('.fishing-catch-confetti i')).toHaveCount(0);
        if (width < 1000) await plaque.tap(); else await plaque.click();
        await page.keyboard.press('Space'); await expect(plaque).toBeVisible();
        await page.waitForTimeout(600);
        if (width < 1000) await page.touchscreen.tap(width * .8, height * .5); else await page.mouse.click(width * .8, height * .5);
        await expect(plaque).toBeVisible();
        if (outcome === 'broken') { await page.waitForTimeout(320); await page.screenshot({ path: `test-results/fishing-loss-${width}x${height}.png` }); }
        await expect(page.locator('.fishing-catch-dismiss')).toHaveText('Tocca per continuare');
        if (width < 1000) await plaque.tap(); else await plaque.click();
        await page.evaluate(() => { const f = (window as any).fishingLayout; f.fishing.update(f.snapshot); }); await expect(plaque).toBeHidden();
      }
      await page.evaluate(() => { const f = (window as any).fishingLayout; Object.assign(f.snapshot.fishing, { outcome: 'withdrawn', baitId: 'slime-innards', baitSlot: 1, baitUsesRemaining: 2 }); f.fishing.update(f.snapshot); });
      await expect(page.locator('.fishing-baits>span')).toContainText('2/3 LANCI'); await expect(page.locator('.fishing-reel')).toBeEnabled();
      await context.close();
    }
  } finally { await browser?.close(); await server.close(); }
});
