import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldDocument } from '../../shared/world-schema';

test('quest celebrations end with the session and saved history never replays on character selection or reconnect', { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'riftlands-quest-session-'));
  await writeFile(join(dir, 'world.json'), JSON.stringify(newWorldDocument())); await writeFile(join(dir, 'dungeons.json'), '[]');
  const studio = await startWorldStudio({ root: resolve('.'), documentPath: join(dir, 'world.json'), dungeonPath: join(dir, 'dungeons.json'), dataPath: join(dir, 'accounts.json'), port: 0 });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript('window.__name = value => value'); await page.clock.install();
    await page.route('**/quest-session-review', r => r.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }));
    await page.route('**/api/lobby', r => r.fulfill({ json: { account: null, friends: [], leaderboard: [] } }));
    await page.route('**/api/actor-catalog', r => r.fulfill({ status: 404 }));
    await page.goto(new URL('/quest-session-review', studio.url).href);
    await page.evaluate(async () => {
      const { GameUI } = await import('/client/ui/ui.ts' as string);
      const noop = () => {};
      const ui = new GameUI(document.querySelector<HTMLElement>('#app')!, { joinCredentials: noop, joinSaved: noop, logout: noop, leave: noop, social: noop, select: noop, cast: noop });
      ui.setAssetProgress(1, 1, 0); ui.setPlaying(true);
      const self = { id: 'traveller', name: 'Viaggiatore', kind: 'player', classId: 'mage', level: 1, xp: 0, kills: 0, deaths: 0, teamId: null,
        x: 0, y: 0, aim: 0, speed: 180, radius: 15, hp: 100, maxHp: 100, resource: 100, maxResource: 100, hidden: false,
        revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 }, loadout: { q: null, e: null } };
      const snapshot = { type: 'snapshot', tick: 1, time: 100_000, ack: 0, self, actors: [self], projectiles: [], pickups: [], events: [], online: 1, activeChunks: 1, gold: 0, narrative: { version: 1, quests: {}, flags: [] } };
      const completed = { version: 1, quests: { 'souls-home': { status: 'completed', objectives: { 'souls-returned': 1 }, completions: 1, completedAt: 100_000 } }, flags: [] };
      const update = () => ui.setSnapshot(structuredClone(snapshot), 20);
      update(); (window as any).sessionReview = { ui, snapshot, update, completed };
    });
    const silent = async () => {
      await expect(page.locator('.soul-farewell')).toBeHidden();
      await expect(page.locator('.quest-completion-feedback')).toBeHidden();
      await expect(page.locator('.quest-acceptance-feedback')).toBeHidden();
      await expect(page.locator('.player-panel')).not.toHaveClass(/quest-completed|quest-accepted/);
    };
    await page.evaluate(() => { const f = (window as any).sessionReview; f.snapshot.narrative.quests['souls-home'] = { status: 'active', objectives: {} }; f.update(); f.snapshot.narrative = structuredClone(f.completed); f.update(); });
    await page.clock.runFor(1000);
    await expect(page.locator('.soul-farewell')).toBeVisible(); await expect(page.locator('.quest-completion-feedback')).toBeVisible();
    // Leave during the farewell, then preview another character and the original one in the menu.
    await page.evaluate(() => { const f = (window as any).sessionReview; f.ui.setPlaying(false); f.ui.hud.updateJournal({ version: 1, quests: {}, flags: [] }); f.ui.hud.updateJournal(f.completed); });
    await silent(); await page.clock.runFor(1500); await silent();
    await page.evaluate(() => { const f = (window as any).sessionReview; f.ui.setPlaying(true); f.update(); }); await silent();
    // Changing identity without a menu reset must also treat the first progress as saved history.
    await page.evaluate(() => { const f = (window as any).sessionReview; f.snapshot.self.classId = 'warrior'; f.snapshot.narrative = { version: 1, quests: {}, flags: [] }; f.update(); f.snapshot.self.classId = 'mage'; f.snapshot.narrative = structuredClone(f.completed); f.update(); });
    await silent();
    await page.evaluate(() => { const f = (window as any).sessionReview; f.ui.setConnection('reconnecting'); f.snapshot.narrative = undefined; f.update(); f.snapshot.narrative = structuredClone(f.completed); f.ui.setConnection('online'); f.update(); });
    await silent();
    await page.locator('.player-journal-toggle').click(); await expect(page.locator('[data-completed-quests]')).toContainText('Le anime ritrovano casa');
    await page.locator('.quest-journal header button').click();
    // A new completion during gameplay still celebrates normally.
    await page.evaluate(() => { const f = (window as any).sessionReview; f.snapshot.narrative.quests['north-road'] = { status: 'active', objectives: {} }; f.update(); f.snapshot.narrative.quests['north-road'] = { status: 'completed', objectives: {}, completions: 1 }; f.update(); });
    await expect(page.locator('.quest-completion-feedback')).toContainText('Pietre che camminano'); await expect(page.locator('.soul-farewell')).toBeHidden();
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await studio.close(); await rm(dir, { recursive: true, force: true }); }
});
