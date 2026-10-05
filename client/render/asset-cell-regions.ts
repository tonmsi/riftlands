import type { AssetCell, AssetPlacement, WorldAsset } from '../../shared/world-schema';
import { worldAssetImageBounds } from '../../shared/world-schema';

/** Merge adjacent cells before rasterization, so shared tile edges never become image seams. */
export function assetCellRegions(asset: WorldAsset, include: (cell: AssetCell) => boolean): { x: number; y: number; width: number; height: number }[] {
  const image = worldAssetImageBounds(asset);
  const left = Math.min(0, image.x), top = Math.min(0, image.y);
  const right = Math.max(asset.width, image.x + image.width), bottom = Math.max(asset.height, image.y + image.height);
  const regions: { x: number; y: number; width: number; height: number }[] = [];
  let previous = new Map<string, typeof regions[number]>();
  for (let y = 0; y < asset.rows; y++) {
    const current = new Map<string, typeof regions[number]>();
    for (let x = 0; x < asset.columns;) {
      if (!include(asset.cells[y * asset.columns + x])) { x++; continue; }
      const start = x;
      while (x < asset.columns && include(asset.cells[y * asset.columns + x])) x++;
      const key = `${start}:${x}`, prior = previous.get(key);
      const rowTop = y === 0 ? top : y, rowBottom = y === asset.rows - 1 ? bottom : y + 1;
      const regionLeft = start === 0 ? left : start, regionRight = x === asset.columns ? right : x;
      const height = rowBottom - rowTop;
      const region = prior ?? { x: regionLeft, y: rowTop, width: regionRight - regionLeft, height: 0 };
      region.height += height;
      if (!prior) regions.push(region);
      current.set(key, region);
    }
    previous = current;
  }
  return regions;
}

/** Complementary drawing passes share hard pixel edges, even while the camera is between pixels. */
export function clipAssetCells(ctx: CanvasRenderingContext2D, asset: WorldAsset, placement: AssetPlacement, unit: number, include: (cell: AssetCell) => boolean): void {
  const transform = ctx.getTransform();
  const snapX = (x: number) => (Math.round(x * transform.a + transform.e) - transform.e) / transform.a;
  const snapY = (y: number) => (Math.round(y * transform.d + transform.f) - transform.f) / transform.d;
  ctx.beginPath();
  for (const region of assetCellRegions(asset, include)) {
    const left = snapX((placement.x + region.x) * unit), top = snapY((placement.y + region.y) * unit);
    const right = snapX((placement.x + region.x + region.width) * unit), bottom = snapY((placement.y + region.y + region.height) * unit);
    ctx.rect(left, top, right - left, bottom - top);
  }
  ctx.clip();
}
