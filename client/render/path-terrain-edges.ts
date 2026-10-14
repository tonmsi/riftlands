import { TILE_SIZE } from '../../shared/config';
import { noise } from './render-primitives';
import { connectedShore, curvePath, sampleShoreCurve, shoreBankRibbon, type ShoreCurve, type ShoreTile } from './water-shore';
import { fillTerrainPaths } from './terrain-fill';

export type PathEdgeStyle = 'current' | 'soft' | 'polygons';
export const DEFAULT_PATH_EDGE_STYLE: PathEdgeStyle = 'polygons';
interface PathCell { x: number; y: number; }
interface PathSurface { material: string; elevation: number; }
const offsets = [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]];

/** Connected path outline with soft or polygonal margins; painting never edits terrain data. */
export function paintPathEdges(ctx: CanvasRenderingContext2D, cells: readonly PathCell[],
  surfaceAt: (x: number, y: number) => PathSurface | undefined,
  grassPaint: (x: number, y: number) => string | CanvasPattern,
  style: Exclude<PathEdgeStyle,'current'>, lift = 0,
  decorate?: (x:number,y:number,corner:number,curve:ShoreCurve)=>void): void {
  if (!cells.length) return;
  const planes=new Map<number,PathCell[]>();
  for(const cell of cells) {
    const elevation=surfaceAt(cell.x,cell.y)?.elevation ?? 0,plane=planes.get(elevation) ?? [];
    plane.push(cell);planes.set(elevation,plane);
  }
  if(planes.size>1) {
    for(const plane of planes.values())paintPathEdges(ctx,plane,surfaceAt,grassPaint,style,lift,decorate);
    return;
  }
  const elevation=planes.keys().next().value!;
  const requested = new Set(cells.map(cell=>`${cell.x},${cell.y}`)), inspected = new Set<string>();
  const tiles: ShoreTile[] = [], masks = new Map<string,number>();
  for (const cell of cells) for(let dy=-3;dy<=3;dy++) for(let dx=-3;dx<=3;dx++) {
    const x=cell.x+dx,y=cell.y+dy,key=`${x},${y}`;
    if (inspected.has(key)) continue; inspected.add(key);
    const path=surfaceAt(x,y); if(path?.material!=='path' || path.elevation!==elevation) continue;
    const mask=offsets.reduce((mask,[dx,dy],i)=>{
      const land=surfaceAt(x+dx,y+dy);
      return mask | (land?.material==='grass' && land.elevation===path.elevation ? 1<<i : 0);
    },0);
    if(mask) { tiles.push({x,y,mask,variation:.5,inset:4.5}); masks.set(key,mask); }
  }
  const selected = connectedShore(tiles).filter(segment=>requested.has(`${segment.x},${segment.y}`));
  const groups = new Map<string,{paint:string|CanvasPattern;curves:ShoreCurve[]}>();
  const fills = new Map<string | CanvasPattern, Path2D>();
  const details: {x:number;y:number;corner:number;curve:ShoreCurve}[]=[];
  const footprint = new Path2D();
  for(const cell of cells) footprint.rect(cell.x*TILE_SIZE,cell.y*TILE_SIZE-lift,TILE_SIZE,TILE_SIZE);
  ctx.save(); ctx.clip(footprint);
  for(const segment of selected) {
    const mask=masks.get(`${segment.x},${segment.y}`)!,previous=(segment.corner+3)%4;
    const side=mask & 1<<segment.corner ? segment.corner : mask & 1<<previous ? previous : 4+previous;
    const [dx,dy]=offsets[side],sourceX=segment.x+dx,sourceY=segment.y+dy;
    const shifted=([x,y]:[number,number]):[number,number]=>[x,y-lift];
    const curve={start:shifted(segment.curve.start),end:shifted(segment.curve.end),c1:shifted(segment.curve.c1),
      c2:shifted(segment.curve.c2),closure:segment.curve.closure.map(shifted)};
    const paint=grassPaint(sourceX,sourceY),fill=fills.get(paint)??new Path2D();
    fill.addPath(curvePath(curve,true));fills.set(paint,fill);
    const key=`${sourceX},${sourceY}`,group=groups.get(key) ?? {paint,curves:[]};
    group.curves.push(curve);groups.set(key,group);
    if(decorate)details.push({x:segment.x,y:segment.y,corner:segment.corner,curve});
  }
  fillTerrainPaths(ctx,fills);
  const alpha=ctx.globalAlpha;
  for(const {paint,curves} of groups.values()) {
    ctx.fillStyle=paint;
    if(style==='soft') {
      for(const [width,opacity] of [[24,.09],[19,.15],[14,.25],[9,.4],[4,.65]]) {
        ctx.globalAlpha=alpha*opacity;ctx.fill(shoreBankRibbon(curves,width,false));
      }
      ctx.globalAlpha=alpha;
    } else {
      for(const curve of curves) paintPolygonFringe(ctx,curve,paint,lift);
    }
  }
  ctx.restore();
  for(const detail of details)decorate?.(detail.x,detail.y,detail.corner,detail.curve);
}

function paintPolygonFringe(ctx: CanvasRenderingContext2D,curve:ShoreCurve,paint:string|CanvasPattern,lift:number):void {
  const length=Math.hypot(curve.end[0]-curve.start[0],curve.end[1]-curve.start[1]);
  const count=Math.max(2,Math.ceil(length/7));
  for(let i=0;i<count;i++) {
    const p=sampleShoreCurve(curve,(i+.5)/count),worldY=p.y+lift;
    const seedX=Math.round(p.x*4),seedY=Math.round(worldY*4),chance=noise(seedX,seedY,741);
    const tangent=Math.hypot(p.dx,p.dy)||1,ax=p.dx/tangent,ay=p.dy/tangent,nx=-ay,ny=ax;
    const pieces=2+(chance>.58?1:0);
    for(let piece=0;piece<pieces;piece++) {
      const v=noise(seedX,seedY,753+piece),shift=(piece-(pieces-1)/2)*2.7;
      const cx=p.x+ax*shift+nx*(1+v*2.2),cy=p.y+ay*shift+ny*(1+v*2.2);
      const along=2.1+v*2.9,across=2+noise(seedX,seedY,764+piece)*3.4;
      const sides=4+Math.floor(v*3),path=new Path2D();
      for(let vertex=0;vertex<sides;vertex++) {
        const angle=vertex*Math.PI*2/sides,vary=.65+noise(seedX+vertex,seedY,779+piece)*.5;
        const a=Math.cos(angle)*along*vary,b=Math.sin(angle)*across*vary;
        const x=cx+ax*a+nx*b,y=cy+ay*a+ny*b;
        if(vertex===0)path.moveTo(x,y);else path.lineTo(x,y);
      }
      path.closePath();ctx.fillStyle=paint;ctx.fill(path);
      ctx.fillStyle=v>.5?'#bad16a18':'#536d3812';ctx.fill(path);
    }
  }
}
