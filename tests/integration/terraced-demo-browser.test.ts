import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { parseWorldDocument } from '../../shared/world-schema';

test('the playable terraced scene climbs its inset stairs and consecutive shelves with the game renderer', { timeout: 60_000 }, async () => {
  const installed = readFileSync('shared/custom-world.json', 'utf8');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 980 } }), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls!.local[0]}surface-lab.html?scene=terraced`);
    await expect(page.locator('#lab-scene')).toHaveValue('terraced');
    await expect(page.locator('#lab-support')).toContainText('Quota 0');
    const walkToTop = async (key: string) => {
      await page.locator('#lab-canvas').click(); await page.keyboard.down(key);
      try {
        await page.waitForFunction(() => {
          const canvas = document.querySelector<HTMLCanvasElement>('#lab-canvas')!;
          return canvas.dataset.elevation === '3' && canvas.dataset.surfaceId === 'ground';
        }, undefined, { polling: 'raf', timeout: 8000 });
      } finally { await page.keyboard.up(key); }
    };
    mkdirSync('artifacts', { recursive: true });
    await page.locator('#lab-canvas').click(); await page.keyboard.down('d');
    try {
      await page.waitForFunction(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('#lab-canvas')!;
        return canvas.dataset.elevation === '2' && canvas.dataset.surfaceId?.startsWith('stair:');
      }, undefined, { polling: 'raf', timeout: 8000 });
    } finally { await page.keyboard.up('d'); }
    await page.screenshot({ path: 'artifacts/terraced-in-game-stairs.png' });
    await walkToTop('d'); await page.screenshot({ path: 'artifacts/terraced-in-game-summit.png' });
    await page.locator('#lab-under').click(); await expect(page.locator('#lab-support')).toContainText('Quota 0');
    await walkToTop('d'); await page.screenshot({ path: 'artifacts/terraced-in-game-shelves.png' });
    await page.locator('#lab-above').click(); await expect(page.locator('#lab-support')).toContainText('Quota 0');
    await walkToTop('w');
    const downloading = page.waitForEvent('download'); await page.locator('#lab-download').click(); const download = await downloading;
    const exported = parseWorldDocument(readFileSync((await download.path())!, 'utf8'));
    assert.equal(download.suggestedFilename(), 'riftlands-rialzi-scale-incassate.json');
    assert.equal(exported.surfaceStairs?.length, 7);
    assert.ok(exported.surfaceStairs?.every(stair => stair.profile === 'terraced'));
    assert.deepEqual(errors, []); assert.equal(readFileSync('shared/custom-world.json', 'utf8'), installed);
    await page.locator('#lab-zoom').selectOption('.72');
    await page.screenshot({ path: 'artifacts/terraced-north-perspective.png' });
  } finally { await browser?.close(); await server.close(); }
});

test('walking into the visible mouth from its upper edge aligns ascent and descent', { timeout: 45_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 985, height: 652 } }), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls!.local[0]}surface-lab.html?scene=terraced`);
    await expect(page.locator('#lab-support')).toContainText('Quota 0');
    await page.locator('#lab-canvas').click();
    // Reproduce the user's lower approach: body partly overlaps the entrance,
    // while the logical centre is on row 12 beside the stair on row 13.
    await page.keyboard.down('w');
    try {
      await page.waitForFunction(() => document.querySelector('#lab-support')!.textContent!.includes('(3, 12)'),
        undefined, { polling: 'raf', timeout: 4000 });
    }
    finally { await page.keyboard.up('w'); }
    await page.keyboard.down('d');
    try {
      await page.waitForFunction(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('#lab-canvas')!;
        return canvas.dataset.surfaceId === 'ground' && canvas.dataset.elevation === '3';
      }, undefined, { polling: 'raf', timeout: 8000 });
    } finally { await page.keyboard.up('d'); }
    await expect(page.locator('#lab-support')).toContainText('(7, 13)');
    await page.keyboard.down('d');
    try {
      await page.waitForFunction(() => document.querySelector('#lab-support')!.textContent!.includes('(8, 13)'),
        undefined, { polling: 'raf', timeout: 4000 });
    }
    finally { await page.keyboard.up('d'); }
    // Cross the summit slightly above its eastern access, like the descent comment.
    await page.keyboard.down('w');
    try {
      await page.waitForFunction(() => document.querySelector('#lab-support')!.textContent!.includes('(8, 12)'),
        undefined, { polling: 'raf', timeout: 4000 });
    }
    finally { await page.keyboard.up('w'); }
    await page.keyboard.down('d');
    try {
      await page.waitForFunction(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('#lab-canvas')!;
        return canvas.dataset.surfaceId === 'ground' && canvas.dataset.elevation === '0';
      }, undefined, { polling: 'raf', timeout: 10000 });
    } finally { await page.keyboard.up('d'); }
    await expect(page.locator('#lab-support')).toContainText('(17, 13)');
    assert.deepEqual(errors, []);
    mkdirSync('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/terraced-stair-access-fixed.png' });
  } finally { await browser?.close(); await server.close(); }
});
