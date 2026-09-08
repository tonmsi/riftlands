import { test, expect, type Page } from '@playwright/test';
import type { RenderFrame } from '../../client/render';
import type { Snapshot } from '../../shared/types';

type Sample = { at: number; x: number; y: number; cameraX: number; cameraY: number };
type ProbeWindow = Window & { movementSamples: Sample[] };

async function captureFrames(page: Page, targetId?: string): Promise<void> {
  await page.evaluate(async targetId => {
    // Instrument presentation only inside the test. The real client/server code stays in use.
    const moduleUrl = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/client/render.ts')?.name ?? '/client/render.ts';
    const { Renderer } = await import(moduleUrl);
    const original = Renderer.prototype.render;
    const probe = window as unknown as ProbeWindow;
    probe.movementSamples = [];
    Renderer.prototype.render = function (frame: RenderFrame) {
      original.call(this, frame);
      const actor = targetId ? frame.actors.find(actor => actor.id === targetId) : frame.self;
      if (frame.playing && actor && probe.movementSamples.length < 2000) {
        probe.movementSamples.push({ at: performance.now(), x: actor.x, y: actor.y, cameraX: this.camera.x, cameraY: this.camera.y });
      }
    };
  }, targetId);
}

test('local movement is smooth between simulation ticks with delayed server snapshots', async ({ page }) => {
  let snapshot: Snapshot | undefined;
  // Keep WebSocket ordering but add an actual 120 ms inbound delivery delay to the client.
  await page.routeWebSocket('**/ws', route => {
    const upstream = route.connectToServer();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    upstream.onMessage(data => {
      const message = JSON.parse(String(data));
      if (message.type === 'snapshot') snapshot = message;
      const timer = setTimeout(() => { timers.delete(timer); route.send(data); }, 120);
      timers.add(timer);
    });
    route.onMessage(data => upstream.send(data));
    route.onClose(() => { for (const timer of timers) clearTimeout(timer); upstream.close(); });
  });
  await page.goto('/');
  await page.getByLabel('Nome del personaggio').fill('Movimento test');
  await page.getByRole('button', { name: 'Entra nel mondo' }).click();
  await expect(page.locator('[data-ref="player-name"]')).toHaveText('Movimento test');
  await captureFrames(page);
  // Cross the clear starting area toward its centre, without touching obstacles or NPCs.
  const key = snapshot!.self.x < 0 ? 'KeyD' : 'KeyA';
  const sign = key === 'KeyD' ? 1 : -1;
  await page.locator('.world-canvas').focus();
  await page.keyboard.down(key);
  await page.waitForTimeout(900);
  await page.keyboard.up(key);
  const samples = await page.evaluate(() => (window as unknown as ProbeWindow).movementSamples);
  expect(samples.length, 'The active renderer is instrumented').toBeGreaterThan(20);
  const start = samples[0].at;
  const settled = samples.filter(sample => sample.at > start + 200 && sample.at < start + 800);
  const pairs = settled.slice(1).map((sample, index) => ({ delta: (sample.x - settled[index].x) * sign, dt: sample.at - settled[index].at }));
  const normalFrames = pairs.filter(pair => pair.dt > 3 && pair.dt < 29);
  expect(normalFrames.length).toBeGreaterThan(12);
  const heldFrames = normalFrames.filter(pair => pair.delta < 0.15).length / normalFrames.length;
  const largestStep = Math.max(...normalFrames.map(pair => pair.delta));
  console.log(`movement: ${normalFrames.length} display frames, ${(heldFrames * 100).toFixed(1)}% held, largest step ${largestStep.toFixed(2)} units`);
  expect(heldFrames, 'Rendering must move between the 30 Hz simulation ticks').toBeLessThan(0.12);
  expect(largestStep, 'No whole-tick staircase on 60+ Hz displays').toBeLessThan(6);
});

test('another player moves smoothly through delayed and uneven snapshot arrivals', async ({ browser }) => {
  const observerContext = await browser.newContext(), moverContext = await browser.newContext();
  const observer = await observerContext.newPage(), mover = await moverContext.newPage();
  let observerSnapshot: Snapshot | undefined, moverSnapshot: Snapshot | undefined;
  let packet = 0, deliveryTime = 0;
  await observer.routeWebSocket('**/ws', route => {
    const upstream = route.connectToServer();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    upstream.onMessage(data => {
      const message = JSON.parse(String(data));
      if (message.type === 'snapshot') observerSnapshot = message;
      const now = performance.now();
      deliveryTime = Math.max(deliveryTime + 1, now + 120 + [0, 25, -10, 40, 5, -15][packet++ % 6]);
      const timer = setTimeout(() => { timers.delete(timer); route.send(data); }, deliveryTime - now);
      timers.add(timer);
    });
    route.onMessage(data => upstream.send(data));
    route.onClose(() => { for (const timer of timers) clearTimeout(timer); upstream.close(); });
  });
  mover.on('websocket', socket => {
    if (!socket.url().endsWith('/ws')) return;
    socket.on('framereceived', event => {
      const message = JSON.parse(String(event.payload));
      if (message.type === 'snapshot') moverSnapshot = message;
    });
  });
  try {
    for (const [page, name] of [[observer, 'Osservatore'], [mover, 'Viaggiatore mobile']] as const) {
      await page.goto('/');
      await page.getByLabel('Nome del personaggio').fill(name);
      await page.getByRole('button', { name: 'Entra nel mondo' }).click();
      await expect(page.locator('[data-ref="player-name"]')).toHaveText(name);
    }
    await expect.poll(() => observerSnapshot?.actors.some(actor => actor.id === moverSnapshot?.self.id)).toBe(true);
    // Fill the interpolation buffer before measuring, then walk away from the other player's body.
    await observer.waitForTimeout(500);
    await captureFrames(observer, moverSnapshot!.self.id);
    const key = moverSnapshot!.self.x < observerSnapshot!.self.x ? 'KeyA' : 'KeyD';
    const sign = key === 'KeyD' ? 1 : -1;
    await mover.locator('.world-canvas').focus();
    await mover.keyboard.down(key); await mover.waitForTimeout(950); await mover.keyboard.up(key);
    const samples = await observer.evaluate(() => (window as unknown as ProbeWindow).movementSamples);
    expect(samples.length).toBeGreaterThan(20);
    const start = samples[0].at;
    const settled = samples.filter(sample => sample.at > start + 450 && sample.at < start + 900);
    const pairs = settled.slice(1).map((sample, index) => ({ delta: (sample.x - settled[index].x) * sign, dt: sample.at - settled[index].at }));
    const normalFrames = pairs.filter(pair => pair.dt > 3 && pair.dt < 29);
    expect(normalFrames.length).toBeGreaterThan(10);
    const heldFrames = normalFrames.filter(pair => pair.delta < 0.15).length / normalFrames.length;
    const largestStep = Math.max(...normalFrames.map(pair => pair.delta));
    console.log(`remote movement: ${normalFrames.length} display frames, ${(heldFrames * 100).toFixed(1)}% held, largest step ${largestStep.toFixed(2)} units`);
    expect(heldFrames, 'Remote playback must not freeze each time it waits for the next snapshot').toBeLessThan(0.15);
    expect(largestStep).toBeLessThan(6);
  } finally { await observerContext.close(); await moverContext.close(); }
});
