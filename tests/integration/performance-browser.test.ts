import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium,expect,type Browser } from '@playwright/test';
import { AccountStore,publicAccount } from '../../server/store';
import { WorldSimulation } from '../../server/simulation';
import type { PerformanceLog } from '../../client/core/performance-log';

test('mobile diagnostics capture actual frames, freezes, network work, A/B flags and a private JSON export',{timeout:90_000},async()=>{
  const directory=mkdtempSync(join(tmpdir(),'riftlands-performance-')),store=new AccountStore(join(directory,'accounts.json'));
  const user=store.register('PerfMobilePrivate','test-password'),sim=new WorldSimulation(734291,Date.now(),store);
  const player=sim.addPlayer(user.account,'hunter');player.x=0;player.y=72;sim.checkpoint();store.flush();
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=(probe.address() as {port:number}).port;await new Promise<void>(done=>probe.close(()=>done()));
  const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:resolve('.'),windowsHide:true,
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_FILE:store.path,NODE_ENV:'development'},stdio:['ignore','pipe','pipe']});
  const ended=once(child,'close');let browser:Browser|undefined;
  try{
    await new Promise<void>((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timeout')),15000);
      child.stdout.on('data',c=>{if(String(c).includes('Riftlands:')){clearTimeout(timer);done();}});child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',c=>{clearTimeout(timer);reject(new Error(`Server exit ${c}`));});});
    browser=await chromium.launch({channel:'chrome',headless:true});
    const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:2,acceptDownloads:true});
    await context.addInitScript(({token,profile})=>{localStorage.setItem('riftlands.jwt',token);localStorage.setItem('riftlands.profile',JSON.stringify(profile));Object.defineProperty(navigator,'standalone',{value:true});},
      {token:user.token,profile:publicAccount(user.account)});
    const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.locator('[data-class="hunter"]')).toBeVisible();
    await expect(page.locator('#performance-panel,#perf-launcher,[data-performance-open]')).toHaveCount(0);
    assert.equal(await page.locator('[data-fps-limit]').count(),2,'normal FPS settings remain available');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(async()=>{const {performanceLog}=await import('/client/core/performance-log.ts' as string);return performanceLog.active;}),false);
    await page.goto(`http://127.0.0.1:${port}/?diagnostics=1`);
    await expect(page.locator('#performance-panel')).toBeVisible();await expect(page.locator('#perf-fps')).toContainText('FPS');
    await page.locator('[data-class="hunter"]').click();await page.locator('[data-ref=join]').click();await expect(page.locator('.game-hud')).toBeVisible();
    await expect(page.locator('[data-ref="world-entrance"]')).toBeHidden();
    await expect.poll(async()=>page.evaluate(async()=>{const {performanceLog}=await import('/client/core/performance-log.ts' as string);return performanceLog.summary().lastState.playing;}),{timeout:20_000}).toBe(true);
    await page.waitForTimeout(600);
    await page.evaluate(async()=>{
      const {Renderer}=await import('/client/render/render.ts' as string);const original=Renderer.prototype.render;
      (window as any).diagnosticMovement=[];
      Renderer.prototype.render=function(frame:any){original.call(this,frame);if(frame.playing&&frame.self){(window as any).diagnosticMovement.push(frame.self.x);(window as any).diagnosticClass={classId:frame.self.classId,speed:frame.self.speed};}};
    });
    const stick=(await page.locator('.mobile-joystick').boundingBox())!,cdp=await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:stick.x+stick.width/2+42,y:stick.y+stick.height/2}]});
    await page.waitForTimeout(650);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    const movement:number[]=await page.evaluate(()=>(window as any).diagnosticMovement);
    assert.deepEqual(await page.evaluate(()=>(window as any).diagnosticClass),{classId:'hunter',speed:610});
    assert.ok(Math.max(...movement)-Math.min(...movement)>20,'compact diagnostics leave the touch joystick usable: '+JSON.stringify({samples:movement.length,min:Math.min(...movement),max:Math.max(...movement),stick}));
    // Deliberate main-thread freeze validates that raw frame gaps are preserved.
    await page.evaluate(()=>{const end=performance.now()+140;while(performance.now()<end){/* diagnostic test only */}});
    await page.waitForTimeout(300);
    await page.locator('#perf-expand').click();await page.locator('#performance-panel details summary').click();
    await page.locator('#perf-fps-options [data-fps-limit]').selectOption('30');await page.waitForTimeout(350);
    await expect.poll(async()=>page.evaluate(async()=>{const {performanceLog}=await import('/client/core/performance-log.ts' as string);return performanceLog.summary().lastTargetFps;})).toBe(30);
    assert.equal(await page.evaluate(()=>localStorage.getItem('riftlands.fps-limit.v1')),'30');
    await page.locator('#perf-fps-options [data-fps-limit]').selectOption('60');
    for(const feature of ['sea','weather','sprites','assets'])await page.locator(`[data-perf-feature="${feature}"]`).uncheck();
    await page.waitForTimeout(350);
    await page.locator('[data-perf-feature="masks"]').uncheck();await page.locator('[data-perf-feature="paint"]').uncheck();
    await page.waitForTimeout(350);
    const beforeExport=await page.evaluate(async()=>{
      const {performanceLog}=await import('/client/core/performance-log.ts' as string);return performanceLog.report();
    }) as ReturnType<PerformanceLog['report']>;
    assert.ok(beforeExport.frames.some(f=>f.targetFps===60&&f.state.playing===true));
    assert.ok(beforeExport.summary.frame.maxMs!>=100,'unclamped freeze appears in the frame log');
    assert.ok(beforeExport.jankEvidence.some(e=>(e.frame.intervalMs??0)>=100));
    assert.ok(beforeExport.async['snapshot-callback'].samples>0);assert.ok(beforeExport.async['snapshot-arrival-gap'].samples>0);
    assert.ok(beforeExport.events.some(e=>e.kind==='server-sample'&&e.data.available===true&&typeof e.data.stepP95Ms==='number'));
    const off=beforeExport.frames.filter(f=>!f.flags.sea&&!f.flags.weather&&!f.flags.sprites&&!f.flags.assets);
    assert.ok(off.length>0);assert.ok(off.every(f=>!f.phases['sea-animation']&&f.state.spriteDraws===0&&f.state.mapAssetDraws===0));
    assert.ok(beforeExport.frames.some(f=>!f.flags.masks&&f.state.terrainCache==='full'));
    assert.ok(beforeExport.frames.some(f=>f.phases['masks-geometry']!==undefined));
    const download=page.waitForEvent('download');await page.locator('#perf-export').click();const file=await download;
    const path=join(directory,'mobile-report.json');await file.saveAs(path);const raw=readFileSync(path,'utf8'),report=JSON.parse(raw);
    assert.equal(report.active,false);assert.ok(report.finalMetadata.renderer.actors.catalog.pixels>0);
    assert.ok(!raw.includes(user.token)&&!raw.includes('PerfMobilePrivate')&&!raw.includes('test-password'));
    const restored=await page.evaluate(async()=>{const {performanceLog}=await import('/client/core/performance-log.ts' as string);return {active:performanceLog.active,sea:performanceLog.feature('sea'),masks:performanceLog.feature('masks')};});
    assert.deepEqual(restored,{active:false,sea:true,masks:true});assert.deepEqual(errors,[]);
    mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/mobile-diagnostics-example.json',raw);
    await page.screenshot({path:'artifacts/mobile-diagnostics.png'});
    console.log('Diagnostic browser check (desktop Chrome with touch emulation; not real phone FPS):',
      {frames:report.summary.frames,fps:report.summary.fps,maxGapMs:report.summary.frame.maxMs,segments:report.segments.length,networkCallbacks:report.async['snapshot-callback'].samples});
    await context.close();
    const desktop=await browser.newContext({viewport:{width:1280,height:720},acceptDownloads:true});
    await desktop.addInitScript(({token,profile})=>{localStorage.setItem('riftlands.jwt',token);localStorage.setItem('riftlands.profile',JSON.stringify(profile));},
      {token:user.token,profile:publicAccount(user.account)});
    const pc=await desktop.newPage(),desktopErrors:string[]=[];pc.on('pageerror',e=>desktopErrors.push(e.message));await pc.goto(`http://127.0.0.1:${port}/?diagnostics=1`);
    await pc.locator('#perf-expand').click();await pc.locator('#perf-fps-options [data-fps-limit]').selectOption('90');
    await pc.locator('#perf-expand').click();await pc.locator('[data-class="hunter"]').click();await pc.locator('[data-ref=join]').click();await expect(pc.locator('.game-hud')).toBeVisible();
    await expect.poll(async()=>pc.evaluate(async()=>{const {performanceLog}=await import('/client/core/performance-log.ts' as string);return performanceLog.summary().lastTargetFps;}),{timeout:20_000}).toBe(90);
    await pc.waitForTimeout(500);
    const pcReport=await pc.evaluate(async()=>{const {performanceLog}=await import('/client/core/performance-log.ts' as string);performanceLog.stop();return performanceLog.report();}) as ReturnType<PerformanceLog['report']>;
    assert.ok(pcReport.frames.some(f=>f.targetFps===90&&f.state.playing===true));assert.ok(pcReport.summary.fps!>0);
    writeFileSync('artifacts/desktop-diagnostics-example.json',JSON.stringify(pcReport,null,2));
    await pc.reload();await expect(pc.locator('#perf-fps-options [data-fps-limit]')).toHaveValue('90');
    assert.deepEqual(desktopErrors,[]);await desktop.close();
  }finally{
    await browser?.close();child.kill();await ended;
    assert.ok(resolve(directory).startsWith(resolve(tmpdir())+'\\'));rmSync(directory,{recursive:true,force:true});
  }
});
