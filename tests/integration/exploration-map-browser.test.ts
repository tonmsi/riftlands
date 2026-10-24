import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

test('map fog reveals visited terrain, retains it, hides actors and separates interiors and characters', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 });
    await page.addInitScript('window.__name = value => value');
    await page.route('**/map-review', route => route.fulfill({ contentType: 'text/html', body: '<canvas style="width:300px;height:300px"></canvas>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}map-review`);
    const result = await page.evaluate(async () => {
      const { drawMinimap } = await import('/client/render/minimap.ts' as string);
      const { revealExploration } = await import('/shared/exploration.ts' as string);
      const { newNarrativeProgress } = await import('/shared/narrative.ts' as string);
      const { World } = await import('/shared/world.ts' as string);
      const { newWorldDocument } = await import('/shared/world-schema.ts' as string);
      const canvas = document.querySelector('canvas')!, world = new World(1, 16, 'world', newWorldDocument(), []);
      world.getTile = () => 'grass';
      const self = { id: 'self', x: 0, y: 0, hp: 100 }, npc = { id: 'hidden', kind: 'npc', x: 20.5 * 48, y: 1.5 * 48, hp: 100 };
      const progress = newNarrativeProgress(); revealExploration(progress, 'world', 0, 0);
      const draw = (p = progress, actors: unknown[] = [], mapId = 'world') => drawMinimap(canvas, world, self, actors, [], 4800, 1, p, mapId);
      const pixel = (tx: number, ty: number) => Array.from(canvas.getContext('2d')!.getImageData(Math.floor(150 + (tx + .5) * 3), Math.floor(150 + (ty + .5) * 3), 1, 1).data);
      draw(); const unknown = pixel(20, 1), visited = pixel(2, 2);
      draw(progress, [npc]); const hiddenActor = pixel(20, 1);
      revealExploration(progress, 'world', npc.x, npc.y); draw(); const revealed = pixel(20, 1), retained = pixel(2, 2);
      draw(progress, [npc]); const seenActor = pixel(20, 1);
      const restored = JSON.parse(JSON.stringify(progress)); draw(restored); const reloaded = pixel(20, 1);
      draw(restored, [], 'house'); const interior = pixel(20, 1);
      const other = newNarrativeProgress(); other.revision = progress.revision; draw(other); const otherCharacter = pixel(20, 1);
      // Mission givers and accepted destinations stay visible above unexplored fog.
      world.authoring.document.npcs.push({id:'quest-giver',npcKind:'old-fisher',x:20,y:1,level:1});
      draw(other);const questGiver=pixel(20,1),questNpcCount=canvas.dataset.questNpcCount;
      const untouchedFog=pixel(22,3);
      other.quests['stinking-bait']={status:'completed',objectives:{},completedAt:Date.now()};
      draw(other);const completedGiver=pixel(20,1);
      world.authoring.document.zones.push({id:'destination',name:'Destinazione',priority:1,questId:'north-road',shape:{kind:'rect',x:29,y:19,width:2,height:2}});
      other.quests['north-road']={status:'active',objectives:{}};
      draw(other);const destination=pixel(29,19),targets=canvas.dataset.questTargetCount;
      other.quests['north-road'].status='completed';draw(other);const completedDestination=pixel(29,19);
      return { unknown, visited, hiddenActor, revealed, retained, seenActor, reloaded, interior, otherCharacter,questGiver,questNpcCount,untouchedFog,completedGiver,destination,targets,completedDestination };
    });
    assert.deepEqual(result.unknown, [17, 27, 37, 255]);
    assert.notDeepEqual(result.visited, result.unknown);
    assert.deepEqual(result.hiddenActor, result.unknown);
    assert.notDeepEqual(result.revealed, result.unknown);
    assert.deepEqual(result.retained, result.visited);
    assert.notDeepEqual(result.seenActor, result.revealed);
    assert.deepEqual(result.reloaded, result.revealed);
    assert.deepEqual(result.interior, result.unknown);
    assert.deepEqual(result.otherCharacter, result.unknown);
    assert.notDeepEqual(result.questGiver,result.unknown);
    assert.equal(result.questNpcCount,'1');assert.deepEqual(result.untouchedFog,result.unknown);
    assert.deepEqual(result.completedGiver,result.unknown);
    assert.notDeepEqual(result.destination,result.unknown);assert.equal(result.targets,'1');
    assert.deepEqual(result.completedDestination,result.unknown);
  } finally { await browser?.close(); await server.close(); }
});

