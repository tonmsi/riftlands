import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('game renderer draws authored layers around players and fades overhead cells without marking the player hidden', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } }), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message)); await page.addInitScript('window.__name = value => value');
    await page.route('**/world-render-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas style="width:900px;height:700px"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}world-render-review`);
    const result = await page.evaluate(async () => {
      const { Renderer } = await import('/client/render/render.ts' as string), { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument, newWorldAsset, resizeWorldAsset } = await import('/shared/world-schema.ts' as string);
      const document = newWorldDocument(), roof = newWorldAsset('roof', 'Chioma', '/world-assets/bush.svg'), floor = newWorldAsset('floor', 'Sfondo', '/world-assets/waystone.svg');
      resizeWorldAsset(roof, 2, 2); roof.cells[2].visibility = 'fade'; roof.cells[1].visibility = 'hide'; floor.layer = 'ground';
      document.zones.push({ id: 'docks', name: 'Southern Docks', priority: 20, shape: { kind: 'rect', x: -3, y: -3, width: 6, height: 6 }, pvp: false });
      document.assets.push(roof, floor); document.placements.push({ id: 'roof-1', assetId: roof.id, x: 0, y: 0 }, { id: 'floor-1', assetId: floor.id, x: 0, y: 0 });
      for (let y = -4; y < 5; y++) for (let x = -4; x < 5; x++) document.tiles.push({ x, y, terrain: 'grass' });
      const renderer = new Renderer(window.document.querySelector('canvas')!); await renderer.spritesReady; renderer.weather = 'clear';
      renderer.world = new World(42, 16, 'world', document, []);
      const player = { id: 'self', kind: 'player', x: 24, y: 72, name: 'Prova', classId: 'warrior', radius: 15, hp: 100, maxHp: 100, resource: 100, maxResource: 100, aim: 0, speed: 200, level: 1, xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
      const trace: { id: string; opacity?: number; time?: number; fade?: number }[] = [], assetDraw = renderer.worldAssetArt.draw.bind(renderer.worldAssetArt), actorDraw = renderer.characters.drawActor.bind(renderer.characters);
      renderer.worldAssetArt.draw = (...args: any[]) => { trace.push({ id: args[2].id, opacity: args[3] ?? 1, time: args[5], fade: args[6] }); assetDraw(...args); };
      renderer.characters.drawActor = (...args: any[]) => { trace.push({ id: args[0].id }); actorDraw(...args); };
      const frame = { time: 1000, self: player, actors: [player], projectiles: [], pickups: [], traps: [], events: [], selectedId: null, previewClass: 'warrior', playing: true };
      renderer.render(frame); trace.length = 0; renderer.render({ ...frame, time: 1300 }); const faded = [...trace];
      trace.length = 0; Object.assign(player, { x: 72, y: 24, hidden: true }); renderer.render({ ...frame, time: 1400 }); const hiding = [...trace];
      const hiddenByWorld = renderer.world.isHiding(72, 24), fadeHiddenByWorld = renderer.world.isHiding(24, 72);
      let rects = 0; const rect = renderer.ctx.rect.bind(renderer.ctx); renderer.ctx.rect = (...args: number[]) => { rects++; rect(...args); };
      renderer.drawWorldZones(1400); renderer.ctx.rect = rect;
      const location = renderer.world.locationAt(24, 72);
      renderer.destroy(); return { faded, hiding, hiddenByWorld, fadeHiddenByWorld, rects, location };
    });
    assert.equal(result.faded.find(e => e.id === 'floor-1')!.opacity, 1); assert.ok(result.faded.find(e => e.id === 'roof-1')!.fade! > .99);
    assert.equal(result.rects, 0); assert.equal(result.location, 'Southern Docks');
    assert.ok(result.faded.findIndex(e => e.id === 'floor-1') < result.faded.findIndex(e => e.id === 'self'));
    assert.ok(result.faded.findIndex(e => e.id === 'self') < result.faded.findIndex(e => e.id === 'roof-1'));
    assert.equal(result.hiding.find(e => e.id === 'roof-1')!.opacity, 1); assert.equal(result.hiddenByWorld, true); assert.equal(result.fadeHiddenByWorld, false);
    assert.equal(result.faded.find(e => e.id === 'floor-1')!.time, 1300);
    assert.equal(result.hiding.find(e => e.id === 'roof-1')!.time, 1400);
    await page.route('**/world-assets/fade-test.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#659045"/></svg>' }));
    const partial = await page.evaluate(async () => {
      const { WorldAssetArt } = await import('/client/render/world-asset-art.ts' as string), { newWorldAsset, resizeWorldAsset } = await import('/shared/world-schema.ts' as string);
      const a = newWorldAsset('partial', 'Chioma e tronco', '/world-assets/fade-test.svg'); resizeWorldAsset(a, 2, 2);
      a.cells[0].visibility = 'fade'; a.cells[1].visibility = 'fade'; a.fade = { opacity: .2, feather: .5, durationMs: 200 };
      let loaded!: () => void; const ready = new Promise<void>(resolve => loaded = resolve), art = new WorldAssetArt(() => loaded()); art.image(a); await ready;
      const canvas = window.document.createElement('canvas'); canvas.width = 96; canvas.height = 96; const ctx = canvas.getContext('2d')!;
      const p = { id: 'partial-1', assetId: a.id, x: 0, y: 0 };
      const start = art.fadeAmount(a, p, true, 1000), middle = art.fadeAmount(a, p, true, 1100), end = art.fadeAmount(a, p, true, 1200);
      art.draw(ctx, a, p, 1, 48, 1200, end);
      const alpha = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3];
      const center = alpha(48, 24), seam = alpha(48, 46), opaque = alpha(48, 50), trunk = alpha(48, 72);
      art.fadeAmount(a, p, false, 1300); const restored = art.fadeAmount(a, p, false, 1500);
      a.cells[2].visibility = 'hide-fade';
      ctx.clearRect(0, 0, 96, 96); art.draw(ctx, a, p, 1, 48, 1600, 1, 0);
      const publicFade = { traversable: alpha(24, 24), hiding: alpha(24, 72) };
      ctx.clearRect(0, 0, 96, 96); art.draw(ctx, a, p, 1, 48, 1600, 0, 1);
      const privateFade = { traversable: alpha(24, 24), hiding: alpha(24, 72) };
      return { start, middle, end, center, seam, opaque, trunk, restored, publicFade, privateFade };
    });
    assert.equal(partial.start, 0); assert.ok(partial.middle > 0 && partial.middle < 1); assert.equal(partial.end, 1);
    assert.ok(partial.center < 90); assert.ok(partial.seam > partial.center + 40); assert.equal(partial.opaque, 255); assert.equal(partial.trunk, 255); assert.equal(partial.restored, 0);
    assert.ok(partial.publicFade.traversable < 90); assert.equal(partial.publicFade.hiding, 255);
    assert.equal(partial.privateFade.traversable, 255); assert.ok(partial.privateFade.hiding < 90);
    const overflow = await page.evaluate(async () => {
      const { WorldAssetArt } = await import('/client/render/world-asset-art.ts' as string);
      const { clipAssetCells } = await import('/client/render/asset-cell-regions.ts' as string);
      const { newWorldAsset, resizeWorldAsset } = await import('/shared/world-schema.ts' as string);
      const a = newWorldAsset('overflow', 'Trasformata', '/world-assets/fade-test.svg'); resizeWorldAsset(a, 2, 2);
      a.imageTransform = { x: -.5, y: -.5, scale: 1.5 };
      a.cells[0].visibility = 'fade'; a.cells[2].visibility = 'fade'; a.fade = { opacity: .2, feather: 0, durationMs: 0 };
      const art = new WorldAssetArt(); art.image(a);
      await new Promise<void>((resolve, reject) => {
        const deadline = performance.now() + 5000;
        const check = () => { if (art.image(a)) resolve(); else if (performance.now() > deadline) reject(new Error('Transformed image timeout')); else setTimeout(check, 20); }; check();
      });
      const canvas = window.document.createElement('canvas'); canvas.width = canvas.height = 192;
      const ctx = canvas.getContext('2d')!, p = { id: 'overflow-1', assetId: a.id, x: 1, y: 1 };
      for (const overhead of [false, true]) {
        ctx.save(); clipAssetCells(ctx, a, p, 48, (cell: any) => (cell.visibility !== 'normal') === overhead);
        art.draw(ctx, a, p, 1, 48, 0, 1); ctx.restore();
      }
      const alpha = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3];
      const first = { left: alpha(30, 80), topLeft: alpha(30, 30), right: alpha(160, 80), bottomLeft: alpha(30, 160), bottomRight: alpha(160, 160), outside: alpha(10, 10) };
      // Translation changes which source pixels lie in each cell; mask caches must follow it.
      a.imageTransform.x = .5; ctx.clearRect(0, 0, 192, 192); art.draw(ctx, a, p, 1, 48, 0, 1);
      return { first, shiftedOutside: alpha(30, 80), shiftedOpaque: alpha(100, 80), shiftedFade: alpha(80, 80) };
    });
    for (const value of [overflow.first.left, overflow.first.topLeft, overflow.first.bottomLeft, overflow.shiftedFade]) assert.ok(value >= 49 && value <= 53);
    assert.equal(overflow.first.right, 255); assert.equal(overflow.first.bottomRight, 255); assert.equal(overflow.first.outside, 0);
    assert.equal(overflow.shiftedOutside, 0); assert.equal(overflow.shiftedOpaque, 255);
    const coverage = await page.evaluate(async () => {
      const { Renderer } = await import('/client/render/render.ts' as string), { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument, newWorldAsset, resizeWorldAsset } = await import('/shared/world-schema.ts' as string);
      const results: { layer: string; visibility: string; pvp: boolean; local: boolean; covered: boolean; hiding: boolean }[] = [];
      for (const layer of ['ground', 'object']) for (const visibility of ['normal', 'fade', 'hide', 'hide-fade']) for (const pvp of [false, true]) for (const local of [false, true]) {
        const doc = newWorldDocument(), asset = newWorldAsset('cover', 'Copertura', '/world-assets/fade-test.svg');
        resizeWorldAsset(asset, 3, 3); asset.layer = layer; asset.cells.forEach((c: any) => c.visibility = visibility);
        asset.fade = { opacity: .2, feather: 0, durationMs: 0 }; doc.assets.push(asset);
        doc.placements.push({ id: 'cover-1', assetId: asset.id, x: 0, y: 0 });
        doc.zones.push({ id: 'area', name: 'Area', priority: 1, shape: { kind: 'rect', x: -10, y: -10, width: 20, height: 20 }, pvp });
        for (let y = -10; y < 10; y++) for (let x = -10; x < 10; x++) doc.tiles.push({ x, y, terrain: 'grass' });
        const canvas = window.document.createElement('canvas'); canvas.style.cssText = 'width:900px;height:700px'; window.document.body.append(canvas);
        const renderer = new Renderer(canvas); renderer.world = new World(42, 16, 'world', doc, []);
        const self = { id: 'owner', kind: 'player', x: local ? 72 : -72, y: 72, hp: 100, teamId: null };
        const other = { id: 'other', kind: 'player', x: 72, y: 72, hp: 100, teamId: null };
        renderer.characters.drawActor = (actor: any) => { renderer.ctx.fillStyle = '#ff00ff'; renderer.ctx.fillRect(actor.x - 10, actor.y - 10, 20, 20); };
        renderer.characters.retainMotion = () => {};
        renderer.worldAssetArt.image(asset);
        await new Promise<void>((resolve, reject) => {
          const deadline = performance.now() + 5000;
          const check = () => { if (renderer.worldAssetArt.image(asset)) resolve(); else if (performance.now() > deadline) reject(new Error('Asset load timeout')); else setTimeout(check, 20); }; check();
        });
        renderer.lastWeatherCheck = 1000; renderer.weather = 'clear';
        renderer.render({ time: 1000, self, actors: local ? [self] : [self, other], projectiles: [], pickups: [], traps: [], events: [], selectedId: null, previewClass: 'mage', playing: true });
        const pixel = renderer.ctx.getImageData(Math.round((450 + (72 - self.x) * .95) * renderer.dpr), Math.round(350 * renderer.dpr), 1, 1).data;
        results.push({ layer, visibility, pvp, local, covered: pixel[0] < 150 && pixel[1] > 100, hiding: renderer.world.isHiding(72, 72) });
        renderer.destroy(); canvas.remove();
      }
      return results;
    });
    for (const c of coverage) {
      const expected = c.visibility === 'normal' ? c.layer === 'object'
        : c.visibility === 'hide' ? true
        : c.visibility === 'hide-fade' ? !c.local
        : !c.local && !c.pvp;
      assert.equal(c.covered, expected, JSON.stringify(c));
      assert.equal(c.hiding, c.visibility === 'hide' || c.visibility === 'hide-fade');
    }
    const fires = await page.evaluate(async () => {
      const { WorldAssetArt } = await import('/client/render/world-asset-art.ts' as string);
      const { newWorldAsset } = await import('/shared/world-schema.ts' as string);
      const art = new WorldAssetArt(), canvas = window.document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext('2d')!, results: { style: string; differences: number; pixels: number; alpha: number }[] = [];
      const sources = [
        ['brazier', 'brazier'], ['campfire', 'campfire'],
        ['brazier', 'ddbdb1a40dac723ae93c5f978cedc1c19c6f7efae2f819ce09f37d0cbb6fe65b'],
        ['campfire', '8be2ee9ad348b9996368c35425c71b666d341cf52382cc4208cf1703b008805e'],
      ];
      for (const [style, source] of sources) {
        const asset = newWorldAsset('any-id', 'Qualsiasi nome', `/world-assets/${source}.svg`);
        asset.width = 2; asset.height = 2;
        const placement = { id: 'moved', assetId: asset.id, x: 2, y: 2 };
        art.draw(ctx, asset, placement, .7, 48, 1000); const first = ctx.getImageData(0, 0, 320, 240).data;
        ctx.clearRect(0, 0, 320, 240);
        art.draw(ctx, asset, placement, .7, 48, 1500); const second = ctx.getImageData(0, 0, 320, 240).data;
        let differences = 0, pixels = 0;
        for (let i = 0; i < first.length; i += 4) { if (first[i + 3]) pixels++; if (first[i] !== second[i] || first[i + 3] !== second[i + 3]) differences++; }
        results.push({ style: `${style}:${source}`, differences, pixels, alpha: ctx.globalAlpha }); ctx.clearRect(0, 0, 320, 240);
      }
      return results;
    });
    for (const fire of fires) { assert.ok(fire.differences > 100, `${fire.style} changes over time after move/scale`); assert.ok(fire.pixels > 1000); assert.equal(fire.alpha, 1); }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
