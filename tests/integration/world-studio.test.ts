import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldDocument } from '../../shared/world-schema';
import { acquireDataLease } from '../../server/data-lease';
import { World } from '../../shared/world';

test('offline world editor imports images, edits per-cell behavior, paints areas, manages zones and persists into the runtime format', { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'riftlands-world-studio-')), root = resolve('.');
  const options = { root: directory, port: 0, documentPath: join(directory, 'world.json'), dungeonPath: join(directory, 'dungeons.json'), dataPath: join(directory, 'accounts.json') };
  const document = newWorldDocument();
  for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) document.tiles.push({ x, y, terrain: 'grass' });
  await Promise.all([cp(join(root, 'client'), join(directory, 'client'), { recursive: true }), cp(join(root, 'shared'), join(directory, 'shared'), { recursive: true }),
    cp(join(root, 'world-maker.html'), join(directory, 'world-maker.html')), mkdir(join(directory, 'public/world-assets'), { recursive: true }),
    writeFile(options.documentPath, JSON.stringify(document)), writeFile(options.dungeonPath, '[]')]);
  const studio = await startWorldStudio(options);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1640, height: 1100 } }), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    const box = (await page.locator('#map').boundingBox())!;
    const point = (x: number, y: number) => ({ x: box.x + box.width / 2 + (x + .5) * 24, y: box.y + box.height / 2 + (y + .5) * 24 });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 48"><rect width="96" height="48" fill="#819a55"/></svg>';
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0tQAAAAASUVORK5CYII=', 'base64');
    await page.locator('#asset-files').setInputFiles([{ name: 'Albero.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) }, { name: 'Pietra.png', mimeType: 'image/png', buffer: png }]);
    await expect(page.locator('#asset-list button')).toHaveCount(2);
    await page.locator('#asset-list button').first().click();
    await page.locator('#keep-ratio').uncheck(); await page.locator('#asset-width').fill('2'); await page.locator('#asset-height').fill('2'); await page.locator('#asset-update').click();
    await page.locator('#cell-blocked').selectOption('true'); await page.locator('#cell-visibility').selectOption('normal');
    const grid = (await page.locator('#asset-grid').boundingBox())!, cell = Math.min((grid.width - 28) / 2, (grid.height - 28) / 2);
    const left = grid.x + (grid.width - 2 * cell) / 2, top = grid.y + (grid.height - 2 * cell) / 2;
    await page.mouse.click(left + cell / 2, top + cell / 2);
    await page.locator('#cell-blocked').selectOption('false'); await page.locator('#cell-visibility').selectOption('hide'); await page.mouse.click(left + cell * 1.5, top + cell / 2);
    await page.locator('#cell-visibility').selectOption('fade'); await page.mouse.click(left + cell / 2, top + cell * 1.5);
    await page.locator('#goto').click(); await page.locator('#goto-x').fill('100'); await page.locator('#goto-y').fill('100'); await page.locator('#goto-confirm').click();
    const at = (x: number, y: number) => point(x - 100, y - 100);
    await page.locator('[data-tool="terrain"]').click(); await page.locator('#terrain').selectOption('grass'); await page.locator('#brush-radius').fill('6');
    await page.mouse.click(at(100, 100).x, at(100, 100).y);
    await page.locator('#asset-list button').first().click(); await page.mouse.click(at(100, 100).x, at(100, 100).y);
    await page.locator('#brush-radius').fill('3'); await page.keyboard.down('Control'); await page.mouse.move(at(105, 100).x, at(105, 100).y); await page.mouse.down(); await page.mouse.move(at(110, 100).x, at(110, 100).y, { steps: 1 }); await page.mouse.up(); await page.keyboard.up('Control');
    await page.locator('[data-tool="zone"]').click(); await page.locator('#zone-template').selectOption('population');
    await page.mouse.move(at(96, 96).x, at(96, 96).y); await page.mouse.down(); await page.mouse.move(at(112, 105).x, at(112, 105).y); await page.mouse.up();
    await expect(page.locator('#zone-inspector')).toBeVisible(); await page.locator('#zone-name').fill('Nessuno spawn delegato'); await page.locator('#zone-density').fill('0'); await page.locator('#zone-update').click();
    await page.locator('[data-tool="npc"]').click(); await page.locator('#npc').selectOption('wisp'); await page.mouse.click(at(98, 98).x, at(98, 98).y);
    await page.locator('#undo').click(); await page.locator('#redo').click();
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('Progetto applicato con backup');
    const saved = JSON.parse(await readFile(options.documentPath, 'utf8'));
    assert.equal(saved.assets.length, 2); assert.equal(saved.assets[0].width, 2); assert.equal(saved.assets[0].cells[0].blocked, true);
    assert.equal(saved.assets[0].cells[1].visibility, 'hide'); assert.equal(saved.assets[0].cells[2].visibility, 'fade');
    assert.ok(saved.placements.length > 3); assert.equal(saved.zones[0].npcs.density, 0); assert.equal(saved.npcs.length, 1);
    const world = new World(saved.seed, 16, 'world', saved, []); assert.equal(world.isBlocked(100, 100), true); assert.equal(world.isHiding(101 * 48 + 24, 100 * 48 + 24), true);
    const download = page.waitForEvent('download'); await page.locator('#export-world').click();
    const archivePath = join(directory, 'exported.project.json'); await (await download).saveAs(archivePath);
    const archive = JSON.parse(await readFile(archivePath, 'utf8')); assert.equal(Object.keys(archive.images).length, 2);
    await page.locator('#world-file').setInputFiles(archivePath); await expect(page.locator('#status')).toContainText('Progetto importato');
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('Progetto applicato');
    await page.reload(); await expect(page.locator('#asset-list button')).toHaveCount(2);
    await page.locator('#show-zones').check(); await page.locator('#home').click(); await page.locator('#zoom-out').click(); await expect(page.locator('#zoom-label')).toHaveText('77%');
    await page.locator('#goto').click(); await page.locator('#goto-x').fill('100'); await page.locator('#goto-y').fill('100'); await page.locator('#goto-confirm').click();
    await mkdir(join(root, 'artifacts'), { recursive: true }); await page.screenshot({ path: join(root, 'artifacts/world-maker-review.png') });
    const endpoint = new URL('/__world/project', studio.url), origin = endpoint.origin, state = await (await fetch(endpoint)).json() as { token: string; revision: string };
    const write = (headers: Record<string, string>, revision = state.revision) => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ document: saved, revision }) });
    assert.equal((await write({ Origin: origin })).status, 403); assert.equal((await write({ Origin: 'https://external.example', 'X-World-Token': state.token })).status, 403);
    assert.equal((await write({ Origin: origin, 'X-World-Token': state.token }, 'stale')).status, 400);
    const release = acquireDataLease(options.dataPath);
    try { assert.equal((await write({ Origin: origin, 'X-World-Token': state.token })).status, 400); } finally { release(); }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await studio.close(); await rm(directory, { recursive: true, force: true }); }
});
