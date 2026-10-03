import type { Pickup } from '../shared/types';

export const PICKUP_COLORS: Record<Pickup['kind'], string> = {
  heal: '#b6e5aa', haste: '#a5dbe2', power: '#e5cc81', weakness: '#bb99cb',
};
export function noise(x: number, y: number, offset = 0): number {
  let n = Math.imul(x ^ (offset * 713), 374761393) + Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
export function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
}

export function polygon(ctx: CanvasRenderingContext2D, points: number[]): void {
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 2) {
    if (!i) ctx.moveTo(points[i], points[i + 1]);
    else ctx.lineTo(points[i], points[i + 1]);
  }
  ctx.closePath();
}
