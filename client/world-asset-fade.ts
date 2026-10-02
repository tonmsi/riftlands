import { assetCellFades, DEFAULT_ASSET_FADE, type WorldAsset } from '../shared/world-schema';

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
export function makeAssetFadeMask(asset: WorldAsset, width: number, height: number): HTMLCanvasElement {
  const crisp = document.createElement('canvas'); crisp.width = width; crisp.height = height;
  const paint = crisp.getContext('2d')!, sx = width / asset.width, sy = height / asset.height;
  paint.fillStyle = '#fff';
  for (let y = 0; y < asset.rows; y++) for (let x = 0; x < asset.columns; x++) if (assetCellFades(asset.cells[y * asset.columns + x])) paint.fillRect(x * sx, y * sy, sx, sy);
  const mask = document.createElement('canvas'); mask.width = width; mask.height = height;
  const ctx = mask.getContext('2d')!, feather = asset.fade?.feather ?? DEFAULT_ASSET_FADE.feather;
  ctx.filter = feather ? `blur(${Math.min(sx, sy) * feather / 2}px)` : 'none'; ctx.drawImage(crisp, 0, 0);
  ctx.filter = 'none'; ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(crisp, 0, 0);
  return mask;
}
