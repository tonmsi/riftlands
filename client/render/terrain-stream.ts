import type { World } from '../../shared/world';
import type { TerrainViewport } from './render-types';

export interface TerrainBitmap {
  canvas: HTMLCanvasElement; world: World; scale: number;
  left: number; top: number; right: number; bottom: number;
}
type Painter = (bitmap: TerrainBitmap, time: number) => void;
const SIZE = 128, LIMIT = 128;

/** Fixed raster blocks survive camera movement; only unseen blocks need painting. */
export class TerrainStream {
  private world?: World;
  private scale = 0;
  private previous?: { x: number; y: number };
  private readonly tiles = new Map<string, TerrainBitmap>();
  constructor(private readonly paint: Painter) {}
  reset(): void { this.world = undefined; this.scale = 0; this.previous = undefined; this.tiles.clear(); }
  matches(world: World, scale: number): boolean { return this.world === world && this.scale === scale; }
  supported(view: TerrainViewport, scale: number): boolean {
    return scale >= .5 && (Math.ceil(view.width / view.zoom * scale / SIZE) + 1)
      * (Math.ceil(view.height / view.zoom * scale / SIZE) + 1) <= 80;
  }
  private bitmap(world: World, scale: number, x: number, y: number): TerrainBitmap {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = SIZE;
    return { canvas, world, scale, left: x * SIZE / scale, top: y * SIZE / scale,
      right: (x + 1) * SIZE / scale, bottom: (y + 1) * SIZE / scale };
  }
  private remember(x: number, y: number, bitmap: TerrainBitmap): void {
    const key = `${x},${y}`; this.tiles.delete(key); this.tiles.set(key, bitmap);
    while (this.tiles.size > LIMIT) this.tiles.delete(this.tiles.keys().next().value!);
  }
  seed(source: TerrainBitmap): void {
    this.reset(); this.world = source.world; this.scale = source.scale;
    // Reuse the initial complete paint instead of repainting dozens of cold blocks.
    const left = source.left * source.scale, top = source.top * source.scale;
    for (let y = Math.ceil(top / SIZE); (y + 1) * SIZE <= top + source.canvas.height; y++)
      for (let x = Math.ceil(left / SIZE); (x + 1) * SIZE <= left + source.canvas.width; x++) {
        const tile = this.bitmap(source.world, source.scale, x, y);
        tile.canvas.getContext('2d', { alpha: false })!.drawImage(source.canvas,
          Math.round(x * SIZE - left), Math.round(y * SIZE - top), SIZE, SIZE, 0, 0, SIZE, SIZE);
        this.remember(x, y, tile);
      }
  }
  draw(ctx: CanvasRenderingContext2D, view: TerrainViewport, time: number): void {
    const world = this.world!, scale = this.scale;
    const halfWidth = view.width / (2 * view.zoom), halfHeight = view.height / (2 * view.zoom);
    const ranges = (x: number, y: number) => ({
      left: Math.floor((x - halfWidth) * scale / SIZE), right: Math.ceil((x + halfWidth) * scale / SIZE) - 1,
      top: Math.floor((y - halfHeight) * scale / SIZE), bottom: Math.ceil((y + halfHeight) * scale / SIZE) - 1,
    });
    const visible = ranges(view.camera.x, view.camera.y);
    for (let y = visible.top; y <= visible.bottom; y++) for (let x = visible.left; x <= visible.right; x++) {
      let tile = this.tiles.get(`${x},${y}`);
      // Teleports and unusually fast motion can outrun prefetch; never show an empty tile.
      if (!tile) { tile = this.bitmap(world, scale, x, y); this.paint(tile, time); }
      this.remember(x, y, tile);
      ctx.drawImage(tile.canvas, tile.left, tile.top, SIZE / scale, SIZE / scale);
    }
    const lead = (value: number) => Math.max(-128, Math.min(128, value * 24));
    const x = view.camera.x + lead(this.previous ? view.camera.x - this.previous.x : 0);
    const y = view.camera.y + lead(this.previous ? view.camera.y - this.previous.y : 0);
    this.previous = { x: view.camera.x, y: view.camera.y };
    const ahead = ranges(x, y);
    let candidate: { x: number; y: number; score: number } | undefined;
    for (let ty = ahead.top - 1; ty <= ahead.bottom + 1; ty++) for (let tx = ahead.left - 1; tx <= ahead.right + 1; tx++) {
      if (this.tiles.has(`${tx},${ty}`)) continue;
      const score = ((tx + .5) * SIZE - x * scale) ** 2 + ((ty + .5) * SIZE - y * scale) ** 2;
      if (!candidate || score < candidate.score) candidate = { x: tx, y: ty, score };
    }
    // A bounded amount of new terrain work each frame, before it enters the viewport.
    if (candidate) {
      const tile = this.bitmap(world, scale, candidate.x, candidate.y); this.paint(tile, time);
      this.remember(candidate.x, candidate.y, tile);
    }
  }
}
