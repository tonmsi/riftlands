import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('client preferences mirror and persist; bushes sway and procedural fires become cached stills while sprite animations remain active', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 } }), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message)); await page.addInitScript('window.__name = value => value');
    await page.route('**/environment-review', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"><div data-hub-panel="settings"></div><div class="settings-actions"></div></div><canvas width="200" height="200"></canvas>' }));
    const url = `${server.resolvedUrls!.local[0]}environment-review`; await page.goto(url);
    const result = await page.evaluate(async () => {
      const { WorldAssetArt } = await import('/client/render/world-asset-art.ts' as string);
      const { newWorldAsset, resizeWorldAsset } = await import('/shared/world-schema.ts' as string);
      const { ActorSpriteRenderer } = await import('/client/render/actor-sprite-renderer.ts' as string);
      const { ACTOR_CATALOG } = await import('/shared/actor-catalog.ts' as string);
      const { applyBushWind } = await import('/client/render/bush-wind.ts' as string);
      const { installEnvironmentOptions, readEnvironmentAnimations } = await import('/client/controls/environment-options.ts' as string);
      const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!, art = new WorldAssetArt();
      const bush = newWorldAsset('bush', 'Cespuglio', '/world-assets/bush.png'); resizeWorldAsset(bush, 2, 2); await art.ready(bush);
      const fire = newWorldAsset('fire', 'Braciere', '/world-assets/brazier.svg'); fire.visual = { kind: 'fire', style: 'brazier' }; resizeWorldAsset(fire, 2, 2);
      const placement = { id: 'one', assetId: bush.id, x: 1, y: 1 };
      const shot = (a: any, time: number, js = false) => {
        ctx.clearRect(0, 0, 200, 200); art.draw(ctx, a, { ...placement, assetId: a.id, bushJs: js }, 1, 48, time); return canvas.toDataURL();
      };
      art.setAmbientAnimations(true);
      const movingBush = shot(bush, 500) !== shot(bush, 1500), movingJs = shot(bush, 500, true) !== shot(bush, 1500, true);
      const movingFire = shot(fire, 500) !== shot(fire, 1500);
      ctx.save(); applyBushWind(ctx, 144, 1500, .3); const base = ctx.getTransform().transformPoint({ x: 96, y: 144 }); ctx.restore();
      let enabled = true;
      installEnvironmentOptions(document.querySelector('#root')!, readEnvironmentAnimations(), (on: boolean) => { enabled = on; art.setAmbientAnimations(on); });
      (window as any).readEnvironmentAnimations = readEnvironmentAnimations;
      const inputs = [...document.querySelectorAll<HTMLInputElement>('[data-environment-animations]')];
      inputs[0].click();
      const mirrored = !inputs[1].checked && !enabled;
      const stillBush = shot(bush, 500) === shot(bush, 1500), stillJs = shot(bush, 500, true) === shot(bush, 1500, true);
      const stillFire = shot(fire, 500) === shot(fire, 1500), revision = art.revision;
      for (let i = 0; i < 30; i++) shot(fire, i * 100);
      const cachedFire = art.revision === revision;
      const sprites = new ActorSpriteRenderer(), visual = ACTOR_CATALOG.skins['npc-old-fisher']; await sprites.prepare(visual);
      const actorShot = (elapsed: number) => { ctx.clearRect(0,0,200,200); ctx.save();ctx.translate(100,100); const drawn=sprites.draw(ctx,visual,{name:'moving',elapsed},2);ctx.restore();return { drawn, pixels: canvas.toDataURL() }; };
      const a = actorShot(0), b = actorShot(130);
      return { movingBush, movingJs, movingFire, mirrored, stillBush, stillJs, stillFire, cachedFire, base: { x: base.x, y: base.y }, sprites: a.drawn && b.drawn && a.pixels !== b.pixels };
    });
    assert.deepEqual(result, { movingBush: true, movingJs: true, movingFire: true, mirrored: true, stillBush: true, stillJs: true, stillFire: true, cachedFire: true, base: { x: 96, y: 144 }, sprites: true });
    await page.reload();
    const saved = await page.evaluate(async () => { const { readEnvironmentAnimations } = await import('/client/controls/environment-options.ts' as string); return readEnvironmentAnimations(); });
    assert.equal(saved, false); assert.deepEqual(errors, []);
    const terrain = await page.evaluate(async () => {
      const { Renderer } = await import('/client/render/render.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const { TerrainRenderer } = await import('/client/render/terrain-renderer.ts' as string);
      const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
      const doc = newWorldDocument(); for(let y=-12;y<12;y++)for(let x=-12;x<12;x++)doc.tiles.push({x,y,terrain:x===0&&y===0?'bush':'grass',suppressAssets:true,...(x===0&&y===0?{bushStyle:'js'}:{})});
      const world = new World(42,16,'world',doc,[]), terrain: any = new TerrainRenderer(ctx); await terrain.spritesReady;
      terrain.configureGameAnimations(true);
      const draw = (time:number) => {ctx.clearRect(0,0,200,200);ctx.save();ctx.translate(60,60);terrain.drawCachedTerrain(world,{camera:{x:40,y:40},width:200,height:200,dpr:1,zoom:1},time);ctx.restore();return canvas.toDataURL();};
      const wind = draw(500) !== draw(1500), groups = terrain.legacyBushes.size;
      terrain.configureGameAnimations(false); const still = draw(500) === draw(1500);
      let waves = 0; terrain.maskedTerrain.motion.draw = () => { waves++; return true; }; terrain.drawCoastMotion(ctx,{left:0,top:0,right:200,bottom:200},2000);
      terrain.dispose();
      canvas.style.cssText = 'width:200px;height:200px'; const r: any = new Renderer(canvas, []); await r.spritesReady; r.world = world; r.setAmbientAnimations(false);
      let rainCalls = 0; const rain = r.drawRain.bind(r); r.drawRain=(...args:any[])=>{rainCalls++;rain(...args);};
      r.drawStaticPrecipitation('rain',1); r.drawStaticPrecipitation('rain',1);
      const projectileTimes: number[] = []; r.drawProjectile = (_:any,time:number)=>projectileTimes.push(time);
      for(const time of [2000,2200])r.render({time,self:null,actors:[],projectiles:[{id:'shot',x:0,y:0,radius:5,ownerId:'player',vx:0,vy:0,damage:5,expiresAt:9999,color:'#fff'}],pickups:[],traps:[],events:[],selectedId:null,previewClass:'warrior',playing:true});
      r.destroy(); return {wind,groups,still,waves,rainCalls,projectileTimes};
    });
    assert.ok(terrain.wind && terrain.groups > 0 && terrain.still); assert.equal(terrain.waves, 0);
    assert.equal(terrain.rainCalls, 1); assert.deepEqual(terrain.projectileTimes, [2000,2200]); assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
