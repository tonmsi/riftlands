import { WORLD_DOCUMENT } from './world-content';
import { DEFAULT_ASSET_FADE, newWorldAsset, type WorldAsset } from './world-schema';

/** Demo-only assets. Placement x/y is the upper-left corner of the annotation grid.
 * Trees occupy 2×3 tiles, with depth/support anchor (x+1,y+2.7); only their base row blocks.
 * The cottage occupies 4×4 tiles, with anchor (x+2,y+3.44) and one blocking base row.
 * The returned objects are fresh clones and never alter the installed world catalog. */
export function referenceDemoAssets(): WorldAsset[] {
  const tree = (id: string, name: string, image: string): WorldAsset => ({
    ...newWorldAsset(id, name, image), width: 2, height: 3, columns: 2, rows: 3,
    cells: Array.from({ length: 6 }, (_, i) => ({ blocked: i >= 4, visibility: i < 4 ? 'hide-fade' : 'normal' })),
    pivot: { x: .5, y: .9 }, group: 'Laboratorio terreno', fade: { ...DEFAULT_ASSET_FADE },
  });
  const assets = [tree('reference-oak', 'Quercia del laboratorio', '/world-assets/lab-oak.svg'),
    tree('reference-pine', 'Pino del laboratorio', '/world-assets/lab-pine.svg')];
  const source = WORLD_DOCUMENT.assets.find(asset => asset.name === 'Casa di campagna con tetto rosso terracotta');
  if (source) {
    const cottage = structuredClone(source);
    cottage.id = 'reference-cottage'; cottage.name = 'Casa del laboratorio'; cottage.group = 'Laboratorio terreno';
    cottage.width = cottage.height = cottage.columns = cottage.rows = 4;
    cottage.cells = Array.from({ length: 16 }, (_, i) => ({ blocked: i >= 12, visibility: i < 12 ? 'hide-fade' : 'normal' }));
    cottage.pivot = { x: .5, y: .86 }; cottage.generation.enabled = false;
    delete cottage.imageTransform; assets.push(cottage);
  }
  return assets;
}
