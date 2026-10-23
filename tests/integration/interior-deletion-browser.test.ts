import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldDocument, parseWorldDocument } from '../../shared/world-schema';
import { newDungeonInterior, newInterior, setWarpReturn } from '../../shared/warps';
import { worldDungeons } from '../../shared/world-validation';
import { engineBundle } from '../fixtures/dungeon-engine';

test('Maps deletes a complete interior and its passages through apply, undo and reload', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'riftlands-interior-delete-'));
  const options = { root: resolve('.'), port: 0, documentPath: join(directory, 'world.json'), dungeonPath: join(directory, 'dungeons.json'), dataPath: join(directory, 'accounts.json') };
  const project = newWorldDocument(), bundle = engineBundle();
  const house = newInterior('house', 'Casa da eliminare', 8, 8), keep = newInterior('keep', 'Locanda', 8, 8);
  for (const map of [project, house.document, keep.document]) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) map.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  house.document.npcs = [{ id: 'npc', npcKind: 'wisp', level: 1, x: 1, y: 1 }];
  project.interiors = [house, keep, newDungeonInterior('crypt', bundle.definition)];
  project.warps = [
    { id: 'door', name: 'Casa', from: 'world', to: 'house', entry: { x: 2, y: 2 }, arrival: { x: 1, y: 1 }, activation: 'walk' },
    { id: 'cross', name: 'Dalla locanda', from: 'keep', to: 'house', entry: { x: 2, y: 2 }, arrival: { x: 1, y: 1 }, activation: 'walk' },
    { id: 'keep-door', name: 'Locanda', from: 'world', to: 'keep', entry: { x: 5, y: 5 }, arrival: { x: 1, y: 1 }, activation: 'walk' },
  ];
  setWarpReturn(project, project.warps[0], true, 'exit');
  await writeFile(options.documentPath, JSON.stringify(project)); await writeFile(options.dungeonPath, JSON.stringify([bundle]));
  const studio = await startWorldStudio(options);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await expect(page.locator('#map-delete')).toBeDisabled();
    await page.locator('#surface-map').selectOption('house');
    await expect(page.locator('#map-delete-hint')).toContainText('Casa da eliminare');
    page.once('dialog', dialog => dialog.dismiss()); await page.locator('#map-delete').click();
    await expect(page.locator('#surface-map')).toHaveValue('house');
    page.once('dialog', dialog => dialog.accept()); await page.locator('#map-delete').click();
    await expect(page.locator('#surface-map')).toHaveValue('world');
    await expect(page.locator('#surface-map option[value="house"]')).toHaveCount(0);
    await expect(page.locator('#warp-destination option[value="house"]')).toHaveCount(0);
    await expect(page.locator('#status')).toContainText('Applica al gioco');
    await page.locator('#undo').click();
    await expect(page.locator('#surface-map option[value="house"]')).toHaveCount(1);
    await page.locator('#surface-map').selectOption('house');
    page.once('dialog', dialog => dialog.accept()); await page.locator('#map-delete').click();
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('Progetto applicato');
    let saved = parseWorldDocument(await readFile(options.documentPath, 'utf8'));
    assert.deepEqual(saved.interiors?.map(m => m.id), ['keep', 'crypt']);
    assert.deepEqual(saved.warps?.map(w => w.id), ['keep-door']);
    await page.reload(); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await expect(page.locator('#surface-map option[value="house"]')).toHaveCount(0);
    await page.locator('#surface-map').selectOption('crypt');
    await page.locator('#maps-passages > summary').click();
    page.once('dialog', dialog => dialog.accept()); await page.locator('#interior-delete').click();
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('Progetto applicato');
    saved = parseWorldDocument(await readFile(options.documentPath, 'utf8'));
    assert.deepEqual(saved.interiors?.map(m => m.id), ['keep']);
    assert.deepEqual(worldDungeons(saved, [bundle.definition]), []);
    await expect(page.locator('#map-delete')).toBeDisabled();
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await studio.close(); await rm(directory, { recursive: true, force: true }); }
});
