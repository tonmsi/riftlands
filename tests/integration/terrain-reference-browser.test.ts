import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { parseWorldDocument } from '../../shared/world-schema';

test('the complete reference scene walks stairs, distinguishes bridge planes and exports its structures', { timeout: 90_000 }, async () => {
  const before = readFileSync('shared/custom-world.json', 'utf8');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1280 } }), errors: string[] = [];
    await page.addInitScript('window.__name = value => value'); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls!.local[0]}surface-lab.html?scene=reference`);
    await expect(page.locator('#lab-support')).toContainText('Quota 0');
    await expect(page.locator('#lab-scene')).toHaveValue('reference');
    await page.locator('#lab-canvas').click(); await page.keyboard.down('d');
    await page.waitForFunction(() => document.querySelector('#lab-canvas')!.getAttribute('data-surface-id')?.startsWith('stair:'), { timeout: 8000 });
    await expect(page.locator('#lab-canvas')).toHaveAttribute('data-surface-id', 'ground', { timeout: 8000 });
    await page.keyboard.up('d'); await expect(page.locator('#lab-canvas')).toHaveAttribute('data-elevation', '3');
    mkdirSync('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/terrain-reference-overview.png' });
    await page.locator('#lab-under').click(); await page.keyboard.down('w');
    await page.waitForFunction(() => { const match = document.querySelector('#lab-support')!.textContent!.match(/\(17,\s*(\d+)\)/);
      return match && Number(match[1]) <= 11 && Number(match[1]) >= 6; }, { polling: 'raf', timeout: 8000 });
    await page.keyboard.up('w');
    await expect(page.locator('#lab-canvas')).toHaveAttribute('data-elevation', '0');
    await page.screenshot({ path: 'artifacts/terrain-reference-under.png' });
    await page.locator('#lab-above').click(); await expect(page.locator('#lab-canvas')).toHaveAttribute('data-surface-id', 'reference-bridge');
    await expect(page.locator('#lab-canvas')).toHaveAttribute('data-elevation', '3');
    await page.locator('#lab-zoom').selectOption('1.35');
    await expect(page.locator('#lab-support')).toContainText('Ponte');
    await page.screenshot({ path: 'artifacts/terrain-reference-bridge-close.png' });
    const download = page.waitForEvent('download'); await page.locator('#lab-download').click(); const file = await download;
    assert.equal(file.suggestedFilename(), 'riftlands-terrazze-scale-ponte.json');
    const doc = parseWorldDocument(readFileSync((await file.path())!, 'utf8'));
    assert.equal(doc.surfaceStairs!.length, 6);
    assert.ok(doc.surfaceCells!.some(c => c.kind === 'stairs'));
    assert.ok(doc.surfaceCells!.some(c => c.kind === 'bridge'));
    await page.goto(`${server.resolvedUrls!.local[0]}dungeon-maker.html`);
    await page.locator('#example').selectOption('terrain-reference-demo');
    await expect(page.locator('#name')).toHaveValue('Prova · terrazze, scale e ponte');
    await expect(page.locator('#issues')).toHaveText('Terreno e posizioni validi.');
    await expect(page.locator('#dungeon-stair-width')).toHaveValue('48');
    await expect(page.locator('#dungeon-bridge-route')).toHaveValue('straight');
    assert.deepEqual(errors, []); assert.equal(readFileSync('shared/custom-world.json', 'utf8'), before);
  } finally { await browser?.close(); await server.close(); }
});

test('world authoring creates a whole staircase and preserves both banks when it is erased', { timeout: 40_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage(); await page.addInitScript('window.__name = value => value');
    await page.route('**/reference-authoring', route => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}reference-authoring`);
    const result = await page.evaluate(async () => {
      const { WorldElevationEditor, SurfaceStroke, elevationControls } = await import('/client/editors/world/elevation-editor.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const doc = newWorldDocument(); doc.surfaceCells = [];
      for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) doc.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
      for (let y = 4; y <= 6; y++) doc.surfaceCells.push({ x: 5, y, elevation: 3, surfaceId: 'ground', material: 'grass', wallMaterial: 'rock', kind: 'ground' });
      let world = new World(doc.seed, 16, 'world', doc, []), undo: typeof doc | undefined;
      const root = document.querySelector('main')!; root.innerHTML = elevationControls;
      const editor = new WorldElevationEditor(root, (action: () => void) => { undo = structuredClone(doc); action(); world = new World(doc.seed, 16, 'world', doc, []); }, () => doc, () => world, () => {});
      root.querySelector<HTMLSelectElement>('#surface-stair-width')!.value = '96';
      root.querySelector<HTMLSelectElement>('#surface-stair-profile')!.value = 'incline';
      editor.click({ x: 2, y: 5, surfaceId: 'ground' }); editor.click({ x: 5, y: 5, surfaceId: 'ground' });
      const built = { structures: doc.surfaceStairs?.length, supports: doc.surfaceCells.filter((c: { kind: string }) => c.kind === 'stairs').length, links: doc.surfaceLinks?.length, width: doc.surfaceStairs?.[0].width };
      const saved = structuredClone(doc);
      new SurfaceStroke(doc).paint({ x: 3, y: 5, surfaceId: `stair:${doc.surfaceStairs![0].id}` }, 'clear-link', { elevation: 0, material: 'grass', wallMaterial: 'rock', surfaceId: 'ground', blocked: false });
      return { built, remaining: doc.surfaceStairs?.length, supportsAfter: doc.surfaceCells?.filter((c: { kind: string }) => c.kind === 'stairs').length,
        bankHeight: doc.surfaceCells?.find((c: { x: number; y: number }) => c.x === 5 && c.y === 5)!.elevation, undoReady: !undo?.surfaceStairs?.length, saved: saved.surfaceStairs?.length };
    });
    assert.deepEqual(result.built, { structures: 1, supports: 6, links: 9, width: 96 });
    assert.equal(result.remaining, 0); assert.equal(result.supportsAfter, 0); assert.equal(result.bankHeight, 3);
    assert.equal(result.undoReady, true); assert.equal(result.saved, 1);
  } finally { await browser?.close(); await server.close(); }
});
