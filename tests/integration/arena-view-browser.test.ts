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
import { ARENA_GATE } from '../../shared/arena';
import type { RoomState, Snapshot } from '../../shared/types';
import { SnapshotObserver } from '../fixtures/snapshot-observer';

test('arena shares world zoom, reflects controls and keeps labels upright for both players', { timeout: 60_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-arena-view-'));
  const store = new AccountStore(join(directory, 'accounts.json'));
  const users = ['ViewAlice', 'ViewBruno'].map(name => store.register(name, 'test-password'));
  const sim = new WorldSimulation(734291, Date.now(), store);
  users.forEach((user, i) => Object.assign(sim.addPlayer(user.account, 'mage'), { x: ARENA_GATE.x + (i ? 1 : -1) * (ARENA_GATE.radius + 25), y: ARENA_GATE.y }));
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
    });
    browser = await chromium.launch({ channel: process.platform === 'win32' ? 'chrome' : undefined, headless: true });
    const clients: { page: Page; state: { snapshot?: Snapshot; room?: RoomState }; user: typeof users[number] }[] = [];
    for (const user of users) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(({ token, profile }) => {
        localStorage.setItem('riftlands.jwt', token); localStorage.setItem('riftlands.profile', JSON.stringify(profile));
        const labels: Record<string, { x: number; y: number; scale: number; upright: boolean }> = {};
        (window as any).arenaLabels = labels;
        const original = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
          if ((text === 'Hai vinto' || text === 'Hai perso') && this.globalAlpha > .8) (window as any).resultOverlay = text;
          if (text.startsWith('View')) {
            const t = this.getTransform();
            labels[text] = { x: t.a * x + t.c * y + t.e, y: t.b * x + t.d * y + t.f, scale: t.a, upright: t.d > 0 };
          }
          if (maxWidth === undefined) original.call(this, text, x, y); else original.call(this, text, x, y, maxWidth);
        };
      }, { token: user.token, profile: publicAccount(user.account) });
      const page = await context.newPage();
      const state: { snapshot?: Snapshot; room?: RoomState } = {};
      const observer = new SnapshotObserver();
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', socket => socket.on('framereceived', event => {
        const message = observer.read(String(event.payload));
        if (message.type === 'room') state.room = message.room;
        if (message.type === 'snapshot') state.snapshot = message;
      }));
      await page.goto(`http://127.0.0.1:${port}`);
      await page.locator('[data-ref=join]').click();
      await expect(page.locator('[data-ref="world-entrance"]')).toBeHidden();
      await expect.poll(() => page.evaluate(() => (window as any).arenaLabels[Object.keys((window as any).arenaLabels).find(k => k.endsWith(' · tu'))!]?.scale)).toBeCloseTo(.95, 5);
      clients.push({ page, state, user });
    }
    for (const [i, { page, state }] of clients.entries()) {
      await page.locator('.world-canvas').click();
      await page.keyboard.down(i ? 'KeyA' : 'KeyD');
      await expect.poll(() => Math.abs(state.snapshot!.self.x - ARENA_GATE.x), { intervals: [20] }).toBeLessThan(ARENA_GATE.radius - 25);
      await page.keyboard.up(i ? 'KeyA' : 'KeyD');
    }
    for (const { state } of clients) await expect.poll(() => state.room?.mode, { timeout: 20_000 }).toBe('arena');
    mkdirSync(resolve('test-results'), { recursive: true });
    for (const [i, client] of clients.entries()) {
      const { page, state, user } = client;
      await expect.poll(() => state.snapshot?.self.y).toBe(i ? 240 : -240);
      await page.locator('.world-canvas').click();
      const before = state.snapshot!.self.y;
      await page.keyboard.down('KeyW');
      await expect.poll(() => i ? before - state.snapshot!.self.y : state.snapshot!.self.y - before).toBeGreaterThan(120);
      await page.keyboard.up('KeyW');
      const labels = await page.evaluate(() => (window as any).arenaLabels);
      const own = labels[`${user.account.name} · tu`];
      assert.ok(Math.abs(own.scale - .95) < .00001); assert.equal(own.upright, true);
      await expect.poll(() => page.evaluate(name => {
        const labels = (window as any).arenaLabels;
        return labels[name]?.y < labels[Object.keys(labels).find(k => k.endsWith(' · tu'))!]?.y;
      }, clients[1 - i].user.account.name)).toBe(true);
      await page.screenshot({ path: resolve(`test-results/arena-view-${i}.png`) });
      await expect(page.locator('.compact-minimap')).toHaveAttribute('data-view-sign', i ? '1' : '-1');
    }
    const page = clients[0].page;
    await page.locator('[data-ref=settings-toggle]').click();
    const zoom = page.locator('.settings-actions [data-camera-zoom]');
    await zoom.fill('150');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('riftlands.camera')!).zoom)).toBe(1.5);
    await expect.poll(() => page.evaluate(() => (window as any).arenaLabels['ViewAlice · tu'].scale)).toBeCloseTo(1.425, 5);
    await page.locator('.settings-actions [data-camera-limit]').selectOption('compact');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('riftlands.camera')!).viewLimit)).toBe('compact');
    await page.screenshot({ path: resolve('test-results/arena-camera-settings.png') });
    const leaving = clients[1].page;
    await leaving.locator('.map-toggle').click();
    await leaving.locator('[data-ref=leave]').click();
    await leaving.locator('[data-exit]').click();
    await expect.poll(() => clients[0].state.room?.mode).toBe('world');
    await expect(page.locator('.match-result-status')).toContainText('Hai vinto');
    await expect(page.locator('.match-result-status')).toContainText('Forfait');
    await expect.poll(() => page.evaluate(() => (window as any).resultOverlay)).toBe('Hai vinto');
    await page.screenshot({ path: resolve('test-results/arena-win-forfeit.png') });
    await expect(page.locator('.compact-minimap')).toHaveAttribute('data-view-sign', '1');
    await page.locator('.world-canvas').click();
    const before = clients[0].state.snapshot!.self.y;
    await page.keyboard.down('KeyW');
    await expect.poll(() => before - clients[0].state.snapshot!.self.y).toBeGreaterThan(30);
    await page.keyboard.up('KeyW');
    await page.reload();
    await expect(page.locator('[data-hub-panel=settings] [data-camera-zoom]')).toHaveValue('150');
    await expect(page.locator('[data-hub-panel=settings] [data-camera-limit]')).toHaveValue('compact');
    await leaving.locator('[data-ref=join]').click();
    await expect(leaving.locator('[data-ref="world-entrance"]')).toBeHidden();
    await expect(leaving.locator('.match-result-status')).toContainText('Hai perso');
    await expect(leaving.locator('.match-result-status')).toContainText('Forfait');
    await expect.poll(() => leaving.evaluate(() => (window as any).resultOverlay)).toBe('Hai perso');
    await leaving.screenshot({ path: resolve('test-results/arena-loss-forfeit.png') });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); child.kill(); await ended;
    rmSync(directory, { recursive: true, force: true });
  }
});
