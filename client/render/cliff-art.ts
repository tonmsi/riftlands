import { TILE_SIZE } from '../../shared/config';
import type { WorldAsset } from '../../shared/world-schema';
import type { TerrainCliff } from '../../shared/terrain-cliffs';
import { cliffAsset, cliffCell, cliffCellFloor, type CliffCatalog } from '../../shared/cliff-assets';
import type { AssetCell } from '../../shared/world-schema';
import { clipAssetCells } from './asset-cell-regions';
import { elevationOf } from '../../shared/elevation';
import type { Actor } from '../../shared/types';
import { WorldAssetArt } from './world-asset-art';
import type { WorldStair } from '../../shared/elevation';

const images = new WeakMap<WorldAsset, Map<string, { source: HTMLCanvasElement; bitmap: HTMLCanvasElement; version?:object }>>();
const joins = new WeakMap<WorldAssetArt, Map<string, { sources: HTMLCanvasElement[]; bitmap: HTMLCanvasElement }>>();
interface CliffDrawOptions { document?: CliffCatalog; floor?: number; visibleFloors?:readonly number[]|null; self?: Actor | null; publicPlayers?: readonly Actor[]; time?: number; version?:object; }
const included=(asset:WorldAsset,cliff:TerrainCliff,options:CliffDrawOptions)=>(cell:AssetCell)=>(options.floor===undefined||cliffCellFloor(asset,cliff,cell)===options.floor)&&(options.visibleFloors==null||options.visibleFloors.includes(cliffCellFloor(asset,cliff,cell,true)));
function cliffImage(asset: WorldAsset, cliff: TerrainCliff, art: WorldAssetArt, options: CliffDrawOptions): HTMLCanvasElement | undefined {
  const source = art.image(asset); if (!source) return;
  const cell = (actor?: Actor | null) => {
    if(!actor)return;const c=cliffCell(asset,cliff,actor.x/TILE_SIZE,actor.y/TILE_SIZE);if(!c)return;
    return (c.elevation===undefined?elevationOf(actor)>=cliff.base&&elevationOf(actor)<cliff.elevation:elevationOf(actor)===cliff.base+c.elevation)?c:undefined;
  };
  const self = cell(options.self), placement = { id: `cliff-${cliff.x}-${cliff.y}-${asset.id}`, assetId: asset.id, x: 0, y: 0 };
  const fade = art.fadeAmount(asset,placement,self?.visibility === 'fade' || !!options.publicPlayers?.some(p => cell(p)?.visibility === 'fade'),options.time ?? 0,'traversable');
  const hide = art.fadeAmount(asset,placement,self?.visibility === 'hide-fade',options.time ?? 0,'hiding');
  const key = `${Math.round(fade*16)}:${Math.round(hide*16)}:${options.floor===undefined?'all':options.floor-cliff.base}:${cliff.elevation-cliff.base}:${options.visibleFloors?.map(e=>e-cliff.base).join(',')??'all'}`;
  let cache = images.get(asset); if (!cache) { cache = new Map(); images.set(asset,cache); }
  const cached = cache.get(key); if (cached?.source === source && cached.version===options.version) return cached.bitmap;
  const bitmap = document.createElement('canvas'); bitmap.width = bitmap.height = 96;
  const paint = bitmap.getContext('2d')!; paint.scale(96/(asset.columns*TILE_SIZE),96/(asset.rows*TILE_SIZE));
  if(options.floor!==undefined||options.visibleFloors!=null)clipAssetCells(paint,asset,placement,TILE_SIZE,included(asset,cliff,options));
  art.draw(paint,asset,placement,1,TILE_SIZE,options.time ?? 0,Math.round(fade*16)/16,Math.round(hide*16)/16);
  if (cache.size >= 34) cache.delete(cache.keys().next().value!);
  cache.set(key,{ source,bitmap,version:options.version }); return bitmap;
}
export function drawTerrainCliff(ctx: CanvasRenderingContext2D, cliff: TerrainCliff, art: WorldAssetArt, stairs: readonly WorldStair[] = [], options: CliffDrawOptions = {}): void {
  const size = TILE_SIZE, x = cliff.x * size, y = cliff.y * size;
  ctx.save();
  // Carve the whole access corridor before drawing by floor: the upper cliff
  // must never cover the lower half of the stairs rendered on the previous floor.
  for (const s of stairs) {
    if (cliff.base < Math.min(s.from,s.to) || cliff.elevation > Math.max(s.from,s.to)) continue;
    const left = Math.max(x, s.x * size), top = Math.max(y, s.y * size);
    const right = Math.min(x + size, (s.x + s.width) * size), bottom = Math.min(y + size, (s.y + s.height) * size);
    if (left >= right || top >= bottom) continue;
    ctx.beginPath(); ctx.rect(x, y, size, size); ctx.rect(left, top, right - left, bottom - top); ctx.clip('evenodd');
  }
  const sources: HTMLCanvasElement[] = [];
  let visibleParts = 0;
  for (const part of cliff.parts) {
    const asset = cliffAsset(options.document,part.variant);
    if (!asset.cells.some(included(asset,cliff,options))) continue;
    visibleParts++;
    const bitmap = cliffImage(asset,cliff,art,options);
    if (bitmap) sources.push(bitmap);
  }
  if (cliff.inside && sources.length === cliff.parts.length) {
    let cache = joins.get(art); if (!cache) { cache = new Map(); joins.set(art, cache); }
    const key = cliff.parts.map(p => p.variant).join('|');
    let joined = cache.get(key);
    if (!joined || sources.some((source,i) => joined!.sources[i] !== source)) {
      const bitmap = document.createElement('canvas'); bitmap.width = bitmap.height = 96;
      const paint = bitmap.getContext('2d')!;
      sources.forEach((source,i) => { paint.globalCompositeOperation = i ? 'destination-in' : 'source-over'; paint.drawImage(source, 0, 0, 96, 96); });
      joined = { sources, bitmap }; cache.set(key, joined);
    }
    ctx.drawImage(joined.bitmap, x, y, size, size);
  } else if (sources.length) {
    for (const bitmap of sources) ctx.drawImage(bitmap, x, y, size, size);
  } else if (visibleParts) {
    ctx.fillStyle = '#60675a'; ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}
