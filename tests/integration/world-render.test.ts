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
      const { Renderer } = await import('/client/render.ts' as string), { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument, newWorldAsset, resizeWorldAsset } = await import('/shared/world-schema.ts' as string);
      const document = newWorldDocument(), roof = newWorldAsset('roof', 'Chioma', '/world-assets/bush.svg'), floor = newWorldAsset('floor', 'Sfondo', '/world-assets/waystone.svg');
      resizeWorldAsset(roof, 2, 2); roof.cells[2].visibility = 'fade'; roof.cells[1].visibility = 'hide'; floor.layer = 'ground';
      document.assets.push(roof, floor); document.placements.push({ id: 'roof-1', assetId: roof.id, x: 0, y: 0 }, { id: 'floor-1', assetId: floor.id, x: 0, y: 0 });
      for (let y = -4; y < 5; y++) for (let x = -4; x < 5; x++) document.tiles.push({ x, y, terrain: 'grass' });
      const renderer = new Renderer(window.document.querySelector('canvas')!); await renderer.spritesReady; renderer.weather = 'clear';
      renderer.world = new World(42, 16, 'world', document, []);
      const player = { id: 'self', kind: 'player', x: 24, y: 72, name: 'Prova', classId: 'warrior', radius: 15, hp: 100, maxHp: 100, resource: 100, maxResource: 100, aim: 0, speed: 200, level: 1, xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
      const trace: { id: string; opacity?: number; time?: number }[] = [], assetDraw = renderer.worldAssetArt.draw.bind(renderer.worldAssetArt), actorDraw = renderer.drawActor.bind(renderer);
      renderer.worldAssetArt.draw = (...args: any[]) => { trace.push({ id: args[2].id, opacity: args[3] ?? 1, time: args[5] }); assetDraw(...args); };
      renderer.drawActor = (...args: any[]) => { trace.push({ id: args[0].id }); actorDraw(...args); };
      const frame = { time: 1000, self: player, actors: [player], projectiles: [], pickups: [], traps: [], events: [], selectedId: null, previewClass: 'warrior', playing: true };
      renderer.render(frame); const faded = [...trace];
      trace.length = 0; Object.assign(player, { x: 72, y: 24, hidden: true }); renderer.render({ ...frame, time: 1100 }); const hiding = [...trace];
      const hiddenByWorld = renderer.world.isHiding(72, 24), fadeHiddenByWorld = renderer.world.isHiding(24, 72);
      renderer.destroy(); return { faded, hiding, hiddenByWorld, fadeHiddenByWorld };
    });
    assert.equal(result.faded.find(e => e.id === 'floor-1')!.opacity, 1); assert.ok(result.faded.find(e => e.id === 'roof-1')!.opacity! < .5);
    assert.ok(result.faded.findIndex(e => e.id === 'floor-1') < result.faded.findIndex(e => e.id === 'self'));
    assert.ok(result.faded.findIndex(e => e.id === 'self') < result.faded.findIndex(e => e.id === 'roof-1'));
    assert.equal(result.hiding.find(e => e.id === 'roof-1')!.opacity, 1); assert.equal(result.hiddenByWorld, true); assert.equal(result.fadeHiddenByWorld, false);
    assert.equal(result.faded.find(e => e.id === 'floor-1')!.time, 1000);
    assert.equal(result.hiding.find(e => e.id === 'roof-1')!.time, 1100);
    const fires = await page.evaluate(async () => {
      const { WorldAssetArt } = await import('/client/world-asset-art.ts' as string);
      const { newWorldAsset } = await import('/shared/world-schema.ts' as string);
      const art = new WorldAssetArt(), canvas = window.document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext('2d')!, results: { style: string; differences: number; pixels: number; alpha: number }[] = [];
      for (const style of ['brazier', 'campfire']) {
        const asset = newWorldAsset('any-id', 'Qualsiasi nome', `/world-assets/${style}.svg`);
        asset.width = 2; asset.height = 2;
        const placement = { id: 'moved', assetId: asset.id, x: 2, y: 2 };
        art.draw(ctx, asset, placement, .7, 48, 1000); const first = ctx.getImageData(0, 0, 320, 240).data;
        ctx.clearRect(0, 0, 320, 240);
        art.draw(ctx, asset, placement, .7, 48, 1500); const second = ctx.getImageData(0, 0, 320, 240).data;
        let differences = 0, pixels = 0;
        for (let i = 0; i < first.length; i += 4) { if (first[i + 3]) pixels++; if (first[i] !== second[i] || first[i + 3] !== second[i + 3]) differences++; }
        results.push({ style, differences, pixels, alpha: ctx.globalAlpha }); ctx.clearRect(0, 0, 320, 240);
      }
      return results;
    });
    for (const fire of fires) { assert.ok(fire.differences > 100, `${fire.style} changes over time after move/scale`); assert.ok(fire.pixels > 1000); assert.equal(fire.alpha, 1); }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
