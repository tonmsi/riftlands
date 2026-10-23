import type { GameEvent } from '../../shared/types';

/** Stateless Canvas effects: one confirmed event, no timers, DOM nodes or particle pool. */
export function drawCombatImpact(ctx: CanvasRenderingContext2D, event: GameEvent, time: number, reducedMotion = false): void {
  const impact = event.impact;
  if (event.kind !== 'hit' || !impact) return;
  const elapsed = time - event.at, duration = reducedMotion ? 180 : impact.outcome === 'shield' ? 320 : 260;
  if (elapsed < 0 || elapsed >= duration) return;
  const progress = elapsed / duration, travel = reducedMotion ? .35 : 1 - (1 - progress) ** 3;
  const blocked = impact.outcome !== 'hit', size = impact.kind === 'melee' ? 23 : impact.kind === 'area' ? 28 : 18;
  const color = impact.outcome === 'shield' ? '#bce8ff' : impact.outcome === 'wall' ? '#f3d4a2' : impact.color;
  let seed = 0;
  for (let i = 0; i < event.id.length; i++) seed = (Math.imul(seed, 31) + event.id.charCodeAt(i)) | 0;
  const phase = (seed >>> 0) % 100 / 100 * Math.PI * 2;

  ctx.save();
  ctx.translate(impact.x, impact.y);
  ctx.rotate(impact.aim);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.globalAlpha = (1 - progress) ** 1.3;
  ctx.strokeStyle = color; ctx.fillStyle = color;

  if (impact.outcome === 'shield') {
    // A curved barrier faces the incoming blow; damage numbers still show the reduced damage.
    const r = 13 + travel * 11;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(r * .55, 0, r, Math.PI * .6, Math.PI * 1.4); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(r * .55, 0, r + 5, Math.PI * .68, Math.PI * 1.32); ctx.stroke();
  } else if (impact.kind === 'melee' && !blocked) {
    // Two short crossed cuts, distinct from the broad swing drawn at the attacker.
    ctx.lineWidth = 4 * (1 - progress) + 1;
    ctx.beginPath(); ctx.moveTo(-size * .55, -size * .8); ctx.quadraticCurveTo(5 + travel * 9, -2, size * .4, size * .85); ctx.stroke();
    ctx.strokeStyle = '#fff3dc'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-size * .35, size * .55); ctx.lineTo(size * .35, -size * .6); ctx.stroke();
  } else {
    ctx.lineWidth = 2 * (1 - progress) + .5;
    ctx.beginPath(); ctx.arc(0, 0, 3 + size * travel, 0, Math.PI * 2); ctx.stroke();
    if (impact.kind === 'projectile' && !blocked) {
      ctx.strokeStyle = '#fff3dc'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-11 * (1 - progress), 0); ctx.lineTo(9 + travel * 8, 0); ctx.stroke();
    }
  }

  if (!reducedMotion) {
    // Bounded deterministic sparks; ricochets travel back towards the source.
    const count = blocked ? 6 : impact.kind === 'area' ? 9 : 7;
    ctx.strokeStyle = color; ctx.lineWidth = 1.8 * (1 - progress) + .4;
    for (let i = 0; i < count; i++) {
      const angle = blocked ? Math.PI * .55 + i / (count - 1) * Math.PI * .9 : phase + i * Math.PI * 2 / count;
      const reach = size * (.65 + (i % 3) * .23) * travel;
      const tail = Math.max(0, reach - 5 * (1 - progress));
      ctx.beginPath(); ctx.moveTo(Math.cos(angle) * tail, Math.sin(angle) * tail);
      ctx.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach); ctx.stroke();
    }
    ctx.globalAlpha *= .65;
    ctx.fillStyle = '#fff8e4';
    ctx.beginPath(); ctx.arc(0, 0, 4 * (1 - progress), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
