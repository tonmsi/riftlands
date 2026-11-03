import { newWorldAsset, resizeWorldAsset, type WorldAsset } from './world-schema';
import type { ProceduralKind } from './procedural-generation';
import type { CliffVariant } from './terrain-cliffs';
const cache = new Map<string, WorldAsset>();
/** Internal canvas sources, never imported files or persisted catalog entries. */
export function proceduralFallback(kind: ProceduralKind, width = 1, height = 1, variant?: CliffVariant): WorldAsset {
  const key = `${kind}-${width}-${height}-${variant ?? ''}`;
  let a = cache.get(key);
  if (!a) {
    a = newWorldAsset(`procedural-${key}`, `JS · ${kind}`, `/world-assets/__procedural-${kind}-${variant ?? 'default'}.svg`);
    resizeWorldAsset(a,width,height);
    a.cells.forEach(c => { c.blocked = kind === 'rock' || kind === 'cliff'; c.visibility = kind === 'bush' ? 'hide-fade' : 'normal'; });
    cache.set(key,a);
  }
  return a;
}
