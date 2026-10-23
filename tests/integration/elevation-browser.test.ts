import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { newWorldDocument, newWorldAsset, resizeWorldAsset, parseWorldDocument } from '../../shared/world-schema';
import { installCliffAssets } from '../../shared/cliff-assets';

test('World Maker authors fractional elevated terrain and stairs, preserves undo and applies the geometry', { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'riftlands-elevation-')), root = resolve('.');
  const options = { root: directory, port: 0, documentPath: join(directory, 'world.json'), dungeonPath: join(directory, 'dungeons.json'), dataPath: join(directory, 'accounts.json') };
  const document = newWorldDocument();
  for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) document.tiles.push({ x, y, terrain: 'grass' });
  const asset = newWorldAsset('bridge', 'Ponte', '/world-assets/bridge.svg'); resizeWorldAsset(asset, 4, 4); document.assets.push(asset);
  installCliffAssets(document);
  await Promise.all([cp(join(root, 'client'), join(directory, 'client'), { recursive: true }), cp(join(root, 'shared'), join(directory, 'shared'), { recursive: true }),
    cp(join(root, 'world-maker.html'), join(directory, 'world-maker.html')), cp(join(root, 'public/world-assets/montagna/cliff-grid'), join(directory, 'public/world-assets/montagna/cliff-grid'), { recursive: true }),
    cp(join(root, 'public/world-assets/dungeon'), join(directory, 'public/world-assets/dungeon'), { recursive: true }),
    writeFile(options.documentPath, JSON.stringify(document)), writeFile(options.dungeonPath, '[]')]);
  await writeFile(join(directory, 'public/world-assets/bridge.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="brown"/></svg>');
  const studio = await startWorldStudio(options);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1640, height: 1100 } }), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await expect(page.locator('#elevation-view')).toHaveValue('all');
    await expect(page.locator('#elevation-inspector')).toBeHidden();
    // Material + optional quota: no area selection or preparatory rectangle.
    await page.locator('#terrain').selectOption('snow');
    await expect(page.locator('#terrain-brush-settings')).toBeVisible();
    await expect(page.locator('#terrain-elevation')).toHaveValue('');
    await expect(page.locator('#terrain-auto-stair')).not.toBeChecked();
    await page.locator('#terrain-auto-stair').check();
    await page.locator('#terrain-elevation').fill('1');
    await page.locator('#brush-radius').fill('0');
    const paintBox = (await page.locator('#map').boundingBox())!;
    const clickTile = async (x: number, y: number) => page.mouse.click(paintBox.x + paintBox.width / 2 + (x + .5) * 24, paintBox.y + paintBox.height / 2 + (y + .5) * 24);
    await clickTile(2, 2);
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('applicato');
    const painted = parseWorldDocument(await readFile(options.documentPath, 'utf8'));
    assert.equal(painted.geometry!.surfaces.length, 1);
    assert.equal(painted.geometry!.surfaces[0].elevation, 1);
    assert.equal(painted.geometry!.surfaces[0].terrain, 'snow');
    assert.equal(painted.geometry!.stairs.length, 1);
    assert.equal(painted.geometry!.stairs[0].automatic, true);
    await page.locator('#elevation-view').selectOption('floor:0');
    await expect(page.locator('#elevation-active')).toHaveValue('0');
    await expect(page.locator('#elevation-view-summary')).toContainText('Livelli visibili: 0');
    await page.locator('#elevation-view').selectOption('floor:1');
    await expect(page.locator('#elevation-active')).toHaveValue('1');
    await expect(page.locator('#elevation-view-summary')).toContainText('Livelli visibili: 1');
    await page.locator('#elevation-view').selectOption('all');
    await page.locator('#terrain-elevation-auto').click();
    await page.locator('#terrain').selectOption('path');
    await clickTile(2, 2);
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('applicato');
    const repainted = parseWorldDocument(await readFile(options.documentPath, 'utf8'));
    assert.equal(repainted.geometry!.surfaces[0].elevation, 1);
    assert.equal(repainted.geometry!.surfaces[0].terrain, 'path');
    assert.equal(repainted.geometry!.stairs.length, 1);
    await page.screenshot({ path: join(root, 'artifacts/elevation-material-brush.png') });
    await page.locator('#undo').click(); await page.locator('#undo').click();
    await page.locator('#elevation-active').fill('0'); await page.locator('#elevation-active').press('Tab');
    await expect(page.locator('#elevation-advanced')).not.toHaveAttribute('open', '');
    await page.locator('#elevation-advanced > summary').click();
    await page.locator('#elevation-new-terrain').click();
    await page.locator('#elevation-target').fill('0');
    await page.locator('#elevation-draw-terrain').click();
    await expect(page.locator('#elevation-status')).toContainText('maggiore');
    await page.locator('#elevation-target').fill('1');
    await page.locator('#elevation-create-base').fill('0');
    await page.locator('#elevation-draw-terrain').click();
    await expect(page.locator('#elevation-active')).toHaveValue('1');
    await expect(page.locator('#elevation-action-guide')).toContainText('Pronto');
    await expect(page.locator('#asset-inspector')).toBeHidden();
    await page.screenshot({ path: join(root, 'artifacts/elevation-create-terrain.png') });
    const drag = async (x1: number, y1: number, x2: number, y2: number) => {
      const box = (await page.locator('#map').boundingBox())!;
      const pos = (x: number, y: number) => ({ x: box.x + box.width / 2 + x * 24 + .5, y: box.y + box.height / 2 + y * 24 + .5 });
      const a = pos(x1, y1), b = pos(x2, y2);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
    };
    await drag(2, -1, 5, 2);
    await expect(page.locator('#elevation-shape option')).toHaveCount(3);
    await page.locator('#undo').click(); await expect(page.locator('#elevation-shape option')).toHaveCount(1);
    await page.locator('#redo').click(); await expect(page.locator('#elevation-shape option')).toHaveCount(3);
    await page.locator('[data-tool="select"]').click();
    const mapBox = (await page.locator('#map').boundingBox())!;
    await page.mouse.click(mapBox.x + mapBox.width / 2 + 4.5 * 24, mapBox.y + mapBox.height / 2 + 1.5 * 24);
    await expect(page.locator('#elevation-selection-summary')).toContainText('Terreno a quota 1');
    await page.locator('#elevation-add-stair').click();
    await expect(page.locator('#elevation-from')).toHaveValue('0');
    await expect(page.locator('#elevation-to')).toHaveValue('1');
    await drag(1, 0, 3, 1.75);
    await expect(page.locator('#elevation-shape option')).toHaveCount(4);
    await page.locator('#elevation-x').fill('1'); await page.locator('#elevation-y').fill('0');
    await page.locator('#elevation-width').fill('2'); await page.locator('#elevation-height').fill('2');
    await page.locator('#elevation-update').click();
    await page.locator('#elevation-stair-width').fill('3'); await page.locator('#elevation-stair-width').press('Tab');
    await expect(page.locator('#elevation-height')).toHaveValue('3');
    await page.locator('#elevation-update').click();
    await page.locator('#apply-world').click();
    await expect(page.locator('#status')).toContainText('applicato');
    const saved = parseWorldDocument(await readFile(options.documentPath, 'utf8'));
    assert.equal(saved.geometry!.surfaces[0].elevation, 1);
    assert.equal(saved.geometry!.solids[0].top, 1);
    assert.equal(saved.geometry!.stairs[0].to, 1);
    assert.equal(saved.geometry!.stairs[0].height, 3);
    assert.equal(saved.geometry!.stairs[0].tiled, true);
    await page.screenshot({ path: join(root, 'artifacts/elevation-terrain-guide.png') });
    // View filters are independent of the document and really remove the hidden floor's pixels.
    const floorPixel = () => page.evaluate(() => {
      const c = window.document.querySelector<HTMLCanvasElement>('#map')!, box = c.getBoundingClientRect(), ratio = c.width / box.width;
      return [...c.getContext('2d')!.getImageData(Math.floor((box.width / 2 + 4.5 * 24) * ratio), Math.floor((box.height / 2 + 1.5 * 24) * ratio), 1, 1).data];
    });
    await page.locator('#elevation-view').selectOption('active');
    await page.locator('#elevation-active').fill('0'); await page.locator('#elevation-active').press('Tab');
    await expect.poll(floorPixel).toEqual([19, 29, 22, 255]);
    await page.locator('#elevation-active').fill('1'); await page.locator('#elevation-active').press('Tab');
    await expect.poll(async () => JSON.stringify(await floorPixel())).not.toBe(JSON.stringify([19, 29, 22, 255]));
    await page.locator('#elevation-view').selectOption('custom');
    await page.locator('#elevation-visible-levels').fill('0, 2'); await page.locator('#elevation-visible-levels').press('Tab');
    await expect(page.locator('#elevation-view-summary')).toContainText('0, 2');
    await expect.poll(floorPixel).toEqual([19, 29, 22, 255]);
    await page.locator('#elevation-level-choices input[value="1"]').check();
    await expect(page.locator('#elevation-view-summary')).toContainText('0, 1, 2');
    await page.locator('#elevation-view').selectOption('range');
    await page.locator('#elevation-view-from').fill('1'); await page.locator('#elevation-view-from').press('Tab');
    await expect(page.locator('#elevation-view-summary')).toContainText('1…2');
    await page.locator('#elevation-view').selectOption('from');
    await page.locator('#elevation-view-from').fill('2'); await page.locator('#elevation-view-from').press('Tab');
    await expect(page.locator('#elevation-view-summary')).toContainText('2 e superiori');
    await expect.poll(floorPixel).toEqual([19, 29, 22, 255]);
    await page.locator('#elevation-view').selectOption('all');
    await page.locator('#elevation-active').fill('1'); await page.locator('#elevation-active').press('Tab');
    await page.locator('#elevation-owner').selectOption('asset');
    await page.locator('#asset-list [data-asset="bridge"]').click();
    await page.locator('[data-elevation-tool="bridge"]').click();
    await page.locator('#asset-grid').scrollIntoViewIfNeeded();
    const grid = (await page.locator('#asset-grid').boundingBox())!;
    const unit = Math.min((grid.width - 28) / 4, (grid.height - 28) / 4);
    const left = grid.x + (grid.width - unit * 4) / 2, top = grid.y + (grid.height - unit * 4) / 2;
    await page.mouse.move(left + unit * .1, top + unit * .1); await page.mouse.down();
    await page.mouse.move(left + unit * 3.5, top + unit * 3.5, { steps: 5 }); await page.mouse.up();
    await expect(page.locator('#elevation-shape option')).toHaveCount(2);
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('applicato');
    const withAsset = parseWorldDocument(await readFile(options.documentPath, 'utf8'));
    assert.equal(withAsset.assets[0].geometry!.surfaces[0].elevation, 1);
    // Large archives are read locally; individual images are uploaded separately.
    await page.locator('#world-file').setInputFiles({ name: 'large-world.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(withAsset) + ' '.repeat(50_000_001)) });
    await expect(page.locator('#status')).toContainText('Progetto importato', { timeout: 30_000 });
    await expect(page.locator('#cliff-asset-controls')).toBeHidden();
    await page.locator(`#asset-list [data-asset="${document.cliffAssets!['centro-sinistra']}"]`).click();
    await expect(page.locator('#cliff-asset-controls')).toBeVisible();
    await page.locator('#cliff-variant').selectOption('centro-sinistra'); await page.locator('#cliff-edit').click();
    await expect(page.locator('#asset-inspector')).toBeVisible();
    await expect(page.locator('#asset-name')).toHaveValue('cliff-grid centro-sinistra');
    await page.locator('#cell-blocked').selectOption('false'); await page.locator('#cell-visibility').selectOption('hide-fade');
    await page.locator('#fill-cells').click(); await page.locator('#asset-layer').selectOption('ground'); await page.locator('#asset-update').click();
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('applicato');
    const cliffConfigured = parseWorldDocument(await readFile(options.documentPath,'utf8'));
    const leftCliff = cliffConfigured.assets.find(a=>a.id===cliffConfigured.cliffAssets!['centro-sinistra'])!;
    assert.equal(leftCliff.cells[0].blocked,false); assert.equal(leftCliff.cells[0].visibility,'hide-fade'); assert.equal(leftCliff.layer,'ground');
    await page.reload(); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await page.locator(`#asset-list [data-asset="${leftCliff.id}"]`).click();
    await page.locator('#cliff-variant').selectOption('centro-sinistra'); await page.locator('#cliff-edit').click();
    await expect(page.locator('#asset-layer')).toHaveValue('ground');
    await page.locator('#asset-cell-subdivision').selectOption('4');
    await expect(page.locator('#asset-cell-info')).toContainText('4 × 4');
    await expect(page.locator('#asset-width')).toHaveValue('1'); await expect(page.locator('#asset-height')).toHaveValue('1');
    await page.locator('#undo').click(); await expect(page.locator('#asset-cell-subdivision')).toHaveValue('1');
    await page.locator('#redo').click(); await expect(page.locator('#asset-cell-subdivision')).toHaveValue('4');
    await page.locator('#cell-blocked').selectOption('true'); await page.locator('#cell-visibility').selectOption('normal');
    await page.locator('#asset-grid').scrollIntoViewIfNeeded();
    const fineBox=(await page.locator('#asset-grid').boundingBox())!, fineUnit=Math.min(fineBox.width-28,fineBox.height-28);
    await page.mouse.click(fineBox.x+(fineBox.width-fineUnit)/2+fineUnit*.375,fineBox.y+(fineBox.height-fineUnit)/2+fineUnit*.375);
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('applicato');
    const divided=parseWorldDocument(await readFile(options.documentPath,'utf8'));
    const fineCliff=divided.assets.find(a=>a.id===divided.cliffAssets!['centro-sinistra'])!;
    assert.equal(fineCliff.width,1);assert.equal(fineCliff.height,1);assert.equal(fineCliff.cellSubdivision,4);assert.equal(fineCliff.cells.length,16);
    assert.equal(fineCliff.cells.filter(c=>c.blocked).length,1);assert.equal(fineCliff.cells[5].blocked,true);
    await page.screenshot({path:join(root,'artifacts/asset-subdivision-grid.png')});
    // A walkable cliff subcell explicitly belongs to the upper floor, and mask edits preserve it.
    await expect(page.locator('#cell-floor')).toHaveValue('keep');
    await page.locator('#cell-blocked').selectOption('false');
    await page.locator('#cell-floor').selectOption('1');
    const paintFineCell = async () => {
      await page.locator('#asset-grid').scrollIntoViewIfNeeded();
      const box=(await page.locator('#asset-grid').boundingBox())!, u=Math.min(box.width-28,box.height-28);
      await page.mouse.click(box.x+(box.width-u)/2+u*.375,box.y+(box.height-u)/2+u*.375);
    };
    await paintFineCell();
    await page.locator('#undo').click(); await page.locator('#redo').click();
    await page.locator('#cell-floor').selectOption('keep');
    await page.locator('#cell-visibility').selectOption('hide-fade'); await paintFineCell();
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('applicato');
    const upperSaved=parseWorldDocument(await readFile(options.documentPath,'utf8'));
    const upperCliff=upperSaved.assets.find(a=>a.id===upperSaved.cliffAssets!['centro-sinistra'])!;
    assert.equal(upperCliff.cells[5].elevation,1); assert.equal(upperCliff.cells[5].blocked,false);
    assert.equal(upperCliff.cells[5].visibility,'hide-fade');
    assert.equal(upperCliff.cells.filter(c=>c.elevation!==undefined).length,1);
    await page.locator('#elevation-view').selectOption('floor:1');
    await paintFineCell();
    await page.screenshot({path:join(root,'artifacts/asset-subcell-upper-floor.png')});
    await page.locator('#elevation-view').selectOption('all');
    // The same control is available on ordinary world images, without changing their footprint.
    await page.locator('#asset-list [data-asset="bridge"]').click(); await page.locator('#asset-cell-subdivision').selectOption('2');
    await expect(page.locator('#asset-cell-info')).toContainText('8 × 8');
    await expect(page.locator('#asset-width')).toHaveValue('4'); await expect(page.locator('#asset-height')).toHaveValue('4');
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('applicato');
    const normalDivided=parseWorldDocument(await readFile(options.documentPath,'utf8'));
    assert.equal(normalDivided.assets.find(a=>a.id==='bridge')!.cells.length,64);
    await page.locator('#elevation-asset-stair').click();
    await expect(page.locator('#elevation-stair-appearance')).toHaveValue('passage');
    await page.locator('#elevation-from').fill('-1'); await page.locator('#elevation-to').fill('1');
    await page.locator('#elevation-axis').selectOption('y'); await page.locator('#elevation-update').click();
    await page.locator('#apply-world').click(); await expect(page.locator('#status')).toContainText('applicato');
    const passageSaved=parseWorldDocument(await readFile(options.documentPath,'utf8'));
    const passage=passageSaved.assets.find(a=>a.id==='bridge')!.geometry!;
    assert.equal(passage.stairs[0].appearance,'passage');assert.equal(passage.stairs[0].from,-1);assert.equal(passage.stairs[0].to,1);assert.equal(passage.stairs[0].axis,'y');
    assert.equal(passage.surfaces.find(s=>s.id==='asset-passage-from')!.elevation,-1);
    assert.equal(passage.surfaces.find(s=>s.id==='asset-passage-to')!.y,2);
    await page.locator('#elevation-controls').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(root, 'artifacts/elevation-editor.png') });
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await studio.close(); await rm(directory, { recursive: true, force: true }); }
});

