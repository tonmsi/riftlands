import { assetCellFades, DEFAULT_ASSET_FADE, worldAssetImageBounds, type WorldAsset } from '../shared/world-schema';
import { assetCellRegions } from './asset-cell-regions';

/** A small bounded per-instance transition cache; render time, never frame rate, controls fading. */
export class AssetFadeTransitions {
  private states = new Map<string, { active: boolean; from: number; start: number; value: number }>();
  amount(id: string, asset: WorldAsset, active: boolean, time: number): number {
    let state = this.states.get(id);
    if (!state && !active) return 0;
    const duration = asset.fade?.durationMs ?? DEFAULT_ASSET_FADE.durationMs;
    if (!state) state = { active, from: 0, start: time, value: 0 };
    if (state.active !== active) { state = { active, from: state.value, start: time, value: state.value }; }
    const t = duration ? Math.max(0, Math.min(1, (time - state.start) / duration)) : 1, eased = t * t * (3 - 2 * t);
    state.value = state.from + ((active ? 1 : 0) - state.from) * eased;
    this.states.delete(id);
    if (active || state.value > 0) this.states.set(id, state);
    while (this.states.size > 2048) this.states.delete(this.states.keys().next().value!);
    return state.value;
  }
}
/** Blur is clipped back to fade cells: opaque cells retain their exact alpha, including at seams. */
export function makeAssetFadeMask(asset: WorldAsset, width: number, height: number, visibility?: 'fade' | 'hide-fade'): HTMLCanvasElement {
  const crisp = document.createElement('canvas'); crisp.width = width; crisp.height = height;
  const image = worldAssetImageBounds(asset);
  const paint = crisp.getContext('2d')!, sx = width / image.width, sy = height / image.height;
  paint.fillStyle = '#fff';
  for (const r of assetCellRegions(asset, cell => visibility ? cell.visibility === visibility : assetCellFades(cell))) {
    const left = Math.round((r.x - image.x) * sx), top = Math.round((r.y - image.y) * sy);
    paint.fillRect(left, top, Math.round((r.x + r.width - image.x) * sx) - left, Math.round((r.y + r.height - image.y) * sy) - top);
  }
  const mask = document.createElement('canvas'); mask.width = width; mask.height = height;
  const ctx = mask.getContext('2d')!, feather = asset.fade?.feather ?? DEFAULT_ASSET_FADE.feather;
  ctx.filter = feather ? `blur(${Math.min(sx, sy) * feather / 2}px)` : 'none'; ctx.drawImage(crisp, 0, 0);
  ctx.filter = 'none'; ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(crisp, 0, 0);
  return mask;
}
