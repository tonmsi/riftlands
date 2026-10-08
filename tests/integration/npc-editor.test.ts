import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdtemp, writeFile, readFile, rm, access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { ACTOR_CATALOG } from '../../shared/actor-catalog';
import { newWorldDocument } from '../../shared/world-schema';

test('NPC laboratory imports sprites, previews idle fallback, saves every NPC type and preserves bosses', { timeout: 60_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'riftlands-npc-editor-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = resolve('.'), options = { root, documentPath: join(dir, 'world.json'), dungeonPath: join(dir, 'dungeons.json'), dataPath: join(dir, 'accounts.json'), port: 0 };
  const actorPath = join(dir, 'actor-catalog.json');
  const importedPath = join(root, 'public/actor-assets', 'npc-editor-import-test.png');
  const existed = await access(importedPath).then(() => true, () => false);
  await writeFile(options.documentPath, JSON.stringify(newWorldDocument())); await writeFile(options.dungeonPath, '[]');
  await writeFile(actorPath, JSON.stringify(ACTOR_CATALOG));
  const studio = await startWorldStudio(options);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await page.locator('#open-npc-editor').click(); await expect(page.locator('#boss-status')).toHaveText('Catalogo caricato.');
    await expect(page.locator('#boss-select option')).toHaveCount(10);
    await expect(page.locator('#boss-hp')).toBeHidden();
    await page.locator('#boss-select').selectOption('platos');
    await expect(page.locator('#boss-status')).toHaveText('Catalogo caricato.');
    await page.locator('#boss-select').selectOption('old-fisher');
    await page.locator('#boss-animation').selectOption('idle');
    await page.locator('#boss-direction').selectOption('2');
    await expect(page.locator('#boss-frame')).toContainText('Frame 9 / 16');
    await page.waitForTimeout(250); await expect(page.locator('#boss-frame')).toContainText('Frame 9 / 16');
    await page.locator('#boss-select').selectOption('dock-skeptic');
    await page.locator('#boss-drawSize').fill('64');
    await page.locator('#boss-file').setInputFiles({ name: 'npc-editor-import-test.png', mimeType: 'image/png', buffer: await readFile(join(root, 'assets/npc-old-fisher.png')) });
    await expect(page.locator('#boss-asset')).toHaveValue('/actor-assets/npc-editor-import-test.png');
    await page.locator('#boss-new-animation').selectOption('idle'); await page.locator('#boss-add-animation').click();
    await page.locator('#boss-loop').check(); await expect(page.locator('#boss-animation option:checked')).toHaveText('idle · fermo');
    await page.locator('#boss-save').click(); await expect(page.locator('#boss-status')).toContainText('Catalogo salvato con backup');
    const saved = JSON.parse(await readFile(actorPath, 'utf8'));
    assert.deepEqual(saved.bosses, ACTOR_CATALOG.bosses);
    assert.equal(saved.npcSkins.platos, ACTOR_CATALOG.npcSkins?.platos, 'browsing an NPC preserves its existing assignment');
    assert.equal(saved.skins[saved.npcSkins['dock-skeptic']].drawSize, 64);
    assert.equal(saved.skins[saved.npcSkins['dock-skeptic']].animations.idle.loop, true);
    const imageResponse = await page.request.get(new URL(saved.skins[saved.npcSkins['dock-skeptic']].animations.moving.asset, studio.url).href);
    assert.equal(imageResponse.status(), 200); assert.match(imageResponse.headers()['content-type'], /image\/png/);
    await page.locator('#boss-idle-fallback').click(); await expect(page.locator('#boss-frame')).toContainText('Frame 9 / 16');
    await page.locator('#boss-save').click(); await expect(page.locator('#boss-status')).toContainText('Catalogo salvato con backup');
    assert.equal(JSON.parse(await readFile(actorPath, 'utf8')).skins['npc-dock-skeptic'].animations.idle, undefined);
    const runtime = await page.evaluate(async () => {
      const { CatalogSpriteRenderer } = await import('/client/render/catalog-sprite-renderer.ts' as string);
      const sprites = new CatalogSpriteRenderer(); await sprites.prepare();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d')!; ctx.translate(64, 64);
      const actor = { npcKind: 'dock-skeptic', hp: 1 };
      const frames = [];
      for (const [elapsed, moving] of [[0, false], [300, false], [130, true]]) {
        ctx.clearRect(-64, -64, 128, 128); const drawn = sprites.drawNpc(ctx, actor, elapsed, moving, 2);
        frames.push({ drawn, pixels: canvas.toDataURL() });
      }
      const [idle, laterIdle, moving] = frames;
      return { size: sprites.visual(actor)?.drawSize, idleDrawn: idle.drawn, still: idle.pixels === laterIdle.pixels, animated: idle.pixels !== moving.pixels };
    });
    assert.deepEqual(runtime, { size: 64, idleDrawn: true, still: true, animated: true });
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('#boss-close')).toBeInViewport();
    assert.ok(await page.locator('#boss-editor').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await mkdir(join(root, '.tmp'), { recursive: true });
    await page.screenshot({ path: join(root, '.tmp/npc-editor-landscape.png') });
    await page.locator('#boss-close').click();
    await page.locator('#open-boss-editor').click(); await expect(page.locator('#boss-hp')).toBeVisible();
    await expect(page.locator('#boss-idle-fallback')).toBeHidden();
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await studio.close(); if (!existed) await rm(importedPath, { force: true }); }
});
