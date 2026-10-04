/** Camera uses CSS pixels; device pixel ratio affects rendering only, never cell picking. */
export class AssetGridCamera {
  zoom = 1;
  private x = 0;
  private y = 0;
  private frame?: { left: number; top: number; right: number; bottom: number; columns: number; rows: number };
  fit(): void { this.zoom = 1; this.x = this.y = 0; this.frame = undefined; }
  pan(dx: number, dy: number): void { this.x += dx; this.y += dy; }
  layout(width: number, height: number, columns: number, rows: number, image?: { x: number; y: number; width: number; height: number }) {
    // Keep the camera stationary while artwork is dragged; “Adatta” reframes overflow.
    if (!this.frame || this.frame.columns !== columns || this.frame.rows !== rows) this.frame = {
      left: Math.min(0, image?.x ?? 0), top: Math.min(0, image?.y ?? 0),
      right: Math.max(columns, image ? image.x + image.width : columns), bottom: Math.max(rows, image ? image.y + image.height : rows), columns, rows };
    const { left, top, right, bottom } = this.frame;
    const s = Math.max(1, Math.min((width - 28) / (right - left), (height - 28) / (bottom - top))) * this.zoom;
    return { s, x: (width - (right + left) * s) / 2 + this.x, y: (height - (bottom + top) * s) / 2 + this.y };
  }
  zoomAt(factor: number, px: number, py: number, width: number, height: number, columns: number, rows: number, image?: { x: number; y: number; width: number; height: number }): void {
    const before = this.layout(width, height, columns, rows, image);
    this.zoom = Math.max(.25, Math.min(32, this.zoom * factor));
    const after = this.layout(width, height, columns, rows, image);
    this.x += px - (px - before.x) * after.s / before.s - after.x;
    this.y += py - (py - before.y) * after.s / before.s - after.y;
  }
}
