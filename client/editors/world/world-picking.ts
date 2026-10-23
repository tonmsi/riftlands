import type { AssetPlacement, WorldAsset } from '../../../shared/world-schema';
import { assetCellElevationGeometry } from '../../../shared/asset-cell-elevation';
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
  return Number.isInteger(target) && target >= -128 && target <= 127 && Math.abs(current - target) <= 1;
}
