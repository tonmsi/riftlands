import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { startDungeonStudio } from '../../scripts/dungeon-studio-server';
import { studioDraft } from '../fixtures/studio-draft';

test('maker plays locally with game controls, no game socket, bonuses and clickable map diagnostics', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'riftlands-playtest-'));
  const catalogPath = join(directory, 'catalog.json'); await writeFile(catalogPath, '[]');
  const studio = await startDungeonStudio({ root: resolve('.'), port: 0, catalogPath, dataPath: join(directory, 'accounts.json') });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors: string[] = [], sockets: string[] = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('websocket', socket => sockets.push(socket.url()));
    const draft = studioDraft(); draft.tiles[3 * draft.width] = 'grass';
    draft.entities.push({ id: 'trigger', kind: 'activation', template: '', label: 'Attivazione', x: 2, y: 3, level: 1, radius: 15 });
    await page.addInitScript(d => localStorage.setItem('riftlands.dungeon-draft.v2', JSON.stringify(d)), draft);
    await page.goto(studio.url); await expect(page.locator('#issues')).toHaveText('Terreno e posizioni validi.');
    const box = (await page.locator('#map').boundingBox())!;
    const scale = Math.max(4, Math.min(46, (box.width - 60) / 24, (box.height - 60) / 18));
    const tile = (x: number, y: number) => ({ x: box.x + (box.width - 24 * scale) / 2 + (x + .5) * scale, y: box.y + (box.height - 18 * scale) / 2 + (y + .5) * scale });
    for (const [i, kind] of ['heal', 'haste', 'power', 'weakness'].entries()) {
      await page.locator(`[data-tool="pickup:${kind}"]`).click(); const p = tile(7 + i, 5); await page.mouse.click(p.x, p.y);
    }
    await expect(page.locator('#issues')).toHaveText('Terreno e posizioni validi.');
    const saved = await page.evaluate(() => localStorage.getItem('riftlands.dungeon-draft.v2'));
    assert.equal(JSON.parse(saved!).entities.filter((e: any) => e.kind === 'pickup').length, 4);
    await page.locator('#preview-class').selectOption('mage'); await page.locator('#preview').click();
    await expect(page.locator('#playtest-dialog')).toBeVisible();
    await expect(page.locator('#playtest-status')).toContainText('Entra');
    await expect(page.locator('#playtest-status')).toContainText('mana');
    await page.keyboard.down('d');
    await expect(page.locator('#playtest-status')).toContainText('ingressi chiusi', { timeout: 5000 });
    await page.keyboard.up('d');
    await page.keyboard.press('Space');
    await mkdir(resolve('.tmp'), { recursive: true });
    await page.screenshot({ path: resolve('.tmp/dungeon-playtest.png') });
    await page.locator('#playtest-restart').click();
    await expect(page.locator('#playtest-status')).toContainText('Entra');
    await page.keyboard.press('Escape'); await expect(page.locator('#playtest-dialog')).not.toBeVisible();
    assert.equal(await page.evaluate(() => localStorage.getItem('riftlands.dungeon-draft.v2')), saved);
    await page.locator('[data-tool="flame"]').click(); const border = tile(0, 3); await page.mouse.click(border.x, border.y);
    await expect(page.locator('#status')).toContainText('massi');
    await page.locator('[data-tool="tile:rock"]').click(); const bonus = tile(7, 5); await page.mouse.click(bonus.x, bonus.y);
    await page.locator('#issues button').filter({ hasText: 'Cura +35 HP: ingombro' }).click();
    await expect(page.locator('#issue-detail')).toContainText('(7, 5)');
    await expect(page.locator('#entity-label')).toHaveValue('Cura +35 HP');
    assert.deepEqual(errors, []);
    assert.ok(sockets.every(url => !new URL(url).pathname.startsWith('/ws')), 'playtest must not connect to the game server');
  } finally { await browser?.close(); await studio.close(); await rm(directory, { recursive: true, force: true }); }
});
