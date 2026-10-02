/** Camera uses CSS pixels; device pixel ratio affects rendering only, never cell picking. */
export class AssetGridCamera {
  zoom = 1;
  private x = 0;
  private y = 0;
  fit(): void { this.zoom = 1; this.x = this.y = 0; }
  pan(dx: number, dy: number): void { this.x += dx; this.y += dy; }
  layout(width: number, height: number, columns: number, rows: number) {
    const s = Math.max(1, Math.min((width - 28) / columns, (height - 28) / rows)) * this.zoom;
    return { s, x: (width - columns * s) / 2 + this.x, y: (height - rows * s) / 2 + this.y };
  }
  zoomAt(factor: number, px: number, py: number, width: number, height: number, columns: number, rows: number): void {
    const before = this.layout(width, height, columns, rows);
    this.zoom = Math.max(.25, Math.min(32, this.zoom * factor));
    const after = this.layout(width, height, columns, rows);
    this.x += px - (px - before.x) * after.s / before.s - after.x;
    this.y += py - (py - before.y) * after.s / before.s - after.y;
  }
}
