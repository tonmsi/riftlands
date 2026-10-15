import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { newWorldAsset, newWorldDocument, resizeWorldAsset, type WorldDocument } from '../../shared/world-schema';
import { World } from '../../shared/world';
import { TILE_SIZE } from '../../shared/tile-size';

async function exportedDocument(page: Page): Promise<WorldDocument> {
  const waiting = page.waitForEvent('download'); await page.locator('#export-world').click();
  const stream = await (await waiting).createReadStream(); assert.ok(stream);
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')).document;
}

test('actual maker assigns PNG semantics, builds raised terrain and places walkable bushes and blocking stones on its summit', { timeout: 90_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const doc = newWorldDocument(); doc.surfaceCells = [];
  for (let y = -9; y <= 9; y++) for (let x = -9; x <= 9; x++) {
    doc.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
    doc.surfaceCells.push({ x, y, surfaceId: 'ground', elevation: 0, kind: 'ground', material: 'grass', wallMaterial: 'rock', blocked: false });
  }
  const blockedFloor = doc.surfaceCells.find(cell => cell.x === -3 && cell.y === 0)!; blockedFloor.blocked = true; blockedFloor.material = 'path';
  const blockedPlateau = doc.surfaceCells.find(cell => cell.x === -3 && cell.y === 3)!; blockedPlateau.blocked = true; blockedPlateau.elevation = 2; blockedPlateau.material = 'path';
  const floor = newWorldAsset('workflow-floor', 'PNG pavimento di prova', '/world-assets/montagna/roccia-tile.png');
  floor.layer = 'ground'; floor.cells[0] = { blocked: true, visibility: 'hide-fade' };
  const height = newWorldAsset('workflow-height', 'PNG rialzo di prova', '/world-assets/montagna/roccia-tile.png');
  resizeWorldAsset(height, 9, 8); height.layer = 'ground';
  doc.assets = [floor, height];
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1640, height: 1100 } }), errors: string[] = [];
    await page.addInitScript('window.__name = value => value'); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/__world/project', route => route.fulfill({ json: { token: 'test-fixture', revision: 'fixture-revision', document: doc, dungeons: [] } }));
    await page.route('**/__world/music', route => route.fulfill({ json: { files: [] } }));
    await page.goto(`${server.resolvedUrls!.local[0]}world-maker.html`);
    await expect(page.locator('#status')).toContainText('World Studio pronto');
    await expect(page.locator('button[data-build-mode="floor"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#object-controls')).toBeHidden();
    await expect(page.locator('#elevation-controls')).toBeHidden();
    const go = async () => {
      await page.locator('#goto').click(); await page.locator('#goto-x').fill('0'); await page.locator('#goto-y').fill('0'); await page.locator('#goto-confirm').click();
    };
    await go();
    const clickTile = async (x: number, y: number, elevation = 0) => {
      const box = (await page.locator('#map').boundingBox())!;
      const px = box.x + box.width / 2 + (x + .5) * 24, py = box.y + box.height / 2 + (y + .5 - elevation / 3) * 24;
      await page.mouse.move(px, py); await expect(page.locator('#coordinates')).toHaveText(`X ${x} · Y ${y} · livello ${elevation}`);
      await page.mouse.click(px, py);
    };
    await page.locator('#asset-category-filter').selectOption('all');
    await page.locator('#asset-list [data-asset="workflow-floor"]').click();
    await page.locator('#asset-category').selectOption('floor');
    await expect(page.locator('#cell-blocked')).toBeDisabled();
    await page.locator('#asset-update').click();
    let exported = await exportedDocument(page);
    const configuredFloor = exported.assets.find(asset => asset.id === floor.id)!;
    assert.equal(configuredFloor.category, 'floor'); assert.equal(configuredFloor.layer, 'ground');
    assert.deepEqual(configuredFloor.cells, [{ blocked: false, visibility: 'normal' }]);
    await clickTile(-3, 0);
    exported = await exportedDocument(page);
    assert.equal(exported.surfaceCells!.find(cell => cell.x === -3 && cell.y === 0)?.blocked, false);
    assert.ok(exported.placements.some(placement => placement.assetId === floor.id && placement.x === -3 && placement.y === 0));

    await page.locator('#asset-category-filter').selectOption('all');
    await page.locator('#asset-list [data-asset="workflow-height"]').click();
    await page.locator('#asset-category').selectOption('elevation');
    await expect(page.locator('#asset-elevation-settings')).toBeVisible();
    await page.locator('#asset-elevation-height').fill('3');
    await page.locator('#asset-elevation-material').selectOption('grass');
    await page.locator('#asset-elevation-wall').selectOption('rock');
    await page.locator('#asset-update').click();
    await clickTile(0, 2);
    exported = await exportedDocument(page);
    const configuredHeight = exported.assets.find(asset => asset.id === height.id)!;
    assert.equal(configuredHeight.category, 'elevation');
    assert.deepEqual(configuredHeight.elevation, { height: 3, material: 'grass', wallMaterial: 'rock' });
    const summit = exported.surfaceCells!.filter(cell => cell.x >= 0 && cell.x < 9 && cell.y >= 2 && cell.y < 10);
    assert.equal(summit.length, 72); assert.ok(summit.every(cell => cell.elevation === 3 && cell.layout === 'terraced' && !cell.blocked));
    assert.ok(exported.placements.some(placement => placement.assetId === height.id && placement.x === 0 && placement.y === 2 && placement.elevation === 3));
    const summitBeforeObjects = structuredClone(summit);

    await page.locator('button[data-build-mode="object"]').click();
    await page.locator('[data-terrain-object="rock"]').click();
    await expect(page.locator('#asset-name')).toHaveValue('Sasso · oggetto');
    await clickTile(3, 5, 3);
    await page.locator('[data-terrain-object="bush"]').click();
    await expect(page.locator('#asset-name')).toHaveValue('Cespuglio · oggetto');
    await clickTile(4, 5, 3);
    exported = await exportedDocument(page);
    assert.deepEqual(exported.surfaceCells!.filter(cell => cell.x >= 0 && cell.x < 9 && cell.y >= 2 && cell.y < 10), summitBeforeObjects);
    assert.ok(exported.placements.some(placement => placement.assetId === 'maker-rock' && placement.x === 3 && placement.y === 5 && placement.elevation === 3));
    assert.ok(exported.placements.some(placement => placement.assetId === 'maker-bush' && placement.x === 4 && placement.y === 5 && placement.elevation === 3));
    const world = new World(exported.seed, 16, 'world', exported, []);
    assert.equal(world.surfaceAt(3, 5)?.blocked, true); assert.equal(world.surfaceAt(4, 5)?.blocked, false);
    assert.equal(world.surfaceAt(0, 2)?.terrainRole, 'wall');
    assert.equal(world.isHiding(4.5 * TILE_SIZE, 5.5 * TILE_SIZE, { x: 4.5 * TILE_SIZE, y: 5.5 * TILE_SIZE, elevation: 3 }), true);

    await page.locator('#asset-category-filter').selectOption('floor');
    await page.locator('#asset-list [data-asset="workflow-floor"]').click(); await clickTile(5, 5, 3);
    await page.locator('button[data-build-mode="floor"]').click();
    await page.locator('#floor-controls [data-tool="terrain"]').click(); await page.locator('#terrain').selectOption('grass');
    await clickTile(-3, 3, 2);
    exported = await exportedDocument(page);
    const repaired = exported.surfaceCells!.find(cell => cell.x === -3 && cell.y === 3)!;
    assert.notEqual(repaired.blocked, true); assert.equal(repaired.material, 'grass'); assert.equal(repaired.elevation, 2);
    assert.equal(new World(exported.seed, 16, 'world', exported, []).surfaceAt(-3, 3)?.blocked, false);
    assert.equal(exported.surfaceCells!.find(cell => cell.x === 5 && cell.y === 5)?.elevation, 3);
    assert.ok(exported.placements.some(placement => placement.assetId === floor.id && placement.x === 5 && placement.y === 5 && placement.elevation === 3));
    await page.locator('#terrain').selectOption('stone'); await clickTile(-5, 0);
    exported = await exportedDocument(page);
    const stoneFloor = exported.surfaceCells!.find(cell => cell.x === -5 && cell.y === 0)!;
    assert.equal(stoneFloor.material, 'stone'); assert.equal(stoneFloor.elevation, 0); assert.notEqual(stoneFloor.blocked, true);
    assert.equal(new World(exported.seed, 16, 'world', exported, []).surfaceAt(-5, 0)?.blocked, false);
    assert.deepEqual(errors, []);
    await page.locator('#asset-category-filter').selectOption('all');
    await page.locator('#asset-list [data-asset="workflow-height"]').click();
    await page.locator('#zoom-in').click(); await page.locator('#zoom-in').click(); await page.locator('#zoom-in').click();
    await page.mouse.move(10, 10);
    const navigation = (await page.locator('.palette-navigation').boundingBox())!, tabs = (await page.locator('.build-mode-tabs').boundingBox())!;
    assert.ok(tabs.y >= navigation.y + navigation.height - 1, 'The construction tabs stay completely below the navigation while scrolling');
    await mkdir(resolve('artifacts'), { recursive: true }); await page.screenshot({ path: resolve('artifacts/world-maker-surface-workflow.png') });
  } finally { await browser?.close(); await server.close(); }
});
