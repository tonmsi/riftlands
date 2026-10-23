import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

test('Canvas impacts distinguish melee, projectiles, shields and walls, animate and expire without leaking state', { timeout: 60_000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 480 }, deviceScaleFactor: 1 });
    await page.addInitScript('window.__name = value => value');
    await page.route('**/impact-review', route => route.fulfill({ contentType: 'text/html', body: '<meta charset="utf-8"><body style="margin:0;background:#111d29;color:#e8e0cf;font:14px system-ui"><h2 style="margin:20px">Impatti di combattimento · Canvas JavaScript</h2><canvas width="1000" height="380"></canvas></body>' }));
    await page.goto(`${server.resolvedUrls!.local[0]}impact-review`);
    const results = await page.evaluate(async () => {
      const { drawCombatImpact } = await import('/client/render/combat-impact.ts' as string);
      const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
      const scratch = document.createElement('canvas'); scratch.width = 120; scratch.height = 120;
      const paint = scratch.getContext('2d', { willReadFrequently: true })!;
      const event = { id: 'confirmed-contact', kind: 'hit', x: 60, y: 60, at: 1000, duration: 500, radius: 26, color: '#ffb8a2',
        impact: { x: 60, y: 60, aim: 0, color: '#f6df93', kind: 'melee', outcome: 'hit' } };
      const render = (e: Omit<typeof event, 'impact'> & { impact?: typeof event.impact } = event, time = 1080, reduced = false) => {
        paint.clearRect(0, 0, 120, 120); drawCombatImpact(paint, e, time, reduced);
        const pixels = paint.getImageData(0, 0, 120, 120).data;
        return { hash: pixels.reduce((h, v) => (Math.imul(h, 31) + v) | 0, 0), count: pixels.filter((_, i) => i % 4 === 3 && pixels[i] > 0).length };
      };
      const melee = render(), ranged = render({ ...event, impact: { ...event.impact, kind: 'projectile' } });
      const shield = render({ ...event, impact: { ...event.impact, outcome: 'shield' } });
      const wall = render({ ...event, impact: { ...event.impact, outcome: 'wall' } });
      const before = render(event, 999), after = render(event, 1500), later = render(event, 1150), reduced = render(event, 1080, true);
      const rotated = render({ ...event, impact: { ...event.impact, aim: Math.PI / 2 } });
      const noImpact = render({ ...event, impact: undefined });
      const sameAgain = render();
      const unchangedState = paint.globalAlpha === 1 && paint.lineWidth === 1 && paint.getTransform().isIdentity;
      // A review gallery shows the same effects at three moments in their short lifetime.
      const columns = [
        { label: 'Melee · Guerriero', kind: 'melee', outcome: 'hit', color: '#ffd0a0' },
        { label: 'Melee · Paladino', kind: 'melee', outcome: 'hit', color: '#f6df93' },
        { label: 'Ranged · Mago', kind: 'projectile', outcome: 'hit', color: '#c5afff' },
        { label: 'Assorbito · Scudo', kind: 'projectile', outcome: 'shield', color: '#ffe5a1' },
        { label: 'Bloccato · Parete', kind: 'projectile', outcome: 'wall', color: '#b9f0b4' },
      ];
      for (let i = 0; i < columns.length; i++) {
        const column = columns[i], x = 100 + i * 200;
        ctx.fillStyle = '#e8e0cf'; ctx.textAlign = 'center'; ctx.fillText(column.label, x, 25);
        for (let j = 0; j < 3; j++) {
          const y = 88 + j * 106;
          ctx.fillStyle = '#243647'; ctx.beginPath(); ctx.arc(x, y, 28, 0, Math.PI * 2); ctx.fill();
          drawCombatImpact(ctx, { ...event, impact: { ...event.impact, ...column, x, y } }, 1040 + j * 70);
          ctx.fillStyle = '#94a6b7'; ctx.fillText(`${40 + j * 70} ms`, x, y + 43);
        }
      }
      return { melee, ranged, shield, wall, before, after, later, reduced, rotated, noImpact, sameAgain, unchangedState };
    });
    assert.ok(results.melee.count > 0); assert.ok(results.ranged.count > 0);
    assert.equal(new Set([results.melee.hash, results.ranged.hash, results.shield.hash, results.wall.hash]).size, 4);
    assert.equal(results.before.count, 0); assert.equal(results.after.count, 0); assert.equal(results.noImpact.count, 0);
    assert.notEqual(results.later.hash, results.melee.hash); assert.notEqual(results.rotated.hash, results.melee.hash);
    assert.ok(results.reduced.count > 0); assert.ok(results.reduced.count < results.melee.count);
    assert.deepEqual(results.sameAgain, results.melee); assert.ok(results.unchangedState);
    mkdirSync('.tmp/combat-review', { recursive: true });
    await page.screenshot({ path: '.tmp/combat-review/impacts.png' });
  } finally { await browser?.close(); await server.close(); }
});
