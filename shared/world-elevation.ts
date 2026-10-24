import { TILE_SIZE } from './config';
import { terrainCliffs } from './terrain-cliffs';
import { cliffAsset, cliffCell } from './cliff-assets';
import { assetCellColumns, assetCellRows, assetCellSubdivision } from './world-schema';
import type { WorldAsset } from './world-schema';
import { assetCellElevationGeometry } from './asset-cell-elevation';
import { SpatialIndex, type TileBounds } from './world-authoring';
import type { World } from './world';
import type { Vec2 } from './types';
import { circleSupported, circleTouchesRect, containsRectPoint, elevationOf, placedGeometry, rectBounds, subtractRect,
  type Elevated, type ElevationGeometry, type ElevationRect, type WorldSolid, type WorldStair, type WorldSurface } from './elevation';

/** Sparse geometry is indexed once. Procedural/placed asset geometry is queried locally. */
export class WorldElevation {
  bindWorld(world: World): void { this.world = world; }
  private surfaces = new SpatialIndex<WorldSurface>(rectBounds);
  private solids = new SpatialIndex<WorldSolid>(rectBounds);
  private stairs = new SpatialIndex<WorldStair>(rectBounds);
  private assetGeometryCache=new Map<string,ElevationGeometry>();
  private readonly generatedStairs: boolean;
  assetGeometry(asset: WorldAsset): ElevationGeometry {
    let g=this.assetGeometryCache.get(asset.id);
    if(!g){g=assetCellElevationGeometry(asset);this.assetGeometryCache.set(asset.id,g);}return g;
  }
  constructor(private world: World) {
    this.generatedStairs=world.authoring.document.assets.some(a=>a.generation.enabled&&!!a.geometry?.stairs.length);
    const g = world.authoring.document.geometry;
    for (const s of g?.surfaces ?? []) this.surfaces.add(s);
    for (const s of g?.solids ?? []) this.solids.add(s);
    for (const s of g?.stairs ?? []) this.stairs.add(s);
  }
  baseAt(tx: number, ty: number): number { return this.world.getTile(tx, ty) === 'water' ? -1 : 0; }
  /** Camera queries must not construct cliff meshes, solids or cell geometry. */
  stairsIn(bounds: TileBounds): WorldStair[] {
    const result=this.stairs.query(bounds);
    if(this.world.mode!=='world')return result;
    const placements=this.generatedStairs?this.world.assetsIn(bounds,false):this.world.authoring.placements.query(bounds);
    for(const p of placements) {
      const stairs=this.world.authoring.assets.get(p.assetId)?.geometry?.stairs;
      if(!stairs?.length)continue;
      const base=p.baseElevation??this.terrainElevationAt(p.x+.5,p.y+.5);
      for(const s of stairs) {
        const x=p.x+s.x,y=p.y+s.y;
        if(x<bounds.right&&x+s.width>bounds.left&&y<bounds.bottom&&y+s.height>bounds.top)
          result.push({...s,id:`${p.id}/${s.id}`,x,y,from:base+s.from,to:base+s.to});
      }
    }
    return result;
  }
  authoredGeometry(bounds: TileBounds): ElevationGeometry {
    const result:ElevationGeometry={surfaces:this.surfaces.query(bounds),solids:this.solids.query(bounds),stairs:this.stairs.query(bounds)};
    for(const c of this.cliffs(bounds))for(const part of c.parts) {
      const asset = cliffAsset(this.world.authoring.document, part.variant);
      const g=this.assetGeometry(asset),place=(r:ElevationRect)=>({id:`cliff-${c.x}-${c.y}-${part.variant}/${r.id}`,x:c.x+r.x/asset.columns,y:c.y+r.y/asset.rows,width:r.width/asset.columns,height:r.height/asset.rows});
      for(const s of g.surfaces)if(s.elevation+c.base>=-128&&s.elevation+c.base<=127)result.surfaces.push({...s,...place(s),elevation:s.elevation+c.base});
      for(const s of g.solids) {
        const base=Math.max(-128,c.base+s.base),top=Math.min(128,s.id.startsWith('cells/')?c.base+s.top:Math.min(c.elevation,c.base+s.top));
        if(base<top)result.solids.push({...place(s),base,top});
      }
      if(asset.geometry)continue;
      const columns=assetCellColumns(asset), rows=assetCellRows(asset);
      const cells: WorldSolid[]=[];
      for(let row=Math.max(0,Math.floor((bounds.top-c.y)*rows));row<Math.min(rows,Math.ceil((bounds.bottom-c.y)*rows));row++)
        for(let col=Math.max(0,Math.floor((bounds.left-c.x)*columns));col<Math.min(columns,Math.ceil((bounds.right-c.x)*columns));col++) {
          const i=row*columns+col;
          if(asset.cells[i].blocked&&asset.cells[i].elevation===undefined) cells.push({id:`cliff-${c.x}-${c.y}-${part.variant}-${i}-mass`,x:c.x+col/columns,y:c.y+row/rows,width:1/columns,height:1/rows,base:c.base,top:c.elevation});
        }
      result.solids.push(...cells);
    }
    return result;
  }
  cliffHidesAt(x: number, y: number, elevation: number): boolean {
    return this.cliffs({ left: Math.floor(x), top: Math.floor(y), right: Math.floor(x)+1, bottom: Math.floor(y)+1 }).some(c => c.parts.some(part => {
      const cell=cliffCell(cliffAsset(this.world.authoring.document,part.variant),c,x,y);
      return (cell?.elevation===undefined?c.base<=elevation&&elevation<c.elevation:c.base+cell.elevation===elevation)&&['hide','hide-fade'].includes(cell?.visibility??'');
    }));
  }
  cliffs(bounds: TileBounds) {
    // Spatial queries include neighbouring plateaus, even just outside the viewport.
    return terrainCliffs(bounds, this.surfaces.query({ left: Math.floor(bounds.left) - 1, top: Math.floor(bounds.top) - 1, right: Math.ceil(bounds.right) + 1, bottom: Math.ceil(bounds.bottom) + 1 }), (x, y) => this.baseAt(x, y));
  }
  geometry(bounds: TileBounds): ElevationGeometry {
    const result = this.authoredGeometry(bounds);
    for (const p of this.world.assetsIn(bounds, false)) {
      const a = this.world.authoring.assets.get(p.assetId)!;
      const base = p.baseElevation ?? this.terrainElevationAt(p.x + .5, p.y + .5);
      {
        const g = placedGeometry(this.assetGeometry(a), p.x, p.y, base, p.id);
        result.surfaces.push(...g.surfaces); result.solids.push(...g.solids); result.stairs.push(...g.stairs);
      }
      // Explicit geometry replaces coarse movement cells; visibility annotations remain independent.
      const columns=assetCellColumns(a), rows=assetCellRows(a), step=1/assetCellSubdivision(a);
      if (!a.geometry) for (let row = Math.max(0,Math.floor((bounds.top-p.y)/step)); row < Math.min(rows,Math.ceil((bounds.bottom-p.y)/step)); row++) for (let col = Math.max(0,Math.floor((bounds.left-p.x)/step)); col < Math.min(columns,Math.ceil((bounds.right-p.x)/step)); col++) {
        if (a.cells[row * columns + col]?.blocked && a.cells[row * columns + col].elevation===undefined) result.solids.push({ id: `${p.id}/cell:${col}:${row}`,
          x: p.x + col*step, y: p.y + row*step, width: step, height: step, base, top: base + 1 });
      }
    }
    return result;
  }
  terrainElevationAt(x: number, y: number): number {
    const surfaces = this.surfaces.query({ left: x, top: y, right: x + 1e-6, bottom: y + 1e-6 }).filter(s => s.ground && containsRectPoint(s, x, y));
    return surfaces.length ? Math.max(...surfaces.map(s => s.elevation)) : this.baseAt(Math.floor(x), Math.floor(y));
  }
  at(x: number, y: number, preferred?: number): Elevated {
    const tx = x / TILE_SIZE, ty = y / TILE_SIZE;
    const g = this.geometry({ left: tx, top: ty, right: tx + 1e-6, bottom: ty + 1e-6 });
    const surfaces = g.surfaces.filter(s => containsRectPoint(s, tx, ty)
      && !g.solids.some(o => containsRectPoint(o, tx, ty) && o.base <= s.elevation && s.elevation < o.top));
    const exact = surfaces.find(s => s.elevation === preferred);
    const surface = exact ?? surfaces.sort((a, b) => b.elevation - a.elevation || a.id.localeCompare(b.id))[0];
    if (preferred === this.baseAt(Math.floor(tx), Math.floor(ty)) && !exact && !g.surfaces.some(s => s.ground && containsRectPoint(s, tx, ty))
      && !g.solids.some(o => containsRectPoint(o, tx, ty) && o.base <= preferred && preferred < o.top))
      return { elevation: preferred, surfaceId: 'terrain' };
    return surface ? { elevation: surface.elevation, surfaceId: surface.id }
      : { elevation: this.baseAt(Math.floor(tx), Math.floor(ty)), surfaceId: 'terrain' };
  }
  /** Exact rectangle solids for projectile sweep. Water contributes no projectile wall. */
  projectileSolids(bounds: TileBounds, elevation: number, g = this.geometry(bounds)): WorldSolid[] {
    const result = g.solids.filter(s => s.base <= elevation && elevation < s.top);
    for (const s of g.surfaces) if (s.terrain === 'rock' && elevation === s.elevation) result.push({ ...s, base: s.elevation, top: s.elevation + 1 });
    for (let y = Math.floor(bounds.top); y < Math.ceil(bounds.bottom); y++) for (let x = Math.floor(bounds.left); x < Math.ceil(bounds.right); x++) {
      if (this.world.getTile(x, y) !== 'rock') continue;
      // Authored ground replaces only its exact footprint, including its material.
      let rocks: WorldSolid[] = [{ id: 'rock', x, y, width: 1, height: 1, base: 0, top: 1 }];
      for (const s of g.surfaces) if (s.ground) rocks = rocks.flatMap(r => subtractRect(r, s));
      if (elevation === 0) result.push(...rocks);
    }
    return result;
  }
  blocked(x: number, y: number, radius: number, elevation: number): boolean {
    const tx = x / TILE_SIZE, ty = y / TILE_SIZE, r = radius / TILE_SIZE;
    const bounds = { left: tx - r, top: ty - r, right: tx + r + 1e-8, bottom: ty + r + 1e-8 };
    const g = this.geometry(bounds);
    const stairSupport = g.stairs.filter(s => (s.from === elevation || s.to === elevation));
    // A stair carves only linked terrain mass, and only inside its corridor.
    let solids = this.projectileSolids(bounds, elevation, g);
    for (const s of stairSupport) solids = solids.flatMap(o => o.id.endsWith('-mass') && o.base >= Math.min(s.from, s.to) && o.top <= Math.max(s.from, s.to)
      ? subtractRect(o, s) : [o]);
    if (solids.some(s => circleTouchesRect(tx, ty, r, s))) return true;
    const support: ElevationRect[] = [...g.surfaces.filter(s => s.elevation === elevation && s.terrain !== 'water'), ...stairSupport];
    for (let cy = Math.floor(bounds.top); cy < Math.ceil(bounds.bottom); cy++) for (let cx = Math.floor(bounds.left); cx < Math.ceil(bounds.right); cx++) {
      if (this.baseAt(cx, cy) === elevation && this.world.getTile(cx, cy) !== 'water') {
        let base: ElevationRect[] = [{ id: 'terrain', x: cx, y: cy, width: 1, height: 1 }];
        for (const s of g.surfaces) if (s.ground) base = base.flatMap(r => subtractRect(r, s));
        support.push(...base);
      }
      // Room walls remain blocking at every floor.
      if ((this.world.roomTiles.get(`${cx},${cy}`) ?? '') !== this.world.roomAt(x, y)
        && circleTouchesRect(tx, ty, r, { x: cx, y: cy, width: 1, height: 1 })) return true;
    }
    return !circleSupported(tx, ty, r, support);
  }
  transition(from: Vec2 & Elevated, to: Vec2, radius: number): Elevated | null {
    const e = elevationOf(from), x = from.x / TILE_SIZE, y = from.y / TILE_SIZE;
    const nx = to.x / TILE_SIZE, ny = to.y / TILE_SIZE;
    const g = this.geometry({ left: Math.min(x, nx), top: Math.min(y, ny), right: Math.max(x, nx) + 1e-8, bottom: Math.max(y, ny) + 1e-8 });
    let next = e;
    for (const s of g.stairs) {
      const before = s.axis === 'x' ? x - s.x - s.width / 2 : y - s.y - s.height / 2;
      const after = s.axis === 'x' ? nx - s.x - s.width / 2 : ny - s.y - s.height / 2;
      if (before === after || before * after > 0) continue;
      const t = -before / (after - before), cx = x + (nx - x) * t, cy = y + (ny - y) * t;
      const pad = radius / TILE_SIZE;
      if (s.axis === 'x' ? cy - pad < s.y || cy + pad > s.y + s.height : cx - pad < s.x || cx + pad > s.x + s.width) continue;
      if (after > before && before <= 0 && after >= 0 && e === s.from) next = s.to;
      else if (after < before && before >= 0 && after <= 0 && e === s.to) next = s.from;
    }
    if (this.blocked(to.x, to.y, radius, next)) return null;
    const surface = g.surfaces.find(s => s.elevation === next && containsRectPoint(s, nx, ny));
    const stair = g.stairs.find(s => (s.from === next || s.to === next) && containsRectPoint(s, nx, ny));
    return { elevation: next, surfaceId: surface?.id ?? stair?.id ?? 'terrain' };
  }
}
