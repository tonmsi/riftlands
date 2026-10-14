import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';

test('packed actor atlas preserves isolated frame pixels at fractional scale and mirrored orientation', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
    const page = await browser.newPage(); await page.addInitScript('window.__name = value => value');
    await page.route('**/efficiency-review', route => route.fulfill({ contentType: 'text/html', body: '<body></body>' }));
    const cells = Array.from({ length: 32 }, (_, i) => `<rect x="${i % 8 * 16}" y="${Math.floor(i / 8) * 16}" width="16" height="16" fill="hsl(${i * 47 % 360},90%,55%)" fill-opacity="${i % 4 === 0 ? 0 : i % 3 === 0 ? .6 : 1}"/><circle cx="${i % 8 * 16 + 8}" cy="${Math.floor(i / 8) * 16 + 8}" r="4" fill="#fff"/>`).join('');
    await page.route('**/sprite-quality.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="64">${cells}</svg>` }));
    await page.goto(`${server.resolvedUrls!.local[0]}efficiency-review`);
    const result = await page.evaluate(async () => {
      const { ActorSpriteRenderer } = await import('/client/render/actor-sprite-renderer.ts' as string);
      const { loadImage } = await import('/client/render/sprite-sheet.ts' as string);
      const { animationFrame } = await import('/client/render/actor-animation.ts' as string);
      const animation = { asset: '/sprite-quality.svg', columns: 8, rows: 4, directional: true, loop: true, frameMs: 100 };
      const visual = { drawSize: 25.3, anchor: { x: .5, y: .8 }, offset: { x: .3, y: -.7 }, shadow: { x: 0, y: 0, width: 1, height: 1, opacity: 0 }, animations: { idle: animation } };
      const sprite = new ActorSpriteRenderer(12); await sprite.prepare(visual);
      const image = await loadImage(animation.asset), frames: HTMLCanvasElement[] = [];
      for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
        const frame = document.createElement('canvas'); frame.width = frame.height = 12;
        frame.getContext('2d')!.drawImage(image, x * 16, y * 16, 16, 16, 0, 0, 12, 12); frames.push(frame);
      }
      const make = () => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 80; return canvas; };
      const a = make(), b = make(), ctxA = a.getContext('2d')!, ctxB = b.getContext('2d')!;
      let changed = 0, total = 0;
      for (const sign of [1, -1]) for (let row = 0; row < 4; row++) for (let column = 0; column < 8; column++) {
        const state = { name: 'idle', elapsed: column * 100 + 1 };
        for (const ctx of [ctxA, ctxB]) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 80, 80); ctx.setTransform(1.25, 0, 0, sign * 1.25, 40.3, 40.7); }
        sprite.draw(ctxA, visual, state, row);
        const bounds = sprite.bounds(visual, animation); ctxB.imageSmoothingEnabled = true; ctxB.imageSmoothingQuality = 'high';
        ctxB.drawImage(frames[animationFrame(animation, state, row)], bounds.x, bounds.y, bounds.width, bounds.height);
        const actual = ctxA.getImageData(0, 0, 80, 80).data, expected = ctxB.getImageData(0, 0, 80, 80).data;
        for (let i = 0; i < actual.length; i++) { if (Math.abs(actual[i] - expected[i]) > 2) changed++; total++; }
      }
      const sheets = [...sprite.sheets.values()];
      return { difference: changed / total, sheets: sheets.length, canvases: sheets.filter((sheet: any) => sheet.atlas instanceof HTMLCanvasElement).length };
    });
    assert.ok(result.difference < .0001, `pixel difference ${result.difference}`);
    assert.equal(result.sheets, 1); assert.equal(result.canvases, 1);
  } finally { await browser?.close(); await server.close(); }
});

