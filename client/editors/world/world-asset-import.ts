import { newWorldAsset, resizeWorldAsset, type WorldAsset, type WorldDocument } from '../../../shared/world-schema';
import type { DungeonDefinition } from '../../../shared/dungeons';

/** Reimporting art preserves catalog identity, including references left by a deleted asset. */
export function importWorldAsset(document: WorldDocument, installed: WorldDocument, catalog: readonly DungeonDefinition[], input: {
  name: string; image: string; width: number; height: number;
}): WorldAsset {
  const stem = input.image.split('/').at(-1)!.replace(/\.(png|svg)$/i, '');
  const referenced = catalog.flatMap(d => (d.assetPlacements ?? []).map(p => p.assetId));
  const required = referenced.find(id => id.toLowerCase() === stem.toLowerCase());
  const existing = document.assets.find(a => a.id === (required ?? stem)) ?? document.assets.find(a => a.image === input.image);
  const id = required ?? existing?.id ?? stem;
  const template = document.assets.find(a => a.id === id) ?? installed.assets.find(a => a.id === id) ?? existing;
  const asset = template ? structuredClone(template) : newWorldAsset(id, input.name, input.image);
  asset.id = id; asset.image = input.image;
  if (!template) {
    asset.group = 'Importati'; asset.visual = { kind: 'image' };
    const ratio = input.height / input.width;
    resizeWorldAsset(asset, ratio > 32 ? Math.max(.25, 32 / ratio) : 1, Math.min(32, Math.max(.25, ratio)));
  }
  if (existing && existing.id !== id) for (const surface of [document, ...(document.interiors ?? []).map(m => m.document)])
    for (const placement of surface.placements) if (placement.assetId === existing.id) placement.assetId = id;
  document.assets = document.assets.filter(a => a.id !== id && a.id !== existing?.id);
  document.assets.push(asset);
  return asset;
}
