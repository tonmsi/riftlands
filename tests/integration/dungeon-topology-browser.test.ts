import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startDungeonStudio } from '../../scripts/dungeon-studio-server';
import { studioDraft } from '../fixtures/studio-draft';

test('maker shows linked floors together, focuses rooms and saves the world exit', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'riftlands-topology-ui-'));
  const catalogPath = join(directory, 'catalog.json'); await writeFile(catalogPath, '[]');
  const studio = await startDungeonStudio({ root: resolve('.'), port: 0, catalogPath, dataPath: join(directory, 'accounts.json') });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const draft = studioDraft();
    draft.topology = { entry: { x: 3, y: 3 }, exit: { x: 20, y: 4 }, worldExit: { x: 40, y: 50 },
      rooms: [{ id: 'entry', name: 'Ingresso', floor: 0, x: 0, y: 0, width: 16, height: 18 }, { id: 'lower', name: 'Cripta', floor: -1, x: 18, y: 0, width: 6, height: 18 }],
      warps: [{ id: 'down', from: { x: 5, y: 3 }, to: { x: 20, y: 3 } }, { id: 'up', from: { x: 20, y: 3 }, to: { x: 5, y: 3 } }], shadows: [] };
    await page.addInitScript(d => localStorage.setItem('riftlands.dungeon-draft.v2', JSON.stringify(d)), draft);
    await page.goto(studio.url);
    const graph = page.locator('.inspector').getByLabel('Panoramica dei piani e dei warp');
    await expect(graph).toBeVisible(); await expect(graph.getByText('Piano 0')).toBeVisible(); await expect(graph.getByText('Piano -1')).toBeVisible();
    await expect(graph.locator('path')).toHaveCount(1);
    await graph.getByRole('button', { name: 'Vai a Cripta, piano -1' }).click();
    await expect(page.locator('#status')).toContainText('Cripta');
    await page.getByLabel('Nome stanza').nth(1).fill('Cripta profonda'); await page.getByLabel('Nome stanza').nth(1).press('Tab');
    await expect(graph.getByRole('button', { name: 'Vai a Cripta profonda, piano -1' })).toBeVisible();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('riftlands.dungeon-draft.v2')!));
    assert.deepEqual(stored.topology.worldExit, { x: 40, y: 50 });
    await page.locator('#floor-overview').click();
    const overview = page.locator('.viewport').getByLabel('Panoramica dei piani e dei warp');
    await expect(overview.getByText('Piano -1')).toBeVisible();
    await overview.screenshot({ path: join(directory, 'dungeon-overview.png') });
    await overview.getByRole('button', { name: 'Vai a Ingresso, piano 0' }).click();
    await expect(overview).toBeHidden();
    await graph.scrollIntoViewIfNeeded();
    await graph.screenshot({ path: join(directory, 'dungeon-floor-graph.png') });
    await page.screenshot({ path: join(directory, 'dungeon-floors.png'), fullPage: true });
    // Tools stay in the left palette; reshaping and warp placement work without coordinate fields.
    await expect(page.locator('.palette [data-tool="warp-place"]')).toBeVisible();
    assert.equal(await page.locator('.inspector [data-tool]').count(),0);
    await page.locator('#edit-floor').selectOption('0');
    await page.locator('#edit-room').selectOption('entry');
    await page.locator('#fit').click();
    const box=(await page.locator('#map').boundingBox())!;
    const scale=Math.max(4,Math.min(46,(box.width-60)/24,(box.height-60)/18));
    const point=(x:number,y:number)=>({x:box.x+(box.width-24*scale)/2+(x+.5)*scale,y:box.y+(box.height-18*scale)/2+(y+.5)*scale});
    await page.locator('[data-tool="room-cut"]').click();
    for(let y=0;y<6;y++) {
      const a=point(8,y),b=point(15,y);
      await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y,{steps:9}); await page.mouse.up();
    }
    const shape=await page.evaluate(()=>JSON.parse(localStorage.getItem('riftlands.dungeon-draft.v2')!).topology.rooms[0]);
    assert.equal(shape.tiles.some((p:{x:number;y:number})=>p.x===11&&p.y===3),false);
    assert.equal(shape.tiles.some((p:{x:number;y:number})=>p.x===11&&p.y===9),true);
    const voidPoint=point(11,3);
    const pixel=await page.locator('#map').evaluate((canvas,position)=>{
      const c=canvas as HTMLCanvasElement,r=c.getBoundingClientRect();
      return [...c.getContext('2d')!.getImageData(Math.floor((position.x-r.x)*c.width/r.width),Math.floor((position.y-r.y)*c.height/r.height),1,1).data];
    },voidPoint);
    assert.deepEqual(pixel.slice(0,3),[17,27,30]);
    await page.locator('[data-tool="warp-place"]').click();
    await page.mouse.click(point(6,4).x,point(6,4).y);
    await page.locator('#edit-floor').selectOption('-1');
    await page.mouse.click(point(20,5).x,point(20,5).y);
    const connected=await page.evaluate(()=>JSON.parse(localStorage.getItem('riftlands.dungeon-draft.v2')!).topology.warps);
    assert.equal(connected.length,4); assert.deepEqual(connected[2].from,{x:6,y:4}); assert.deepEqual(connected[2].to,{x:20,y:5});
    await page.locator('#edit-warp').selectOption(connected[2].id);
    await page.locator('#map-warp-to').click();
    await page.mouse.click(point(20,6).x,point(20,6).y);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('riftlands.dungeon-draft.v2')!).topology.warps[2].to),{x:20,y:6});
    await page.locator('#new-edit-floor').click();
    const a=point(3,6),b=point(6,10);
    await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y,{steps:5}); await page.mouse.up();
    const floors=await page.evaluate(()=>JSON.parse(localStorage.getItem('riftlands.dungeon-draft.v2')!));
    assert.equal(floors.topology.rooms.length,3); assert.equal(floors.topology.rooms[2].floor,-2); assert.equal(floors.topology.rooms[2].tiles.length,20);
    await page.screenshot({path:join(directory,'dungeon-map-tools.png'),fullPage:true});
    assert.deepEqual(errors, []);
    console.log(`Preview: ${join(directory, 'dungeon-floors.png')}`);
  } finally { await browser.close(); await studio.close(); }
});
