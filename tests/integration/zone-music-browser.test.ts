import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';

test('streamed zone music loads lazily, fades for five seconds, reverses on reentry and stops on logout', { timeout: 45_000 }, async () => {
  const wave = Buffer.alloc(44 + 8000 * 2 * 60);
  wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
  wave.write('data', 36); wave.writeUInt32LE(wave.length - 44, 40);
  const requests: string[] = [];
  const http = createHttpServer((req, res) => {
    if (req.url === '/check') { res.setHeader('Content-Type', 'text/html'); res.end('<button>Audio</button>'); return; }
    if (req.url?.startsWith('/music/')) { requests.push(req.url); res.setHeader('Content-Type', 'audio/wav'); res.end(wave); return; }
    vite.middlewares(req, res);
  });
  const vite = await createServer({ server: { middlewareMode: true, hmr: { server: http }, watch: null }, appType: 'mpa', logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${(http.address() as { port: number }).port}/check`);
    await page.evaluate(async () => {
      const { GameAudio } = await import('/client/core/audio.ts' as string);
      const audio = new GameAudio(); (window as any).audio = audio;
      document.querySelector('button')!.onclick = () => { audio.unlock(); audio.setActive(true); };
    });
    await page.locator('button').click();
    assert.equal(requests.length, 0);
    await page.evaluate(() => (window as any).audio.setMusic({ src: '/music/one.wav', volume: .4 }));
    const gain = () => page.evaluate(() => [...(window as any).audio.music.voices.values()][0]?.gain.gain.value ?? -1);
    await expect.poll(() => requests.length).toBe(1);
    await expect.poll(gain).toBeGreaterThan(.02);
    assert.ok(await gain() < .2);
    await expect.poll(gain, { timeout: 6500 }).toBeCloseTo(.4, 2);
    await page.waitForTimeout(300); assert.ok(Math.abs(await gain() - .4) < .001);
    const mutedAt = await page.evaluate(() => {
      const a = (window as any).audio, voice = [...a.music.voices.values()][0];
      (window as any).originalMedia = voice.media;
      a.setMuted(true); return voice.media.currentTime;
    });
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => (window as any).audio.music.output.gain.value), 0);
    assert.ok(await page.evaluate(() => (window as any).originalMedia.currentTime) > mutedAt);
    await page.evaluate(() => (window as any).audio.setMuted(false));
    const musicOutput = () => page.evaluate(() => (window as any).audio.music.output.gain.value);
    await expect.poll(musicOutput).toBeGreaterThan(.03); assert.ok(await musicOutput() < .5);
    await expect.poll(musicOutput, { timeout: 6500 }).toBeCloseTo(1, 2);
    assert.equal(requests.length, 1);
    assert.equal(await page.evaluate(() => [...(window as any).audio.music.voices.values()][0].media === (window as any).originalMedia), true);
    await page.evaluate(() => (window as any).audio.setVolumes({ effects: .25, music: .6 }));
    await expect.poll(musicOutput).toBeCloseTo(.6, 2);
    await expect.poll(() => page.evaluate(() => (window as any).audio.master.gain.value)).toBeCloseTo(.1125, 3);
    const before = await page.evaluate(() => [...(window as any).audio.music.voices.values()][0].media.currentTime);
    await page.evaluate(() => (window as any).audio.setMusic(undefined));
    await expect.poll(gain).toBeLessThan(.35);
    await page.evaluate(() => (window as any).audio.setMusic({ src: '/music/one.wav', volume: .4 }));
    const after = await page.evaluate(() => [...(window as any).audio.music.voices.values()][0].media.currentTime);
    assert.ok(after > before); assert.equal(requests.length, 1);
    await page.evaluate(() => { const a = (window as any).audio; a.setMusic({ src: '/music/two.wav', volume: .4 }); });
    await expect.poll(() => requests.length).toBe(2);
    assert.equal(await page.evaluate(() => (window as any).audio.music.voices.size), 2);
    await page.evaluate(() => (window as any).audio.setMusic(undefined));
    await expect.poll(() => page.evaluate(() => (window as any).audio.music.voices.size), { timeout: 6500 }).toBe(0);
    await page.evaluate(() => (window as any).audio.setMusic({ src: '/music/one.wav', volume: .4 }));
    await page.evaluate(() => (window as any).audio.setActive(false));
    assert.equal(await page.evaluate(() => (window as any).audio.music.voices.size), 0);
    await page.evaluate(() => { const a = (window as any).audio; a.setActive(true); a.setMuted(true); a.setMusic({ src: '/music/three.wav', volume: .4 }); });
    await page.waitForTimeout(100); assert.ok(!requests.includes('/music/three.wav'));
    await page.evaluate(() => (window as any).audio.setMuted(false));
    await expect.poll(() => requests.includes('/music/three.wav')).toBe(true);
    await page.evaluate(() => (window as any).audio.setActive(false));
  } finally {
    await browser?.close(); await vite.close(); await new Promise<void>(resolve => http.close(() => resolve()));
  }
});
