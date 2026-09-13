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
import { RUINS_WARDEN } from '../../shared/bosses';
import { World } from '../../shared/world';
import { findBossPath } from '../../server/boss-encounter';

test('two browsers fight the boss: private gold, visible corpse, physical collection and persistent wallet', { timeout: 60_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-ruins-browser-'));
  const store = new AccountStore(join(directory, 'accounts.json'));
  const users = ['LootOwner', 'Spectator'].map(name => store.register(name, 'test-password'));
  const sim = new WorldSimulation(734291, Date.now(), store);
  const spectatorGate = RUINS_WARDEN.arena.escapeGates[3];
  const spectatorAngle = Math.atan2(spectatorGate.y - RUINS.y, spectatorGate.x - RUINS.x);
  const spectatorSpawn = { x: spectatorGate.x + Math.cos(spectatorAngle) * 20, y: spectatorGate.y + Math.sin(spectatorAngle) * 20 };
  users.forEach((user, i) => Object.assign(sim.addPlayer(user.account, i ? 'warrior' : 'hunter'),
    { ...(i ? spectatorSpawn : { x: 0, y: RUINS.y + 240 }), spawnProtectedUntil: 0 }));
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
    await expect.poll(() => owner.state.snapshot?.actors.some(a => a.id === RUINS_WARDEN.id)).toBe(true);
    await expect.poll(() => owner.state.snapshot?.bossLocks?.find(lock => lock.bossId === RUINS_WARDEN.id)?.ownerId).toBe(owner.state.snapshot!.self.id);
    assert.equal(owner.state.snapshot?.bossLocks?.find(lock => lock.bossId === RUINS_WARDEN.id)?.relation, 'participant');
    assert.equal(observer.state.snapshot?.bossLocks?.find(lock => lock.bossId === RUINS_WARDEN.id)?.relation, 'outsider');
    assert.ok(Math.hypot(observer.state.snapshot!.self.x - RUINS.x, observer.state.snapshot!.self.y - RUINS.y) > RUINS.radius,
      'the second browser must remain outside the sealed room');
    mkdirSync(resolve('test-results'), { recursive: true });
    await owner.page.screenshot({ path: resolve('test-results/ruins-boss.png') });
    await observer.page.screenshot({ path: resolve('test-results/ruins-boss-outsider.png') });
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
    while ((owner.state.snapshot?.actors.find(a => a.id === RUINS_WARDEN.id)?.hp ?? RUINS_WARDEN.hp) > 0 && Date.now() < deadline) {
      const snapshot = owner.state.snapshot!, self = snapshot.self, boss = snapshot.actors.find(a => a.id === RUINS_WARDEN.id);
      assert.ok(self.hp > 0, 'the ranged test player should survive by moving');
      if (!boss) { await owner.page.waitForTimeout(75); continue; }
      await owner.page.mouse.move(canvas.x + canvas.width / 2 + boss.x - self.x, canvas.y + canvas.height / 2 + boss.y - self.y);
      const bx = boss.x - self.x, by = boss.y - self.y, distance = Math.hypot(bx, by) || 1;
      let dx = -by / distance, dy = bx / distance;
      const windup = snapshot.bossWindups?.[0];
      if (windup?.kind === 'charge') {
        const lineX = (windup.targetX ?? boss.x) - windup.x;
        const lineY = (windup.targetY ?? boss.y) - windup.y;
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
    assert.equal(owner.state.snapshot?.actors.find(a => a.id === RUINS_WARDEN.id)?.hp, 0, 'the moving ranged player should defeat the boss');
    await expect.poll(() => owner.state.snapshot?.goldDrops?.length).toBe(1);
    assert.equal(observer.state.snapshot!.goldDrops!.length, 0);
    assert.equal(owner.state.snapshot!.gold, 0);
    await owner.page.screenshot({ path: resolve('test-results/ruins-loot-owner.png') });
    const lootDeadline = Date.now() + 6_000;
    const held = new Set<string>();
    const drop = owner.state.snapshot!.goldDrops![0];
    const route = [...findBossPath(RUINS_WARDEN, owner.state.snapshot!.self, drop, new World()), drop];
    while ((owner.state.snapshot?.gold ?? 0) < RUINS_WARDEN.reward.gold && Date.now() < lootDeadline) {
      const snapshot = owner.state.snapshot!, self = snapshot.self;
      while (route.length > 1 && Math.hypot(route[0].x - self.x, route[0].y - self.y) < 24) route.shift();
      const waypoint = route[0];
      const wanted = new Set<string>();
      if (waypoint.x > self.x + 8) wanted.add('KeyD'); if (waypoint.x < self.x - 8) wanted.add('KeyA');
      if (waypoint.y > self.y + 8) wanted.add('KeyS'); if (waypoint.y < self.y - 8) wanted.add('KeyW');
      for (const key of held) if (!wanted.has(key)) { await owner.page.keyboard.up(key); held.delete(key); }
      for (const key of wanted) if (!held.has(key)) { await owner.page.keyboard.down(key); held.add(key); }
      await owner.page.waitForTimeout(50);
    }
    for (const key of held) await owner.page.keyboard.up(key);
    assert.equal(owner.state.snapshot?.gold, RUINS_WARDEN.reward.gold);
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
