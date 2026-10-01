import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

test('HUD: round minimap, wider world map, consistent targets and compact overlays on desktop and touch', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    mkdirSync('test-results', { recursive: true });
    for (const [width, height, touch] of [[1440, 900, false], [390, 844, true], [844, 390, true], [667, 375, true]] as const) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
      const page = await context.newPage();
      await page.addInitScript('window.__name = value => value');
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('**/hud-review', route => route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>' }));
      await page.route('**/api/lobby', route => route.fulfill({ json: { account: null, friends: [], leaderboard: [] } }));
      await page.goto(`${server.resolvedUrls!.local[0]}hud-review`);
      await page.evaluate(async () => {
        for (const file of ['style', 'mobile', 'team', 'lobby', 'hud']) await import(`/client/${file}.css`);
        const { GameUI } = await import('/client/ui.ts' as string);
        const { drawMinimap } = await import('/client/render.ts' as string);
        const { World } = await import('/shared/world.ts' as string);
        const root = document.querySelector<HTMLElement>('#app')!;
        let ui: InstanceType<typeof GameUI>;
        const noop = () => {};
        ui = new GameUI(root, { joinCredentials: noop, joinSaved: noop, logout: noop, leave: noop, social: noop, select: () => ui.setSelected(null), cast: noop });
        ui.setAssetProgress(1, 1, 0);
        ui.setPlaying(true);
        const self = { id: 'self', name: 'LongCharacterName1234', kind: 'player', classId: 'paladin', level: 12, xp: 1255, kills: 4, deaths: 0, teamId: 'team', x: 0, y: 72, aim: 0, speed: 180, radius: 15, hp: 120, maxHp: 155, resource: 60, maxResource: 100, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
        const player = { ...self, id: 'friend', name: 'Guerriero del Nord', classId: 'warrior', hp: 95, maxHp: 170, resource: 50 };
        const npc = { ...self, id: 'boss', name: 'Guardiano della Soglia', kind: 'npc', npcKind: 'boss', teamId: null, hp: 850, maxHp: 1200, resource: 0, maxResource: 0 };
        const snapshot = { type: 'snapshot', tick: 1, time: Date.now(), ack: 0, self, actors: [self, player, npc], projectiles: [], pickups: [], events: [], online: 2, activeChunks: 1, gold: 1905, sanctuary: 'outside' };
        ui.setSnapshot(snapshot, 24);
        ui.setSocial({ friends: [{ id: 'friend', name: player.name, online: true }], requests: [], teamInvites: [], nearby: [], team: { id: 'team', leaderId: 'self', members: [self, player].map(actor => ({ id: actor.id, name: actor.name, hp: actor.hp, maxHp: actor.maxHp, online: true })) } });
        ui.setSelected(player);
        const world = new World();
        const draw = () => {
          drawMinimap(ui.compactMinimap, world, self, [player]);
          if (ui.minimapVisible) drawMinimap(ui.minimap, world, self, [player], [], 4800);
        };
        draw();
        document.querySelector('.map-toggle')!.addEventListener('click', () => requestAnimationFrame(draw));
        // Show terrain behind the HUD so transparency and contrast can be reviewed.
        drawMinimap(ui.canvas, world, self, [player], [], 1600);
        (window as any).hudFixture = { ui, npc };
      });
      await expect(page.locator('.compact-map')).toBeVisible();
      await expect(page.locator('.minimap-panel')).toBeHidden();
      const compact = (await page.locator('.compact-map').boundingBox())!;
      const player = (await page.locator('.player-panel').boundingBox())!;
      assert.ok(player.x + player.width <= compact.x && compact.y < 25, 'round map sits on the right without overlapping the player');
      assert.ok(compact.x > width - compact.width - 25, 'minimap is anchored to the right edge');
      assert.equal(await page.locator('.compact-map').evaluate(e => getComputedStyle(e).borderRadius), '50%');
      await expect(page.locator('.target-summary strong')).toHaveText('Guerriero del Nord');
      const target = (await page.locator('.target-panel').boundingBox())!;
      const toolbar = (await page.locator('.game-top-right').boundingBox())!;
      assert.ok(target.x + target.width <= toolbar.x || toolbar.y + toolbar.height <= target.y, 'target and toolbar do not overlap');
      const styles = await page.locator('.player-panel,.target-panel').evaluateAll(elements => elements.map(e => [getComputedStyle(e).backgroundImage, getComputedStyle(e).borderRadius]));
      assert.deepEqual(styles[0], styles[1], 'player and selected actor share a surface');
      await page.screenshot({ path: `test-results/hud-${width}x${height}.png` });
      await page.locator('.map-toggle').click();
      await expect(page.locator('.minimap-panel')).toBeVisible();
      await expect(page.locator('.minimap')).toHaveAttribute('data-world-span', '4800');
      await expect(page.locator('.compact-minimap')).toHaveAttribute('data-world-span', '1600');
      assert.ok((await page.locator('.minimap-panel').boundingBox())!.width <= 281, 'expanded map keeps compact physical dimensions');
      assert.equal(await page.evaluate(() => (window as any).hudFixture.ui.inputBlocked), true);
      await page.screenshot({ path: `test-results/hud-map-${width}x${height}.png` });
      await page.locator('[data-ref="map-close"]').click();
      await expect(page.locator('.compact-map')).toBeVisible();
      await page.locator('.target-summary').click();
      await expect(page.locator('[data-ref="target-actions"]')).toBeVisible();
      await page.evaluate(() => { const { ui, npc } = (window as any).hudFixture; ui.setSelected(npc); });
      await expect(page.locator('.target-summary-resource')).toBeHidden();
      await expect(page.locator('.target-summary strong')).toHaveText('Guardiano della Soglia');
      await page.locator('.target-summary').click();
      await expect(page.locator('[data-ref="target-actions"]')).toBeHidden();
      await page.locator('[data-ref="target-close"]').click();
      await expect(page.locator('[data-ref="target"]')).toBeHidden();
      await page.locator('[data-ref="social-toggle"]').click();
      await expect(page.locator('.social-panel')).toBeVisible();
      await page.screenshot({ path: `test-results/hud-friends-${width}x${height}.png` });
      await page.locator('[data-ref="settings-toggle"]').click();
      await expect(page.locator('.social-panel')).toBeHidden();
      await expect(page.locator('.settings-panel')).toBeVisible();
      await page.screenshot({ path: `test-results/hud-settings-${width}x${height}.png` });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser?.close(); await server.close(); }
});
