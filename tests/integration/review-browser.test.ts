import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium, expect, type Browser } from '@playwright/test';
import { AccountStore, publicAccount } from '../../server/store';
import { WorldSimulation } from '../../server/simulation';
import type { DungeonDraft } from '../../shared/dungeon-draft';

test('dungeon authoring persists and exports; touch movement remains responsive with 30 ms transport RTT', { timeout: 90_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-review-'));
  const store = new AccountStore(join(directory, 'accounts.json'));
  const user = store.register('ReviewMobile', 'test-password');
  const sim = new WorldSimulation(734291, Date.now(), store);
  const actor = sim.addPlayer(user.account, 'mage'); actor.x = 0; actor.y = 72; sim.checkpoint(); store.flush();
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(done => probe.close(() => done()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: resolve('.'), windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: store.path, NODE_ENV: 'development' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ended = once(child, 'close'); let browser: Browser | undefined;
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timeout')), 15000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('Riftlands:')) { clearTimeout(timer); done(); } });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exit ${code}`)); });
    });
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/dungeon-maker.html`);
    await expect(page.locator('h1')).toHaveText('Dungeon maker.');
    const box = (await page.locator('#map').boundingBox())!;
    const scale = Math.max(4, Math.min(46, (box.width - 60) / 24, (box.height - 60) / 18));
    const at = (x: number, y: number) => ({ x: box.x + (box.width - 24 * scale) / 2 + (x + .5) * scale, y: box.y + (box.height - 18 * scale) / 2 + (y + .5) * scale });
    for (const [tool, x, y] of [['party', 3, 3], ['boss', 18, 12], ['npc:slime', 10, 8]] as const) {
      await page.locator(`[data-tool="${tool}"]`).click(); const p = at(x, y); await page.mouse.click(p.x, p.y);
    }
    await expect(page.locator('#issues')).toHaveText('Terreno e posizioni validi.');
    await page.locator('#entity-level').fill('7'); await page.locator('#entity-level').press('Tab');
    await page.locator('[data-tool="tile:water"]').click(); const tile = at(5, 5); await page.mouse.click(tile.x, tile.y);
    const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('riftlands.dungeon-draft.v1')!) as DungeonDraft);
    assert.equal((await draft()).tiles[5 * 24 + 5], 'water');
    await page.locator('#undo').click(); assert.equal((await draft()).tiles[5 * 24 + 5], 'path');
    await page.locator('#redo').click(); assert.equal((await draft()).tiles[5 * 24 + 5], 'water');
    const downloadEvent = page.waitForEvent('download'); await page.locator('#compile').click();
    const download = await downloadEvent; const exported = JSON.parse(readFileSync((await download.path())!, 'utf8'));
    assert.equal(exported.definition.npcSpawns[0].level, 7); assert.equal(exported.bossTemplate, '');
    await page.locator('#preview').click(); await expect(page.locator('#preview-label')).toBeVisible();
    await page.keyboard.down('ArrowRight'); await page.waitForTimeout(150); await page.keyboard.up('ArrowRight'); await page.keyboard.press('Escape');
    await page.reload(); assert.equal((await draft()).entities.length, 3);
    await page.locator('#file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"version":999}') });
    await expect(page.locator('#status')).toContainText('Bozza non valida'); assert.equal((await draft()).entities.length, 3);
    const bossTool = page.locator('#bosses button').first();
    await bossTool.click(); const secondBoss = at(15, 6); await page.mouse.click(secondBoss.x, secondBoss.y);
    assert.equal((await draft()).entities.filter(e => e.kind === 'boss').length, 2);
    await page.locator('[data-tool="flame"]').click(); const flame = at(3, 10); await page.mouse.click(flame.x, flame.y);
    await page.locator('#entity-span').fill('3'); await page.locator('#entity-span').press('Tab');
    await page.locator('#entity-vertical').selectOption('true');
    assert.equal((await draft()).entities.find(e => e.kind === 'flame')?.span, 3);
    const multiDownload = page.waitForEvent('download'); await page.locator('#compile').click();
    const multi = JSON.parse(readFileSync((await (await multiDownload).path())!, 'utf8'));
    assert.equal(multi.bosses.length, 2); assert.equal(multi.definition.additionalEncounters[0].encounterGroupId, 'main');
    assert.ok(multi.definition.passages.some((p: any) => p.fightState === 'flame'));
    await page.locator('#add-encounter').click();
    await expect(page.locator('#issues')).toContainText('sovrapposte');
    await page.locator('#remove-encounter').click();
    assert.equal((await draft()).encounters.length, 1);
    await page.screenshot({ path: 'test-results/dungeon-maker-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: 'test-results/dungeon-maker-mobile.png', fullPage: true });
    assert.equal(errors.length, 0, errors.join('\n')); await page.close();

    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await context.addInitScript(({ token, profile }) => {
      localStorage.setItem('riftlands.jwt', token); localStorage.setItem('riftlands.profile', JSON.stringify(profile));
      Object.defineProperty(navigator, 'standalone', { value: true });
    }, { token: user.token, profile: publicAccount(user.account) });
    const mobile = await context.newPage(); mobile.on('pageerror', error => errors.push(error.message));
    await mobile.routeWebSocket('**/ws', route => {
      const upstream = route.connectToServer(), timers = new Set<ReturnType<typeof setTimeout>>();
      const deliver = (action: () => void) => { const timer = setTimeout(() => { timers.delete(timer); action(); }, 15); timers.add(timer); };
      route.onMessage(data => deliver(() => upstream.send(data))); upstream.onMessage(data => deliver(() => route.send(data)));
      route.onClose(() => { for (const timer of timers) clearTimeout(timer); upstream.close(); });
    });
    await mobile.goto(`http://127.0.0.1:${port}`); await mobile.locator('[data-ref=join]').click();
    await expect(mobile.locator('.game-hud')).toBeVisible(); await mobile.waitForTimeout(500);
    await mobile.evaluate(async () => {
      const { Renderer } = await import('/client/render.ts' as string);
      const original = Renderer.prototype.render; const probe = window as any; probe.reviewSamples = [];
      Renderer.prototype.render = function(frame: any) { original.call(this, frame); if (frame.playing && frame.self) probe.reviewSamples.push({ at: performance.now(), x: frame.self.x, y: frame.self.y }); };
    });
    const stick = (await mobile.locator('.mobile-joystick').boundingBox())!;
    const cdp = await context.newCDPSession(mobile);
    const start = await mobile.evaluate(() => performance.now());
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: stick.x + stick.width / 2 + 42, y: stick.y + stick.height / 2 }] });
    await mobile.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mobile.waitForTimeout(160);
    const samples: { at: number; x: number; y: number }[] = await mobile.evaluate(() => (window as any).reviewSamples);
    const first = samples.find(sample => sample.x > .5)!;
    assert.ok(first, 'touch moves the local player'); assert.ok(first.at - start < 110, `touch onset ${first.at - start} ms`);
    const moving = samples.filter(s => s.at > start + 150 && s.at < start + 600);
    const pairs = moving.slice(1).map((s, i) => ({ dx: s.x - moving[i].x, dt: s.at - moving[i].at })).filter(p => p.dt > 3 && p.dt < 29);
    console.log(JSON.stringify({ touchOnsetMs: +(first.at - start).toFixed(1), frames: pairs.length, heldFrames: pairs.filter(p => p.dx < .1).length, maxStep: +Math.max(...pairs.map(p => p.dx)).toFixed(2), emulatedRttMs: 30 }));
    await mobile.screenshot({ path: 'test-results/review-mobile-game.png' });
    assert.ok(pairs.length > 10, `Only ${pairs.length} frames`); assert.ok(pairs.filter(p => p.dx < .1).length / pairs.length < .15, 'Movement held too often');
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.snapshotRate, 15); assert.ok(health.metrics.snapshotsSent > 0); assert.equal(errors.length, 0, errors.join('\n'));
    await context.close();
  } finally { await browser?.close(); child.kill(); await ended; }
});
