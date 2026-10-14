import atlas from './rock-cliff-manifest.json';
import { TILE_SIZE } from '../../shared/config';
import { type SurfaceCell, type SurfaceStair } from '../../shared/world-surfaces';
import { noise } from './render-primitives';
import { traceContour, type ContourPoint, type SurfaceContour } from './surface-contours';
import { authoredRockStairGeometry, rockStairGeometry, type RockStairGeometry } from './rock-cliff-geometry';

type Rect = { x: number; y: number; width: number; height: number };
type FaceStyle = typeof atlas.front;

function joinStripEdges(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const pixels = ctx.getImageData(0, 0, width, height), data = pixels.data, band = 5;
  for (const vertical of [false, true]) {
    const count = vertical ? width : height, length = vertical ? height : width;
    for (let line = 0; line < count; line++) for (let offset = 0; offset < Math.min(band, length / 2); offset++) {
      const a = (vertical ? offset * width + line : line * width + offset) * 4;
      const b = (vertical ? (height - 1 - offset) * width + line : line * width + width - 1 - offset) * 4;
      const mix = .5 * (1 - offset / band);
      for (let channel = 0; channel < 3; channel++) { const first = data[a + channel], last = data[b + channel];
        data[a + channel] = Math.round(first * (1 - mix) + last * mix); data[b + channel] = Math.round(last * (1 - mix) + first * mix); }
    }
  }
  ctx.putImageData(pixels, 0, 0);
}

