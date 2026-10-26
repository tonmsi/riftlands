import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { ACTOR_CATALOG } from '../../shared/actor-catalog';
import { newWorldDocument } from '../../shared/world-schema';

test('new NPCs author independent bubbles and branching dialogue, preview choices and preserve inheritance after reload', { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'riftlands-npc-conversation-'));
  const options = { root: resolve('.'), documentPath: join(dir, 'world.json'), dungeonPath: join(dir, 'dungeons.json'), dataPath: join(dir, 'accounts.json'), port: 0 };
  const actorPath = join(dir, 'actor-catalog.json');
  await writeFile(options.documentPath, JSON.stringify(newWorldDocument())); await writeFile(options.dungeonPath, '[]');
  await writeFile(actorPath, JSON.stringify(ACTOR_CATALOG));
  const studio = await startWorldStudio(options);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await page.locator('#open-npc-editor').click(); await expect(page.locator('#boss-status')).toHaveText('Catalogo caricato.');
    await page.locator('#npc-new-panel > summary').click();
    await page.locator('#npc-new-id').fill('inn-host'); await page.locator('#npc-new-name').fill('Locandiere');
    await page.locator('#npc-new-create').click(); await expect(page.locator('#boss-select')).toHaveValue('variant:inn-host');
    await expect(page.locator('#npc-dialogue-mode')).toHaveValue('none'); await expect(page.locator('#npc-speech-mode')).toHaveValue('none');
    await page.locator('#npc-dialogue-ring').uncheck();
    await page.locator('#npc-speech-mode').selectOption('custom'); await page.locator('#npc-speech-intro').fill('Benvenuto alla locanda!');
    await page.locator('#npc-speech-lines').fill('La zuppa è calda.\nSiediti dove vuoi.');
    await page.locator('#npc-dialogue-mode').selectOption('custom'); await page.locator('#npc-node-text').fill('Che cosa cerchi?');
    await page.locator('#npc-node-add').click(); await page.locator('#npc-node-text').fill('Hanno riaperto la strada.');
    await page.locator('#npc-dialogue-node').selectOption('intro');
    await page.locator('[data-choice-label="leave"]').fill('Ci sono notizie?');
    await page.locator('[data-choice-next="leave"]').selectOption('frase-1');
    await page.locator('#npc-choice-add').click(); await page.locator('[data-choice-label="risposta-1"]').fill('A presto.');
    await page.locator('#npc-dialogue-fields details > summary').click();
    await page.locator('#npc-dialogue-restart').click();
    await expect(page.locator('#npc-dialogue-preview-text')).toHaveText('Che cosa cerchi?');
    await page.locator('#npc-dialogue-preview-choices button').filter({ hasText: 'Ci sono notizie?' }).click();
    await expect(page.locator('#npc-dialogue-preview-text')).toHaveText('Hanno riaperto la strada.');
    await page.locator('#npc-dialogue-preview-choices button').click();
    await expect(page.locator('#npc-dialogue-preview-text')).toHaveText('Conversazione conclusa.');
    await page.locator('#boss-save').click(); await expect(page.locator('#boss-status')).toContainText('Catalogo salvato con backup');
    // Further edits after save must bind to the newly parsed catalog.
    await page.locator('[data-choice-label="risposta-1"]').fill('Devo andare.');
    await page.locator('#boss-save').click(); await expect(page.locator('#boss-status')).toContainText('Catalogo salvato con backup');
    const saved = JSON.parse(await readFile(actorPath, 'utf8')), npc = saved.npcVariants.find((v: any) => v.id === 'inn-host');
    assert.equal(npc.base, 'custom-npc'); assert.equal(npc.conversation.speech.intro, 'Benvenuto alla locanda!');
    assert.equal(npc.conversation.showDialogueRing, false);
    assert.deepEqual(npc.conversation.speech.lines, ['La zuppa è calda.', 'Siediti dove vuoi.']);
    assert.equal(npc.conversation.dialogue.nodes.intro.choices[1].label, 'Devo andare.');
    assert.deepEqual(saved.bosses, ACTOR_CATALOG.bosses);
    await page.locator('#boss-close').click(); await page.locator('#npc').selectOption('variant:inn-host');
    await page.locator('[data-tool="npc"]').click(); await page.locator('#map').click({ position: { x: 220, y: 230 } });
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('Progetto salvato con backup');
    await page.reload(); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await page.locator('#world-explorer > summary').click(); await page.locator('#explorer-search').fill('Locandiere'); await page.locator('.explorer-item').click();
    await page.locator('#selected-npc-name').fill('Marco'); await page.locator('#selection-update').click();
    await expect(page.locator('#selected-npc-dialogue-ring')).toHaveValue('@inherit');
    await page.locator('#selected-npc-dialogue-ring').selectOption('true'); await page.locator('#selection-update').click();
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('Progetto salvato con backup');
    const world = JSON.parse(await readFile(options.documentPath, 'utf8'));
    assert.equal(world.npcs[0].settings.variantId, 'inn-host'); assert.equal(world.npcs[0].settings.dialogueId, undefined);
    assert.equal(world.npcs[0].settings.showDialogueRing, true);
    await page.locator('#open-npc-editor').click(); await expect(page.locator('#boss-status')).toHaveText('Catalogo caricato.');
    await page.locator('#boss-select').selectOption('variant:inn-host'); await expect(page.locator('#npc-speech-intro')).toHaveValue('Benvenuto alla locanda!');
    await expect(page.locator('#npc-dialogue-mode')).toHaveValue('custom');
    await expect(page.locator('#npc-dialogue-ring')).not.toBeChecked();
    await expect(page.locator('#npc-node-text')).toHaveValue('Che cosa cerchi?');
    const rings = await page.evaluate(async () => {
      const { ActorRenderer } = await import('/client/render/actor-renderer.ts' as string);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      const ctx = canvas.getContext('2d')!, renderer = new ActorRenderer(ctx, matchMedia('(pointer: coarse)'));
      await renderer.spritesReady;
      let rings = 0; const arc = ctx.arc.bind(ctx);
      ctx.arc = (...args: Parameters<CanvasRenderingContext2D['arc']>) => { if (args[2] === 24) rings++; arc(...args); };
      const actor = { id: 'host', kind: 'npc', npcKind: 'custom-npc', npcVariantId: 'inn-host', name: 'Host', classId: 'warrior', x: 64, y: 64, radius: 18,
        hp: 100, maxHp: 100, resource: 0, maxResource: 100, aim: 0, speed: 0, level: 1, xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false,
        revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 }, dialogueId: 'npc:v:inn-host' } as any;
      renderer.drawActor({ ...actor, showDialogueRing: false }, 1000, false, false, false, new Set()); const hidden = rings;
      rings = 0; renderer.drawActor({ ...actor, showDialogueRing: true }, 1000, false, false, false, new Set());
      return { hidden, shown: rings };
    });
    assert.deepEqual(rings, { hidden: 0, shown: 1 });
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await studio.close(); await rm(dir, { recursive: true, force: true }); }
});
