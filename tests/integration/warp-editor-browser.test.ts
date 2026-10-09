import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldDocument } from '../../shared/world-schema';
import { INSTALLED_DUNGEON_DEFINITIONS } from '../../shared/dungeons';
import { WORLD_DOCUMENT } from '../../shared/world-content';
import customDungeons from '../../shared/custom-dungeons.json';
import { newInterior, setWarpReturn } from '../../shared/warps';

test('World Maker authors a separate interior, paints its own terrain and saves linked entrance/exit', { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'riftlands-warp-editor-'));
  const options = { root: resolve('.'), documentPath: join(dir, 'world.json'), dungeonPath: join(dir, 'dungeons.json'), dataPath: join(dir, 'accounts.json'), port: 0 };
  await writeFile(options.documentPath, JSON.stringify(newWorldDocument())); await writeFile(options.dungeonPath, '[]');
  const studio = await startWorldStudio(options); let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await expect(page.locator('#interior-name')).toBeHidden(); await page.locator('#maps-passages > summary').click();
    await page.locator('#interior-name').fill('Locanda del viandante'); await page.locator('#interior-pvp').selectOption('true'); await page.locator('#interior-create').click();
    await expect(page.locator('#surface-map option:checked')).toHaveText('Locanda del viandante');
    const mapId = await page.locator('#surface-map').inputValue();
    const tile = async (x: number, y: number, originX: number, originY: number) => {
      const box = (await page.locator('#map').boundingBox())!;
      await page.mouse.click(box.x + box.width / 2 + (x + .5 - originX) * 24, box.y + box.height / 2 + (y + .5 - originY) * 24);
    };
    await page.locator('[data-tool="terrain"]').click(); await page.locator('#terrain').selectOption('water'); await page.locator('#brush-radius').fill('0');
    await tile(14, 9, 12, 9); await page.locator('[data-tool="select"]').click();
    await page.locator('#surface-map').selectOption('world'); await page.locator('#home').click();
    await page.locator('#warp-tool').click(); await tile(0, 2, 0, 0);
    await expect(page.locator('#warp-inspector')).toBeVisible();
    await page.locator('#warp-name').fill('Ingresso locanda'); await page.locator('#warp-arrival-x').fill('12'); await page.locator('#warp-arrival-y').fill('9');
    await page.locator('#warp-update').click(); await page.locator('#warp-return').click();
    await expect(page.locator('#surface-map')).toHaveValue(mapId);
    await expect(page.locator('#warp-list')).toContainText('Ritorno');
    await page.locator('#warp-return').click(); await expect(page.locator('#surface-map')).toHaveValue('world'); await page.locator('#warp-move').click();
    // The return arrives on the outside door; editing it also moves that door.
    await tile(0, 5, .5, 2.5);
    await page.locator('#validate').click(); await expect(page.locator('#status')).toContainText('Progetto valido');
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('applicato');
    const project = await page.evaluate(async () => (await (await fetch('/__world/project')).json()).document);
    assert.equal(project.interiors.length, 1); assert.equal(project.interiors[0].name, 'Locanda del viandante');
    assert.equal(project.interiors[0].pvp, true);
    assert.equal(project.warps.length, 2); assert.deepEqual(project.warps.find((w: any) => w.from === mapId).arrival, { x: 0, y: 5 });
    assert.deepEqual(project.warps.find((w: any) => w.from === 'world').entry, { x: 0, y: 5 });
    assert.ok(project.warps.every((w: any) => w.reverseId));
    assert.ok(project.interiors[0].document.tileChunks.length > 0); assert.equal(project.tileChunks.length, 0);
    await page.reload(); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await expect(page.locator('#interior-name')).toBeHidden(); await page.locator('#maps-passages > summary').click();
    await expect(page.locator('#surface-map option')).toHaveCount(2);
    await page.locator('#surface-map').selectOption(mapId); await expect(page.locator('#warp-list')).toContainText('Ritorno');
    await expect(page.locator('#interior-pvp')).toHaveValue('true');
    await page.locator('#interior-pvp').selectOption('false'); await page.locator('#interior-update').click();
    await page.locator('#warp-list button').click();
    await expect(page.locator('#warp-one-way')).not.toBeChecked();
    // Canvas selection and moving either endpoint work after loading the saved project.
    await tile(11, 10, 12.5, 9.5); await expect(page.locator('#warp-inspector')).toBeHidden();
    await tile(12, 9, 12.5, 9.5); await expect(page.locator('#warp-inspector')).toBeVisible();
    await page.locator('#warp-move').click(); await tile(10, 8, 12.5, 9.5);
    await expect(page.locator('#warp-x')).toHaveValue('10'); await expect(page.locator('#warp-y')).toHaveValue('8');
    await page.locator('#warp-one-way').check(); await expect(page.locator('#warp-one-way')).toBeChecked();
    await page.locator('#warp-one-way').uncheck();
    await page.locator('#validate').click(); await expect(page.locator('#status')).toContainText('Progetto valido');
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('applicato');
    const updated = await page.evaluate(async () => (await (await fetch('/__world/project')).json()).document);
    assert.equal(updated.warps.length, 2);
    assert.equal(updated.interiors[0].pvp, false);
    assert.deepEqual(updated.warps.find((w: any) => w.from === 'world').arrival, { x: 10, y: 8 });
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await studio.close(); await rm(dir, { recursive: true, force: true }); }
});

