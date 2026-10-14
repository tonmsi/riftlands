import { TILE_SIZE } from '../../shared/config';
import type { TileKind } from '../../shared/types';
import { TERRAIN, bushColor } from './terrain-style';
import { joinTextureEdges } from './terrain-materials';
import { grassDetailDensity, grassPlantPlacements } from './terrain-distribution';
import { grassPlantArt } from './grass-plant-art';
import { shoreCurve, curvePath, shorePoint, shoreBankRibbon, shoreBankWidth, sampleShoreCurve, type ShoreCurve } from './water-shore';

const TAU = Math.PI * 2;
const DENSITY = 2;
const VARIANTS = 12;
const CACHE_LIMIT = 384;
export interface WaterBankStyle { edge: string; highlight: string; kind?: 'raised' | 'slope' | 'rock' | 'frozen'; }

/** Stroke the whole contour at once; translucent layers must not accumulate at tile joints. */
export function paintWaterBank(ctx: CanvasRenderingContext2D, edge: Path2D, style: WaterBankStyle,
  curves?: readonly ShoreCurve[], elevationOffset = 0): void {
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const band = (color: string, width: number) => {
    if (curves) { ctx.fillStyle = color; ctx.fill(shoreBankRibbon(curves, width)); }
    else { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(edge); }
  };
  if (style.kind === 'raised' || style.kind === 'rock') {
    band('#223f3c2c', 13); band('#26453c4a', 9);
    band(style.kind === 'rock' ? '#737a6c' : '#92744e', 8.5);
    band(style.edge, 2.2); band(style.highlight + 'b0', .8);
    if (style.kind === 'raised' && curves) paintEarthBankDetails(ctx, curves, elevationOffset);
  } else if (style.kind === 'frozen') {
    band('#c4e9e940', 12); band(style.edge, 3); band(style.highlight, 1.1);
  } else {
    band('#91c9be16', 22);
    ctx.shadowColor = style.edge + '80'; ctx.shadowBlur = 5;
    band(style.edge + '65', 6);
    ctx.shadowBlur = 0; band(style.highlight + '70', 3);
  }
  ctx.restore();
}

let earthBankGrain: HTMLCanvasElement | undefined;
const earthBankPatterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();

/** A small transparent grain repeat decorates exposed earth, anchored to the world, never to a tile. */
function earthBankPattern(ctx: CanvasRenderingContext2D, lift: number): CanvasPattern {
  if (!earthBankGrain) {
    const size = 192, source = document.createElement('canvas'); source.width = source.height = size;
    const art = source.getContext('2d')!, rng = random(581729);
    for (let i = 0; i < 1800; i++) {
      const x = rng()*size, y = rng()*size, rx = .25+rng()*.85, ry = .2+rng()*.5;
      const color = i%3 ? '#53473760' : '#d5b97c85';
      for (const ox of [-size,0,size]) for (const oy of [-size,0,size]) oval(art,x+ox,y+oy,rx,ry,color);
    }
    for (let i = 0; i < 120; i++) {
      const x=rng()*size,y=rng()*size,radius=1.3+rng()*2.6,angle=rng()*.6;
      for (const ox of [-size,0,size]) for (const oy of [-size,0,size]) {
        oval(art,x+ox,y+oy,radius,radius*.48,i%2?'#6b563d30':'#bca06b35',angle);
      }
    }
    earthBankGrain = source;
  }
  let pattern = earthBankPatterns.get(ctx);
  if (!pattern) { pattern = ctx.createPattern(earthBankGrain,'repeat')!; earthBankPatterns.set(ctx,pattern); }
  pattern.setTransform(new DOMMatrix().translate(0,-lift));
  return pattern;
}