/** Source artwork is kept intact; source rectangles are projected into authored rock geometry. */
export class RockCliffArt {
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly patterns = new Map<string, CanvasPattern>();
  private readonly stairShapes = new WeakMap<SurfaceStair, { signature: string; projected?: RockStairGeometry; flat?: RockStairGeometry }>();
  readonly ready: Promise<void>;
  constructor() {
    if (typeof Image === 'undefined') { this.ready = Promise.resolve(); return; }
    this.ready = Promise.all([atlas.front.image, atlas.weathered.image, atlas.steps.image].map(url => new Promise<void>(resolve => {
      const image = new Image();
      image.onload = () => { this.images.set(url, image); resolve(); };
      image.onerror = () => resolve();
      image.src = url;
    }))).then(() => {});
  }
  get loaded(): boolean { return this.images.size === 3; }
  private pattern(ctx: CanvasRenderingContext2D, style: FaceStyle, part: 'body' | 'cap' | 'toe', offset: number): CanvasPattern | undefined {
    const image = this.images.get(style.image); if (!image) return;
    // Elevation is bounded to sixteen levels, so the cache cannot grow with map size.
    const key = `${style.image}:${part}:${offset}`, cached = this.patterns.get(key);
    if (cached) return cached;
    const source = style[part], canvas = document.createElement('canvas');
    canvas.width = style.worldWidth; canvas.height = part === 'body' ? style.worldHeight : part === 'cap' ? 8 : 7;
    const paint = canvas.getContext('2d')!;
    if (part === 'body') { paint.fillStyle = '#616b79'; paint.fillRect(0, 0, canvas.width, canvas.height); }
    paint.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
    if (part === 'body') joinStripEdges(paint, canvas.width, canvas.height);
    const pattern = ctx.createPattern(canvas, 'repeat'); if (!pattern) return;
    pattern.setTransform(new DOMMatrix().translate(0, offset));
    if (this.patterns.size >= 128) this.patterns.delete(this.patterns.keys().next().value!);
    this.patterns.set(key, pattern); return pattern;
  }
  paintFace(ctx: CanvasRenderingContext2D, cell: SurfaceCell, profile: readonly ContourPoint[], x: number, y: number, height: number): boolean {
    const style = atlas.front;
    const top = Math.min(...profile.map(p => p.y)), bottom = Math.max(...profile.map(p => p.y)) + height;
    const offset = -cell.elevation * 16;
    const paint = this.pattern(ctx, style, 'body', offset); if (!paint) return false;
    ctx.fillStyle = '#616b79'; ctx.fillRect(x - 16, y + top, TILE_SIZE + 32, bottom - top);
    ctx.fillStyle = paint; ctx.fillRect(x - 16, y + top, TILE_SIZE + 32, bottom - top);
    const shade = ctx.createLinearGradient(0, y + top, 0, y + bottom);
    shade.addColorStop(0, '#18223808'); shade.addColorStop(.7, '#111d3022'); shade.addColorStop(1, '#111b344c');
    ctx.fillStyle = shade; ctx.fillRect(x - 16, y + top, TILE_SIZE + 32, bottom - top);
    // Narrow weathered bands hide vertical repeats without resizing entire boulders.
    const worn = this.pattern(ctx, atlas.weathered, 'body', offset + 17);
    if (worn && height > 50) {
      ctx.save(); ctx.globalAlpha = .28; ctx.fillStyle = worn;
      for (let row = 44; row < height; row += 43) ctx.fillRect(x - 16, y + top + row - 3, TILE_SIZE + 32, 8);
      ctx.restore();
    }
    const foot = this.pattern(ctx, style, 'toe', offset);
    if (foot) {
      const toe = [...profile.map(p => ({ x: p.x, y: p.y + height - 6 })), ...profile.slice().reverse().map(p => ({ x: p.x, y: p.y + height + 1 }))];
      ctx.save(); traceContour(ctx, toe, x, y, true); ctx.clip(); ctx.fillStyle = foot;
      ctx.fillRect(x - 16, y + top, TILE_SIZE + 32, bottom - top + 2); ctx.restore();
    }
    return true;
  }
  paintRim(ctx: CanvasRenderingContext2D, cell: SurfaceCell, contour: SurfaceContour, x: number, y: number): void {
    if (cell.wallMaterial !== 'rock' || !this.images.has(atlas.front.image)) return;
    ctx.save();
    for (const edge of ['north', 'east', 'south', 'west'] as const) {
      if (!contour.exposed[edge]) continue;
      const points = contour.edges[edge], dx = edge === 'east' ? -3.6 : edge === 'west' ? 3.6 : 0;
      const dy = edge === 'north' ? 3.6 : edge === 'south' ? -3.6 : 0;
      const rim = [...points, ...points.slice().reverse().map(p => ({ x: p.x + dx, y: p.y + dy }))];
      traceContour(ctx, rim, x, y, true); ctx.fillStyle = edge === 'west' || edge === 'north' ? '#c3c2a43b' : '#25344955'; ctx.fill();
    }
    if (cell.material === 'grass' && contour.exposed.south) {
      const cap = this.pattern(ctx, atlas.front, 'cap', -cell.elevation * 16);
      if (cap) {
        const points = contour.southFace;
        const band = [...points.map(p => ({ x: p.x, y: p.y - 2 })), ...points.slice().reverse().map(p => ({ x: p.x, y: p.y + 3 }))];
        ctx.save(); traceContour(ctx, band, x, y, true); ctx.clip(); ctx.fillStyle = cap;
        ctx.fillRect(x - 12, y + TILE_SIZE - 12, TILE_SIZE + 24, 25); ctx.restore();
      }
    }
    ctx.restore();
  }
  /** A narrow bevel gives the parallel flanks a readable body without changing the camera projection. */
  paintFlank(ctx: CanvasRenderingContext2D, cell: SurfaceCell, points: readonly ContourPoint[], x: number, y: number,
    height: number, side: 'west' | 'east'): void {
    if (height <= 0 || points.length < 2 || cell.wallMaterial !== 'rock') return;
    const direction = side === 'west' ? -1 : 1, width = Math.min(12, 6 + height / 12);
    const face = [...points, ...points.slice().reverse().map(p => ({ x: p.x + direction * width, y: p.y + height }))];
    ctx.save(); traceContour(ctx, face, x, y, true); ctx.clip();
    const pattern = this.pattern(ctx, atlas.front, 'body', -cell.elevation * 16);
    ctx.fillStyle = pattern ?? '#616b79'; ctx.fillRect(x - width - 3, y - 6, TILE_SIZE + 2 * width + 6, TILE_SIZE + height + 12);
    ctx.fillStyle = side === 'east' ? '#18243d55' : '#d4d0b822'; ctx.fill();
    ctx.restore();
    ctx.save(); ctx.strokeStyle = '#17233a55'; ctx.lineWidth = 2;
    traceContour(ctx, points.map(p => ({ x: p.x + direction * width, y: p.y + height })), x, y); ctx.stroke();
    ctx.restore();
  }
  private quad(ctx: CanvasRenderingContext2D, image: HTMLImageElement | undefined, region: Rect, points: readonly ContourPoint[], fallback: string): void {
    ctx.save(); traceContour(ctx, points, 0, 0, true); ctx.clip(); ctx.fillStyle = fallback; ctx.fill();
    if (!image) { ctx.restore(); return; }
    const [a, b, , d] = points;
    // A textured parallelogram preserves tread direction instead of rotating a staircase sprite.
    ctx.transform((b.x - a.x) / region.width, (b.y - a.y) / region.width,
      (d.x - a.x) / region.height, (d.y - a.y) / region.height, a.x, a.y);
    ctx.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
    ctx.restore();
  }
  drawStairs(ctx: CanvasRenderingContext2D, from: SurfaceCell, to: SurfaceCell, projectElevation = true, allowAnyWall = false): boolean {
    const geometry = rockStairGeometry(from, to, projectElevation, TILE_SIZE, allowAnyWall);
    if (!geometry) return false;
    this.paintStairs(ctx, geometry); return true;
  }
  drawAuthoredStairs(ctx: CanvasRenderingContext2D, stair: SurfaceStair, projectElevation = true): void {
    const signature = [stair.from.x, stair.from.y, stair.from.surfaceId, stair.from.elevation,
      stair.to.x, stair.to.y, stair.to.surfaceId, stair.to.elevation, stair.width, stair.profile ?? 'landings', stair.underpass === true].join(':');
    const previous = this.stairShapes.get(stair), cached = previous?.signature === signature ? previous : { signature };
    const key = projectElevation ? 'projected' : 'flat';
    const geometry = cached[key] ??= authoredRockStairGeometry(stair, projectElevation); this.stairShapes.set(stair, cached);
    this.paintStairs(ctx, geometry, stair.kind === 'ramp');
  }
  drawRamp(ctx: CanvasRenderingContext2D, from: SurfaceCell, to: SurfaceCell, projectElevation = true, allowAnyWall = false): boolean {
    const geometry = rockStairGeometry(from, to, projectElevation, TILE_SIZE, allowAnyWall);
    if (!geometry) return false;
    this.paintStairs(ctx, geometry, true); return true;
  }
  private paintStairs(ctx: CanvasRenderingContext2D, geometry: RockStairGeometry, ramp = false): void {
    const image = this.images.get(atlas.steps.image);
    const { treads, shoulders, landing, dx, dy } = geometry;
    ctx.save();
    if (geometry.sideFace.length) {
      traceContour(ctx, geometry.sideFace, 0, 0, true); ctx.fillStyle = '#495467'; ctx.fill();
      const face = this.pattern(ctx, atlas.front, 'body', -geometry.low.elevation * 16);
      if (face) { ctx.fillStyle = face; ctx.fill(); }
      ctx.fillStyle = '#15253b33'; ctx.fill();
    }
    traceContour(ctx, geometry.corridor, 0, 0, true); ctx.fillStyle = '#303948'; ctx.fill();
    // Rear approaches can become short in screen space; their individual treads still keep logical orientation.
    for (const step of ramp ? [] : treads) {
      this.quad(ctx, image, atlas.steps.riser, step.riser, '#3d4657');
      this.quad(ctx, image, atlas.steps.tread, step.top, '#90938d');
      ctx.strokeStyle = '#263145b3'; ctx.lineWidth = .75;
      traceContour(ctx, step.top, 0, 0, true); ctx.stroke();
      ctx.strokeStyle = '#dfd8bd80'; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.moveTo(step.top[2].x, step.top[2].y); ctx.lineTo(step.top[3].x, step.top[3].y); ctx.stroke();
    }
    // Low side stones replace the giant detached rocky shoulders of a decorative staircase.
    if (ramp) {
      traceContour(ctx, geometry.corridor, 0, 0, true); ctx.fillStyle = '#989c8b'; ctx.fill();
      ctx.strokeStyle = '#35445399'; ctx.lineWidth = 1; ctx.stroke();
    }
    for (let i = 0; i < shoulders.length; i++) {
      const p = shoulders[i], variation = noise(geometry.low.x, geometry.low.y, i + 631);
      const size = 4.5 + variation * 1.8;
      const source = atlas.steps.border;
      if (image) ctx.drawImage(image, source.x, source.y, source.width, source.height, p.x - size / 2, p.y - size / 2, size, size);
      else { ctx.fillStyle = '#69758a'; ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size); }
    }
    // Keep the lower landing physically flat without painting a separate stone slab over it.
    this.quad(ctx, image, atlas.steps.tread, landing, '#90938d');
    // Each upper entrance meets the grass/rock surface with a short mortar-dark joint.
    ctx.strokeStyle = '#33405299'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(landing[2].x, landing[2].y); ctx.lineTo(landing[3].x, landing[3].y); ctx.stroke();
    if (dx && !dy && !ramp) {
      // In side view, the narrow visible riser edge remains vertical like the reference gradoni.
      ctx.strokeStyle = '#d4cdb580'; ctx.lineWidth = .8;
      for (const step of treads) { ctx.beginPath(); ctx.moveTo(step.top[0].x, step.top[0].y); ctx.lineTo(step.top[1].x, step.top[1].y); ctx.stroke(); }
    }
    ctx.restore();
  }
}