test('painted plateau joins complete cliff sprites and renders its automatic stone access', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
    await page.addInitScript('window.__name = value => value');
    await page.route('**/cliff-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas style="width:900px;height:760px"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}cliff-review`);
    const result = await page.evaluate(async () => {
      const { drawWorldEditorMap } = await import('/client/editors/world/world-editor-canvas.ts' as string);
      const { WorldAssetArt } = await import('/client/render/world-asset-art.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const { TerrainElevationBrush } = await import('/shared/terrain-elevation-editing.ts' as string);
      const { ensureTerrainAccess } = await import('/shared/terrain-access.ts' as string);
      const doc = newWorldDocument(); doc.spawn = { x: -6, y: 5 };
      doc.zones.push({ id:'warm-test',name:'Erba temperata',priority:1,temperature:.7,moisture:.5,shape:{kind:'rect',x:-12,y:-12,width:24,height:24} });
      for (let y = -12; y < 12; y++) for (let x = -12; x < 12; x++) doc.tiles.push({ x, y, terrain: 'grass' });
      const brush = new TerrainElevationBrush(doc);
      for (let y = -2; y < 2; y++) for (let x = -3; x < 3; x++) brush.paint({ x, y }, 'grass', 1, 0);
      for (let y = -5; y < -2; y++) for (let x = -1; x < 1; x++) brush.paint({ x, y }, 'grass', 1, 0);
      for (let y = 2; y < 4; y++) for (let x = -1; x < 1; x++) brush.paint({ x, y }, 'grass', 1, 0);
      brush.flush(true); const access = ensureTerrainAccess(doc, new World(1, 16, 'world', doc, []), brush.raisedPoints);
      const world = new World(1, 16, 'world', doc, []), canvas = document.querySelector('canvas')!;
      const art = new WorldAssetArt(() => draw());
      const options = { painting: true, grid: true, cells: false, zones: false, npcs: false, selected: null, gesture: null, pointerTile: null, tool: 'terrain', visibleElevations: null };
      const view = { x: 450, y: 340, scale: 50 };
      const draw = () => drawWorldEditorMap(canvas, world, doc, view, art, options);
      draw(); (window as any).cliffReview = { art, draw, options, canvas, doc, view, world };
      return access;
    });
    assert.equal(result.added, 1); assert.equal(result.missing, 0);
    await expect.poll(() => page.evaluate(() => (window as any).cliffReview.art.performanceInfo().entries)).toBe(11);
    await page.screenshot({ path: resolve('artifacts/elevation-cliffs-stone-stair.png') });
    const pixels = await page.evaluate(async () => {
      const review = (window as any).cliffReview;
      const sample = () => [...review.canvas.getContext('2d').getImageData(475, 365, 1, 1).data];
      review.options.visibleElevations = [0]; review.draw(); const zero = sample();
      review.options.visibleElevations = [1]; review.draw(); const one = sample();
      review.options.visibleElevations = null; review.draw(); const all=sample();
      const { drawWorldEditorMap } = await import('/client/editors/world/world-editor-canvas.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const groundDoc={...review.doc,geometry:undefined}, ground=new World(1,16,'world',groundDoc,[]);
      drawWorldEditorMap(review.canvas,ground,groundDoc,review.view,review.art,review.options); const base=sample(); review.draw();
      const { installCliffAssets,cliffAsset }=await import('/shared/cliff-assets.ts' as string);
      const { drawTerrainCliff }=await import('/client/render/cliff-art.ts' as string);
      installCliffAssets(review.doc); const asset=cliffAsset(review.doc,'centro-sinistra');
      asset.cells[0]={blocked:false,visibility:'hide-fade'}; asset.fade={opacity:.2,feather:0,durationMs:0};
      const cliff=review.world.elevation.cliffs({left:-4,top:0,right:-3,bottom:1})[0];
      const small=document.createElement('canvas');small.width=small.height=48; const ctx=small.getContext('2d')!;
      const alpha=(self:any,floor?:number)=>{ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,48,48);ctx.translate(192,0);drawTerrainCliff(ctx,cliff,review.art,[],{document:review.doc,self,floor,time:1000});return ctx.getImageData(12,24,1,1).data[3];};
      const opaque=alpha(null), faded=alpha({x:-180,y:24,elevation:0});
      asset.layer='ground'; const above=alpha(null,1), behind=alpha(null,0);
      return { zero, one, all, base,opaque,faded,above,behind };
    });
    assert.deepEqual(pixels.zero, [19, 29, 22, 255]);
    assert.notDeepEqual(pixels.one, pixels.zero); assert.deepEqual(pixels.one, pixels.all);
    assert.deepEqual(pixels.all,pixels.base,'the plateau must keep the exact ground material color and texture');
    assert(pixels.opaque>pixels.faded,'hide-fade must use the editable cliff fade mask');
    assert.equal(pixels.above,0); assert(pixels.behind>0,'background cliffs must draw on the lower plane');
  } finally { await browser?.close(); await server.close(); }
});

