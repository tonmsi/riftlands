import { TILE_SIZE } from '../../shared/config';
import { elevationOf, type Elevated, type ElevationGeometry, type WorldSurface, type WorldStair } from '../../shared/elevation';
import type { Vec2 } from '../../shared/types';
import { newWorldAsset, resizeWorldAsset } from '../../shared/world-schema';
import { WorldAssetArt } from './world-asset-art';

const stairSprite = newWorldAsset('terrain-stair-art', 'Scala in pietra', '/world-assets/dungeon/Piastrella%20di%20Scale%20in%20Pietra%20con%20Muschio.png');
resizeWorldAsset(stairSprite, 2, 1);
const stairCrops = new WeakMap<HTMLCanvasElement, { x: number; y: number; width: number; height: number }>();
function drawStairSprite(ctx: CanvasRenderingContext2D, s: WorldStair, art: WorldAssetArt): void {
  const bitmap = art.image(stairSprite); if (!bitmap) return;
  let crop = stairCrops.get(bitmap);
  if (!crop) {
    const data = bitmap.getContext('2d')!.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let left = bitmap.width, top = bitmap.height, right = 0, bottom = 0;
    for (let y = 0; y < bitmap.height; y++) for (let x = 0; x < bitmap.width; x++) if (data[(y * bitmap.width + x) * 4 + 3] > 80) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
    }
    crop = right > left ? { x: left, y: top, width: right - left, height: bottom - top } : { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
    stairCrops.set(bitmap, crop);
  }
  const angle = s.axis === 'x' ? s.from > s.to ? -Math.PI / 2 : Math.PI / 2 : s.from > s.to ? 0 : Math.PI;
  const cross = (s.axis === 'x' ? s.height : s.width) * TILE_SIZE, length = (s.axis === 'x' ? s.width : s.height) * TILE_SIZE;
  ctx.save(); ctx.translate((s.x + s.width / 2) * TILE_SIZE, (s.y + s.height / 2) * TILE_SIZE); ctx.rotate(angle);
  ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, -cross / 2, -length / 2, cross, length); ctx.restore();
}

const colors = { grass: '#73865a', path: '#b6a17b', water: '#507d91', rock: '#77716a', bush: '#486b42', mud: '#796b51', snow: '#d1dcd5', ice: '#a0c7ce' };
export function drawElevationSurface(ctx: CanvasRenderingContext2D, s: WorldSurface, self?: Vec2 & Elevated | null): void {
  // Painted ground already uses the terrain renderer's material and texture.
  if (s.painted && s.ground) return;
  ctx.save();
  if (self && elevationOf(self) < s.elevation && self.x >= s.x * TILE_SIZE && self.x <= (s.x + s.width) * TILE_SIZE
    && self.y >= s.y * TILE_SIZE && self.y <= (s.y + s.height) * TILE_SIZE) ctx.globalAlpha = .35;
  ctx.fillStyle = colors[s.terrain ?? 'grass'];
  ctx.fillRect(s.x * TILE_SIZE, s.y * TILE_SIZE, s.width * TILE_SIZE, s.height * TILE_SIZE);
  if (!s.painted) {
    ctx.strokeStyle = 'rgba(25,30,25,.45)'; ctx.lineWidth = 2;
    ctx.strokeRect(s.x * TILE_SIZE + 1, s.y * TILE_SIZE + 1, s.width * TILE_SIZE - 2, s.height * TILE_SIZE - 2);
  }
  ctx.restore();
}
export function drawElevationStair(ctx: CanvasRenderingContext2D, s: WorldStair, floor: number, art?: WorldAssetArt): void {
  if(s.appearance==='passage')return;
  const half = s.axis === 'x' ? s.width / 2 : s.height / 2;
  const second = floor === s.to;
  const x = (s.x + (s.axis === 'x' && second ? half : 0)) * TILE_SIZE;
  const y = (s.y + (s.axis === 'y' && second ? half : 0)) * TILE_SIZE;
  const width = (s.axis === 'x' ? half : s.width) * TILE_SIZE;
  const height = (s.axis === 'y' ? half : s.height) * TILE_SIZE;
  ctx.save(); ctx.fillStyle = '#a39a7e'; ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = '#514b3e'; ctx.lineWidth = 2; ctx.beginPath();
  const length = s.axis === 'x' ? width : height;
  for (let t = 0; t < length; t += 10) {
    if (s.axis === 'x') { ctx.moveTo(x + t, y); ctx.lineTo(x + t, y + height); }
    else { ctx.moveTo(x, y + t); ctx.lineTo(x + width, y + t); }
  }
  ctx.stroke();
  if (art) { ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip(); drawStairSprite(ctx, s, art); }
  ctx.restore();
}
/** Editor overlay also works in asset-local tile coordinates. */
export function drawGeometryOverlay(ctx: CanvasRenderingContext2D, g: ElevationGeometry, elevation: number, all: boolean, selected?: string, fill = true): void {
  ctx.save(); ctx.font = '0.36px system-ui'; ctx.lineWidth = .045;
  for (const [kind, shapes] of [['surfaces', g.surfaces], ['solids', g.solids], ['stairs', g.stairs]] as const) for (const s of shapes) {
    const at = 'elevation' in s ? s.elevation : 'base' in s ? s.base : s.from;
    if (!all && at !== elevation && !('to' in s && s.to === elevation)) continue;
    ctx.globalAlpha = at === elevation || selected === s.id ? 1 : .4;
    ctx.fillStyle = kind === 'surfaces' ? '#8fce7c44' : kind === 'solids' ? '#ef997344' : '#e4c76a66';
    ctx.strokeStyle = selected === s.id ? '#ffffff' : kind === 'surfaces' ? '#8fce7c' : kind === 'solids' ? '#ef9973' : '#e4c76a';
    if (fill) ctx.fillRect(s.x, s.y, s.width, s.height);
    ctx.strokeRect(s.x, s.y, s.width, s.height);
    ctx.fillStyle = '#fff';
    const label = 'elevation' in s ? `${s.elevation}` : 'base' in s ? `[${s.base}, ${s.top})` : `${s.from} → ${s.to}`;
    ctx.fillText(label, s.x + .08, s.y + .4);
    if ('axis' in s) {
      const cx = s.x + s.width / 2, cy = s.y + s.height / 2;
      ctx.beginPath();
      if (s.axis === 'x') { ctx.moveTo(s.x + .1, cy); ctx.lineTo(s.x + s.width - .1, cy); ctx.moveTo(cx - .15, cy - .15); ctx.lineTo(cx + .15, cy); ctx.lineTo(cx - .15, cy + .15); }
      else { ctx.moveTo(cx, s.y + .1); ctx.lineTo(cx, s.y + s.height - .1); ctx.moveTo(cx - .15, cy - .15); ctx.lineTo(cx, cy + .15); ctx.lineTo(cx + .15, cy - .15); }
      ctx.stroke();
    }
  }
  ctx.restore();
}
