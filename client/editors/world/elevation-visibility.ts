import { subtractRect, type ElevationGeometry, type ElevationRect, type WorldSurface, type WorldSolid, type WorldStair } from '../../../shared/elevation';
import { worldAssetImageBounds, type AssetPlacement, type WorldAsset } from '../../../shared/world-schema';
import type { WorldAssetArt } from '../../render/world-asset-art';
import { assetCellElevationGeometry } from '../../../shared/asset-cell-elevation';

/** Null means every floor, including floors added after opening the editor. */
export type ElevationVisibility = readonly number[] | null;
export const floorVisible = (filter: ElevationVisibility | undefined, elevation: number): boolean => filter == null || filter.includes(elevation);
export function parseVisibleFloors(text: string): number[] {
  if (!text.trim()) return [];
  const parts = text.split(',').map(s => s.trim());
  if (parts.some(s => !/^-?\d+$/.test(s) || Number(s) < -128 || Number(s) > 127)) throw new Error('Indica quote intere da -128 a 127, separate da virgole.');
  return [...new Set(parts.map(Number))].sort((a, b) => a - b);
}
export function shapeVisible(s: WorldSurface | WorldSolid | WorldStair, filter: ElevationVisibility | undefined): boolean {
  if (filter == null) return true;
  if ('elevation' in s) return floorVisible(filter, s.elevation);
  if ('base' in s) return !s.id.endsWith('-mass') && filter.some(e => e >= s.base && e < s.top);
  return floorVisible(filter, s.from) || floorVisible(filter, s.to);
}
export function filterGeometry(g: ElevationGeometry, filter: ElevationVisibility): ElevationGeometry {
  if (filter === null) return g;
  return { surfaces: g.surfaces.filter(s => shapeVisible(s, filter)).flatMap(s => exposedSurfaceParts(s, g)), solids: g.solids.filter(s => shapeVisible(s, filter)), stairs: g.stairs.filter(s => shapeVisible(s, filter)).flatMap(s => {
    if (floorVisible(filter, s.from) && floorVisible(filter, s.to)) return [s];
    const second = floorVisible(filter, s.to);
    return [{ ...s, x: s.x + (second && s.axis === 'x' ? s.width / 2 : 0), y: s.y + (second && s.axis === 'y' ? s.height / 2 : 0), width: s.axis === 'x' ? s.width / 2 : s.width, height: s.axis === 'y' ? s.height / 2 : s.height }];
  }) };
}
/** Terrain mass removes lower floors; a suspended bridge leaves those floors in place. */
export function exposedSurfaceParts(s: WorldSurface, geometry: ElevationGeometry): WorldSurface[] {
  let parts = [s];
  for (const mass of geometry.solids) if (mass.id.endsWith('-mass') && mass.base <= s.elevation && s.elevation < mass.top)
    parts = parts.flatMap(r => subtractRect(r, mass));
  return parts;
}
export function assetVisible(a: WorldAsset, base: number, filter: ElevationVisibility | undefined): boolean {
  return floorVisible(filter, base) || a.cells.some(c=>c.elevation!==undefined&&floorVisible(filter,base+c.elevation)) || !!a.geometry?.surfaces.some(s => floorVisible(filter, base + s.elevation));
}

/** The bitmap's unannotated region belongs to its base; each surface region has its own floor. */
export function drawVisibleAsset(ctx: CanvasRenderingContext2D, art: WorldAssetArt, a: WorldAsset, p: AssetPlacement,
  base: number, filter: ElevationVisibility | undefined, unit: number, time: number, opacity = 1, fade = 0, frameOverride?: number): void {
  if (filter == null) { art.draw(ctx, a, p, opacity, unit, time, fade, fade, frameOverride); return; }
  const surfaces = assetCellElevationGeometry(a).surfaces;
  const rect = (r: Pick<ElevationRect, 'x' | 'y' | 'width' | 'height'>) => ctx.rect((p.x + r.x) * unit, (p.y + r.y) * unit, r.width * unit, r.height * unit);
  if (floorVisible(filter, base)) {
    ctx.save();
    const image = worldAssetImageBounds(a);
    const left = Math.min(0, image.x), top = Math.min(0, image.y);
    const bounds = { x: left, y: top, width: Math.max(a.columns, image.x + image.width) - left, height: Math.max(a.rows, image.y + image.height) - top };
    for (const s of surfaces) { ctx.beginPath(); rect(bounds); rect(s); ctx.clip('evenodd'); }
    art.draw(ctx, a, p, opacity, unit, time, fade, fade, frameOverride); ctx.restore();
  }
  for (const s of surfaces.filter(s => floorVisible(filter, base + s.elevation)).sort((a, b) => a.elevation - b.elevation)) {
    ctx.save(); ctx.beginPath(); rect(s); ctx.clip();
    art.draw(ctx, a, p, opacity, unit, time, fade, fade, frameOverride); ctx.restore();
  }
}