test('World Maker creates a dungeon map with encounters, PvP and the same bidirectional passage controls', { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'riftlands-dungeon-interior-'));
  const project = newWorldDocument(); project.assets = structuredClone(WORLD_DOCUMENT.assets);
  await writeFile(join(dir, 'world.json'), JSON.stringify(project));
  await writeFile(join(dir, 'dungeons.json'), JSON.stringify([customDungeons[0]]));
  const studio = await startWorldStudio({ root: resolve('.'), documentPath: join(dir, 'world.json'), dungeonPath: join(dir, 'dungeons.json'), dataPath: join(dir, 'accounts.json'), port: 0 });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true }); const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await page.locator('#maps-passages > summary').click(); await page.locator('#interior-pvp').selectOption('true');
    await page.locator('#interior-from-dungeon').click(); await expect(page.locator('#interior-kind')).toHaveValue('dungeon');
    await expect(page.locator('#interior-pvp')).toHaveValue('true'); const mapId = await page.locator('#surface-map').inputValue();
    await page.locator('#surface-map').selectOption('world'); await page.locator('#home').click(); await page.locator('#warp-tool').click();
    const box = (await page.locator('#map').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2 + 12, box.y + box.height / 2 + 60);
    await expect(page.locator('#warp-inspector')).toBeVisible(); await expect(page.locator('#warp-to')).toHaveValue(mapId);
    await page.locator('#validate').click(); await expect(page.locator('#status')).toContainText('Progetto valido');
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('applicato');
    const saved = await page.evaluate(async () => (await (await fetch('/__world/project')).json()).document);
    assert.equal(saved.interiors[0].kind, 'dungeon'); assert.equal(saved.interiors[0].pvp, true);
    assert.equal(saved.interiors[0].document.dungeons[0].dungeonId, INSTALLED_DUNGEON_DEFINITIONS[0].id);
    assert.equal(saved.warps.length, 2); assert.deepEqual(saved.warps[0].arrival, { x: 1, y: 1 });
  } finally { await browser?.close(); await studio.close(); await rm(dir, { recursive: true, force: true }); }
});

