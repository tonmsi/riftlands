import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldDocument } from '../../shared/world-schema';

test('World Maker imports, assigns, exports and restores a music zone, serving byte ranges', { timeout: 40_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'riftlands-music-editor-'));
  const options = { root: resolve('.'), documentPath: join(directory, 'world.json'), dungeonPath: join(directory, 'dungeons.json'), dataPath: join(directory, 'accounts.json'), port: 0 };
  const project = newWorldDocument();
  project.zones = [{ id: 'music-zone', name: 'Musica locanda', priority: 1, shape: { kind: 'rect', x: 0, y: 0, width: 5, height: 5 } }];
  await writeFile(options.documentPath, JSON.stringify(project)); await writeFile(options.dungeonPath, '[]');
  const studio = await startWorldStudio(options);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, src: string | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await page.locator('#zone-list button').click();
    await page.locator('#zone-inspector details > summary').click();
    const wave = Buffer.alloc(48); wave.write('RIFF'); wave.write('WAVE', 8);
    await page.locator('#zone-music-file').setInputFiles({ name: 'codex-music-editor-review.wav', mimeType: 'audio/wav', buffer: wave });
    await expect(page.locator('#status')).toContainText('Traccia importata');
    src = await page.locator('#zone-music').inputValue();
    assert.match(src, /^\/music\/codex-music-editor-review-[a-f0-9]{16}\.wav$/);
    await page.locator('#zone-music-volume').fill('35'); await page.locator('#zone-update').click();
    const range = await page.request.get(new URL(src, studio.url).href, { headers: { Range: 'bytes=8-11' } });
    assert.equal(range.status(), 206); assert.equal((await range.body()).toString(), 'WAVE');
    assert.equal(range.headers()['content-range'], 'bytes 8-11/48');
    const bad = await page.request.get(new URL(src, studio.url).href, { headers: { Range: 'bytes=100-200' } }); assert.equal(bad.status(), 416);
    const downloadEvent = page.waitForEvent('download'); await page.locator('#export-world').click();
    const download = await downloadEvent; const packed = JSON.parse(await readFile((await download.path())!, 'utf8'));
    assert.equal(packed.document.zones[0].music.src, src); assert.equal(packed.document.zones[0].music.volume, .35);
    assert.equal(packed.music[src].split(',')[1], wave.toString('base64'));
    await page.locator('#world-file').setInputFiles({ name: 'world.project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(packed)) });
    await expect(page.locator('#status')).toContainText('Progetto importato');
    await page.locator('#zone-list button').click(); await expect(page.locator('#zone-music')).toHaveValue(src);
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('Progetto applicato');
    const saved = JSON.parse(await readFile(options.documentPath, 'utf8'));
    assert.deepEqual(saved.zones[0].music, { src, volume: .35 }); assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await studio.close();
    if (src && /^\/music\/codex-music-editor-review-[a-f0-9]{16}\.wav$/.test(src)) await rm(resolve(options.root, 'public', src.slice(1)), { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});
