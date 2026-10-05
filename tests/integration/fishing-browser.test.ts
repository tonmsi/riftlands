import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium, expect, type Browser } from '@playwright/test';
import { AccountStore, publicAccount } from '../../server/store';
import { WorldSimulation } from '../../server/simulation';
import { WORLD_DOCUMENT } from '../../shared/world-content';
import { TILE_SIZE } from '../../shared/config';
import { collectItem, insertItem } from '../../shared/items';
import { nearbyFishingWater } from '../../shared/fishing/water';
import { collidesWorld } from '../../shared/physics';
import { SnapshotObserver } from '../fixtures/snapshot-observer';
import type { Snapshot, Vec2 } from '../../shared/types';

test('fishing on PC and landscape touch: shore activation, lure selection, cast, bite, recovery and currency return', { timeout: 120000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-fishing-browser-')), store = new AccountStore(join(directory, 'accounts.json'));
  const sim = new WorldSimulation(734291, Date.now(), store), fisher = WORLD_DOCUMENT.npcs.find(n => n.npcKind === 'old-fisher')!;
  let shore: Vec2 | undefined;
  for (let radius = 1; radius <= 15 && !shore; radius++) for (let y = fisher.y - radius; y <= fisher.y + radius && !shore; y++) for (let x = fisher.x - radius; x <= fisher.x + radius && !shore; x++) {
    const candidate = { x: (x + .5) * TILE_SIZE, y: (y + .5) * TILE_SIZE };
    if (!collidesWorld(candidate.x, candidate.y, 18, sim.world) && nearbyFishingWater(sim.world, candidate)) shore = candidate;
  }
  assert.ok(shore, 'the authored world has a fishable shoreline near Nereo');
  const users = ['DesktopFisher', 'TouchFisher'].map(name => {
    const user = store.register(name, 'test-password'), body = sim.addPlayer(user.account, 'hunter');
    user.account.gold = 10; collectItem(user.account.inventory!, 'backpack-5', 1); insertItem(user.account.inventory!, 'fishing-rod', 1); insertItem(user.account.inventory!, 'slime-innards', 3);
    Object.assign(body, shore!, { spawnProtectedUntil: Date.now() + 120000 }); return user;
  });
  sim.checkpoint(); store.flush();
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port; await new Promise<void>(done => probe.close(() => done()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: resolve('.'), windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: store.path, NODE_ENV: 'development' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const ended = once(child, 'close'); let browser: Browser | undefined, log = '';
  child.stderr.on('data', data => { log += String(data); });
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error(log || 'Startup timeout')), 15000);
      child.stdout.on('data', data => { if (String(data).includes('Riftlands:')) { clearTimeout(timer); done(); } });
      child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exit ${code}: ${log}`)); });
    });
    browser = await chromium.launch({ channel: 'chrome', headless: true }); mkdirSync('test-results', { recursive: true });
    for (const [index, user] of users.entries()) {
      const touch = index === 1, context = await browser.newContext({ viewport: touch ? { width: 844, height: 390 } : { width: 1440, height: 900 }, isMobile: touch, hasTouch: touch });
      await context.addInitScript(({ token, profile }) => { localStorage.setItem('riftlands.jwt', token); localStorage.setItem('riftlands.profile', JSON.stringify(profile)); localStorage.setItem('riftlands.selected-class', 'hunter'); }, { token: user.token, profile: publicAccount(user.account) });
      const page = await context.newPage(), errors: string[] = []; let latest: Snapshot | undefined;
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', socket => { const observer = new SnapshotObserver(); socket.on('framereceived', frame => { const message = observer.read(String(frame.payload)); if (message.type === 'snapshot') latest = message; }); });
      const activate = async (selector: string) => { if (touch) await page.locator(selector).tap(); else await page.locator(selector).click(); };
      await page.goto(`http://127.0.0.1:${port}`); await page.locator('[data-ref=join]').click(); await expect(page.locator('[data-ref=world-entrance]')).toBeHidden();
      await page.waitForTimeout(5200); await activate('.backpack-toggle'); await activate('[data-item-slot="0"]');
      await expect(page.locator('.fishing-ui')).toBeVisible(); await expect(page.locator('[data-ref=ability-bar]')).toBeHidden();
      await expect(page.locator('[data-bait=gold]')).toBeVisible(); let expectedGold = latest!.gold!;
      for (let attempt = 0; attempt < 8; attempt++) {
        if (latest!.fishing?.baitId !== 'gold') expectedGold = latest!.gold!;
        await activate('[data-bait=gold]'); await expect(page.locator('[data-bait=gold]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('[data-ref=hud-gold]')).toHaveText(String(expectedGold - 1));
        await activate('.fishing-reel'); await expect(page.locator('.fishing-ui')).toHaveAttribute('data-phase', 'waiting');
        await expect.poll(() => latest?.fishing?.phase, { timeout: 9000 }).not.toBe('waiting');
        if (latest?.fishing?.phase === 'bite') break;
        assert.equal(latest?.fishing?.noBite, true);
      }
      await expect(page.locator('.fishing-ui')).toHaveAttribute('data-phase', 'bite');
      await activate('.fishing-reel'); await expect(page.locator('.fishing-ui')).toHaveAttribute('data-phase', 'fight');
      await expect(page.locator('.fishing-meter')).toBeVisible(); await page.screenshot({ path: `test-results/fishing-fight-${touch ? 'landscape' : 'desktop'}.png` });
      const reel = (await page.locator('.fishing-reel').boundingBox())!, x = reel.x + reel.width / 2, y = reel.y + reel.height / 2;
      const cdp = touch ? await context.newCDPSession(page) : undefined; let held = false;
      const hold = async (value: boolean) => {
        if (value === held) return; held = value;
        if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: value ? 'touchStart' : 'touchEnd', touchPoints: value ? [{ x, y, id: 1 }] : [] });
        else { await page.mouse.move(x, y); if (value) await page.mouse.down(); else await page.mouse.up(); }
      };
      const deadline = Date.now() + 45000;
      while (latest?.fishing?.phase === 'fight' && Date.now() < deadline) {
        await hold(latest.fishing.tension < .88); await page.waitForTimeout(100);
      }
      await hold(false); assert.equal(latest?.fishing?.outcome, 'caught'); assert.equal(latest?.gold, expectedGold - 1);
      assert.ok(latest?.inventory?.slots.some(stack => stack?.itemId.startsWith('fish-')));
      await expect(page.locator('[data-fishing-message]')).toContainText('kg!'); await expect(page.locator('[data-bait=gold]')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.fishing-catch')).toBeVisible(); await expect(page.locator('.fishing-catch-confetti i')).toHaveCount(72);
      await expect(page.locator('[data-catch-weight]')).toHaveText(`${latest!.fishing!.weightKg!.toFixed(2)} kg`);
      await page.screenshot({ path: `test-results/fishing-catch-${touch ? 'landscape' : 'desktop'}.png` });
      const panel = (await page.locator('.fishing-baits').boundingBox())!; assert.ok(panel.x >= 0 && panel.x + panel.width <= (touch ? 844 : 1440));
      await expect(page.locator('.fishing-catch-dismiss')).toHaveText('Tocca per continuare');
      await activate('.fishing-catch'); await expect(page.locator('.fishing-catch')).toBeHidden();
      await activate('[data-fishing-close]'); await expect(page.locator('.fishing-ui')).toBeHidden(); await expect(page.locator('[data-ref=ability-bar]')).toBeVisible();
      await expect(page.locator('[data-ref=hud-gold]')).toHaveText(String(expectedGold));
      assert.deepEqual(errors, []); await context.close();
    }
  } finally { await browser?.close(); child.kill(); await ended; rmSync(directory, { recursive: true, force: true }); }
});
