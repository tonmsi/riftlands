import test from 'node:test';
import { SnapshotObserver } from '../fixtures/snapshot-observer';
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
import type { Snapshot } from '../../shared/types';
import type { NarrativeProgress } from '../../shared/narrative';

test('real multiplayer quest: accept, deliver via slot, touch hold to discard, another player collects', { timeout: 90_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riftlands-quest-browser-'));
  const store = new AccountStore(join(directory, 'accounts.json')), sim = new WorldSimulation(734291, Date.now(), store);
  const authored = WORLD_DOCUMENT.npcs.find(npc => npc.npcKind === 'old-fisher')!;
  assert.ok(authored, 'quest giver must be placed in authored world content');
  const npc = { x: (authored.x + .5) * TILE_SIZE, y: (authored.y + .5) * TILE_SIZE };
  const users = ['NewFisherFriend', 'BaitCollector', 'GroundCollector'].map((name, index) => {
    const user = store.register(name, 'test-password'), body = sim.addPlayer(user.account, 'mage');
    // Keep this interaction fixture protected from the user's procedurally populated slime zone.
    Object.assign(body, { x: npc.x + (index === 2 ? 14 : -48), y: npc.y + (index === 0 ? -48 : 48), aim: 0, spawnProtectedUntil: Date.now() + 120_000 }); return user;
  });
  users[1].account.narrative!.quests['stinking-bait'] = { status: 'active', objectives: {} }; insertItem(users[1].account.inventory!, 'slime-innards', 5);
  sim.checkpoint(); store.flush();
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port; await new Promise<void>(done => probe.close(() => done()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: resolve('.'), windowsHide: true,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: store.path, NODE_ENV: 'development' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const ended = once(child, 'close'); let browser: Browser | undefined, serverLog = '';
  child.stderr.on('data', data => { serverLog += String(data); });
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error(`Startup timeout: ${serverLog}`)), 15000);
      child.stdout.on('data', data => { if (String(data).includes('Riftlands:')) { clearTimeout(timer); done(); } });
      child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exit ${code}: ${serverLog}`)); });
    });
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
    mkdirSync('test-results', { recursive: true });
    const pages = [];
    for (const [index, user] of users.entries()) {
      const mobile = index === 1, context = await browser.newContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
      await context.addInitScript(({ token, profile }) => { localStorage.setItem('riftlands.jwt', token); localStorage.setItem('riftlands.profile', JSON.stringify(profile)); }, { token: user.token, profile: publicAccount(user.account) });
      const page = await context.newPage(), errors: string[] = []; let latest: Snapshot | undefined, narrative: NarrativeProgress | undefined, narrativeFrames = 0;
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', socket => {
        const observer = new SnapshotObserver();
        socket.on('framereceived', frame => {
          const payload = String(frame.payload), packet = JSON.parse(payload), message = observer.read(payload);
          if (message.type === 'snapshot') {
            latest = message;
            if (message.narrative) { narrative = message.narrative; if (packet.base !== null || narrativeFrames === 0) narrativeFrames++; }
          }
        });
      });
      await page.goto(`http://127.0.0.1:${port}`); await page.locator('[data-ref=join]').click();
      await expect(page.locator('[data-ref="world-entrance"]')).toBeHidden(); await expect(page.locator('.game-hud')).toBeVisible();
      await expect(page.locator('.inventory-slot')).toHaveCount(1);
      pages.push({ page, context, errors, latest: () => latest!, narrative: () => narrative!, narrativeFrames: () => narrativeFrames });
    }
    const [fresh, ready, collector] = pages;
    await expect(fresh.page.locator('.inventory-slot')).toHaveAttribute('aria-label', 'Slot inventario vuoto');
    await expect.poll(() => fresh.narrativeFrames()).toBe(1);
    await expect(fresh.page.locator('.player-panel')).not.toHaveClass(/has-active-quests/);
    await fresh.page.keyboard.press('KeyF'); await expect(fresh.page.locator('.npc-dialogue')).toBeVisible();
    await expect(fresh.page.locator('[data-dialogue-text]')).toContainText('tre interiora');
    await fresh.page.locator('[data-choice=event]').click(); await expect(fresh.page.locator('[data-dialogue-text]')).toContainText('certe persone non tornano');
    await fresh.page.locator('[data-choice=back]').click(); await fresh.page.locator('[data-choice=accept]').click();
    await expect.poll(() => fresh.latest().actors.find(actor => actor.dialogueId === 'old-fisher')?.questMarker).toBe('active');
    await expect(fresh.page.locator('.player-panel')).toHaveClass(/has-active-quests/);
    await expect.poll(() => fresh.narrative().quests['stinking-bait']?.status).toBe('active');
    const journalFrames = fresh.narrativeFrames();
    await fresh.page.locator('.player-journal-toggle').click(); await expect(fresh.page.locator('.journal-quest')).toContainText('Esche puzzolenti');
    await fresh.page.locator('.quest-journal header button').click();
    await fresh.page.screenshot({ path: 'test-results/quest-desktop.png' });
    await expect(fresh.page.locator('.npc-dialogue')).toBeHidden();
    await fresh.page.keyboard.press('KeyF'); await expect(fresh.page.locator('.npc-dialogue')).toBeVisible();
    const startX = fresh.latest().self.x; await fresh.page.keyboard.down('KeyA');
    await expect.poll(() => fresh.latest().self.x).toBeLessThan(startX - 20);
    await expect(fresh.page.locator('.npc-dialogue')).toBeHidden({ timeout: 6000 });
    await fresh.page.keyboard.up('KeyA');
    assert.equal(fresh.narrativeFrames(), journalFrames, 'unchanged progress is omitted from subsequent snapshots');

    await ready.page.keyboard.press('KeyF'); await expect(ready.page.locator('.dialogue-request')).toContainText('ancora 3');
    await ready.page.locator('.backpack-toggle').tap();
    const map = (await ready.page.locator('.compact-map').boundingBox())!, slot = (await ready.page.locator('.inventory-slot').boundingBox())!;
    assert.ok(slot.y >= map.y + map.height, 'inventory is below the compact minimap');
    await ready.page.screenshot({ path: 'test-results/quest-mobile.png' });
    const touch = await ready.context.newCDPSession(ready.page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: slot.x + slot.width / 2, y: slot.y + slot.height / 2 }] });
    await expect(ready.page.locator('.drop-item-panel')).toBeVisible();
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await ready.page.locator('.world-canvas').tap({ position: { x: 2, y: 2 } });
    await expect(ready.page.locator('.drop-item-panel')).toBeHidden(); await expect(ready.page.locator('.inventory-slot b')).toHaveText('5');
    await ready.page.keyboard.press('KeyF'); await ready.page.locator('.backpack-toggle').tap();
    await expect(ready.page.locator('.dialogue-request')).toContainText('ancora 3');
    await expect(ready.page.locator('.dialogue-rewards')).toContainText('Ricompense alla consegna');
    await expect(ready.page.locator('[data-reward-gold]')).toContainText('20 gold');
    await expect(ready.page.locator('.dialogue-rewards')).toContainText('Zaino da 2 slot');
    await expect(ready.page.locator('.dialogue-rewards')).toContainText('Canna da pesca');
    await ready.page.locator('.inventory-slot').tap();
    await expect(ready.page.locator('.npc-dialogue')).toBeHidden();
    await expect(ready.page.locator('.quest-completion-feedback')).toBeVisible();
    await expect(ready.page.locator('.inventory-slots')).toBeVisible();
    await expect(ready.page.locator('[data-choice=fishing]')).toHaveCount(0);
    await expect(ready.page.locator('.gold-gain')).toHaveText('+20 GOLD');
    await expect(ready.page.locator('[data-item-slot="0"] b')).toHaveText('2');
    await expect(ready.page.locator('[data-item-slot="1"]')).toHaveAttribute('aria-label', 'Canna da pesca, 1');
    await expect.poll(() => ready.latest().actors.find(actor => actor.dialogueId === 'old-fisher')?.questMarker).toBe('completed');
    await expect(ready.page.locator('.player-panel')).not.toHaveClass(/has-active-quests/);
    await expect.poll(() => ready.narrative().quests['stinking-bait']?.completions).toBe(1);
    assert.equal(ready.latest().inventory!.backpackId, 'backpack-2');
    await ready.page.keyboard.press('KeyF');
    await ready.page.locator('[data-choice=good-luck]').tap(); await expect(ready.page.locator('[data-dialogue-text]')).toContainText('Ti maledico');
    await ready.page.locator('[data-choice=leave]').tap(); await expect(ready.page.locator('.npc-dialogue')).toBeHidden();
    await ready.page.keyboard.press('KeyF'); await expect(ready.page.locator('[data-dialogue-text]')).toContainText('Per ora non me ne servono altre');
    await expect(ready.page.locator('[data-choice=accept]')).toHaveCount(0); await ready.page.locator('[data-dialogue-close]').tap();
    await expect(ready.page.locator('.npc-dialogue')).toBeHidden();

    await ready.page.locator('.backpack-toggle').tap();
    const rect = (await ready.page.locator('[data-item-slot="0"]').boundingBox())!;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }] });
    await expect(ready.page.locator('.drop-item-panel')).toBeVisible();
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(ready.page.locator('.drop-item-panel output')).toHaveText('2');
    await expect(ready.page.locator('.drop-item-panel input')).toHaveCount(0);
    await ready.page.locator('[data-drop-confirm]').tap(); await expect(ready.page.locator('[data-item-slot="0"]')).toHaveAttribute('aria-label', 'Slot inventario vuoto');
    await expect(collector.page.locator('.inventory-slot b')).toHaveText('2');
    assert.equal(collector.latest().actors.find(actor => actor.dialogueId === 'old-fisher')?.questMarker, 'available', 'public discarded items do not auto-accept quests');
    await ready.page.locator('.map-toggle').tap(); await ready.page.locator('[data-ref=leave]').tap();
    await ready.page.locator('[data-exit]').tap(); await expect(ready.page.locator('.game-hud')).toBeHidden();
    await ready.page.locator('[data-screen-target=achievements]').click();
    await expect(ready.page.locator('[data-ref=completed-quests]')).toContainText('Esche puzzolenti');
    await expect(ready.page.locator('[data-ref=completed-quests]')).toContainText('Completata');
    const ownerHistory = await ready.page.request.get(`http://127.0.0.1:${port}/api/lobby`, { headers: { Authorization: `Bearer ${users[1].token}` } });
    assert.equal((await ownerHistory.json()).narrative.quests['stinking-bait'].completions, 1);
    const guestHistory = await ready.page.request.get(`http://127.0.0.1:${port}/api/lobby`);
    assert.deepEqual((await guestHistory.json()).narrative.quests, {}, 'guest lobby never discloses another account’s quest history');
    for (const entry of pages) assert.deepEqual(entry.errors, []);
  } finally {
    await browser?.close(); child.kill(); await ended;
    rmSync(directory, { recursive: true, force: true });
  }
});
