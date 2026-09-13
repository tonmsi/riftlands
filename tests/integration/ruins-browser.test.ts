import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium, expect, type Browser } from '@playwright/test';
import { AccountStore, publicAccount } from '../../server/store';
import { WorldSimulation } from '../../server/simulation';
import type { ServerMessage, Snapshot } from '../../shared/types';
import { RUINS } from '../../shared/ruins';

test('two browsers fight the boss: private gold, visible corpse, physical collection and persistent wallet', { timeout: 60_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-ruins-browser-'));
  const store = new AccountStore(join(directory, 'accounts.json'));
  const users = ['LootOwner', 'Spectator'].map(name => store.register(name, 'test-password'));
  const sim = new WorldSimulation(734291, Date.now(), store);
  users.forEach((user, i) => Object.assign(sim.addPlayer(user.account, i ? 'warrior' : 'hunter'), { x: i ? 400 : 0, y: RUINS.y + (i ? 300 : 240), spawnProtectedUntil: 0 }));
  sim.checkpoint(); store.flush();
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], { cwd: resolve('.'), windowsHide: true,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: store.path, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const ended = once(child, 'close');
  let browser: Browser | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timeout')), 10_000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('Riftlands:')) { clearTimeout(timer); resolve(); } });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exit ${code}`)); });
    });
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'chrome' : undefined), headless: true });
    const errors: string[] = [];
    const clients = [];
    for (const user of users) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(({ token, profile }) => { localStorage.setItem('riftlands.jwt', token); localStorage.setItem('riftlands.profile', JSON.stringify(profile)); }, { token: user.token, profile: publicAccount(user.account) });
      const page = await context.newPage();
      const state: { snapshot?: Snapshot } = {};
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', socket => socket.on('framereceived', event => { const message = JSON.parse(String(event.payload)) as ServerMessage; if (message.type === 'snapshot') state.snapshot = message; }));
      await page.goto(`http://127.0.0.1:${port}`);
      await page.locator(`[data-class=${user === users[0] ? 'hunter' : 'warrior'}]`).click(); await page.locator('[data-ref=join]').click();
      await expect(page.locator('.game-hud')).toBeVisible(); await page.locator('.world-canvas').click();
      clients.push({ page, state });
    }
    const [owner, observer] = clients;
    await expect.poll(() => owner.state.snapshot?.actors.some(a => a.id === RUINS.bossId)).toBe(true);
    mkdirSync(resolve('test-results'), { recursive: true });
    await owner.page.screenshot({ path: resolve('test-results/ruins-boss.png') });
    const canvas = (await owner.page.locator('.world-canvas').boundingBox())!;
    await owner.page.keyboard.down('Space');
    const movement = new Set<string>();
    const move = async (dx: number, dy: number) => {
      const wanted = new Set<string>();
      if (dx > .25) wanted.add('KeyD'); if (dx < -.25) wanted.add('KeyA');
      if (dy > .25) wanted.add('KeyS'); if (dy < -.25) wanted.add('KeyW');
      for (const key of [...movement]) if (!wanted.has(key)) { await owner.page.keyboard.up(key); movement.delete(key); }
      for (const key of wanted) if (!movement.has(key)) { await owner.page.keyboard.down(key); movement.add(key); }
    };
    const deadline = Date.now() + 25_000;
    while ((owner.state.snapshot?.actors.find(a => a.id === RUINS.bossId)?.hp ?? RUINS.hp) > 0 && Date.now() < deadline) {
      const snapshot = owner.state.snapshot!, self = snapshot.self, boss = snapshot.actors.find(a => a.id === RUINS.bossId);
      assert.ok(self.hp > 0, 'the ranged test player should survive by moving');
      if (!boss) { await owner.page.waitForTimeout(75); continue; }
      await owner.page.mouse.move(canvas.x + canvas.width / 2 + boss.x - self.x, canvas.y + canvas.height / 2 + boss.y - self.y);
      const bx = boss.x - self.x, by = boss.y - self.y, distance = Math.hypot(bx, by) || 1;
      let dx = -by / distance, dy = bx / distance;
      if (snapshot.bossWindup?.kind === 'charge') {
        const lineX = (snapshot.bossWindup.targetX ?? boss.x) - snapshot.bossWindup.x;
        const lineY = (snapshot.bossWindup.targetY ?? boss.y) - snapshot.bossWindup.y;
        dx = -lineY; dy = lineX;
        if (Math.abs(self.x + Math.sign(dx) * 100) > 270 || Math.abs(self.y - RUINS.y + Math.sign(dy) * 100) > 270) { dx = -dx; dy = -dy; }
      } else if (distance < 150) { dx = -bx; dy = -by; }
      else if (distance > 300) { dx = bx; dy = by; }
      if (Math.abs(self.x) > 275) dx = -Math.sign(self.x);
      if (Math.abs(self.y - RUINS.y) > 275) dy = -Math.sign(self.y - RUINS.y);
      await move(dx, dy);
      await owner.page.waitForTimeout(75);
    }
    await move(0, 0);
    await owner.page.keyboard.up('Space');
    assert.equal(owner.state.snapshot?.actors.find(a => a.id === RUINS.bossId)?.hp, 0, 'the moving ranged player should defeat the boss');
    await expect.poll(() => owner.state.snapshot?.goldDrops?.length).toBe(1);
    assert.equal(observer.state.snapshot!.goldDrops!.length, 0);
    assert.equal(owner.state.snapshot!.gold, 0);
    await owner.page.screenshot({ path: resolve('test-results/ruins-loot-owner.png') });
    const lootDeadline = Date.now() + 6_000;
    const held = new Set<string>();
    while ((owner.state.snapshot?.gold ?? 0) < RUINS.gold && Date.now() < lootDeadline) {
      const snapshot = owner.state.snapshot!, drop = snapshot.goldDrops![0], self = snapshot.self;
      const wanted = new Set<string>();
      if (drop.x > self.x + 8) wanted.add('KeyD'); if (drop.x < self.x - 8) wanted.add('KeyA');
      if (drop.y > self.y + 8) wanted.add('KeyS'); if (drop.y < self.y - 8) wanted.add('KeyW');
      for (const key of held) if (!wanted.has(key)) { await owner.page.keyboard.up(key); held.delete(key); }
      for (const key of wanted) if (!held.has(key)) { await owner.page.keyboard.down(key); held.add(key); }
      await owner.page.waitForTimeout(50);
    }
    for (const key of held) await owner.page.keyboard.up(key);
    assert.equal(owner.state.snapshot?.gold, RUINS.gold);
    await expect(owner.page.locator('[data-ref=hud-gold]')).toHaveText('50');
    await owner.page.locator('[data-ref=leave]').click();
    await expect(owner.page.locator('[data-ref=lobby-gold]')).toHaveText('50');
    await owner.page.screenshot({ path: resolve('test-results/ruins-wallet-lobby.png') });
    assert.equal(observer.state.snapshot!.gold, 0);
    assert.equal(new AccountStore(store.path).accounts.get(users[0].account.id)!.gold, 50);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); child.kill(); await ended;
    rmSync(directory, { recursive: true, force: true });
  }
});
