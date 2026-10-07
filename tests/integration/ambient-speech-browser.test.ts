import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';

test('ambient speech renders above NPCs on desktop and touch without canvas errors', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    await mkdir('.tmp/speech-review', { recursive: true });
    for (const [name, width, height] of [['desktop', 900, 700], ['touch', 640, 360]] as const) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: name === 'touch' });
      const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript('window.__name = value => value');
      await page.route('**/speech-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas style="width:100vw;height:100vh"></canvas></body>' }));
      await page.goto(`${server.resolvedUrls!.local[0]}speech-review`);
      const result = await page.evaluate(async () => {
        const { Renderer } = await import('/client/render/render.ts' as string);
        const { CLASSES } = await import('/shared/config.ts' as string);
        const canvas = document.querySelector('canvas')!;
        const renderer = new Renderer(canvas); await renderer.spritesReady;
        const self = { ...CLASSES.warrior, id: 'speech-review', name: 'Leggenda', kind: 'player', classId: 'warrior',
          x: 24, y: 1128, radius: 15, hp: 100, maxHp: 100, resource: 100, maxResource: 100, aim: 0,
          level: 1, xp: 0, kills: 0, deaths: 0, teamId: null, hidden: false, revealedUntil: 0,
          deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { primary: 0, secondary: 0 } };
        const npc = { ...self, id: 'authored:npc-dock-skeptic', name: 'Brugo, abitante del porto', kind: 'npc',
          npcKind: 'dock-skeptic', disposition: 'neutral', x: -72, y: 1176 };
        const frame = { time: 200_000, self, actors: [self, npc], projectiles: [], pickups: [], traps: [], events: [],
          selectedId: null, previewClass: 'warrior', playing: true };
        let clock = 1_000_000; const realNow = Date.now; Date.now = () => clock;
        localStorage.clear();
        renderer.render(frame); clock += 500;
        const ctx = canvas.getContext('2d')!;
        const labels: { text: string; x: number; y: number }[] = [];
        const original = ctx.fillText.bind(ctx);
        ctx.fillText = (text, x, y, maxWidth) => { if (ctx.font === '600 13px system-ui') labels.push({ text, x, y }); original(text, x, y, maxWidth); };
        renderer.render(frame); ctx.fillText = original; Date.now = realNow;
        renderer.destroy();
        return { labels, width: innerWidth, height: innerHeight };
      });
      assert.ok(result.labels.length >= 2);
      assert.match(result.labels.map(l => l.text).join(' '), /un’altra “Leggenda”/);
      assert.ok(result.labels.every(l => l.x > 10 && l.x < result.width - 10 && l.y >= 10 && l.y < result.height - 10));
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `.tmp/speech-review/${name}.png` });
      await page.close();
    }
  } finally { await browser?.close(); await server.close(); }
});
