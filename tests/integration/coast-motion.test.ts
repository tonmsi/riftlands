import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('coastal bands animate over cached terrain, remain in water and honour all motion controls',{timeout:60_000},async()=>{
  const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage({viewport:{width:700,height:420}}),errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));await page.addInitScript('window.__name=value=>value');
    await page.route('**/motion-review',route=>route.fulfill({contentType:'text/html',body:'<body style="margin:0;background:#17211b"><canvas width="500" height="220" style="width:500px;height:220px"></canvas></body>'}));
    await page.goto(server.resolvedUrls!.local[0]+'motion-review');
    const result=await page.evaluate(async()=>{
      const { TerrainRenderer }=await import('/client/render/terrain-renderer.ts' as string);
      const { World }=await import('/shared/world.ts' as string);
      const { newWorldDocument }=await import('/shared/world-schema.ts' as string);
      const { defaultWorldPainting,DEFAULT_WATER_COAST,defaultCoastMotion }=await import('/shared/world-painting.ts' as string);
      const canvas=document.querySelector('canvas')!,ctx=canvas.getContext('2d',{willReadFrequently:true})!;
      const draft=newWorldDocument();
      for(let y=-32;y<=32;y++)for(let x=-40;x<=40;x++)draft.tiles.push({x,y,terrain:y<0?'water':'grass'});
      draft.zones.push({id:'warm',name:'Warm',priority:1,shape:{kind:'rect',x:-50,y:-50,width:100,height:100},temperature:1,moisture:.3});
      const motion={...defaultCoastMotion(),amplitude:8};
      const setup=(settings=motion)=>{
        const painting=defaultWorldPainting();painting.materials.water.intensity=0;painting.materials.grass.intensity=0;
        painting.waterCoast={...DEFAULT_WATER_COAST,automatic:false,noise:0,feather:0,shallows:0,motion:settings};
        const world=new World(42,160,'world',{...draft,painting},[]),terrain=new TerrainRenderer(ctx);
        let builds=0;const original=terrain.drawTerrain.bind(terrain);terrain.drawTerrain=(...args:unknown[])=>{builds++;return original(...args);};
        const view={camera:{x:0,y:0},width:canvas.width,height:canvas.height,dpr:1,zoom:1};
        const draw=(time:number)=>{ctx.setTransform(1,0,0,1,view.width/2-view.camera.x,view.height/2-view.camera.y);terrain.drawCachedTerrain(world,view,time);};
        const image=()=>canvas.toDataURL(),pixel=(x:number,y:number)=>[...ctx.getImageData(x,y,1,1).data];
        return {draw,image,pixel,terrain,world,view,builds:()=>builds};
      };
      const scene=setup();scene.draw(0);const first=scene.image(),initialCache=scene.terrain.terrainCache.canvas.toDataURL();
      const land=scene.pixel(200,160),deep=scene.pixel(200,20);
      scene.draw(1000);const second=scene.image(),landAfter=scene.pixel(200,160),deepAfter=scene.pixel(200,20);
      scene.draw(1000);const repeat=scene.image();
      const initialBuilds=scene.builds(),times:number[]=[];
      for(let i=0;i<120;i++){const start=performance.now();scene.draw(i*16);times.push(performance.now()-start);}
      times.sort((a,b)=>a-b);
      const animation={changed:first!==second,reproducible:second===repeat,land,landAfter,deep,deepAfter,
        cacheUnchanged:initialCache===scene.terrain.terrainCache.canvas.toDataURL(),rebuilds:scene.builds()-initialBuilds,
        medianMs:times[60],p95Ms:times[Math.ceil(times.length*.95)-1],geometry:scene.terrain.maskedTerrain.motion.stats};
      scene.view.camera.x=230;scene.draw(700);const scrolled=ctx.getImageData(0,0,500,220).data;
      scene.terrain.invalidate();scene.draw(700);const rebuilt=ctx.getImageData(0,0,500,220).data;
      let scrollDifferences=0;for(let i=0;i<scrolled.length;i++)if(Math.abs(scrolled[i]-rebuilt[i])>2)scrollDifferences++;
      const stableModes=[];
      for(const override of [{enabled:false},{amplitude:0},{speed:0},{bands:[]},{bands:[{...motion.bands[0],width:0}]}]){
        const s=setup({...motion,...override});s.draw(0);const a=s.image();s.draw(2300);stableModes.push(a===s.image());
      }
      const same=setup();same.draw(1000);const sameSeed=second===same.image();
      const other=setup({...motion,seed:motion.seed+1});other.draw(1000);const seedChanges=second!==other.image();
      const narrow=setup({...motion,amplitude:0,bands:[{width:20,color:'#ffffff',opacity:.6,softness:1}]});narrow.draw(0);const narrowPixel=narrow.pixel(200,30);
      const wide=setup({...motion,amplitude:0,bands:[{width:180,color:'#ffffff',opacity:.6,softness:1}]});wide.draw(0);const widePixel=wide.pixel(200,30);
      const offscreen=setup({...motion,amplitude:0,bands:[{width:512,color:'#ffffff',opacity:.6,softness:1}]});
      offscreen.view.camera.y=-500;offscreen.draw(0);const offscreenPixel=offscreen.pixel(250,110);
      const offscreenBase=setup({...motion,enabled:false});offscreenBase.view.camera.y=-500;offscreenBase.draw(0);const offscreenBasePixel=offscreenBase.pixel(250,110);
      const stress=setup({...motion,amplitude:128,bands:Array.from({length:12},(_,i)=>({width:512-i*20,color:'#d9eee3',opacity:.15,softness:16}))});
      stress.draw(0);const stressStart=performance.now();for(let i=0;i<20;i++)stress.draw(i*50);const stressMeanMs=(performance.now()-stressStart)/20;
      // Include a synchronous pixel read to expose deferred Canvas work; the
      // result includes readback overhead and is not a full game/GPU benchmark.
      canvas.width=1280;canvas.height=720;const completed=[];
      for(const [label,settings] of [['off',{...motion,enabled:false}],['default',motion],['maximum',stress.world.authoring.document.painting!.waterCoast!.motion!]] as const){
        const s=setup(settings);s.draw(0);ctx.getImageData(0,0,1,1);const samples=[];
        for(let i=0;i<30;i++){const start=performance.now();s.draw(i*50);ctx.getImageData(0,0,1,1);samples.push(performance.now()-start);}
        samples.sort((a,b)=>a-b);completed.push({label,medianMs:samples[15],p95Ms:samples[28]});
      }
      canvas.width=500;canvas.height=220;
      const { drawWorldEditorMap }=await import('/client/editors/world/world-editor-canvas.ts' as string);
      const editor=setup(),options={painting:true,grid:false,cells:false,zones:false,npcs:false,selected:null,gesture:null,pointerTile:null,tool:'pan'};
      const view={x:250,y:110,scale:24};
      const editorAnimated=drawWorldEditorMap(canvas,editor.world,editor.world.authoring.document,view,{} as any,options);
      const editorFirst=canvas.toDataURL();await new Promise(r=>setTimeout(r,150));
      drawWorldEditorMap(canvas,editor.world,editor.world.authoring.document,view,{} as any,options);
      return {animation,scrollDifferences,stableModes,sameSeed,seedChanges,narrowPixel,widePixel,offscreenPixel,offscreenBasePixel,stressMeanMs,completed,editorAnimated,editorChanges:editorFirst!==canvas.toDataURL()};
    });
    assert.ok(result.animation.changed);assert.ok(result.animation.reproducible);assert.ok(result.animation.cacheUnchanged);
    assert.equal(result.animation.rebuilds,0);assert.equal(result.animation.geometry.extraCanvases,0);
    assert.deepEqual(result.animation.land,result.animation.landAfter);assert.deepEqual(result.animation.deep,result.animation.deepAfter);
    assert.ok(result.animation.p95Ms<16,'default animation CPU submit stays within one frame in this fixture');
    assert.ok(result.stableModes.every(Boolean));assert.ok(result.sameSeed&&result.seedChanges);
    assert.notDeepEqual(result.narrowPixel,result.widePixel);assert.ok(result.scrollDifferences<500);
    assert.notDeepEqual(result.offscreenPixel,result.offscreenBasePixel,'a very broad band remains visible when its coast is outside the terrain cache');
    assert.ok(result.editorAnimated&&result.editorChanges,'World Maker repaints motion while the camera is stationary');
    assert.deepEqual(errors,[]);mkdirSync('artifacts',{recursive:true});
    writeFileSync('artifacts/coast-motion-performance.json',JSON.stringify(result,null,2));
    await page.screenshot({path:'artifacts/coast-motion-preview.png'});console.log('Coast motion:',result);
  }finally{await browser?.close();await server.close();}
});
