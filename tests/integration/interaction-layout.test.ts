import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

test('interaction panels: central scroll, compact stepper, zero, accelerating hold and movement on desktop/touch', { timeout: 75_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true }); mkdirSync('test-results', { recursive: true });
    for (const [width, height, touch] of [[1440, 900, false], [390, 844, true], [844, 390, true], [667, 375, true]] as const) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch }), page = await context.newPage();
      await page.addInitScript('window.__name = value => value'); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('**/interaction-review', route => route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>' }));
      await page.route('**/api/lobby', route => route.fulfill({ json: { account: null, friends: [], leaderboard: [] } }));
      await page.goto(`${server.resolvedUrls!.local[0]}interaction-review`);
      await page.evaluate(async () => {
        for (const file of ['styles/style.css', 'styles/mobile.css', 'ui/hud/team.css', 'ui/lobby/lobby.css', 'ui/hud/hud.css', 'ui/interactions/interactions.css']) await import(`/client/${file}`);
        const { GameUI } = await import('/client/ui/ui.ts' as string), { MobileControls } = await import('/client/controls/mobile-controls.ts' as string), { CLASSES } = await import('/shared/config.ts' as string);
        const { Renderer } = await import('/client/render/render.ts' as string), { World } = await import('/shared/world.ts' as string);
        const root = document.querySelector<HTMLElement>('#app')!, commands: unknown[] = []; let releases = 0, movement = { x: 0, y: 0 };
        const noop = () => {}; const ui = new GameUI(root, { joinCredentials: noop, joinSaved: noop, logout: noop, leave: noop, social: noop, select: noop, cast: noop,
          interact: (command: unknown) => commands.push(command), releaseControls: () => { releases++; movement = { x: 0, y: 0 }; } });
        ui.setAssetProgress(1, 1, 0); ui.setPlaying(true);
        const self = { id: 'self', name: 'Viaggiatore', kind: 'player', classId: 'mage', level: 1, xp: 0, kills: 0, deaths: 0, teamId: null, x: 0, y: 0, aim: 0, speed: 190, radius: 15, hp: 110, maxHp: 110, resource: 120, maxResource: 120, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
        const npc = { ...self, id: 'nereo', name: 'Nereo, vecchio pescatore', kind: 'npc', npcKind: 'old-fisher', disposition: 'neutral', dialogueId: 'old-fisher', questMarker: 'active', x: 48, spriteMoving: true, spriteRow: 3 };
        const snapshot = { type: 'snapshot', tick: 1, time: Date.now(), ack: 0, self, actors: [self, npc], projectiles: [], pickups: [], events: [], online: 1, activeChunks: 1,
          narrative: { version: 1, quests: { 'stinking-bait': { status: 'active', objectives: {}, completions: 0 } } },
          inventory: { version: 1, capacity: 1, slots: [{ itemId: 'slime-innards', quantity: 600 }] }, dialogue: { sessionId: 'review', targetId: 'nereo', speaker: npc.name, text: 'Da quella notte il mondo ha un altro odore. '.repeat(40), choices: [{ id: 'leave', label: 'Torno presto.' }] } };
        ui.setSnapshot(snapshot, 24);
        const mobile = new MobileControls(root, { enabled: () => !ui.inputBlocked, ability: (slot: 'basic' | 'q' | 'e' | 'r') => CLASSES.mage.abilities[slot], move: (vector: { x: number; y: number }) => { movement = vector; }, aim: noop, cast: noop });
        const renderer = new Renderer(ui.canvas, new World()); await renderer.spritesReady;
        // A configured sheet must take precedence over the round neutral fallback.
        const frame = document.createElement('canvas'); frame.width = frame.height = 48; const ctx = frame.getContext('2d')!; ctx.fillStyle = '#fa00df'; ctx.fillRect(0, 0, 48, 48);
        (renderer as any).characters.npcSprites.set('old-fisher', { frames: Array(16).fill(frame) });
        const draw = (renderer as any).characters.drawNpc.bind((renderer as any).characters); renderer.ctx.save(); renderer.ctx.translate(24, 24); draw(npc, Date.now(), '#fff'); renderer.ctx.restore();
        const pixel = [...renderer.ctx.getImageData(24, 24, 1, 1).data];
        (window as any).interactionFixture = { ui, mobile, snapshot, commands, initialReleases: releases, releases: () => releases, movement: () => movement, pixel };
      });
      await expect(page.locator('.npc-dialogue')).toBeVisible();
      const box = (await page.locator('.npc-dialogue').boundingBox())!;
      assert.ok(box.width <= (touch ? 440 : 600) + 1); assert.ok(Math.abs(box.x + box.width / 2 - width / 2) < 1);
      assert.ok(Math.abs(box.y + box.height / 2 - height / 2) < 1); assert.ok(box.height <= (touch && width > height ? 240 : 320) + 1);
      if (touch) for (const control of await page.locator('.mobile-joystick,.ability-button').all()) {
        const rect = (await control.boundingBox())!;
        assert.ok(box.x + box.width <= rect.x || rect.x + rect.width <= box.x || box.y + box.height <= rect.y || rect.y + rect.height <= box.y, `${width}x${height}: dialogue leaves movement and ability controls clear`);
      }
      await expect(page.locator('[data-choice=leave]')).toBeVisible();
      const scroll = page.locator('.dialogue-scroll'); assert.ok(await scroll.evaluate(element => element.scrollHeight > element.clientHeight + 50));
      await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; }); assert.ok(await scroll.evaluate(element => element.scrollTop) > 0);
      assert.deepEqual(await page.evaluate(() => (window as any).interactionFixture.pixel), [250, 0, 223, 255], 'neutral sprites use the standard NPC sheet pipeline');
      assert.equal(await page.evaluate(() => (window as any).interactionFixture.ui.inputBlocked), false);
      await expect(page.locator('.inventory-hint,.inventory-panel>small')).toHaveCount(0);
      const cdp = touch ? await context.newCDPSession(page) : undefined; let movingTouch: { x: number; y: number; id: number } | undefined;
      if (touch) {
        const stick = (await page.locator('.mobile-joystick').boundingBox())!; movingTouch = { x: stick.x + stick.width * .84, y: stick.y + stick.height / 2, id: 1 };
        await cdp!.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [movingTouch] });
        await expect.poll(() => page.evaluate(() => (window as any).interactionFixture.movement().x)).toBeGreaterThan(.2);
      }
      const press = async (selector: string) => {
        const rect = (await page.locator(selector).boundingBox())!;
        const point = { x: selector === '.world-canvas' ? rect.x + 2 : rect.x + rect.width / 2, y: rect.y + rect.height / 2, id: 2 };
        if (touch) await cdp!.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [movingTouch!, point] });
        else { await page.mouse.move(point.x, point.y); await page.mouse.down(); }
        return async () => { if (touch) await cdp!.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [point] }); else await page.mouse.up(); };
      };
      const releaseSlot = await press('.inventory-slot'); await expect(page.locator('.drop-item-panel')).toBeVisible(); await releaseSlot();
      await expect(page.locator('.drop-item-panel input')).toHaveCount(0); await expect(page.locator('.drop-item-panel output')).toHaveText('600');
      assert.equal(await page.locator('.drop-item-panel').evaluate(element => element.matches(':popover-open')), true, 'discard box is above all HUD layers, including gold');
      if (touch) {
        const drop = (await page.locator('.drop-item-panel').boundingBox())!;
        for (const selector of ['.mobile-joystick', '[data-ref=ability-bar]']) {
          const controls = (await page.locator(selector).boundingBox())!;
          assert.ok(drop.x + drop.width <= controls.x || controls.x + controls.width <= drop.x || drop.y + drop.height <= controls.y || controls.y + controls.height <= drop.y, `${width}x${height}: quantity popover overlaps ${selector}: ${JSON.stringify({ drop, controls })}`);
        }
      }
      await page.evaluate(() => {
        const samples: number[] = []; const output = document.querySelector('.drop-item-panel output')!;
        const observer = new MutationObserver(() => samples.push(Number(output.textContent))); observer.observe(output, { childList: true, subtree: true });
        Object.assign((window as any).interactionFixture, { samples, observer });
      });
      const releaseMinus = await press('[data-quantity-minus]'); await page.waitForTimeout(1850); await releaseMinus();
      const down = await page.evaluate(() => (window as any).interactionFixture.samples as number[]);
      assert.equal(down[0], 599, `${width}x${height}: minus starts with one`); assert.ok(down.length >= 5); for (let i = 1; i < down.length; i++) assert.equal(down[i - 1] - down[i], 10);
      await page.evaluate(() => { (window as any).interactionFixture.samples.length = 0; });
      const releasePlus = await press('[data-quantity-plus]'); await page.waitForTimeout(1100); await releasePlus();
      const up = await page.evaluate(() => (window as any).interactionFixture.samples as number[]);
      assert.ok(up.length >= 3); assert.equal(up[0], down.at(-1)! + 1); for (let i = 1; i < up.length; i++) assert.equal(up[i] - up[i - 1], 10);
      await page.evaluate(() => { const f = (window as any).interactionFixture; f.observer.disconnect(); f.snapshot.inventory.slots[0].quantity = 3; f.ui.setSnapshot(f.snapshot, 24); });
      await expect(page.locator('.drop-item-panel output')).toHaveText('3');
      for (let i = 0; i < 3; i++) { const release = await press('[data-quantity-minus]'); await release(); }
      await expect(page.locator('.drop-item-panel output')).toHaveText('0'); await expect(page.locator('[data-drop-confirm]')).toBeDisabled();
      const releaseOne = await press('[data-quantity-plus]'); await releaseOne(); await expect(page.locator('.drop-item-panel output')).toHaveText('1');
      assert.equal(await page.evaluate(() => (window as any).interactionFixture.releases()), await page.evaluate(() => (window as any).interactionFixture.initialReleases), 'opening either panel keeps controls held');
      if (touch) assert.ok(await page.evaluate(() => (window as any).interactionFixture.movement().x) > .2, 'joystick stays active across second-finger gestures');
      await page.screenshot({ path: `test-results/interactions-${width}x${height}.png` });
      const releaseConfirm = await press('[data-drop-confirm]'); await releaseConfirm(); await expect(page.locator('.drop-item-panel')).toBeHidden();
      assert.deepEqual(await page.evaluate(() => (window as any).interactionFixture.commands), [{ kind: 'drop-item', slot: 0, itemId: 'slime-innards', quantity: 1 }]);
      if (touch) await cdp!.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(page.locator('.player-panel')).toHaveClass(/has-active-quests/);
      await page.locator('.player-journal-toggle').click(); await expect(page.locator('.quest-journal')).toBeVisible();
      await expect(page.locator('.journal-quest')).toContainText('Esche puzzolenti');
      // Sparse server snapshots must retain the last known mission progress.
      await page.evaluate(() => { const f = (window as any).interactionFixture; f.ui.setSnapshot({ ...f.snapshot, narrative: undefined }, 24); });
      await expect(page.locator('.journal-quest')).toContainText('Nella sacca: 3');
      await page.screenshot({ path: `test-results/journal-${width}x${height}.png` });
      const releaseOutside = await press('.world-canvas'); await releaseOutside();
      await expect(page.locator('.quest-journal')).toBeHidden(); await expect(page.locator('.npc-dialogue')).toBeHidden();
      await page.evaluate(() => { const f = (window as any).interactionFixture; f.ui.setSnapshot(f.snapshot, 24); });
      await expect(page.locator('.npc-dialogue')).toBeHidden();
      assert.deepEqual(await page.evaluate(() => (window as any).interactionFixture.commands.at(-1)), { kind: 'close', sessionId: 'review' });
      for (const [toggle, panel] of [['[data-ref=social-toggle]', '.social-panel'], ['.map-toggle', '.minimap-panel']] as const) {
        await page.locator(toggle).click(); await expect(page.locator(panel)).toBeVisible();
        const release = await press('.world-canvas'); await release(); await expect(page.locator(panel)).toBeHidden();
      }
      const releaseAgain = await press('.inventory-slot'); await expect(page.locator('.drop-item-panel')).toBeVisible(); await releaseAgain();
      const dismissDrop = await press('.world-canvas'); await dismissDrop(); await expect(page.locator('.drop-item-panel')).toBeHidden();
      // Dismissed invitations must stay hidden when identical social state is refreshed.
      await page.evaluate(() => { const f = (window as any).interactionFixture; f.social = { friends: [], requests: [], nearby: [], team: null, teamInvites: [{ id: 'friend', name: 'Amico', teamId: 'team' }] }; f.ui.setSocial(f.social); });
      await expect(page.locator('[data-ref=team-invite]')).toBeVisible();
      const dismissInvite = await press('.world-canvas'); await dismissInvite();
      await page.evaluate(() => { const f = (window as any).interactionFixture; f.ui.setSocial(f.social); });
      await expect(page.locator('[data-ref=team-invite]')).toBeHidden();
      await page.locator('.player-journal-toggle').click(); await page.keyboard.press('Escape'); await expect(page.locator('.quest-journal')).toBeHidden();
      assert.equal(await page.evaluate(() => (window as any).interactionFixture.releases()), await page.evaluate(() => (window as any).interactionFixture.initialReleases));
      if (touch) await cdp!.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.deepEqual(errors, []); await context.close();
    }
  } finally { await browser?.close(); await server.close(); }
});
