import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium, expect, type Browser } from '@playwright/test';
import { AccountStore, publicAccount } from '../../server/store';
import { WorldSimulation } from '../../server/simulation';
import { collidesWorld, hasLineOfSight } from '../../shared/physics';
import type { Snapshot } from '../../shared/types';
import { SnapshotObserver } from '../fixtures/snapshot-observer';

test('two real browsers reconstruct deltas and preserve local and remote movement', { timeout: 60_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-snapshot-browser-'));
  const store = new AccountStore(join(directory, 'accounts.json'));
  const users = ['DeltaAlice', 'DeltaBruno'].map(name => store.register(name, 'test-password'));
  const simulation = new WorldSimulation(734291, Date.now(), store);
  users.forEach(user => simulation.addPlayer(user.account, 'mage'));
  const start = simulation.players.get(users[0].account.id)!;
  const direction = [['KeyS', 0, 1], ['KeyD', 1, 0], ['KeyW', 0, -1], ['KeyA', -1, 0]] as const;
  const move = direction.find(([, dx, dy]) => {
    const end = { x: start.x + dx * 80, y: start.y + dy * 80 };
    return !collidesWorld(end.x, end.y, start.radius, simulation.world) && hasLineOfSight(start, end, simulation.world);
  });
  assert.ok(move, 'current authored spawn needs a short walkable segment');
  simulation.checkpoint(); store.flush();
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(done => probe.close(() => done()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
    cwd: resolve('.'), windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: store.path, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ended = once(child, 'close'); let browser: Browser | undefined;
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timeout')), 10_000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('Riftlands:')) { clearTimeout(timer); done(); } });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
    });
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'chrome' : undefined), headless: true });
    const errors: string[] = [], clients: { page: import('@playwright/test').Page; latest?: Snapshot; packets: number; inputs: { dx: number; dy: number }[] }[] = [];
    for (const user of users) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(({ token, profile }) => { localStorage.setItem('riftlands.jwt', token); localStorage.setItem('riftlands.profile', JSON.stringify(profile)); }, { token: user.token, profile: publicAccount(user.account) });
      const page = await context.newPage(); const client = { page, packets: 0, latest: undefined as Snapshot | undefined, inputs: [] as { dx: number; dy: number }[] }; clients.push(client);
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', socket => {
        const observer = new SnapshotObserver();
        socket.on('framesent', frame => { const raw = JSON.parse(String(frame.payload)); if (raw.type === 'input') client.inputs.push(raw.input); });
        socket.on('framereceived', frame => {
          const raw = JSON.parse(String(frame.payload)); if (raw.encoding) client.packets++;
          const message = observer.read(String(frame.payload));
          if (message.type === 'snapshot') client.latest = message;
        });
      });
      await page.goto(`http://127.0.0.1:${port}`); await page.locator('[data-ref="join"]').click();
      await expect(page.locator('.game-hud')).toBeVisible();
      await expect(page.locator('[data-ref="world-entrance"]')).toBeHidden();
    }
    const [a, b] = clients;
    await expect.poll(() => a.latest?.actors.filter(actor => actor.kind === 'player').length).toBe(2);
    assert.equal(new Set(a.latest!.actors.map(actor => actor.id)).size, a.latest!.actors.length);
    await a.page.bringToFront();
    await a.page.locator('.world-canvas').focus();
    const origin = { x: a.latest!.self.x, y: a.latest!.self.y };
    const progress = (actor: { x: number; y: number } | undefined) => actor ? (actor.x - origin.x) * move[1] + (actor.y - origin.y) * move[2] : 0;
    await a.page.keyboard.down(move[0]);
    await expect.poll(() => progress(a.latest?.self), { intervals: [20] }).toBeGreaterThan(50);
    await a.page.keyboard.up(move[0]);
    await expect.poll(() => progress(b.latest?.actors.find(actor => actor.id === a.latest!.self.id))).toBeGreaterThan(50);
    await expect.poll(() => a.packets > 10 && b.packets > 10).toBe(true);
    assert.ok(a.inputs.some(input => input.dx !== 0 || input.dy !== 0));
    assert.ok(a.packets > 10 && b.packets > 10); assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); child.kill(); await ended;
    rmSync(directory, { recursive: true, force: true });
  }
});
