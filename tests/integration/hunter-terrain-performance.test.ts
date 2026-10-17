import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync,readFileSync,existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('hunter traverses fresh terrain at class speed with repeatable cache and pixel measurements',{timeout:120_000},async()=>{
  const tag=process.env.HUNTER_BENCHMARK_TAG??'current',visual=process.env.HUNTER_VISUAL==='1';
  const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  mkdirSync('artifacts',{recursive:true});
  try{
    await server.listen();browser=await chromium.launch({channel:'chrome',headless:!visual});
    const results=[];
    for(const device of [{name:'phone',width:823,height:384,dpr:2,touch:true},{name:'desktop',width:1670,height:916,dpr:1,touch:false}]){
      const context=await browser.newContext({viewport:{width:device.width,height:device.height},deviceScaleFactor:device.dpr,isMobile:device.touch,hasTouch:device.touch});
      const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript('window.__name=value=>value');
      await page.route('**/hunter-review',route=>route.fulfill({contentType:'text/html',body:`<body style="margin:0;background:#17211b"><canvas style="width:${device.width}px;height:${device.height}px"></canvas></body>`}));
      await page.goto(server.resolvedUrls!.local[0]+'hunter-review');
      const data=await page.evaluate(async policy=>{
        const {Renderer}=await import('/client/render/render.ts' as string);
        const {CLASSES,TILE_SIZE}=await import('/shared/config.ts' as string);
        const canvas=document.querySelector('canvas')!;
        canvas.getContext('2d',{alpha:false,willReadFrequently:true});
        const renderer=new Renderer(canvas);renderer.terrain.preparationPolicy=policy;await renderer.spritesReady;await new Promise(requestAnimationFrame);
        const actor=renderer.previewActors('hunter',200_000)[0];actor.id='hunter-benchmark';actor.classId='hunter';actor.speed=CLASSES.hunter.speed;
        actor.x=renderer.world.authoring.document.spawn.x*TILE_SIZE;actor.y=renderer.world.authoring.document.spawn.y*TILE_SIZE;
        const origin={x:actor.x,y:actor.y},speed=CLASSES.hunter.speed,cacheTimes:number[]=[],frameTimes:number[]=[],completedTimes:number[]=[];
        let builds=0;const original=renderer.terrain.drawTerrain.bind(renderer.terrain);
        renderer.terrain.drawTerrain=(...args:unknown[])=>{const start=performance.now();const result=original(...args);builds++;cacheTimes.push(performance.now()-start);return result;};
        const frame={time:200_000,self:actor,actors:[actor],projectiles:[],pickups:[],traps:[],events:[],selectedId:null,previewClass:'hunter',playing:true,moveDirection:{x:.8,y:.6}};
        renderer.render(frame);await new Promise(r=>setTimeout(r,150));
        cacheTimes.length=0;builds=0;
        for(let i=0;i<720;i++){
          const t=i/60;
          if(t<4){actor.x=origin.x+speed*.8*t;actor.y=origin.y+speed*.6*t;}
          else if(t<8){actor.x=origin.x+speed*3.2+speed*(t-4);actor.y=origin.y+speed*2.4;}
          else{actor.x=origin.x+speed*7.2-speed*.8*(t-8);actor.y=origin.y+speed*2.4+speed*.6*(t-8);}
          frame.time=200_000+i*1000/60;
          // Follow the hunter exactly to keep camera bounds pixel-reproducible
          // across machines. Replay compares work, not real-device FPS.
          renderer.hasCamera=false;
          const start=performance.now();renderer.render(frame);const submitted=performance.now();
          renderer.ctx.getImageData(0,0,1,1);const completed=performance.now();
          frameTimes.push(submitted-start);completedTimes.push(completed-start);
          if(i%60===59)await new Promise(requestAnimationFrame);
        }
        const summary=(times:number[])=>{const sorted=times.slice().sort((a,b)=>a-b);return {count:times.length,mean:times.reduce((a,b)=>a+b,0)/times.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)};};
        await new Promise(r=>setTimeout(r,150));renderer.hasCamera=false;renderer.render(frame);
        const pixels=renderer.ctx.getImageData(0,0,canvas.width,canvas.height).data;let hash=2166136261;
        for(const value of pixels)hash=Math.imul(hash^value,16777619);
        const image=canvas.toDataURL('image/png'),cache=renderer.terrain.terrainCache;
        const result={hunterSpeed:speed,replaySeconds:12,frames:720,buildCalls:builds,cacheDrawMs:summary(cacheTimes),frameSubmitMs:summary(frameTimes),frameWithReadbackMs:summary(completedTimes),
          width:canvas.width,height:canvas.height,dpr:renderer.dpr,zoom:renderer.zoom,cachePixels:cache.canvas.width*cache.canvas.height,
          preparation:renderer.terrain.performanceInfo().preparation,pixelHash:hash>>>0,image};
        renderer.destroy();return result;
      },process.env.HUNTER_PREFETCH==='always'?'always':'adaptive');
      assert.equal(data.frames,720);assert.ok(data.hunterSpeed>=400);assert.ok(data.buildCalls>15);
      const {image,...metrics}=data;
      writeFileSync(`artifacts/hunter-${tag}-${device.name}.png`,Buffer.from(image.split(',')[1],'base64'));
      const baselinePath=`artifacts/hunter-baseline-${device.name}.png`;
      let pixelComparison:unknown=null;
      if(tag!=='baseline'&&existsSync(baselinePath)){
        const previous='data:image/png;base64,'+readFileSync(baselinePath).toString('base64');
        pixelComparison=await page.evaluate(async({previous,current})=>{
          const load=(src:string)=>new Promise<HTMLImageElement>((done,reject)=>{const img=new Image();img.onload=()=>done(img);img.onerror=reject;img.src=src;});
          const [a,b]=await Promise.all([load(previous),load(current)]),canvas=document.createElement('canvas');canvas.width=a.width;canvas.height=a.height;
          const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(a,0,0);const first=ctx.getImageData(0,0,a.width,a.height).data;
          ctx.drawImage(b,0,0);const second=ctx.getImageData(0,0,a.width,a.height).data;let changed=0,maxDelta=0;
          for(let i=0;i<first.length;i++){const delta=Math.abs(first[i]-second[i]);if(delta>2)changed++;maxDelta=Math.max(maxDelta,delta);}
          return {changedChannels:changed,totalChannels:first.length,maxDelta};
        },{previous,current:image});
      }
      results.push({device:device.name,...metrics,pixelComparison});assert.deepEqual(errors,[]);await context.close();
    }
    writeFileSync(`artifacts/hunter-${tag}.json`,JSON.stringify({backend:'Desktop Chrome, CPU Canvas, fixed hunter replay. Emulated viewport is not real phone FPS.',results},null,2));
    console.log('Hunter replay',tag,results);
  }finally{await browser?.close();await server.close();}
});
