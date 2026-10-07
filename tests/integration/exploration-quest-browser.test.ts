import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';

test('exploration journal, map target and completion glow work for Paladin and Nereo on desktop/touch', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    await mkdir('.tmp/quest-review', { recursive: true });
    for (const [width, height, touch] of [[1200, 760, false], [844, 390, true]] as const) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
      const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript('window.__name = value => value');
      await page.route('**/quest-review', route => route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>' }));
      await page.route('**/api/lobby', route => route.fulfill({ json: { account: null, friends: [], leaderboard: [] } }));
      await page.goto(`${server.resolvedUrls!.local[0]}quest-review`);
      const targets = await page.evaluate(async () => {
        for (const file of ['styles/style.css', 'styles/mobile.css', 'ui/hud/team.css', 'ui/lobby/lobby.css', 'ui/hud/hud.css', 'ui/interactions/interactions.css']) await import(`/client/${file}`);
        const { GameUI } = await import('/client/ui/ui.ts' as string);
        const { Renderer, drawMinimap } = await import('/client/render/render.ts' as string);
        const { CLASSES } = await import('/shared/config.ts' as string);
        const { NPC_DEFINITIONS } = await import('/shared/npcs.ts' as string);
        const root = document.querySelector<HTMLElement>('#app')!, noop = () => {};
        const ui = new GameUI(root, { join: noop, leave: noop, social: noop });
        ui.setAssetProgress(1, 1, 0); ui.setPlaying(true);
        const self = { id: 'review', kind: 'player', name: 'Leggenda', classId: 'paladin', ...CLASSES.paladin,
          x: 24, y: 504, aim: 0, radius: 15, level: 2, xp: 100, kills: 0, deaths: 0, teamId: null,
          hp: 100, maxHp: 100, resource: 100, maxResource: 100, hidden: false, revealedUntil: 0, deadUntil: 0,
          spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
        const narrative = { version: 1, revision: 0, quests: { 'stinking-bait': { status: 'completed', objectives: { 'innards-delivered': 3 }, completions: 1 } } };
        const snapshot = { type: 'snapshot', tick: 1, time: 200_000, ack: 0, self, actors: [self], projectiles: [], pickups: [], traps: [], events: [], online: 1, activeChunks: 1,
          inventory: { version: 1, capacity: 1, slots: [null] }, narrative };
        ui.setSnapshot(structuredClone(snapshot), 24);
        const noOldCompletion = !root.querySelector('.player-panel')!.classList.contains('quest-completed');
        const renderer = new Renderer(ui.canvas); await renderer.spritesReady;
        const actors = renderer.world.authoring.document.npcs.filter((n: any) => n.id.startsWith('npc-north-')).map((n: any) => {
          const spec = NPC_DEFINITIONS[n.npcKind];
          return { ...self, ...spec, id: 'authored:' + n.id, kind: 'npc', npcKind: n.npcKind, classId: spec.classId,
            x: (n.x + .5) * 48, y: (n.y + .5) * 48, level: n.level, hp: 55 + n.level * 12, maxHp: 55 + n.level * 12, spriteMoving: false };
        });
        (snapshot.narrative.quests as any)['north-road'] = { status: 'active', objectives: {}, completions: 0 };
        ui.setSnapshot(structuredClone(snapshot), 24);
        const map = document.createElement('canvas'); map.style.cssText = 'width:180px;height:180px'; document.body.append(map);
        drawMinimap(map, renderer.world, self, actors, [], 1600, 1, snapshot.narrative);
        drawMinimap(ui.compactMinimap, renderer.world, self, actors, [], 1600, 1, snapshot.narrative);
        const activeTargets = map.dataset.questTargetCount;
        const frame = { time: 200_000, self, actors: [self, ...actors], projectiles: [], pickups: [], traps: [], events: [], selectedId: null, previewClass: 'paladin', playing: true, ambientSpeechBlocked: true };
        renderer.render(frame);
        (window as any).questReview = { ui, snapshot, renderer, frame, map, actors, drawMinimap };
        map.remove();
        return { activeTargets, noOldCompletion };
      });
      assert.equal(targets.activeTargets, '1'); assert.equal(targets.noOldCompletion, true);
      await page.locator('.player-journal-toggle').click();
      await expect(page.locator('.journal-quest')).toContainText('Non occorre combattere');
      await page.locator('.quest-journal header button').click();
      await page.evaluate(() => {
        const f = (window as any).questReview;
        f.snapshot.narrative.quests['north-road'] = { status: 'completed', objectives: { 'road-reached': 1 }, completions: 1 };
        f.ui.setSnapshot(structuredClone(f.snapshot), 24);
        f.drawMinimap(f.ui.compactMinimap, f.renderer.world, f.snapshot.self, f.actors, [], 1600, 1, f.snapshot.narrative);
        f.renderer.render(f.frame);
      });
      await expect(page.locator('.player-panel')).toHaveClass(/quest-completed/);
      await expect(page.locator('.quest-completion-feedback')).toContainText('Missione completata · Pietre che camminano');
      await page.waitForTimeout(300);
      await page.evaluate(() => { const f = (window as any).questReview; f.renderer.render(f.frame); });
      await page.screenshot({ path: `.tmp/quest-review/arrival-${width}.png` });
      const cleared = await page.evaluate(() => {
        const f = (window as any).questReview; document.body.append(f.map);
        f.drawMinimap(f.map, f.renderer.world, f.snapshot.self, f.actors, [], 1600, 1, f.snapshot.narrative);
        const targets = f.map.dataset.questTargetCount; f.map.remove();
        f.snapshot.narrative.quests['stinking-bait'].completions = 2;
        f.ui.setSnapshot(structuredClone(f.snapshot), 24);
        return targets;
      });
      assert.equal(cleared, '0');
      await expect(page.locator('.quest-completion-feedback')).toContainText('Missione completata · Esche puzzolenti');
      await page.evaluate(() => { const f = (window as any).questReview; f.ui.setSnapshot({ ...f.snapshot, narrative: undefined }, 24); });
      await expect(page.locator('.quest-completion-feedback')).toBeHidden({ timeout: 6000 });
      await page.evaluate(() => {
        const f = (window as any).questReview; f.ui.setSnapshot(structuredClone(f.snapshot), 24);
        f.ui.setPlaying(false); f.ui.setPlaying(true); f.ui.setSnapshot(structuredClone(f.snapshot), 24);
        f.renderer.destroy();
      });
      await expect(page.locator('.player-panel')).not.toHaveClass(/quest-completed/);
      assert.deepEqual(errors, []); await page.close();
    }
  } finally { await browser?.close(); await server.close(); }
});