test('both map sizes cache relief contours and small asset thumbnails without revealing undiscovered terrain', { timeout: 60_000 }, async () => {
  const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage({deviceScaleFactor:1});await page.addInitScript('window.__name=value=>value');
    const requested:string[]=[];
    await page.route('**/world-assets/map-*.svg',route=>{
      requested.push(route.request().url());
      return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect x="8" y="8" width="32" height="32" fill="${route.request().url().includes('bush')?'#206030':'#e040b0'}"/></svg>`});
    });
    await page.route('**/topography-review',route=>route.fulfill({contentType:'text/html',body:'<canvas style="width:300px;height:300px"></canvas>'}));
    await page.goto(server.resolvedUrls!.local[0]+'topography-review');
    await page.evaluate(async()=>{
      const {drawMinimap}=await import('/client/render/minimap.ts' as string);
      const {World}=await import('/shared/world.ts' as string);
      const {newWorldDocument,newWorldAsset,resizeWorldAsset}=await import('/shared/world-schema.ts' as string);
      const {newNarrativeProgress}=await import('/shared/narrative.ts' as string);
      const {revealExploration}=await import('/shared/exploration.ts' as string);
      const documentData=newWorldDocument(),bush=newWorldAsset('bush','Cespuglio','/world-assets/map-bush.svg'),house=newWorldAsset('house','Casa','/world-assets/map-house.svg'),hidden=newWorldAsset('hidden','Casa nascosta','/world-assets/map-hidden.svg');
      for(const a of [bush,house,hidden])a.generation.enabled=false;
      resizeWorldAsset(house,4,3);resizeWorldAsset(hidden,4,3);
      documentData.assets.push(bush,house,hidden);
      documentData.placements.push({id:'bush',assetId:bush.id,x:-5,y:2},{id:'house',assetId:house.id,x:4,y:2},
        {id:'hidden',assetId:hidden.id,x:25,y:3},{id:'partial',assetId:house.id,x:17,y:5});
      documentData.geometry={surfaces:[{id:'plateau',x:2,y:7,width:10,height:4,elevation:1,ground:true,terrain:'grass'},
        {id:'summit',x:5,y:8,width:4,height:2,elevation:2,ground:true,terrain:'grass'}],solids:[],stairs:[]};
      const world=new World(1,16,'world',documentData,[]);world.getTile=()=> 'grass';world.getMoisture=()=>.5;
      world.elevation.geometry=()=>{throw new Error('Minimap must not build collision geometry');};
      world.elevation.cliffs=()=>{throw new Error('Minimap must not build cliff meshes');};
      const assetsIn=world.assetsIn.bind(world);let assetQueries=0;
      world.assetsIn=(...args:any[])=>{assetQueries++;return assetsIn(...args);};
      const progress=newNarrativeProgress();revealExploration(progress,'world',0,0);
      const canvas=document.querySelector('canvas')!,self={id:'self',x:0,y:0,hp:100};
      let span=4800;
      const draw=(s=span)=>{span=s;drawMinimap(canvas,world,self,[],[],span,1,progress);};
      const pixel=(x:number,y:number)=>[...canvas.getContext('2d')!.getImageData(Math.floor(150+x*300/span),Math.floor(150+y*300/span),1,1).data];
      (window as any).topographyReview={draw,pixel,queries:()=>assetQueries};draw();
    });
    await expect.poll(()=>page.evaluate(()=>{const f=(window as any).topographyReview;f.draw();return f.pixel(6*48,3.5*48).join(',');})).toBe('224,64,176,255');
    const results=await page.evaluate(()=>{
      const f=(window as any).topographyReview,results=[];
      for(const span of [1600,4800]){
        f.draw(span);
        const before=f.queries();f.draw(span);const after=f.queries();
        results.push({span,before,after,base:f.pixel(-3.5*48,8.5*48),raised:f.pixel(3.5*48,8.5*48),summit:f.pixel(6.5*48,8.5*48),
          edge:f.pixel(5*48,8.5*48),bush:f.pixel(-4.5*48,2.5*48),house:f.pixel(6*48,3.5*48),hidden:f.pixel(26*48,4.5*48),partialFog:f.pixel(20*48,6.5*48)});
      }return results;
    });
    for(const r of results){
      assert.equal(r.before,r.after,'unchanged map reuses its terrain and asset bitmap');
      assert.notDeepEqual(r.base,r.raised);assert.notDeepEqual(r.raised,r.summit);assert.notDeepEqual(r.edge,r.summit);
      assert.deepEqual(r.bush,[32,96,48,255]);assert.deepEqual(r.house,[224,64,176,255]);
      if(r.span===4800){assert.deepEqual(r.hidden,[17,27,37,255]);assert.deepEqual(r.partialFog,[17,27,37,255]);}
    }
    assert.equal(requested.some(url=>url.includes('map-hidden')),false,'fully unknown assets are not loaded');
  }finally{await browser?.close();await server.close();}
});
