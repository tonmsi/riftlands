import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('streamed terrain preserves scrolling shorelines and clears stale blocks on edits', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
    const page = await browser.newPage();
    await page.addInitScript('window.__name = value => value');
    await page.route('**/stream-review', route => route.fulfill({ contentType: 'text/html', body: '<body></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}stream-review`);
    const result = await page.evaluate(async () => {
      const { TerrainRenderer } = await import('/client/render/terrain-renderer.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const doc = newWorldDocument();
      for (let y = -24; y <= 24; y++) for (let x = -28; x <= 28; x++) doc.tiles.push({ x, y,
        terrain: Math.abs(y - Math.round(Math.sin(x / 3) * 3)) < 2 ? 'water' : x % 7 === 0 ? 'path' : (x + y) % 5 === 0 ? 'bush' : 'grass' });
      const world = new World(37, 32, 'world', doc, []);
      const make = () => { const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 400; return canvas; };
      const actual = make(), expected = make(), a = actual.getContext('2d')!, b = expected.getContext('2d')!;
      const streaming = new TerrainRenderer(a), baseline = new TerrainRenderer(b);
      await Promise.all([streaming.spritesReady, baseline.spritesReady]);
      const view = { width: 600, height: 400, dpr: 1, zoom: .8, camera: { x: -220.4, y: -110.6 } };
      const draw = (terrain: any, ctx: CanvasRenderingContext2D, stream: boolean) => {
        ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,600,400);
        ctx.setTransform(.8,0,0,.8,300-view.camera.x*.8,200-view.camera.y*.8);
        terrain.drawCachedTerrain(world,view,1000,.8,stream);
      };
      draw(streaming,a,true);
      const comparisons: number[] = [];
      for (const [dx,dy] of [[340,120],[-400,220],[500,-330],[220,250]]) {
        view.camera.x += dx; view.camera.y += dy;
        draw(streaming,a,true); baseline.invalidate(); draw(baseline,b,false);
        const p=a.getImageData(0,0,600,400).data,q=b.getImageData(0,0,600,400).data;
        let different=0;for(let i=0;i<p.length;i++)if(Math.abs(p[i]-q[i])>3)different++;
        comparisons.push(different/p.length);
      }
      const before=actual.toDataURL(); world.getTile=()=> 'snow'; world.authoringRevision++;
      draw(streaming,a,true);
      const edited=actual.toDataURL()!==before;
      const count=streaming.stream.tiles.size;
      streaming.invalidate();
      return {comparisons,edited,count,released:streaming.stream.tiles.size};
    });
    for(const difference of result.comparisons) assert.ok(difference<.003,`streamed blocks differ from complete terrain: ${difference}`);
    assert.ok(result.edited); assert.ok(result.count<=128); assert.equal(result.released,0);
  } finally {await browser?.close();await server.close();}
});
