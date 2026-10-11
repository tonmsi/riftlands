import { newWorldAsset, type WorldDocument } from '../../../shared/world-schema';

export function syncWorldAssetFiles(document: WorldDocument, files: readonly { name: string; image: string }[]): { added: number; repaired: number } {
  const path = (image: string) => { try { return decodeURIComponent(image.split(/[?#]/)[0]); } catch { return image; } };
  const available = new Set(files.map(f=>path(f.image)));
  const basename = (image: string) => path(image).split('/').at(-1)!;
  let repaired=0;
  for (const asset of document.assets) {
    if (available.has(path(asset.image))) continue;
    const matches=files.filter(f=>basename(f.image)===basename(asset.image));
    if (matches.length===1) {asset.image=matches[0].image;repaired++;}
  }
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