function paintEarthBankDetails(ctx: CanvasRenderingContext2D, curves: readonly ShoreCurve[], lift: number): void {
  const soil = shoreBankRibbon(curves,8.5);
  ctx.save(); ctx.clip(soil); ctx.fillStyle = earthBankPattern(ctx,lift); ctx.fill(soil);
  const roots = new Path2D(), moss = new Path2D(), mossLight = new Path2D();
  for (const curve of curves) {
    const seed = Math.imul(Math.round(curve.start[0]*16),73856093)
      ^ Math.imul(Math.round((curve.start[1]+lift)*16),19349663);
    const rng = random(seed ^ 429721), rootChance = rng(), mossChance = rng();
    if (rootChance > .70) {
      const p = sampleShoreCurve(curve,.25+rng()*.5), length = Math.hypot(p.dx,p.dy)||1;
      const nx=-p.dy/length,ny=p.dx/length,ax=p.dx/length,ay=p.dy/length;
      const half=4.25*shoreBankWidth(p.dx,p.dy),bend=(rng()-.5)*2;
      roots.moveTo(p.x-nx*half*.65,p.y-ny*half*.65);
      roots.quadraticCurveTo(p.x+ax*bend,p.y+ay*bend,p.x+nx*half*.85+ax,p.y+ny*half*.85+ay);
      roots.moveTo(p.x,p.y); roots.lineTo(p.x+nx*half*.55-ax,p.y+ny*half*.55-ay);
    }
    if (mossChance > .58) {
      const p = sampleShoreCurve(curve,.2+rng()*.6), length=Math.hypot(p.dx,p.dy)||1;
      const nx=-p.dy/length,ny=p.dx/length,ax=p.dx/length,ay=p.dy/length;
      const scale=shoreBankWidth(p.dx,p.dy),angle=Math.atan2(p.dy,p.dx);
      for (let i=0;i<3;i++) {
        const x=p.x+ax*(i-1)*1.4-nx*.8,y=p.y+ay*(i-1)*1.4-ny*.8;
        moss.moveTo(x,y); moss.ellipse(x,y,1.1+rng()*1.2,(.45+rng()*.45)*scale,angle,0,TAU);
        mossLight.moveTo(x,y); mossLight.ellipse(x-.2,y-.25,.8,.35*scale,angle,0,TAU);
      }
    }
  }
  ctx.strokeStyle='#514632a0'; ctx.lineWidth=.65; ctx.stroke(roots);
  ctx.fillStyle='#607644bb'; ctx.fill(moss); ctx.fillStyle='#a4b16a95'; ctx.fill(mossLight);
  ctx.restore();
}

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
  private waterRevision = '';
  private readonly waterPaint = new Map<string, { path: Path2D; color: string; ripples: Path2D } | null>();
  private shrubAtlas: HTMLImageElement | null = null;
  private waterTexture: HTMLCanvasElement | null = null;
  readonly ready: Promise<void>;

  constructor() {
    this.ready = Promise.all([new Promise<void>(resolve => {
      const image = new Image();
      image.onload = () => {
        this.shrubAtlas = image;
        for (const key of [...this.cache.keys()]) if (key.startsWith('bush:')) {
          const old = this.cache.get(key)!;
          this.cachedPixels -= old.width * old.height;
          this.cache.delete(key);
        }
        resolve();
      };
      image.onerror = () => resolve();
      image.src = '/terrain-textures/shrubs.png';
    }), new Promise<void>(resolve => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = TILE_SIZE * 8;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = TERRAIN.water; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        joinTextureEdges(ctx, canvas.width); this.waterTexture = canvas;
        for (const key of [...this.cache.keys()]) if (key.startsWith('water:')) {
          const old = this.cache.get(key)!; this.cachedPixels -= old.width * old.height; this.cache.delete(key);
        }
        resolve();
      };
      image.onerror = () => resolve(); image.src = '/terrain-textures/faceted-v1/water-sparse.png';
    })]).then(() => {});
  }

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
    world: { getTile(x: number, y: number): TileKind; authoringRevision?: number; lockRevision?: number }
  ): void {
    const revision = `${world.authoringRevision ?? 0}:${world.lockRevision ?? 0}`;
    if (this.waterSource !== world || this.waterRevision !== revision) {
      this.waterPaint.clear();
      this.waterSource = world;
      this.waterRevision = revision;
    }
    const spacing = 110;
    for (let gy = Math.floor(bounds.top / spacing) - 1; gy <= Math.floor(bounds.bottom / spacing) + 1; gy++) {
      for (let gx = Math.floor(bounds.left / spacing) - 1; gx <= Math.floor(bounds.right / spacing) + 1; gx++) {
        const key = `${gx},${gy}`;
        if (!this.waterPaint.has(key)) {
          const rng = random(Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663) ^ 615937);
          let mark: { path: Path2D; color: string; ripples: Path2D } | null = null;
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
              path.bezierCurveTo(x - w * .8, y - h, x + w * .3, y - h, x + w, y);
              path.bezierCurveTo(x + w * .6, y + h, x - w * .7, y + h, x - w, y);
              path.closePath();
              const ripples = new Path2D();
              for (let i = 0; i < 4; i++) {
                const rx = x - w * .65 + rng() * w * .6, ry = y - h * .55 + i * h * .35;
                const length = 10 + rng() * w * .6;
                ripples.moveTo(rx, ry);
                ripples.bezierCurveTo(rx + length * .35, ry - 2.5, rx + length * .7, ry + 2, rx + length, ry - .8);
              }
              const light = rng() > 0.5;
              mark = { path, color: light ? '#b9e5da19' : '#245e7016', ripples };
            }
          }
          if (this.waterPaint.size >= 512) this.waterPaint.delete(this.waterPaint.keys().next().value!);
          this.waterPaint.set(key, mark);
        }
        const mark = this.waterPaint.get(key);
        if (mark) {
          ctx.fillStyle = mark.color;
          ctx.fill(mark.path);
          ctx.strokeStyle = '#b0e4dd60'; ctx.lineWidth = 1.05;
          ctx.stroke(mark.ripples);
        }
      }
    }
  }

  roundTerrainCorner(ctx: CanvasRenderingContext2D, x: number, y: number, corner: number, color: string | CanvasPattern, radius = 13): void {
    ctx.save();
    const vx = x + (corner === 1 || corner === 2 ? TILE_SIZE : 0), vy = y + (corner >= 2 ? TILE_SIZE : 0);
    const sx = corner === 1 || corner === 2 ? -1 : 1, sy = corner >= 2 ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(vx, vy);
    ctx.lineTo(vx + radius * sx, vy);
    ctx.quadraticCurveTo(vx, vy, vx, vy + radius * sy);
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

  drawWaterPlants(ctx: CanvasRenderingContext2D, x: number, y: number, variation: number, shore: number,
    curves?: readonly (ShoreCurve | undefined)[]): number {
    const cardinal = shore & 15;
    const edgeCount = [1, 2, 4, 8].reduce((count, bit) => count + (cardinal & bit ? 1 : 0), 0);
    const corner = edgeCount >= 2 || Boolean(shore & 240);
    if (!shore || variation < (corner ? 0.85 : 0.94)) return 0;

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
    const available = curves?.filter((curve): curve is ShoreCurve => Boolean(curve));
    for (let i = 0; i < count; i++) {
      let px = x + 24 + dx + (rng() - 0.5) * 13;
      let py = y + 24 + dy + (rng() - 0.5) * 10;
      if (available?.length) {
        const point = shorePoint(available[i % available.length], .3 + rng() * .4, 0);
        const offset = 9 + rng() * 4;
        px = x + point.x + point.nx * offset; py = y + point.y + point.ny * offset;
      }
      const radius = 3.7 + rng() * 2.5;
      const rotation = rng() * TAU;
      oval(ctx, px + 1, py + 1.5, radius + 0.5, radius * 0.58, '#285f6460', rotation);
      ctx.strokeStyle = '#b4ded14a'; ctx.lineWidth = .7; ctx.beginPath();
      ctx.ellipse(px, py + .8, radius + 2, radius * .64 + 1.2, rotation, 0, TAU); ctx.stroke();
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
    isSnowy = false,
    waterBanks?: readonly WaterBankStyle[]
  ): void {
    const variant = tile === 'bush'
      ? Math.floor(variation * 16) % 16
      : tile === 'water'
        ? shore ? Math.floor(variation * 6) % 6 : 0
        : Math.min(VARIANTS - 1, Math.floor(variation * VARIANTS));

    const repeat = TILE_SIZE * 8;
    const phaseX = ((Math.round(x) % repeat) + repeat) % repeat, phaseY = ((Math.round(y) % repeat) + repeat) % repeat;
    const key = `${tile}:${variant}:${shore}:${width}:${height}:${isSnowy ? 1 : 0}${waterBanks ? `:${waterBanks.map(bank => bank.edge + bank.highlight + bank.kind).join(',')}` : ''}${tile === 'water' && this.waterTexture ? `:${phaseX}:${phaseY}` : ''}`;
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
        if (this.shrubAtlas) {
          this.drawIllustratedShrub(art, variant, isSnowy);
        } else if (this.bushSvgImage && this.bushSvgImage.complete) {
          this.drawBushFromSvg(art, variant % 4, isSnowy);
        } else {
          this.bushVariant(art, random(99127 + variant * 45293), variant % 4, 1, isSnowy);
        }
      } else if (tile === 'rock') {
        art.scale(width, height);
        this.rock(art, random(7919 + variant * 104729), Math.max(width, height));
      } else if (tile === 'water') {
        this.water(art, random(7919 + variant * 104729), shore, variant, waterBanks, phaseX, phaseY);
      } else if (tile === 'snow') {
        this.snow(art, random(7919 + variant * 104729), variant);
      } else if (tile === 'ice') {
        // The material texture already contains ice facets and cracks.
      } else if (tile !== 'grass' && tile !== 'path' && tile !== 'mud') {
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

  private drawIllustratedShrub(ctx: CanvasRenderingContext2D, variant: number, snowy: boolean): void {
    const atlas = this.shrubAtlas!;
    const side = atlas.width / 2, height = atlas.height / 2, index = variant % 4;
    const rng = random(99127 + variant * 45293);
    // The atlas leaves generous padding; its leafy silhouette covers the original
    // blocking tile. Small stable variations break up neighboring shrub rows.
    const size = 73 + rng() * 8;
    ctx.save();
    ctx.translate(24 + (rng() - .5) * 4, 22 + (rng() - .5) * 3);
    ctx.rotate((rng() - .5) * .17);
    ctx.scale(variant & 4 ? -1 : 1, .92 + rng() * .09);
    ctx.filter = snowy ? 'saturate(.48) hue-rotate(22deg) brightness(.94)'
      : `hue-rotate(${(variant >> 2) * 3 - 3}deg) brightness(${.96 + rng() * .09})`;
    ctx.drawImage(atlas, index % 2 * side, Math.floor(index / 2) * height, side, height, -size / 2, -size / 2, size, size);
    ctx.filter = 'none';
    if (snowy) for (const [x, y, radius] of [[-9, -15, 10], [9, -7, 8], [-13, 3, 6]]) {
      oval(ctx, x, y + .9, radius, radius * .46, '#aac8d9c0', -.1);
      oval(ctx, x - .4, y, radius * .94, radius * .39, '#f1f8f9e0', -.1);
    }
    ctx.restore();
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

  private bushVariant(ctx: CanvasRenderingContext2D, rng: () => number, _variant: number, renderScale: number, isSnowy = false): void {
    const scaleX = .87 + rng() * .16, scaleY = .86 + rng() * .16;
    ctx.save(); ctx.translate(24, 25); ctx.scale(scaleX, scaleY);
    oval(ctx, 2, 15, 22, 6, isSnowy ? '#1b2d2b40' : '#202d2840');
    
    const points: number[] = [];
    for (let i = 0; i < 16; i++) {
      const angle = i / 16 * TAU, radius = 18 + rng() * 6;
      points.push(Math.cos(angle) * radius, Math.sin(angle) * radius * .89);
    }
    ctx.beginPath(); ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    ctx.closePath();
    ctx.fillStyle = isSnowy ? '#22483d' : bushColor(_variant / 4);
    ctx.fill();

    ctx.save(); ctx.clip();
    if (isSnowy) {
      // Fogliame pino scuro interno
      shape(ctx, [-27,-17, 4,-25, 20,-13, 9,0, -6,7, -25,0], '#2e5b4e');
      shape(ctx, [9,0, 20,-13, 29,2, 15,20, -2,25, -6,7], '#16362d');

      // -------------------------------------------------------------
      // NEVE RANDOMICA SUL CESPUGLIO (varia su ognuna delle 4 varianti!)
      // -------------------------------------------------------------
      
      // 1. Calotta principale sulla sommità (dimensione e centro asimmetrici)
      const topX = -2 + (rng() - 0.5) * 10;
      const topY = -14 + (rng() - 0.5) * 5;
      const topRx = 11 + rng() * 7;
      const topRy = 6 + rng() * 5;
      const topRot = (rng() - 0.5) * 0.35;

      oval(ctx, topX, topY + 1.5, topRx, topRy, '#bad4e2', topRot);
      oval(ctx, topX - 0.5, topY, topRx * 0.92, topRy * 0.85, '#ffffff', topRot);

      // 2. Accumulo laterale sinistro (può esserci o no in base a rng)
      if (rng() > 0.25) {
        const leftX = -13 + (rng() - 0.5) * 6;
        const leftY = -3 + (rng() - 0.5) * 6;
        const leftR = 6 + rng() * 4;
        oval(ctx, leftX, leftY + 1.2, leftR, leftR * 0.75, '#bad4e2');
        oval(ctx, leftX, leftY, leftR * 0.9, leftR * 0.7, '#ffffff');
      }

      // 3. Accumulo laterale destro (variabile)
      if (rng() > 0.25) {
        const rightX = 13 + (rng() - 0.5) * 6;
        const rightY = 1 + (rng() - 0.5) * 6;
        const rightR = 7 + rng() * 4;
        oval(ctx, rightX, rightY + 1.2, rightR, rightR * 0.75, '#bad4e2');
        oval(ctx, rightX, rightY, rightR * 0.9, rightR * 0.7, '#ffffff');
      }

      // 4. Bacche invernali rosse (numero e posizioni casuali per cespuglio)
      const berryCount = Math.floor(rng() * 4); // da 0 a 3 bacche
      for (let b = 0; b < berryCount; b++) {
        const bx = -14 + rng() * 28;
        const by = -6 + rng() * 18;
        oval(ctx, bx, by, 2.1, 2.1, '#aa2233');
        oval(ctx, bx - 0.5, by - 0.6, 0.7, 0.7, '#ffffff');
      }
    } else {
      shape(ctx, [-27,-17, 4,-25, 20,-13, 9,0, -6,7, -25,0], '#a8ca72');
      shape(ctx, [9,0, 20,-13, 29,2, 15,20, -2,25, -6,7], '#70a15d');
      for (let i = 0; i < 5; i++) {
        const x = rng() * 48 - 24, y = rng() * 42 - 21, w = 3 + rng() ** 2 * 22;
        shape(ctx, [x-w,y, x-w*.3,y-4, x+w*.5,y-6, x+w,y+1, x+1,y+5],
          i % 3 === 0 ? '#c0cc8848' : '#244e3b40');
      }
      if (_variant % 4 === 0) {
        for (const [x, y] of [[-10, 3], [4, -7], [12, 8]] as const) {
          oval(ctx, x, y, 2.2, 2, '#713f58');
          oval(ctx, x - .5, y - .7, .75, .65, '#d99aaa');
        }
      }
    }
    ctx.restore(); ctx.restore();

    ctx.save(); ctx.translate(24, 25); ctx.scale(scaleX, scaleY);
    ctx.beginPath(); ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    ctx.closePath();
    ctx.strokeStyle = isSnowy ? '#17362f' : '#315b40';
    ctx.lineWidth = 1.75 / renderScale;
    ctx.stroke();
    ctx.restore();
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

  private drawOrganicBlob(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, rng: () => number, color: string | CanvasGradient): void {
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
      const frost = ctx.createLinearGradient(px, py - ry, px, py + ry);
      frost.addColorStop(0, '#f0f6f2'); frost.addColorStop(.5, '#e5eef0'); frost.addColorStop(1, '#bfd1da');
      this.drawOrganicBlob(ctx, px - 0.3, py, rx, ry, rng, frost);
      for (let speck = 0; speck < 3; speck++) {
        const sx = px + (rng() - .5) * rx, sy = py + (rng() - .5) * ry * .8;
        oval(ctx, sx, sy, .8 + rng(), .45, '#9dbcc33a');
      }
    }
  }

  private water(ctx: CanvasRenderingContext2D, _rng: () => number, shore: number, variant: number, banks?: readonly WaterBankStyle[], phaseX = 0, phaseY = 0): void {
    ctx.fillStyle = TERRAIN.water; ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    if (this.waterTexture) {
      const pattern = ctx.createPattern(this.waterTexture, 'repeat')!;
      pattern.setTransform(new DOMMatrix().translate(-phaseX, -phaseY));
      ctx.fillStyle = pattern; ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    }
    for (let corner = 0; corner < 4; corner++) {
      const curve = shoreCurve(shore, corner, variant / 5);
      if (!curve) continue;
      const edge = curvePath(curve), bank = curvePath(curve, true);
      const style = banks?.[corner] ?? { edge: '#a4916a', highlight: '#c9b589', kind: 'slope' };
      ctx.save(); ctx.translate(24, 24); ctx.rotate(corner * Math.PI / 2); ctx.translate(-24, -24);
      ctx.globalCompositeOperation = 'destination-out'; ctx.fill(bank); ctx.globalCompositeOperation = 'source-over';
        paintWaterBank(ctx, edge, style);
      ctx.restore();
    }
  }

  paintGround(ctx: CanvasRenderingContext2D, tile: TileKind, x: number, y: number, dungeonFloor = false, moisture=.4, snowy=false, logicalY=y): void {
    const material = dungeonFloor
      ? 'stone'
      : tile === 'path' || tile === 'mud' || tile === 'snow' || tile === 'ice'
        ? tile
        : 'grass';

    let pattern = this.washes.get(material);
    if (!pattern) {
      const size = 768, canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const art = canvas.getContext('2d')!, rng = random(834927);
      for (let i = 0; i < 40; i++) {
        const px = rng() * size, py = rng() * size;
        const radius = 18 + rng() * 40;
        const color = material === 'stone' ? (i % 2 ? '#d1c8af12' : '#313f3910')
          : material === 'path' ? (i % 2 ? '#ead19e18' : '#82674812')
          : material === 'mud' ? (i % 2 ? '#c4ba8a18' : '#3e634f12')
          : material === 'snow' ? (i % 2 ? '#ffffff30' : '#bad8ea20')
          : material === 'ice' ? (i % 2 ? '#d7f6ff20' : '#367c9616')
          : i % 2 ? '#c5cb9414' : '#41684310';

        for (const dx of [-size, 0, size]) {
          for (const dy of [-size, 0, size]) {
            const cx = px + dx, cy = py + dy;
            const fade = art.createRadialGradient(cx, cy, 0, cx, cy, radius);
            fade.addColorStop(0, color); fade.addColorStop(1, color.slice(0, 7) + '00');
            art.fillStyle = fade; art.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
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
    // Sparse deterministic accents belong to the world, not the repeating texture.
    if (tile === 'grass' && !dungeonFloor) {
      const tx = Math.floor(x / TILE_SIZE), ty = Math.floor(logicalY / TILE_SIZE);
      for(const plant of grassPlantPlacements(tx,ty))
        grassPlantArt.draw(ctx,x+plant.x,y+plant.y,plant.variant,moisture,plant.scale,snowy);
    }
    if (tile === 'path' && !dungeonFloor) {
      const rng = random(Math.imul(Math.floor(x / TILE_SIZE), 73856093) ^ Math.imul(Math.floor(y / TILE_SIZE), 19349663) ^ 6271);
      if (rng() < grassDetailDensity(Math.floor(x / TILE_SIZE) + 41, Math.floor(y / TILE_SIZE) - 29) * .8) {
        ctx.save(); ctx.translate(x, y); this.ground(ctx, rng, 'path'); ctx.restore();
      }
    }
  }

  private ground(ctx: CanvasRenderingContext2D, rng: () => number, tile: TileKind, isSnowy = false): void {
    if (tile === 'grass') {
      grassPlantArt.draw(ctx,12+rng()*24,20+rng()*20,Math.floor(rng()*12),.4,.6+rng()*.15,isSnowy);
      if (!isSnowy && rng() > .87) {
        const x = 8 + rng() * 32, y = 8 + rng() * 32;
        for (let flower = 0; flower < 2; flower++) {
          const px = x + flower * 4, py = y + flower * 2;
          for (let petal = 0; petal < 4; petal++) {
            const angle = petal * Math.PI / 2;
            oval(ctx, px + Math.cos(angle) * 1.2, py + Math.sin(angle) * 1.2, 1.1, .8, '#e8e1b6', angle);
          }
          oval(ctx, px, py, .65, .65, '#c9b263');
        }
      }
    }

    if (tile === 'path') for (let pebble = 0, count = 1 + Math.floor(rng() * 3); pebble < count; pebble++) {
      const x = 5 + rng() * 38, y = 6 + rng() * 36;

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
        const w = 1.5 + rng() * 2.8, h = .9 + rng() * 1.8;
        oval(ctx, x + .5, y + .8, w + .5, h, '#6f674738');
        shape(ctx, [x - w, y, x - w * 0.45, y - h, x + w * 0.45, y - h * 0.8, x + w, y, x + w * 0.35, y + h, x - w * 0.65, y + h * 0.6], '#96977e');
        shape(ctx, [x - w * 0.45, y - h, x + w * 0.45, y - h * 0.8, x + w * 0.15, y, x - w * 0.55, y + 0.2], '#c8c0a1');
      }
    }
  }
}
