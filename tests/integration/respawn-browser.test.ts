import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';

test('respawn keeps the camera still, relocates under black and reveals the rendered destination',{timeout:60_000},async()=>{
  const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
    for(const reducedMotion of ['no-preference','reduce'] as const){
      const context=await browser.newContext({viewport:{width:640,height:360},reducedMotion});
      const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript('window.__name=value=>value');
      await page.route('**/respawn-review',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0"><canvas style="width:640px;height:360px"></canvas></body>'}));
      await page.goto(server.resolvedUrls!.local[0]+'respawn-review');
      const result=await page.evaluate(async reduced=>{
        const {Renderer}=await import('/client/render/render.ts' as string);
        const {RespawnTransition}=await import('/client/ui/respawn-transition.ts' as string);
        const canvas=document.querySelector('canvas')!,renderer=new Renderer(canvas);await renderer.spritesReady;
        let now=0;const transition=new RespawnTransition(()=>now);
        const self=renderer.previewActors('hunter',1000)[0];Object.assign(self,{x:0,y:0,hp:0});
        const frame={time:1000,self,actors:[self],projectiles:[],pickups:[],traps:[],events:[],selectedId:null,previewClass:'hunter',playing:true,holdCamera:false};
        renderer.render(frame);const old={...renderer.camera};
        transition.start();Object.assign(self,{hp:100,x:5000,y:4000});frame.holdCamera=transition.holdCamera;renderer.render(frame);
        const held=renderer.camera.x===old.x&&renderer.camera.y===old.y;
        const veil=document.querySelector<HTMLElement>('.respawn-veil')!;
        await new Promise(requestAnimationFrame);await new Promise(r=>setTimeout(r,reduced?20:180));
        now=reduced?0:160;
        const place=transition.placeCamera();let builds=0;const draw=renderer.terrain.drawTerrain.bind(renderer.terrain);
        renderer.terrain.drawTerrain=(...args:unknown[])=>{builds++;return draw(...args);};
        if(place)renderer.resetCamera();frame.holdCamera=transition.holdCamera;renderer.render(frame);transition.rendered();
        const placed=renderer.camera.x===self.x&&renderer.camera.y===self.y;
        const covered=Number(getComputedStyle(veil).opacity)===1&&veil.classList.contains('covered');
        const destinationReady=!!renderer.terrain.terrainCache;
        const blocking=document.elementFromPoint(300,150)===veil;
        now+=59;transition.rendered();const waiting=veil.classList.contains('covered');
        now+=2;transition.rendered();await new Promise(r=>setTimeout(r,reduced?20:180));now+=160;transition.rendered();
        const revealed=!transition.blocked&&Number(getComputedStyle(veil).opacity)===0;
        transition.start();transition.cancel();const cancelled=!transition.blocked&&!veil.classList.contains('active');
        transition.destroy();renderer.destroy();return {held,place,placed,covered,destinationReady,blocking,waiting,revealed,cancelled,builds};
      },reducedMotion==='reduce');
      assert.ok(result.held&&result.place&&result.placed&&result.covered&&result.destinationReady&&result.blocking&&result.waiting&&result.revealed&&result.cancelled,JSON.stringify(result));
      assert.equal(result.builds,1,'relocation renders the destination once, without traversing intermediate terrain');
      assert.deepEqual(errors,[]);await context.close();
    }
  }finally{await browser?.close();await server.close();}
});
