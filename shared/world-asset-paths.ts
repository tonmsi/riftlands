import type { WorldDocument } from './world-schema';

export const assetFilePath = (image: string): string => { try { return decodeURIComponent(image.split(/[?#]/)[0]).normalize('NFC').toLowerCase(); } catch { return image.toLowerCase(); } };
/** Only unique filename matches are safe: keep IDs, masks and instance references. */
export function repairWorldAssetPaths(document: WorldDocument, files: readonly { image: string }[]): number {
  const available = new Map(files.map(f => [assetFilePath(f.image), f.image]));
  const names = new Map<string, string[]>();
  for (const f of files) { const name = assetFilePath(f.image).split('/').at(-1)!; const list = names.get(name) ?? []; list.push(f.image); names.set(name, list); }
  let repaired = 0;
  for (const asset of document.assets) {
    const path = assetFilePath(asset.image);
    const exact = available.get(path), matches = names.get(path.split('/').at(-1)!);
    const next = exact ?? (matches?.length === 1 ? matches[0] : undefined);
    if (next && next !== asset.image) { asset.image = next; repaired++; }
  }
  return repaired;
}
