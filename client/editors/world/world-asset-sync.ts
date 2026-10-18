import { newWorldAsset, type WorldDocument } from '../../../shared/world-schema';
import { repairWorldAssetPaths, assetFilePath as path } from '../../../shared/world-asset-paths';

export function syncWorldAssetFiles(document: WorldDocument, files: readonly { name: string; image: string }[]): { added: number; repaired: number } {
  const repaired = repairWorldAssetPaths(document, files);
  const known = new Set(document.assets.map(a => path(a.image)));
  const added = [];
  for (const file of files) {
    if (known.has(path(file.image))) continue;
    known.add(path(file.image));
    added.push(newWorldAsset(`asset-${crypto.randomUUID()}`, file.name.slice(0,160), file.image));
  }
  if (document.assets.length + added.length > 4096) throw new Error('Il catalogo può contenere al massimo 4096 asset.');
  document.assets.push(...added);
  return {added:added.length,repaired};
}
