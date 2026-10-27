import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { ACTOR_CATALOG } from '../../shared/actor-catalog';
import { newWorldDocument } from '../../shared/world-schema';

test('NPC laboratory saves, reloads and duplicates idle-only NPCs and renders idle sheets with no movement animation', { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'riftlands-idle-only-'));
  const options = { root: resolve('.'), documentPath: join(dir, 'world.json'), dungeonPath: join(dir, 'dungeons.json'), dataPath: join(dir, 'accounts.json'), port: 0 };
  const actorPath = join(dir, 'actor-catalog.json');
  await writeFile(options.documentPath, JSON.stringify(newWorldDocument())); await writeFile(options.dungeonPath, '[]');
  await writeFile(actorPath, JSON.stringify(ACTOR_CATALOG));
  const studio = await startWorldStudio(options);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let imported: string | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await page.locator('#open-npc-editor').click(); await expect(page.locator('#boss-status')).toHaveText('Catalogo caricato.');
    await page.locator('#boss-select').selectOption('old-fisher');
    page.once('dialog', d => d.accept('idle-only-editor-test')); await page.locator('#boss-duplicate').click();
    await page.locator('[data-select-slot=idle]').click();
    await expect(page.locator('[data-slot-asset=idle]')).toHaveValue('');
    await expect(page.locator('#boss-animation')).toHaveValue('idle');
    await expect(page.locator('#boss-sheet-settings')).toBeHidden();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="16"><path fill="red" d="M0 0h16v16H0z"/><path fill="blue" d="M16 0h16v16H16z"/><path fill="green" d="M32 0h16v16H32z"/><path fill="orange" d="M48 0h16v16H48z"/></svg>';
    await page.locator('#boss-file').setInputFiles({ name: 'codex-idle-only-editor-test.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
    await expect(page.locator('[data-slot-asset=idle]')).toHaveValue('/actor-assets/codex-idle-only-editor-test.svg'); imported = await page.locator('[data-slot-asset=idle]').inputValue();
    await page.locator('[data-slot-asset=moving]').selectOption('');
    await page.locator('[data-select-slot=idle]').click();
    await page.locator('#boss-directional').uncheck(); await page.locator('#boss-rows').fill('1'); await page.locator('#boss-rows').dispatchEvent('change');
    await page.locator('#boss-loop').locator('xpath=ancestor::details').locator('summary').click(); await page.locator('#boss-columns').fill('4'); await page.locator('#boss-columns').dispatchEvent('change'); await page.locator('#boss-loop').check();
    await page.locator('#boss-save').click(); await expect(page.locator('#boss-status')).toContainText('Catalogo salvato con backup');
    let catalog = JSON.parse(await readFile(actorPath, 'utf8'));
    const skin = catalog.npcVariants.find((v: any) => v.id === 'idle-only-editor-test').skin;
    assert.equal(catalog.skins[skin].animations.moving, undefined); assert.equal(catalog.skins[skin].animations.idle.rows, 1);
    assert.deepEqual(catalog.skins['npc-old-fisher'], ACTOR_CATALOG.skins['npc-old-fisher']);
    await page.locator('#boss-reload').click(); await expect(page.locator('#boss-status')).toHaveText('Catalogo caricato.');
    await page.locator('#boss-select').selectOption('variant:idle-only-editor-test');
    await expect(page.locator('[data-slot-asset=idle]')).toHaveValue(imported!);
    // Movement can be added again, and removing it preserves the dedicated idle.
    await page.locator('[data-slot-asset=moving]').selectOption('/actor-assets/npc-old-fisher.png');
    await expect(page.locator('#boss-animation-rule')).toContainText('Da fermo: Idle'); await page.locator('[data-slot-asset=moving]').selectOption('');
    page.once('dialog', d => d.accept('idle-only-editor-copy')); await page.locator('#boss-duplicate').click();
    await page.locator('#boss-save').click(); await expect(page.locator('#boss-status')).toContainText('Catalogo salvato con backup');
    catalog = JSON.parse(await readFile(actorPath, 'utf8'));
    const copySkin = catalog.npcVariants.find((v: any) => v.id === 'idle-only-editor-copy').skin;
    assert.equal(catalog.skins[copySkin].animations.moving, undefined); assert.equal(catalog.skins[copySkin].animations.idle.asset, imported);
    const frames = await page.evaluate(async () => {
      const { CatalogSpriteRenderer } = await import('/client/render/catalog-sprite-renderer.ts' as string);
      const sprites = new CatalogSpriteRenderer(); await sprites.prepare();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d')!; ctx.translate(64, 64);
      const actor = { npcKind: 'old-fisher', npcVariantId: 'idle-only-editor-test', hp: 1 } as any;
      const samples = [[0, false], [130, false], [130, true]].map(([elapsed, moving]) => {
        ctx.clearRect(-64, -64, 128, 128);
        return { drawn: sprites.drawNpc(ctx, actor, elapsed as number, moving as boolean, 2), pixels: canvas.toDataURL() };
      });
      return { drawn: samples.every(s => s.drawn), animated: samples[0].pixels !== samples[1].pixels, fallback: samples[1].pixels === samples[2].pixels };
    });
    assert.deepEqual(frames, { drawn: true, animated: true, fallback: true }); assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await studio.close();
    if (imported === '/actor-assets/codex-idle-only-editor-test.svg') await rm(resolve(options.root, 'public', imported.slice(1)), { force: true });
    await rm(dir, { recursive: true, force: true });
  }
});
