import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {WorldSimulation} from '../../server/simulation';
import {World} from '../../shared/world';
import {newWorldDocument} from '../../shared/world-schema';
import type {NpcKind} from '../../shared/npcs';

const summarize=(values:number[])=>{const sorted=values.slice().sort((a,b)=>a-b);return {samples:values.length,
  meanMs:values.reduce((a,b)=>a+b,0)/values.length,p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1)};};

test('NPC load separates authoritative simulation, interpolation and warm-terrain rendering',{timeout:120_000},async()=>{
  const counts=[0,10,30,60],scenarios=[];
  for(const count of counts){
    const document=newWorldDocument(),world=new World(42,160,'world',document,[]);
    world.getTile=()=> 'grass';world.assetsIn=()=>[];
    const kinds:NpcKind[]=['slime','wisp','sentinel'];
    const spawns=Array.from({length:count},(_,i)=>({id:`load-npc-${i}`,npcKind:kinds[i%3],level:1,
      x:(i%10-4.5)*44,y:(Math.floor(i/10)-2.5)*38}));
    world.getChunk=(cx,cy)=>({cx,cy,key:`${cx},${cy}`,tiles:[],npcs:cx===0&&cy===0?spawns:[],pickups:[]});
    const sim=new WorldSimulation(42,200_000,undefined,'world',{world,spawn:{x:0,y:0},dungeons:[],bosses:new Map()});
    const self=sim.addPlayer({id:'npc-load-hunter',name:'Benchmark',nameLower:'benchmark',salt:'',passwordHash:'',xp:0,
      kills:0,deaths:0,friends:[],requests:[],lastSeen:0},'hunter');
    self.hp=self.maxHp=1_000_000;self.spawnProtectedUntil=0;sim.step();
    const metadata=(sim as unknown as {npcMeta:Map<string,{aggroTargetId?:string}>}).npcMeta;
    for(const value of metadata.values())value.aggroTargetId=self.id;
    const steps:number[]=[],snapshots:number[]=[];
    for(let i=0;i<240;i++){
      const start=performance.now();sim.step(1/30);const elapsed=performance.now()-start;
      if(i>=60)steps.push(elapsed);
      if(i%2===0){const start=performance.now();JSON.stringify(sim.snapshotFor(self.id));if(i>=60)snapshots.push(performance.now()-start);}
    }
    assert.equal(sim.npcs.size,count);
    // Grid placement keeps all actors visible in both viewport configurations;
    // server timings above exercise AI/combat separately from this render replay.
    const actors=[...sim.npcs.values()].map((actor,i)=>({...actor,x:spawns[i].x,y:spawns[i].y,hp:actor.maxHp,effects:[]}));
    scenarios.push({count,self:{...self,x:0,y:0},actors,server:{step:summarize(steps),snapshotAndJson:summarize(snapshots)}});
  }
  const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
    const results=[];mkdirSync('artifacts',{recursive:true});
    for(const viewport of [{name:'phone',width:823,height:384,dpr:2,touch:true},{name:'desktop',width:1670,height:916,dpr:1,touch:false}]){
      const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},deviceScaleFactor:viewport.dpr,
        isMobile:viewport.touch,hasTouch:viewport.touch});
      const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript('window.__name=value=>value');
      await page.route('**/npc-load',r=>r.fulfill({contentType:'text/html',body:`<body style="margin:0"><canvas style="width:${viewport.width}px;height:${viewport.height}px"></canvas></body>`}));
      await page.goto(server.resolvedUrls!.local[0]+'npc-load');
      const data:Array<{count:number;visible:number;warmCacheUnchanged:boolean;png:string;[key:string]:unknown}>=await page.evaluate(async scenarios=>{
        const {Renderer}=await import('/client/render/render.ts' as string);
        const {World}=await import('/shared/world.ts' as string);
        const {newWorldDocument}=await import('/shared/world-schema.ts' as string);
        const {defaultWorldPainting}=await import('/shared/world-painting.ts' as string);
        const {SnapshotBuffer}=await import('/client/core/snapshots.ts' as string);
        const {performanceLog}=await import('/client/core/performance-log.ts' as string);
        const canvas=document.querySelector('canvas')!;canvas.getContext('2d',{alpha:false,willReadFrequently:true});
        const renderer=new Renderer(canvas);await renderer.spritesReady;
        const doc=newWorldDocument();doc.painting=defaultWorldPainting();
        for(let y=-32;y<=32;y++)for(let x=-40;x<=40;x++)doc.tiles.push({x,y,terrain:y<-3?'water':x<-3?'grass':'path'});
        renderer.world=new World(42,160,'world',doc,[]);
        const summary=(v:number[])=>{const s=v.slice().sort((a,b)=>a-b);return {samples:s.length,meanMs:s.reduce((a,b)=>a+b,0)/s.length,
          p95Ms:s[Math.ceil(s.length*.95)-1],maxMs:s.at(-1)};};
        const results=[];
        for(const scenario of scenarios){
          const {self,actors,count}=scenario,buffer=new SnapshotBuffer(),base=300_000;
          const frame={time:base,self,actors:[self,...actors],projectiles:[],pickups:[],traps:[],events:[],selectedId:null,previewClass:'hunter',playing:true};
          renderer.hasCamera=false;renderer.render(frame);await new Promise(r=>setTimeout(r,150));
          const initialCache=renderer.terrain.terrainCache!.canvas;
          performanceLog.start({},0);const submit:number[]=[],completed:number[]=[],interpolation:number[]=[];
          for(let i=0;i<240;i++){
            const now=base+i*1000/60;
            if(i%4===0){buffer.push({type:'snapshot',tick:i,time:now,ack:0,self,actors:actors.map((a:any,j:number)=>({...a,
              x:a.x+Math.sin(i*.05+j)*8,y:a.y+Math.cos(i*.05+j)*8})),projectiles:[],pickups:[],traps:[],events:[],online:1,activeChunks:1},now);}
            const started=performance.now(),sample=buffer.sample(now),sampled=performance.now();
            frame.time=now;frame.actors=[self,...(sample?.actors??actors)];
            performanceLog.beginFrame(now,60);renderer.render(frame);performanceLog.endFrame();const drawn=performance.now();
            renderer.ctx.getImageData(0,0,1,1);const finished=performance.now();
            if(i>=60){interpolation.push(sampled-started);submit.push(drawn-sampled);completed.push(finished-sampled);}
            if(i%60===59)await new Promise(requestAnimationFrame);
          }
          const report=performanceLog.report();performanceLog.stop();
          results.push({count,submit:summary(submit),withReadback:summary(completed),interpolation:summary(interpolation),
            visible:report.summary.lastState.actorsVisible,sprites:report.summary.phases.sprites,
            warmCacheUnchanged:renderer.terrain.terrainCache!.canvas===initialCache,png:canvas.toDataURL()});
        }
        renderer.destroy();return results;
      },scenarios);
      for(const result of data){assert.equal(result.visible,result.count+1);assert.ok(result.warmCacheUnchanged);
        const {png,...metrics}=result;writeFileSync(`artifacts/npc-${viewport.name}-${result.count}.png`,Buffer.from(png.split(',')[1],'base64'));
        results.push({viewport:viewport.name,...metrics});}
      assert.deepEqual(errors,[]);await context.close();
    }
    const report={note:'Local Chrome CPU Canvas; emulated viewport is not phone FPS. Warm terrain, mixed slime/wisp/sentinel, no network latency. Readback includes synchronization overhead.',
      server:scenarios.map(s=>({count:s.count,...s.server})),client:results};
    writeFileSync('artifacts/npc-performance.json',JSON.stringify(report,null,2));console.log('NPC benchmark',report);
  }finally{await browser?.close();await server.close();}
});
