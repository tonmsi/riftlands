import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

test('HUD: centered map, circular portraits and non-blocking overlays on desktop and touch', { timeout: 60_000 }, async () => {
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
        for (const file of ['styles/style.css', 'styles/mobile.css', 'ui/hud/team.css', 'ui/lobby/lobby.css', 'ui/hud/hud.css', 'ui/interactions/interactions.css']) await import(`/client/${file}`);
        const { GameUI } = await import('/client/ui/ui.ts' as string);
        const { drawMinimap } = await import('/client/render/render.ts' as string);
        const { World } = await import('/shared/world.ts' as string);
        const root = document.querySelector<HTMLElement>('#app')!;
        let ui: InstanceType<typeof GameUI>;
        const noop = () => {};
        let releases = 0;
        let leaves = 0;
        const socialCommands: { action: string; targetId?: string }[] = [];
        ui = new GameUI(root, { joinCredentials: noop, joinSaved: noop, logout: noop, leave: () => leaves++, social: (action: string, targetId?: string) => socialCommands.push({ action, targetId }), select: () => ui.setSelected(null), cast: noop, releaseControls: () => releases++ });
        ui.setAssetProgress(1, 1, 0);
        ui.setPlaying(true);
        const self = { id: 'self', name: 'LongCharacterName1234', kind: 'player', classId: 'paladin', level: 12, xp: 1255, kills: 4, deaths: 0, teamId: 'team', x: 0, y: 72, aim: 0, speed: 180, radius: 15, hp: 120, maxHp: 155, resource: 60, maxResource: 100, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
        const player = { ...self, id: 'friend', name: 'Guerriero del Nord', classId: 'warrior', hp: 95, maxHp: 170, resource: 50 };
        const npc = { ...self, id: 'boss', name: 'Guardiano della Soglia', kind: 'npc', npcKind: 'boss', teamId: null, hp: 850, maxHp: 1200, resource: 0, maxResource: 0 };
        const time = Date.now();
        self.effects = ['haste', 'power', 'shield', 'slow', 'root', 'weakness'].map(kind => ({ kind, until: time + 45000, value: 1 })) as any;
        player.effects = self.effects;
        npc.effects = self.effects;
        const snapshot = { type: 'snapshot', tick: 1, time, ack: 0, self, actors: [self, player, npc], projectiles: [], pickups: [], events: [], online: 2, activeChunks: 1, gold: 1905, sanctuary: 'outside' };
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
        (window as any).hudFixture = { ui, npc, snapshot, socialCommands, releases: () => releases, leaves: () => leaves };
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
      assert.ok(toolbar.x + toolbar.width <= compact.x && Math.abs(toolbar.y - compact.y) <= 1, 'friends and currency sit beside the minimap');
      assert.ok(player.x + player.width <= toolbar.x, 'player and map toolbar do not overlap');
      assert.ok(player.height <= 105 && target.height <= 100, 'character frames leave room for XP and the portrait level does not enlarge them');
      assert.ok(target.x + target.width <= toolbar.x || toolbar.y + toolbar.height <= target.y, 'target and toolbar do not overlap');
      const styles = await page.locator('.player-panel,.target-panel').evaluateAll(elements => elements.map(e => [getComputedStyle(e).backgroundImage, getComputedStyle(e).borderRadius]));
      assert.deepEqual(styles[0], styles[1], 'player and selected actor share a surface');
      const teammateStyle = await page.locator('.team-member').evaluate(e => [getComputedStyle(e).backgroundImage, getComputedStyle(e).borderRadius]);
      if (touch) {
        assert.equal(teammateStyle[0], 'none', 'mobile teammates show only their portrait and health ring');
        assert.equal(player.height, 80);
        assert.equal(target.height, 60, 'selected actor stays compact while the player frame includes XP');
        assert.ok(player.x <= 5, 'mobile character HUD sits against the left safe edge');
        await expect(page.locator('.team-health-ring')).toBeVisible();
        await expect(page.locator('.team-member-resource')).toBeHidden();
        const ring = await page.locator('.team-ring-fill').evaluate(e => parseFloat((e as SVGElement).style.strokeDasharray));
        assert.ok(Math.abs(ring - 95 / 170 * 100) < .01);
        await page.evaluate(() => { const { ui, snapshot } = (window as any).hudFixture; snapshot.actors[1].hp = 34; ui.setSnapshot(snapshot, 24); });
        assert.equal(await page.locator('.team-ring-fill').evaluate(e => parseFloat((e as SVGElement).style.strokeDasharray)), 20, 'health ring follows live HP');
      } else assert.deepEqual(styles[0], teammateStyle, 'desktop team members share the character frame style');
      for (const [selector, frame] of [['[data-ref="effects"]', '.player-panel'], ['[data-ref="target-effects"]', '.target-panel']]) {
        const effects = page.locator(selector);
        await expect(effects, `${width} ${selector}`).toBeVisible();
        await expect(effects.locator('.effect-chip')).toHaveCount(6);
        const strip = (await effects.boundingBox())!, box = (await page.locator(frame).boundingBox())!;
        assert.ok(strip.y >= box.y + box.height, 'power-ups sit below and outside the character frame');
        const rows = await effects.locator('.effect-chip').evaluateAll(elements => elements.map(e => e.getBoundingClientRect().y));
        assert.ok(rows.every(y => y === rows[0]), 'all power-ups stay on one row');
        assert.ok(await effects.evaluate(e => e.scrollWidth >= e.clientWidth), 'power-ups can use the wider desktop frame and overflow remains scrollable');
      }
      assert.equal(await page.locator('.ability-button kbd').first().evaluate(e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');
      const portrait = (await page.locator('[data-ref="portrait"]').boundingBox())!;
      assert.equal(portrait.width, portrait.height, 'portrait has fixed circular dimensions');
      assert.equal(await page.locator('[data-ref="portrait"]').evaluate(e => getComputedStyle(e).borderRadius), '50%');
      const releases = await page.evaluate(() => (window as any).hudFixture.releases());
      await page.screenshot({ path: `test-results/hud-${width}x${height}.png` });
      await page.locator('.map-toggle').click();
      await expect(page.locator('.minimap-panel')).toBeVisible();
      await expect(page.locator('.minimap')).toHaveAttribute('data-world-span', '4800');
      await expect(page.locator('.compact-minimap')).toHaveAttribute('data-world-span', '1600');
      const mapWidth = (await page.locator('.minimap-panel').boundingBox())!.width;
      assert.ok(touch ? mapWidth <= 281 : mapWidth >= 500, 'expanded map is large on desktop and compact on touch');
      const map = (await page.locator('.minimap-panel').boundingBox())!;
      assert.ok(Math.abs(map.x + map.width / 2 - width / 2) <= 1 && Math.abs(map.y + map.height / 2 - height / 2) <= 1, 'map is centered on both axes');
      assert.equal(await page.evaluate(() => (window as any).hudFixture.ui.inputBlocked), false);
      assert.equal(await page.evaluate(() => (window as any).hudFixture.releases()), releases, 'opening map preserves held movement');
      await expect(page.locator('.map-actions [data-ref="leave"]')).toBeVisible();
      await expect(page.locator('.map-actions .fullscreen-toggle')).toBeVisible();
      await expect(page.locator('.world-canvas')).toBeFocused();
      if (touch) {
        // The map must not cover joystick touches with a full-screen dismiss layer.
        assert.equal(await page.evaluate(() => document.elementFromPoint(60, innerHeight - 65)?.closest('.map-dismiss') !== null), false);
      }
      await page.screenshot({ path: `test-results/hud-map-${width}x${height}.png` });
      await page.locator('[data-ref="map-close"]').click();
      await expect(page.locator('.compact-map')).toBeVisible();
      await page.locator('.target-summary').click();
      await expect(page.locator('[data-ref="target-actions"]')).toBeVisible();
      await page.evaluate(() => { const { ui, npc } = (window as any).hudFixture; ui.setSelected(npc); });
      await expect(page.locator('.target-summary-resource')).toBeHidden();
      await expect(page.locator('.target-summary strong')).toHaveText('Guardiano della Soglia');
      if (touch) assert.equal((await page.locator('.target-panel').boundingBox())!.height, 60, 'NPC selection keeps the compact mobile height even without mana');
      await page.locator('.target-summary').click();
      await expect(page.locator('[data-ref="target-actions"]')).toBeHidden();
      await page.locator('[data-ref="target-close"]').click();
      await expect(page.locator('[data-ref="target"]')).toBeHidden();
      await page.locator('[data-ref="social-toggle"]').click();
      await expect(page.locator('.social-panel')).toBeVisible();
      assert.equal(await page.evaluate(() => (window as any).hudFixture.ui.inputBlocked), false);
      assert.equal(await page.evaluate(() => (window as any).hudFixture.releases()), releases, 'opening team preserves held movement');
      await expect(page.locator('.world-canvas')).toBeFocused();
      await page.screenshot({ path: `test-results/hud-friends-${width}x${height}.png` });
      await page.locator('.map-toggle').click();
      await expect(page.locator('.social-panel')).toBeHidden();
      await expect(page.locator('.minimap-panel')).toBeVisible();
      await page.locator('[data-ref="leave"]').click();
      await expect(page.locator('.exit-confirmation')).toBeVisible();
      assert.equal(await page.evaluate(() => (window as any).hudFixture.leaves()), 0, 'exit never leaves before confirmation');
      assert.equal(await page.evaluate(() => (window as any).hudFixture.ui.inputBlocked), true, 'exit confirmation pauses controls');
      await page.locator('[data-resume]').click();
      await expect(page.locator('.exit-confirmation')).toBeHidden();
      assert.equal(await page.evaluate(() => (window as any).hudFixture.leaves()), 0);
      await page.locator('[data-ref="leave"]').click();
      await page.locator('[data-exit]').click();
      assert.equal(await page.evaluate(() => (window as any).hudFixture.leaves()), 1);
      if (!touch) {
        const reset = await page.evaluate(() => {
          const { ui, snapshot, socialCommands } = (window as any).hudFixture;
          const visitor = { ...snapshot.actors[1], id: 'visitor', name: 'Altro viaggiatore', teamId: null };
          ui.setSelected(visitor);
          const invite = document.querySelector<HTMLButtonElement>('[data-ref="target-team"]')!;
          invite.click(); invite.click();
          const beforeReset = socialCommands.length;
          ui.setSocial({ friends: [], requests: [], teamInvites: [{ id: 'visitor', name: visitor.name }], nearby: [], team: null });
          ui.setPlaying(false);
          const cleared = ['target', 'team-roster', 'team-invite', 'social-dot'].every(ref => document.querySelector<HTMLElement>(`[data-ref="${ref}"]`)!.hidden);
          const unblocked = !ui.inputBlocked && !ui.minimapVisible;
          ui.setPlaying(true);
          ui.setSnapshot(snapshot, 24);
          ui.setSelected(visitor);
          const enabled = !invite.disabled;
          invite.click();
          ui.setPlaying(false);
          return { beforeReset, commands: socialCommands, cleared, unblocked, enabled };
        });
        assert.equal(reset.beforeReset, 1, 'a pending invite cannot be sent twice');
        assert.ok(reset.cleared && reset.unblocked, 'returning to the menu clears gameplay panels and locks');
        assert.ok(reset.enabled, 'a new session does not inherit the previous invite timer');
        assert.deepEqual(reset.commands, Array(2).fill({ action: 'team-invite', targetId: 'visitor' }));
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser?.close(); await server.close(); }
});

test('full client keeps keyboard and touch movement working after map and team interactions', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const touch of [false, true]) {
      const context = await browser.newContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: touch, hasTouch: touch });
      const account = { id: 'self', name: 'HudMovement', xp: 0, kills: 0, deaths: 0, gold: 0 };
      await context.addInitScript(({ account }) => {
        Element.prototype.requestFullscreen = async () => {};
        localStorage.setItem('riftlands.jwt', 'hud-test');
        localStorage.setItem('riftlands.profile', JSON.stringify(account));
      }, { account });
      const page = await context.newPage();
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      const self = { ...account, kind: 'player', classId: 'mage', level: 1, teamId: null, x: 0, y: 1000, aim: 0, speed: 180, radius: 15, hp: 100, maxHp: 100, resource: 100, maxResource: 100, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
      const social = { friends: [], requests: [], teamInvites: [], nearby: [], team: null };
      let inputs = 0, dx = 0, dy = 0;
      await page.route('**/api/lobby', route => route.fulfill({ json: { account, friends: [], leaderboard: [] } }));
      await page.routeWebSocket('**/ws', socket => {
        socket.onMessage(raw => {
          const message = JSON.parse(String(raw));
          if (message.type === 'hello') {
            socket.send(JSON.stringify({ type: 'welcome', token: 'hud-test', account, playerId: self.id, seed: 734291, tickRate: 30, time: Date.now(), social }));
            socket.send(JSON.stringify({ type: 'room', room: { id: 'world', epoch: 1, seed: 734291, mode: 'world' } }));
          }
          if (message.type === 'ping') socket.send(JSON.stringify({ type: 'pong', at: message.at, time: Date.now() }));
          if (message.type === 'input') { inputs++; dx = message.input.dx; dy = message.input.dy; }
          if (message.type === 'hello' || message.type === 'input') socket.send(JSON.stringify({ type: 'snapshot', tick: inputs, time: Date.now(), ack: message.input?.seq ?? 0, self, actors: [self], projectiles: [], pickups: [], events: [], online: 1, activeChunks: 1, gold: 0, sanctuary: 'outside' }));
        });
      });
      await page.goto(server.resolvedUrls!.local[0]);
      await page.locator('[data-ref="join"]').click();
      await expect(page.locator('.game-hud')).toBeVisible();
      await expect(page.locator('[data-ref="world-entrance"]')).toBeHidden();
      await expect.poll(() => { assert.deepEqual(errors, []); return inputs; }).toBeGreaterThan(0);
      const cdp = touch ? await context.newCDPSession(page) : undefined;
      let movingTouch: { x: number; y: number; id: number } | undefined;
      if (touch) {
        const stick = (await page.locator('.mobile-joystick').boundingBox())!;
        movingTouch = { x: stick.x + stick.width / 2, y: stick.y + stick.height / 2, id: 1 };
        await cdp!.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [movingTouch] });
        movingTouch.x += stick.width * .35;
        await cdp!.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [movingTouch] });
      } else await page.keyboard.down('KeyD');
      await expect.poll(() => dx).toBeGreaterThan(.2);
      const clickWhileMoving = async (selector: string) => {
        if (!touch) { await page.locator(selector).click(); return; }
        const box = (await page.locator(selector).boundingBox())!;
        const tap = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 2 };
        await cdp!.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [movingTouch!, tap] });
        await cdp!.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [tap] });
      };
      for (const selector of ['.map-toggle', '[data-ref="map-close"]', '[data-ref="social-toggle"]', '[data-ref="social-close"]']) {
        await clickWhileMoving(selector);
        const previousInputs = inputs;
        await expect.poll(() => inputs).toBeGreaterThan(previousInputs + 2);
        assert.ok(dx > .2, `${selector} preserves held ${touch ? 'joystick' : 'keyboard'} movement`);
      }
      await page.locator('.map-toggle').evaluate(e => (e as HTMLButtonElement).click());
      await expect(page.locator('.map-actions button')).toHaveCount(3);
      const audio = page.locator('.map-actions button').last();
      const pressed = await audio.getAttribute('aria-pressed');
      await clickWhileMoving('.map-actions button:last-child');
      await expect(audio).toHaveAttribute('aria-pressed', String(pressed !== 'true'));
      if (touch) await cdp!.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else {
        await page.keyboard.up('KeyD');
        // Explicit keyboard focus on a HUD button must not turn arrows into scrolling.
        await page.locator('.map-toggle').focus();
        await page.keyboard.down('ArrowDown');
        await expect.poll(() => dy).toBeGreaterThan(.2);
        await expect(page.locator('.world-canvas')).toBeFocused();
        await page.keyboard.up('ArrowDown');
      }
      await expect.poll(() => dx === 0 && dy === 0).toBe(true);
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser?.close(); await server.close(); }
});
