import { TILE_SIZE } from '../shared/config';
import type { AssetPlacement, WorldAsset } from '../shared/world-schema';
import { worldAssetVisual, DEFAULT_ASSET_FADE } from '../shared/world-schema';
import { AssetFadeTransitions, makeAssetFadeMask } from './world-asset-fade';
import { drawWorldFire } from './world-fire-art';
import { coordinateHash } from '../shared/coordinate-random';

/** Shared by the game and editor. Each source is decoded once; SVG is rasterized outside the frame loop.
 * Cache pressure is bounded by both pixels and entries, independent of catalog size. */
export class WorldAssetArt {
  private cache = new Map<string, HTMLCanvasElement>();
  private pending = new Set<string>();
  private failed = new Set<string>();
  private pixels = 0;
  private transitions = new AssetFadeTransitions();
  private fireSurface?: HTMLCanvasElement;
  private fadeSurface?: HTMLCanvasElement;
  constructor(private redraw: () => void = () => {}) {}
  fadeAmount(a: WorldAsset, p: AssetPlacement, active: boolean, time: number, channel = 'local'): number { return this.transitions.amount(`${p.id}:${channel}`, a, active, time); }
  private remember(key: string, bitmap: HTMLCanvasElement): HTMLCanvasElement {
    this.cache.set(key, bitmap); this.pixels += bitmap.width * bitmap.height;
    while (this.cache.size > 256 || this.pixels > 16_000_000) { const first = this.cache.keys().next().value!, item = this.cache.get(first)!; this.pixels -= item.width * item.height; this.cache.delete(first); }
    return bitmap;
  }
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
          this.remember(key, bitmap);
        } catch { this.failed.add(key); }
        this.pending.delete(key); this.redraw();
      };
      image.onerror = () => { this.pending.delete(key); this.failed.add(key); this.redraw(); };
      image.src = a.image;
    }
    return undefined;
  }
  private faded(a: WorldAsset, image: HTMLCanvasElement, strength: number, dynamic = false, hidingStrength = strength): HTMLCanvasElement {
    const fade = a.fade ?? DEFAULT_ASSET_FADE, bucket = Math.round(Math.max(0, Math.min(1, strength)) * 16);
    const hidingBucket = Math.round(Math.max(0, Math.min(1, hidingStrength)) * 16);
    if (!bucket && !hidingBucket) return image;
    const maskKey = `mask:${image.width}:${image.height}:${a.width}:${a.height}:${a.cells.map(c => c.visibility).join(',')}:${fade.feather}`;
    const key = `${a.image}:${maskKey}:${fade.opacity}:${bucket}:${hidingBucket}`;
    const cached = !dynamic && this.cache.get(key); if (cached) return cached;
    const bitmap = dynamic ? (this.fadeSurface ??= document.createElement('canvas')) : document.createElement('canvas');
    bitmap.width = image.width; bitmap.height = image.height;
    const paint = bitmap.getContext('2d')!; paint.drawImage(image, 0, 0);
    paint.globalCompositeOperation = 'destination-out';
    for (const [visibility, amount] of [['fade', bucket], ['hide-fade', hidingBucket]] as const) {
      if (!amount) continue;
      const channelKey = `${maskKey}:${visibility}`;
      const mask = this.cache.get(channelKey) ?? this.remember(channelKey, makeAssetFadeMask(a, image.width, image.height, visibility));
      paint.globalAlpha = amount / 16 * (1 - fade.opacity); paint.drawImage(mask, 0, 0);
    }
    return dynamic ? bitmap : this.remember(key, bitmap);
  }
  draw(ctx: CanvasRenderingContext2D, a: WorldAsset, p: AssetPlacement, opacity = 1, unit = TILE_SIZE, time = 0, fade = 0, hidingFade = fade): void {
    const visual = worldAssetVisual(a);
    if (visual.kind === 'fire' && fade <= 0 && hidingFade <= 0) {
      ctx.save(); ctx.globalAlpha *= opacity;
      ctx.translate(p.x * unit, p.y * unit); ctx.scale(a.width * unit / TILE_SIZE, a.height * unit / TILE_SIZE);
      drawWorldFire(ctx, visual.style, time, coordinateHash(p.x, p.y, 941) * 100);
      ctx.restore(); return;
    }
    let image: HTMLCanvasElement | undefined;
    if (visual.kind === 'fire') {
      image = this.fireSurface ??= document.createElement('canvas');
      const factor = Math.min(2, 1024 / (Math.max(a.width, a.height) * TILE_SIZE));
      image.width = Math.ceil(a.width * TILE_SIZE * factor); image.height = Math.ceil(a.height * TILE_SIZE * factor);
      const paint = image.getContext('2d')!; paint.scale(image.width / TILE_SIZE, image.height / TILE_SIZE); drawWorldFire(paint, visual.style, time, coordinateHash(p.x, p.y, 941) * 100);
    } else image = this.image(a);
    if (image && (fade > 0 || hidingFade > 0)) image = this.faded(a, image, fade, visual.kind === 'fire', hidingFade);
    ctx.save(); ctx.globalAlpha *= opacity;
    if (image) ctx.drawImage(image, p.x * unit, p.y * unit, a.width * unit, a.height * unit);
    else { ctx.fillStyle = '#86ab8544'; ctx.fillRect(p.x * unit, p.y * unit, a.width * unit, a.height * unit); }
    ctx.restore();
  }
}
