import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium, expect, type Browser } from '@playwright/test';
import { AccountStore, publicAccount } from '../../server/store';
import { WorldSimulation } from '../../server/simulation';
test('moving casts originate on the rendered player at 30/150/300 ms RTT without duplicate shots', { timeout: 90000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'riftlands-combat-view-'));
    const store = new AccountStore(join(directory, 'accounts.json'));
    const sim = new WorldSimulation(734291, Date.now(), store);
    const users = [30, 150, 300].map((rtt, index) => { const user = store.register(`CombatView${rtt}`, 'test-password'); const player = sim.addPlayer(user.account, 'mage'); Object.assign(player, { x: 0, y: 1000 + index * 3000, aim: Math.PI / 2 }); return user; });
    sim.checkpoint();
    store.flush();
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = (probe.address() as {
        port: number;
    }).port;
    await new Promise<void>(done => probe.close(() => done()));
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: resolve('.'), windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: store.path, NODE_ENV: 'development' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const ended = once(child, 'close');
    let browser: Browser | undefined;
    try {
        await new Promise<void>((done, reject) => { const timer = setTimeout(() => reject(new Error('Startup timeout')), 15000); child.stdout.on('data', c => { if (String(c).includes('Riftlands:')) {
            clearTimeout(timer);
            done();
        } }); child.once('error', e => { clearTimeout(timer); reject(e); }); child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exit ${code}`)); }); });
        browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
        for (const [index, rtt] of [30, 150, 300].entries()) {
            const user = users[index];
            const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
            try {
                await context.addInitScript(({ token, profile }) => { localStorage.setItem('riftlands.jwt', token); localStorage.setItem('riftlands.profile', JSON.stringify(profile)); }, { token: user.token, profile: publicAccount(user.account) });
                const confirmed = new Set<number>();
                const page = await context.newPage(), errors: string[] = [];
                page.on('pageerror', e => errors.push(e.message));
                await page.routeWebSocket('**/ws', route => { const upstream = route.connectToServer(), timers = new Set<ReturnType<typeof setTimeout>>(); const later = (f: () => void) => { const timer = setTimeout(() => { timers.delete(timer); f(); }, rtt / 2); timers.add(timer); }; route.onMessage(data => later(() => upstream.send(data))); upstream.onMessage(data => { const message = JSON.parse(String(data)); if (message.type === 'snapshot')
                    for (const event of message.events)
                        if (event.kind === 'cast' && event.actorId === message.self.id && event.inputSeq !== undefined)
                            confirmed.add(event.inputSeq); later(() => route.send(data)); }); route.onClose(() => { for (const t of timers)
                    clearTimeout(t); upstream.close(); }); });
                await page.goto(`http://127.0.0.1:${port}`);
                await page.locator('[data-ref=join]').click();
                await expect(page.locator('.game-hud')).toBeVisible();
                await page.waitForTimeout(400);
                await page.evaluate(async () => {
                    const { Renderer } = await import('/client/render.ts' as string), original = Renderer.prototype.render;
                    const probe = window as any;
                    probe.combatFrames = [];
                    Renderer.prototype.render = function (frame: any) { original.call(this, frame); if (frame.playing && frame.self)
                        probe.combatFrames.push({ at: performance.now(), self: { x: frame.self.x, y: frame.self.y }, shots: frame.projectiles.filter((p: any) => p.ownerId === frame.self.id).map((p: any) => ({ id: p.id, seq: p.inputSeq, x: p.x, y: p.y })), events: frame.events.filter((e: any) => e.actorId === frame.self.id && e.kind === 'cast').map((e: any) => ({ id: e.id, seq: e.inputSeq, x: e.x, y: e.y })) }); };
                });
                // Face south manually and move down the clear world road while firing.
                await page.mouse.move(640, 730);
                await page.mouse.down();
                await page.keyboard.down('KeyS');
                await page.waitForTimeout(150);
                const start = await page.evaluate(() => performance.now());
                await page.keyboard.down('Space');
                await page.waitForTimeout(1350);
                await page.keyboard.up('Space');
                await page.keyboard.up('KeyS');
                await page.mouse.up();
                await page.waitForTimeout(rtt + 150);
                const frames: any[] = await page.evaluate(() => (window as any).combatFrames);
                const seen = new Set<string>(), origins: number[] = [], onsets: number[] = [], sequences: number[] = [];
                for (const f of frames) {
                    const seqs = f.shots.map((p: any) => p.seq).filter((s: any) => s !== undefined);
                    assert.equal(new Set(seqs).size, seqs.length, 'one rendered projectile per command');
                    for (const p of f.shots)
                        if (!seen.has(p.id)) {
                            seen.add(p.id);
                            sequences.push(p.seq);
                            origins.push(Math.hypot(p.x - f.self.x, p.y - f.self.y));
                            onsets.push(f.at - start);
                        }
                }
                assert.ok(sequences.every(seq => confirmed.has(seq)), `RTT ${rtt}: speculative cast not confirmed: ${sequences.filter(seq => !confirmed.has(seq))}`);
                assert.ok(origins.length >= 3, `RTT ${rtt}: expected repeated casts`);
                assert.ok(Math.max(...origins) < .01, `RTT ${rtt}: launch offset ${Math.max(...origins)}`);
                assert.ok(onsets[0] < 120, `RTT ${rtt}: local onset ${onsets[0]}`);
                assert.ok(Math.abs(frames.at(-1).self.y - frames[0].self.y) > 100, 'the player must actually be moving');
                assert.deepEqual(errors, []);
                console.log(JSON.stringify({ rttMs: rtt, shots: origins.length, maxLaunchOffset: Math.max(...origins), firstShotMs: +onsets[0].toFixed(1) }));
                if (rtt === 150)
                    await page.screenshot({ path: 'test-results/combat-moving-shot.png' });
            }
            finally {
                await context.close();
            }
        }
    }
    finally {
        await browser?.close();
        child.kill();
        await ended;
    }
});
