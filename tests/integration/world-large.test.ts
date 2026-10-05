import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { compactWorldTiles, serializeWorldDocument } from '../../shared/world-tiles';
import { newWorldDocument } from '../../shared/world-schema';

test('ten million authored cells stay compact, cached views avoid terrain work and checkpoints write only changed chunks', { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'riftlands-large-world-')), root = resolve('.');
  const document = newWorldDocument();
  for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) document.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  const compact = compactWorldTiles(document);
  for (let i = 0; i < 10_000; i++) compact.tileChunks!.push([i + 100, 100, 0, 1024, 7]);
  const text = serializeWorldDocument(compact); assert.ok(text.length < 350_000);
  const options = { root: directory, port: 0, documentPath: join(directory, 'world.json'), dungeonPath: join(directory, 'dungeons.json'), dataPath: join(directory, 'accounts.json') };
  await Promise.all([cp(join(root, 'client'), join(directory, 'client'), { recursive: true }), cp(join(root, 'shared'), join(directory, 'shared'), { recursive: true }),
    cp(join(root, 'world-maker.html'), join(directory, 'world-maker.html')), writeFile(options.documentPath, text), writeFile(options.dungeonPath, '[]')]);
  const studio = await startWorldStudio(options); let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.addInitScript('window.__name = value => value');
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await expect(page.locator('#map-info')).toContainText('10.240.049');
    const timings = await page.evaluate(async () => {
      const { World } = await import('/shared/world.ts' as string), { drawWorldEditorMap } = await import('/client/editors/world/world-editor-canvas.ts' as string);
      const { WorldAssetArt } = await import('/client/render/world-asset-art.ts' as string), { drawMinimap } = await import('/client/render/render.ts' as string);
      const project = await (await fetch('/__world/project')).json(), world = new World(42, 16, 'world', project.document, []);
      const canvas = window.document.createElement('canvas'); canvas.style.cssText = 'width:900px;height:700px'; window.document.body.append(canvas);
      const options = { grid: false, cells: false, zones: false, npcs: false, selected: null, gesture: null, pointerTile: null, tool: 'select' };
      const art = new WorldAssetArt(), view = { x: 450, y: 350, scale: 24 };
      let queries = 0; const getTile = world.getTile.bind(world); world.getTile = (x: number, y: number) => { queries++; return getTile(x, y); };
      drawWorldEditorMap(canvas, world, project.document, view, art, options); queries = 0;
      const start = performance.now(); for (let i = 0; i < 50; i++) drawWorldEditorMap(canvas, world, project.document, view, art, options);
      const editorMs = (performance.now() - start) / 50, editorQueries = queries;
      canvas.style.cssText = 'width:240px;height:240px';
      drawMinimap(canvas, world, { x: 0, y: 0 }, [], [], 4800); queries = 0;
      const mapStart = performance.now(); for (let i = 0; i < 50; i++) drawMinimap(canvas, world, { x: .1 + (i % 3) * .1, y: .1 }, [], [], 4800);
      const minimapMs = (performance.now() - mapStart) / 50, minimapQueries = queries;
      canvas.remove(); return { editorMs, editorQueries, minimapMs, minimapQueries, decoded: world.authoring.tiles.decodedChunkCount };
    });
    console.log('Large-world cached rendering (10,240,049 authored cells):', timings);
    assert.equal(timings.editorQueries, 0); assert.equal(timings.minimapQueries, 0); assert.ok(timings.editorMs < 12); assert.ok(timings.minimapMs < 12); assert.ok(timings.decoded <= 128);
    const box = (await page.locator('#map').boundingBox())!;
    await page.locator('[data-tool="terrain"]').click(); await page.locator('#terrain').selectOption('path'); await page.locator('#brush-radius').fill('2');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 288, box.y + box.height / 2, { steps: 1 }); await page.mouse.up();
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('Progetto applicato con backup');
    await page.locator('#undo').click(); await page.locator('#redo').click();
    const writes = await page.evaluate(async () => {
      const { loadWorldCheckpoint, saveWorldCheckpoint } = await import('/client/editors/world/world-editor-storage.ts' as string);
      const { WorldBrush, forkWorldDocument } = await import('/shared/world-editing.ts' as string);
      const checkpoint = await loadWorldCheckpoint(), next = forkWorldDocument(checkpoint.document), brush = new WorldBrush(next);
      brush.tile({ x: 0, y: 0 }, { terrain: 'rock', suppressAssets: true }); brush.flushTiles();
      let writes = 0; const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value: any, key?: IDBValidKey) { writes++; return put.call(this, value, key); };
      try { await saveWorldCheckpoint({ document: next, revision: checkpoint.revision }); } finally { IDBObjectStore.prototype.put = put; }
      return writes;
    });
    assert.equal(writes, 2, 'one changed chunk and one metadata record, not the entire world');
    assert.ok((await readFile(options.documentPath)).length < 350_000);
    const context = await browser.newContext(), storagePage = await context.newPage();
    await storagePage.addInitScript('window.__name = value => value');
    await storagePage.route('**/storage-migration-test', route => route.fulfill({ contentType: 'text/html', body: '<body></body>' }));
    await storagePage.goto(new URL('/storage-migration-test', studio.url).href);
    const migrated = await storagePage.evaluate(async () => {
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string), old = newWorldDocument();
      old.tiles.push({ x: -1, y: -1, terrain: 'grass', suppressAssets: true });
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('riftlands.world-maker.v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('drafts');
        request.onsuccess = () => { const db = request.result, transaction = db.transaction('drafts', 'readwrite'); transaction.objectStore('drafts').put({ revision: 'old', document: old }, 'project'); transaction.oncomplete = () => { db.close(); resolve(); }; };
        request.onerror = () => reject(request.error);
      });
      const { loadWorldCheckpoint, saveWorldCheckpoint } = await import('/client/editors/world/world-editor-storage.ts' as string);
      const { WorldTiles } = await import('/shared/world-tiles.ts' as string);
      const checkpoint = await loadWorldCheckpoint(); await saveWorldCheckpoint(checkpoint); const next = await loadWorldCheckpoint();
      return { version: next.document.version, legacyTiles: next.document.tiles.length, terrain: new WorldTiles(next.document).at(-1, -1)?.terrain, revision: next.revision };
    });
    assert.deepEqual(migrated, { version: 2, legacyTiles: 0, terrain: 'grass', revision: 'old' }); await context.close();
  } finally { await browser?.close(); await studio.close(); await rm(directory, { recursive: true, force: true }); }
});
