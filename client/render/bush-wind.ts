/** Small shear around the image base. Reuses the bitmap; collision coordinates never move. */
export function bushWindShear(time: number, phase: number): number {
  return (Math.sin(time * .0017 + phase * Math.PI * 2) + .3 * Math.sin(time * .0009 + phase * 13)) * .022;
}
export function applyBushWind(ctx: CanvasRenderingContext2D, baseY: number, time: number, phase: number): void {
  ctx.translate(0, baseY); ctx.transform(1, 0, bushWindShear(time, phase), 1, 0, 0); ctx.translate(0, -baseY);
}
