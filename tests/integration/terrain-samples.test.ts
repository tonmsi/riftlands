import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('terrain samples are reused, bounded, invalidated on edits and released with the renderer',{timeout:60_000},async()=>{
  const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage();await page.addInitScript('window.__name=value=>value');
    await page.route('**/sample-review',route=>route.fulfill({contentType:'text/html',body:'<canvas width="96" height="96"></canvas>'}));
    await page.goto(server.resolvedUrls!.local[0]+'sample-review');
    const result=await page.evaluate(async()=>{
      const {TerrainRenderer}=await import('/client/render/terrain-renderer.ts' as string);
      const {World}=await import('/shared/world.ts' as string);
      const {newWorldDocument}=await import('/shared/world-schema.ts' as string);
      const {compactWorldTiles}=await import('/shared/world-tiles.ts' as string);
      const {WorldBrush,forkWorldDocument}=await import('/shared/world-editing.ts' as string);
      const {defaultWorldPainting,DEFAULT_WATER_COAST}=await import('/shared/world-painting.ts' as string);
      const documentData=newWorldDocument();documentData.painting=defaultWorldPainting();documentData.painting.waterCoast={...DEFAULT_WATER_COAST,enabled:false};
      for(let y=-5;y<=5;y++)for(let x=-5;x<=5;x++)documentData.tiles.push({x,y,terrain:'grass'});
      const world=new World(42,16,'world',compactWorldTiles(documentData),[]),canvas=document.querySelector('canvas')!,ctx=canvas.getContext('2d',{willReadFrequently:true})!;
      const terrain=new TerrainRenderer(ctx),bounds={left:-48,top:-48,right:48,bottom:48};
      const draw=(painter=terrain,offset=0)=>{canvas.width=96;ctx.setTransform(1,0,0,1,48-offset,48);painter.drawTerrain(world,0,ctx,{...bounds,left:bounds.left+offset,right:bounds.right+offset});return Array.from(ctx.getImageData(0,0,96,96).data).join(',');};
      let temperatureReads=0;const original=world.getTemperature.bind(world);world.getTemperature=(x:number,y:number)=>{temperatureReads++;return original(x,y);};
      const first=draw(),initialReads=temperatureReads;temperatureReads=0;const second=draw(),reusedReads=temperatureReads;
      const matchesFresh=()=>{const old=draw(),fresh=new TerrainRenderer(ctx),expected=draw(fresh);fresh.dispose();return old===expected;};
      world.authoring.document.painting={...world.authoring.document.painting,materials:{...world.authoring.document.painting.materials,grass:{color:'#ed4931',size:1,intensity:0}}};
      const paletteCorrect=matchesFresh(),paletteChanged=first!==draw();
      const next=forkWorldDocument(world.authoring.document),brush=new WorldBrush(next);
      for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)brush.tile({x,y},{terrain:'water'});
      world.updateAuthoredTiles(next,brush.flushTiles());const editCorrect=matchesFresh();
      world.lockedTiles.set('sample-lock',new Set(['0,0']));world.setBossLocked('sample-lock',true);const lockCorrect=matchesFresh();
      for(let i=0;i<150;i++)draw(terrain,i*480);
      const bounded=terrain.performanceInfo().samples;terrain.dispose();const released=terrain.performanceInfo().samples;
      return {stable:first===second,initialReads,reusedReads,paletteCorrect,paletteChanged,editCorrect,lockCorrect,bounded,released};
    });
    console.log('Terrain samples',result);
    assert.ok(result.stable&&result.paletteCorrect&&result.paletteChanged&&result.editCorrect&&result.lockCorrect);
    assert.ok(result.initialReads>0&&result.reusedReads<result.initialReads/4);
    assert.ok(result.bounded.surfaces<=8192&&result.bounded.colors<=8192&&result.bounded.temperatures<=4096);
    assert.ok(result.bounded.surfaces>1000);assert.deepEqual(result.released,{surfaces:0,colors:0,temperatures:0});
  }finally{await browser?.close();await server.close();}
});



