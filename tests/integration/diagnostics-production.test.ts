import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {preview} from 'vite';

test('production ignores the diagnostic query while preserving normal FPS settings',{timeout:60_000},async()=>{
  // Run after npm run build: preview serves the actual production bundle.
  const server=await preview({preview:{host:'127.0.0.1',port:0},logLevel:'error'});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage(),health:string[]=[];
    page.on('request',r=>{if(new URL(r.url()).pathname==='/health')health.push(r.url());});
    await page.goto(server.resolvedUrls!.local[0]+'?diagnostics=1');
    // No saved account in this context: class selection can stay behind login.
    await expect(page.locator('[data-fps-limit]')).toHaveCount(2);
    await page.waitForTimeout(1100);
    await expect(page.locator('#performance-panel,#perf-launcher,[data-performance-open]')).toHaveCount(0);
    assert.equal(await page.locator('[data-fps-limit]').count(),2);assert.deepEqual(health,[]);
    assert.equal(await page.locator('.frame-rate-setting select').first().evaluate(el=>getComputedStyle(el).minHeight),'36px');
  }finally{await browser?.close();await new Promise<void>((resolve,reject)=>server.httpServer.close(e=>e?reject(e):resolve()));}
});
