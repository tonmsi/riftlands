import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';

test('all four sea/mask combinations render independently and invalidate the cached terrain',{timeout:60_000},async()=>{
  const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage();await page.addInitScript('window.__name=value=>value');
    await page.route('**/switch-review',r=>r.fulfill({contentType:'text/html',body:'<canvas width="480" height="240"></canvas>'}));
    await page.goto(server.resolvedUrls!.local[0]+'switch-review');
    const cases=await page.evaluate(async()=>{
      const {TerrainRenderer}=await import('/client/render/terrain-renderer.ts' as string);
      const {World}=await import('/shared/world.ts' as string);
      const {newWorldDocument}=await import('/shared/world-schema.ts' as string);
      const {defaultWorldPainting,DEFAULT_WATER_COAST,defaultCoastMotion}=await import('/shared/world-painting.ts' as string);
      const {performanceLog}=await import('/client/core/performance-log.ts' as string);
      const doc=newWorldDocument();doc.painting=defaultWorldPainting();
      doc.painting.waterCoast={...DEFAULT_WATER_COAST,automatic:false,motion:{...defaultCoastMotion(),amplitude:8}};
      for(let y=-20;y<=20;y++)for(let x=-20;x<=20;x++)doc.tiles.push({x,y,terrain:y<0?'water':x<0?'grass':'path'});
      const world=new World(42,160,'world',doc,[]),canvas=document.querySelector('canvas')!,ctx=canvas.getContext('2d',{willReadFrequently:true})!;
      const terrain=new TerrainRenderer(ctx),view={camera:{x:0,y:0},width:480,height:240,dpr:1,zoom:1};
      const results=[];let previousCache:HTMLCanvasElement|undefined;
      const image=()=>Array.from(ctx.getImageData(0,0,480,240).data).join(',');
      for(const seaEnabled of [true,false])for(const masksEnabled of [true,false]){
        world.authoring.document.painting={...world.authoring.document.painting,seaEnabled,masksEnabled};
        performanceLog.start({},0);
        const draw=(time:number)=>{ctx.setTransform(1,0,0,1,240,120);performanceLog.beginFrame(performance.now(),60);
          terrain.drawCachedTerrain(world,view,time);performanceLog.endFrame();};
        draw(0);const first=image(),cache=terrain.terrainCache!.canvas;
        const deep=Array.from(ctx.getImageData(210,10,1,1).data);
        draw(1500);const second=image();
        const report=performanceLog.report();performanceLog.stop();
        results.push({seaEnabled,masksEnabled,animated:first!==second,deep,
          masksRun:report.frames.some((f:any)=>'masks-geometry' in f.phases),
          state:report.summary.lastState,cacheChanged:cache!==previousCache,png:canvas.toDataURL()});
        previousCache=cache;
      }
      terrain.dispose();return results;
    });
    mkdirSync('artifacts',{recursive:true});
    for(const c of cases){
      assert.equal(c.animated,c.seaEnabled,JSON.stringify({...c,png:undefined}));
      assert.equal(c.masksRun,c.masksEnabled);assert.ok(c.cacheChanged);
      assert.equal(c.state.paintingSeaEnabled,c.seaEnabled);assert.equal(c.state.paintingMasksEnabled,c.masksEnabled);
      if(!c.seaEnabled)assert.deepEqual(c.deep,[69,160,173,255]);
      writeFileSync(`artifacts/painting-sea-${c.seaEnabled?'on':'off'}-masks-${c.masksEnabled?'on':'off'}.png`,Buffer.from(c.png.split(',')[1],'base64'));
    }
  }finally{await browser?.close();await server.close();}
});
