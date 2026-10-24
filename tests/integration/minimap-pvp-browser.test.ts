import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

test('minimap PvP badge tracks server protection and stays above the map on desktop and mobile', {timeout:60_000}, async()=>{
  const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
    for(const [width,height,touch] of [[1440,900,false],[390,844,true],[844,390,true],[667,375,true]] as const){
      const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch});
      const page=await context.newPage();await page.addInitScript('window.__name=value=>value');
      await page.route('**/pvp-review',r=>r.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>'}));
      await page.route('**/api/lobby',r=>r.fulfill({json:{account:null,friends:[],leaderboard:[]}}));
      await page.goto(server.resolvedUrls!.local[0]+'pvp-review');
      await page.evaluate(async()=>{
        for(const file of ['styles/style.css','styles/mobile.css','ui/hud/team.css','ui/lobby/lobby.css','ui/hud/hud.css','ui/interactions/interactions.css'])await import(`/client/${file}`);
        const {GameUI}=await import('/client/ui/ui.ts' as string),{CLASSES}=await import('/shared/config.ts' as string);
        const noop=()=>{},ui=new GameUI(document.querySelector('#app')!,{join:noop,leave:noop,social:noop,select:noop});
        ui.setAssetProgress(1,1,0);ui.setPlaying(true);
        const self={...CLASSES.paladin,id:'self',kind:'player',classId:'paladin',name:'Player',level:1,xp:0,kills:0,deaths:0,teamId:null,x:0,y:0,aim:0,radius:15,hp:100,maxHp:100,resource:100,maxResource:100,hidden:false,revealedUntil:0,deadUntil:0,spawnProtectedUntil:0,effects:[],cooldowns:{basic:0,q:0,e:0,r:0}};
        const snapshot={type:'snapshot',tick:1,time:1000,ack:0,self,actors:[self],projectiles:[],pickups:[],events:[],online:1,activeChunks:1,sanctuary:'outside'};
        (window as any).pvpReview={ui,snapshot};ui.setSnapshot(snapshot,24);
      });
      const tag=page.locator('.minimap-pvp');await expect(tag).toHaveText('PvP');await expect(tag).toHaveAttribute('data-state','active');
      const badge=(await tag.boundingBox())!,map=(await page.locator('.compact-map').boundingBox())!;
      assert.ok(badge.y>=0&&badge.y<map.y&&badge.x>=map.x&&badge.x+badge.width<=map.x+map.width,`visible badge above minimap at ${width}x${height}`);
      await page.evaluate(()=>{const f=(window as any).pvpReview;f.ui.setSnapshot({...f.snapshot,sanctuary:'safe'},24);});
      await expect(tag).toHaveAttribute('data-state','safe');await expect(tag).toHaveAttribute('aria-label','PvP disabilitato in questa zona');
      assert.ok(await tag.evaluate(e=>getComputedStyle(e).textDecorationLine.includes('line-through')));
      await page.evaluate(()=>{const f=(window as any).pvpReview;f.ui.setSnapshot({...f.snapshot,sanctuary:'combat',self:{...f.snapshot.self,pvpUntil:8000}},24);});
      await expect(tag).toHaveText('PvP · 7s');await expect(tag).toHaveAttribute('data-state','combat');
      await page.evaluate(()=>{const f=(window as any).pvpReview;f.ui.setSnapshot({...f.snapshot,sanctuary:undefined},24);});
      await expect(tag).toHaveAttribute('data-state','active');
      await tag.click();await expect(page.locator('.minimap-panel')).toBeVisible();
      await page.evaluate(()=>{(window as any).pvpReview.ui.setPlaying(false);});await expect(tag).toBeHidden();
      await context.close();
    }
  }finally{await browser?.close();await server.close();}
});
