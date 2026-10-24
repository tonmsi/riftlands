import { TILE_SIZE } from '../../shared/config';
import type { AssetPlacement, WorldAsset } from '../../shared/world-schema';
import { worldAssetVisual, worldAssetImageBounds, DEFAULT_ASSET_FADE } from '../../shared/world-schema';
import { AssetFadeTransitions, makeAssetFadeMask } from './world-asset-fade';
import { drawWorldFire } from './world-fire-art';
import { EnvironmentArt } from './environment-art';
import { coordinateHash } from '../../shared/coordinate-random';
import { performanceLog as perf } from '../core/performance-log';
import { rasterizeAssetShadow } from './world-asset-shadow';

/** Shared by the game and editor. Each source is decoded once; SVG is rasterized outside the frame loop.
 * Cache pressure is bounded by both pixels and entries, independent of catalog size. */
export class WorldAssetArt {
  revision = 0;
  performanceInfo(){return {entries:this.cache.size,pixels:this.pixels,pending:this.pending.size,failed:this.failed.size,
    dynamicPixels:(this.fireSurface?this.fireSurface.width*this.fireSurface.height:0)+(this.fadeSurface?this.fadeSurface.width*this.fadeSurface.height:0)};}
  private cache = new Map<string, HTMLCanvasElement>();
  private pending = new Set<string>();
  private failed = new Set<string>();
  private loading = new Map<string, Promise<void>>();
  private bushArt?: EnvironmentArt;
  private pixels = 0;
  private transitions = new AssetFadeTransitions();
  private fireSurface?: HTMLCanvasElement;
  private fadeSurface?: HTMLCanvasElement;
  constructor(private redraw: () => void = () => {}) {}
  fadeAmount(a: WorldAsset, p: AssetPlacement, active: boolean, time: number, channel = 'local'): number { return this.transitions.amount(`${p.id}:${channel}`, a, active, time); }
  private remember(key: string, bitmap: HTMLCanvasElement): HTMLCanvasElement {
    this.revision++;
    this.cache.set(key, bitmap); this.pixels += bitmap.width * bitmap.height;
    while (this.cache.size > 256 || this.pixels > 16_000_000) { const first = this.cache.keys().next().value!, item = this.cache.get(first)!; this.pixels -= item.width * item.height; this.cache.delete(first); }
    return bitmap;
  }
  image(a: WorldAsset, includeShadow = true): HTMLCanvasElement | undefined {
    if (includeShadow && a.shadow && worldAssetVisual(a).kind === 'image') {
      const source = this.image(a, false);
      if (!source) return undefined;
      const b = worldAssetImageBounds(a), key = `shadow:${a.image}:${b.width}:${b.height}:${JSON.stringify(a.shadow)}`;
      const cached = this.cache.get(key);
      if (cached) { this.cache.delete(key); this.cache.set(key, cached); return cached; }
      const bitmap = rasterizeAssetShadow(source.width, source.height, a.shadow, source);
      bitmap.getContext('2d')!.drawImage(source, 0, 0);
      return this.remember(key, bitmap);
    }
    const b = worldAssetImageBounds(a);
    const key = `${a.image}:${b.width}:${b.height}`, cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); return cached; }
    if (!this.pending.has(key) && !this.failed.has(key) && this.pending.size < 8) {
      this.pending.add(key);
      let complete!: () => void;
      this.loading.set(key, new Promise<void>(resolve => { complete = resolve; }));
      const finish = () => { this.pending.delete(key); this.loading.delete(key); this.redraw(); complete(); };
      const image = new Image(); image.decoding = 'async';
      image.onload = () => {
        const start=perf.begin();
        try {
          const bitmap = document.createElement('canvas');
          const factor = Math.min(2, 1024 / (Math.max(b.width, b.height) * TILE_SIZE));
          bitmap.width = Math.max(1, Math.ceil(b.width * TILE_SIZE * factor)); bitmap.height = Math.max(1, Math.ceil(b.height * TILE_SIZE * factor));
          bitmap.getContext('2d')!.drawImage(image, 0, 0, bitmap.width, bitmap.height);
          this.remember(key, bitmap);
        } catch { this.failed.add(key); }
        finish();
        perf.end('map-asset-raster',start);
      };
      image.onerror = () => { this.failed.add(key); finish(); };
      image.src = a.image;
    }
    return undefined;
  }
  ready(a: WorldAsset): Promise<void> {
    const b = worldAssetImageBounds(a); this.image(a);
    return this.loading.get(`${a.image}:${b.width}:${b.height}`) ?? Promise.resolve();
  }
  private jsBush(a: WorldAsset, p: Pick<AssetPlacement, 'x' | 'y'>): HTMLCanvasElement {
    const b = worldAssetImageBounds(a), variant = Math.floor(coordinateHash(p.x, p.y, 99127) * 4);
    const key = `js-bush:${variant}:${b.width}:${b.height}`, cached = this.cache.get(key);
    if (cached) return cached;
    const bitmap = document.createElement('canvas');
    bitmap.width = Math.max(1, Math.ceil(b.width * TILE_SIZE * 2)); bitmap.height = Math.max(1, Math.ceil(b.height * TILE_SIZE * 2));
    const ctx = bitmap.getContext('2d')!;
    ctx.scale(bitmap.width / 88, bitmap.height / 88);
    (this.bushArt ??= new EnvironmentArt()).draw(ctx, 'bush', 20, 20, variant / 4);
    return this.remember(key, bitmap);
  }
  /** Pick the visible artwork, not the whole grid or its transparent PNG margins. */
  hit(a: WorldAsset, p: Pick<AssetPlacement, 'x' | 'y' | 'bushJs'>, x: number, y: number): boolean {
    const b = worldAssetImageBounds(a), u = (x - p.x - b.x) / b.width, v = (y - p.y - b.y) / b.height;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return false;
    if (worldAssetVisual(a).kind === 'fire') return true;
    const bitmap = p.bushJs ? this.jsBush(a, p) : this.image(a, false);
    if (!bitmap) return true;
    try { return bitmap.getContext('2d')!.getImageData(Math.floor(u * bitmap.width), Math.floor(v * bitmap.height), 1, 1).data[3] >= 16; }
    catch { return true; }
  }
  private faded(a: WorldAsset, image: HTMLCanvasElement, strength: number, dynamic = false, hidingStrength = strength, source = a.image): HTMLCanvasElement {
    const fade = a.fade ?? DEFAULT_ASSET_FADE, bucket = Math.round(Math.max(0, Math.min(1, strength)) * 16);
    const hidingBucket = Math.round(Math.max(0, Math.min(1, hidingStrength)) * 16);
    if (!bucket && !hidingBucket) return image;
    const maskKey = `mask:${image.width}:${image.height}:${a.width}:${a.height}:${a.cellSubdivision ?? 1}:${JSON.stringify(a.imageTransform)}:${a.cells.map(c => c.visibility).join(',')}:${fade.feather}`;
    const key = `${source}:${maskKey}:${fade.opacity}:${bucket}:${hidingBucket}`;
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
    const visual = worldAssetVisual(a), b = worldAssetImageBounds(a);
    if (visual.kind === 'fire' && fade <= 0 && hidingFade <= 0) {
      ctx.save(); ctx.globalAlpha *= opacity;
      ctx.translate((p.x + b.x) * unit, (p.y + b.y) * unit); ctx.scale(b.width * unit / TILE_SIZE, b.height * unit / TILE_SIZE);
      drawWorldFire(ctx, visual.style, time, coordinateHash(p.x, p.y, 941) * 100);
      ctx.restore(); return;
    }
    let image: HTMLCanvasElement | undefined;
    if (visual.kind === 'fire') {
      image = this.fireSurface ??= document.createElement('canvas');
      const factor = Math.min(2, 1024 / (Math.max(b.width, b.height) * TILE_SIZE));
      image.width = Math.max(1, Math.ceil(b.width * TILE_SIZE * factor)); image.height = Math.max(1, Math.ceil(b.height * TILE_SIZE * factor));
      const paint = image.getContext('2d')!; paint.scale(image.width / TILE_SIZE, image.height / TILE_SIZE); drawWorldFire(paint, visual.style, time, coordinateHash(p.x, p.y, 941) * 100);
    } else image = p.bushJs ? this.jsBush(a, p) : this.image(a);
    if (image && (fade > 0 || hidingFade > 0)) image = this.faded(a, image, fade, visual.kind === 'fire', hidingFade,
      p.bushJs ? `js-bush:${Math.floor(coordinateHash(p.x, p.y, 99127) * 4)}` : `${a.image}:${JSON.stringify(a.shadow)}`);
    ctx.save(); ctx.globalAlpha *= opacity;
    if (image) ctx.drawImage(image, (p.x + b.x) * unit, (p.y + b.y) * unit, b.width * unit, b.height * unit);
    else { ctx.fillStyle = '#86ab8544'; ctx.fillRect((p.x + b.x) * unit, (p.y + b.y) * unit, b.width * unit, b.height * unit); }
    ctx.restore();
  }
}
