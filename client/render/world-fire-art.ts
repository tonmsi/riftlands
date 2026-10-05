import type { WorldAsset } from '../../shared/world-schema';

const TAU = Math.PI * 2;
function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
}
function polygon(ctx: CanvasRenderingContext2D, points: number[]): void {
  ctx.beginPath(); ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.closePath();
}

/** Original fire artwork, independent of crossroads coordinates and gameplay.
 * Coordinates are a nominal 48px asset; the caller applies position, scale and opacity. */
export function drawWorldFire(ctx: CanvasRenderingContext2D, style: Extract<WorldAsset['visual'], { kind: 'fire' }>['style'], time: number, phase: number): void {
    const drawRealisticFlame = (x: number, y: number, w: number, h: number, seed: number) => {
      const t = time * 0.0042;
      const sway1 = Math.sin(t + seed) * 0.5 + Math.sin(t * 2.1 + seed * 1.7) * 0.3 + Math.sin(t * 4.3 + seed * 3.1) * 0.2;
      const sway2 = Math.cos(t * 0.85 + seed * 2.2) * 0.5 + Math.sin(t * 1.9 + seed * 0.9) * 0.35 + Math.cos(t * 3.7) * 0.15;
      const breathe = Math.sin(t * 1.3 + seed * 1.5) * 0.12 + 0.88;

      const curH = h * (0.85 + breathe * 0.25);
      const tipX = sway1 * (w * 0.7);
      const tipY = -curH;

      const glowR = Math.max(w * 3.2, curH * 1.55);
      const g = ctx.createRadialGradient(x, y - curH * 0.3, 2, x, y - curH * 0.3, glowR);
      g.addColorStop(0, 'rgba(255, 175, 45, 0.42)');
      g.addColorStop(0.45, 'rgba(225, 75, 20, 0.12)');
      g.addColorStop(1, 'rgba(200, 40, 10, 0)');
      ctx.fillStyle = g;
      circle(ctx, x, y - curH * 0.3, glowR);
      ctx.fill();

      ctx.fillStyle = '#db4716';
      ctx.beginPath();
      ctx.moveTo(x - w, y);
      ctx.bezierCurveTo(x - w * 1.1 + sway2 * 4, y - curH * 0.35, x - w * 0.4 + sway1 * 5, y - curH * 0.75, x + tipX, y + tipY);
      ctx.bezierCurveTo(x + w * 0.45 + sway2 * 5, y - curH * 0.7, x + w * 1.05 - sway1 * 3, y - curH * 0.35, x + w, y);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#f0841f';
      const midW = w * 0.68;
      const midH = curH * 0.78;
      const midTipX = sway2 * (midW * 0.6);
      ctx.beginPath();
      ctx.moveTo(x - midW, y);
      ctx.bezierCurveTo(x - midW * 0.9, y - midH * 0.4, x - midW * 0.3 + sway1 * 3, y - midH * 0.75, x + midTipX, y - midH);
      ctx.bezierCurveTo(x + midW * 0.3 + sway2 * 3, y - midH * 0.7, x + midW * 0.9, y - midH * 0.4, x + midW, y);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#fff194';
      const coreW = w * 0.36;
      const coreH = curH * 0.48;
      const coreTipX = (sway1 + sway2) * 0.5 * (coreW * 0.5);
      ctx.beginPath();
      ctx.moveTo(x - coreW, y);
      ctx.bezierCurveTo(x - coreW * 0.8, y - coreH * 0.4, x - coreW * 0.2, y - coreH * 0.8, x + coreTipX, y - coreH);
      ctx.bezierCurveTo(x + coreW * 0.2, y - coreH * 0.8, x + coreW * 0.8, y - coreH * 0.4, x + coreW, y);
      ctx.closePath();
      ctx.fill();

      const sparkCount = w > 12 ? 5 : 3;
      for (let s = 0; s < sparkCount; s++) {
        const sparkSpeed = 0.0016 + (s % 3) * 0.0005;
        const phase = (time * sparkSpeed + s * 0.35 + seed * 0.22) % 1;
        const drift = Math.sin(time * 0.0025 + s * 2.1 + seed) * (w * 0.75);
        const sx = x + tipX * 0.4 + drift * phase;
        const sy = y - curH * 0.4 - phase * (curH * 1.5);
        const alpha = Math.sin(phase * Math.PI) * 0.85;
        const size = (1 - phase * 0.45) * (w > 12 ? 1.7 : 1.2);

        ctx.fillStyle = s % 2 === 0 ? `rgba(255, 235, 140, ${alpha})` : `rgba(255, 140, 50, ${alpha})`;
        circle(ctx, sx, sy, size);
        ctx.fill();
      }
    };


  ctx.save();
  ctx.translate(24, 32);
  if (style === 'brazier') {
      ctx.fillStyle = '#222520';
      ctx.fillRect(-7, 2, 14, 4);
      polygon(ctx, [-6, 3, -10, 11, -7, 11, -4, 3]); ctx.fill();
      polygon(ctx, [6, 3, 10, 11, 7, 11, 4, 3]); ctx.fill();
      polygon(ctx, [-9, 2, 9, 2, 6, -3, -6, -3]); ctx.fill();

      ctx.fillStyle = '#7a2512';
      circle(ctx, 0, -1, 5);
      ctx.fill();

      drawRealisticFlame(0, -2, 6.5, 17, phase);

  } else {
    for (let r = 0; r < 8; r++) {
      const rockAng = (r * TAU) / 8;
      ctx.fillStyle = '#545248';
      circle(ctx, Math.cos(rockAng) * 22, Math.sin(rockAng) * 16, 5);
      ctx.fill();
    }

    ctx.strokeStyle = '#3d2516';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-14, -8); ctx.lineTo(14, 8);
    ctx.moveTo(-14, 8); ctx.lineTo(14, -8);
    ctx.stroke();

    ctx.fillStyle = '#b33112';
    circle(ctx, 0, 0, 11);
    ctx.fill();

    drawRealisticFlame(0, 0, 12, 30, phase);

  }
  ctx.restore();
}
