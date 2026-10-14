import { loadImage } from './sprite-sheet';
import type { ActorVisual, SpriteAnimation } from '../../shared/actor-catalog';
import { animationFrame, resolveAnimation, type AnimationState } from './actor-animation';
const GUTTER = 2;

/** Shared by the game and the visual editor; all image slicing happens outside draw(). */
export class ActorSpriteRenderer {
  private readonly sheets = new Map<string, { atlas: HTMLCanvasElement; width: number; height: number; ratio: number }>();
  private readonly jobs = new Map<string, Promise<void>>();
  constructor(private readonly maxFrameSize = Infinity) {}
  private key(a: SpriteAnimation) { return `${a.asset}:${a.columns}:${a.rows}`; }
  async prepare(visual: ActorVisual): Promise<void> {
    await Promise.all(Object.values(visual.animations).map(a => {
      const key = this.key(a), existing = this.jobs.get(key);
      if (existing) return existing;
      const job = loadImage(a.asset).then(image => {
        if (image.naturalWidth % a.columns || image.naturalHeight % a.rows) throw new Error(`Griglia spritesheet non compatibile: ${a.asset}`);
        const width = image.naturalWidth / a.columns, height = image.naturalHeight / a.rows;
        if (width < 1 || height < 1 || image.naturalWidth * image.naturalHeight > 32_000_000) throw new Error('Spritesheet troppo grande o non valido.');
        const scale = Math.min(1, this.maxFrameSize / Math.max(width, height));
        const cachedWidth = Math.max(1, Math.round(width * scale)), cachedHeight = Math.max(1, Math.round(height * scale));
        const strideX = cachedWidth + GUTTER * 2, strideY = cachedHeight + GUTTER * 2;
        const atlas = document.createElement('canvas'); atlas.width = strideX * a.columns; atlas.height = strideY * a.rows;
        const paint = atlas.getContext('2d')!;
        for (let y = 0; y < a.rows; y++) for (let x = 0; x < a.columns; x++) {
          const left = x * strideX + GUTTER, top = y * strideY + GUTTER;
          paint.drawImage(image, x * width, y * height, width, height, left, top, cachedWidth, cachedHeight);
          // Extruded edges reproduce isolated-frame clamping when a scaled crop is filtered.
          paint.imageSmoothingEnabled = false;
          paint.drawImage(atlas, left, top, cachedWidth, 1, left, top - GUTTER, cachedWidth, GUTTER);
          paint.drawImage(atlas, left, top + cachedHeight - 1, cachedWidth, 1, left, top + cachedHeight, cachedWidth, GUTTER);
          paint.drawImage(atlas, left, top - GUTTER, 1, strideY, left - GUTTER, top - GUTTER, GUTTER, strideY);
          paint.drawImage(atlas, left + cachedWidth - 1, top - GUTTER, 1, strideY, left + cachedWidth, top - GUTTER, GUTTER, strideY);
          paint.imageSmoothingEnabled = true;
        }
        this.sheets.set(key, { atlas, width: cachedWidth, height: cachedHeight, ratio: height / width });
      });
      const retryable = job.catch(error => { this.jobs.delete(key); throw error; });
      this.jobs.set(key, retryable); return retryable;
    }));
  }
  bounds(visual: ActorVisual, animation: SpriteAnimation) {
    const anchor = animation.anchor ?? visual.anchor, offset = animation.offset ?? visual.offset;
    const width = visual.drawSize, height = width * (this.sheets.get(this.key(animation))?.ratio ?? 1);
    return { x: -width * anchor.x + offset.x, y: -height * anchor.y + offset.y, width, height };
  }
  draw(ctx: CanvasRenderingContext2D, visual: ActorVisual, state: AnimationState, row = 0): boolean {
    const resolved = resolveAnimation(visual, state); if (!resolved) return false;
    const a = resolved.animation; state = resolved.state;
    const sheet = this.sheets.get(this.key(a)); if (!sheet) return false;
    const frame = animationFrame(a, state, row); if (frame < 0 || frame >= a.columns * a.rows) return false;
    const b = this.bounds(visual, a);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sheet.atlas, (frame % a.columns) * (sheet.width + GUTTER * 2) + GUTTER,
      Math.floor(frame / a.columns) * (sheet.height + GUTTER * 2) + GUTTER,
      sheet.width, sheet.height, b.x, b.y, b.width, b.height);
    return true;
  }
  drawShadow(ctx: CanvasRenderingContext2D, visual: ActorVisual): void {
    const s = visual.shadow;
    ctx.fillStyle = `rgba(36,48,37,${s.opacity})`; ctx.beginPath(); ctx.ellipse(s.x, s.y, s.width, s.height, 0, 0, Math.PI * 2); ctx.fill();
  }
}
