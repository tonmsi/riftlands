import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldDocument, newWorldAsset, parseWorldDocument } from '../../shared/world-schema';
import { installCliffAssets } from '../../shared/cliff-assets';

test('bridge editor trims joints, exposes tools and shows cliff controls only for selected cliff assets', { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'riftlands-bridge-')), root = resolve('.');
  const options = { root: directory, port: 0, documentPath: join(directory, 'world.json'), dungeonPath: join(directory, 'dungeons.json'), dataPath: join(directory, 'accounts.json') };
  const document = newWorldDocument(1);
  document.spawn = { x: 4, y: -4 };
  for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) document.tiles.push({ x, y, terrain: 'grass' });
  document.assets.push(newWorldAsset('bridge-image', 'Ponte di prova', '/world-assets/bridge.svg'));
  installCliffAssets(document);
  document.geometry = { surfaces: [
    { id: 'left', x: 0, y: 0, width: 2, height: 2, elevation: 1, ground: true, terrain: 'grass' },
    { id: 'right', x: 6, y: 0, width: 2, height: 2, elevation: 1, ground: true, terrain: 'grass' },
    { id: 'old-bridge', x: 0, y: 0, width: 8, height: 2, elevation: 1, ground: false, terrain: 'path' },
  ], solids: [], stairs: [] };
  await Promise.all([
    cp(join(root, 'client'), join(directory, 'client'), { recursive: true }),
    cp(join(root, 'shared'), join(directory, 'shared'), { recursive: true }),
    cp(join(root, 'world-maker.html'), join(directory, 'world-maker.html')),
    cp(join(root, 'public/world-assets/montagna/cliff-grid'), join(directory, 'public/world-assets/montagna/cliff-grid'), { recursive: true }),
    writeFile(options.documentPath, JSON.stringify(document)), writeFile(options.dungeonPath, '[]'),
  ]);
  await writeFile(join(directory, 'public/world-assets/bridge.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="brown"/></svg>');
  const studio = await startWorldStudio(options);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1640, height: 1100 } }), errors: string[] = [];
    await page.addInitScript('window.__name = value => value');
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await expect(page.locator('#cliff-asset-controls')).toBeHidden();
    await expect(page.locator('#elevation-advanced')).not.toHaveAttribute('open', '');
    await page.locator('[data-elevation-tool="bridge"]').click();
    await expect(page.locator('#elevation-create-base')).toBeHidden();
    await expect(page.locator('#elevation-target')).toBeVisible();
    await expect(page.locator('#elevation-from')).toBeHidden();
    // Existing overlapping bridge is repaired by the regular update action.
    await page.locator('#elevation-shape').selectOption('surfaces|old-bridge');
    await page.locator('#elevation-update').click();
    await expect(page.locator('#issues')).not.toContainText('Superfici sovrapposte');
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('applicato');
    const saved = parseWorldDocument(await readFile(options.documentPath, 'utf8'));
    assert.deepEqual(saved.geometry!.surfaces.find(s => s.id === 'old-bridge'), { id: 'old-bridge', x: 2, y: 0, width: 4, height: 2, elevation: 1, terrain: 'path', ground: false, transparent: false, inheritAssetVisuals: true });
    // Recreate it by dragging across both plateaus: only the missing span is saved.
    await page.locator('#elevation-delete').click();
    await page.locator('[data-elevation-tool="bridge"]').click();
    const box = (await page.locator('#map').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2 - 4 * 24 + .5, box.y + box.height / 2 + 4 * 24 + .5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 3.75 * 24 + .5, box.y + box.height / 2 + 5.75 * 24 + .5, { steps: 5 });
    await page.mouse.up();
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('applicato');
    const created = parseWorldDocument(await readFile(options.documentPath, 'utf8'));
    const bridge = created.geometry!.surfaces.find(s => !s.ground)!;
    assert.equal(bridge.x, 2); assert.equal(bridge.width, 4); assert.equal(bridge.elevation, 1);
    await expect(page.locator('#elevation-inherit-assets')).toBeChecked();
    await page.locator('#elevation-material').selectOption('transparent');
    await page.locator('#elevation-inherit-assets').uncheck();
    await page.locator('#elevation-update').click();
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('applicato');
    await page.reload(); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await page.locator('[data-elevation-tool="bridge"]').click();
    await page.locator('#elevation-shape').selectOption(`surfaces|${bridge.id}`);
    await expect(page.locator('#elevation-material')).toHaveValue('transparent');
    await expect(page.locator('#elevation-inherit-assets')).not.toBeChecked();
    const transparent = parseWorldDocument(await readFile(options.documentPath, 'utf8'));
    assert.equal(transparent.geometry!.surfaces.length, 3);
    assert.equal(transparent.geometry!.surfaces.find(s => s.id === bridge.id)!.transparent, true);
    assert.equal(transparent.geometry!.surfaces.find(s => s.id === bridge.id)!.inheritAssetVisuals, false);
    // Switching from cliff editing to a normal asset must update the inspector immediately.
    const cliffId = Object.values(document.cliffAssets!)[0];
    await page.locator(`[data-asset="${cliffId}"]`).click();
    await expect(page.locator('#cliff-asset-controls')).toBeVisible();
    await expect(page.locator('#asset-inspector')).toBeVisible();
    await page.locator('[data-asset="bridge-image"]').click();
    await expect(page.locator('#cliff-asset-controls')).toBeHidden();
    await expect(page.locator('#asset-inspector')).toBeVisible();
    await expect(page.locator('#asset-name')).toHaveValue('Ponte di prova');
    await expect(page.locator('#elevation-inspector')).toBeHidden();
    await page.locator('[data-elevation-tool="bridge"]').click();
    await page.locator('#elevation-advanced > summary').click();
    await page.locator('#elevation-new-terrain').scrollIntoViewIfNeeded();
    await mkdir(join(root, 'artifacts'), { recursive: true });
    await page.screenshot({ path: join(root, 'artifacts/bridge-editor.png') });
    const visuals = await page.evaluate(async () => {
      const { TerrainRenderer } = await import('/client/render/terrain-renderer.ts' as string);
      const { Renderer } = await import('/client/render/render.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument, newWorldAsset } = await import('/shared/world-schema.ts' as string);
      const doc = newWorldDocument(1);
      const canvas = () => { const c = window.document.createElement('canvas'); c.width = c.height = 192; return c; };
      const base = canvas(), deck = canvas(), baseCtx = base.getContext('2d')!, deckCtx = deck.getContext('2d')!;
      const world = new World(1, 16, 'world', doc, []);
      const groundPainter = new TerrainRenderer(baseCtx), deckPainter = new TerrainRenderer(deckCtx);
      const differences: Record<string, number> = {};
      for (const material of ['grass', 'path', 'snow', 'mud', 'ice']) {
        world.getTile = () => material; world.authoringRevision++;
        groundPainter.drawTerrain(world, 1000, baseCtx, { left: 0, top: 0, right: 192, bottom: 192 });
        deckPainter.drawSurfaceMaterial(world, deckCtx, { id: 'material', x: 0, y: 0, width: 4, height: 4, elevation: 1, terrain: material }, 1000);
        const ordinary = baseCtx.getImageData(0,0,192,192).data, elevated = deckCtx.getImageData(0,0,192,192).data;
        differences[material] = ordinary.reduce((sum, v, i) => sum + Number(v !== elevated[i]), 0);
      }
      deckCtx.fillStyle = '#ff00ff'; deckCtx.fillRect(0,0,192,192);
      deckPainter.drawSurfaceMaterial(world, deckCtx, { id: 'invisible', x: 0, y: 0, width: 4, height: 4, elevation: 1, transparent: true }, 1000);
      const invisiblePixel = [...deckCtx.getImageData(80,80,1,1).data];
      groundPainter.dispose(); deckPainter.dispose();
      const image = newWorldAsset('png', 'PNG', '/world-assets/bridge.svg'); image.generation.enabled = false;
      doc.assets.push(image);
      const bridge = { id: 'deck', x: -2, y: -2, width: 4, height: 4, elevation: 1, transparent: true, inheritAssetVisuals: true };
      doc.geometry = { surfaces: [bridge], solids: [], stairs: [] };
      doc.placements.push({ id: 'above', assetId: 'png', x: -1, y: -1, baseElevation: 1 },
        { id: 'below', assetId: 'png', x: -1, y: -1, baseElevation: 0 },
        { id: 'away', assetId: 'png', x: 3, y: -1, baseElevation: 1 });
      const gameCanvas = window.document.createElement('canvas'); gameCanvas.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:700px';
      window.document.body.append(gameCanvas);
      const renderer = new Renderer(gameCanvas); renderer.world = new World(1,16,'world',doc,[]); renderer.world.getTile = () => 'grass';
      const log: Record<string, number> = {};
      renderer.worldAssetArt.draw = (ctx: CanvasRenderingContext2D, _asset: unknown, p: { id: string }) => { log[p.id] = ctx.globalAlpha; };
      renderer.characters.drawActor = () => {};
      const viewer = { id: 'viewer', kind: 'player', name: 'Viewer', classId: 'mage', x: 0, y: 0, elevation: 0, radius: 15, hp: 100, maxHp: 100, resource: 100, maxResource: 100, aim: 0, speed: 190, level: 1, xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
      const frame = { playing: true, self: viewer, actors: [], projectiles: [], pickups: [], traps: [], events: [], time: 1000, previewClass: 'mage', selectedId: null };
      renderer.render(frame); const under = { ...log };
      bridge.inheritAssetVisuals = false; renderer.render(frame); const disabled = { ...log };
      bridge.inheritAssetVisuals = true; viewer.elevation = 1; renderer.render(frame); const above = { ...log };
      viewer.elevation = 0; viewer.x = 3*48; renderer.render(frame); const outside = { ...log };
      renderer.destroy(); gameCanvas.remove();
      return { differences, invisiblePixel, under, disabled, above, outside };
    });
    assert.deepEqual(visuals.differences, { grass: 0, path: 0, snow: 0, mud: 0, ice: 0 });
    assert.deepEqual(visuals.invisiblePixel, [255,0,255,255]);
    assert.ok(Math.abs(visuals.under.above - .35) < .001);
    assert.equal(visuals.under.below, 1); assert.equal(visuals.under.away, 1);
    for (const state of [visuals.disabled, visuals.above, visuals.outside]) assert.ok(Object.values(state).every(alpha => alpha === 1));
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await studio.close(); await rm(directory, { recursive: true, force: true });
  }
});
