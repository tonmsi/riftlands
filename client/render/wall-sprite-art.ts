import { TILE_SIZE } from '../../shared/tile-size';
import { ELEVATION_STEP, type SurfaceCell } from '../../shared/world-surfaces';
import { parseWallSpriteKitCatalog, type WallSpriteKit, type WallSpriteKitCatalog, type WallSpritePart } from '../../shared/wall-sprite-kits';
import { traceContour, type ContourPoint, type SurfaceContour } from './surface-contours';
import type { RockStairGeometry } from './rock-cliff-geometry';
import { paintRockBandLighting, ROCK_BACK_TEXTURE_SCALE } from './rock-cliff-art';

export interface WallFaceTerminals {
  left: boolean; right: boolean; innerLeft?: boolean; innerRight?: boolean;
}

/** A PNG kit decorates the existing geometry; it never owns elevation or collision. */
export class WallSpriteArt {
  readonly ready: Promise<void>;
  private readonly kits = new Map<string, WallSpriteKit>();
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly rasters = new Map<string, { canvas: HTMLCanvasElement; width: number; height: number }>();
  private readonly moduleBounds = new Map<string, { x: number; y: number; width: number; height: number }>();
  private readonly gridFaceBottoms = new Map<string, number>();
  private readonly gridSideBands = new Map<string, { x: number; width: number }>();
  private readonly patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();
  constructor(catalog?: WallSpriteKitCatalog | Promise<WallSpriteKitCatalog>) {
    if (typeof Image === 'undefined') { this.ready = Promise.resolve(); return; }
    this.ready = this.load(catalog);
  }
  private async load(catalog?: WallSpriteKitCatalog | Promise<WallSpriteKitCatalog>): Promise<void> {
    try {
      const result = catalog ? await catalog : await fetch('/terrain-walls/catalog.json').then(response => {
        if (!response.ok) throw new Error('Wall catalog unavailable');
        return response.json().then(parseWallSpriteKitCatalog);
      });
      if (result.version !== 1 || !Array.isArray(result.kits)) return;
      const kits = result.kits.filter(kit => kit.id && kit.parts?.body && kit.tileSize > 0 && kit.levelHeight > 0);
      const urls = new Set(kits.flatMap(kit => Object.values(kit.parts).map(part => part!.image)));
      await Promise.all([...urls].map(url => new Promise<void>(resolve => {
        const image = new Image(); image.onload = () => { this.images.set(url, image); resolve(); };
        image.onerror = () => resolve(); image.src = url;
      })));
      // Publish only complete mandatory parts after all optional files have settled.
      for (const kit of kits) if (this.images.has(kit.parts.body!.image)) this.kits.set(kit.id, kit);
    } catch { /* The existing terrain remains available when a kit cannot be loaded. */ }
  }
  kit(cell: SurfaceCell): WallSpriteKit | undefined { return cell.wallSkin ? this.kits.get(cell.wallSkin) : undefined; }
  isGrid(cell: SurfaceCell): boolean {
    const kit = this.kit(cell); return kit?.layout === 'grid-3x3' && !!this.image(kit, 'front');
  }
  private image(kit: WallSpriteKit, part: WallSpritePart): HTMLImageElement | undefined {
    const source = kit.parts[part]; return source && this.images.get(source.image);
  }
  private pattern(ctx: CanvasRenderingContext2D, kit: WallSpriteKit, part: WallSpritePart,
    x: number, y: number, verticalBand = false, verticalScale = 1): CanvasPattern | undefined {
    const image = this.image(kit, part); if (!image) return;
    let cache = this.patterns.get(ctx); if (!cache) this.patterns.set(ctx, cache = new Map());
    const key = `${kit.id}:${part}:${verticalBand ? 1 : 0}`;
    let raster = this.rasters.get(key);
    if (!raster) {
      const width = image.width * TILE_SIZE / kit.tileSize;
      const height = image.height * (verticalBand ? ELEVATION_STEP / kit.levelHeight : TILE_SIZE / kit.tileSize);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.min(1024, Math.ceil(width)));
      canvas.height = Math.max(1, Math.min(1024, Math.ceil(height)));
      const paint = canvas.getContext('2d')!;
      paint.imageSmoothingEnabled = !kit.pixelated; paint.imageSmoothingQuality = 'high';
      if (kit.parts[part]?.flipX) { paint.translate(canvas.width, 0); paint.scale(-1, 1); }
      paint.drawImage(image, 0, 0, canvas.width, canvas.height);
      this.rasters.set(key, raster = { canvas, width, height });
    }
    const patternKey = `${key}:${verticalScale}`;
    const cached = cache.get(patternKey), pattern = cached ?? ctx.createPattern(raster.canvas, 'repeat');
    if (!pattern) return;
    if (!cached) cache.set(patternKey, pattern);
    // The raster is bounded; its repeat period retains the exact authored size,
    // including fractional heights, instead of rounding the geometry to pixels.
    pattern.setTransform(new DOMMatrix().translate(x, y).scale(raster.width / raster.canvas.width,
      raster.height / raster.canvas.height * verticalScale));
    return pattern;
  }
  private fillPart(ctx: CanvasRenderingContext2D, kit: WallSpriteKit, part: WallSpritePart,
    region: { x: number; y: number; width: number; height: number }, anchorX: number, anchorY: number,
    verticalBand = false, verticalScale = 1): boolean {
    const pattern = this.pattern(ctx, kit, part, anchorX, anchorY, verticalBand, verticalScale); if (!pattern) return false;
    ctx.save(); ctx.imageSmoothingEnabled = !kit.pixelated; ctx.fillStyle = pattern;
    ctx.fillRect(region.x, region.y, region.width, region.height); ctx.restore(); return true;
  }
  /** Complete face modules fit the real face; their size is independent from body texture resolution. */
  private moduleContent(image: HTMLImageElement, minimumAlpha = 0): { x: number; y: number; width: number; height: number } {
    const key = `${image.src}:${minimumAlpha}`, cached = this.moduleBounds.get(key); if (cached) return cached;
    let bounds = { x: 0, y: 0, width: image.width, height: image.height };
    try {
      const canvas = document.createElement('canvas'), factor = Math.min(1, 1024 / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * factor)); canvas.height = Math.max(1, Math.round(image.height * factor));
      const paint = canvas.getContext('2d')!; paint.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = paint.getImageData(0, 0, canvas.width, canvas.height).data;
      let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (pixels[(y * canvas.width + x) * 4 + 3] > minimumAlpha) {
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
      if (right >= left) bounds = { x: left * image.width / canvas.width, y: top * image.height / canvas.height,
        width: (right - left + 1) * image.width / canvas.width, height: (bottom - top + 1) * image.height / canvas.height };
      else if (minimumAlpha) bounds = { x: 0, y: 0, width: 0, height: 0 };
    } catch { /* A source that cannot expose pixels can still be painted at its full size. */ }
    this.moduleBounds.set(key, bounds); return bounds;
  }
  /** South-row modules share one toe line; their top and horizontal frames stay aligned. */
  private gridFaceBottom(kit: WallSpriteKit): number {
    const cached = this.gridFaceBottoms.get(kit.id); if (cached !== undefined) return cached;
    let bottom = 0;
    for (const part of ['front', 'corner-left', 'corner-right'] as const) {
      const image = this.image(kit, part); if (!image) continue;
      const content = this.moduleContent(image, 16);
      if (content.height > 0) bottom = Math.max(bottom, (content.y + content.height) / image.height);
    }
    const result = Math.min(1, bottom || 1); this.gridFaceBottoms.set(kit.id, result); return result;
  }
  /** A few pixels from the south row must not turn a vertical strip into a full cell. */
  private gridSideBand(image: HTMLImageElement): { x: number; width: number } {
    const cached = this.gridSideBands.get(image.src); if (cached) return cached;
    const fallback = this.moduleContent(image, 16);
    let result = { x: fallback.x, width: fallback.width };
    try {
      const canvas = document.createElement('canvas'), factor = Math.min(1, 1024 / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * factor)); canvas.height = Math.max(1, Math.round(image.height * factor));
      const paint = canvas.getContext('2d')!; paint.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = paint.getImageData(0, 0, canvas.width, canvas.height).data, counts = new Uint32Array(canvas.width);
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++)
        if (pixels[(y * canvas.width + x) * 4 + 3] > 16) counts[x]++;
      const minimum = Math.max(1, Math.ceil(canvas.height * .1));
      let left = canvas.width, right = -1;
      for (let x = 0; x < canvas.width; x++) if (counts[x] >= minimum) { left = Math.min(left, x); right = x; }
      if (right >= left) result = { x: left * image.width / canvas.width, width: (right - left + 1) * image.width / canvas.width };
    } catch { /* Local readable PNGs use the robust band; opaque fallback sources retain their bounds. */ }
    this.gridSideBands.set(image.src, result); return result;
  }
  /** The rock band straddles the boundary by only a few pixels, leaving the top usable. */
  private gridPlacement(kit: WallSpriteKit): { west: number; east: number; north: number; overlap: number; join: number } {
    const overlap = 3, join = 2;
    const bound = (part: WallSpritePart) => {
      const image = this.image(kit, part); if (!image) return undefined;
      const content = part === 'side-left' || part === 'side-right'
        ? { ...this.gridSideBand(image), y: 0, height: image.height } : this.moduleContent(image, 16);
      if (!content.width || !content.height) return undefined;
      return { left: content.x * TILE_SIZE / image.width, right: (content.x + content.width) * TILE_SIZE / image.width,
        bottom: (content.y + content.height) * TILE_SIZE / image.height };
    };
    const west = bound('side-left'), east = bound('side-right'), north = bound('back');
    return { west: west ? Math.min(0, overlap - west.right) : 0,
      east: east ? Math.max(0, TILE_SIZE - overlap - east.left) : 0,
      north: north ? Math.min(0, overlap - north.bottom) : 0, overlap, join };
  }
  private faceModule(ctx: CanvasRenderingContext2D, kit: WallSpriteKit, part: WallSpritePart,
    region: { x: number; y: number; width: number; height: number }, x: number, y: number, height: number): boolean {
    const image = this.image(kit, part); if (!image) return false;
    ctx.save(); ctx.beginPath(); ctx.rect(region.x, region.y, region.width, region.height); ctx.clip();
    ctx.imageSmoothingEnabled = !kit.pixelated;
    ctx.translate(x + (kit.parts[part]?.flipX ? TILE_SIZE : 0), y);
    if (kit.parts[part]?.flipX) ctx.scale(-1, 1);
    const source = kit.layout === 'grid-3x3'
      ? { x: 0, y: 0, width: image.width, height: image.height * this.gridFaceBottom(kit) } : this.moduleContent(image);
    ctx.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, TILE_SIZE, height); ctx.restore(); return true;
  }
  /** Body pixels repeat once per source band, independently of the total cliff height. */
  paintFace(ctx: CanvasRenderingContext2D, cell: SurfaceCell, profile: readonly ContourPoint[], x: number, y: number,
    height: number, contour?: SurfaceContour, innerCorner?: 'left' | 'right',
    terminals?: WallFaceTerminals): boolean {
    const kit = this.kit(cell); if (!kit || height <= 0 || profile.length < 2) return false;
    if (this.isGrid(cell)) return this.gridFace(ctx, kit, profile, x, y, height, contour, innerCorner, terminals);
    const top = Math.min(...profile.map(p => p.y)), bottom = Math.max(...profile.map(p => p.y)) + height;
    const front = this.image(kit, 'front');
    const foot = this.image(kit, 'foot'), footHeight = foot ? foot.height * TILE_SIZE / kit.tileSize : 6;
    ctx.save();
    // Preserve the ordinary toe as fallback when the pack contains only body.png.
    if (!foot && !front) {
      const region = [...profile, ...profile.slice().reverse().map(p => ({ x: p.x, y: p.y + Math.max(0, height - footHeight) }))];
      traceContour(ctx, region, x, y, true); ctx.clip();
    }
    const region = { x: x - 16, y: y + top, width: TILE_SIZE + 32, height: bottom - top + 1 };
    const anchorY = -cell.elevation * ELEVATION_STEP, grid = kit.layout === 'grid-3x3';
    // A grid's front alias is a complete module, never a repeating body texture.
    if (!grid || kit.parts.body?.image !== kit.parts.front?.image) this.fillPart(ctx, kit, 'body', region, 0, anchorY, true);
    const left = terminals?.left ?? !!contour?.corners[3].length;
    const right = terminals?.right ?? !!contour?.corners[2].length;
    let leftPart: WallSpritePart | undefined = terminals?.innerLeft ? 'inner-corner-left' : left ? 'corner-left' : undefined;
    let rightPart: WallSpritePart | undefined = terminals?.innerRight ? 'inner-corner-right' : right ? 'corner-right' : undefined;
    if (grid) {
      if (leftPart && !this.image(kit, leftPart)) leftPart = undefined;
      if (rightPart && !this.image(kit, rightPart)) rightPart = undefined;
    }
    const innerPart = innerCorner ? `inner-corner-${innerCorner}` as WallSpritePart : undefined;
    const replacingFront = grid && (innerPart ? !!this.image(kit, innerPart) : !!leftPart || !!rightPart);
    if (front && !replacingFront) this.faceModule(ctx, kit, 'front', region, x, y + top, bottom - top);
    if (innerPart) {
      if (grid) this.faceModule(ctx, kit, innerPart, region, x, y + top, bottom - top);
      else this.fillPart(ctx, kit, innerPart, region, x, anchorY, true);
    }
    else if (contour || terminals) {
      // End modules replace body at exposed corners, never at an internal tile joint.
      const leftRegion = { ...region, width: rightPart ? TILE_SIZE / 2 + 16 : region.width };
      const rightRegion = { ...region, x: leftPart ? x + TILE_SIZE / 2 : region.x, width: leftPart ? TILE_SIZE / 2 + 16 : region.width };
      if (leftPart) {
        if (front || grid) this.faceModule(ctx, kit, leftPart, leftRegion, x, y + top, bottom - top);
        else this.fillPart(ctx, kit, leftPart, leftRegion, x, anchorY, true);
      }
      if (rightPart) {
        if (front || grid) this.faceModule(ctx, kit, rightPart, rightRegion, x, y + top, bottom - top);
        else this.fillPart(ctx, kit, rightPart, rightRegion, x, anchorY, true);
      }
    }
    ctx.restore();
    if (foot) {
      ctx.save();
      const toe = [...profile.map(p => ({ x: p.x, y: p.y + height - footHeight })),
        ...profile.slice().reverse().map(p => ({ x: p.x, y: p.y + height + 1 }))];
      traceContour(ctx, toe, x, y, true); ctx.clip();
      this.fillPart(ctx, kit, 'foot', { x: x - 16, y: y + top, width: TILE_SIZE + 32, height: bottom - top + 2 },
        0, y + Math.max(...profile.map(p => p.y)) + height - footHeight);
      ctx.restore();
    }
    return true;
  }
  /** In the terraced layout every module stays inside its owning wall cell. */
  paintBand(ctx: CanvasRenderingContext2D, cell: SurfaceCell, x: number, y: number,
    lowerMask: number, contour?: SurfaceContour): boolean {
    const kit = this.kit(cell); if (!kit) return false;
    const region = { x, y, width: TILE_SIZE, height: TILE_SIZE };
    const grid = kit.layout === 'grid-3x3', back = !grid && !!(lowerMask & 1);
    this.fillPart(ctx, kit, 'body', region, 0, -cell.elevation * ELEVATION_STEP, true,
      back ? ROCK_BACK_TEXTURE_SCALE : 1);
    if (!grid) {
      paintRockBandLighting(ctx, x, y, lowerMask);
      if (back) {
        ctx.strokeStyle = '#38526466'; ctx.lineWidth = .85;
        traceContour(ctx, contour?.edges.north ?? [{ x: 0, y: 0 }, { x: TILE_SIZE, y: 0 }], x, y); ctx.stroke();
      }
      return true;
    }
    let part: WallSpritePart = lowerMask & 4 ? 'front' : lowerMask & 1 ? 'back'
      : lowerMask & 8 ? 'side-left' : lowerMask & 2 ? 'side-right' : 'body';
    if ((lowerMask & 12) === 12) part = 'corner-left';
    else if ((lowerMask & 6) === 6) part = 'corner-right';
    else if ((lowerMask & 9) === 9) part = 'back-left';
    else if ((lowerMask & 3) === 3) part = 'back-right';
    if (!this.image(kit, part)) part = 'front';
    this.frameModule(ctx, kit, part, region);
    for (const inlet of contour?.inlets ?? []) {
      const side = inlet.rim.some(point => point.x < 0) ? 'left' : 'right';
      const inner = `inner-corner-${side}` as WallSpritePart;
      if (this.image(kit, inner)) this.frameModule(ctx, kit, inner, region);
    }
    return true;
  }
  private gridFace(ctx: CanvasRenderingContext2D, kit: WallSpriteKit, profile: readonly ContourPoint[], x: number, y: number,
    height: number, contour?: SurfaceContour, innerCorner?: 'left' | 'right', terminals?: WallFaceTerminals): boolean {
    const placement = this.gridPlacement(kit), edge = y + Math.max(...profile.map(point => point.y));
    const top = edge - placement.overlap, faceHeight = height + placement.overlap;
    if (innerCorner) {
      const part = `inner-corner-${innerCorner}` as WallSpritePart;
      if (!this.image(kit, part)) return false;
      return this.faceModule(ctx, kit, part, { x, y: top, width: TILE_SIZE, height: faceHeight }, x, top, faceHeight);
    }
    const left = (terminals?.left ?? !!contour?.corners[3].length) && !!this.image(kit, 'corner-left');
    const right = (terminals?.right ?? !!contour?.corners[2].length) && !!this.image(kit, 'corner-right');
    const leftX = x + placement.west, rightX = x + placement.east;
    const start = left ? Math.max(x, leftX + TILE_SIZE - placement.join) : x;
    const end = right ? Math.min(x + TILE_SIZE, rightX + placement.join) : x + TILE_SIZE;
    if (end > start) this.faceModule(ctx, kit, 'front', { x: start, y: top, width: end - start, height: faceHeight }, x, top, faceHeight);
    if (left) this.faceModule(ctx, kit, 'corner-left', { x: leftX, y: top,
      width: right ? x + TILE_SIZE / 2 - leftX : TILE_SIZE, height: faceHeight }, leftX, top, faceHeight);
    if (right) this.faceModule(ctx, kit, 'corner-right', { x: left ? x + TILE_SIZE / 2 : rightX, y: top,
      width: rightX + TILE_SIZE - (left ? x + TILE_SIZE / 2 : rightX), height: faceHeight }, rightX, top, faceHeight);
    return true;
  }
  paintFlank(ctx: CanvasRenderingContext2D, cell: SurfaceCell, points: readonly ContourPoint[], x: number, y: number,
    height: number, side: 'west' | 'east', contour?: SurfaceContour): boolean {
    const kit = this.kit(cell), part = side === 'west' ? 'side-left' : 'side-right';
    if (!kit || height <= 0 || points.length < 2 || !this.image(kit, part)) return false;
    if (this.isGrid(cell)) {
      const image = this.image(kit, part)!, source = this.gridSideBand(image), placement = this.gridPlacement(kit);
      if (!source.width) return false;
      const direction = side === 'west' ? -1 : 1, width = source.width * TILE_SIZE / image.width;
      const inner = x + (side === 'west'
        ? placement.west + (source.x + source.width) * TILE_SIZE / image.width
        : placement.east + source.x * TILE_SIZE / image.width);
      const face = [{ x: inner, y }, { x: inner, y: y + TILE_SIZE },
        { x: inner + direction * width, y: y + TILE_SIZE + height }, { x: inner + direction * width, y: y + height }];
      ctx.save(); traceContour(ctx, face, 0, 0, true); ctx.clip();
      const outerFirst = (side === 'west') !== !!kit.parts[part]?.flipX;
      ctx.imageSmoothingEnabled = !kit.pixelated; ctx.imageSmoothingQuality = 'high';
      ctx.transform((outerFirst ? -direction : direction) * width / source.width,
        (outerFirst ? -height : height) / source.width, 0, TILE_SIZE / image.height,
        inner + (outerFirst ? direction * width : 0), y + (outerFirst ? height : 0));
      ctx.drawImage(image, source.x, 0, source.width, image.height, 0, 0, source.width, image.height);
      ctx.restore(); return true;
    }
    const direction = side === 'west' ? -1 : 1, width = Math.min(12, 6 + height / 12);
    const face = [...points, ...points.slice().reverse().map(p => ({ x: p.x + direction * width, y: p.y + height }))];
    ctx.save(); traceContour(ctx, face, x, y, true); ctx.clip();
    if (kit.layout === 'grid-3x3') {
      const image = this.image(kit, part)!, source = this.moduleContent(image);
      const north = points.reduce((a, b) => a.y <= b.y ? a : b), south = points.reduce((a, b) => a.y >= b.y ? a : b);
      // Only the visible horizontal band belongs to the narrow flank. Its vertical
      // frame still follows the entire edge; the top rim keeps both full dimensions.
      const outerFirst = (side === 'west') !== !!kit.parts[part]?.flipX;
      const start = { x: x + north.x + (outerFirst ? direction * width : 0),
        y: y + north.y + (outerFirst ? height : 0) };
      ctx.imageSmoothingEnabled = !kit.pixelated; ctx.imageSmoothingQuality = 'high';
      ctx.transform((outerFirst ? -direction : direction) * width / source.width,
        (outerFirst ? -height : height) / source.width,
        (south.x - north.x) / image.height, (south.y - north.y) / image.height, start.x, start.y);
      ctx.drawImage(image, source.x, 0, source.width, image.height, 0, 0, source.width, image.height);
      ctx.restore(); return true;
    }
    const region = { x: x - width - 3, y: y - 6, width: TILE_SIZE + 2 * width + 6, height: TILE_SIZE + height + 12 };
    this.fillPart(ctx, kit, part, region, 0, -cell.elevation * ELEVATION_STEP, true);
    const topCorner = side === 'west' ? 0 : 1;
    if (contour?.corners[topCorner].length) {
      ctx.save(); ctx.beginPath(); ctx.rect(region.x, y - 6, region.width, TILE_SIZE / 2 + 6); ctx.clip();
      this.fillPart(ctx, kit, side === 'west' ? 'corner-left' : 'corner-right', region, x,
        -cell.elevation * ELEVATION_STEP, true); ctx.restore();
    }
    ctx.restore(); return true;
  }
  private ribbon(ctx: CanvasRenderingContext2D, kit: WallSpriteKit, part: WallSpritePart,
    points: readonly ContourPoint[], x: number, y: number): void {
    const image = this.image(kit, part); if (!image || points.length < 2) return;
    const height = Math.min(TILE_SIZE, image.height * TILE_SIZE / kit.tileSize);
    const band = [...points.map(p => ({ x: p.x, y: p.y - height / 2 })),
      ...points.slice().reverse().map(p => ({ x: p.x, y: p.y + height / 2 }))];
    ctx.save(); traceContour(ctx, band, x, y, true); ctx.clip();
    const top = Math.min(...points.map(p => p.y)) - height / 2;
    this.fillPart(ctx, kit, part, { x: x - 16, y: y + top, width: TILE_SIZE + 32,
      height: Math.max(...points.map(p => p.y)) - top + height }, 0,
      y + Math.round(points.reduce((sum, p) => sum + p.y, 0) / points.length / TILE_SIZE) * TILE_SIZE - height / 2); ctx.restore();
  }
  /** Grid cells keep their authored transparent frame and align to one terrain cell. */
  private frameModule(ctx: CanvasRenderingContext2D, kit: WallSpriteKit, part: WallSpritePart,
    region: { x: number; y: number; width: number; height: number }): void {
    const image = this.image(kit, part); if (!image || region.width <= 0 || region.height <= 0) return;
    ctx.save(); ctx.imageSmoothingEnabled = !kit.pixelated; ctx.imageSmoothingQuality = 'high';
    ctx.translate(region.x + (kit.parts[part]?.flipX ? region.width : 0), region.y);
    if (kit.parts[part]?.flipX) ctx.scale(-1, 1);
    ctx.drawImage(image, 0, 0, region.width, region.height); ctx.restore();
  }
  private gridRim(ctx: CanvasRenderingContext2D, kit: WallSpriteKit, contour: SurfaceContour, x: number, y: number): void {
    const placement = this.gridPlacement(kit);
    const left = !!contour.corners[0].length && !!this.image(kit, 'back-left');
    const right = !!contour.corners[1].length && !!this.image(kit, 'back-right');
    const top = y + placement.north, cornerEnd = Math.min(y + TILE_SIZE, top + TILE_SIZE - placement.join);
    const side = (part: 'side-left' | 'side-right', offset: number, corner: boolean) => {
      const start = corner ? Math.max(y, cornerEnd) : y;
      const left = part === 'side-left' ? x + offset : x + TILE_SIZE - placement.overlap;
      const right = part === 'side-left' ? x + placement.overlap : x + offset + TILE_SIZE;
      ctx.save(); ctx.beginPath(); ctx.rect(left, start, right - left, y + TILE_SIZE - start); ctx.clip();
      this.frameModule(ctx, kit, part, { x: x + offset, y, width: TILE_SIZE, height: TILE_SIZE }); ctx.restore();
    };
    if (contour.exposed.west) side('side-left', placement.west, left);
    if (contour.exposed.east) side('side-right', placement.east, right);
    const start = left ? Math.max(x, x + placement.west + TILE_SIZE - placement.join) : x;
    const end = right ? Math.min(x + TILE_SIZE, x + placement.east + placement.join) : x + TILE_SIZE;
    if (contour.exposed.north && end > start) {
      ctx.save(); ctx.beginPath(); ctx.rect(start, top, end - start, TILE_SIZE); ctx.clip();
      this.frameModule(ctx, kit, 'back', { x, y: top, width: TILE_SIZE, height: TILE_SIZE }); ctx.restore();
    }
    for (const [part, present, opposite] of [['back-left', left, right], ['back-right', right, left]] as const) {
      if (!present) continue;
      const cornerX = x + (part === 'back-left' ? placement.west : placement.east);
      ctx.save();
      if (opposite) {
        const start = part === 'back-left' ? cornerX : x + TILE_SIZE / 2;
        const end = part === 'back-left' ? x + TILE_SIZE / 2 : cornerX + TILE_SIZE;
        ctx.beginPath(); ctx.rect(start, top, end - start, TILE_SIZE); ctx.clip();
      }
      this.frameModule(ctx, kit, part, { x: cornerX, y: top, width: TILE_SIZE, height: TILE_SIZE }); ctx.restore();
    }
  }
  paintRim(ctx: CanvasRenderingContext2D, cell: SurfaceCell, contour: SurfaceContour, x: number, y: number): void {
    const kit = this.kit(cell); if (!kit) return;
    if (this.isGrid(cell)) { this.gridRim(ctx, kit, contour, x, y); return; }
    if (contour.exposed.south) this.ribbon(ctx, kit, 'cap', contour.southFace, x, y);
    if (contour.exposed.north) this.ribbon(ctx, kit, 'back', [...contour.corners[0].slice().reverse(),
      ...contour.edges.north, ...contour.corners[1]], x, y);
    for (const inlet of contour.inlets) this.ribbon(ctx, kit, 'cap', inlet.rim, x, y);
  }
  paintFlatRim(ctx: CanvasRenderingContext2D, cell: SurfaceCell, x: number, y: number, south: boolean, north: boolean): void {
    const kit = this.kit(cell); if (!kit) return;
    if (this.isGrid(cell)) {
      const placement = this.gridPlacement(kit);
      if (north) this.frameModule(ctx, kit, 'back', { x, y: y + placement.north, width: TILE_SIZE, height: TILE_SIZE });
      return;
    }
    if (south) this.ribbon(ctx, kit, 'cap', [{ x: 0, y: TILE_SIZE }, { x: TILE_SIZE, y: TILE_SIZE }], x, y);
    if (north) this.ribbon(ctx, kit, 'back', [{ x: 0, y: 0 }, { x: TILE_SIZE, y: 0 }], x, y);
  }
  private quad(ctx: CanvasRenderingContext2D, kit: WallSpriteKit, part: WallSpritePart, points: readonly ContourPoint[]): void {
    const image = this.image(kit, part); if (!image || points.length !== 4) return;
    const [a, b, , d] = points;
    ctx.save(); traceContour(ctx, points, 0, 0, true); ctx.clip(); ctx.imageSmoothingEnabled = !kit.pixelated;
    ctx.transform((b.x - a.x) / image.width, (b.y - a.y) / image.width,
      (d.x - a.x) / image.height, (d.y - a.y) / image.height, a.x, a.y);
    ctx.drawImage(image, 0, 0); ctx.restore();
  }
  /** Optional stair parts overlay their ordinary counterparts, with the same physical profile. */
  paintStairs(ctx: CanvasRenderingContext2D, cell: SurfaceCell, geometry: RockStairGeometry, ramp = false): void {
    const kit = this.kit(cell); if (!kit) return;
    ctx.save(); ctx.imageSmoothingEnabled = !kit.pixelated;
    if (geometry.sideFace.length && (kit.layout !== 'grid-3x3' || kit.parts.body?.image !== kit.parts.front?.image)) {
      ctx.save(); traceContour(ctx, geometry.sideFace, 0, 0, true); ctx.clip();
      const xs = geometry.sideFace.map(p => p.x), ys = geometry.sideFace.map(p => p.y);
      this.fillPart(ctx, kit, 'body', { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys) }, 0, -cell.elevation * ELEVATION_STEP, true); ctx.restore();
    }
    if (!ramp) for (const step of geometry.treads) {
      this.quad(ctx, kit, 'stairs-riser', step.riser); this.quad(ctx, kit, 'stairs-tread', step.top);
    }
    const border = this.image(kit, 'stairs-border');
    if (border) for (const p of geometry.shoulders) ctx.drawImage(border, p.x - 3, p.y - 3, 6, 6);
    if (geometry.landing.length === 4) this.quad(ctx, kit, 'stairs-landing', geometry.landing);
    // geometry.lowerLanding remains bare ground, as in the base renderer.
    ctx.restore();
  }
}