test('minimap reuses terrain across cell crossings but invalidates edits, teleports and hidden views', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
    const page = await browser.newPage(); await page.addInitScript('window.__name = value => value');
    await page.route('**/efficiency-review', route => route.fulfill({ contentType: 'text/html', body: '<body><canvas style="width:180px;height:180px"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}efficiency-review`);
    const result = await page.evaluate(async () => {
      const { drawMinimap } = await import('/client/render/minimap.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const world = new World(42, 16, 'world', newWorldDocument(), []), canvas = document.querySelector('canvas')!;
      let queries = 0, terrain = 'grass'; world.getTile = () => { queries++; return terrain; };
      const self: any = { id: 'self', x: -24, y: -24 };
      drawMinimap(canvas, world, self, []); const first = queries;
      for (let i = 0; i < 6; i++) { self.x += 48; drawMinimap(canvas, world, self, []); }
      const reused = queries;
      self.x += 4800; drawMinimap(canvas, world, self, []); const teleported = queries;
      terrain = 'water'; world.authoringRevision++; drawMinimap(canvas, world, self, []); const edited = queries;
      world.lockRevision++; drawMinimap(canvas, world, self, []); const locked = queries;
      canvas.style.display = 'none'; drawMinimap(canvas, world, self, []); const hidden = queries;
      return { first, reused, teleported, edited, locked, hidden };
    });
    assert.ok(result.first > 0); assert.equal(result.reused, result.first);
    assert.ok(result.teleported > result.reused); assert.ok(result.edited > result.teleported);
    assert.ok(result.locked > result.edited); assert.equal(result.hidden, result.locked);
  } finally { await browser?.close(); await server.close(); }
});

test('camera cache reveals incoming artwork and new placements without retaining previous worlds', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } }); await page.addInitScript('window.__name = value => value');
    await page.route('**/efficiency-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas style="width:640px;height:400px"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}efficiency-review`);
    const result = await page.evaluate(async () => {
      const { Renderer } = await import('/client/render/render.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument, newWorldAsset } = await import('/shared/world-schema.ts' as string);
      const doc = newWorldDocument(), asset = newWorldAsset('art', 'Art', '/world-assets/bush.svg');
      asset.imageTransform = { x: -.25, y: -.25, scale: 1.5 }; doc.assets.push(asset);
      doc.placements.push({ id: 'incoming', assetId: asset.id, x: 10, y: 0 });
      for (let y = -18; y <= 18; y++) for (let x = -18; x <= 24; x++) doc.tiles.push({ x, y, terrain: 'grass' });
      const renderer = new Renderer(document.querySelector('canvas')!, []); await renderer.spritesReady;
      renderer.weather = 'clear'; renderer.world = new World(42, 16, 'world', doc, []);
      let queries = 0; const original = renderer.world.assetsIn.bind(renderer.world);
      renderer.world.assetsIn = (bounds: any, artwork = true) => { if (artwork) queries++; return original(bounds, artwork); };
      const self: any = { id: 'self', kind: 'player', classId: 'mage', name: '', x: 0, y: 24, radius: 15, hp: 100,
        maxHp: 100, resource: 100, maxResource: 100, aim: 0, level: 1, xp: 0, effects: [], cooldowns: {}, teamId: null };
      const frame: any = { self, actors: [self], time: 1000, projectiles: [], pickups: [], traps: [], events: [], selectedId: null, previewClass: 'mage', playing: true };
      let drawn: string[] = []; renderer.worldAssetArt.draw = (_ctx: any, _a: any, placement: any) => drawn.push(placement.id);
      const draw = () => { drawn = []; renderer.hasCamera = false; renderer.render(frame); return [...drawn]; };
      const initial = draw(), firstQueries = queries;
      self.x = 96; const moved = draw(), reusedQueries = queries;
      renderer.world.authoring.addPlacement({ id: 'added', assetId: asset.id, x: 2, y: 0 });
      const edited = draw(), editedQueries = queries;
      self.x = 10000; const teleported = draw();
      renderer.world = new World(42, 16, 'world', newWorldDocument(), []); self.x = 96; const changedWorld = draw();
      renderer.destroy(); return { initial, moved, edited, teleported, changedWorld, firstQueries, reusedQueries, editedQueries, released: !renderer.assetView };
    });
    assert.deepEqual(result.initial, []); assert.ok(result.moved.includes('incoming'));
    assert.equal(result.reusedQueries, result.firstQueries); assert.ok(result.editedQueries > result.reusedQueries);
    assert.ok(result.edited.includes('added')); assert.deepEqual(result.teleported, []); assert.deepEqual(result.changedWorld, []);
    assert.equal(result.released, true);
  } finally { await browser?.close(); await server.close(); }
});

test('Vite runtime dungeon import matches the complete catalog and leaves editor imports intact', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const before = await readFile('shared/custom-dungeons.json', 'utf8');
  try {
    await server.listen(); browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
    const page = await browser.newPage(); await page.addInitScript('window.__name = value => value');
    await page.route('**/efficiency-review', route => route.fulfill({ contentType: 'text/html', body: '<body></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}efficiency-review`);
    const response = page.waitForResponse(response => response.url().includes('runtime-dungeons'));
    const result = await page.evaluate(async () => {
      const { INSTALLED_DUNGEON_DEFINITIONS } = await import('/shared/dungeons.ts' as string);
      const { INSTALLED_BOSS_BY_ID } = await import('/shared/bosses.ts' as string);
      const { default: raw } = await import('/shared/custom-dungeons.json' as string);
      const { unpackDungeonCatalog } = await import('/shared/dungeon-storage.ts' as string);
      const complete = unpackDungeonCatalog(raw);
      return { definitions: JSON.stringify(INSTALLED_DUNGEON_DEFINITIONS) === JSON.stringify(complete.map((entry: any) => entry.definition)),
        bosses: JSON.stringify([...INSTALLED_BOSS_BY_ID.values()]) === JSON.stringify(complete.flatMap((entry: any) => entry.bosses)),
        drafts: complete.every((entry: any) => entry.draft?.tiles?.length > 0) };
    });
    const body = await (await response).text();
    assert.ok(!body.includes('"draft":')); assert.ok(body.length < before.length);
    assert.equal(result.definitions, true); assert.equal(result.bosses, true); assert.equal(result.drafts, true);
    assert.equal(await readFile('shared/custom-dungeons.json', 'utf8'), before);
  } finally { await browser?.close(); await server.close(); }
});