test('warp fade waits for arrival and the interaction button fits desktop and mobile', { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'riftlands-warp-ui-'));
  await writeFile(join(dir, 'world.json'), JSON.stringify(newWorldDocument())); await writeFile(join(dir, 'dungeons.json'), '[]');
  const studio = await startWorldStudio({ root: resolve('.'), documentPath: join(dir, 'world.json'), dungeonPath: join(dir, 'dungeons.json'), dataPath: join(dir, 'accounts.json'), port: 0 });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const [width, height, touch] of [[1440, 900, false], [844, 390, true]] as const) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
      const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript('window.__name = value => value'); await page.clock.install();
      await page.goto(studio.url);
      await page.evaluate(async () => {
        const { WarpUI } = await import('/client/ui/warp-ui.ts' as string);
        const ui = new WarpUI((id: string) => { (window as any).clickedWarp = id; });
        const warp = { id: 'door', name: 'Entra nella locanda', from: 'world', to: 'house', entry: { x: 0, y: 0 }, arrival: { x: 4, y: 4 }, activation: 'interact' };
        ui.update({} as any, { x: 24, y: 24, hp: 100 } as any, [warp], 'world', true);
        (window as any).warpReview = ui;
      });
      await expect(page.locator('.warp-enter')).toBeVisible(); await page.locator('.warp-enter').click();
      assert.equal(await page.evaluate(() => (window as any).clickedWarp), 'door');
      const box = (await page.locator('.warp-enter').boundingBox())!; assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= height);
      await page.evaluate(() => (window as any).warpReview.start()); await page.clock.runFor(350);
      await expect(page.locator('.warp-veil')).toHaveClass('warp-veil visible');
      assert.equal(await page.evaluate(() => (window as any).warpReview.blocked), true);
      await page.clock.runFor(1000); await expect(page.locator('.warp-veil')).toHaveClass('warp-veil visible');
      await page.evaluate(() => (window as any).warpReview.arrive()); await page.clock.runFor(400);
      assert.equal(await page.evaluate(() => (window as any).warpReview.blocked), false);
      await expect(page.locator('.warp-veil')).toHaveClass('warp-veil');
      await page.evaluate(() => { (window as any).warpReview.start(); (window as any).warpReview.cancel(); });
      assert.equal(await page.evaluate(() => (window as any).warpReview.blocked), false);
      assert.deepEqual(errors, []); await page.close();
    }
  } finally { await browser?.close(); await studio.close(); await rm(dir, { recursive: true, force: true }); }
});

test('opening another side shows the selected destination terrain and moving affects only the visible side', { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'riftlands-warp-navigation-'));
  const project = newWorldDocument();
  project.interiors = [newInterior('empty', 'Interno vuoto'), newInterior('painted', 'Primo piano arredato')];
  project.interiors[1].document.tiles = [{ x: 14, y: 9, terrain: 'water', suppressAssets: true }];
  project.warps = [{ id: 'door', name: 'Scala', from: 'world', to: 'empty', entry: { x: 0, y: 2 }, arrival: { x: 12, y: 9 }, activation: 'walk' }];
  setWarpReturn(project, project.warps[0], true, 'back');
  await writeFile(join(dir, 'world.json'), JSON.stringify(project)); await writeFile(join(dir, 'dungeons.json'), '[]');
  const studio = await startWorldStudio({ root: resolve('.'), documentPath: join(dir, 'world.json'), dungeonPath: join(dir, 'dungeons.json'), dataPath: join(dir, 'accounts.json'), port: 0 });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true }); const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await page.locator('#maps-passages > summary').click(); await page.locator('#warp-list button').click();
    // Choose a different destination, without needing a separate Update before navigating.
    await page.locator('#warp-to').selectOption('painted'); await page.locator('#warp-return').click();
    await expect(page.locator('#surface-map')).toHaveValue('painted'); await expect(page.locator('#warp-current-side')).toContainText('Primo piano arredato');
    await expect.poll(() => page.locator('#map').evaluate((canvas: HTMLCanvasElement) => {
      const r = canvas.getBoundingClientRect(), scale = canvas.width / r.width;
      return Array.from(canvas.getContext('2d')!.getImageData(Math.round((r.width / 2 + 48) * scale), Math.round(r.height / 2 * scale), 1, 1).data);
    })).toEqual([80, 125, 145, 255]);
    await page.locator('#warp-move').click();
    const box = (await page.locator('#map').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2 - 48, box.y + box.height / 2 - 24);
    await expect(page.locator('#warp-x')).toHaveValue('10'); await expect(page.locator('#warp-y')).toHaveValue('8');
    await page.locator('#warp-one-way').check(); await page.locator('#warp-return').click();
    await expect(page.locator('#surface-map')).toHaveValue('world'); await expect(page.locator('#warp-one-way')).toBeChecked();
    await page.locator('#warp-return').click(); await expect(page.locator('#surface-map')).toHaveValue('painted');
    await expect(page.locator('#warp-one-way')).toBeChecked(); await expect(page.locator('#warp-x')).toHaveValue('10');
  } finally { await browser?.close(); await studio.close(); await rm(dir, { recursive: true, force: true }); }
});
