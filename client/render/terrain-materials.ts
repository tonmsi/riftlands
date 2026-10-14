import { TILE_SIZE } from '../../shared/config';
import type { SurfaceMaterial, WallMaterial } from '../../shared/world-surfaces';
import { groundColor, pathColor, TERRAIN } from './terrain-style';

const TEXTURES = ['grass', 'path', 'stone', 'brick', 'rock', 'sand', 'wood', 'mud', 'snow', 'ice'] as const;
const FACETED_TEXTURES = new Set<string>(['grass', 'path', 'rock', 'sand', 'wood', 'mud', 'snow', 'ice']);
export const MATERIAL_COLORS: Record<SurfaceMaterial, string> = {
  ...TERRAIN, stone: '#aaa99a', brick: '#ac8064', sand: '#d6c399', wood: '#a88760',
};
export const WALL_COLORS: Record<WallMaterial, string> = {
  earth: '#987750', rock: '#788487', stone: '#8a8e85', brick: '#9d7259', wood: '#8e6a48',
};
export const MATERIAL_PRIORITY: Record<SurfaceMaterial, number> = {
  grass: 1, bush: 1, ice: 2, mud: 3, sand: 3, path: 4, snow: 5, rock: 6, stone: 6, wood: 7, brick: 8, water: 0,
};

/** Join opposite texture edges once when rasterizing a cached pattern, without changing the source artwork. */
export function joinTextureEdges(ctx: CanvasRenderingContext2D, size: number): void {
  const image = ctx.getImageData(0, 0, size, size), data = image.data, band = 8;
  for (const vertical of [false, true]) for (let line = 0; line < size; line++) for (let offset = 0; offset < band; offset++) {
    const a = (vertical ? offset * size + line : line * size + offset) * 4;
    const b = (vertical ? (size - 1 - offset) * size + line : line * size + size - 1 - offset) * 4;
    const mix = .5 * (1 - offset / (band - 1));
    for (let channel = 0; channel < 3; channel++) {
      const left = data[a + channel], right = data[b + channel];
      data[a + channel] = Math.round(left * (1 - mix) + right * mix);
      data[b + channel] = Math.round(right * (1 - mix) + left * mix);
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** Nearby climate tints share a bitmap; four RGB units are imperceptible at gameplay zoom. */
function patternColor(color: string): string {
  const hex = /^#([\da-f]{6})$/i.exec(color);
  const rgb = hex ? [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16))
    : /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(color)?.slice(1).map(Number);
  return rgb ? `rgb(${rgb.map(value => Math.min(255, Math.round(value / 4) * 4)).join(',')})` : color;
}

/** Repeating artwork remains anchored to world coordinates, including clipped rounded corners. */
export class TerrainMaterials {
  private readonly images = new Map<string, HTMLCanvasElement>();
  private readonly patterns = new Map<string, CanvasPattern>();
  readonly ready: Promise<void>;
  constructor() {
    this.ready = Promise.all(TEXTURES.map(material => new Promise<void>(resolve => {
      const image = new Image();
      image.onload = () => {
        // Patterns already paint at this size. Retaining the full source PNG costs
        // about 6 MiB per material without adding any detail to the rendered world.
        try {
          const bitmap = document.createElement('canvas'); bitmap.width = bitmap.height = TILE_SIZE * 8;
          const paint = bitmap.getContext('2d');
          if (paint) { paint.drawImage(image, 0, 0, bitmap.width, bitmap.height); this.images.set(material, bitmap); this.patterns.clear(); }
        } finally { image.onload = null; image.onerror = null; resolve(); }
      };
      image.onerror = () => resolve();
      image.src = FACETED_TEXTURES.has(material)
        ? `/terrain-textures/faceted-v1/${material}${['grass', 'path', 'mud'].includes(material) ? '-sparse' : ''}.png` : `/terrain-textures/${material}.png`;
    }))).then(() => {});
  }
  color(material: SurfaceMaterial, moisture = .3, temperature = 1): string {
    return material === 'grass' ? groundColor(moisture, temperature)
      : material === 'path' ? pathColor(temperature) : MATERIAL_COLORS[material];
  }
  fill(ctx: CanvasRenderingContext2D, material: SurfaceMaterial | WallMaterial, color: string, elevationOffset = 0): string | CanvasPattern {
    const texture = material === 'earth' ? 'path' : material;
    const image = this.images.get(texture);
    if (!image) return color;
    const tint = patternColor(color);
    const key = `${texture}:${tint}:${elevationOffset}`;
    const cached = this.patterns.get(key);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    // Keep the painted blades/pebbles readable at gameplay zoom rather than crushing
    // a full illustration into four tiny tiles. The repeat still spans whole tiles.
    canvas.width = canvas.height = TILE_SIZE * 8;
    const paint = canvas.getContext('2d')!;
    paint.fillStyle = tint; paint.fillRect(0, 0, canvas.width, canvas.height);
    // Faceted artwork retains its palette; existing masonry uses climate-controlled luminance.
    paint.globalCompositeOperation = FACETED_TEXTURES.has(texture) ? 'source-over' : 'luminosity';
    paint.globalAlpha = FACETED_TEXTURES.has(texture) ? 1 : .82;
    paint.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (texture === 'grass' || texture === 'path') {
      paint.globalAlpha = .18; paint.fillStyle = tint;
      paint.fillRect(0, 0, canvas.width, canvas.height);
    }
    joinTextureEdges(paint, canvas.width);
    const pattern = ctx.createPattern(canvas, 'repeat');
    if (!pattern) return color;
    pattern.setTransform(new DOMMatrix().translate(0, -elevationOffset));
    if (this.patterns.size >= 192) this.patterns.delete(this.patterns.keys().next().value!);
    this.patterns.set(key, pattern);
    return pattern;
  }
}
