import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { AccountStore, publicAccount } from '../../server/store';
import { WorldSimulation } from '../../server/simulation';
import { ARENA_GATE } from '../../shared/arena';
import { TILE_SIZE } from '../../shared/config';
import type { RoomState, Snapshot } from '../../shared/types';
import { SnapshotObserver } from '../fixtures/snapshot-observer';

test('live arena: fighters resume movement after countdown, spectator stays read-only and exit restores world body', { timeout: 90000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-betting-browser-'));
  const store = new AccountStore(join(directory, 'accounts.json'));
  const users = ['BetArden', 'BetLyra', 'BetViewer'].map(name => store.register(name, 'password'));
  const sim = new WorldSimulation(734291, Date.now(), store);
  users.forEach((user, i) => { user.account.gold = 100; Object.assign(sim.addPlayer(user.account, 'mage'), { x: i === 2 ? ARENA_GATE.x + 3 * TILE_SIZE : ARENA_GATE.x + (i ? 1 : -1) * (ARENA_GATE.radius + 30), y: ARENA_GATE.y }); });
  sim.checkpoint(); store.flush();
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], { cwd: resolve('.'), windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: store.path, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const ended = once(child, 'close');
  let browser: Browser | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
      child.stdout.on('data', data => { if (String(data).includes('Riftlands:')) { clearTimeout(timer); resolve(); } });
      child.once('error', reject); child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
    });
    browser = await chromium.launch({ channel: process.platform === 'win32' ? 'chrome' : undefined, headless: true });
    const fighters: { page: Page; room?: RoomState; snapshot?: Snapshot; sent: { type: string; roomId?: string }[] }[] = [];
    for (const user of users.slice(0, 2)) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const fighterPage = await context.newPage();
      fighterPage.setDefaultTimeout(8000);
      const state = { page: fighterPage, sent: [] } as typeof fighters[number]; fighters.push(state);
      fighterPage.on('websocket', socket => {
        const observer = new SnapshotObserver();
        socket.on('framereceived', frame => { const message = observer.read(String(frame.payload)); if (message.type === 'room') state.room = message.room; if (message.type === 'snapshot') state.snapshot = message; });
        socket.on('framesent', frame => state.sent.push(JSON.parse(String(frame.payload))));
      });
      await context.addInitScript(({ token, account }) => { localStorage.setItem('riftlands.jwt', token); localStorage.setItem('riftlands.profile', JSON.stringify(account)); }, { token: user.token, account: publicAccount(user.account) });
      await fighterPage.goto(`http://127.0.0.1:${port}`);
      await fighterPage.locator('[data-ref=join]').click();
      await expect(fighterPage.locator('[data-ref=world-entrance]')).toBeHidden();
    }
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(8000);
    const errors: string[] = [], sent: { type: string }[] = []; let latest: Snapshot | undefined;
    page.on('pageerror', e => errors.push(e.message));
    page.on('websocket', socket => {
      const observer = new SnapshotObserver();
      socket.on('framereceived', frame => { const message = observer.read(String(frame.payload)); if (message.type === 'snapshot') latest = message; });
      socket.on('framesent', frame => sent.push(JSON.parse(String(frame.payload))));
    });
    await page.addInitScript(({ token, account }) => { localStorage.setItem('riftlands.jwt', token); localStorage.setItem('riftlands.profile', JSON.stringify(account)); }, { token: users[2].token, account: publicAccount(users[2].account) });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.locator('[data-ref=join]').click();
    await expect(page.locator('[data-ref=world-entrance]')).toBeHidden();
    await expect.poll(() => latest?.betting?.bookmakerNearby).toBe(true);
    await page.keyboard.press('KeyF');
    await expect(page.getByRole('dialog', { name: 'Scommesse arena' })).toBeVisible();
    await expect(page.getByText('L’arena attende', { exact: false })).toBeVisible();
    t.diagnostic('Players connected; bookmaker open.');
    const started = fighters[0].snapshot!.time;
    await expect.poll(() => fighters[0].snapshot!.time - started, { timeout: 15000 }).toBeGreaterThan(11000);
    await Promise.all(fighters.map(async (f, i) => {
      const key = i ? 'KeyA' : 'KeyD';
      await f.page.keyboard.down(key);
      try { await expect.poll(() => Math.abs(f.snapshot!.self.x - ARENA_GATE.x), { intervals: [20], timeout: 5000 }).toBeLessThan(55); }
      finally { await f.page.keyboard.up(key); }
    }));
    await expect(page.locator('.arena-market')).toBeVisible({ timeout: 10000 });
    t.diagnostic('Arena paired; placing wager.');
    await page.getByLabel('Puntata in gold').fill('10');
    await page.getByRole('button', { name: 'Conferma puntata' }).click();
    await expect.poll(() => latest?.gold).toBe(90);
    await page.getByRole('button', { name: 'Chiudi scommesse' }).click();
    await page.getByRole('button', { name: 'Gold e scommesse attive' }).click();
    await expect(page.getByText('IN CORSO', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '◉ Assisti al duello' }).click();
    await expect.poll(() => !!latest?.betting?.spectating).toBe(true);
    t.diagnostic('Watching arena; waiting for countdown.');
    await expect(page.getByRole('button', { name: 'Esci dalla tribuna' })).toBeVisible();
    await expect(page.locator('.player-panel')).toBeHidden();
    await expect(page.locator('.combat-hud')).toBeHidden();
    await expect.poll(() => latest?.betting?.markets[0]?.phase, { timeout: 12000 }).toBe('live');
    t.diagnostic('Arena live; checking both fighters.');
    for (const f of fighters) {
      assert.ok(f.sent.filter(m => m.type === 'input' && m.roomId === f.room!.id).length < 120, 'countdown must not fill the pending input queue');
      const originX = f.snapshot!.self.x;
      await f.page.keyboard.down('KeyD');
      try { await expect.poll(() => f.snapshot!.self.x, { timeout: 5000 }).toBeGreaterThan(originX + 30); }
      finally { await f.page.keyboard.up('KeyD'); }
    }
    const sentIndex = sent.length;
    await page.locator('.world-canvas').focus();
    await page.keyboard.down('KeyW'); await page.keyboard.press('Space');
    await page.waitForTimeout(500); await page.keyboard.up('KeyW');
    assert.equal(sent.slice(sentIndex).some(m => m.type === 'input' || m.type === 'interaction'), false);
    await page.screenshot({ path: resolve('test-results/betting-live.png') });
    await page.getByRole('button', { name: 'Esci dalla tribuna' }).click();
    await expect.poll(() => latest?.self.id).toBe(users[2].account.id);
    await expect.poll(() => !!latest?.betting?.spectating).toBe(false);
    await page.getByRole('button', { name: 'Gold e scommesse attive' }).click();
    await expect(page.getByText('IN CORSO', { exact: true })).toBeVisible();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    child.kill(); await ended;
    rmSync(directory, { recursive: true, force: true });
  }
});
