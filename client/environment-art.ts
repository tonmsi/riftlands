import { TILE_SIZE } from '../shared/config';
import type { TileKind } from '../shared/types';

const TAU = Math.PI * 2;
const DENSITY = 2;
const VARIANTS = 12;
const CACHE_LIMIT = 256;

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

  draw(ctx: CanvasRenderingContext2D, tile: TileKind, x: number, y: number, variation: number, shore = 0): void {
    const variant = Math.min(VARIANTS - 1, Math.floor(variation * VARIANTS));
    const key = `${tile}:${variant}:${shore}`;
    let sprite = this.cache.get(key);
    if (!sprite) {
      sprite = document.createElement('canvas');
      sprite.width = sprite.height = TILE_SIZE * DENSITY;
      const art = sprite.getContext('2d')!;
      art.scale(DENSITY, DENSITY);
      art.lineJoin = 'round';
      art.lineCap = 'round';
      const rng = random(7919 + variant * 104729);
      if (tile === 'rock') this.rock(art, rng);
      else if (tile === 'bush') this.bush(art, rng, variant);
      else if (tile === 'water') this.water(art, rng, shore, variant);
      else this.ground(art, rng, tile);
      if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, sprite);
    }
    ctx.drawImage(sprite, x, y, TILE_SIZE, TILE_SIZE);
  }

  private rock(ctx: CanvasRenderingContext2D, rng: () => number): void {
    const peak = 24 + rng() * 9, shoulder = 9 + rng() * 5;
    oval(ctx, 25, 40, 22, 6, '#29374740');
    const contour = [3, 24, shoulder, 8, peak, 4, 41, 13, 45, 30, 39, 41, 15, 43, 4, 36];
    shape(ctx, contour, '#899bb4');
    shape(ctx, [peak, 4, 41, 13, 45, 30, 39, 41, 29, 42, 33, 28, 30, 15], '#596b8b');
    shape(ctx, [4, 29, 16, 34, 33, 28, 29, 42, 15, 43, 4, 36], '#6c7f9c');
    shape(ctx, [shoulder, 8, peak, 4, 30, 15, 17, 19, 6, 25], '#b9cbd4');
    // A single inked silhouette and broad shadow planes match the character sprites.
    ctx.beginPath(); ctx.moveTo(contour[0], contour[1]);
    for (let i = 2; i < contour.length; i += 2) ctx.lineTo(contour[i], contour[i + 1]);
    ctx.closePath(); ctx.strokeStyle = '#30394e'; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.strokeStyle = '#e1e8dc'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(shoulder + 1, 10); ctx.lineTo(peak - 1, 7); ctx.stroke();
    ctx.strokeStyle = '#3e4c68'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(24, 23); ctx.lineTo(20, 28); ctx.lineTo(24, 32); ctx.moveTo(20, 28); ctx.lineTo(15, 27); ctx.stroke();
    if (rng() > .3) {
      shape(ctx, [5, 34, 9, 29, 15, 31, 18, 35, 15, 39, 7, 39], '#4e874c');
      shape(ctx, [6, 33, 10, 30, 15, 32, 12, 35], '#a2c95f');
    }
    oval(ctx, 39, 43, 4, 2.3, '#3c485b');
    oval(ctx, 39, 42, 3, 1.5, '#c1cbd4');
  }

  private bush(ctx: CanvasRenderingContext2D, rng: () => number, variant: number): void {
    const crown = 20 + rng() * 7;
    oval(ctx, 25, 39, 21, 6, '#26453540');
    const silhouette = () => {
      ctx.beginPath(); ctx.moveTo(6, 34);
      ctx.bezierCurveTo(0, 31, 2, 21, 8, 19); ctx.bezierCurveTo(3, 9, 12, 5, 18, 9);
      ctx.bezierCurveTo(20, 1, crown + 11, 2, 33, 11); ctx.bezierCurveTo(44, 7, 49, 19, 41, 25);
      ctx.bezierCurveTo(49, 31, 42, 42, 32, 39); ctx.bezierCurveTo(27, 46, 17, 43, 14, 39);
      ctx.bezierCurveTo(8, 42, 3, 39, 6, 34); ctx.closePath();
    };
    silhouette(); ctx.fillStyle = '#4c984d'; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.beginPath(); ctx.moveTo(2, 30); ctx.quadraticCurveTo(13, 37, 21, 29);
    ctx.quadraticCurveTo(29, 37, 37, 25); ctx.lineTo(48, 19); ctx.lineTo(48, 48); ctx.lineTo(0, 48); ctx.closePath();
    ctx.fillStyle = '#306b45'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(6, 19); ctx.bezierCurveTo(5, 8, 14, 8, 20, 13);
    ctx.bezierCurveTo(21, 3, 32, 6, 32, 14); ctx.quadraticCurveTo(24, 12, 19, 22);
    ctx.quadraticCurveTo(14, 17, 6, 23); ctx.closePath(); ctx.fillStyle = '#99ce62'; ctx.fill();
    ctx.restore();
    silhouette(); ctx.strokeStyle = '#254333'; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.strokeStyle = '#306b45'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(11, 25); ctx.quadraticCurveTo(15, 20, 19, 25);
    ctx.moveTo(27, 21); ctx.quadraticCurveTo(32, 17, 36, 21); ctx.stroke();
    oval(ctx, 12, 13, 3, 1.3, '#d4e68b', -.5);
    oval(ctx, 25, 10, 2.4, 1.2, '#d4e68b', -.2);
    if (variant % 4 === 0) {
      for (const [x, y] of [[13, 29], [29, 24], [34, 29]]) {
        oval(ctx, x, y, 2.4, 2.4, '#603c57');
        oval(ctx, x, y - .4, 1.7, 1.6, '#e47eaa');
        oval(ctx, x - .5, y - 1, .6, .6, '#ffe1bc');
      }
    }
  }

  private water(ctx: CanvasRenderingContext2D, rng: () => number, shore: number, variant: number): void {
    // Mask order: north, east, south, west. Shore detail stays inside solid water tiles.
    for (let side = 0; side < 4; side++) {
      if (!(shore & (1 << side))) continue;
      ctx.save(); ctx.translate(24, 24); ctx.rotate(side * Math.PI / 2); ctx.translate(-24, -24);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(48, 0); ctx.lineTo(48, 12);
      ctx.bezierCurveTo(30, 8, 18, 16, 0, 12); ctx.closePath();
      ctx.fillStyle = '#69c4c1'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(48, 0);
      ctx.lineTo(48, 3); ctx.bezierCurveTo(32, 3, 33, 6, 22, 4); ctx.bezierCurveTo(13, 2, 9, 5, 0, 3); ctx.closePath();
      ctx.fillStyle = '#e4c98c'; ctx.fill();
      ctx.strokeStyle = '#39777d'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, 3); ctx.bezierCurveTo(9, 5, 13, 2, 22, 4); ctx.bezierCurveTo(33, 6, 32, 3, 48, 3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 5); ctx.bezierCurveTo(13, 7, 14, 4, 24, 6); ctx.bezierCurveTo(33, 8, 39, 5, 48, 5);
      ctx.strokeStyle = '#d8f5dd'; ctx.lineWidth = 1.5; ctx.stroke();
      if (variant % 3 === 0) {
        const x = 10 + rng() * 28;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 5; i++) {
          const bx = x + i * 1.5;
          ctx.beginPath(); ctx.moveTo(bx, 11); ctx.quadraticCurveTo(bx - 3, 4, bx - 4 + rng() * 7, 1);
          ctx.strokeStyle = i % 2 ? '#c6d97b' : '#3d794c'; ctx.stroke();
        }
      }
      ctx.restore();
    }
    if (shore && variant % 4 === 1) {
      for (let i = 0; i < 2; i++) {
        const x = 17 + i * 10, y = 26 - i * 8;
        oval(ctx, x + 1, y + 2, 5, 3, '#23677570');
        ctx.beginPath(); ctx.moveTo(x, y); ctx.ellipse(x, y, 4.5, 3, -.3, .4, TAU - .2); ctx.closePath();
        ctx.fillStyle = i ? '#b2d76a' : '#7dbb57'; ctx.fill();
        ctx.strokeStyle = '#357353'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }

  private ground(ctx: CanvasRenderingContext2D, rng: () => number, tile: TileKind): void {
    if (tile === 'grass') {
      for (let i = 0; i < 2; i++) {
        const x = 7 + rng() * 34, y = 9 + rng() * 32;
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = i % 2 ? '#cee29275' : '#4b7a4680';
        ctx.beginPath(); ctx.moveTo(x - 3, y - 3); ctx.quadraticCurveTo(x - 1, y - 2, x, y + 1);
        ctx.moveTo(x, y); ctx.quadraticCurveTo(x, y - 4, x + 2, y - 6);
        ctx.moveTo(x, y + 1); ctx.quadraticCurveTo(x + 2, y - 2, x + 4, y - 2); ctx.stroke();
        if (rng() > .975) {
          oval(ctx, x + 2, y - 6, 2, 1.5, '#fff1c4');
          oval(ctx, x + 2, y - 6, .8, .8, '#e4ad46');
        }
      }
    } else if (tile === 'path') {
      for (let i = 0; i < 3; i++) {
        const x = 3 + rng() * 42, y = 3 + rng() * 42;
        oval(ctx, x, y + .7, 1.2 + rng() * 1.4, .8 + rng(), '#a7855570');
        oval(ctx, x, y, 1 + rng(), .7, '#f6dba0');
      }
    } else if (tile === 'mud') {
      for (let i = 0; i < 2; i++) {
        const x = 10 + rng() * 28, y = 10 + rng() * 28;
        oval(ctx, x, y, 5 + rng() * 5, 2 + rng() * 2, '#64795d70', -.2);
        oval(ctx, x - 1, y - 1, 3 + rng() * 3, .7, '#bcc68e', -.2);
      }
    }
  }
}
