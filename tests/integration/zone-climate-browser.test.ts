import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldDocument, parseWorldDocument } from '../../shared/world-schema';
import { World } from '../../shared/world';
import { TILE_SIZE } from '../../shared/config';

test('optional climate transitions can be created, edited, undone and saved from World Maker', { timeout: 90_000 }, async () => {
  const fixture = newWorldDocument(42);
  fixture.zones.push({ id: 'existing', name: 'Clima esistente', priority: 1, shape: { kind: 'circle', x: 0, y: 0, radius: 12 }, temperature: .2, moisture: .8 });
  for (let y = -20; y < 20; y++) for (let x = -20; x < 20; x++) fixture.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  const directory = await mkdtemp(join(tmpdir(), 'riftlands-zone-climate-'));
  const documentPath = join(directory, 'world.json');
  await writeFile(documentPath, JSON.stringify(fixture)); await writeFile(join(directory, 'dungeons.json'), '[]');
  const studio = await startWorldStudio({ root: resolve('.'), documentPath, dungeonPath: join(directory, 'dungeons.json'), dataPath: join(directory, 'accounts.json'), port: 0 });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript('window.__name = value => value');
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    const selectExisting = async () => {
      if (!(await page.locator('#project-settings').evaluate((d: HTMLDetailsElement) => d.open))) await page.locator('#project-settings > summary').click();
      await page.locator('#zone-list button').filter({ hasText: 'Clima esistente' }).click();
    };
    const exported = async () => {
      const download = page.waitForEvent('download'); await page.locator('#export-world').click();
      await (await download).saveAs(join(directory, 'export.json'));
      return parseWorldDocument(JSON.parse(await readFile(join(directory, 'export.json'), 'utf8')).document);
    };
    await expect(page.locator('#zone-create-climate-transition')).not.toBeChecked();
    await selectExisting();
    await expect(page.locator('#zone-climate-transition')).not.toBeChecked();
    await expect(page.locator('#zone-climate-settings-toggle')).toBeVisible();
    await expect(page.locator('#zone-climate-settings-toggle')).toBeDisabled();
    await expect(page.locator('#zone-climate-depth-label')).toBeHidden();
    await page.locator('#zone-climate-transition').check();
    await expect(page.locator('#zone-climate-depth')).toBeVisible();
    await page.locator('#zone-climate-settings-toggle').click();
    await expect(page.locator('#zone-climate-settings')).toBeVisible();
    await page.locator('#zone-climate-curve-temperature').focus(); await page.keyboard.press('End');
    await page.locator('#zone-climate-curve-moisture').focus(); await page.keyboard.press('Home');
    await expect(page.locator('#zone-climate-curve-temperature')).toHaveValue('12');
    await expect(page.locator('#zone-climate-curve-moisture')).toHaveValue('0.25');
    await expect(page.locator('#zone-climate-curve-samples')).toContainText('96.8%');
    await page.locator('#zone-climate-depth').fill('50');
    // A refresh must keep an unapplied climate checkbox and depth together.
    await page.locator('[data-tool="zone"]').click();
    await expect(page.locator('#zone-climate-transition')).toBeChecked();
    await expect(page.locator('#zone-climate-depth')).toHaveValue('50');
    await expect(page.locator('#zone-climate-curve-temperature')).toHaveValue('12');
    await expect(page.locator('#zone-climate-curve-moisture')).toHaveValue('0.25');
    await page.locator('#zone-update').click();
    assert.equal((await exported()).zones.find(z => z.id === 'existing')!.climateTransition, .5);
    assert.deepEqual((await exported()).zones.find(z => z.id === 'existing')!.climateCurves, { temperature: 12, moisture: .25 });
    await page.locator('#undo').click(); await selectExisting();
    await expect(page.locator('#zone-climate-transition')).not.toBeChecked();
    await expect(page.locator('#zone-climate-settings')).toBeHidden();
    await page.locator('#redo').click(); await selectExisting();
    await expect(page.locator('#zone-climate-transition')).toBeChecked();
    await expect(page.locator('#zone-climate-depth')).toHaveValue('50');
    await page.locator('#zone-climate-settings-toggle').click();
    await expect(page.locator('#zone-climate-curve-temperature')).toHaveValue('12');
    await expect(page.locator('#zone-climate-curve-moisture')).toHaveValue('0.25');
    await page.locator('#zone-climate-curves-reset').click();
    await expect(page.locator('#zone-climate-curve-temperature')).toHaveValue('3');
    await expect(page.locator('#zone-climate-curve-moisture')).toHaveValue('3');
    await page.locator('#zone-update').click();
    assert.equal((await exported()).zones.find(z => z.id === 'existing')!.climateCurves, undefined);
    await page.locator('#zone-climate-curve-temperature').focus(); await page.keyboard.press('End');
    await page.locator('#zone-climate-curve-moisture').focus(); await page.keyboard.press('Home');
    await page.locator('#zone-update').click();
    await page.locator('#zone-climate-transition').uncheck(); await page.locator('#zone-update').click();
    assert.equal((await exported()).zones.find(z => z.id === 'existing')!.climateTransition, undefined);
    await page.locator('#zone-climate-transition').check(); await page.locator('#zone-climate-depth').fill('50');
    await page.locator('#zone-update').click();

    const createZone = async (offset: number) => {
      await page.locator('[data-tool="zone"]').click();
      const map = (await page.locator('#map').boundingBox())!;
      const x = map.x + map.width / 2 + offset, y = map.y + map.height / 2 + 110;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 72, y + 48, { steps: 4 }); await page.mouse.up();
    };
    await page.locator('#zone-create-climate-transition').check(); await createZone(100);
    await expect(page.locator('#zone-climate-transition')).toBeChecked();
    await expect(page.locator('#zone-climate-depth')).toHaveValue('100');
    await page.locator('#zone-name').fill('Zona graduale'); await page.locator('#zone-temperature').fill('0.1');
    await page.locator('#zone-moisture').fill('0.9'); await page.locator('#zone-update').click();
    await page.locator('#zone-create-climate-transition').uncheck(); await createZone(-190);
    await expect(page.locator('#zone-climate-transition')).not.toBeChecked();
    await page.locator('#zone-name').fill('Zona uniforme'); await page.locator('#zone-update').click();
    const before = await exported();
    assert.equal(before.zones.length, 3);
    assert.equal(before.zones.find(z => z.name === 'Zona graduale')!.climateTransition, 1);
    assert.equal(before.zones.find(z => z.name === 'Zona uniforme')!.climateTransition, undefined);
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('Progetto salvato con backup');
    const installed = parseWorldDocument(JSON.parse(await readFile(documentPath, 'utf8')));
    assert.deepEqual(installed.zones, before.zones);
    const world = new World(42, 16, 'world', installed, []);
    assert.equal(world.getMoisture(0, 0), .8);
    const baselineDoc = structuredClone(installed); baselineDoc.zones = [];
    const baseline = new World(42, 16, 'world', baselineDoc, []);
    const edge = world.getMoisture(12 * TILE_SIZE, 0), surrounding = baseline.getMoisture(12 * TILE_SIZE, 0);
    assert.ok(Math.abs(edge - surrounding) < 1e-10);
    await page.reload(); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await selectExisting(); await expect(page.locator('#zone-climate-transition')).toBeChecked();
    await expect(page.locator('#zone-climate-depth')).toHaveValue('50');
    await page.locator('#zone-climate-settings-toggle').click();
    await expect(page.locator('#zone-climate-curve-temperature')).toHaveValue('12');
    await expect(page.locator('#zone-climate-curve-moisture')).toHaveValue('0.25');
    const snow = await page.evaluate(async () => {
      const { EnvironmentArt } = await import('/client/render/environment-art.ts' as string);
      const { climateSnowCoverage } = await import('/client/render/terrain-style.ts' as string);
      const { TerrainRenderer } = await import('/client/render/terrain-renderer.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const { defaultWorldPainting } = await import('/shared/world-painting.ts' as string);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 480;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!, art = new EnvironmentArt();
      const alpha = (temperature: number) => {
        ctx.clearRect(0, 0, 480, 480);
        for (let i = 0; i < 100; i++) art.drawSnowFringe(ctx, i % 10 * 48, Math.floor(i / 10) * 48, i / 101, climateSnowCoverage(temperature));
        const data = ctx.getImageData(0, 0, 480, 480).data;
        let sum = 0; for (let i = 3; i < data.length; i += 4) sum += data[i];
        return sum;
      };
      const samples = [.38, .36, .34, .32, .30, .28, .20, .10].map(alpha);
      const jumps = [.30, .34].map(t => Math.abs(alpha(t - 1e-6) - alpha(t + 1e-6)));
      const original = EnvironmentArt.prototype.drawSnowFringe, modes: number[][] = [];
      try {
        for (const mode of ['masks', 'legacy', 'disabled']) {
          const values: number[] = []; modes.push(values);
          EnvironmentArt.prototype.drawSnowFringe = function (...args: any[]) { values.push(args[4]); return original.apply(this, args); };
          const doc = newWorldDocument(42);
          doc.painting = { ...defaultWorldPainting(), edges: mode === 'legacy' ? 'legacy' : 'masks', masksEnabled: mode !== 'disabled' };
          doc.zones.push({ id: 'climate', name: 'Clima', priority: 1, shape: { kind: 'rect', x: -50, y: -50, width: 100, height: 100 }, temperature: .3 });
          for (let y = -20; y < 20; y++) for (let x = -20; x < 20; x++) doc.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
          const renderer = new TerrainRenderer(ctx);
          try { renderer.drawTerrain(new World(42, 16, 'world', doc, []), 0, ctx, { left: 0, top: 0, right: 192, bottom: 192 }); }
          finally { renderer.dispose(); }
        }
      } finally { EnvironmentArt.prototype.drawSnowFringe = original; }
      return { samples, jumps, modes };
    });
    assert.equal(snow.samples[0], 0);
    assert.ok(snow.samples.every((value, i) => i === 0 || value > snow.samples[i - 1]), JSON.stringify(snow.samples));
    assert.ok(snow.jumps.every(jump => jump < snow.samples.at(-1)! * .001), JSON.stringify(snow.jumps));
    for (const mode of snow.modes) {
      assert.ok(mode.length > 0);
      assert.ok(mode.every(coverage => Math.abs(coverage - (.38 - .3) / .28) < 1e-10));
    }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await studio.close(); await rm(directory, { recursive: true, force: true }); }
});
