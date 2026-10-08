import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startWorldStudio } from '../../scripts/world-studio-server';
import { ACTOR_CATALOG } from '../../shared/actor-catalog';
import { newWorldDocument } from '../../shared/world-schema';

test('player editor previews and saves per-class sizes used by sprite and procedural rendering without changing hitboxes', { timeout: 60_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'riftlands-player-editor-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const root = resolve('.'), options = { root, documentPath: join(dir, 'world.json'), dungeonPath: join(dir, 'dungeons.json'), dataPath: join(dir, 'accounts.json'), port: 0 };
  const path = join(dir, 'actor-catalog.json');
  const original = structuredClone(ACTOR_CATALOG); delete original.playerDrawSizes;
  await writeFile(options.documentPath, JSON.stringify(newWorldDocument())); await writeFile(options.dungeonPath, '[]'); await writeFile(path, JSON.stringify(original));
  const studio = await startWorldStudio(options); let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(studio.url); await expect(page.locator('#status')).toContainText('World Studio pronto');
    await page.locator('#open-player-editor').click(); await expect(page.locator('#player-status')).toHaveText('Catalogo caricato.');
    await page.locator('#player-class').selectOption('mage'); await expect(page.locator('#player-size')).toHaveValue('48');
    await page.locator('#player-size').fill('96'); await expect(page.locator('#player-preview-size')).toContainText('96 px · hitbox 15 px');
    await page.locator('#player-class').selectOption('hunter'); await page.locator('#player-size').fill('72');
    await page.locator('#player-class').selectOption('warrior'); await expect(page.locator('#player-size')).toHaveValue('48');
    await page.locator('#player-class').selectOption('mage'); await expect(page.locator('#player-size')).toHaveValue('96');
    await page.locator('#player-save').click(); await expect(page.locator('#player-status')).toContainText('Dimensioni salvate con backup');
    const saved = JSON.parse(await readFile(path, 'utf8'));
    assert.deepEqual(saved.playerDrawSizes, { mage: 96, hunter: 72 });
    assert.deepEqual(saved.skins, original.skins); assert.deepEqual(saved.bosses, original.bosses);
    const runtime = await page.evaluate(`(async () => {
      const { ActorRenderer } = await import('/client/render/actor-renderer.ts');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      const ctx = canvas.getContext('2d'), renderer = new ActorRenderer(ctx, matchMedia('(pointer: coarse)'));
      await renderer.spritesReady;
      const widths = [], scales = [], drawImage = ctx.drawImage.bind(ctx), scale = ctx.scale.bind(ctx);
      ctx.drawImage = (...args) => { widths.push(args[3]); drawImage(...args); };
      ctx.scale = (x,y) => { scales.push([x,y]); scale(x,y); };
      const actor = {id:'p',kind:'player',name:'',classId:'mage',x:100,y:100,radius:15,hp:100,maxHp:100,resource:100,maxResource:100,aim:0,speed:0,level:1,xp:0,kills:0,deaths:0,teamId:null,hidden:false,revealedUntil:0,deadUntil:0,spawnProtectedUntil:0,effects:[],cooldowns:{basic:0,q:0,e:0,r:0},spriteMoving:false};
      renderer.drawActor(actor,0,false,false,false,new Set());
      actor.classId='hunter'; renderer.drawActor(actor,0,false,false,false,new Set());
      return {widths, hunterScaled:scales.some(([x,y])=>x===1.5&&y===1.5), radius:actor.radius, warriorSize:renderer.playerDrawSize('warrior')};
    })()`);
    assert.deepEqual(runtime, { widths: [96], hunterScaled: true, radius: 15, warriorSize: 48 });
    await mkdir(join(root, '.tmp'), { recursive: true }); await page.screenshot({ path: join(root, '.tmp/player-editor-desktop.png') });
    await page.setViewportSize({ width: 844, height: 390 });
    assert.ok(await page.locator('#player-editor').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await page.locator('#player-save').scrollIntoViewIfNeeded(); await expect(page.locator('#player-save')).toBeInViewport();
    await page.screenshot({ path: join(root, '.tmp/player-editor-landscape.png') });
    await page.locator('#player-close').click(); await page.locator('#open-player-editor').click();
    await expect(page.locator('#player-status')).toHaveText('Catalogo caricato.'); await expect(page.locator('#player-size')).toHaveValue('96');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await studio.close(); }
});
