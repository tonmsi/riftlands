import { ITEM_DEFINITIONS } from '../../../shared/items';
/** Shared procedural artwork for world drops and the inventory; no external image needed. */
export function drawItemArt(ctx: CanvasRenderingContext2D, itemId: string, size: number, time = 0): void {
  if (!Object.hasOwn(ITEM_DEFINITIONS, itemId)) return;
  ctx.save(); ctx.scale(size / 48, size / 48);
  const item = ITEM_DEFINITIONS[itemId];
  if (item.appearance === 'backpack') {
    const colors = ['#98704b', '#98704b', '#718856', '#537f91', '#8e6ca6'];
    ctx.lineWidth = 3; ctx.strokeStyle = '#ddc9a1'; ctx.beginPath(); ctx.roundRect(17, 5, 14, 12, 5); ctx.stroke();
    ctx.fillStyle = '#382e25'; ctx.beginPath(); ctx.roundRect(6, 19, 36, 24, 7); ctx.fill();
    ctx.fillStyle = colors[(item.backpackSlots ?? 2) - 1]; ctx.strokeStyle = '#e0c7a5'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(10, 12, 28, 32, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d5b78a'; ctx.beginPath(); ctx.roundRect(11, 11, 26, 13, 5); ctx.fill();
    ctx.fillStyle = '#67533c'; ctx.beginPath(); ctx.roundRect(16, 29, 16, 10, 3); ctx.fill();
    ctx.fillStyle = '#efd9a1'; ctx.fillRect(21, 19, 6, 7); ctx.restore(); return;
  }
  if (item.appearance === 'potion') {
    ctx.fillStyle = '#c6e9ec'; ctx.strokeStyle = '#d6f4ef'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(18, 10); ctx.lineTo(30, 10); ctx.lineTo(30, 19); ctx.bezierCurveTo(46, 34, 36, 44, 24, 44); ctx.bezierCurveTo(12, 44, 2, 34, 18, 19); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#db6270'; ctx.beginPath(); ctx.ellipse(24, 33, 12, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#a77d4c'; ctx.beginPath(); ctx.roundRect(17, 5, 14, 8, 2); ctx.fill();
    ctx.fillStyle = '#fff3d4'; ctx.fillRect(22, 27, 4, 11); ctx.fillRect(18.5, 30.5, 11, 4);
    ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(14, 25); ctx.lineTo(12, 31); ctx.stroke(); ctx.restore(); return;
  }
  if (item.appearance === 'gold') {
    ctx.lineWidth = 1.5;
    for (const [x, y] of [[15, 30], [33, 28], [24, 17]]) {
      ctx.fillStyle = '#c68d37'; ctx.strokeStyle = '#785421'; ctx.beginPath(); ctx.ellipse(x, y + 3, 10, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#efc66e'; ctx.strokeStyle = '#fff0b3'; ctx.beginPath(); ctx.ellipse(x, y, 9, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#a6752a'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('•', x, y + 4);
    }
    ctx.restore(); return;
  }
  const gradient = ctx.createRadialGradient(17, 17, 1, 24, 24, 21); gradient.addColorStop(0, '#b9d775'); gradient.addColorStop(.65, '#71864d'); gradient.addColorStop(1, '#354532');
  ctx.fillStyle = gradient; ctx.strokeStyle = '#d7dfa283'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(8, 24); ctx.bezierCurveTo(3, 12, 20, 3, 27, 10); ctx.bezierCurveTo(43, 3, 48, 25, 35, 37); ctx.bezierCurveTo(20, 47, 4, 38, 8, 24); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#bdce84'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(14, 21); ctx.bezierCurveTo(37, 13, 14, 34, 31, 29); ctx.stroke();
  ctx.strokeStyle = '#405530'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(16, 18); ctx.bezierCurveTo(36, 21, 14, 31, 30, 32); ctx.stroke();
  ctx.fillStyle = '#ecf3b4b0'; ctx.beginPath(); ctx.ellipse(14, 13, 4, 2, -.5, 0, Math.PI * 2); ctx.fill();
  if (time) { ctx.strokeStyle = '#aec77b50'; ctx.lineWidth = 1; for (let i = 0; i < 2; i++) { const y = -3 - ((time / 130 + i * 7) % 15); ctx.beginPath(); ctx.moveTo(20 + i * 10, y + 5); ctx.quadraticCurveTo(14 + i * 10, y, 21 + i * 10, y - 3); ctx.stroke(); } }
  ctx.restore();
}
