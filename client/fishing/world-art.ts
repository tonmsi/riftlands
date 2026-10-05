import type { Actor, Vec2 } from '../../shared/types';
import type { FishingView } from '../../shared/fishing/model';
import { formatFishingDistance } from '../../shared/fishing/distance';
/** Drawn in world coordinates, so ripples and the line remain attached to the water. */
export function drawFishingWorld(ctx: CanvasRenderingContext2D, player: Actor, fishing: FishingView, target: Vec2 | undefined, time: number, reducedMotion = false): void {
  const point = fishing.bobber ?? target; if (!point) return;
  ctx.save(); ctx.lineWidth = 1.5; ctx.strokeStyle = fishing.phase === 'fight' && fishing.tension > .85 ? '#ef947e' : '#d8ece5bb';
  const fighting = fishing.phase === 'fight', impact = fighting && !reducedMotion ? .6 + fishing.tension * 1.8 : 0;
  const shakeX = Math.sin(time / 28) * impact, shakeY = Math.cos(time / 37) * impact * .7;
  const hand = { x: player.x + 8 + shakeX, y: player.y - 10 + shakeY }, angle = Math.atan2(point.y - hand.y, point.x - hand.x);
  const tip = { x: hand.x + Math.cos(angle) * 37, y: hand.y + Math.sin(angle) * 37 - 15 };
  ctx.strokeStyle = '#d5ad71'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(hand.x, hand.y); ctx.quadraticCurveTo(hand.x + Math.cos(angle) * 20, hand.y - 25, tip.x, tip.y); ctx.stroke();
  if (!fishing.bobber) { ctx.strokeStyle = '#b2e6d799'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(point.x, point.y, 13, 0, Math.PI * 2); ctx.moveTo(point.x - 19, point.y); ctx.lineTo(point.x + 19, point.y); ctx.moveTo(point.x, point.y - 19); ctx.lineTo(point.x, point.y + 19); ctx.stroke(); ctx.restore(); return; }
  const elapsed = Math.max(0, time - (fishing.castAt ?? time)), travel = Math.min(1, elapsed / 420);
  const x = tip.x + (point.x - tip.x) * travel, y = tip.y + (point.y - tip.y) * travel - Math.sin(travel * Math.PI) * 55;
  ctx.lineWidth = 1; ctx.strokeStyle = fishing.tension > .85 ? '#f08f7e' : '#def5e0cc'; ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.quadraticCurveTo((tip.x + x) / 2, (tip.y + y) / 2 + (fishing.reeling ? 0 : 14), x, y); ctx.stroke();
  if (elapsed > 420) {
    for (let i = 0; i < 3; i++) { const p = ((elapsed - 420 + i * 400) % 1600) / 1600; ctx.strokeStyle = `rgba(183,231,233,${(1 - p) * .55})`; ctx.beginPath(); ctx.ellipse(point.x, point.y, 4 + p * 23, 2 + p * 12, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (elapsed < 1050) { ctx.strokeStyle = '#d7f7ef'; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, p = (elapsed - 420) / 630; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * p * 22, y + Math.sin(a) * p * 12 - Math.sin(p * Math.PI) * 15); ctx.lineTo(x + Math.cos(a) * p * 26, y + Math.sin(a) * p * 15 - Math.sin(p * Math.PI) * 18); ctx.stroke(); } }
  }
  const dip = reducedMotion ? 0 : fishing.phase === 'bite' ? Math.sin(time / 55) * 4 : Math.sin(time / 300) * 1.2;
  if (!reducedMotion && (fishing.phase === 'bite' || fishing.reeling)) {
    ctx.strokeStyle = fishing.phase === 'bite' ? '#ffe6b4' : '#d2e8dc88'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + time / 1000, r = 13 + i % 3 * 3; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.lineTo(x + Math.cos(a) * (r + 9), y + Math.sin(a) * (r + 9)); ctx.stroke(); }
  }
  if (fishing.distanceM !== undefined) {
    const lx = tip.x + (x - tip.x) * .2, ly = tip.y + (y - tip.y) * .2 - 18;
    ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#122f35'; ctx.fillStyle = '#f4edca';
    const label = formatFishingDistance(fishing.distanceM);
    ctx.strokeText(label, lx, ly); ctx.fillText(label, lx, ly);
  }
  ctx.fillStyle = '#e58a77'; ctx.beginPath(); ctx.ellipse(x, y + dip, 4, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff2ca'; ctx.fillRect(x - 3, y + dip, 6, 3); ctx.restore();
}
