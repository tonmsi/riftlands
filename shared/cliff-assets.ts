import { CLIFF_VARIANTS, type CliffVariant, type TerrainCliff } from './terrain-cliffs';
import { newWorldAsset, assetCellColumns, assetCellRows, type WorldDocument, type WorldAsset, type AssetCell } from './world-schema';
import { proceduralAsset, type ProceduralSample } from './procedural-generation';
import { proceduralFallback } from './procedural-fallback';

export type CliffCatalog = Pick<WorldDocument, 'assets' | 'cliffAssets'> & Partial<Pick<WorldDocument,'procedural'|'seed'>> & { proceduralSample?(x:number,y:number,elevation:number): ProceduralSample };
const defaults = new Map<CliffVariant, WorldAsset>();
export function defaultCliffAsset(variant: CliffVariant): WorldAsset {
  let asset = defaults.get(variant);
  if (!asset) {
    asset = newWorldAsset(`cliff-grid-${variant}`, `cliff-grid ${variant}`, `/world-assets/montagna/cliff-grid/cliff-grid-${variant}.png`);
    asset.group = 'Terreni automatici'; asset.cells[0].blocked = true;
    asset.generation.enabled = false; defaults.set(variant, asset);
  }
  return asset;
}
export function cliffAsset(document: CliffCatalog | undefined, variant: CliffVariant, cliff?: TerrainCliff): WorldAsset {
  if(document?.procedural && cliff) {
    const sample=document.proceduralSample?.(cliff.x,cliff.y,cliff.elevation)??{x:cliff.x,y:cliff.y,elevation:cliff.elevation,temperature:.5};
    return proceduralAsset({...document,seed:document.seed??0},'cliff',{...sample,cliffVariant:variant,width:1,height:1}) ?? proceduralFallback('cliff',1,1,variant);
  }
  const id = document?.cliffAssets?.[variant];
  return document?.assets.find(a => a.id === id) ?? defaultCliffAsset(variant);
}
/** Register editable definitions once; generated borders never become placed copies. */
export function installCliffAssets(document: WorldDocument): boolean {
  let changed = false;
  for (const variant of CLIFF_VARIANTS) {
    if (document.cliffAssets?.[variant] && document.assets.some(a => a.id === document.cliffAssets![variant])) continue;
    const template = defaultCliffAsset(variant), asset = structuredClone(template);
    if (document.assets.some(a => a.id === asset.id)) asset.id = `cliff-${crypto.randomUUID()}`;
    if (document.assets.length >= 4096) throw new Error('Catalogo pieno: libera spazio per i bordi automatici.');
    document.assets.push(asset); (document.cliffAssets ??= {})[variant] = asset.id; changed = true;
  }
  return changed;
}
export function cliffCell(asset: WorldAsset, cliff: TerrainCliff, x: number, y: number): AssetCell | undefined {
  const columns=assetCellColumns(asset), rows=assetCellRows(asset);
  const col = Math.floor((x-cliff.x)*columns), row = Math.floor((y-cliff.y)*rows);
  return col >= 0 && row >= 0 && col < columns && row < rows ? asset.cells[row*columns+col] : undefined;
}
export function cliffCellFloor(asset: WorldAsset, cliff: TerrainCliff, cell: AssetCell, view=false): number {
  return cell.elevation!==undefined?cliff.base+cell.elevation:view?cliff.elevation:asset.layer==='ground'?cliff.base:cliff.elevation;
}
export function cliffLevels(document:CliffCatalog|undefined,cliff:TerrainCliff,view=false):number[] {
  const levels=new Set<number>();
  for(const part of cliff.parts){const asset=cliffAsset(document,part.variant,cliff);for(const cell of asset.cells){const floor=cliffCellFloor(asset,cliff,cell,view);if(floor>=-128&&floor<=127)levels.add(floor);}}
  return [...levels];
}
