import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium, expect, type Browser } from '@playwright/test';

test('camp: authentication before class selection, preload, themed sections and saved session', { timeout: 90_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-lobby-'));
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(done => probe.close(() => done()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
    cwd: resolve('.'), windowsHide: true,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: join(directory, 'accounts.json'), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ended = once(child, 'close');
  let browser: Browser | undefined;
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timeout')), 15_000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('Riftlands:')) { clearTimeout(timer); done(); } });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exit ${code}`)); });
    });
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    let sockets = 0; page.on('websocket', () => sockets++);
    // Hold the configured PNGs: the menu and temporary branding must stay hidden.
    let releaseArtwork!: () => void;
    const artworkGate = new Promise<void>(done => { releaseArtwork = done; });
    await page.route('**/home/*.png', async route => { await artworkGate; await route.continue(); });
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-ref="menu-boot"]')).toBeVisible();
    await expect(page.locator('.lobby')).toBeHidden();
    await page.screenshot({ path: 'test-results/lobby-loading.png' });
    releaseArtwork();
    await expect(page.locator('[data-ref="menu-boot"]')).toBeHidden();
    await expect(page.locator('.asset-loader')).toHaveClass(/is-ready/);
    await expect(page.locator('[data-ref="character-selection"]')).toBeHidden();
    await expect(page.locator('[data-ref="camp-nav"]')).toBeHidden();
    await page.screenshot({ path: 'test-results/lobby-login-desktop.png', fullPage: true });
    await page.locator('[data-ref="tab-register"]').click();
    await page.locator('[data-ref="name"]').fill('CampTester');
    await page.locator('[data-ref="password"]').fill('test-password');
    await page.locator('[data-ref="join"]').click();
    await expect(page.locator('.lobby')).toHaveAttribute('data-screen', 'character');
    assert.equal(sockets, 0, 'authentication does not connect the player to the world');
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/health`)).json()).online, 0);
    await page.locator('[data-class="paladin"]').click();
    await expect(page.locator('[data-ref="champion-name"]')).toHaveText('Paladino');
    await expect(page.locator('.champion-stats > div').filter({ has: page.locator('dt', { hasText: /^Movimento$/ }) })).toContainText('180');
    await expect(page.locator('.champion-stats > div').filter({ has: page.locator('dt', { hasText: /^Vel. attacco$/ }) })).toContainText('1,54');
    await expect(page.locator('.champion-stats > div').filter({ has: page.locator('dt', { hasText: /^Armatura$/ }) })).toContainText('22');
    await page.screenshot({ path: 'test-results/lobby-character-desktop.png', fullPage: true });
    assert.equal(await page.locator('.hub-nav').count(), 0, 'navigation is not repeated inside a panel');
    const shell = await page.locator('.lobby').boundingBox();
    const contentWidth = await page.locator('.camp-content').evaluate(element => element.clientWidth);
    for (const section of ['rankings', 'achievements', 'friends', 'stats']) {
      await page.locator(`[data-screen-target="${section}"]`).click();
      assert.deepEqual(await page.locator('.lobby').boundingBox(), shell);
      assert.equal(await page.locator('.camp-content').evaluate(element => element.clientWidth), contentWidth);
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true, 'only the content scrolls');
    }
    await page.locator('[data-screen-target="stats"]').click();
    await expect(page.locator('.profile-stats')).toBeVisible();
    await page.screenshot({ path: 'test-results/lobby-stats-desktop.png', fullPage: true });
    await page.locator('.options-button').click();
    await page.locator('[data-ref="configure-controls"]').click();
    await expect(page.getByRole('dialog', { name: 'Controlli', exact: true })).toBeVisible();
    await page.locator('[data-binding="basic-0"]').click(); await page.keyboard.press('KeyF');
    await page.locator('[data-save]').click();
    assert.ok((await page.evaluate(() => localStorage.getItem('riftlands.controls.v1')))?.includes('KeyF'));
    await page.locator('[data-screen-target="character"]').click();
    await page.locator('[data-ref="join"]').click();
    await expect(page.locator('.lobby')).toHaveAttribute('data-screen', 'ready');
    await page.screenshot({ path: 'test-results/lobby-journey-desktop.png', fullPage: true });
    await page.locator('[data-ref="join"]').click();
    await expect(page.locator('.game-hud')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-ref="menu-boot"]')).toBeHidden();
    await expect(page.locator('.lobby')).toHaveAttribute('data-screen', 'character');
    await expect(page.locator('[data-ref="auth-box"]')).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/lobby-character-mobile.png', fullPage: true });
    await page.locator('.champion-stats').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/lobby-character-stats-mobile.png', fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('[data-screen-target="stats"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('[data-screen-target="character"]').click();
    await page.locator('[data-ref="change-account-btn"]').click();
    await expect(page.locator('.lobby')).toHaveAttribute('data-screen', 'auth');
    await page.screenshot({ path: 'test-results/lobby-login-mobile.png', fullPage: true });
    await page.locator('[data-ref="name"]').fill('CampTester');
    await page.locator('[data-ref="password"]').fill('wrong-password');
    await page.locator('[data-ref="tab-login"]').click();
    await page.locator('[data-ref="join"]').click();
    await expect(page.locator('[data-ref="join"]')).toBeEnabled();
    await expect(page.locator('.lobby')).toHaveAttribute('data-screen', 'auth');
    await page.locator('[data-ref="password"]').fill('test-password');
    await page.locator('[data-ref="join"]').click();
    await expect(page.locator('.lobby')).toHaveAttribute('data-screen', 'character');
    let releaseManifest!: () => void;
    const manifestGate = new Promise<void>(done => { releaseManifest = done; });
    await page.route('**/home/assets.json', async route => {
      await manifestGate;
      await route.fulfill({ json: {
        logo: '/favicon.svg', loginBackground: '/favicon.svg?login', selectionBackground: '/favicon.svg?neutral',
        classes: { paladin: { background: '/favicon.svg?paladin' }, warrior: { background: '/favicon.svg?warrior' }, mage: { portrait: '/home/missing.png' } },
      } });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-ref="menu-boot"]')).toBeVisible();
    await expect(page.locator('.lobby')).toBeHidden();
    releaseManifest();
    await expect(page.locator('[data-ref="menu-boot"]')).toBeHidden();
    await expect(page.locator('[data-ref="asset-label"]')).toContainText('alcune immagini non disponibili');
    await expect(page.locator('[data-ref="brand-image"]')).toBeVisible();
    await page.locator('[data-class="paladin"]').click();
    await page.locator('[data-screen-target="stats"]').click();
    assert.ok((await page.locator('.lobby').getAttribute('style'))?.includes('?paladin'));
    await page.locator('[data-screen-target="character"]').click();
    assert.ok((await page.locator('.lobby').getAttribute('style'))?.includes('?neutral'));
    await page.locator('[data-class="warrior"]').click();
    await page.locator('.options-button').click();
    assert.ok((await page.locator('.lobby').getAttribute('style'))?.includes('?warrior'));
    await page.locator('[data-screen-target="character"]').click();
    await page.locator('[data-ref="join"]').click();
    await expect(page.locator('[data-ref="join"]')).toBeEnabled();
    const authResponse = await fetch(`http://127.0.0.1:${port}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://other.example' }, body: '{}' });
    assert.equal(authResponse.status, 403);
    const malformed = await fetch(`http://127.0.0.1:${port}/api/auth`, { method: 'POST', body: '{' });
    assert.equal(malformed.status, 400);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); child.kill(); await ended; }
});
