import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { startDungeonStudio } from '../../scripts/dungeon-studio-server';
import { acquireDataLease } from '../../server/data-lease';
import { studioDraft } from '../fixtures/studio-draft';

test('local Studio manages authored dungeons in the browser and refuses unauthorized or concurrent writes', { timeout: 60_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'riftlands-studio-'));
    const options = { root: resolve('.'), port: 0, catalogPath: join(directory, 'catalog.json'), dataPath: join(directory, 'accounts.json') };
    await writeFile(options.catalogPath, '[]');
    await writeFile(options.dataPath, JSON.stringify({ version: 2, accounts: [{ id: 'preserve', gold: 50 }], bosses: {} }));
    const studio = await startDungeonStudio(options);
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
        browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => dialog.accept());
        await page.addInitScript(draft => {
            if (!localStorage.getItem('riftlands.dungeon-draft.v2')) localStorage.setItem('riftlands.dungeon-draft.v2', JSON.stringify(draft));
        }, studioDraft());
        await page.goto(studio.url);
        await expect(page.locator('#dungeon-library')).toBeVisible();
        await page.locator('[data-action="install"]').click();
        await expect(page.locator('#dungeon-library option')).toHaveCount(1);
        await page.locator('[data-library="open"]').click();
        await expect(page.locator('#map-id')).toHaveValue('studio-test');
        const box=(await page.locator('#map').boundingBox())!;
        const scale=Math.max(4,Math.min(46,(box.width-60)/24,(box.height-60)/18));
        const tile=(x:number,y:number)=>({x:box.x+(box.width-24*scale)/2+(x+.5)*scale,y:box.y+(box.height-18*scale)/2+(y+.5)*scale});
        await page.locator('[data-tool="select"]').click();
        const boss=tile(12,9); await page.mouse.click(boss.x,boss.y);
        await expect(page.locator('#entity-aggroRadius')).toBeVisible();
        await page.locator('#entity-aggroRadius').fill('432'); await page.locator('#entity-aggroRadius').press('Tab');
        await page.locator('[data-tool="activation"]').click();
        const from=tile(3,5),to=tile(10,5);
        await page.mouse.move(from.x,from.y); await page.mouse.down();
        await page.mouse.move(to.x,to.y,{steps:14}); await page.mouse.up();
        await expect(page.locator('#issues')).toHaveText('Terreno e posizioni validi.');
        await page.locator('#name').fill('Studio aggiornato'); await page.locator('#name').press('Tab');
        await page.locator('[data-action="update"]').click();
        await expect(page.locator('#dungeon-library option')).toHaveText('Studio aggiornato · studio-test');
        const installed=JSON.parse(await readFile(options.catalogPath,'utf8'))[0];
        assert.equal(installed.definition.encounter.activationPoints.length,8);
        assert.equal(installed.definition.encounter.regions.bossAggro.radius,432);
        await page.locator('[data-library="open"]').click();
        const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('riftlands.dungeon-draft.v2')!));
        assert.equal(restored.entities.filter((e:any)=>e.kind==='activation').length,8);
        assert.equal(restored.entities.find((e:any)=>e.kind==='boss').aggroRadius,432);
        const endpoint = new URL('/__studio/library', studio.url), origin = endpoint.origin;
        const library = await (await fetch(endpoint)).json() as { token: string };
        const write = (headers: Record<string, string>) => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ action: 'remove', id: 'studio-test' }) });
        assert.equal((await write({ Origin: origin })).status, 403);
        assert.equal((await write({ Origin: 'https://untrusted.example', 'X-Studio-Token': library.token })).status, 403);
        const release = acquireDataLease(options.dataPath);
        try {
            const blocked = await write({ Origin: origin, 'X-Studio-Token': library.token });
            assert.equal(blocked.status, 400);
            assert.match(await blocked.text(), /Salvataggio in uso/);
        } finally { release(); }
        await page.locator('[data-action="remove"]').click();
        await expect(page.locator('#dungeon-library option')).toHaveCount(0);
        assert.deepEqual(JSON.parse(await readFile(options.catalogPath, 'utf8')), []);
        assert.deepEqual(JSON.parse(await readFile(options.dataPath, 'utf8')).accounts, [{ id: 'preserve', gold: 50 }]);
        assert.deepEqual(errors, []);
    } finally { await browser?.close(); await studio.close(); await rm(directory, { recursive: true, force: true }); }
});
