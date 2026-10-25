import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { ACTOR_CATALOG } from '../../shared/actor-catalog';
import { newWorldDocument } from '../../shared/world-schema';

test('World Maker duplicates NPCs with independent sprites, names and groups and restores placed variants', { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'riftlands-npc-variants-'));
  const options = { root: resolve('.'), documentPath: join(dir, 'world.json'), dungeonPath: join(dir, 'dungeons.json'), dataPath: join(dir, 'accounts.json'), port: 0 };
  const actorPath = join(dir, 'actor-catalog.json');
  await writeFile(options.documentPath, JSON.stringify(newWorldDocument())); await writeFile(options.dungeonPath, '[]');
  await writeFile(actorPath, JSON.stringify(ACTOR_CATALOG));
  const studio = await startWorldStudio(options);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let imported: string | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await page.locator('#open-npc-editor').click(); await expect(page.locator('#boss-status')).toHaveText('Catalogo caricato.');
    await page.locator('#boss-select').selectOption('dock-skeptic');
    page.once('dialog', d => d.accept('inn-keeper')); await page.locator('#boss-duplicate').click();
    await expect(page.locator('#boss-select')).toHaveValue('variant:inn-keeper');
    await expect(page.locator('#boss-npc-identity')).toContainText('Brugo');
    await page.locator('#boss-name').fill('Locandiere'); await page.locator('#boss-npc-group').fill('Abitanti');
    await page.locator('#boss-drawSize').fill('72');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#e69955"/></svg>';
    await page.locator('#boss-file').setInputFiles({ name: 'codex-npc-variant-test.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
    await expect(page.locator('#boss-asset')).toHaveValue('/actor-assets/codex-npc-variant-test.svg');
    imported = await page.locator('#boss-asset').inputValue();
    await page.locator('#boss-save').click(); await expect(page.locator('#boss-status')).toContainText('Catalogo salvato con backup');
    const catalog = JSON.parse(await readFile(actorPath, 'utf8')), v = catalog.npcVariants.find((v: any) => v.id === 'inn-keeper');
    assert.equal(v.base, 'dock-skeptic'); assert.equal(v.group, 'Abitanti'); assert.equal(v.name, 'Locandiere');
    assert.equal(catalog.skins[v.skin].drawSize, 72); assert.equal(catalog.skins[v.skin].animations.moving.asset, imported);
    assert.deepEqual(catalog.bosses, ACTOR_CATALOG.bosses);
    assert.deepEqual(catalog.skins[catalog.npcSkins['dock-skeptic']], ACTOR_CATALOG.skins[ACTOR_CATALOG.npcSkins!['dock-skeptic']!]);
    // Copies of variants still inherit the original AI, with a fresh skin.
    page.once('dialog', d => d.accept('inn-assistant')); await page.locator('#boss-duplicate').click();
    await page.locator('#boss-name').fill('Aiutante'); await page.locator('#boss-drawSize').fill('60');
    await page.locator('#boss-save').click(); await expect(page.locator('#boss-status')).toContainText('Catalogo salvato con backup');
    await page.locator('#boss-close').click();
    await page.locator('#npc').selectOption('variant:inn-keeper'); await page.locator('[data-tool="npc"]').click();
    await page.locator('#map').click({ position: { x: 220, y: 230 } });
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('Progetto salvato con backup');
    let saved = JSON.parse(await readFile(options.documentPath, 'utf8'));
    assert.equal(saved.npcs[0].npcKind, 'dock-skeptic'); assert.equal(saved.npcs[0].settings.variantId, 'inn-keeper');
    await page.reload(); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await expect(page.locator('#npc option[value="variant:inn-keeper"]')).toContainText('Abitanti');
    await page.locator('#world-explorer > summary').click();
    await page.locator('#explorer-search').fill('Locandiere'); await page.locator('.explorer-item').click();
    await expect(page.locator('#selected-npc-kind')).toHaveValue('variant:inn-keeper');
    await expect(page.locator('#selected-npc-name')).toHaveValue('Locandiere');
    await page.locator('#selected-npc-name').fill('Marco'); await page.locator('#selection-update').click();
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('Progetto salvato con backup');
    saved = JSON.parse(await readFile(options.documentPath, 'utf8')); assert.equal(saved.npcs[0].settings.name, 'Marco');
    const visual = await page.evaluate(async () => {
      const { CatalogSpriteRenderer } = await import('/client/render/catalog-sprite-renderer.ts' as string);
      const sprites = new CatalogSpriteRenderer(); await sprites.prepare();
      return { variant: sprites.visual({ npcKind: 'dock-skeptic', npcVariantId: 'inn-keeper' } as any)?.drawSize,
        assistant: sprites.visual({ npcKind: 'dock-skeptic', npcVariantId: 'inn-assistant' } as any)?.drawSize,
        original: sprites.visual({ npcKind: 'dock-skeptic' } as any)?.drawSize };
    });
    assert.equal(visual.variant, 72); assert.equal(visual.assistant, 60); assert.notEqual(visual.original, 72);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await studio.close();
    if (imported === '/actor-assets/codex-npc-variant-test.svg') await rm(resolve(options.root, 'public', imported.slice(1)), { force: true });
    await rm(dir, { recursive: true, force: true });
  }
});
