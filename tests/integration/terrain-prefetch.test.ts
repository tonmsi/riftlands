import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';

test('hunter terrain is prepared across frames without revealing unfinished pixels or retaining cancelled canvases',{timeout:60_000},async()=>{
  const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage();await page.addInitScript('window.__name=value=>value');
    await page.route('**/prefetch-review',r=>r.fulfill({contentType:'text/html',body:'<canvas width="720" height="360"></canvas>'}));
    await page.goto(server.resolvedUrls!.local[0]+'prefetch-review');
    const result=await page.evaluate(async()=>{
      const {TerrainRenderer}=await import('/client/render/terrain-renderer.ts' as string);
      const {World}=await import('/shared/world.ts' as string);
      const {newWorldDocument}=await import('/shared/world-schema.ts' as string);
      const {defaultWorldPainting,DEFAULT_WATER_COAST}=await import('/shared/world-painting.ts' as string);
      const canvas=document.querySelector('canvas')!,ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:true})!;
      const doc=newWorldDocument();doc.painting=defaultWorldPainting();doc.painting.waterCoast={...DEFAULT_WATER_COAST};
      for(let y=-50;y<80;y++)for(let x=-50;x<80;x++)doc.tiles.push({x,y,terrain:(x%12+12)%12<4?'water':y%11<3?'path':'grass'});
      const world=new World(42,160,'world',doc,[]),terrain=new TerrainRenderer(ctx,undefined,'always'),view={camera:{x:0,y:0},width:480,height:240,dpr:1.5,zoom:.8};
      const adaptive=new TerrainRenderer(ctx),nativeNow=performance.now.bind(performance);let clock=0;
      const adaptiveDraw=adaptive.drawTerrain.bind(adaptive);
      adaptive.drawTerrain=(...args:unknown[])=>{const result=adaptiveDraw(...args);clock+=12;return result;};
      let initiallyDisabled=false,enabledAfterSlowScroll=false;
      try{
        // Deterministic clock simulates a costly update, without busy-waiting.
        performance.now=()=>clock;adaptive.drawCachedTerrain(world,view,1000);
        initiallyDisabled=!adaptive.performanceInfo().preparation.enabled;
        view.camera.x=230;adaptive.drawCachedTerrain(world,view,1000);
        enabledAfterSlowScroll=adaptive.performanceInfo().preparation.enabled;
      }finally{performance.now=nativeNow;adaptive.dispose();view.camera.x=0;}
      let calls=0,maxCalls=0;const original=terrain.drawTerrain.bind(terrain);
      terrain.drawTerrain=(...args:unknown[])=>{calls++;return original(...args);};
      const owned=new Set<HTMLCanvasElement>(),comparisons=[];let partialFrames=0;
      const draw=()=>{ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#91ad69';ctx.fillRect(0,0,720,360);
        ctx.setTransform(1.2,0,0,1.2,360-view.camera.x*1.2,180-view.camera.y*1.2);terrain.drawCachedTerrain(world,view,1000);};
      draw();
      for(let i=0;i<240;i++){
        const direction=i<160?1:-1;
        view.camera.x+=direction*610*.8/60;view.camera.y+=direction*610*.6/60;
        calls=0;draw();maxCalls=Math.max(maxCalls,calls);
        for(const c of [terrain.terrainCache?.canvas,terrain.preparation?.cache.canvas,terrain.spareCanvas])if(c)owned.add(c);
        if(terrain.preparation)partialFrames++;
        if([32,65,110,159,180,239].includes(i)){
          const actual=ctx.getImageData(0,0,720,360).data;
          const reference=new TerrainRenderer(ctx);ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#91ad69';ctx.fillRect(0,0,720,360);
          ctx.setTransform(1.2,0,0,1.2,360-view.camera.x*1.2,180-view.camera.y*1.2);reference.drawCachedTerrain(world,view,1000);
          const expected=ctx.getImageData(0,0,720,360).data;let differences=0;
          for(let p=0;p<actual.length;p++)if(Math.abs(actual[p]-expected[p])>2)differences++;
          comparisons.push({frame:i,differences,channels:actual.length});reference.dispose();
        }
      }
      const prepared=terrain.performanceInfo().preparation;
      // Force cancellation while work is pending, then rebuild at a new scale.
      for(let i=0;i<50&&!terrain.preparation;i++){view.camera.x+=10;draw();}
      const cancelled=terrain.preparation?.cache.canvas;terrain.invalidate();
      const cancellationReleased=!cancelled||cancelled.width===0;
      view.zoom=1;draw();view.camera.x+=5000;draw();
      const teleported=!!terrain.terrainCache&&!terrain.preparation;
      for(const c of [terrain.terrainCache?.canvas,terrain.preparation?.cache.canvas,terrain.spareCanvas])if(c)owned.add(c);
      terrain.dispose();
      return {maxCalls,partialFrames,prepared,comparisons,cancellationReleased,teleported,released:[...owned].every(c=>c.width===0),initiallyDisabled,enabledAfterSlowScroll};
    });
    console.log('Distributed terrain',result);
    assert.ok(result.partialFrames>0&&result.prepared.swaps>3);assert.equal(result.prepared.fallbacks,0);
    assert.equal(result.maxCalls,1,'normal movement paints at most one new slice per frame');
    for(const c of result.comparisons)assert.ok(c.differences<c.channels*.001,JSON.stringify(c));
    assert.ok(result.cancellationReleased&&result.teleported&&result.released);
    assert.ok(result.initiallyDisabled&&result.enabledAfterSlowScroll);
  }finally{await browser?.close();await server.close();}
});
