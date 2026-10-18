import { emptyGeometry, subtractRect, type ElevationGeometry, type ElevationRect } from './elevation';
import { assetCellColumns, assetCellRows, assetCellSubdivision, type WorldAsset } from './world-schema';

/** Cell coordinates are tile units, independently of texture size and subdivision. */
export function assetCellElevationGeometry(asset: WorldAsset): ElevationGeometry {
  const g=asset.geometry ? {surfaces:asset.geometry.surfaces.slice(),solids:asset.geometry.solids.slice(),stairs:asset.geometry.stairs.slice()} : emptyGeometry();
  const columns=assetCellColumns(asset),rows=assetCellRows(asset),step=1/assetCellSubdivision(asset);
  const regions:(ElevationRect&{elevation:number;blocked:boolean})[]=[],previous=new Map<string,typeof regions[number]>();
  for(let row=0;row<rows;row++) {
    const current=new Map<string,typeof regions[number]>();
    for(let col=0;col<columns;) {
      const cell=asset.cells[row*columns+col]; if(cell.elevation===undefined){col++;continue;}
      const start=col;
      while(col<columns&&asset.cells[row*columns+col].elevation===cell.elevation&&asset.cells[row*columns+col].blocked===cell.blocked)col++;
      const key=`${start}:${col}:${cell.elevation}:${cell.blocked}`,prior=previous.get(key);
      const r=prior??{id:`cells/${start}:${row}`,x:start*step,y:row*step,width:(col-start)*step,height:0,elevation:cell.elevation,blocked:cell.blocked};
      r.height+=step;if(!prior)regions.push(r);current.set(key,r);
    }
    previous.clear();for(const [key,value] of current)previous.set(key,value);
  }
  for(const r of regions) {
    // An explicit cell floor replaces older authored geometry in that column.
    g.surfaces=g.surfaces.flatMap(s=>subtractRect(s,r));g.solids=g.solids.flatMap(s=>subtractRect(s,r));
    const rect={id:r.id,x:r.x,y:r.y,width:r.width,height:r.height};
    g.surfaces.push({...rect,elevation:r.elevation,ground:true});
    if(r.blocked)g.solids.push({...rect,base:r.elevation,top:r.elevation+1});
    if(r.elevation>0)g.solids.push({...rect,id:`${r.id}-mass`,base:0,top:r.elevation});
  }
  return g;
}