test('rendering interleaves underpass actors and shots, bridge deck and upper actors', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.addInitScript('window.__name = value => value');
    await page.route('**/elevation-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas style="width:900px;height:700px"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}elevation-review`);
    const result = await page.evaluate(async () => {
      const { Renderer } = await import('/client/render/render.ts' as string), { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument, newWorldAsset, resizeWorldAsset } = await import('/shared/world-schema.ts' as string);
      const document = newWorldDocument(), bridge = newWorldAsset('bridge', 'Bridge', '/world-assets/bush.svg'); resizeWorldAsset(bridge, 4, 4);
      bridge.geometry = { surfaces: [{ id: 'deck', x: 0, y: 0, width: 4, height: 4, elevation: 1 }], solids: [{ id: 'mass', x: 0, y: 0, width: 4, height: 4, base: 0, top: 1 }], stairs: [] };
      document.assets.push(bridge); document.placements.push({ id: 'bridge-instance', assetId: bridge.id, x: -2, y: -2, baseElevation: 1 });
      const world = new World(1, 16, 'world', document, []); world.getTile = () => 'grass';
      const renderer = new Renderer(window.document.querySelector('canvas')); renderer.world = world;
      const log: { id: string; opacity?: number }[] = [];
      renderer.characters.drawActor = (a: any) => log.push({ id: a.id });
      renderer.worldAssetArt.draw = (ctx: CanvasRenderingContext2D, a: any, p: any) => log.push({ id: p.id, opacity: ctx.globalAlpha });
      renderer.drawProjectile = (p: any) => log.push({ id: p.id });
      const actor = { id: 'under', kind: 'player', name: 'Under', classId: 'mage', x: 0, y: 0, elevation: 0, radius: 15, hp: 100, maxHp: 100, resource: 100, maxResource: 100, aim: 0, speed: 190, level: 1, xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
      const upper = { ...actor, id: 'upper', elevation: 2 };
      renderer.render({ playing: true, self: actor, actors: [actor, upper], projectiles: [{ id: 'shot-under', x: 0, y: 0, elevation: 0 }, { id: 'shot-upper', x: 0, y: 0, elevation: 2 }], pickups: [], events: [], time: 1000, previewClass: 'mage', moveDirection: null, selectedId: null, aimPreview: null });
      const firstDraw=log.slice();
      document.geometry={surfaces:[],solids:[],stairs:[{id:'camera-passage',x:0,y:0,width:4,height:1,axis:'x',from:0,to:1,appearance:'passage'}]};
      renderer.world=new World(1,16,'world',document,[]);renderer.world.getTile=()=>'grass';
      const frame={playing:true,self:actor,actors:[],projectiles:[],pickups:[],traps:[],events:[],time:1000,previewClass:'mage',selectedId:null};
      const zoomAt=(x:number,elevation:number)=>{
        actor.x=x*48;actor.y=24;actor.elevation=elevation;renderer.resetCamera();renderer.render(frame);return renderer.performanceInfo().zoom;
      };
      const start=zoomAt(0,0),middleLow=zoomAt(2,0),middleHigh=zoomAt(2,1),end=zoomAt(4,1);
      const box=renderer.canvas.getBoundingClientRect(),center=renderer.screenToWorld(box.left+box.width/2,box.top+box.height/2);
      actor.x=0;actor.elevation=0;renderer.render({...frame,holdCamera:true});const held=renderer.performanceInfo().zoom;
      let terrainPaints=0;const drawTerrain=renderer.terrain.drawTerrain.bind(renderer.terrain);
      renderer.terrain.drawTerrain=(...args:any[])=>{terrainPaints++;return drawTerrain(...args);};
      renderer.terrain.invalidate();zoomAt(0,0);const initialPaints=terrainPaints;
      const cache=renderer.terrain.terrainCache,cacheWidth=cache.canvas.width;
      for(let i=1;i<=24;i++) {
        actor.x=i/6*48;actor.elevation=i<12?0:1;renderer.lastTime=performance.now()-16;renderer.render(frame);
      }
      const animationPaints=terrainPaints-initialPaints,cacheReused=renderer.terrain.terrainCache===cache&&cache.canvas.width===cacheWidth;
      renderer.destroy(); return {log:firstDraw,zoom:{start,middleLow,middleHigh,end,held},center,animationPaints,cacheReused};
    });
    const index = (id: string) => result.log.findIndex(r => r.id === id);
    const deckIndex = result.log.findIndex(r => r.id === 'bridge-instance' && r.opacity === .35);
    assert.ok(index('under') < deckIndex); assert.ok(index('shot-under') < deckIndex);
    assert.ok(deckIndex < index('upper')); assert.ok(deckIndex < index('shot-upper'));
    assert.ok(result.zoom.start>result.zoom.middleLow&&result.zoom.middleLow>result.zoom.end);
    assert.equal(result.zoom.middleLow,result.zoom.middleHigh,'the discrete floor switch must not jump the camera');
    assert.equal(result.zoom.held,result.zoom.end);
    assert.deepEqual(result.center,{x:192,y:24},'screen targeting uses the actual zoom');
    assert.equal(result.animationPaints,0,'animated elevation zoom must reuse terrain, without repaints per frame');
    assert.equal(result.cacheReused,true);
  } finally { await browser?.close(); await server.close(); }
});

