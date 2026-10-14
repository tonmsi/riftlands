import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { parseWorldDocument } from '../../shared/world-schema';

test('the separate surface lab walks over and under, keeps a downloadable example, and leaves the project unchanged', { timeout: 60_000 }, async () => {
  const before = readFileSync('shared/custom-world.json', 'utf8');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 980 } }), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls!.local[0]}surface-lab.html`);
    await expect(page.locator('#lab-support')).toContainText('Quota 0');
    await page.locator('#lab-canvas').click(); await page.keyboard.down('d');
    await page.waitForFunction(() => document.querySelector<HTMLCanvasElement>('#lab-canvas')!.dataset.surfaceId === 'bridge-demo');
    await page.keyboard.up('d'); await expect(page.locator('#lab-support')).toContainText('Quota 2');
    await page.locator('#lab-under').click(); await page.keyboard.down('w');
    await page.waitForFunction(() => document.querySelector('#lab-support')!.textContent!.includes('(10, 7)'), { polling: 'raf', timeout: 6000 }); await page.keyboard.up('w');
    await expect(page.locator('#lab-canvas')).toHaveAttribute('data-elevation', '0');
    mkdirSync('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/surface-lab-under.png' });
    await page.locator('#lab-above').click(); await expect(page.locator('#lab-canvas')).toHaveAttribute('data-elevation', '2');
    await page.screenshot({ path: 'artifacts/surface-lab-above.png' });
    await page.keyboard.down('d'); await expect(page.locator('#lab-support')).toContainText('Quota 0', { timeout: 6000 }); await page.keyboard.up('d');
    const download = page.waitForEvent('download'); await page.locator('#lab-download').click(); const file = await download;
    const example = parseWorldDocument(readFileSync((await file.path())!, 'utf8'));
    assert.ok(example.surfaceCells!.some(c => c.kind === 'bridge')); assert.equal(example.surfaceLinks!.length, 4);
    assert.deepEqual(errors, []); assert.equal(readFileSync('shared/custom-world.json', 'utf8'), before);
  } finally { await browser?.close(); await server.close(); }
});
