import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldDocument, newWorldAsset, parseWorldDocument } from '../../shared/world-schema';

test('cell controls show saved behavior, distinguish pending edits and preserve mixed cells', { timeout: 90_000 }, async () => {
  const fixture = newWorldDocument(42);
  const bush = newWorldAsset('bush', 'Cespuglio', '/world-assets/test-cell.svg');
  bush.cells[0].visibility = 'hide-fade';
  const normal = newWorldAsset('normal-bush', 'Cespuglio normale', bush.image);
  const mixed = newWorldAsset('mixed', 'Misto', bush.image);
  mixed.width = mixed.columns = 2;
  mixed.cells = [{ blocked: false, visibility: 'hide' }, { blocked: true, visibility: 'normal' }];
  fixture.assets.push(bush, normal, mixed);
  const directory = await mkdtemp(join(tmpdir(), 'riftlands-cell-controls-'));
  await writeFile(join(directory, 'world.json'), JSON.stringify(fixture));
  await writeFile(join(directory, 'dungeons.json'), '[]');
  const studio = await startWorldStudio({ root: resolve('.'), documentPath: join(directory, 'world.json'), dungeonPath: join(directory, 'dungeons.json'), dataPath: join(directory, 'accounts.json'), port: 0 });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/world-assets/test-cell.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="green"/></svg>' }));
    await page.goto(studio.url);
    await expect(page.locator('#status')).toContainText('World Studio pronto');
    const selectAsset = async (id: string) => {
      await page.locator('#asset-catalog-expand').click();
      await page.locator(`#asset-list [data-asset="${id}"]`).click();
    };
    const exported = async () => {
      const downloading = page.waitForEvent('download');
      await page.locator('#export-world').click();
      await (await downloading).saveAs(join(directory, 'export.json'));
      return parseWorldDocument(JSON.parse(await readFile(join(directory, 'export.json'), 'utf8')).document);
    };
    await selectAsset('bush');
    await expect(page.locator('#cell-blocked')).toHaveValue('false');
    await expect(page.locator('#cell-visibility')).toHaveValue('hide-fade');
    await expect(page.locator('#asset-cell-state')).toContainText('1 cella Calpestabile · Nascondiglio + trasparenza');
    await selectAsset('normal-bush');
    await expect(page.locator('#cell-visibility')).toHaveValue('normal');
    await page.locator('#cell-visibility').selectOption('hide-fade');
    await expect(page.locator('#asset-cell-pending')).toBeVisible();
    await expect(page.locator('#asset-cell-state')).toContainText('Calpestabile · Normale');
    assert.equal((await exported()).assets.find(a => a.id === 'normal-bush')!.cells[0].visibility, 'normal');
    await page.locator('#fill-cells').click();
    await expect(page.locator('#asset-cell-pending')).toBeHidden();
    await expect(page.locator('#asset-cell-state')).toContainText('Nascondiglio + trasparenza');
    await page.locator('#undo').click();
    await expect(page.locator('#cell-visibility')).toHaveValue('normal');
    await page.locator('#redo').click();
    await expect(page.locator('#cell-visibility')).toHaveValue('hide-fade');
    await selectAsset('mixed');
    await expect(page.locator('#cell-blocked')).toHaveValue('');
    await expect(page.locator('#cell-visibility')).toHaveValue('');
    await expect(page.locator('#asset-cell-state')).toContainText('1 cella Bloccante · Normale');
    await page.locator('#cell-visibility').selectOption('hide-fade');
    await page.locator('#fill-cells').click();
    const saved = (await exported()).assets.find(a => a.id === 'mixed')!;
    assert.deepEqual(saved.cells, [{ blocked: false, visibility: 'hide-fade' }, { blocked: true, visibility: 'hide-fade' }]);
    await page.locator('#undo').click();
    await expect(page.locator('#cell-visibility')).toHaveValue('');
    await page.locator('#cell-visibility').selectOption('fade');
    await page.locator('#asset-grid').scrollIntoViewIfNeeded();
    const grid = (await page.locator('#asset-grid').boundingBox())!;
    const step = Math.min((grid.width - 28) / 2, grid.height - 28);
    await page.mouse.click(grid.x + grid.width / 2 - step / 2, grid.y + grid.height / 2);
    await expect(page.locator('#asset-cell-state')).toContainText('Calpestabile · Trasparente al passaggio');
    await expect(page.locator('#cell-visibility')).toHaveValue('fade');
    await page.mouse.click(grid.x + grid.width / 2 + step / 2, grid.y + grid.height / 2);
    assert.deepEqual((await exported()).assets.find(a => a.id === 'mixed')!.cells,
      [{ blocked: false, visibility: 'fade' }, { blocked: true, visibility: 'fade' }]);
    await selectAsset('bush');
    await expect(page.locator('#cell-visibility')).toHaveValue('hide-fade');
    await expect(page.locator('#asset-cell-state')).toBeVisible();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await studio.close();
    await rm(directory, { recursive: true, force: true });
  }
});
