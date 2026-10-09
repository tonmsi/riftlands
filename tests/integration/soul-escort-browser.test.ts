import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

test('soul lights, stationary soldier and farewell fit desktop and mobile, without blocking controls', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    mkdirSync('test-results', { recursive: true });
    for (const [width, height, touch] of [[1440, 900, false], [844, 390, true]] as const) {
      const page = await browser.newPage({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
      await page.clock.install(); await page.addInitScript('window.__name = value => value');
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('**/soul-review', route => route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>' }));
      await page.route('**/api/lobby', route => route.fulfill({ json: { account: null, friends: [], leaderboard: [] } }));
      await page.route('**/api/actor-catalog', route => route.fulfill({ status: 404 }));
      await page.goto(`${server.resolvedUrls!.local[0]}soul-review`);
      await page.evaluate(async ({ width, height }) => {
        for (const file of ['styles/style.css', 'styles/mobile.css', 'ui/hud/team.css', 'ui/lobby/lobby.css', 'ui/hud/hud.css', 'ui/interactions/interactions.css']) await import(`/client/${file}`);
        const { GameUI } = await import('/client/ui/ui.ts' as string);
        const { ActorRenderer } = await import('/client/render/actor-renderer.ts' as string);
        const root = document.querySelector<HTMLElement>('#app')!, noop = () => {};
        const ui = new GameUI(root, { joinCredentials: noop, joinSaved: noop, logout: noop, leave: noop, social: noop, select: noop, cast: noop });
        ui.setAssetProgress(1, 1, 0); ui.setPlaying(true);
        const self = { id: 'escort', name: 'Viaggiatore', kind: 'player', classId: 'mage', level: 1, xp: 0, kills: 0, deaths: 0, teamId: null,
          x: 0, y: 0, aim: 0, speed: 180, radius: 15, hp: 100, maxHp: 100, resource: 100, maxResource: 100, hidden: false,
          revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 }, loadout: { q: null, e: null } };
        const snapshot = { type: 'snapshot', tick: 1, time: 100_000, ack: 0, self, actors: [self], projectiles: [], pickups: [], events: [], online: 1, activeChunks: 1, gold: 0, narrative: { version: 1, quests: {}, flags: [] } };
        const canvas = root.querySelector<HTMLCanvasElement>('.world-canvas')!; canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d')!, actors = new ActorRenderer(ctx, matchMedia('(pointer: coarse)')); await actors.spritesReady;
        const soldier = { ...self, id: 'soldier', name: 'Eren', kind: 'npc', npcKind: 'fallen-soldier', disposition: 'neutral', dialogueId: 'fallen-soldier', questMarker: 'available', x: -115, y: 35, spriteMoving: false };
        const draw = (time = 100_000) => {
          ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#132c2c'; ctx.fillRect(0, 0, width, height);
          const ground = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2);
          ground.addColorStop(0, '#34594b'); ground.addColorStop(1, '#102025'); ctx.fillStyle = ground; ctx.fillRect(0, 0, width, height);
          ctx.fillStyle = '#536b56'; for (let i = 0; i < 80; i++) ctx.fillRect((i * 113) % width, (i * 67) % height, 2, 3);
          ctx.save(); ctx.translate(width / 2, height * .42); ctx.scale(1.7, 1.7);
          actors.drawActor(soldier, time, false, false, false, new Set()); actors.drawActor(self, time, true, false, false, new Set()); ctx.restore();
        };
        const update = () => ui.setSnapshot(structuredClone(snapshot), 20);
        update(); draw();
        (window as any).soulReview = { snapshot, update, draw, soldier };
      }, { width, height });
      await page.evaluate(() => { const f = (window as any).soulReview; f.snapshot.narrative.quests['souls-home'] = { status: 'active', objectives: { 'eren-released': 1 } }; f.soldier.hp = 0; f.soldier.dialogueId = undefined; f.soldier.questMarker = undefined; f.snapshot.self.soulEscort = true; f.snapshot.self.maxHp = 125; f.snapshot.self.hp = 125; f.update(); f.draw(); });
      await page.clock.runFor(4600);
      await page.screenshot({ path: `test-results/soul-travel-${width}.png` });
      await page.evaluate(() => { const f = (window as any).soulReview; f.snapshot.narrative.quests['souls-home'] = { status: 'completed', objectives: { 'souls-returned': 1 }, completions: 1, completedAt: 100_000 }; f.snapshot.self.soulEscort = undefined; f.snapshot.self.soulFarewellAt = 100_000; f.snapshot.self.soulFarewellX = 0; f.snapshot.self.soulFarewellY = 0; f.snapshot.self.maxHp = 100; f.snapshot.self.hp = 100; f.update(); f.draw(102_500); });
      await page.clock.runFor(2500);
      await expect(page.locator('.soul-farewell')).toContainText('siamo a casa');
      assert.equal(await page.locator('.soul-farewell').evaluate(e => getComputedStyle(e).pointerEvents), 'none');
      await page.screenshot({ path: `test-results/soul-farewell-${width}.png` });
      const bounds = (await page.locator('.soul-farewell').boundingBox())!;
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      await page.clock.runFor(3800);
      await expect(page.locator('.soul-farewell')).toContainText('Ora possiamo riposare');
      await page.evaluate(() => (window as any).soulReview.draw(108_000));
      await page.screenshot({ path: `test-results/soul-rest-${width}.png` });
      await page.clock.runFor(3000); await expect(page.locator('.soul-farewell')).toBeHidden();
      assert.deepEqual(errors, []); await page.close();
    }
  } finally { await browser?.close(); await server.close(); }
});
