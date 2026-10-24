import { worldAssetImageBounds, type AssetPlacement, type WorldAsset } from '../../../shared/world-schema';
import { assetCellElevationGeometry } from '../../../shared/asset-cell-elevation';
import { subtractRect } from '../../../shared/elevation';
import type { Vec2 } from '../../../shared/types';
import { floorVisible, type ElevationVisibility } from './elevation-visibility';

/** Use the same derived floors as rendering, including subdivided collision cells. */
export function assetAtFloor(a: WorldAsset, base: number, elevation: number, local: Vec2): boolean {
  const surfaces = assetCellElevationGeometry(a).surfaces.filter(s => local.x >= s.x && local.y >= s.y && local.x < s.x + s.width && local.y < s.y + s.height);
  return surfaces.length ? surfaces.some(s => base + s.elevation === elevation) : base === elevation;
}
export function assetPickFloor(a: WorldAsset, base: number, local: Vec2, visible: ElevationVisibility): number | undefined {
  const surfaces = assetCellElevationGeometry(a).surfaces.filter(s => local.x >= s.x && local.y >= s.y && local.x < s.x + s.width && local.y < s.y + s.height);
  if (!surfaces.length) return floorVisible(visible,base) ? base : undefined;
  return surfaces.map(s=>base+s.elevation).filter(e=>floorVisible(visible,e)).sort((a,b)=>b-a)[0];
}
export function compareAssetDrawOrder(p: AssetPlacement, q: AssetPlacement, assets: ReadonlyMap<string, WorldAsset>): number {
  const a = assets.get(p.assetId)!, b = assets.get(q.assetId)!;
  return (a.layer === 'ground' ? -1 : 1) - (b.layer === 'ground' ? -1 : 1)
    || p.y + a.height * (p.pivotY ?? a.pivot.y) - q.y - b.height * (q.pivotY ?? b.pivot.y) || p.id.localeCompare(q.id);
}
export function canPaintTerrainLevel(current: number, target: number): boolean {
  return Number.isInteger(target) && target >= -128 && target <= 127 && target <= current + 1;
}

export interface SelectionRect { left: number; top: number; right: number; bottom: number; }
export function selectionRect(a: Vec2, b: Vec2): SelectionRect {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}
export function intersectsSelection(a: SelectionRect, b: SelectionRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
/** Match the artwork footprint and the floor clipping used by the canvas. */
export function assetInSelection(a: WorldAsset, p: AssetPlacement, base: number, visible: ElevationVisibility, box: SelectionRect): boolean {
  const image = worldAssetImageBounds(a);
  const clip = { x: Math.max(image.x, box.left - p.x), y: Math.max(image.y, box.top - p.y),
    right: Math.min(image.x + image.width, box.right - p.x), bottom: Math.min(image.y + image.height, box.bottom - p.y) };
  if (clip.x >= clip.right || clip.y >= clip.bottom) return false;
  let baseParts = [{ x: clip.x, y: clip.y, width: clip.right - clip.x, height: clip.bottom - clip.y }];
  for (const surface of assetCellElevationGeometry(a).surfaces) {
    if (floorVisible(visible, base + surface.elevation) && intersectsSelection(
      { left: clip.x, top: clip.y, right: clip.right, bottom: clip.bottom },
      { left: surface.x, top: surface.y, right: surface.x + surface.width, bottom: surface.y + surface.height })) return true;
    baseParts = baseParts.flatMap(part => subtractRect(part, surface));
  }
  return floorVisible(visible, base) && baseParts.length > 0;
}
