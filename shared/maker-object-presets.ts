import { newWorldAsset, type WorldAsset, type WorldDocument } from './world-schema';

export type MakerObjectPreset = 'rock' | 'bush';
export const MAKER_OBJECT_PRESETS = {
  rock: { id: 'maker-rock', name: 'Sasso · oggetto', image: '/world-assets/maker-rock.svg', blocked: true, visibility: 'normal', category: 'decoration' },
  bush: { id: 'maker-bush', name: 'Cespuglio · oggetto', image: '/world-assets/bush.png', blocked: false, visibility: 'hide-fade', category: 'vegetation' },
} as const;

/** Preset creation never changes an existing asset's cells, instances or procedural generation. */
export function ensureMakerObjectAsset(document: WorldDocument, preset: MakerObjectPreset): WorldAsset {
  const settings = MAKER_OBJECT_PRESETS[preset];
  const matches = (asset: WorldAsset) => asset.category === 'object' && asset.layer === 'object'
    && asset.image === settings.image && asset.width === 1 && asset.height === 1 && asset.columns === 1 && asset.rows === 1
    && asset.cells.length === 1 && asset.cells[0].blocked === settings.blocked && asset.cells[0].visibility === settings.visibility
    && !asset.generation.enabled && asset.generation.spacing === 0;
  // Already-compatible canonical bushes can be shared; generated or customized bushes retain their own definition.
  const existing = document.assets.find(asset => (asset.id === preset || asset.id === settings.id || asset.id.startsWith(`${settings.id}-`)) && matches(asset));
  if (existing) return existing;
  const ids = new Set(document.assets.map(asset => asset.id));
  let id = settings.id as string, suffix = 2;
  while (ids.has(id)) id = `${settings.id}-${suffix++}`;
  const asset = newWorldAsset(id, settings.name, settings.image);
  asset.category = 'object'; asset.layer = 'object';
  asset.cells = [{ blocked: settings.blocked, visibility: settings.visibility }];
  asset.generation.enabled = false; asset.generation.spacing = 0; asset.generation.category = settings.category;
  document.assets.push(asset); return asset;
}
