import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { ACTOR_CATALOG } from '../../shared/actor-catalog';
import { newWorldDocument } from '../../shared/world-schema';

test('boss laboratory previews, saves settings, rejects stale edits and exposes new templates in Dungeon Maker', { timeout: 60_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'riftlands-boss-editor-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = resolve('.'), options = { root, documentPath: join(dir, 'world.json'), dungeonPath: join(dir, 'dungeons.json'), dataPath: join(dir, 'accounts.json'), port: 0 };
  const actorPath = join(dir, 'actor-catalog.json');
  await writeFile(options.documentPath, JSON.stringify(newWorldDocument())); await writeFile(options.dungeonPath, '[]');
  await writeFile(actorPath, JSON.stringify(ACTOR_CATALOG));
  const studio = await startWorldStudio(options);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await page.locator('#open-boss-editor').click(); await expect(page.locator('#boss-status')).toHaveText('Catalogo caricato.');
    await page.locator('#boss-anchorY').locator('xpath=ancestor::details').locator('summary').click(); await page.locator('#boss-drawSize').fill('168'); await page.locator('#boss-anchorY').fill('0.78');
    await page.locator('#boss-shadowWidth').fill('42'); await page.locator('#boss-shadowY').fill('9');
    await expect(page.locator('#boss-animation-label')).toBeHidden();
    await expect(page.locator('[data-slot-asset=moving]')).toHaveValue('/actor-assets/boss-warden.png');
    await expect(page.locator('[data-select-slot=walk]')).toHaveCount(0);
    await page.locator('#boss-attack-name').fill('Fendente del custode delle rovine');
    await page.locator('#boss-attack-name').blur();
    await expect(page.locator('[data-select-slot=melee]')).toHaveAttribute('title', 'Melee · Fendente del custode delle rovine');
    await page.locator('[data-select-slot=melee]').click();
    await expect(page.locator('#boss-directional')).toBeChecked();
    await page.locator('#boss-animation-offset').locator('xpath=ancestor::details').locator('summary').click(); await page.locator('#boss-animation-offset').check(); await page.locator('#boss-animationAnchorY').fill('0.8'); await page.locator('#boss-animationAnchorY').blur();
    await page.locator('[data-select-slot=idle]').click();
    await expect(page.locator('#boss-frame')).toContainText('168 px');
    await page.locator('#boss-save').click(); await expect(page.locator('#boss-status')).toContainText('Catalogo salvato con backup');
    const saved = JSON.parse(await readFile(actorPath, 'utf8'));
    assert.equal(saved.skins['stone-warden'].anchor.y, .78); assert.equal(saved.skins['stone-warden'].drawSize, 168);
    assert.equal(saved.skins['stone-warden'].animations.melee.anchor.y, .8);
    assert.equal(saved.bosses[0].attacks[0].name, 'Fendente del custode delle rovine');
    assert.equal(await readFile(options.dungeonPath, 'utf8'), '[]');
    await expect(page.locator('#boss-editor')).toBeVisible();
    await mkdir(join(root, '.tmp'), { recursive: true });
    await page.locator('[data-select-slot=idle]').click();
    await page.locator('#boss-editor').screenshot({ path: join(root, '.tmp', 'boss-editor.png') });
    // An empty idle uses the movement frame, including with the saved legacy walk key.
    await page.locator('[data-slot-asset=idle]').selectOption('');
    await page.locator('#boss-direction').selectOption('2');
    await page.locator('[data-select-slot=idle]').click();
    await expect(page.locator('#boss-frame')).toContainText('Frame 9 / 16');
    await page.locator('#boss-save').click(); await expect(page.locator('#boss-status')).toContainText('Catalogo salvato con backup');
    const pixels = await page.evaluate(async () => {
      const { CatalogSpriteRenderer } = await import('/client/render/catalog-sprite-renderer.ts' as string);
      const sprites = new CatalogSpriteRenderer(); await sprites.prepare();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      const ctx = canvas.getContext('2d')!; ctx.translate(128, 128);
      const actor = { kind: 'npc', npcKind: 'boss', bossSkin: 'stone-warden', hp: 100, aim: 0, bossAwakenedAt: 0 } as any;
      const samples = [];
      for (const [time, moving] of [[2000, false], [2260, false], [2000, true]] as const) {
        ctx.clearRect(-128, -128, 256, 256);
        samples.push({ drawn: sprites.draw(ctx, actor, time, moving, 2), data: canvas.toDataURL() });
      }
      const [a, b, c] = samples;
      return { drawn: a.drawn && b.drawn && c.drawn, still: a.data === b.data, animated: a.data !== c.data };
    });
    assert.deepEqual(pixels, { drawn: true, still: true, animated: true });
    // Replacing a legacy movement sheet writes the unified moving key.
    await page.locator('[data-slot-asset=moving]').selectOption('/actor-assets/npc-old-fisher.png');
    await page.locator('#boss-save').click(); await expect(page.locator('#boss-status')).toContainText('Catalogo salvato con backup');
    const migrated = JSON.parse(await readFile(actorPath, 'utf8'));
    assert.equal(migrated.skins['stone-warden'].animations.walk, undefined);
    assert.equal(migrated.skins['stone-warden'].animations.moving.asset, '/actor-assets/npc-old-fisher.png');
    Object.assign(saved, migrated);
    saved.bosses[0].hp += 1; await writeFile(actorPath, JSON.stringify(saved));
    await page.locator('#boss-hp').fill('500'); await page.locator('#boss-save').click();
    await expect(page.locator('#boss-status')).toContainText('altra finestra');
    page.once('dialog', dialog => dialog.accept()); await page.locator('#boss-reload').click(); await expect(page.locator('#boss-status')).toHaveText('Catalogo caricato.');
    page.once('dialog', dialog => dialog.accept('test-warden'));
    await page.locator('#boss-duplicate').click(); await page.locator('#boss-hp').fill('777');
    await page.locator('#boss-save').click(); await expect(page.locator('#boss-status')).toContainText('Catalogo salvato con backup');
    const updated = JSON.parse(await readFile(actorPath, 'utf8'));
    assert.equal(updated.bosses.find((b: any) => b.id === 'test-warden').hp, 777);
    await page.locator('#boss-close').click();
    await page.locator('#area-kind').selectOption('dungeon'); await page.locator('#dungeon-resources > summary').click();
    const popup = page.waitForEvent('popup'); await page.locator('#open-dungeon-maker').click(); const dungeon = await popup;
    dungeon.on('pageerror', e => errors.push(e.message));
    await expect(dungeon.locator('#entity-template option[value="test-warden"]')).toHaveCount(1);
    await dungeon.locator('[data-tool="boss:test-warden"]').click();
    await expect(dungeon.locator('#tool-name')).toHaveText('test-warden');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await studio.close(); }
});
