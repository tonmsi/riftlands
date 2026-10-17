import { coordinateHash } from '../../shared/coordinate-random';
import { TILE_SIZE } from '../../shared/config';
import { DEFAULT_WATER_COAST, defaultCoastMotion, type WorldPainting } from '../../shared/world-painting';
import type { World } from '../../shared/world';
import type { RenderBounds } from './render-types';

interface WaterRect {x:number;y:number;width:number;height:number;}
interface Patch { x:number; y:number; water?:Path2D; rect?:WaterRect; boundary?:Path2D; cuts:Path2D[]; }
const DEFAULT_MOTION=defaultCoastMotion();
/** Static shoreline vectors, shared by every animation frame. Never invalidates
 * the terrain bitmap. Randomness affects the continuous motion of each band. */
export class CoastMotionArt {
  private world?:World;
  private revision=-1;
  private painting?:WorldPainting;
  private patches=new Map<string,Patch>();
  private combined?:{key:string;water:Path2D;boundary:Path2D;cuts:Path2D[];hasCoast:boolean};
  configure(world:World,painting:WorldPainting):void {
    if(this.world===world&&this.revision===world.authoringRevision&&this.painting===painting)return;
    this.world=world;this.revision=world.authoringRevision;this.painting=painting;
    this.clear();
  }
  clear():void {this.patches.clear();this.combined=undefined;}
  fork():CoastMotionArt {
    const next=new CoastMotionArt();next.world=this.world;next.revision=this.revision;next.painting=this.painting;
    // Patch paths are immutable after recording; share paths, copy ownership.
    next.patches=new Map(this.patches);return next;
  }
  get enabled():boolean {
    const c=this.painting?.waterCoast??DEFAULT_WATER_COAST;
    return !!this.painting&&this.painting.seaEnabled!==false&&this.painting.edges==='masks'&&c.enabled&&(c.motion??DEFAULT_MOTION).enabled;
  }
  record(x:number,y:number,water:Path2D,boundary:Path2D|undefined,cuts:Path2D[],matrix:DOMMatrix):void {
    if(!this.enabled)return;
    const transform=(p:Path2D)=>{const path=new Path2D();path.addPath(p,matrix);return path;};
    const key=`${x},${y}`;
    if(this.patches.size>=32768&&!this.patches.has(key))this.patches.delete(this.patches.keys().next().value!);
    this.patches.set(key,{x,y,water:transform(water),boundary:boundary&&transform(boundary),cuts:cuts.map(transform)});
    this.combined=undefined;
  }
  recordRect(x:number,y:number,left:number,top:number,width:number,height:number):void {
    if(!this.enabled)return;
    const key=`${x},${y}`,old=this.patches.get(key)?.rect;
    if(old&&old.x===left&&old.y===top&&old.width===width&&old.height===height)return;
    if(this.patches.size>=32768&&!this.patches.has(key))this.patches.delete(this.patches.keys().next().value!);
    this.patches.set(key,{x,y,rect:{x:left,y:top,width,height},cuts:[]});this.combined=undefined;
  }
  draw(ctx:CanvasRenderingContext2D,bounds:RenderBounds,time:number):boolean {
    if(!this.enabled)return false;
    const motion=this.painting!.waterCoast?.motion??DEFAULT_MOTION;
    const reach=Math.max(0,...motion.bands.filter(b=>b.width>0&&b.opacity>0).map(b=>b.width+motion.amplitude));
    const key=`${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}`;
    if(this.combined?.key!==key){
      const water=new Path2D(),boundary=new Path2D(),cuts:Path2D[]=[];let hasCoast=false;
      const left=Math.floor((bounds.left-reach)/TILE_SIZE-.5)-1,top=Math.floor((bounds.top-reach)/TILE_SIZE-.5)-1;
      const right=Math.ceil((bounds.right+reach)/TILE_SIZE-.5)+1,bottom=Math.ceil((bounds.bottom+reach)/TILE_SIZE-.5)+1;
      const rows=new Map<number,WaterRect[]>();
      for(const [id,p] of this.patches){
        if(p.x<left||p.x>right||p.y<top||p.y>bottom){this.patches.delete(id);continue;}
        if(p.rect){const row=rows.get(p.y);if(row)row.push(p.rect);else rows.set(p.y,[p.rect]);}
        else if(p.water)water.addPath(p.water);
        if(p.boundary){boundary.addPath(p.boundary);hasCoast=true;}
        p.cuts.forEach((cut,i)=>(cuts[i]??=new Path2D()).addPath(cut));
      }
      // Full water patches have no contour. Merge adjacent rectangles into row
      // runs so every animation frame clips against tens of rectangles rather
      // than hundreds of individually transformed, coincident tile edges.
      for(const row of rows.values()){
        row.sort((a,b)=>a.x-b.x);let run:WaterRect|undefined;
        for(const rect of row){
          if(run&&Math.abs(run.x+run.width-rect.x)<1e-7&&Math.abs(run.y-rect.y)<1e-7&&Math.abs(run.height-rect.height)<1e-7)run.width=rect.x+rect.width-run.x;
          else{if(run)water.rect(run.x,run.y,run.width,run.height);run={...rect};}
        }
        if(run)water.rect(run.x,run.y,run.width,run.height);
      }
      this.combined={key,water,boundary,cuts,hasCoast};
    }
    const geometry=this.combined;
    if(!geometry.hasCoast||!motion.bands.some(b=>b.width>0&&b.opacity>0))return false;
    ctx.save();ctx.clip(geometry.water,'evenodd');
    for(const cut of geometry.cuts){const inverse=new Path2D();inverse.rect(bounds.left,bounds.top,bounds.right-bounds.left,bounds.bottom-bounds.top);inverse.addPath(cut);ctx.clip(inverse,'evenodd');}
    ctx.lineCap='round';ctx.lineJoin='round';
    const t=(Number.isFinite(time)?time:0)/1000*motion.speed,seed=(this.world?.seed??0)+motion.seed;
    // Different, reproducible phases and frequencies prevent bands moving in
    // lockstep. No random number sampling or geometry generation per frame.
    const bands=motion.bands.map((band,i)=>{
      const phase=coordinateHash(i,0,seed)*Math.PI*2,rate=.7+coordinateHash(i,1,seed)*.6;
      const regular=Math.sin(t*Math.PI*2+phase);
      const irregular=(Math.sin(t*rate*4.7+phase)+.5*Math.sin(t*rate*2.13+phase*1.7))/1.5;
      const pulse=regular*(1-motion.randomness)+irregular*motion.randomness;
      return {...band,baseWidth:band.width,width:band.width===0?0:Math.max(0,band.width+pulse*motion.amplitude)};
    }).sort((a,b)=>b.baseWidth-a.baseWidth);
    const alpha=ctx.globalAlpha;
    for(const band of bands){
      if(!band.width||!band.opacity)continue;
      ctx.strokeStyle=band.color;let previous=0;
      for(let i=band.softness;i>=1;i--){
        const next=band.opacity*(1-(i-1)/band.softness);
        ctx.globalAlpha=alpha*(next-previous)/(1-previous);ctx.lineWidth=band.width*2*i/band.softness;
        ctx.stroke(geometry.boundary);previous=next;
      }
    }
    ctx.restore();return motion.speed>0&&motion.amplitude>0;
  }
  get stats(){return {patches:this.patches.size,extraCanvases:0};}
}
