import { TILE_SIZE } from '../shared/config';
import type { TileKind } from '../shared/types';
import { TERRAIN, bushColor } from './terrain-style';

const TAU = Math.PI * 2;
const DENSITY = 2;
const VARIANTS = 12;
const CACHE_LIMIT = 384;

function random(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
    return ((state ^= state >>> 16) >>> 0) / 4294967296;
  };
}

function shape(ctx: CanvasRenderingContext2D, points: number[], color: string): void {
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function oval(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, rotation = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rotation, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
}

export class EnvironmentArt {
  // Margine extra aumentato per accogliere la chioma sporgente dell'SVG senza tagliarla
  private static readonly BUSH_MARGIN = 20;

  private readonly cache = new Map<string, HTMLCanvasElement>();
  private cachedPixels = 0;
  private readonly washes = new Map<string, CanvasPattern>();
  private waterSource?: object;
  private readonly waterPaint = new Map<string, { path: Path2D; color: string } | null>();

  // Riferimento all'SVG caricato per il cespuglio e cache della versione invernale
  private bushSvgImage: HTMLImageElement | null = null;
  private bushSnowCanvas: HTMLCanvasElement | null = null;

  /** Metodo chiamato da render.ts non appena l'SVG è decodificato */
  setBushSvg(img: HTMLImageElement): void {
    this.bushSvgImage = img;
    this.bushSnowCanvas = null;

    // Svuota selettivamente dalla cache solo i cespugli per forzarne il ridisegno con l'SVG
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith('bush:')) {
        const evicted = this.cache.get(key)!;
        this.cachedPixels -= evicted.width * evicted.height;
        this.cache.delete(key);
      }
    }
  }

  paintWater(
    ctx: CanvasRenderingContext2D,
    bounds: { left: number; top: number; right: number; bottom: number },
    world: { getTile(x: number, y: number): TileKind }
  ): void {
    if (this.waterSource !== world) {
      this.waterPaint.clear();
      this.waterSource = world;
    }
    const spacing = 110;
    for (let gy = Math.floor(bounds.top / spacing) - 1; gy <= Math.floor(bounds.bottom / spacing) + 1; gy++) {
      for (let gx = Math.floor(bounds.left / spacing) - 1; gx <= Math.floor(bounds.right / spacing) + 1; gx++) {
        const key = `${gx},${gy}`;
        if (!this.waterPaint.has(key)) {
          const rng = random(Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663) ^ 615937);
          let mark: { path: Path2D; color: string } | null = null;
          if (rng() > 0.12) {
            const x = (gx + rng()) * spacing;
            const y = (gy + rng()) * spacing;
            const w = 27 + rng() * 48;
            const h = 15 + rng() * 29;
            let clear = true;
            for (let ty = Math.floor((y - h - 5) / TILE_SIZE); clear && ty <= Math.floor((y + h + 5) / TILE_SIZE); ty++) {
              for (let tx = Math.floor((x - w - 5) / TILE_SIZE); tx <= Math.floor((x + w + 5) / TILE_SIZE); tx++) {
                if (world.getTile(tx, ty) !== 'water') {
                  clear = false;
                  break;
                }
              }
            }
            if (clear) {
              const path = new Path2D();
              path.moveTo(x - w, y);
              path.lineTo(x - w * 0.6, y - h);
              path.lineTo(x + w * 0.45, y - h * 0.7);
              path.lineTo(x + w, y + h * 0.1);
              path.lineTo(x + w * 0.5, y + h);
              path.lineTo(x - w * 0.5, y + h * 0.65);
              path.closePath();
              const light = rng() > 0.5;
              mark = { path, color: light ? '#c4ded018' : '#27566e16' };
            }
          }
          if (this.waterPaint.size >= 512) this.waterPaint.delete(this.waterPaint.keys().next().value!);
          this.waterPaint.set(key, mark);
        }
        const mark = this.waterPaint.get(key);
        if (mark) {
          ctx.fillStyle = mark.color;
          ctx.fill(mark.path);
        }
      }
    }
  }

  roundTerrainCorner(ctx: CanvasRenderingContext2D, x: number, y: number, corner: number, color: string, radius = 13): void {
    ctx.save();
    ctx.translate(x + (corner === 1 || corner === 2 ? TILE_SIZE : 0), y + (corner >= 2 ? TILE_SIZE : 0));
    ctx.scale(corner === 1 || corner === 2 ? -1 : 1, corner >= 2 ? -1 : 1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(radius, 0);
    ctx.quadraticCurveTo(0, 0, 0, radius);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  drawTerrainSeam(ctx: CanvasRenderingContext2D, x: number, y: number, variation: number): number {
    if (variation < 0.62) return 0;
    const rng = random(49157 + Math.floor(variation * 1_000_003));
    const stones = 2 + (rng() > 0.7 ? 1 : 0);
    for (let i = 0; i < stones; i++) {
      const angle = rng() * TAU;
      const distance = 3 + rng() * 6;
      const px = x + Math.cos(angle) * distance;
      const py = y + Math.sin(angle) * distance;
      const radius = 1.7 + rng() * 1.25;
      oval(ctx, px, py + 0.45, radius, radius * 0.68, '#717b7148', angle);
      oval(ctx, px - 0.3, py, radius * 0.82, radius * 0.55, i % 2 ? '#aeb09a' : '#b9b49a', angle);
    }
    if (rng() > 0.45) {
      const px = x + (rng() - 0.5) * 10;
      const py = y + 3 + rng() * 5;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px - 1, py - 4, px - 3, py - 6);
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px, py - 5, px + 1, py - 7);
      ctx.moveTo(px + 1, py);
      ctx.quadraticCurveTo(px + 3, py - 3, px + 4, py - 5);
      ctx.strokeStyle = '#627c5190';
      ctx.lineWidth = 1.05;
      ctx.stroke();
    }
    return stones;
  }

  drawWaterPlants(ctx: CanvasRenderingContext2D, x: number, y: number, variation: number, shore: number): number {
    const cardinal = shore & 15;
    const edgeCount = [1, 2, 4, 8].reduce((count, bit) => count + (cardinal & bit ? 1 : 0), 0);
    const corner = edgeCount >= 2 || Boolean(shore & 240);
    if (!shore || variation < (corner ? 0.42 : 0.72)) return 0;

    let dx = 0, dy = 0;
    if (cardinal & 1) dy += 8;
    if (cardinal & 2) dx -= 8;
    if (cardinal & 4) dy -= 8;
    if (cardinal & 8) dx += 8;
    if (!cardinal) {
      if (shore & 16) { dx -= 7; dy += 7; }
      if (shore & 32) { dx -= 7; dy -= 7; }
      if (shore & 64) { dx += 7; dy += 7; }
      if (shore & 128) { dx += 7; dy += 7; }
    }

    const rng = random(23917 + Math.floor(variation * 1_000_003) + shore * 97);
    const count = corner ? 2 + (rng() > 0.64 ? 1 : 0) : 1 + (rng() > 0.82 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const px = x + 24 + dx + (rng() - 0.5) * 13;
      const py = y + 24 + dy + (rng() - 0.5) * 10;
      const radius = 3.4 + rng() * 2.2;
      const rotation = rng() * TAU;
      oval(ctx, px + 1, py + 1.5, radius + 0.5, radius * 0.58, '#285f6460', rotation);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rotation);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, 0.32, TAU - 0.38);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? '#719b56' : '#86aa60';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-radius * 0.7, -radius * 0.15);
      ctx.quadraticCurveTo(0, -radius * 0.7, radius * 0.7, -radius * 0.1);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fillStyle = '#abc27675';
      ctx.fill();
      ctx.restore();
      if (corner && i === 0 && rng() > 0.7) {
        for (let petal = 0; petal < 4; petal++) {
          const angle = (petal * Math.PI) / 2;
          oval(ctx, px + Math.cos(angle) * 1.5, py + Math.sin(angle) * 1.2, 1.4, 0.8, '#e3d7b7', angle);
        }
        oval(ctx, px, py, 0.7, 0.7, '#d6ad62');
      }
    }
    return count;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    tile: TileKind,
    x: number,
    y: number,
    variation: number,
    shore = 0,
    width = 1,
    height = 1,
    isSnowy = false
  ): void {
    const variant = tile === 'bush'
      ? Math.floor(variation * 4) % 4
      : tile === 'water'
        ? Math.floor(variation * 6) % 6
        : Math.min(VARIANTS - 1, Math.floor(variation * VARIANTS));

    const key = `${tile}:${variant}:${shore}:${width}:${height}:${isSnowy ? 1 : 0}`;
    let sprite = this.cache.get(key);

    if (!sprite) {
      sprite = document.createElement('canvas');
      const isBush = tile === 'bush';
      const margin = isBush ? EnvironmentArt.BUSH_MARGIN : 0;

      sprite.width = (TILE_SIZE * width + margin * 2) * DENSITY;
      sprite.height = (TILE_SIZE * height + margin * 2) * DENSITY;

      const art = sprite.getContext('2d')!;
      art.scale(DENSITY, DENSITY);
      art.lineJoin = 'round';
      art.lineCap = 'round';

      if (isBush) {
        art.translate(margin, margin);
        if (this.bushSvgImage && this.bushSvgImage.complete) {
          this.drawBushFromSvg(art, variant, isSnowy);
        } else {
          this.bushVariant(art, variant, isSnowy);
        }
      } else if (tile === 'rock') {
        art.scale(width, height);
        this.rock(art, random(7919 + variant * 104729), Math.max(width, height));
      } else if (tile === 'water') {
        this.water(art, random(7919 + variant * 104729), shore, variant);
      } else if (tile === 'snow') {
        this.snow(art, random(7919 + variant * 104729), variant);
      } else if (tile === 'ice') {
        this.ice(art, random(7919 + variant * 104729), variant);
      } else {
        this.ground(art, random(7919 + variant * 104729), tile, isSnowy);
      }

      const pixels = sprite.width * sprite.height;
      while (this.cache.size && (this.cache.size >= CACHE_LIMIT || this.cachedPixels + pixels > 8_388_608)) {
        const oldest = this.cache.keys().next().value!;
        const evicted = this.cache.get(oldest)!;
        this.cachedPixels -= evicted.width * evicted.height;
        this.cache.delete(oldest);
      }
      this.cache.set(key, sprite);
      this.cachedPixels += pixels;
    }

    if (tile === 'bush') {
      const margin = EnvironmentArt.BUSH_MARGIN;
      ctx.drawImage(sprite, x - margin, y - margin, TILE_SIZE * width + margin * 2, TILE_SIZE * height + margin * 2);
    } else if (tile === 'water') {
      const transform = ctx.getTransform();
      const left = Math.floor(x * transform.a + transform.e);
      const top = Math.floor(y * transform.d + transform.f);
      const right = Math.ceil((x + TILE_SIZE) * transform.a + transform.e);
      const bottom = Math.ceil((y + TILE_SIZE) * transform.d + transform.f);
      ctx.drawImage(
        sprite,
        (left - transform.e) / transform.a,
        (top - transform.f) / transform.d,
        (right - left) / transform.a,
        (bottom - top) / transform.d
      );
    } else {
      ctx.drawImage(sprite, x, y, TILE_SIZE * width, TILE_SIZE * height);
    }
  }

  /**
   * Rendering primario basato su bush.svg con varianti geometriche
   * (orientamento, specchiatura e palette glaciale nei biomi freddi)
   */
  private drawBushFromSvg(ctx: CanvasRenderingContext2D, variant: number, isSnowy: boolean): void {
    if (!this.bushSvgImage) return;

    // Dimensioni di ingombro del cespuglio rispetto al tile da 48px
    const drawW = 54;
    const drawH = 54;
    const cx = 24;
    const cy = 24;

    ctx.save();
    ctx.translate(cx, cy);

    // 1. Varianti visive per evitare ripetizioni
    if (variant === 1) {
      ctx.scale(-1, 1); // Flip orizzontale a specchio
    } else if (variant === 2) {
      ctx.scale(0.94, 0.96);
      ctx.rotate(0.04);
    } else if (variant === 3) {
      ctx.scale(-0.95, 0.93);
      ctx.rotate(-0.04);
    }

    // 2. Ombra di contatto scura alla base
    ctx.fillStyle = isSnowy ? 'rgba(15, 28, 24, 0.28)' : 'rgba(14, 28, 12, 0.32)';
    ctx.beginPath();
    ctx.ellipse(0, 18, 20, 6.5, 0, 0, TAU);
    ctx.fill();

    // 3. Renderizzazione dell'SVG
    if (!isSnowy) {
      ctx.drawImage(this.bushSvgImage, -drawW / 2, -drawH / 2 - 2, drawW, drawH);
    } else {
      if (!this.bushSnowCanvas) {
        this.bushSnowCanvas = document.createElement('canvas');
        this.bushSnowCanvas.width = this.bushSvgImage.naturalWidth || 256;
        this.bushSnowCanvas.height = this.bushSvgImage.naturalHeight || 256;
        const sCtx = this.bushSnowCanvas.getContext('2d')!;

        // Variazione di tonalità verso toni freddi abete/menta
        sCtx.filter = 'hue-rotate(25deg) saturate(0.65) brightness(0.9)';
        sCtx.drawImage(this.bushSvgImage, 0, 0);

        // Velatura di brina gelata
        sCtx.globalCompositeOperation = 'source-atop';
        sCtx.fillStyle = 'rgba(215, 240, 245, 0.35)';
        sCtx.fillRect(0, 0, this.bushSnowCanvas.width, this.bushSnowCanvas.height);
      }

      ctx.drawImage(this.bushSnowCanvas, -drawW / 2, -drawH / 2 - 2, drawW, drawH);

      // Accenti prismatici di neve candida sulle punte lanceolate più alte
      ctx.fillStyle = '#ffffff';
      for (const [bx, by] of [[-7, -19], [3, -24], [13, -13], [-13, -7]]) {
        ctx.beginPath();
        ctx.moveTo(bx, by - 4);
        ctx.lineTo(bx + 3, by);
        ctx.lineTo(bx, by + 4);
        ctx.lineTo(bx - 3, by);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /**
   * Fallback procedurale low-poly sfaccettato nel caso l'asset SVG non fosse reperibile
   */
  private bushVariant(ctx: CanvasRenderingContext2D, variant: number, isSnowy = false): void {
    const rng = random(99127 + variant * 45293);
    const PI = Math.PI;
    const cx = 24;
    const cy = 25;

    ctx.fillStyle = isSnowy ? 'rgba(12, 28, 24, 0.28)' : 'rgba(14, 28, 12, 0.32)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 18, 22, 7, 0, 0, TAU);
    ctx.fill();

    const drawFacetLeaf = (
      sx: number,
      sy: number,
      angle: number,
      length: number,
      width: number,
      bend: number,
      colL: string,
      colD: string,
      colTip?: string
    ) => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const perpX = -sin;
      const perpY = cos;

      const tipX = sx + cos * length + perpX * bend;
      const tipY = sy + sin * length + perpY * bend;

      const midRatio = 0.44;
      const midCenterX = sx + cos * (length * midRatio) + perpX * (bend * 0.5);
      const midCenterY = sy + sin * (length * midRatio) + perpY * (bend * 0.5);

      const halfW = width * 0.5;
      const leftX = midCenterX + perpX * halfW;
      const leftY = midCenterY + perpY * halfW;
      const rightX = midCenterX - perpX * halfW;
      const rightY = midCenterY - perpY * halfW;

      ctx.fillStyle = colL;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(leftX, leftY);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(midCenterX, midCenterY);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = colD;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(rightX, rightY);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(midCenterX, midCenterY);
      ctx.closePath();
      ctx.fill();

      if (colTip) {
        ctx.fillStyle = colTip;
        const tipRatio = 0.65;
        const tMidX = sx + cos * (length * tipRatio) + perpX * (bend * 0.75);
        const tMidY = sy + sin * (length * tipRatio) + perpY * (bend * 0.75);
        ctx.beginPath();
        ctx.moveTo(tMidX, tMidY);
        ctx.lineTo(leftX * 0.3 + tipX * 0.7, leftY * 0.3 + tipY * 0.7);
        ctx.lineTo(tipX, tipY);
        ctx.closePath();
        ctx.fill();
      }
    };

    const palette = isSnowy
      ? {
          backL: '#3e7063',
          backD: '#234a40',
          midL: '#5c9987',
          midD: '#386659',
          frontL: '#81cbb4',
          frontD: '#498a76',
          tipL: '#d5f5ec',
        }
      : {
          backL: '#4d8253',
          backD: '#2d573c',
          midL: '#6fab3e',
          midD: '#467c30',
          frontL: '#98d836',
          frontD: '#6ea627',
          tipL: '#bbee46',
        };

    for (let i = 0; i < 7; i++) {
      const ang = -PI * 0.85 + (i / 6) * (PI * 0.7) + (rng() - 0.5) * 0.15;
      const len = 26 + rng() * 10;
      const w = 7.5 + rng() * 3;
      const bend = (rng() - 0.5) * 8;
      const baseOffset = (rng() - 0.5) * 14;
      drawFacetLeaf(cx + baseOffset, cy + 10, ang, len, w, bend, palette.backL, palette.backD);
    }

    const outerAngles = [-PI * 0.98, -PI * 0.88, -PI * 0.78, -PI * 0.22, -PI * 0.12, -PI * 0.02];
    for (let i = 0; i < outerAngles.length; i++) {
      const ang = outerAngles[i] + (rng() - 0.5) * 0.08;
      const len = 19 + rng() * 12;
      const w = 6 + rng() * 2.5;
      const bend = (i < 3 ? -1 : 1) * (2 + rng() * 4);
      drawFacetLeaf(cx + (i < 3 ? -7 : 7), cy + 8, ang, len, w, bend, palette.midL, palette.midD, palette.frontL);
    }

    const centralAngles = [-PI * 0.7, -PI * 0.6, -PI * 0.5, -PI * 0.4, -PI * 0.3];
    for (let i = 0; i < centralAngles.length; i++) {
      const ang = centralAngles[i] + (rng() - 0.5) * 0.1;
      const heightBonus = (1 - Math.abs(i - 2) * 0.25) * 12;
      const len = 27 + heightBonus + rng() * 6;
      const w = 8 + rng() * 2.5;
      const bend = (i - 2) * 2.5 + (rng() - 0.5) * 2;
      drawFacetLeaf(cx + (i - 2) * 4.5, cy + 9, ang, len, w, bend, palette.frontL, palette.frontD, palette.tipL);
    }

    for (let i = 0; i < 5; i++) {
      const ang = -PI * 0.78 + (i / 4) * (PI * 0.56) + (rng() - 0.5) * 0.1;
      const len = 15 + rng() * 8;
      const w = 7 + rng() * 2;
      const bend = (rng() - 0.5) * 4;
      drawFacetLeaf(cx + (i - 2) * 6, cy + 12, ang, len, w, bend, palette.frontL, palette.midD, palette.tipL);
    }
  }

  private snow(ctx: CanvasRenderingContext2D, rng: () => number, _variant: number): void {
    const mounds = 1 + (rng() > 0.45 ? 1 : 0);
    for (let i = 0; i < mounds; i++) {
      const mx = 10 + rng() * 28;
      const my = 12 + rng() * 24;
      const rx = 9 + rng() * 11;
      const ry = 2.4 + rng() * 2.2;
      const rot = (rng() - 0.5) * 0.35;
      oval(ctx, mx, my + 1, rx, ry, '#bad8ea45', rot);
      oval(ctx, mx - 0.4, my, rx * 0.9, ry * 0.75, '#ffffff95', rot);
    }

    if (rng() > 0.3) {
      const px = 6 + rng() * 36;
      const py = 6 + rng() * 36;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px, py - 1.5, 1, 3);
      ctx.fillRect(px - 1.5, py, 3, 1);
    }

    if (rng() > 0.65) {
      const px = 8 + rng() * 32, py = 8 + rng() * 32;
      oval(ctx, px, py, 2.2, 1.2, '#bad8ea50', -0.2);
      oval(ctx, px + 0.3, py - 0.3, 1.8, 0.9, '#ffffffa0', -0.2);
    }
  }

  private rock(ctx: CanvasRenderingContext2D, rng: () => number, renderScale: number): void {
    const width = 0.82 + rng() * 0.18, height = 0.76 + rng() * 0.24;
    ctx.save();
    ctx.translate(24, 26);
    ctx.scale(width, height);
    ctx.translate(-24, -26);
    oval(ctx, 25, 40, 22, 6, '#202b2945');
    const peak = 20 + rng() * 12, shoulder = 7 + rng() * 7;
    const contour = [2, 25, shoulder, 9, peak, 3, 40, 10, 47, 29, 38, 44, 14, 45, 3, 36];
    shape(ctx, contour, TERRAIN.rock);
    ctx.save();
    ctx.clip();
    shape(ctx, [peak, 3, 40, 10, 47, 29, 38, 44, 27, 46, 32, 26, 29, 14], '#616e7b');
    shape(ctx, [2, 28, 17, 31, 32, 26, 27, 46, 14, 45, 3, 36], '#748187');
    shape(ctx, [shoulder, 9, peak, 3, 29, 14, 17, 22, 3, 25], '#aeb9b5');
    shape(ctx, [17, 22, 29, 14, 32, 26, 24, 33, 10, 29], '#9ca7a0');
    for (let i = 0; i < 4; i++) {
      const x = rng() * 48, y = rng() * 48, w = 3 + rng() ** 2 * 25, h = 2 + rng() * 13;
      shape(ctx, [x - w, y, x - 2, y - h, x + w, y - h * 0.4, x + w * 0.7, y + h * 0.6, x + 1, y + h],
        i % 3 === 0 ? '#d7ceaf46' : '#32414b38');
    }
    if (rng() > 0.35) shape(ctx, [0, 35, 9, 30, 18, 34, 22, 43, 9, 47, 0, 43], '#5e70534d');
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(contour[0], contour[1]);
    for (let i = 2; i < contour.length; i += 2) ctx.lineTo(contour[i], contour[i + 1]);
    ctx.closePath();
    ctx.strokeStyle = '#42566a';
    ctx.lineWidth = 1.65 / renderScale;
    ctx.stroke();
    ctx.restore();
  }

  private ice(ctx: CanvasRenderingContext2D, rng: () => number, _variant: number): void {
    const frostCount = 1 + (rng() > 0.4 ? 1 : 0);
    for (let i = 0; i < frostCount; i++) {
      const fx = 8 + rng() * 32, fy = 8 + rng() * 32;
      const frx = 10 + rng() * 12, fry = 5 + rng() * 8;
      const frot = (rng() - 0.5) * 1.2;
      oval(ctx, fx, fy, frx, fry, '#e3f6fd35', frot);
      oval(ctx, fx + 1, fy - 1, frx * 0.6, fry * 0.55, '#ffffff40', frot);
    }

    const bubbles = Math.floor(rng() * 5);
    for (let i = 0; i < bubbles; i++) {
      const bx = 6 + rng() * 36, by = 6 + rng() * 36;
      const br = 1 + rng() * 1.5;
      oval(ctx, bx, by + 0.6, br, br, '#1e5f7845');
      oval(ctx, bx, by, br * 0.85, br * 0.85, '#daf6ffb0');
    }

    if (rng() > 0.25) {
      const sx = 5 + rng() * 16;
      const sy = 5 + rng() * 14;
      const mx = sx + 7 + rng() * 12;
      const my = sy + 9 + rng() * 12;
      const ex = mx + 7 + rng() * 13;
      const ey = my + 8 + rng() * 11;

      ctx.strokeStyle = '#4ea5c455';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(mx, my);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      ctx.strokeStyle = '#184f6670';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(sx + 0.8, sy + 1);
      ctx.lineTo(mx + 0.8, my + 1);
      ctx.lineTo(ex + 0.8, ey + 1);
      ctx.stroke();

      ctx.strokeStyle = '#ffffffea';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(mx, my);
      ctx.lineTo(ex, ey);

      const branches = 1 + (rng() > 0.4 ? 1 : 0);
      for (let b = 0; b < branches; b++) {
        const branchX = mx + (rng() - 0.5) * 16;
        const branchY = my + 6 + rng() * 10;
        ctx.moveTo(mx, my);
        ctx.lineTo(branchX, branchY);
      }
      ctx.stroke();
    }
  }

  drawSnowBanks(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    north: boolean,
    south: boolean,
    west: boolean,
    east: boolean,
    variation: number
  ): void {
    const rng = random(Math.floor(variation * 99991) + 431);
    const snowColor = TERRAIN.snow;
    const shadowColor = 'rgba(175, 210, 230, 0.4)';

    ctx.save();

    if (north && rng() > 0.25) {
      const cy = y;
      const count = rng() > 0.5 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const cx = x + 16 + (count === 1 ? 8 : i * 16) + (rng() - 0.5) * 6;
        const rx = 8 + rng() * 4, ry = 4 + rng() * 2.5;
        oval(ctx, cx, cy - 1, rx, ry, shadowColor);
        oval(ctx, cx, cy - 2, rx * 0.95, ry * 0.85, snowColor);
      }
    }

    if (south && rng() > 0.25) {
      const cy = y + TILE_SIZE;
      const count = rng() > 0.5 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const cx = x + 16 + (count === 1 ? 8 : i * 16) + (rng() - 0.5) * 6;
        const rx = 8 + rng() * 4, ry = 4 + rng() * 2.5;
        oval(ctx, cx, cy + 1, rx, ry, shadowColor);
        oval(ctx, cx, cy + 2, rx * 0.95, ry * 0.85, snowColor);
      }
    }

    if (west && rng() > 0.25) {
      const cx = x;
      const count = rng() > 0.5 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const cy = y + 16 + (count === 1 ? 8 : i * 16) + (rng() - 0.5) * 6;
        const rx = 4 + rng() * 2.5, ry = 8 + rng() * 4;
        oval(ctx, cx - 1, cy, rx, ry, shadowColor);
        oval(ctx, cx - 2, cy, rx * 0.85, ry * 0.95, snowColor);
      }
    }

    if (east && rng() > 0.25) {
      const cx = x + TILE_SIZE;
      const count = rng() > 0.5 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const cy = y + 16 + (count === 1 ? 8 : i * 16) + (rng() - 0.5) * 6;
        const rx = 4 + rng() * 2.5, ry = 8 + rng() * 4;
        oval(ctx, cx + 1, cy, rx, ry, shadowColor);
        oval(ctx, cx + 2, cy, rx * 0.85, ry * 0.95, snowColor);
      }
    }

    ctx.restore();
  }

  private drawOrganicBlob(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, rng: () => number, color: string): void {
    const numPoints = 6 + Math.floor(rng() * 3);
    const pts: [number, number][] = [];

    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * TAU + (rng() - 0.5) * 0.4;
      const rFactor = 0.65 + rng() * 0.65;
      pts.push([cx + Math.cos(angle) * (rx * rFactor), cy + Math.sin(angle) * (ry * rFactor)]);
    }

    ctx.beginPath();
    ctx.moveTo((pts[0][0] + pts[numPoints - 1][0]) / 2, (pts[0][1] + pts[numPoints - 1][1]) / 2);
    for (let i = 0; i < numPoints; i++) {
      const next = pts[(i + 1) % numPoints];
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + next[0]) / 2, (pts[i][1] + next[1]) / 2);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  drawSnowFringe(ctx: CanvasRenderingContext2D, x: number, y: number, variation: number, level: number): void {
    const rng = random(Math.floor(variation * 100000) + level * 7919);
    const shadowColor = 'rgba(165, 205, 225, 0.42)';

    if (level === 1 && rng() > 0.22) return;
    if (level === 2 && rng() > 0.4) return;
    if (level === 3 && rng() > 0.68) return;

    const numPatches = (level === 3 && rng() > 0.45) || (level === 2 && rng() > 0.75) ? 2 : 1;
    const p1x = x + 8 + rng() * 32;
    const p1y = y + 8 + rng() * 32;
    const spots: [number, number][] = [[p1x, p1y]];

    if (numPatches === 2) {
      const angle = rng() * TAU;
      const dist = 14 + rng() * 14;
      const p2x = Math.max(x + 6, Math.min(x + 42, p1x + Math.cos(angle) * dist));
      const p2y = Math.max(y + 6, Math.min(y + 42, p1y + Math.sin(angle) * dist));
      spots.push([p2x, p2y]);
    }

    for (let i = 0; i < spots.length; i++) {
      const [px, py] = spots[i];
      const baseR = level === 3 ? 10 + rng() * 6 : level === 2 ? 5 + rng() * 3.5 : 2.5 + rng() * 2;
      const rx = baseR * (1.15 + rng() * 0.4);
      const ry = baseR * (0.42 + rng() * 0.25);

      this.drawOrganicBlob(ctx, px, py + 1.2, rx * 1.05, ry * 1.05, rng, shadowColor);
      this.drawOrganicBlob(ctx, px - 0.3, py, rx, ry, rng, '#ffffff');
    }
  }

  private water(ctx: CanvasRenderingContext2D, rng: () => number, shore: number, variant: number): void {
    const half = TILE_SIZE / 2; // 24px
    const inset = 5;

    // 1. Base d'acqua profonda
    ctx.fillStyle = TERRAIN.water;
    ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

    for (let corner = 0; corner < 4; corner++) {
      const north = Boolean(shore & (1 << corner));
      const west = Boolean(shore & (1 << ((corner + 3) % 4)));
      const diagonal = Boolean(shore & (1 << (4 + ((corner + 3) % 4))));
      if (!north && !west && !diagonal) continue;

      ctx.save();
      ctx.translate(half, half);
      ctx.rotate((corner * Math.PI) / 2);
      ctx.translate(-half, -half);

      // Piccole variazioni organiche per ogni costa tramite rng
      const w1 = (rng() - 0.5) * 4;
      const w2 = (rng() - 0.5) * 4;
      const w3 = (rng() - 0.5) * 3;

      const edge = new Path2D();
      let sx: number, sy: number, ex: number, ey: number;

      if (north && west) {
        // Angolo interno: curva morbida ondulata invece del cerchio rigido
        sx = inset + w1; sy = half;
        ex = half; ey = inset + w2;
        edge.moveTo(sx, sy);
        edge.bezierCurveTo(
          inset + 3 + w1, half * 0.5,
          half * 0.5, inset + 3 + w2,
          ex, ey
        );
      } else if (north) {
        // Bordo dritto superiore: lieve andamento a duna/onda
        sx = 0; sy = inset + w1;
        ex = half; ey = inset + w2;
        edge.moveTo(sx, sy);
        edge.bezierCurveTo(7, inset + 1.5 + w3, 17, inset - 1.5 + w1, ex, ey);
      } else if (west) {
        // Bordo dritto sinistro
        sx = inset + w1; sy = half;
        ex = inset + w2; ey = 0;
        edge.moveTo(sx, sy);
        edge.bezierCurveTo(inset + 1.5 + w3, 17, inset - 1.5 + w1, 7, ex, ey);
      } else {
        // Spigolo diagonale leggero
        sx = 0; sy = inset * 0.8;
        ex = inset * 0.8; ey = 0;
        edge.moveTo(sx, sy);
        edge.quadraticCurveTo(inset * 0.5 + w1 * 0.5, inset * 0.5 + w2 * 0.5, ex, ey);
      }

      // Costruzione del poligono di terra da ritagliare
      const bank = new Path2D(edge);
      if (north && west) {
        bank.lineTo(half, 0); bank.lineTo(0, 0); bank.lineTo(0, half);
      } else if (north) {
        bank.lineTo(half, 0); bank.lineTo(0, 0);
      } else if (west) {
        bank.lineTo(0, 0); bank.lineTo(0, half);
      } else {
        bank.lineTo(0, 0);
      }
      bank.closePath();

      // 2. Ritaglio del terreno sottostante (erba/terra nativa)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fill(bank);
      ctx.globalCompositeOperation = 'source-over';

      // 3. Acqua bassa / riflesso schiuma turchese morbido verso l'acqua
      ctx.strokeStyle = 'rgba(125, 205, 210, 0.35)';
      ctx.lineWidth = 7;
      ctx.stroke(edge);

      // 4. Bordo fango / sabbia bagnata (transizione naturale)
      ctx.strokeStyle = '#a4916a';
      ctx.lineWidth = 3.2;
      ctx.stroke(edge);

      ctx.strokeStyle = '#c9b589';
      ctx.lineWidth = 1.4;
      ctx.stroke(edge);

      // 5. ZOLLE D'ERBA & FANGO CHE SPUNTANO NELL'ACQUA (stile neve)
      const numBlobs = 1 + (rng() > 0.4 ? 1 : 0);
      for (let b = 0; b < numBlobs; b++) {
        const t = 0.25 + rng() * 0.5;
        // Posizione lungo il bordo della sponda
        const bx = sx + (ex - sx) * t + (rng() - 0.5) * 3;
        const by = sy + (ey - sy) * t + (rng() - 0.5) * 3;


      }

      ctx.restore();
    }
  }

  paintGround(ctx: CanvasRenderingContext2D, tile: TileKind, x: number, y: number, dungeonFloor = false): void {
    const material = dungeonFloor
      ? 'stone'
      : tile === 'path' || tile === 'mud' || tile === 'snow' || tile === 'ice'
        ? tile
        : 'grass';

    let pattern = this.washes.get(material);
    if (!pattern) {
      const size = 1536, canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const art = canvas.getContext('2d')!, rng = random(834927);
      for (let i = 0; i < 68; i++) {
        const px = rng() * size, py = rng() * size;
        const w = 16 + rng() ** 2 * 115, h = 9 + rng() ** 2 * 60;
        const color = material === 'stone' ? (i % 2 ? '#d1c8af25' : '#313f3925')
          : material === 'path' ? (i % 2 ? '#ead19e2e' : '#82674829')
          : material === 'mud' ? (i % 2 ? '#c4ba8a2c' : '#3e634f28')
          : material === 'snow' ? (i % 2 ? '#ffffff40' : '#bad8ea30')
          : material === 'ice' ? (i % 2 ? '#d7f6ff2c' : '#367c9622')
          : i % 2 ? '#c5cb942e' : '#41684329';

        for (const dx of [-size, 0, size]) {
          for (const dy of [-size, 0, size]) {
            const cx = px + dx, cy = py + dy;
            shape(
              art,
              [
                cx - w, cy,
                cx - w * 0.6, cy - h,
                cx + w * 0.3, cy - h * 0.8,
                cx + w, cy - h * 0.2,
                cx + w * 0.7, cy + h * 0.6,
                cx - w * 0.2, cy + h,
              ],
              color
            );
          }
        }
      }
      pattern = ctx.createPattern(canvas, 'repeat')!;
      this.washes.set(material, pattern);
    }

    const t = ctx.getTransform();
    const left = Math.round(x * t.a + t.e), top = Math.round(y * t.d + t.f);
    const right = Math.round((x + TILE_SIZE) * t.a + t.e), bottom = Math.round((y + TILE_SIZE) * t.d + t.f);
    ctx.fillStyle = pattern;
    ctx.fillRect((left - t.e) / t.a, (top - t.f) / t.d, (right - left) / t.a, (bottom - top) / t.d);
  }

  private ground(ctx: CanvasRenderingContext2D, rng: () => number, tile: TileKind, isSnowy = false): void {
    if (tile === 'grass' && rng() > 0.78) {
      const x = 10 + rng() * 28, y = 17 + rng() * 24;
      ctx.strokeStyle = rng() > 0.5 ? '#526f4890' : '#718752a0';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(x, y + 3); ctx.quadraticCurveTo(x - 1, y - 2, x - 4, y - 6);
      ctx.moveTo(x, y + 3); ctx.quadraticCurveTo(x, y - 3, x + 1, y - 8);
      ctx.moveTo(x + 1, y + 3); ctx.quadraticCurveTo(x + 3, y - 1, x + 5, y - 5);
      ctx.stroke();
    }

    if (tile === 'path' && rng() > 0.72) {
      const x = 8 + rng() * 32, y = 10 + rng() * 29;

      if (isSnowy) {
        if (rng() > 0.42) {
          const rx = 3 + rng() * 4, ry = 1.5 + rng() * 1.5;
          oval(ctx, x, y + 0.6, rx, ry, '#bad8ea50', -0.15);
          oval(ctx, x, y, rx * 0.85, ry * 0.7, '#ffffffa0', -0.15);
        } else {
          const w = 2.2 + rng() * 1.6, h = 1.4 + rng() * 1.1;
          shape(ctx, [x - w, y, x - w * 0.4, y - h, x + w * 0.4, y - h * 0.8, x + w, y, x + w * 0.3, y + h, x - w * 0.5, y + h * 0.6], '#627179');
          shape(ctx, [x - w * 0.4, y - h, x + w * 0.4, y - h * 0.8, x + w * 0.2, y - h * 0.2, x - w * 0.3, y - h * 0.1], '#ffffff');
        }
      } else {
        const w = 2.8 + rng() * 2.3, h = 1.8 + rng() * 1.5;
        shape(ctx, [x - w, y, x - w * 0.45, y - h, x + w * 0.45, y - h * 0.8, x + w, y, x + w * 0.35, y + h, x - w * 0.65, y + h * 0.6], '#8e9788');
        shape(ctx, [x - w * 0.45, y - h, x + w * 0.45, y - h * 0.8, x + w * 0.15, y, x - w * 0.55, y + 0.2], '#b7b69f');
      }
    }
  }
}