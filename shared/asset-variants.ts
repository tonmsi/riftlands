import { coordinateHash } from './coordinate-random';
import type { WorldAsset } from './world-schema';

export function assetVariants(assets: readonly WorldAsset[], asset: WorldAsset): WorldAsset[] {
  const root = asset.variantOf ?? asset.id;
  return assets.filter(a => a.id === root || a.variantOf === root).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Stable across clients, reloads, catalog order and render frames. */
export function pickAssetVariant(variants: readonly WorldAsset[], x: number, y: number, seed: number): WorldAsset {
  return variants[Math.floor(coordinateHash(x, y, seed + 31847) * variants.length)];
}
