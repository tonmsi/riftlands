import { TILE_SIZE } from '../../shared/config';
import { coordinateHash } from '../../shared/coordinate-random';
import type { World } from '../../shared/world';
import { DEFAULT_WATER_COAST, type WaterCoast, type MaskPoint, type ResolvedTransition, type WorldPainting } from '../../shared/world-painting';
import { maskContours } from './terrain-masks';

type Point=MaskPoint;
interface CoastPatch {water:Path2D;land:Path2D;boundary:Path2D;}
const mix=(a:Point,b:Point,t:number):Point=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const clamp=(p:Point):Point=>({x:Math.max(0,Math.min(1,p.x)),y:Math.max(0,Math.min(1,p.y))});
const smooth=(t:number)=>t*t*(3-2*t);

/** A bounded vector cache. No additional canvases and no time-dependent state.
 * Interpolated Sobel gradients use a 4x4 tile neighbourhood. Shared endpoints
 * sample the same world gradient, so neighbouring curves have matching tangents. */
export class WaterCoastArt {
  private world?:World;
  private revision=-1;
  private settings:Readonly<WaterCoast>=DEFAULT_WATER_COAST;
  private patches=new Map<string,CoastPatch>();
  private gradients=new Map<string,Point>();
  private manual=new WeakMap<ResolvedTransition,Map<number,Path2D>>();
  private painting?:WorldPainting;
  private automaticAt=(x:number,y:number)=>true;
  private eligibility=new Map<string,boolean>();
  get stats(){return {patches:this.patches.size,gradients:this.gradients.size,extraCanvases:0};}
  configure(world:World,settings:Readonly<WaterCoast>,painting:WorldPainting,automaticAt:(x:number,y:number)=>boolean):void {
    this.automaticAt=automaticAt;
    if(this.world===world&&this.revision===world.authoringRevision&&this.settings===settings&&this.painting===painting)return;
    this.world=world;this.revision=world.authoringRevision;this.settings=settings;
    this.painting=painting;this.patches.clear();this.gradients.clear();this.eligibility.clear();
  }
  private canMove(x:number,y:number):boolean {
    const key=`${x},${y}`;let allowed=this.eligibility.get(key);
    if(allowed===undefined){allowed=this.automaticAt(x,y);if(this.eligibility.size>=2048)this.eligibility.delete(this.eligibility.keys().next().value!);this.eligibility.set(key,allowed);}
    return allowed;
  }
  private gradient(x:number,y:number):Point {
    const key=`${x*2},${y*2}`,cached=this.gradients.get(key);if(cached)return cached;
    const tile=(x:number,y:number)=>this.world!.getTile(x,y)==='water'?1:0;
    const node=(x:number,y:number):Point=>({
      x:(tile(x+1,y-1)+2*tile(x+1,y)+tile(x+1,y+1)-tile(x-1,y-1)-2*tile(x-1,y)-tile(x-1,y+1))/8,
      y:(tile(x-1,y+1)+2*tile(x,y+1)+tile(x+1,y+1)-tile(x-1,y-1)-2*tile(x,y-1)-tile(x+1,y-1))/8,
    });
    const ix=Math.floor(x),iy=Math.floor(y),u=x-ix,v=y-iy;
    const result=mix(mix(node(ix,iy),node(ix+1,iy),u),mix(node(ix,iy+1),node(ix+1,iy+1),u),v);
    if(this.gradients.size>=1024)this.gradients.delete(this.gradients.keys().next().value!);
    this.gradients.set(key,result);return result;
  }
  private noise(x:number,y:number):number {
    const scale=this.settings.noiseScale,px=x/scale,py=y/scale,ix=Math.floor(px),iy=Math.floor(py);
    const u=smooth(px-ix),v=smooth(py-iy),seed=this.world!.seed+this.settings.seed;
    const a=coordinateHash(ix,iy,seed),b=coordinateHash(ix+1,iy,seed),c=coordinateHash(ix,iy+1,seed),d=coordinateHash(ix+1,iy+1,seed);
    return ((a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v)*2-1;
  }
  get(tx:number,ty:number,bits:number,connected=false):CoastPatch {
    const key=`${tx},${ty}:${bits}:${connected?1:0}`;const cached=this.patches.get(key);if(cached)return cached;
    const water=new Path2D(),boundary=new Path2D(),size=TILE_SIZE;
    const move=(x:number,y:number)=>water.moveTo(x*size,y*size);
    const line=(x:number,y:number)=>water.lineTo(x*size,y*size);
    const segment=(a:Point,b:Point)=>{
      const displace=(p:Point):{point:Point;noise:number}=>{
        const x=tx+p.x,y=ty+p.y,horizontal=Number.isInteger(y);
        const allowed=horizontal?this.canMove(Math.floor(x),y-1)&&this.canMove(Math.floor(x),y)
          :this.canMove(x-1,Math.floor(y))&&this.canMove(x,Math.floor(y));
        if(!allowed)return {point:p,noise:0};
        const value=this.noise(x,y),g=this.gradient(x,y),n=Math.hypot(g.x,g.y)||1;
        const delta=value*this.settings.noise/size;
        return {point:{x:p.x+(horizontal?g.x/n*delta:0),y:p.y+(horizontal?0:g.y/n*delta)},noise:value};
      };
      const originalA=displace(a),originalB=displace(b);a=originalA.point;b=originalB.point;
      water.lineTo(a.x*size,a.y*size);
      const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
      const tangent=(p:Point):Point=>{
        const g=this.gradient(tx+p.x,ty+p.y);let x=-g.y,y=g.x;
        if(x*dx+y*dy<0){x=-x;y=-y;}
        const n=Math.hypot(x,y);return n>.0001?{x:x/n,y:y/n}:{x:dx/length,y:dy/length};
      };
      const ta=tangent(a),tb=tangent(b),strength=this.settings.smoothing;
      const c1=clamp(mix(mix(a,b,1/3),{x:a.x+ta.x*length/3,y:a.y+ta.y*length/3},strength));
      const c2=clamp(mix(mix(a,b,2/3),{x:b.x-tb.x*length/3,y:b.y-tb.y*length/3},strength));
      const q0=mix(a,c1,.5),q1=mix(c1,c2,.5),q2=mix(c2,b,.5),r0=mix(q0,q1,.5),r1=mix(q1,q2,.5),mid=mix(r0,r1,.5);
      const displacement=(this.noise(tx+mid.x,ty+mid.y)-(originalA.noise+originalB.noise)/2)*this.settings.noise/size;
      const g=this.gradient(tx+mid.x,ty+mid.y),n=Math.hypot(g.x,g.y)||1;
      const offset=(p:Point)=>clamp({x:p.x+g.x/n*displacement,y:p.y+g.y/n*displacement});
      const center=offset(mid),left=offset(r0),right=offset(r1);
      boundary.moveTo(a.x*size,a.y*size);
      for(const path of [water,boundary]){
        path.bezierCurveTo(q0.x*size,q0.y*size,left.x*size,left.y*size,center.x*size,center.y*size);
        path.bezierCurveTo(right.x*size,right.y*size,q2.x*size,q2.y*size,b.x*size,b.y*size);
      }
    };
    const full=()=>{water.rect(0,0,size,size);};
    const corner=(i:number)=>{
      const c=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}][i];
      const a=[{x:.5,y:0},{x:1,y:.5},{x:.5,y:1},{x:0,y:.5}][i];
      const b=[{x:0,y:.5},{x:.5,y:0},{x:1,y:.5},{x:.5,y:1}][i];
      move(c.x,c.y);line(a.x,a.y);segment(a,b);water.closePath();
    };
    switch(bits){
      case 0:break;case 15:full();break;
      case 1:corner(0);break;case 2:corner(1);break;case 4:corner(2);break;case 8:corner(3);break;
      case 14:full();corner(0);break;case 13:full();corner(1);break;case 11:full();corner(2);break;case 7:full();corner(3);break;
      case 5:if(connected){full();corner(1);corner(3);}else{corner(0);corner(2);}break;
      case 10:if(connected){full();corner(0);corner(2);}else{corner(1);corner(3);}break;
      case 3:move(0,0);line(1,0);line(1,.5);segment({x:1,y:.5},{x:0,y:.5});water.closePath();break;
      case 6:move(.5,0);line(1,0);line(1,1);line(.5,1);segment({x:.5,y:1},{x:.5,y:0});water.closePath();break;
      case 12:move(0,.5);segment({x:0,y:.5},{x:1,y:.5});line(1,1);line(0,1);water.closePath();break;
      case 9:move(0,0);line(.5,0);segment({x:.5,y:0},{x:.5,y:1});line(0,1);water.closePath();break;
    }
    const land=new Path2D();land.rect(0,0,size,size);land.addPath(water);
    const result={water,land,boundary};
    if(this.patches.size>=512)this.patches.delete(this.patches.keys().next().value!);
    this.patches.set(key,result);return result;
  }
  manualBoundary(rule:ResolvedTransition,mask:number):Path2D {
    let cache=this.manual.get(rule);if(!cache){cache=new Map();this.manual.set(rule,cache);}
    let path=cache.get(mask);if(path)return path;
    path=new Path2D();const size=TILE_SIZE,shape=rule.maskShapes?.[mask];
    maskContours(mask,rule.curve,false).forEach((c,index)=>{
      const points=shape?.curves[index]??[c.point];path!.moveTo(c.start.x*size,c.start.y*size);
      if(shape?.smooth===false){for(const p of [...points,c.end])path!.lineTo(p.x*size,p.y*size);}
      else points.forEach((p,i)=>{
        const end=i+1<points.length?mix(p,points[i+1],.5):c.end;
        path!.quadraticCurveTo(p.x*size,p.y*size,end.x*size,end.y*size);
      });
    });
    cache.set(mask,path);return path;
  }
  /** Nested translucent strokes approximate a smooth ramp, clipped to water by
   * the caller. Only open coast contours are stroked, never tile perimeters. */
  paint(ctx:CanvasRenderingContext2D,groups:{path:Path2D;color:string}[]):void {
    const settings=this.settings,alpha=ctx.globalAlpha;ctx.lineJoin='round';ctx.lineCap='round';
    const ramp=(boundary:Path2D,width:number,color:string,opacity:number,steps:number)=>{
      if(!width||!opacity)return;
      ctx.strokeStyle=color;let previous=0;
      for(let i=steps;i>=1;i--){const next=opacity*(1-(i-1)/steps);ctx.globalAlpha=alpha*(next-previous)/(1-previous);ctx.lineWidth=width*2*i/steps;ctx.stroke(boundary);previous=next;}
    };
    const boundary=new Path2D();for(const group of groups)boundary.addPath(group.path);
    ramp(boundary,settings.shallows,settings.shallowColor,settings.shallowOpacity??.45,settings.shallowSteps??6);
    for(const group of groups)ramp(group.path,settings.feather,group.color,settings.featherOpacity??.94,settings.featherSteps??4);
    ctx.globalAlpha=alpha;
  }
}