test('editor floor isolation masks terrain, nested plateaus, water and regions of asset artwork', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    await page.addInitScript('window.__name = value => value');
    await page.route('**/floor-visibility-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas style="width:640px;height:480px"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}floor-visibility-review`);
    const result = await page.evaluate(async () => {
      const { drawWorldEditorMap } = await import('/client/editors/world/world-editor-canvas.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument, newWorldAsset, resizeWorldAsset } = await import('/shared/world-schema.ts' as string);
      const d = newWorldDocument(); d.spawn = { x: 100, y: 100 };
      d.geometry = { surfaces: [
        { id: 'plateau', x: 1, y: 0, width: 1, height: 1, elevation: 1, ground: true, terrain: 'grass' },
        { id: 'upper', x: 1, y: 0, width: .5, height: 1, elevation: 2, ground: true, terrain: 'snow' },
        { id: 'bridge', x: 0, y: 1, width: 1, height: 1, elevation: 2, terrain: 'ice' },
        { id: 'lower', x: 2, y: 0, width: 1, height: 1, elevation: -1, ground: true, terrain: 'path' },
      ], solids: [
        { id: 'plateau-mass', x: 1, y: 0, width: 1, height: 1, base: 0, top: 1 },
        { id: 'upper-mass', x: 1, y: 0, width: .5, height: 1, base: 1, top: 2 },
      ], stairs: [] };
      const a = newWorldAsset('art', 'Art', '/world-assets/test.png'); resizeWorldAsset(a, 2, 1);
      a.geometry = { surfaces: [{ id: 'deck', x: 1, y: 0, width: 1, height: 1, elevation: 2 }], solids: [], stairs: [] };
      d.assets = [a]; d.placements = [{ id: 'asset', assetId: 'art', x: 2, y: 1, baseElevation: 0 }];
      const world = new World(1, 16, 'world', d, []); world.getTile = (x: number, y: number) => x === 3 && y === 0 ? 'water' : 'grass';
      const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
      const art = { draw(ctx: CanvasRenderingContext2D, a: any, p: any, opacity: number, unit: number) { ctx.fillStyle = '#ff0000'; ctx.fillRect(p.x * unit, p.y * unit, a.width * unit, a.height * unit); } };
      const sample = (x: number, y: number) => [...ctx.getImageData(Math.floor((120 + x * 40) * canvas.width / 640), Math.floor((100 + y * 40) * canvas.height / 480), 1, 1).data];
      const render = (filter: number[] | null) => {
        drawWorldEditorMap(canvas, world, d, { x: 120, y: 100, scale: 40 }, art, { painting: false, grid: false, cells: false, zones: false, npcs: false, selected: null, gesture: null, pointerTile: null, tool: 'select', visibleElevations: filter });
        return { plain: sample(.5, .5), plateau: sample(1.75, .5), upper: sample(1.25, .5), bridge: sample(.5, 1.5), lower: sample(2.5, .5), water: sample(3.5, .5), assetBase: sample(2.5, 1.5), assetTop: sample(3.5, 1.5) };
      };
      const views={ all: render(null), zero: render([0]), one: render([1]), two: render([2]), combined: render([0, 2]), negative: render([-1]), empty: render([]), restored: render(null) };
      const { drawVisibleAsset } = await import('/client/editors/world/elevation-visibility.ts' as string);
      const { subdivideWorldAsset } = await import('/shared/world-schema.ts' as string);
      const cellAsset=newWorldAsset('cells','Sottocelle','/world-assets/test.png');subdivideWorldAsset(cellAsset,2);
      cellAsset.cells[0].elevation=1;cellAsset.cells[1].elevation=-1;
      const cellCanvas=document.createElement('canvas');cellCanvas.width=cellCanvas.height=40;const cellCtx=cellCanvas.getContext('2d')!;
      const cellViews=[0,1,-1].map(floor=>{
        cellCtx.clearRect(0,0,40,40);drawVisibleAsset(cellCtx,art,cellAsset,{id:'cell',assetId:'cells',x:0,y:0},0,[floor],40,0);
        return [[10,10],[30,10],[10,30]].map(([x,y])=>cellCtx.getImageData(x,y,1,1).data[3]);
      });
      const { drawElevationStair } = await import('/client/render/elevation-art.ts' as string);
      cellCtx.fillStyle='#00ff00';cellCtx.fillRect(0,0,40,40);
      drawElevationStair(cellCtx,{id:'passage',x:0,y:0,width:1,height:1,from:0,to:1,axis:'x',appearance:'passage'},0);
      return {...views,cellViews,passagePixel:[...cellCtx.getImageData(10,10,1,1).data]};
    });
    const hole = [19, 29, 22, 255], red = [255, 0, 0, 255];
    assert.deepEqual(result.zero.plateau, hole); assert.deepEqual(result.zero.upper, hole);
    assert.notDeepEqual(result.zero.plain, hole); assert.notDeepEqual(result.zero.bridge, hole);
    assert.deepEqual(result.one.plain, hole); assert.notDeepEqual(result.one.plateau, hole); assert.deepEqual(result.one.upper, hole);
    assert.notDeepEqual(result.two.upper, hole); assert.deepEqual(result.two.plateau, hole); assert.notDeepEqual(result.two.bridge, hole);
    assert.deepEqual(result.zero.assetBase, red); assert.deepEqual(result.zero.assetTop, result.zero.plain);
    assert.deepEqual(result.two.assetBase, hole); assert.deepEqual(result.two.assetTop, red);
    assert.deepEqual(result.combined.plateau, hole); assert.notDeepEqual(result.combined.upper, hole); assert.notDeepEqual(result.combined.plain, hole);
    assert.deepEqual(result.zero.water, hole); assert.notDeepEqual(result.negative.water, hole); assert.notDeepEqual(result.negative.lower, hole);
    assert.ok(Object.values(result.empty).every(pixel => JSON.stringify(pixel) === JSON.stringify(hole)));
    assert.deepEqual(result.restored, result.all);
    assert.deepEqual(result.cellViews,[[0,0,255],[255,0,0],[0,255,0]]);
    assert.deepEqual(result.passagePixel,[0,255,0,255]);
  } finally { await browser?.close(); await server.close(); }
});
