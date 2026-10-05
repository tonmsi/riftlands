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
import { insertItem } from '../../shared/items';
import { SnapshotObserver } from '../fixtures/snapshot-observer';
import type { Snapshot } from '../../shared/types';

test('real vendor sells and equips backpacks, preserves contents and spends gold on desktop and landscape touch', { timeout: 75_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-vendor-browser-'));
  const store = new AccountStore(join(directory, 'accounts.json')), sim = new WorldSimulation(734291, Date.now(), store);
  const vendor = WORLD_DOCUMENT.npcs.find(npc => npc.npcKind === 'outpost-vendor')!; assert.ok(vendor);
  const users = ['DesktopBuyer', 'TouchBuyer'].map((name, index) => {
    const user = store.register(name, 'test-password'), body = sim.addPlayer(user.account, 'mage'); user.account.gold = 200;
    Object.assign(body, { x: (vendor.x + .5) * TILE_SIZE - 48, y: (vendor.y + .5) * TILE_SIZE + index * 24, spawnProtectedUntil: Date.now() + 120_000 });
    insertItem(user.account.inventory!, 'slime-innards', 9999); return user;
  });
  sim.checkpoint(); store.flush();
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port; await new Promise<void>(done => probe.close(() => done()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: resolve('.'), windowsHide: true,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: store.path, NODE_ENV: 'development' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
      await context.addInitScript(({ token, profile }) => { localStorage.setItem('riftlands.jwt', token); localStorage.setItem('riftlands.profile', JSON.stringify(profile)); }, { token: user.token, profile: publicAccount(user.account) });
      const page = await context.newPage(), errors: string[] = []; let latest: Snapshot | undefined;
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', socket => { const observer = new SnapshotObserver(); socket.on('framereceived', frame => { const message = observer.read(String(frame.payload)); if (message.type === 'snapshot') latest = message; }); });
      await page.goto(`http://127.0.0.1:${port}`); await page.locator('[data-ref=join]').click(); await expect(page.locator('[data-ref=world-entrance]')).toBeHidden();
      await expect(page.locator('[data-ref=hud-gold]')).toHaveText('200'); await expect(page.locator('.gold-gain')).toBeHidden();
      await page.keyboard.press('KeyF'); await expect(page.locator('[data-speaker]')).toHaveText('Ada, mercante');
      await expect(page.locator('.vendor-offer')).toHaveCount(6); await expect(page.locator('[data-offer=potion]')).toBeDisabled();
      const activate = async (selector: string) => { if (touch) await page.locator(selector).tap(); else await page.locator(selector).click(); };
      await activate('[data-offer=bag-3]'); await expect(page.locator('.backpack-toggle b')).toHaveText('3'); await expect(page.locator('[data-ref=hud-gold]')).toHaveText('175');
      assert.equal(latest!.inventory!.slots[0]!.quantity, 9999);
      await expect(page.locator('[data-offer=bag-2]')).toBeDisabled(); await expect(page.locator('[data-offer=bag-3]')).toBeDisabled();
      await activate('[data-offer=bag-5]'); await expect(page.locator('.backpack-toggle b')).toHaveText('5'); await expect(page.locator('[data-ref=hud-gold]')).toHaveText('75');
      assert.ok(!latest!.inventory!.slots.some(stack => stack?.itemId.startsWith('backpack-')));
      await expect(page.locator('.inventory-feedback')).toContainText('Zaino cambiato');
      await activate('[data-offer=potion]'); await expect(page.locator('[data-ref=hud-gold]')).toHaveText('72');
      assert.ok(latest!.inventory!.slots.some(stack => stack?.itemId === 'healing-potion'));
      await expect(page.locator('.inventory-feedback')).toContainText('Acquistato');
      await expect(page.locator('.inventory-feedback strong')).toHaveText('+1');
      await expect(page.locator('.gold-gain')).toBeHidden();
      await page.screenshot({ path: `test-results/vendor-${touch ? 'landscape' : 'desktop'}.png` });
      await activate('[data-dialogue-close]'); await expect(page.locator('.npc-dialogue')).toBeHidden();
      await activate('.backpack-toggle'); await expect(page.locator('.inventory-slot')).toHaveCount(5); await expect(page.locator('.inventory-slots')).toBeVisible();
      assert.deepEqual(errors, []); await context.close();
    }
  } finally { await browser?.close(); child.kill(); await ended; rmSync(directory, { recursive: true, force: true }); }
});
