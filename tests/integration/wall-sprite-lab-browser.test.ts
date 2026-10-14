import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { parseWorldDocument } from '../../shared/world-schema';

test('the real PNG kit previews and exports in the lab without changing the installed map', { timeout: 45_000 }, async () => {
  const before = readFileSync('shared/custom-world.json', 'utf8');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1280 } }), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls!.local[0]}surface-lab.html?scene=reference&wallSkin=wall-roccia`);
    await expect(page.locator('#lab-wall-skin')).toHaveValue('wall-roccia');
    await expect(page.locator('#lab-support')).toContainText('Quota 0', { timeout: 20_000 });
    mkdirSync('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/wall-roccia-png-preview.png' });
    const download = async () => {
      const pending = page.waitForEvent('download'); await page.locator('#lab-download').click();
      return parseWorldDocument(readFileSync((await (await pending).path())!, 'utf8'));
    };
    const custom = await download();
    assert.ok(custom.surfaceCells!.some(c => c.wallSkin === 'wall-roccia'));
    assert.ok(custom.surfaceCells!.filter(c => c.kind === 'bridge').every(c => c.wallSkin === undefined));
    await page.locator('#lab-wall-skin').selectOption('');
    const plain = await download(); assert.ok(plain.surfaceCells!.every(c => c.wallSkin === undefined));
    assert.deepEqual(custom.surfaceStairs, plain.surfaceStairs);
    assert.deepEqual(custom.surfaceLinks, plain.surfaceLinks);
    assert.deepEqual(custom.surfaceCells!.map(({ wallSkin, ...cell }) => cell), plain.surfaceCells);
    assert.deepEqual(errors, []); assert.equal(readFileSync('shared/custom-world.json', 'utf8'), before);
  } finally { await browser?.close(); await server.close(); }
});
