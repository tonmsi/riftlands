import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { AccountStore, publicAccount } from '../../server/store';
import { WorldSimulation } from '../../server/simulation';
import type { RoomState, ServerMessage, Snapshot } from '../../shared/types';
import { ARENA_GATE } from '../../shared/arena';

test('two browsers: gate cancellation, 1v1 transfer, obstacles and opponent abandonment', { timeout: 60_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-arena-browser-'));
  const store = new AccountStore(join(directory, 'accounts.json'));
  const users = ['ArenaAlice', 'ArenaBruno'].map(name => store.register(name, 'test-password'));
  const sim = new WorldSimulation(734291, Date.now(), store);
  users.forEach((user, index) => Object.assign(sim.addPlayer(user.account, 'mage'), { x: index ? 115 : -115, y: ARENA_GATE.y }));
  sim.checkpoint(); store.flush();
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
    cwd: resolve('.'), windowsHide: true,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: store.path, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ended = once(child, 'close');
  let browser: Browser | undefined;
  const errors: string[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timeout')), 10_000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('Riftlands:')) { clearTimeout(timer); resolve(); } });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exit ${code}`)); });
    });
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'chrome' : undefined), headless: true });
    const clients: { page: Page; state: { snapshot?: Snapshot; room?: RoomState } }[] = [];
    for (const user of users) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(({ token, profile }) => {
        localStorage.setItem('riftlands.jwt', token);
        localStorage.setItem('riftlands.profile', JSON.stringify(profile));
      }, { token: user.token, profile: publicAccount(user.account) });
      const page = await context.newPage();
      const state: { snapshot?: Snapshot; room?: RoomState } = {};
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', socket => socket.on('framereceived', event => {
        const message = JSON.parse(String(event.payload)) as ServerMessage;
        if (message.type === 'room') state.room = message.room;
        if (message.type === 'snapshot') state.snapshot = message;
      }));
      await page.goto(`http://127.0.0.1:${port}`);
      await page.locator('[data-ref=join]').click();
      await expect(page.locator('.game-hud')).toBeVisible();
      await page.locator('.world-canvas').click();
      clients.push({ page, state });
    }
    const [a, b] = clients;
    await expect.poll(() => b.state.snapshot?.self.y).toBe(ARENA_GATE.y);
    await a.page.keyboard.down('KeyD');
    await expect.poll(() => a.state.snapshot?.self.x, { intervals: [20], timeout: 5000 }).toBeGreaterThan(-ARENA_GATE.radius + 25);
    await a.page.keyboard.up('KeyD');
    await expect.poll(() => a.state.snapshot?.arenaGate?.phase, { timeout: 15_000 }).toBe('waiting');
    mkdirSync(resolve('test-results'), { recursive: true });
    await a.page.screenshot({ path: resolve('test-results/arena-entrance.png') });

    await b.page.keyboard.down('KeyA');
    await expect.poll(() => b.state.snapshot?.self.x, { intervals: [20], timeout: 5000 }).toBeLessThan(ARENA_GATE.radius - 5);
    await b.page.keyboard.up('KeyA');
    await expect.poll(() => a.state.snapshot?.arenaGate?.phase, { intervals: [20] }).toBe('countdown');
    await b.page.keyboard.down('KeyD');
    await expect.poll(() => b.state.snapshot?.self.x, { intervals: [20] }).toBeGreaterThan(100);
    await b.page.keyboard.up('KeyD');
    await expect.poll(() => a.state.snapshot?.arenaGate?.phase).toBe('waiting');
    assert.equal(a.state.room?.mode, 'world');

    await b.page.keyboard.down('KeyA');
    await expect.poll(() => b.state.snapshot?.self.x, { intervals: [20] }).toBeLessThan(ARENA_GATE.radius - 10);
    await b.page.keyboard.up('KeyA');
    await expect.poll(() => a.state.room?.mode).toBe('arena');
    await expect.poll(() => b.state.room?.mode).toBe('arena');
    await expect.poll(() => a.state.snapshot?.matchEndsAt).toBeTruthy();
    assert.equal(a.state.room!.id, b.state.room!.id);
    assert.equal(a.state.snapshot!.actors.length, 2);
    assert.ok(a.state.snapshot!.actors.every(actor => actor.kind === 'player'));
    await expect(a.page.locator('.arena-status')).toContainText('Duello 1v1');
    await a.page.screenshot({ path: resolve('test-results/arena-duel.png') });

    await b.page.locator('[data-ref=leave]').click();
    await expect.poll(() => a.state.room?.mode).toBe('world');
    await expect(a.page.locator('.arena-status')).toContainText('esci dal cerchio');
    await expect(a.page.locator('.toast-stack')).toContainText('Vittoria');
    await a.page.keyboard.down('KeyS');
    await expect.poll(() => a.state.snapshot?.self.y, { intervals: [20] }).toBeGreaterThan(65);
    await a.page.keyboard.up('KeyS');
    await expect(a.page.locator('.arena-status')).toBeHidden();
    await expect(a.page.locator('[data-ref=coords]')).toContainText('ZONA SICURA');
    await a.page.screenshot({ path: resolve('test-results/outpost.png') });
    await a.page.keyboard.down('KeyS');
    await expect.poll(() => a.state.snapshot?.sanctuary, { intervals: [20] }).toBe('outside');
    await a.page.keyboard.up('KeyS');
    await expect(a.page.locator('[data-ref=coords]')).toContainText('PVP ATTIVO');
    assert.equal(a.state.snapshot!.self.spawnProtectedUntil, 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    child.kill(); await ended;
    rmSync(directory, { recursive: true, force: true });
  }
});
