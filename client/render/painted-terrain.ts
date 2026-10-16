import { TILE_SIZE } from '../../shared/config';
import type { WorldPainting, PaintMaterial } from '../../shared/world-painting';
import type { EnvironmentArt } from './environment-art';
import { TerrainMasks } from './terrain-masks';
import { TransitionMasks } from './transition-masks';
import type { RenderBounds } from './render-types';
import { noise } from './render-primitives';
import type { World } from '../../shared/world';

export type Surface = Exclude<PaintMaterial, 'rock' | 'bush'>;
const order: Surface[] = ['water', 'grass', 'mud', 'ice', 'path', 'snow', 'stone'];
/** Draw only while building the scrolling bitmap. No additional per-frame surfaces.
 * Each square samples four neighbouring tile centres (dual grid). Cumulative masks
 * establish one deterministic priority for saddles and junctions of 3+ materials. */
export class PaintedTerrain {
  private masks = new TerrainMasks();
  private transitions = new TransitionMasks();
  draw(ctx: CanvasRenderingContext2D, bounds: RenderBounds, painting: WorldPainting, art: EnvironmentArt,
    surfaceAt: (x: number, y: number) => Surface | null,
    colorAt: (s: Exclude<Surface, 'water'>, x: number, y: number) => string,
    world: World): void {
    const firstX = Math.floor(bounds.left / TILE_SIZE - .5), firstY = Math.floor(bounds.top / TILE_SIZE - .5);
    this.transitions.configure(painting,TILE_SIZE);
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
    const customShapes = (!!painting.maskShapes && Object.keys(painting.maskShapes).length > 0)
      || !!Object.keys(painting.materialRules??{}).length || !!Object.keys(painting.pairRules??{}).length;
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
      const matrix=new DOMMatrix([width/TILE_SIZE,0,0,height/TILE_SIZE,wx,wy]);
      if (corners.some(s => s === null)) {
        // Preserve exact authored map boundaries and dungeon voids.
        for (let i = 0; i < 4; i++) {
          const s = corners[i], px = x + (i === 1 || i === 2 ? TILE_SIZE/2 : 0), py = y + (i >= 2 ? TILE_SIZE/2 : 0);
          ctx.fillStyle = s ? color(s, tx + (i === 1 || i === 2 ? 1 : 0), ty + (i >= 2 ? 1 : 0)) : '#202b29';
          ctx.fillRect(px, py, TILE_SIZE/2 + .1, TILE_SIZE/2 + .1);
        }
        continue;
      }
      const ranks = corners.map(s => order.indexOf(s!));
      const layers = [...new Set(ranks)].sort((a,b) => a-b);
      const surfaces=layers.map(rank=>order[rank]);
      const transition=layers.length>1?this.transitions.forSurfaces(surfaces):undefined;
      const geometry=(bits:number,layer:number)=>layer===0||!transition
        ?this.masks.get(bits,TILE_SIZE,painting.curve,painting.maskShapes)
        :transition.get(bits,TILE_SIZE,surfaces.slice(layer));
      for (let layer = 0; layer < layers.length; layer++) {
        const rank = layers[layer], s = order[rank], source = ranks.indexOf(rank);
        const sx = tx + (source === 1 || source === 2 ? 1 : 0), sy = ty + (source >= 2 ? 1 : 0);
        const mask = layer === 0 ? 15 : ranks.reduce((bits, r, i) => bits | (r >= rank ? 1 << i : 0), 0);
        const path = geometry(mask,layer);
        let region = regions.get(s);
        if (!region) { region = new Path2D(); regions.set(s, region); }
        region.addPath(path, matrix);
        if (customShapes && layers.length > 2) {
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
          ctx.fillStyle = color(s, sx, sy);
          ctx.fill(path, 'evenodd');
          ctx.restore();
        } else {
          ctx.fillStyle = color(s, sx, sy);
          ctx.fillRect(wx,wy,width,height);
        }
      }
    }
    // One patterned fill per material instead of a pattern switch/clip per tile.
    const x = (firstX+.5)*TILE_SIZE, y = (firstY+.5)*TILE_SIZE;
    for (const [s, region] of regions) {
      ctx.save(); ctx.clip(region, 'evenodd');
      for(const cut of exclusions.get(s)??[]){
        const inverse=new Path2D();
        inverse.rect((left-transform.e)/transform.a,(top-transform.f)/transform.d,(right-left)/transform.a,(bottom-top)/transform.d);
        inverse.addPath(cut);ctx.clip(inverse,'evenodd');
      }
      if (s !== 'water' && s !== 'stone') {
        for (let ty = firstY; ty <= lastY+1; ty++) for (let tx = firstX; tx <= lastX+1; tx++) {
          if (surfaceAt(tx,ty) !== s) continue;
          const temp = world.getTemperature(tx,ty);
          art.draw(ctx, s, tx*TILE_SIZE, ty*TILE_SIZE, noise(tx,ty), 0, 1, 1, temp < .28);
          if ((s === 'grass' || s === 'mud') && temp < .38) {
            art.drawSnowFringe(ctx, tx*TILE_SIZE, ty*TILE_SIZE, noise(tx,ty), temp < .30 ? 3 : temp < .34 ? 2 : 1);
          }
        }
      }
      if (s === 'water') art.paintWater(ctx, {left:x, top:y, right:(lastX+1.5)*TILE_SIZE, bottom:(lastY+1.5)*TILE_SIZE}, world);
      else art.paintGround(ctx, s === 'stone' ? 'path' : s, x, y, s === 'stone', (lastX-firstX+1)*TILE_SIZE, (lastY-firstY+1)*TILE_SIZE);
      ctx.restore();
    }
  }
}
