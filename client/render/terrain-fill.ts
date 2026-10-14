/** Paint adjoining opaque pieces together so antialiasing cannot reveal the layer below. */
export function fillTerrainPaths(ctx: CanvasRenderingContext2D, pieces: ReadonlyMap<string | CanvasPattern, Path2D>): void {
  if (!pieces.size) return;
  const [[base]] = pieces;
  const footprint = new Path2D();
  for (const path of pieces.values()) footprint.addPath(path);
  ctx.save();
  ctx.fillStyle = base; ctx.fill(footprint);
  // The continuous undercoat also covers joints between different materials.
  for (const [paint, path] of pieces) if (paint !== base) {
    ctx.fillStyle = paint; ctx.fill(path);
  }
  ctx.restore();
}

/** Round a fill outwards to device pixels, including fractional camera translation. */
export function fillTerrainRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  const t = ctx.getTransform();
  if (t.b || t.c || !t.a || !t.d) { ctx.fillRect(x, y, width, height); return; }
  const left = Math.floor(Math.min(x * t.a + t.e, (x + width) * t.a + t.e));
  const right = Math.ceil(Math.max(x * t.a + t.e, (x + width) * t.a + t.e));
  const top = Math.floor(Math.min(y * t.d + t.f, (y + height) * t.d + t.f));
  const bottom = Math.ceil(Math.max(y * t.d + t.f, (y + height) * t.d + t.f));
  ctx.fillRect((left - t.e) / t.a, (top - t.f) / t.d, (right - left) / t.a, (bottom - top) / t.d);
}
