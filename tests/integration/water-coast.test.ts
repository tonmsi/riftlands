import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('natural coasts stay continuous, deterministic, feathered and cached', {timeout:60_000},async()=>{
  const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage({viewport:{width:1100,height:800}}),errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));await page.addInitScript('window.__name = value => value');
    await page.route('**/coast-review',route=>route.fulfill({contentType:'text/html',body:'<body style="margin:0;background:#17211b"><canvas width="960" height="640"></canvas></body>'}));
    await page.goto(server.resolvedUrls!.local[0]+'coast-review');
    const geometry=await page.evaluate(async()=>{
      const { PaintedTerrain }=await import('/client/render/painted-terrain.ts' as string);
      const { defaultWorldPainting,DEFAULT_WATER_COAST }=await import('/shared/world-painting.ts' as string);
      const canvas=document.createElement('canvas');canvas.width=500;canvas.height=220;
      const ctx=canvas.getContext('2d',{willReadFrequently:true})!,terrain=new PaintedTerrain();
      const p=defaultWorldPainting();p.materials.water.color='#205080';p.materials.grass.color='#90b050';
      p.waterCoast={...DEFAULT_WATER_COAST,noise:6,noiseScale:4,feather:0,shallows:0,seed:1};
      const world={seed:42,authoringRevision:0,getTemperature:()=>1,getTile:(_x:number,y:number)=>y<0?'water':'grass'};
      const art={draw(){},drawSnowFringe(){},paintWater(){},paintGround(){}};
      const draw=(painting:any,time=0)=>{
        ctx.setTransform(1,0,0,1,.37,100.29);
        terrain.draw(ctx,{left:0,top:-100,right:550,bottom:120},painting,art,(_x:number,y:number)=>y<0?'water':'grass',()=> '#90b050',world);
        return canvas.toDataURL();
      };
      const first=draw(p),second=draw(p,10000),pixels=ctx.getImageData(0,0,500,220).data;
      const stats=terrain.coasts.stats;
      const heights:number[]=[];
      for(let x=0;x<500;x++){
        let height=0;for(let y=75;y<125;y++){const i=(y*500+x)*4;if(pixels[i]>120&&pixels[i+1]>140){height=y;break;}}heights.push(height);
      }
      let largestJump=0;for(let i=1;i<heights.length;i++)largestJump=Math.max(largestJump,Math.abs(heights[i]-heights[i-1]));
      const manual=structuredClone(p);manual.maskShapes={12:{smooth:false,curves:[[{x:.3,y:.3},{x:.6,y:.7}]]}};
      const manualOn=draw(manual),manualOff=draw({...manual,waterCoast:{...manual.waterCoast,enabled:false}});
      const flat={...p,waterCoast:{...p.waterCoast,automatic:false,noise:0}};
      draw(flat);const before=[...ctx.getImageData(100,98,1,1).data],deep=[...ctx.getImageData(100,40,1,1).data],land=[...ctx.getImageData(100,125,1,1).data];
      const feather={...flat,waterCoast:{...flat.waterCoast,feather:6,shallows:16}};
      draw(feather);const after=[...ctx.getImageData(100,98,1,1).data],deepAfter=[...ctx.getImageData(100,40,1,1).data],landAfter=[...ctx.getImageData(100,125,1,1).data];
      const shades=new Set<string>();for(let y=80;y<100;y++)shades.add([...ctx.getImageData(100,y,1,1).data].join(','));
      return {deterministic:first===second,range:Math.max(...heights)-Math.min(...heights),largestJump,
        manualPreserved:manualOn===manualOff,before,after,deep,deepAfter,land,landAfter,shades:shades.size,stats};
    });
    assert.ok(geometry.deterministic);assert.ok(geometry.range>=2,'noise varies over a broad coastline: '+JSON.stringify(geometry));
    assert.ok(geometry.largestJump<=2,'adjacent patches have no visible step at their shared edge');
    assert.ok(geometry.manualPreserved,'hand-edited masks override automatic geometry');
    assert.ok(geometry.after[0]>geometry.before[0]+30,'the water edge blends towards the shore color');
    assert.deepEqual(geometry.deep,geometry.deepAfter);assert.deepEqual(geometry.land,geometry.landAfter);
    assert.ok(geometry.shades>=5,'the edge contains multiple gradual color levels');
    assert.equal(geometry.stats.extraCanvases,0);assert.ok(geometry.stats.patches<=512&&geometry.stats.gradients<=1024);
    const performance=await page.evaluate(async()=>{
      const { TerrainRenderer }=await import('/client/render/terrain-renderer.ts' as string);
      const { World }=await import('/shared/world.ts' as string);
      const { newWorldDocument }=await import('/shared/world-schema.ts' as string);
      const { defaultWorldPainting,DEFAULT_WATER_COAST }=await import('/shared/world-painting.ts' as string);
      const canvas=document.querySelector('canvas')!,ctx=canvas.getContext('2d',{willReadFrequently:true})!,documentData=newWorldDocument();
      for(let y=-16;y<=16;y++)for(let x=-20;x<=20;x++)documentData.tiles.push({x,y,terrain:Math.hypot(x,y*.85)<7.8?'water':'grass'});
      documentData.zones.push({id:'warm',name:'Warm',priority:1,shape:{kind:'rect',x:-30,y:-30,width:60,height:60},temperature:1,moisture:.3});
      const results=[];
      for(const enabled of [false,true]){
        const painting=defaultWorldPainting();painting.waterCoast={...DEFAULT_WATER_COAST,enabled};
        const world=new World(42,160,'world',{...documentData,painting},[]),terrain=new TerrainRenderer(ctx);
        ctx.setTransform(1,0,0,1,480,320);const bounds={left:-480,top:-320,right:480,bottom:320};
        terrain.drawTerrain(world,0,ctx,bounds);const times=[];
        for(let i=0;i<20;i++){const start=window.performance.now();terrain.drawTerrain(world,i*1000,ctx,bounds);times.push(window.performance.now()-start);}
        let builds=0;const original=terrain.drawTerrain.bind(terrain);terrain.drawTerrain=(...args:unknown[])=>{builds++;return original(...args);};
        const view={camera:{x:0,y:0},width:960,height:640,dpr:1,zoom:1};terrain.drawCachedTerrain(world,view,0);
        const initial=builds,start=window.performance.now();for(let i=0;i<120;i++){view.camera.x+=.5;terrain.drawCachedTerrain(world,view,i*16);}
        const warmMeanMs=(window.performance.now()-start)/120,cache=terrain.terrainCache.canvas;
        times.sort((a,b)=>a-b);
        results.push({enabled,rebuildMedianMs:times[10],rebuildP95Ms:times[Math.ceil(times.length*.95)-1],warmMeanMs,warmRebuilds:builds-initial,
          bitmapPixels:cache.width*cache.height,geometry:terrain.maskedTerrain.coasts.stats});
        if(enabled){ctx.setTransform(1,0,0,1,480,320);terrain.drawTerrain(world,0,ctx,bounds);}
      }
      return results;
    });
    for(const result of performance){assert.equal(result.warmRebuilds,0);assert.ok(result.warmMeanMs<5);assert.equal(result.geometry.extraCanvases,0);}
    assert.equal(performance[0].bitmapPixels,performance[1].bitmapPixels);
    assert.ok(performance[1].rebuildMedianMs<performance[0].rebuildMedianMs*2+5,'coast effects stay within a bounded rebuild budget');
    mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/water-coast-performance.json',JSON.stringify({geometry,performance},null,2));
    await page.screenshot({path:'artifacts/water-coast-preview.png'});console.log('Water coast:',{geometry,performance});assert.deepEqual(errors,[]);
  }finally{await browser?.close();await server.close();}
});
