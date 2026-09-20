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
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}

function oval(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, rotation = 0): void {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rotation, 0, TAU); ctx.fillStyle = color; ctx.fill();
}

/** Small, bounded atlas: expensive foliage and mineral detail never runs per frame. */
export class EnvironmentArt {
  private readonly cache = new Map<string, HTMLCanvasElement>();
  private cachedPixels = 0;
  private readonly washes = new Map<string, CanvasPattern>();
  private waterSource?: object;
  private readonly waterPaint = new Map<string, { path: Path2D; color: string } | null>();

  /** Sparse multi-cell strokes, admitted only when their entire footprint is open water. */
  paintWater(ctx: CanvasRenderingContext2D, bounds: { left: number; top: number; right: number; bottom: number },
    world: { getTile(x: number, y: number): TileKind }): void {
    if (this.waterSource !== world) { this.waterPaint.clear(); this.waterSource = world; }
    const spacing = 110;
    for (let gy = Math.floor(bounds.top / spacing) - 1; gy <= Math.floor(bounds.bottom / spacing) + 1; gy++) {
      for (let gx = Math.floor(bounds.left / spacing) - 1; gx <= Math.floor(bounds.right / spacing) + 1; gx++) {
        const key = `${gx},${gy}`;
        if (!this.waterPaint.has(key)) {
          const rng = random(Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663) ^ 615937);
          let mark: { path: Path2D; color: string } | null = null;
          if (rng() > .12) {
            const x = (gx + rng()) * spacing, y = (gy + rng()) * spacing;
            const w = 27 + rng() * 48, h = 15 + rng() * 29;
            let clear = true;
            for (let ty = Math.floor((y - h - 5) / TILE_SIZE); clear && ty <= Math.floor((y + h + 5) / TILE_SIZE); ty++) {
              for (let tx = Math.floor((x - w - 5) / TILE_SIZE); tx <= Math.floor((x + w + 5) / TILE_SIZE); tx++) {
                if (world.getTile(tx, ty) !== 'water') { clear = false; break; }
              }
            }
            if (clear) {
              const path = new Path2D();
              path.moveTo(x-w, y); path.lineTo(x-w*.6, y-h); path.lineTo(x+w*.45, y-h*.7);
              path.lineTo(x+w, y+h*.1); path.lineTo(x+w*.5, y+h); path.lineTo(x-w*.5, y+h*.65); path.closePath();
              const light = rng() > .5;
              mark = { path, color: light ? '#c4ded018' : '#27566e16' };
            }
          }
          if (this.waterPaint.size >= 512) this.waterPaint.delete(this.waterPaint.keys().next().value!);
          this.waterPaint.set(key, mark);
        }
        const mark = this.waterPaint.get(key);
        if (mark) { ctx.fillStyle = mark.color; ctx.fill(mark.path); }
      }
    }
  }

  /** Replace square material corners with a compact curved cutout. */
  roundTerrainCorner(ctx: CanvasRenderingContext2D, x: number, y: number, corner: number, color: string, radius = 13): void {
    ctx.save(); ctx.translate(x + (corner === 1 || corner === 2 ? TILE_SIZE : 0),
      y + (corner >= 2 ? TILE_SIZE : 0));
    ctx.scale(corner === 1 || corner === 2 ? -1 : 1, corner >= 2 ? -1 : 1);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(radius, 0);
    ctx.quadraticCurveTo(0, 0, 0, radius); ctx.closePath();
    ctx.fillStyle = color; ctx.fill(); ctx.restore();
  }

  /** Sparse hand-drawn details soften the remaining junction at dungeon corners. */
  drawTerrainSeam(ctx: CanvasRenderingContext2D, x: number, y: number, variation: number): number {
    if (variation < .62) return 0;
    const rng = random(49157 + Math.floor(variation * 1_000_003));
    const stones = 2 + (rng() > .7 ? 1 : 0);
    for (let i = 0; i < stones; i++) {
      const angle = rng() * TAU, distance = 3 + rng() * 6;
      const px = x + Math.cos(angle) * distance, py = y + Math.sin(angle) * distance;
      const radius = 1.7 + rng() * 1.25;
      oval(ctx, px, py + .45, radius, radius * .68, '#717b7148', angle);
      oval(ctx, px - .3, py, radius * .82, radius * .55, i % 2 ? '#aeb09a' : '#b9b49a', angle);
    }
    if (rng() > .45) {
      const px = x + (rng() - .5) * 10, py = y + 3 + rng() * 5;
      ctx.beginPath(); ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px - 1, py - 4, px - 3, py - 6);
      ctx.moveTo(px, py); ctx.quadraticCurveTo(px, py - 5, px + 1, py - 7);
      ctx.moveTo(px + 1, py); ctx.quadraticCurveTo(px + 3, py - 3, px + 4, py - 5);
      ctx.strokeStyle = '#627c5190'; ctx.lineWidth = 1.05; ctx.stroke();
    }
    return stones;
  }

  /** Lily pads sit on calm water just inside banks, especially in sheltered corners. */
  drawWaterPlants(ctx: CanvasRenderingContext2D, x: number, y: number, variation: number, shore: number): number {
    const cardinal = shore & 15;
    const edgeCount = [1, 2, 4, 8].reduce((count, bit) => count + (cardinal & bit ? 1 : 0), 0);
    const corner = edgeCount >= 2 || Boolean(shore & 240);
    if (!shore || variation < (corner ? .42 : .72)) return 0;

    let dx = 0, dy = 0;
    if (cardinal & 1) dy += 8;
    if (cardinal & 2) dx -= 8;
    if (cardinal & 4) dy -= 8;
    if (cardinal & 8) dx += 8;
    if (!cardinal) {
      if (shore & 16) { dx -= 7; dy += 7; }
      if (shore & 32) { dx -= 7; dy -= 7; }
      if (shore & 64) { dx += 7; dy -= 7; }
      if (shore & 128) { dx += 7; dy += 7; }
    }

    const rng = random(23917 + Math.floor(variation * 1_000_003) + shore * 97);
    const count = corner ? 2 + (rng() > .64 ? 1 : 0) : 1 + (rng() > .82 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const px = x + 24 + dx + (rng() - .5) * 13;
      const py = y + 24 + dy + (rng() - .5) * 10;
      const radius = 3.4 + rng() * 2.2, rotation = rng() * TAU;
      oval(ctx, px + 1, py + 1.5, radius + .5, radius * .58, '#285f6460', rotation);
      ctx.save(); ctx.translate(px, py); ctx.rotate(rotation);
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, .32, TAU - .38);
      ctx.closePath(); ctx.fillStyle = i % 2 ? '#719b56' : '#86aa60'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(-radius * .7, -radius * .15);
      ctx.quadraticCurveTo(0, -radius * .7, radius * .7, -radius * .1);
      ctx.lineTo(0, 0); ctx.closePath(); ctx.fillStyle = '#abc27675'; ctx.fill();
      ctx.restore();
      if (corner && i === 0 && rng() > .7) {
        for (let petal = 0; petal < 4; petal++) {
          const angle = petal * Math.PI / 2;
          oval(ctx, px + Math.cos(angle) * 1.5, py + Math.sin(angle) * 1.2,
            1.4, .8, '#e3d7b7', angle);
        }
        oval(ctx, px, py, .7, .7, '#d6ad62');
      }
    }
    return count;
  }

  draw(ctx: CanvasRenderingContext2D, tile: TileKind, x: number, y: number, variation: number, shore = 0, width = 1, height = 1): void {
    const variant = tile === 'water' ? 0 : Math.min(VARIANTS - 1, Math.floor(variation * VARIANTS));
    const key = `${tile}:${variant}:${shore}:${width}:${height}`;
    let sprite = this.cache.get(key);
    if (!sprite) {
      sprite = document.createElement('canvas');
      sprite.width = TILE_SIZE * DENSITY * width;
      sprite.height = TILE_SIZE * DENSITY * height;
      const art = sprite.getContext('2d')!;
      art.scale(DENSITY, DENSITY);
      art.lineJoin = 'round';
      art.lineCap = 'round';
      const rng = random(7919 + variant * 104729);
      if (tile === 'rock' || tile === 'bush') {
        art.scale(width, height);
        const renderScale = Math.max(width, height);
        if (tile === 'rock') this.rock(art, rng, renderScale);
        else this.bush(art, rng, variant, renderScale);
      }
      else if (tile === 'water') this.water(art, rng, shore, variant);
      else this.ground(art, rng, tile);
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
    if (tile === 'water') {
      // Align the opaque water atlas with terrain coverage at fractional zoom.
      // Otherwise the ground beneath leaks through between adjacent sprites.
      const transform = ctx.getTransform();
      const left = Math.floor(x * transform.a + transform.e);
      const top = Math.floor(y * transform.d + transform.f);
      const right = Math.ceil((x + TILE_SIZE) * transform.a + transform.e);
      const bottom = Math.ceil((y + TILE_SIZE) * transform.d + transform.f);
      ctx.drawImage(sprite, (left - transform.e) / transform.a, (top - transform.f) / transform.d,
        (right - left) / transform.a, (bottom - top) / transform.d);
    } else ctx.drawImage(sprite, x, y, TILE_SIZE * width, TILE_SIZE * height);
  }

  private rock(ctx: CanvasRenderingContext2D, rng: () => number, renderScale: number): void {
    const width = .82 + rng() * .18, height = .76 + rng() * .24;
    ctx.save(); ctx.translate(24, 26); ctx.scale(width, height); ctx.translate(-24, -26);
    oval(ctx, 25, 40, 22, 6, '#202b2945');
    const peak = 20 + rng() * 12, shoulder = 7 + rng() * 7;
    const contour = [2, 25, shoulder, 9, peak, 3, 40, 10, 47, 29, 38, 44, 14, 45, 3, 36];
    shape(ctx, contour, TERRAIN.rock);
    ctx.save(); ctx.clip();
    shape(ctx, [peak, 3, 40, 10, 47, 29, 38, 44, 27, 46, 32, 26, 29, 14], '#616e7b');
    shape(ctx, [2, 28, 17, 31, 32, 26, 27, 46, 14, 45, 3, 36], '#748187');
    shape(ctx, [shoulder, 9, peak, 3, 29, 14, 17, 22, 3, 25], '#aeb9b5');
    shape(ctx, [17, 22, 29, 14, 32, 26, 24, 33, 10, 29], '#9ca7a0');
    for (let i = 0; i < 4; i++) {
      const x = rng() * 48, y = rng() * 48, w = 3 + rng() ** 2 * 25, h = 2 + rng() * 13;
      shape(ctx, [x-w,y, x-2,y-h, x+w,y-h*.4, x+w*.7,y+h*.6, x+1,y+h],
        i % 3 === 0 ? '#d7ceaf46' : '#32414b38');
    }
    if (rng() > .35) shape(ctx, [0,35, 9,30, 18,34, 22,43, 9,47, 0,43], '#5e70534d');
    ctx.restore();
    ctx.beginPath(); ctx.moveTo(contour[0], contour[1]);
    for (let i = 2; i < contour.length; i += 2) ctx.lineTo(contour[i], contour[i + 1]);
    ctx.closePath(); ctx.strokeStyle = '#42566a'; ctx.lineWidth = 1.65 / renderScale; ctx.stroke();
    ctx.restore();
  }

  private bush(ctx: CanvasRenderingContext2D, rng: () => number, _variant: number, renderScale: number): void {
    const scaleX = .87 + rng() * .16, scaleY = .86 + rng() * .16;
    ctx.save(); ctx.translate(24, 25); ctx.scale(scaleX, scaleY);
    oval(ctx, 2, 15, 22, 6, '#202d2840');
    const points: number[] = [];
    for (let i = 0; i < 16; i++) {
      const angle = i / 16 * TAU, radius = 18 + rng() * 6;
      points.push(Math.cos(angle) * radius, Math.sin(angle) * radius * .89);
    }
    ctx.beginPath(); ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    ctx.closePath(); ctx.fillStyle = bushColor(_variant / VARIANTS); ctx.fill();
    ctx.save(); ctx.clip();
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
    ctx.restore(); ctx.restore();
    ctx.save(); ctx.translate(24, 25); ctx.scale(scaleX, scaleY);
    // A broad outline keeps foliage readable over similarly coloured grass.
    ctx.beginPath(); ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    ctx.closePath(); ctx.strokeStyle = '#315b40'; ctx.lineWidth = 1.75 / renderScale; ctx.stroke();
    ctx.restore();
  }

  private water(ctx: CanvasRenderingContext2D, _rng: () => number, shore: number, _variant: number): void {
    // Each quarter joins the next at the same tangent. Diagonal neighbours round
    // inward bays as well as outward corners; no contour crosses a solid tile.
    const half = TILE_SIZE / 2, inset = 4, radius = 17;
    ctx.fillStyle = TERRAIN.water; ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    for (let corner = 0; corner < 4; corner++) {
      const north = Boolean(shore & (1 << corner));
      const west = Boolean(shore & (1 << ((corner + 3) % 4)));
      const diagonal = Boolean(shore & (1 << (4 + ((corner + 3) % 4))));
      if (!north && !west && !diagonal) continue;
      ctx.save();
      ctx.translate(half, half); ctx.rotate(corner * Math.PI / 2); ctx.translate(-half, -half);
      const edge = new Path2D();
      let sx: number, sy: number, ex: number, ey: number;
      if (north && west) {
        sx = inset; sy = half; ex = half; ey = inset;
        edge.moveTo(sx, sy);
        edge.arcTo(inset, inset, half, inset, radius);
        edge.lineTo(ex, ey);
      } else if (north) {
        sx = 0; sy = inset; ex = half; ey = inset;
        edge.moveTo(sx, sy);
        if (north) edge.bezierCurveTo(7, inset + 2, 17, inset - 2, ex, ey);
        else edge.bezierCurveTo(inset + 2, 17, inset - 2, 7, ex, ey);
      } else if (west) {
        sx = inset; sy = half; ex = inset; ey = 0;
        edge.moveTo(sx, sy);
        if (north) edge.bezierCurveTo(7, inset + 2, 17, inset - 2, ex, ey);
        else edge.bezierCurveTo(inset + 2, 17, inset - 2, 7, ex, ey);
      } else {
        sx = 0; sy = inset; ex = inset; ey = 0;
        edge.moveTo(sx, sy); edge.arc(0, 0, inset, Math.PI / 2, 0, true);
      }
      // Broad shallow water, a restrained contour, then the dry bank.
      ctx.lineCap = 'butt';
      ctx.strokeStyle = '#79b7b2'; ctx.lineWidth = 14; ctx.stroke(edge);
      ctx.strokeStyle = '#d3e7d4'; ctx.lineWidth = 5; ctx.stroke(edge);
      ctx.strokeStyle = '#39777d'; ctx.lineWidth = 2; ctx.stroke(edge);
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
      ctx.globalCompositeOperation = 'destination-out'; ctx.fill(bank);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#d6c297'; ctx.lineWidth = 2.5; ctx.stroke(edge);
      ctx.restore();
    }
  }
  /** Prepainted world-anchored washes: one fill per tile, no brush generation per frame. */
  paintGround(ctx: CanvasRenderingContext2D, tile: TileKind, x: number, y: number, dungeonFloor = false): void {
    const material = dungeonFloor ? 'stone' : tile === 'path' || tile === 'mud' ? tile : 'grass';
    let pattern = this.washes.get(material);
    if (!pattern) {
      const size = 1536, canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const art = canvas.getContext('2d')!, rng = random(834927);
      for (let i = 0; i < 68; i++) {
        const px = rng() * size, py = rng() * size;
        const w = 16 + rng() ** 2 * 115, h = 9 + rng() ** 2 * 60;
        const color = material === 'stone' ? (i % 2 ? '#d1c8af25' : '#313f3925') : material === 'path' ? (i % 2 ? '#ead19e2e' : '#82674829')
          : material === 'mud' ? (i % 2 ? '#c4ba8a2c' : '#3e634f28')
          : (i % 2 ? '#c5cb942e' : '#41684329');
        // Wrap whole marks at pattern boundaries so there are no texture seams.
        for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
          const cx = px + dx, cy = py + dy;
          shape(art, [cx-w,cy, cx-w*.6,cy-h, cx+w*.3,cy-h*.8,
            cx+w,cy-h*.2, cx+w*.7,cy+h*.6, cx-w*.2,cy+h], color);
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

  private ground(ctx: CanvasRenderingContext2D, rng: () => number, tile: TileKind): void {
    if (tile === 'grass' && rng() > .78) {
      const x = 10 + rng() * 28, y = 17 + rng() * 24;
      ctx.strokeStyle = rng() > .5 ? '#526f4890' : '#718752a0';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(x, y + 3); ctx.quadraticCurveTo(x - 1, y - 2, x - 4, y - 6);
      ctx.moveTo(x, y + 3); ctx.quadraticCurveTo(x, y - 3, x + 1, y - 8);
      ctx.moveTo(x + 1, y + 3); ctx.quadraticCurveTo(x + 3, y - 1, x + 5, y - 5);
      ctx.stroke();
    }

    if (rng() > (tile === 'path' ? .78 : .92)) {
      const x = 8 + rng() * 32, y = 10 + rng() * 29;
      const w = 2.8 + rng() * 2.3, h = 1.8 + rng() * 1.5;
      // Tiny angular stones use warm midtones and a lit face, never dark round pebbles.
      shape(ctx, [x-w,y, x-w*.45,y-h, x+w*.45,y-h*.8, x+w,y, x+w*.35,y+h, x-w*.65,y+h*.6], '#8e9788');
      shape(ctx, [x-w*.45,y-h, x+w*.45,y-h*.8, x+w*.15,y, x-w*.55,y+.2], '#b7b69f');
    }
  }
}
