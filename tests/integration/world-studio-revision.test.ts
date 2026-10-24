import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldDocument, newWorldAsset } from '../../shared/world-schema';
import { WORLD_DOCUMENT } from '../../shared/world-content';

for (const staleRevision of [false, true]) test(staleRevision ? 'Studio recovers a stale publication revision without overwriting real external edits' : 'Studio can apply successive edits from the same page and resume its saved revision', { timeout: 60_000 }, async () => {
  const root = resolve('.'); await mkdir(join(root, '.tmp'), { recursive: true });
  const directory = await mkdtemp(join(root, '.tmp', 'studio-revision-'));
  const options = { root, port: 0, documentPath: join(directory, 'world.json'), dungeonPath: join(directory, 'dungeons.json'), dataPath: join(directory, 'accounts.json') };
  const document = newWorldDocument();
  document.assets = [newWorldAsset('probe', 'Probe', WORLD_DOCUMENT.assets[0].image)];
  for (let y = -5; y <= 10; y++) for (let x = -5; x <= 10; x++) document.tiles.push({ x, y, terrain: 'grass' });
  await writeFile(options.documentPath, JSON.stringify(document)); await writeFile(options.dungeonPath, '[]');
  const studio = await startWorldStudio(options);
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1640, height: 1100 } });
    const errors: string[] = [], posts: { revision: string; response?: any }[] = [];
    let firstPublication = true;
    if (staleRevision) await page.route('**/__world/project', async route => {
      if (route.request().method() !== 'POST' || !firstPublication) { await route.continue(); return; }
      firstPublication = false;
      const response = await route.fetch(), result = await response.json();
      // The file is saved successfully, but the editor receives an outdated revision.
      result.revision = route.request().postDataJSON().revision;
      await route.fulfill({ response, json: result });
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', async response => {
      if (response.url().endsWith('/__world/project') && response.request().method() === 'POST') posts.push({ revision: response.request().postDataJSON().revision, response: await response.json() });
    });
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await page.locator('#asset-list button').first().click();
    for (const name of ['Prima modifica', 'Seconda modifica', 'Terza modifica']) {
      await page.locator('#asset-name').fill(name); await page.locator('#asset-update').click();
      await page.locator('#apply-world').click();
      await expect(page.locator('#status')).toContainText('Progetto salvato con backup');
      assert.equal(JSON.parse(await readFile(options.documentPath, 'utf8')).assets[0].name, name, JSON.stringify(posts));
    }
    await page.reload(); await expect(page.locator('#save-state')).toHaveText('Applicato al progetto');
    await page.locator('#asset-list button').first().click();
    await page.locator('#asset-name').fill('Quarta modifica'); await page.locator('#asset-update').click();
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('Progetto salvato con backup');
    const other = JSON.parse(await readFile(options.documentPath, 'utf8')); other.assets[0].name = 'Altra finestra';
    await writeFile(options.documentPath, JSON.stringify(other));
    await page.locator('#asset-name').fill('Modifica locale'); await page.locator('#asset-update').click();
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('Il progetto è stato modificato da un’altra finestra');
    assert.equal(JSON.parse(await readFile(options.documentPath, 'utf8')).assets[0].name, 'Altra finestra');
    await page.reload();
    await page.locator('#asset-list button').first().click();
    await expect(page.locator('#asset-name')).toHaveValue('Altra finestra');
    await expect(page.locator('#recover-world-draft')).toBeVisible();
    await page.locator('#recover-world-draft').click();
    await expect(page.locator('#asset-name')).toHaveValue('Modifica locale');
    assert.equal(JSON.parse(await readFile(options.documentPath, 'utf8')).assets[0].name, 'Altra finestra', 'recovering a draft must not publish it');
    await expect(page.locator('#recover-world-draft')).toBeHidden();
    await page.locator('#asset-name').fill('Modifica dopo ricarica'); await page.locator('#asset-update').click();
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('Progetto salvato con backup');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await studio.close(); await rm(directory, { recursive: true, force: true }); }
});
