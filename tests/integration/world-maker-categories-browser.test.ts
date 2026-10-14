import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

test('maker separates floors, objects and raised terrain while its catalog filter persists across reconstruction', { timeout: 45_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage(), errors: string[] = [];
    await page.addInitScript('window.__name = value => value'); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/maker-categories', route => route.fulfill({ contentType: 'text/html', body: '<main id="fixture"></main>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}maker-categories`);
    await page.evaluate(async () => {
      const { worldMakerLayout } = await import('/client/editors/world/world-maker-layout.ts' as string);
      const { organizeWorldPanels, setWorldBuildMode } = await import('/client/editors/world/world-panels.ts' as string);
      const { WorldAssetCatalog } = await import('/client/editors/world/world-asset-catalog.ts' as string);
      const { newWorldAsset } = await import('/shared/world-schema.ts' as string);
      const floor = newWorldAsset('floor-fixture', 'Sabbia piatta', '/world-assets/sand.svg'); floor.layer = 'ground';
      const object = newWorldAsset('object-fixture', 'Cespuglio', '/world-assets/bush.svg');
      const height = newWorldAsset('height-fixture', 'Parete di roccia', '/world-assets/wall.svg'); height.layer = 'ground'; height.cells[0].blocked = true;
      const assets = [floor, object, height];
      const mount = () => {
        const root = document.querySelector<HTMLElement>('#fixture')!; root.innerHTML = worldMakerLayout; organizeWorldPanels(root);
        const catalog = new WorldAssetCatalog(root.querySelector<HTMLElement>('#asset-list')!, () => {});
        root.querySelector('#asset-category-filter')!.addEventListener('change', event => catalog.setCategory((event.target as HTMLSelectElement).value));
        for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-build-mode]')) button.addEventListener('click', () => {
          const mode = button.dataset.buildMode as 'floor' | 'object' | 'elevation'; setWorldBuildMode(root, mode); catalog.setCategory(mode);
        });
        if (!localStorage.getItem('riftlands.asset-category')) catalog.setCategory('floor');
        catalog.update(assets, '', ''); (window as any).catalogFixture = { assets, catalog, mount };
      };
      mount();
    });
    await expect(page.locator('#floor-controls [data-tool="terrain"]')).toBeVisible();
    await expect(page.locator('#object-controls')).toBeHidden();
    await expect(page.locator('#elevation-controls')).toBeHidden();
    await expect(page.locator('#asset-catalog-controls [data-tool="asset"]')).toHaveText('♧Usa PNG selezionato');
    await expect(page.locator('#asset-list [data-asset]')).toHaveCount(1);
    await page.locator('button[data-build-mode="object"]').click();
    await expect(page.locator('#object-controls [data-tool="surface-link"]')).toBeVisible();
    await expect(page.locator('#object-controls [data-tool="bridge"]')).toBeVisible();
    await expect(page.locator('#object-controls [data-terrain-object="rock"]')).toHaveText('Pietra / sasso');
    await expect(page.locator('#structure-controls')).not.toHaveAttribute('open');
    await page.locator('#object-plane-controls > summary').click();
    await expect(page.locator('#object-controls #placement-surface')).toBeVisible();
    await page.locator('button[data-build-mode="elevation"]').click();
    await expect(page.locator('#elevation-controls [data-tool="raise-height"]')).toBeVisible();
    await expect(page.locator('#floor-controls')).toBeHidden();
    await expect(page.locator('#object-controls')).toBeHidden();
    await expect(page.locator('#elevation-advanced-controls')).not.toHaveAttribute('open');
    assert.equal(await page.locator('#elevation-controls [data-tool="bridge"], #elevation-controls [data-tool="surface-link"]').count(), 0);
    for (const id of ['terrain', 'asset-list', 'placement-surface', 'surface-link-kind', 'surface-stair-width', 'surface-elevation', 'asset-category'])
      assert.equal(await page.locator(`#${id}`).count(), 1, `The ${id} binding has one element after regrouping`);
    await page.locator('#asset-category-filter').selectOption('all');
    await expect(page.locator('#asset-list [data-asset]')).toHaveCount(3);
    await page.locator('#asset-category-filter').selectOption('floor');
    await expect(page.locator('#asset-list [data-asset]')).toHaveCount(1);
    await expect(page.locator('#asset-list [data-asset="floor-fixture"]')).toContainText('Pavimento');
    await page.evaluate(() => (window as any).catalogFixture.mount());
    await expect(page.locator('#asset-category-filter')).toHaveValue('floor');
    await expect(page.locator('#asset-list [data-asset]')).toHaveCount(1);
    await page.locator('#asset-category-filter').selectOption('elevation');
    await expect(page.locator('#asset-list [data-asset="height-fixture"]')).toContainText('Rialzo');
    await page.locator('#asset-category-filter').selectOption('object');
    await expect(page.locator('#asset-list [data-asset="object-fixture"]')).toContainText('Oggetto');
    await page.evaluate(() => {
      const { assets, catalog } = (window as any).catalogFixture;
      const asset = assets.find((value: { id: string }) => value.id === 'object-fixture'); asset.category = 'floor';
      catalog.reveal(asset); catalog.update(assets, asset.id, '');
    });
    await expect(page.locator('#asset-category-filter')).toHaveValue('floor');
    await expect(page.locator('#asset-list [data-asset="object-fixture"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('button[data-build-mode="floor"]').click();
    await page.locator('button[data-build-mode="floor"]').press('ArrowRight');
    await expect(page.locator('button[data-build-mode="object"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#floor-controls')).toBeHidden();
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
