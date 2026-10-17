import { TILE_SIZE } from '../../shared/config';
import type { WorldPainting, PaintMaterial } from '../../shared/world-painting';
import type { EnvironmentArt } from './environment-art';
import { TerrainMasks } from './terrain-masks';
import { TransitionMasks } from './transition-masks';
import type { RenderBounds } from './render-types';
import { noise } from './render-primitives';
import type { World } from '../../shared/world';
import { DEFAULT_WATER_COAST } from '../../shared/world-painting';
import { WaterCoastArt } from './water-coast';
import { CoastMotionArt } from './coast-motion';
import { performanceLog as perf } from '../core/performance-log';

export type Surface = Exclude<PaintMaterial, 'rock' | 'bush'>;
const order: Surface[] = ['water', 'grass', 'mud', 'ice', 'path', 'snow', 'stone'];
/** Draw only while building the scrolling bitmap. No additional per-frame surfaces.
 * Each square samples four neighbouring tile centres (dual grid). Cumulative masks
 * establish one deterministic priority for saddles and junctions of 3+ materials. */
export class PaintedTerrain {
  private masks = new TerrainMasks();
  private transitions = new TransitionMasks();
  private coasts = new WaterCoastArt();
  motion = new CoastMotionArt();
  draw(ctx: CanvasRenderingContext2D, bounds: RenderBounds, painting: WorldPainting, art: EnvironmentArt,
    surfaceAt: (x: number, y: number) => Surface | null,
    colorAt: (s: Exclude<Surface, 'water'>, x: number, y: number) => string,
    world: World,temperatureAt=(x:number,y:number)=>world.getTemperature(x,y)): void {
    const masksStart=perf.begin();
    const firstX = Math.floor(bounds.left / TILE_SIZE - .5), firstY = Math.floor(bounds.top / TILE_SIZE - .5);
    this.transitions.configure(painting,TILE_SIZE);
    this.motion.configure(world,painting);
    const coastSettings=painting.waterCoast??DEFAULT_WATER_COAST;
    const seaEnabled=painting.seaEnabled!==false;
    if(coastSettings.enabled)this.coasts.configure(world,coastSettings,painting,(tx,ty)=>{
      const corners=[surfaceAt(tx,ty),surfaceAt(tx+1,ty),surfaceAt(tx+1,ty+1),surfaceAt(tx,ty+1)];
      if(corners.includes(null)||!corners.includes('water'))return false;
      const bits=corners.reduce((b,s,i)=>b|(s==='water'?1<<i:0),0);if(bits===15)return false;
      const surfaces=[...new Set(corners)] as Surface[];surfaces.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
      const rule=this.transitions.forSurfaces(surfaces).rule;
      return !rule.maskShapes?.[rule.owner==='water'?bits:15^bits];
    });
    const lastX = Math.ceil(bounds.right / TILE_SIZE - .5), lastY = Math.ceil(bounds.bottom / TILE_SIZE - .5);
    // The sea is one continuous backing. Land masks cover it, without a world-sized canvas.
    ctx.fillStyle = painting.materials.water.color;
    const transform = ctx.getTransform();
    const left = Math.floor((firstX + .5) * TILE_SIZE * transform.a + transform.e);
    const top = Math.floor((firstY + .5) * TILE_SIZE * transform.d + transform.f);
    const right = Math.ceil((lastX + 1.5) * TILE_SIZE * transform.a + transform.e);
    const bottom = Math.ceil((lastY + 1.5) * TILE_SIZE * transform.d + transform.f);
    ctx.fillRect((left - transform.e) / transform.a, (top - transform.f) / transform.d,
      (right - left) / transform.a, (bottom - top) / transform.d);
    const colors = new Map<string, string>();
    const color = (s: Surface, tx: number, ty: number) => {
      if (s === 'water') return painting.materials.water.color;
      const key = `${tx},${ty}`;
      let value = colors.get(key);
      if (!value) { value = colorAt(s, tx, ty); colors.set(key, value); }
      return value;
    };
    const regions = new Map<Surface, Path2D>();
    const exclusions = new Map<Surface, Path2D[]>();
    const coastLines=new Map<Surface,Path2D>(),coastCutout=new Path2D();let hasAutomatic=false;
    coastCutout.rect((left-transform.e)/transform.a,(top-transform.f)/transform.d,(right-left)/transform.a,(bottom-top)/transform.d);
    const customShapes = (!!painting.maskShapes && Object.keys(painting.maskShapes).length > 0)
      || !!Object.keys(painting.materialRules??{}).length || !!Object.keys(painting.pairRules??{}).length;
    const matrix=new DOMMatrix();
    for (let ty = firstY; ty <= lastY; ty++) for (let tx = firstX; tx <= lastX; tx++) {
      const corners = [surfaceAt(tx, ty), surfaceAt(tx+1, ty), surfaceAt(tx+1, ty+1), surfaceAt(tx, ty+1)];
      const x = (tx + .5) * TILE_SIZE, y = (ty + .5) * TILE_SIZE;
      // One pixel-aligned ownership rectangle per patch. Both the background and
      // its masks use this exact transform; independently rounding backgrounds
      // used to overwrite the neighbouring mask and expose grid-shaped seams.
      const pixelLeft = Math.round(x*transform.a+transform.e), pixelTop = Math.round(y*transform.d+transform.f);
      const pixelRight = Math.round((x+TILE_SIZE)*transform.a+transform.e), pixelBottom = Math.round((y+TILE_SIZE)*transform.d+transform.f);
      const wx=(pixelLeft-transform.e)/transform.a, wy=(pixelTop-transform.f)/transform.d;
      const width=(pixelRight-pixelLeft)/transform.a, height=(pixelBottom-pixelTop)/transform.d;
      const same=corners[0];
      if(same!==null&&corners[1]===same&&corners[2]===same&&corners[3]===same){
        // Uniform patches have no biome boundary. Avoid layer/rule resolution,
        // transformed masks and water-path copies for the common interior case.
        let region=regions.get(same);if(!region){region=new Path2D();regions.set(same,region);}
        region.rect(wx,wy,width,height);ctx.fillStyle=color(same,tx,ty);ctx.fillRect(wx,wy,width,height);
        if(same==='water')this.motion.recordRect(tx,ty,wx,wy,width,height);
        continue;
      }
      if (corners.some(s => s === null)) {
        // Preserve exact authored map boundaries and dungeon voids.
        for (let i = 0; i < 4; i++) {
          const s = corners[i], px = x + (i === 1 || i === 2 ? TILE_SIZE/2 : 0), py = y + (i >= 2 ? TILE_SIZE/2 : 0);
          ctx.fillStyle = s ? color(s, tx + (i === 1 || i === 2 ? 1 : 0), ty + (i >= 2 ? 1 : 0)) : '#202b29';
          ctx.fillRect(px, py, TILE_SIZE/2 + .1, TILE_SIZE/2 + .1);
        }
        continue;
      }
      matrix.a=width/TILE_SIZE;matrix.d=height/TILE_SIZE;matrix.e=wx;matrix.f=wy;
      const ranks = corners.map(s => order.indexOf(s!));
      const layers = [...new Set(ranks)].sort((a,b) => a-b);
      const surfaces=layers.map(rank=>order[rank]);
      const transition=layers.length>1?this.transitions.forSurfaces(surfaces):undefined;
      const waterBits=corners.reduce((bits,s,i)=>bits|(s==='water'?1<<i:0),0);
      const rule=transition?.rule,ownerMask=rule?.owner==='water'?waterBits:15^waterBits;
      const automatic=coastSettings.enabled&&coastSettings.automatic&&waterBits>0&&waterBits<15
        &&!rule?.maskShapes?.[ownerMask]?this.coasts.get(tx,ty,waterBits,rule?.owner==='water'):undefined;
      if(automatic&&layers.length>2){hasAutomatic=true;coastCutout.addPath(automatic.water,matrix);}
      if(seaEnabled&&coastSettings.enabled&&waterBits>0&&waterBits<15&&rule){
        const material=surfaces.find(s=>s!=='water')!;
        let line=coastLines.get(material);if(!line){line=new Path2D();coastLines.set(material,line);}
        line.addPath(automatic?.boundary??this.coasts.manualBoundary(rule,ownerMask),matrix);
      }
      const geometry=(bits:number,layer:number)=>layer===0||!transition
        ?this.masks.get(bits,TILE_SIZE,painting.curve,painting.maskShapes)
        :layer===1&&automatic?automatic.land:transition.get(bits,TILE_SIZE,surfaces.slice(layer));
      for (let layer = 0; layer < layers.length; layer++) {
        const rank = layers[layer], s = order[rank], source = ranks.indexOf(rank);
        const sx = tx + (source === 1 || source === 2 ? 1 : 0), sy = ty + (source >= 2 ? 1 : 0);
        const mask = layer === 0 ? 15 : ranks.reduce((bits, r, i) => bits | (r >= rank ? 1 << i : 0), 0);
        const path = geometry(mask,layer);
        if(s==='water'&&this.motion.enabled){
          const water=new Path2D(automatic?.water??path),cuts:Path2D[]=[];
          if(!automatic&&layer+1<layers.length){
            if(customShapes&&layers.length>2){
              for(let above=layer+1;above<layers.length;above++){
                const bits=ranks.reduce((b,r,i)=>b|(r>=layers[above]?1<<i:0),0);cuts.push(geometry(bits,above));
              }
            }else water.addPath(geometry(ranks.reduce((b,r,i)=>b|(r>=layers[layer+1]?1<<i:0),0),layer+1));
          }
          this.motion.record(tx,ty,water,waterBits<15&&rule?(automatic?.boundary??this.coasts.manualBoundary(rule,ownerMask)):undefined,cuts,matrix);
        }
        let region = regions.get(s);
        if (!region) { region = new Path2D(); regions.set(s, region); }
        region.addPath(s==='water'&&automatic?automatic.water:path, matrix);
        if(s==='water'&&automatic){
          // Already the exact sea side; higher land layers are clipped to its complement.
        } else if (customShapes && layers.length > 2) {
          // Independently edited contours need not be nested. At multi-material
          // junctions use actual set subtraction, rather than XOR, for textures.
          let cuts=exclusions.get(s);
          if(!cuts){cuts=[];exclusions.set(s,cuts);}
          for(let above=layer+1;above<layers.length;above++){
            const bits=ranks.reduce((b,r,i)=>b|(r>=layers[above]?1<<i:0),0);
            const slot=above-layer-1;
            (cuts[slot]??=new Path2D()).addPath(geometry(bits,above),matrix);
          }
        } else if (layer + 1 < layers.length) {
          const nextMask = ranks.reduce((bits, r, i) => bits | (r >= layers[layer+1] ? 1 << i : 0), 0);
          region.addPath(geometry(nextMask,layer+1), matrix);
        }
        if (mask !== 15) {
          ctx.save();
          ctx.transform(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f);
          if(automatic&&layer>1)ctx.clip(automatic.land,'evenodd');
          ctx.fillStyle = color(s, sx, sy);
          ctx.fill(path, 'evenodd');
          ctx.restore();
        } else {
          ctx.fillStyle = color(s, sx, sy);
          ctx.fillRect(wx,wy,width,height);
        }
      }
    }
    perf.end('masks-geometry',masksStart);
    // One patterned fill per material instead of a pattern switch/clip per tile.
    const x = (firstX+.5)*TILE_SIZE, y = (firstY+.5)*TILE_SIZE;
    for (const [s, region] of regions) {
      const materialStart=perf.begin();
      ctx.save(); ctx.clip(region, 'evenodd');
      if(hasAutomatic&&s!=='water')ctx.clip(coastCutout,'evenodd');
      for(const cut of exclusions.get(s)??[]){
        const inverse=new Path2D();
        inverse.rect((left-transform.e)/transform.a,(top-transform.f)/transform.d,(right-left)/transform.a,(bottom-top)/transform.d);
        inverse.addPath(cut);ctx.clip(inverse,'evenodd');
      }
      if (s !== 'water' && s !== 'stone') {
        for (let ty = firstY; ty <= lastY+1; ty++) for (let tx = firstX; tx <= lastX+1; tx++) {
          if (surfaceAt(tx,ty) !== s) continue;
          const temp = temperatureAt(tx,ty);
          art.draw(ctx, s, tx*TILE_SIZE, ty*TILE_SIZE, noise(tx,ty), 0, 1, 1, temp < .28);
          if ((s === 'grass' || s === 'mud') && temp < .38) {
            art.drawSnowFringe(ctx, tx*TILE_SIZE, ty*TILE_SIZE, noise(tx,ty), temp < .30 ? 3 : temp < .34 ? 2 : 1);
          }
        }
      }
      if (s === 'water') {
        if(!seaEnabled) {ctx.restore();perf.end('water-static',materialStart);continue;}
        art.paintWater(ctx, {left:x, top:y, right:(lastX+1.5)*TILE_SIZE, bottom:(lastY+1.5)*TILE_SIZE}, world);
        if(coastSettings.enabled){const start=perf.begin();this.coasts.paint(ctx,[...coastLines].map(([material,path])=>({path,color:painting.materials[material].color})));perf.end('shore-static',start);}
      }
      else art.paintGround(ctx, s === 'stone' ? 'path' : s, x, y, s === 'stone', (lastX-firstX+1)*TILE_SIZE, (lastY-firstY+1)*TILE_SIZE);
      ctx.restore();
      perf.end(s==='water'?'water-static':'ground-materials',materialStart);
    }
  }
}
