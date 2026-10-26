import type { WorldAsset } from '../../shared/world-schema';
import { worldAssetImageBounds } from '../../shared/world-schema';
import { spritesheetLayout } from '../../shared/asset-sprites';
import { TILE_SIZE } from '../../shared/config';
import { rasterizeAssetShadow } from './world-asset-shadow';

interface Sheet { canvas: HTMLCanvasElement; columns: number; width: number; height: number; first?: HTMLCanvasElement; }
/** Scaled frame atlases, prepared once. Timing changes reuse the same pixel data. */
export class AssetSpriteArt {
  private cache = new Map<string, Sheet>();
  private pending = new Map<string, Promise<void>>();
  private failed = new Set<string>();
  private pixels = 0;
  constructor(private redraw: () => void) {}
  stats() { return { entries: this.cache.size, pixels: this.pixels, pending: this.pending.size, failed: this.failed.size }; }
  private key(a: WorldAsset, shadow: boolean): string {
    const b = worldAssetImageBounds(a), s = a.animation!;
    return JSON.stringify([a.image,b.width,b.height,s.frameWidth,s.frameHeight,s.frames,shadow ? a.shadow : null]);
  }
  get(a: WorldAsset, shadow = true): Sheet | undefined {
    const key = this.key(a, shadow), cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); return cached; }
    if (this.pending.has(key) || this.failed.has(key) || this.pending.size >= 2) return;
    let complete!: () => void; this.pending.set(key, new Promise<void>(resolve => complete = resolve));
    const image = new Image(); image.decoding = 'async';
    const finish = () => { this.pending.delete(key); complete(); this.redraw(); };
    image.onload = () => {
      try {
        const s = a.animation!, source = spritesheetLayout(s, image.naturalWidth, image.naturalHeight), b = worldAssetImageBounds(a);
        const columns = Math.ceil(Math.sqrt(s.frames)), rows = Math.ceil(s.frames / columns);
        const factor = Math.min(2, 1024 / (Math.max(b.width,b.height)*TILE_SIZE), Math.sqrt(2_000_000 / (columns*rows*b.width*b.height*TILE_SIZE*TILE_SIZE)));
        const width = Math.max(1, Math.floor(b.width*TILE_SIZE*factor)), height = Math.max(1, Math.floor(b.height*TILE_SIZE*factor));
        const canvas = document.createElement('canvas'); canvas.width = width*columns; canvas.height = height*rows;
        const paint = canvas.getContext('2d')!, frame = document.createElement('canvas'); frame.width = width; frame.height = height;
        const ctx = frame.getContext('2d')!;
        for (let i = 0; i < s.frames; i++) {
          ctx.clearRect(0,0,width,height);
          ctx.drawImage(image,(i%source.columns)*s.frameWidth,Math.floor(i/source.columns)*s.frameHeight,s.frameWidth,s.frameHeight,0,0,width,height);
          const x = (i%columns)*width, y = Math.floor(i/columns)*height;
          if (shadow && a.shadow) paint.drawImage(rasterizeAssetShadow(width,height,a.shadow,frame),x,y);
          paint.drawImage(frame,x,y);
        }
        this.cache.set(key,{canvas,columns,width,height}); this.pixels += canvas.width*canvas.height; this.trim();
      } catch { this.failed.add(key); if (this.failed.size > 256) this.failed.delete(this.failed.keys().next().value!); }
      finish();
    };
    image.onerror = () => { this.failed.add(key); finish(); }; image.src = a.image;
  }
  private trim(): void {
    while (this.cache.size > 32 || this.pixels > 8_000_000) {
      const key = this.cache.keys().next().value!, s = this.cache.get(key)!;
      this.pixels -= s.canvas.width*s.canvas.height + (s.first ? s.first.width*s.first.height : 0); this.cache.delete(key);
    }
  }
  image(a: WorldAsset, shadow: boolean): HTMLCanvasElement | undefined {
    const s = this.get(a,shadow); if (!s) return;
    if (!s.first) {
      s.first = document.createElement('canvas'); s.first.width = s.width; s.first.height = s.height;
      s.first.getContext('2d')!.drawImage(s.canvas,0,0,s.width,s.height,0,0,s.width,s.height);
      this.pixels += s.width*s.height; this.trim();
    }
    return s.first;
  }
  async ready(a: WorldAsset): Promise<void> {
    const key = this.key(a,true); this.get(a);
    if (this.pending.has(key)) await this.pending.get(key);
    else if (!this.failed.has(key) && !this.cache.has(key) && this.pending.size) { await Promise.all(this.pending.values()); await this.ready(a); }
  }
}
