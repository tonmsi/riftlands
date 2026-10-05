import { ITEM_DEFINITIONS } from '../../../shared/items';
/** Shared procedural artwork for world drops and the inventory; no external image needed. */
export function drawItemArt(ctx: CanvasRenderingContext2D, itemId: string, size: number, time = 0): void {
  if (!Object.hasOwn(ITEM_DEFINITIONS, itemId)) return;
  ctx.save(); ctx.scale(size / 48, size / 48);
  const gradient = ctx.createRadialGradient(17, 17, 1, 24, 24, 21); gradient.addColorStop(0, '#b9d775'); gradient.addColorStop(.65, '#71864d'); gradient.addColorStop(1, '#354532');
  ctx.fillStyle = gradient; ctx.strokeStyle = '#d7dfa283'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(8, 24); ctx.bezierCurveTo(3, 12, 20, 3, 27, 10); ctx.bezierCurveTo(43, 3, 48, 25, 35, 37); ctx.bezierCurveTo(20, 47, 4, 38, 8, 24); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#bdce84'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(14, 21); ctx.bezierCurveTo(37, 13, 14, 34, 31, 29); ctx.stroke();
  ctx.strokeStyle = '#405530'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(16, 18); ctx.bezierCurveTo(36, 21, 14, 31, 30, 32); ctx.stroke();
  ctx.fillStyle = '#ecf3b4b0'; ctx.beginPath(); ctx.ellipse(14, 13, 4, 2, -.5, 0, Math.PI * 2); ctx.fill();
  if (time) { ctx.strokeStyle = '#aec77b50'; ctx.lineWidth = 1; for (let i = 0; i < 2; i++) { const y = -3 - ((time / 130 + i * 7) % 15); ctx.beginPath(); ctx.moveTo(20 + i * 10, y + 5); ctx.quadraticCurveTo(14 + i * 10, y, 21 + i * 10, y - 3); ctx.stroke(); } }
  ctx.restore();
}
