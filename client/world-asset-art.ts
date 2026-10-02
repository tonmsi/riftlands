import { TILE_SIZE } from '../shared/config';
import type { AssetPlacement, WorldAsset } from '../shared/world-schema';
import { worldAssetVisual } from '../shared/world-schema';
import { drawWorldFire } from './world-fire-art';
import { coordinateHash } from '../shared/coordinate-random';

/** Shared by the game and editor. Each source is decoded once; SVG is rasterized outside the frame loop.
 * Cache pressure is bounded by both pixels and entries, independent of catalog size. */
export class WorldAssetArt {
  private cache = new Map<string, HTMLCanvasElement>();
  private pending = new Set<string>();
  private failed = new Set<string>();
  private pixels = 0;
  constructor(private redraw: () => void = () => {}) {}
  image(a: WorldAsset): HTMLCanvasElement | undefined {
    const key = `${a.image}:${a.width}:${a.height}`, cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); return cached; }
    if (!this.pending.has(key) && !this.failed.has(key) && this.pending.size < 8) {
      this.pending.add(key);
      const image = new Image(); image.decoding = 'async';
      image.onload = () => {
        try {
          const bitmap = document.createElement('canvas');
          const factor = Math.min(2, 1024 / (Math.max(a.width, a.height) * TILE_SIZE));
          bitmap.width = Math.max(1, Math.ceil(a.width * TILE_SIZE * factor)); bitmap.height = Math.max(1, Math.ceil(a.height * TILE_SIZE * factor));
          bitmap.getContext('2d')!.drawImage(image, 0, 0, bitmap.width, bitmap.height);
          this.cache.set(key, bitmap); this.pixels += bitmap.width * bitmap.height;
          while (this.cache.size > 256 || this.pixels > 16_000_000) {
            const first = this.cache.keys().next().value!, item = this.cache.get(first)!;
            this.pixels -= item.width * item.height; this.cache.delete(first);
          }
        } catch { this.failed.add(key); }
        this.pending.delete(key); this.redraw();
      };
      image.onerror = () => { this.pending.delete(key); this.failed.add(key); this.redraw(); };
      image.src = a.image;
    }
    return undefined;
  }
  draw(ctx: CanvasRenderingContext2D, a: WorldAsset, p: AssetPlacement, opacity = 1, unit = TILE_SIZE, time = 0): void {
    const visual = worldAssetVisual(a);
    if (visual.kind === 'fire') {
      ctx.save(); ctx.globalAlpha *= opacity;
      ctx.translate(p.x * unit, p.y * unit); ctx.scale(a.width * unit / TILE_SIZE, a.height * unit / TILE_SIZE);
      drawWorldFire(ctx, visual.style, time, coordinateHash(p.x, p.y, 941) * 100);
      ctx.restore(); return;
    }
    const image = this.image(a);
    ctx.save(); ctx.globalAlpha *= opacity;
    if (image) ctx.drawImage(image, p.x * unit, p.y * unit, a.width * unit, a.height * unit);
    else { ctx.fillStyle = '#86ab8544'; ctx.fillRect(p.x * unit, p.y * unit, a.width * unit, a.height * unit); }
    ctx.restore();
  }
}
