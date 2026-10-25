import { DEFAULT_WATER_COAST, defaultCoastMotion, defaultWorldPainting, PAINT_COLORS, type WorldPainting } from '../../shared/world-painting';
import { PaintedTerrain } from './painted-terrain';
import { CHUNK_SIZE, TILE_SIZE } from '../../shared/config';
import type { TileKind } from '../../shared/types';
import type { World } from '../../shared/world';
import { dungeonAtTile, type DungeonDefinition } from '../../shared/dungeons';
import { EnvironmentArt } from './environment-art';
import { WorldAssetArt } from './world-asset-art';
import { terrainBushAsset } from '../../shared/bush';
import { noise } from './render-primitives';
import { TERRAIN, groundColor, shorelineMask, sceneryGroups, pathColor, climateSnowCoverage } from './terrain-style';
import type { RenderBounds, TerrainViewport } from './render-types';
import { performanceLog as perf } from '../core/performance-log';
import type { WorldSurface } from '../../shared/elevation';
import type { CoastMotionArt } from './coast-motion';
import { surfaceOpacity } from './bridge-visibility';
import type { Elevated } from '../../shared/elevation';
import type { Vec2 } from '../../shared/types';
const DEFAULT_PAINTING = defaultWorldPainting();
const DEFAULT_COAST_MOTION=defaultCoastMotion();
type SurfaceKind='grass'|'path'|'mud'|'stone'|'water'|'snow'|'ice';
interface TerrainCache extends RenderBounds {canvas:HTMLCanvasElement;world:World;scale:number;}
interface TerrainPreparation {cache:TerrainCache;slices:RenderBounds[];next:number;motion:CoastMotionArt;}
function remember<K,V>(cache:Map<K,V>,key:K,value:V,limit=8192):V {
  if(cache.size>=limit&&!cache.has(key))cache.delete(cache.keys().next().value!);
  cache.set(key,value);return value;
}
function tintGround(color: string, original: string, chosen: string): string {
  if (original === chosen) return color;
  const rgb = color.startsWith('#') ? [1,3,5].map(i => parseInt(color.slice(i,i+2),16)) : color.match(/\d+/g)!.map(Number);
  return 'rgb(' + rgb.map((v,i) => Math.max(0, Math.min(255, v + parseInt(chosen.slice(i*2+1,i*2+3),16) - parseInt(original.slice(i*2+1,i*2+3),16)))).join(',') + ')';
}
function coverTileBleed(ctx: CanvasRenderingContext2D, vx: number, vy: number, corner: number, radius: number, color: string, scale: number): void {
  ctx.fillStyle = color;
  const e = Math.max(1, 1.5 / scale);
  const cx = vx * TILE_SIZE, cy = vy * TILE_SIZE;
  const signX = (corner === 0 || corner === 3) ? 1 : -1;
  const signY = (corner === 0 || corner === 1) ? 1 : -1;

  const rx1 = signX === 1 ? cx - e : cx;
  const ry1 = signY === 1 ? cy - e : cy - radius;
  ctx.fillRect(rx1, ry1, e, radius + e);

  const rx2 = signX === 1 ? cx - e : cx - radius;
  const ry2 = signY === 1 ? cy - e : cy;
  ctx.fillRect(rx2, ry2, radius + e, e);
}

/** Terrain painting and scrolling cache. No camera, gameplay or actor animation state. */
export class TerrainRenderer {
  private activeWorld?: World;
  private painting: WorldPainting = defaultWorldPainting();
  private readonly maskedTerrain = new PaintedTerrain();
  private paintingRevision = -1;
  private readonly environmentArt = new EnvironmentArt();
  private readonly bushArt = new WorldAssetArt(() => { this.bushRevision++; this.invalidate(); });
  private bushRevision = 0;
  private bushReady = false;
  get spriteRevision(): number { return this.bushRevision + (this.surfacePainter?.spriteRevision ?? 0); }
  get spritesPending(): boolean { return !this.bushReady || (this.surfacePainter?.spritesPending ?? false); }
  private terrainCache?:TerrainCache;
  private preparation?:TerrainPreparation;
  private spareCanvas?:HTMLCanvasElement;
  private previousCamera?:{x:number;y:number};
  private preparedSwaps=0;
  private preparationFallbacks=0;
  private preparationEnabled=false;
  private readonly observedCanvases=new WeakSet<HTMLCanvasElement>();
  private lockRevision = -1;
  private cacheReason='initial';
  private sampleWorld?:World;
  private sampleRevision=-1;
  private sampleLock=-1;
  private samplePainting?:WorldPainting;
  private sampleMaterial?: TileKind;
  private surfacePainter?: TerrainRenderer;
  private surfaceMaterialWorld?: World;
  private surfaceMaterialPainting?: WorldPainting;
  private readonly surfaceMaterialCache = new Map<string, { canvas: HTMLCanvasElement; left: number; top: number; scale: number }>();
  private readonly surfaceSamples=new Map<string,SurfaceKind|null>();
  private readonly colorSamples=new Map<string,string>();
  private readonly temperatureSamples=new Map<string,number>();
  performanceInfo(){const c=this.terrainCache,back=this.preparation?.cache.canvas??this.spareCanvas;return {cachePixels:c?c.canvas.width*c.canvas.height:0,
    cacheRgbaEstimateBytes:c?c.canvas.width*c.canvas.height*4:0,art:this.environmentArt.performanceInfo(),motion:this.maskedTerrain.motion.stats,
    preparation:{pendingSlices:this.preparation?this.preparation.slices.length-this.preparation.next:0,swaps:this.preparedSwaps,fallbacks:this.preparationFallbacks,
      enabled:this.preparationEnabled||this.preparationPolicy==='always',extraPixels:back?back.width*back.height:0},
    samples:{surfaces:this.surfaceSamples.size,colors:this.colorSamples.size,temperatures:this.temperatureSamples.size}};}
  readonly spritesReady: Promise<void>;
  constructor(private readonly ctx: CanvasRenderingContext2D, private readonly localDungeons?: readonly DungeonDefinition[],
    private readonly preparationPolicy:'adaptive'|'always'='adaptive') {
    this.spritesReady = this.bushArt.ready(terrainBushAsset).then(() => { this.bushReady = true; });
  }
  invalidate(): void {
    this.surfaceMaterialCache.clear(); this.surfacePainter?.invalidate();
    for(const canvas of [this.terrainCache?.canvas,this.preparation?.cache.canvas,this.spareCanvas])if(canvas){canvas.width=canvas.height=0;}
    this.terrainCache=undefined;this.preparation=undefined;this.spareCanvas=undefined;this.previousCamera=undefined;
    this.maskedTerrain.motion.clear();this.cacheReason='explicit-invalidation';
  }
  dispose():void {this.invalidate();this.surfacePainter?.dispose();this.surfacePainter=undefined;this.clearSamples();this.sampleWorld=undefined;this.surfaceMaterialWorld=undefined;this.surfaceMaterialPainting=undefined;}
  private clearSamples():void {this.surfaceSamples.clear();this.colorSamples.clear();this.temperatureSamples.clear();}
  private outsideLocalMap(tx: number, ty: number): boolean {
    const interior = this.activeWorld?.authoring.document.interiorBounds;
    if (interior && (tx < 0 || ty < 0 || tx >= interior.width || ty >= interior.height)) return true;
    return !!this.localDungeons && !this.localDungeons.some(d => {
      const b = d.layout.bounds;
      return tx >= b.minTx - 2 && tx <= b.maxTx + 2 && ty >= b.minTy - 2 && ty <= b.maxTy + 2;
    });
  }
  private dungeonAt(tx: number, ty: number): DungeonDefinition | undefined {
    return (this.localDungeons ?? this.activeWorld?.dungeons)?.find(d => {
          const b = d.layout.bounds;
          return tx >= b.minTx && tx <= b.maxTx && ty >= b.minTy && ty <= b.maxTy;
        });
  }
  private covers(cache:TerrainCache,bounds:RenderBounds):boolean {
    return bounds.left>=cache.left&&bounds.top>=cache.top&&bounds.right<=cache.right&&bounds.bottom<=cache.bottom;
  }
  private observeCanvas(canvas:HTMLCanvasElement):void {
    if(this.observedCanvases.has(canvas))return;this.observedCanvases.add(canvas);
    canvas.addEventListener('contextrestored',()=>{
      if(this.terrainCache?.canvas===canvas||this.preparation?.cache.canvas===canvas)this.invalidate();
    });
  }
  private paintStrip(cache:TerrainCache,strip:RenderBounds,time:number):void {
    const ctx=cache.canvas.getContext('2d',{alpha:false})!,scale=cache.scale;
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.beginPath();
    ctx.rect(strip.left,strip.top,strip.right-strip.left,strip.bottom-strip.top);ctx.clip();
    ctx.fillStyle=TERRAIN.grass;ctx.fillRect(strip.left,strip.top,strip.right-strip.left,strip.bottom-strip.top);
    ctx.setTransform(scale,0,0,scale,-cache.left*scale,-cache.top*scale);
    try{this.drawTerrain(cache.world,time,ctx,{left:cache.left+strip.left/scale,top:cache.top+strip.top/scale,
      right:cache.left+strip.right/scale,bottom:cache.top+strip.bottom/scale});}finally{ctx.restore();}
  }
  private startPreparation(cache:TerrainCache,view:RenderBounds,moveX:number,moveY:number):void {
    if(!this.preparationEnabled&&this.preparationPolicy!=='always')return;
    const aheadX=moveX<0&&view.left-cache.left<128?-1:moveX>0&&cache.right-view.right<128?1:0;
    const aheadY=moveY<0&&view.top-cache.top<128?-1:moveY>0&&cache.bottom-view.bottom<128?1:0;
    if(!aheadX&&!aheadY)return;
    const started=perf.begin(),scale=cache.scale;
    // Advance both moving axes together. Independent diagonal shifts would
    // copy the entire bitmap twice as often as the original scrolling cache.
    const magnitude=Math.max(Math.abs(moveX),Math.abs(moveY));
    const x=Math.abs(moveX)>.1*magnitude?Math.floor((view.left-192+128*moveX/magnitude)*scale)/scale:cache.left;
    const y=Math.abs(moveY)>.1*magnitude?Math.floor((view.top-192+128*moveY/magnitude)*scale)/scale:cache.top;
    const canvas=this.spareCanvas??document.createElement('canvas');this.spareCanvas=undefined;
    const width=cache.canvas.width,height=cache.canvas.height;
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    const dx=Math.round((cache.left-x)*scale),dy=Math.round((cache.top-y)*scale);
    if(Math.abs(dx)>=width||Math.abs(dy)>=height){canvas.width=canvas.height=0;perf.end('terrain-prefetch-setup',started);return;}
    const ctx=canvas.getContext('2d',{alpha:false})!;ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(cache.canvas,dx,dy);
    const dirty:RenderBounds[]=[];
    if(dx)dirty.push({left:dx>0?0:width+dx,top:0,right:dx>0?dx:width,bottom:height});
    if(dy)dirty.push({left:Math.max(0,dx),top:dy>0?0:height+dy,right:Math.min(width,width+dx),bottom:dy>0?dy:height});
    const slices:RenderBounds[]=[];
    for(const strip of dirty){
      const vertical=strip.bottom-strip.top>strip.right-strip.left;
      const start=vertical?strip.top:strip.left,end=vertical?strip.bottom:strip.right;
      for(let offset=start;offset<end;offset+=256)slices.push(vertical?{...strip,top:offset,bottom:Math.min(end,offset+256)}:
        {...strip,left:offset,right:Math.min(end,offset+256)});
    }
    // Closest newly exposed areas first. Keep the displayed bitmap untouched
    // until every slice is ready; cancellation cannot reveal unfinished pixels.
    const cx=(view.left+view.right)/2,cy=(view.top+view.bottom)/2;
    const distance=(s:RenderBounds)=>Math.hypot(x+(s.left+s.right)/2/scale-cx,y+(s.top+s.bottom)/2/scale-cy);
    slices.sort((a,b)=>distance(a)-distance(b));
    const next:TerrainCache={canvas,world:cache.world,scale,left:x,top:y,right:x+width/scale,bottom:y+height/scale};
    this.observeCanvas(canvas);
    this.preparation={cache:next,slices,next:0,motion:this.maskedTerrain.motion.fork()};perf.end('terrain-prefetch-setup',started);
  }
  drawCachedTerrain(world: World, view: TerrainViewport, time: number): void {
    this.activeWorld = world;
    if (this.painting !== (world.authoring.document.painting ?? DEFAULT_PAINTING) || this.paintingRevision !== world.authoringRevision) {
      this.invalidate();
      this.paintingRevision = world.authoringRevision;
      this.cacheReason='painting-or-world-revision';
    }
    if (this.lockRevision !== world.lockRevision) {
      this.invalidate();
      this.lockRevision = world.lockRevision;
      this.cacheReason='boss-lock-revision';
    }
    const scale = view.dpr * (view.rasterZoom ?? view.zoom);
    const left = view.camera.x - view.width / (2 * view.zoom);
    const top = view.camera.y - view.height / (2 * view.zoom);
    const right = left + view.width / view.zoom, bottom = top + view.height / view.zoom;
    let cache = this.terrainCache;
    const viewport={left,top,right,bottom};
    const moveX=this.previousCamera?view.camera.x-this.previousCamera.x:0,moveY=this.previousCamera?view.camera.y-this.previousCamera.y:0;
    this.previousCamera={...view.camera};
    perf.state({terrainCache:'hit',terrainDirtyPixels:0,terrainCacheReason:'none',
      paintingSeaEnabled:world.authoring.document.painting?.seaEnabled!==false,
      paintingMasksEnabled:world.authoring.document.painting?.masksEnabled!==false});
    if(this.preparation&&(cache?.world!==world||cache.scale!==scale)){
      this.preparation.cache.canvas.width=this.preparation.cache.canvas.height=0;this.preparation=undefined;
    }
    if(this.preparation&&cache){
      const pending=this.preparation,urgent=!this.covers(cache,viewport);
      if(urgent&&!this.covers(pending.cache,viewport)){
        this.spareCanvas=pending.cache.canvas;this.preparation=undefined;this.preparationFallbacks++;
      }else{
        const phase=perf.begin();let pixels=0;
        // At most one bounded slice per frame. Canvas calls are indivisible;
        // this bounds geometry size, not elapsed GPU time. Teleports or missed
        // deadlines use a synchronous fallback instead of showing holes.
        do{
          const strip=pending.slices[pending.next++],frontMotion=this.maskedTerrain.motion;
          this.maskedTerrain.motion=pending.motion;
          try{this.paintStrip(pending.cache,strip,time);}finally{this.maskedTerrain.motion=frontMotion;}
          pixels+=(strip.right-strip.left)*(strip.bottom-strip.top);
        }while(pending.next<pending.slices.length&&urgent);
        perf.end('terrain-prefetch-slice',phase);
        perf.state({terrainCache:'prefetch',terrainDirtyPixels:pixels});
        if(urgent)this.preparationFallbacks++;
        if(pending.next===pending.slices.length){
          if(this.covers(pending.cache,viewport)){
            this.spareCanvas=cache.canvas;cache=pending.cache;this.terrainCache=cache;
            this.maskedTerrain.motion=pending.motion;this.preparedSwaps++;
            perf.state({terrainCache:'prepared-swap'});
          }else this.spareCanvas=pending.cache.canvas;
          this.preparation=undefined;
        }
      }
    }
    if (!cache || cache.world !== world || cache.scale !== scale ||
      left < cache.left || top < cache.top || right > cache.right || bottom > cache.bottom) {
      const margin = 192;
      const buildStart=perf.begin();
      const buildClock=performance.now();
      const reason=cache?(cache.world!==world?'world':cache.scale!==scale?'scale-or-zoom':'camera-bounds'):this.cacheReason;
      const x = Math.floor((left - margin) * scale) / scale;
      const y = Math.floor((top - margin) * scale) / scale;
      const canvas = cache?.canvas ?? document.createElement('canvas');
      // A separate raster scale lets temporary fishing zoom reuse the terrain.
      const cacheZoom=view.rasterZoom?Math.min(view.rasterZoom,view.zoom):view.zoom;
      const width = Math.ceil((view.width / cacheZoom + margin * 2) * scale) + 1;
      const height = Math.ceil((view.height / cacheZoom + margin * 2) * scale) + 1;
      const dx = cache ? Math.round((cache.left - x) * scale) : 0;
      const dy = cache ? Math.round((cache.top - y) * scale) : 0;
      const reuse = cache?.world === world && cache.scale === scale &&
        canvas.width === width && canvas.height === height && Math.abs(dx) < width && Math.abs(dy) < height;
      this.observeCanvas(canvas);
      if (!reuse) { canvas.width = width; canvas.height = height; }
      const ctx = canvas.getContext('2d', { alpha: false })!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      const dirty: { left: number; top: number; right: number; bottom: number }[] = [];
      if (reuse) {
        ctx.drawImage(canvas, dx, dy);
        if (dx) dirty.push({ left: dx > 0 ? 0 : width + dx, top: 0, right: dx > 0 ? dx : width, bottom: height });
        if (dy) dirty.push({ left: Math.max(0, dx), top: dy > 0 ? 0 : height + dy, right: Math.min(width, width + dx), bottom: dy > 0 ? dy : height });
      } else dirty.push({ left: 0, top: 0, right: width, bottom: height });

      cache = { canvas, world, scale, left: x, top: y, right: x + canvas.width / scale, bottom: y + canvas.height / scale };
      for (const strip of dirty) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(strip.left, strip.top, strip.right - strip.left, strip.bottom - strip.top);
        ctx.clip();
        ctx.fillStyle = TERRAIN.grass;
        ctx.fillRect(strip.left, strip.top, strip.right - strip.left, strip.bottom - strip.top);
        ctx.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
        this.drawTerrain(world, time, ctx, {
          left: x + strip.left / scale,
          top: y + strip.top / scale,
          right: x + strip.right / scale,
          bottom: y + strip.bottom / scale,
        });
        ctx.restore();
      }
      this.terrainCache = cache;
      // Keep the cheap synchronous path on fast devices. Splitting has real
      // overhead; enable it after a scrolling update consumes 10 ms, excluding
      // the first build and its one-time artwork rasterization.
      if(reuse&&performance.now()-buildClock>=10)this.preparationEnabled=true;
      perf.end(reuse?'terrain-scroll':'terrain-rebuild',buildStart);
      perf.state({terrainCache:reuse?'scroll':'full',terrainCacheReason:reason,terrainDirtyPixels:dirty.reduce((n,r)=>n+(r.right-r.left)*(r.bottom-r.top),0)});
    }
    const blitStart=perf.begin();
    this.ctx.drawImage(cache.canvas, cache.left, cache.top, cache.canvas.width / scale, cache.canvas.height / scale);
    perf.end('terrain-blit',blitStart);
    if(!this.preparation&&this.covers(cache,viewport))this.startPreparation(cache,viewport,moveX,moveY);
    const pending=this.preparation?.cache;
    this.drawCoastMotion(this.ctx,cache,time);
    const extraCanvas=pending?.canvas??this.spareCanvas;
    if(perf.active)perf.state({terrainCachePixels:cache.canvas.width*cache.canvas.height,terrainCacheRgbaBytes:cache.canvas.width*cache.canvas.height*4,
      terrainPrefetchPending:this.preparation?this.preparation.slices.length-this.preparation.next:0,
      terrainPrefetchSwaps:this.preparedSwaps,terrainPrefetchFallbacks:this.preparationFallbacks,
      terrainPrefetchEnabled:this.preparationEnabled||this.preparationPolicy==='always',
      terrainExtraCachePixels:extraCanvas?extraCanvas.width*extraCanvas.height:0});
  }
  drawCoastMotion(ctx:CanvasRenderingContext2D,bounds:RenderBounds,time:number):boolean {
    if(!perf.feature('sea'))return false;
    const start=perf.begin();try{return this.maskedTerrain.motion.draw(ctx,bounds,time);}finally{perf.end('sea-animation',start);}
  }
  drawElevatedGround(world: World, ctx: CanvasRenderingContext2D, surfaces: readonly WorldSurface[], time: number): void {
    const ground = surfaces.filter(s => s.painted && s.ground); if (!ground.length) return;
    ctx.save(); ctx.beginPath();
    for (const s of ground) ctx.rect(s.x*TILE_SIZE, s.y*TILE_SIZE, s.width*TILE_SIZE, s.height*TILE_SIZE);
    ctx.clip();
    const cache = this.terrainCache;
    if (cache?.world === world) ctx.drawImage(cache.canvas, cache.left, cache.top, cache.canvas.width/cache.scale, cache.canvas.height/cache.scale);
    else this.drawTerrain(world, time, ctx, { left: Math.min(...ground.map(s=>s.x))*TILE_SIZE, top: Math.min(...ground.map(s=>s.y))*TILE_SIZE, right: Math.max(...ground.map(s=>s.x+s.width))*TILE_SIZE, bottom: Math.max(...ground.map(s=>s.y+s.height))*TILE_SIZE });
    ctx.restore();
  }
  /** Render deck artwork with the same palette, climate and textures as ordinary terrain. */
  drawSurfaceMaterial(world: World, ctx: CanvasRenderingContext2D, surface: WorldSurface, time: number, viewer?: (Vec2 & Elevated) | null): void {
    if (surface.transparent) return;
    if (this.surfaceMaterialWorld !== world || this.surfaceMaterialPainting !== world.authoring.document.painting) {
      this.surfaceMaterialCache.clear(); this.surfaceMaterialWorld = world; this.surfaceMaterialPainting = world.authoring.document.painting;
    }
    const transform = ctx.getTransform(), inverse = transform.inverse();
    const corners = [[0,0],[ctx.canvas.width,0],[0,ctx.canvas.height],[ctx.canvas.width,ctx.canvas.height]]
      .map(([x,y]) => ({ x: inverse.a*x+inverse.c*y+inverse.e, y: inverse.b*x+inverse.d*y+inverse.f }));
    const left = Math.max(surface.x*TILE_SIZE, Math.min(...corners.map(p=>p.x)));
    const top = Math.max(surface.y*TILE_SIZE, Math.min(...corners.map(p=>p.y)));
    const right = Math.min((surface.x+surface.width)*TILE_SIZE, Math.max(...corners.map(p=>p.x)));
    const bottom = Math.min((surface.y+surface.height)*TILE_SIZE, Math.max(...corners.map(p=>p.y)));
    if (right <= left || bottom <= top) return;
    const bounds = { left: Math.floor(left/TILE_SIZE)*TILE_SIZE, top: Math.floor(top/TILE_SIZE)*TILE_SIZE,
      right: Math.ceil(right/TILE_SIZE)*TILE_SIZE, bottom: Math.ceil(bottom/TILE_SIZE)*TILE_SIZE };
    const scale = Math.max(1, Math.min(2, Math.ceil(Math.hypot(transform.a, transform.b)))), material = surface.terrain ?? 'grass';
    const key = `${this.spriteRevision}:${world.authoringRevision}:${world.lockRevision}:${material}:${scale}:${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}`;
    let cached = this.surfaceMaterialCache.get(key);
    if (!cached) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil((bounds.right-bounds.left)*scale)); canvas.height = Math.max(1, Math.ceil((bounds.bottom-bounds.top)*scale));
      const paint = canvas.getContext('2d')!; paint.setTransform(scale,0,0,scale,-bounds.left*scale,-bounds.top*scale);
      this.surfacePainter ??= new TerrainRenderer(paint, this.localDungeons);
      this.surfacePainter.drawTerrain(world, time, paint, bounds, material);
      cached = { canvas, left: bounds.left, top: bounds.top, scale };
      remember(this.surfaceMaterialCache, key, cached, 8);
    }
    ctx.save(); ctx.globalAlpha *= surfaceOpacity(surface, viewer);
    ctx.beginPath(); ctx.rect(surface.x*TILE_SIZE, surface.y*TILE_SIZE, surface.width*TILE_SIZE, surface.height*TILE_SIZE); ctx.clip();
    ctx.drawImage(cached.canvas, cached.left, cached.top, cached.canvas.width/cached.scale, cached.canvas.height/cached.scale);
    ctx.restore();
  }
  drawTerrain(world: World, time: number, ctx: CanvasRenderingContext2D, bounds: RenderBounds, material?: TileKind): void {
    const requestedBounds=bounds;
    this.activeWorld = world;
    this.painting = world.authoring.document.painting ?? DEFAULT_PAINTING;
    if(this.sampleWorld!==world||this.sampleRevision!==world.authoringRevision||this.sampleLock!==world.lockRevision||this.samplePainting!==this.painting||this.sampleMaterial!==material){
      this.clearSamples();this.sampleWorld=world;this.sampleRevision=world.authoringRevision;this.sampleLock=world.lockRevision;this.samplePainting=this.painting;this.sampleMaterial=material;
    }
    this.maskedTerrain.motion.configure(world,this.painting);
    const coast=this.painting.waterCoast??DEFAULT_WATER_COAST,motion=coast.motion??DEFAULT_COAST_MOTION;
    const seaEnabled=this.painting.seaEnabled!==false;
    const masksEnabled=this.painting.masksEnabled!==false&&perf.feature('masks');
    const reach=this.painting.edges==='masks'&&coast.enabled&&seaEnabled?Math.max(coast.feather,coast.shallows,
      ...(motion.enabled&&perf.feature('sea')?motion.bands.filter(b=>b.width>0&&b.opacity>0).map(b=>b.width+motion.amplitude):[])):0;
    // A broad band may reach into the viewport from an offscreen coastline.
    // Keep the usual scenery margin, expanding it only for wider shore effects.
    const padding=Math.max(100,reach);
    bounds={left:bounds.left-padding,top:bounds.top-padding,right:bounds.right+padding,bottom:bounds.bottom+padding};
    this.environmentArt.configure(this.painting);
    const palette = this.painting.materials;
    const waterPlants: { x: number; y: number; variation: number; shore: number }[] = [];
    const transform = ctx.getTransform();
    const temperatureAt=(tx:number,ty:number):number=>{
      const key=`${tx},${ty}`,cached=this.temperatureSamples.get(key);
      return cached??remember(this.temperatureSamples,key,world.getTemperature(tx,ty),4096);
    };
    const scenery = (tile: TileKind) => tile === 'rock' || tile === 'bush';
    const tileAt = (tx: number, ty: number) => material ?? world.getTile(tx, ty);

    const rawSurfaceAt = (tx: number, ty: number): SurfaceKind | null => {
      if (this.outsideLocalMap(tx, ty)) return null;
      if (world.mode === 'arena' && (tx < -10 || tx > 9 || ty < -8 || ty > 7)) return null;
      const tile = tileAt(tx, ty);
      if (scenery(tile)) return null;
      const dungeon = world.mode === 'world' ? this.dungeonAt(tx, ty) : undefined;
      if (!material && dungeon && tile === dungeon.layout.floor) return 'stone';
      return tile === 'path' || tile === 'mud' || tile === 'water' || tile === 'snow' || tile === 'ice'
        ? tile
        : 'grass';
    };

    const inferredScenerySurface = (tx: number, ty: number): SurfaceKind => {
      for (let radius = 1; radius <= 4; radius++) {
        const scores = new Map<SurfaceKind, number>();
        const offsets: [number, number][] = radius === 1
          ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [1, 1], [-1, 1]]
          : [];
        if (radius > 1) {
          for (let offset = -radius; offset <= radius; offset++) {
            offsets.push([-radius, offset], [radius, offset]);
            if (Math.abs(offset) !== radius) offsets.push([offset, -radius], [offset, radius]);
          }
        }
        for (const [dx, dy] of offsets) {
          const candidate = rawSurfaceAt(tx + dx, ty + dy);
          if (!candidate || candidate === 'water') continue;
          const weight = dx === 0 || dy === 0 ? 2 : 1;
          scores.set(candidate, (scores.get(candidate) ?? 0) + weight);
        }
        if (scores.size) {
          let best: SurfaceKind = scores.keys().next().value!;
          for (const [candidate, score] of scores) {
            if (score > scores.get(best)!) best = candidate;
          }
          return best;
        }
      }
      return this.dungeonAt(tx, ty) ? 'stone' : 'grass';
    };

    const surfaces = this.surfaceSamples;
    const surfaceAt = (tx: number, ty: number): SurfaceKind | null => {
      const key = `${tx},${ty}`;
      const cached=surfaces.get(key);if(cached!==undefined)return cached;
      if (this.outsideLocalMap(tx, ty)) return remember(surfaces,key,null);
      const raw = rawSurfaceAt(tx, ty);
      const surface = raw ?? (scenery(tileAt(tx, ty)) ? inferredScenerySurface(tx, ty) : null);
      return remember(surfaces,key,surface);
    };

    const uncachedSurfaceColor = (surface: Exclude<SurfaceKind, 'water'>, tx: number, ty: number) => {
      if (surface === 'grass') {
        return tintGround(groundColor(
          world.getMoisture((tx + 0.5) * TILE_SIZE, (ty + 0.5) * TILE_SIZE),
          temperatureAt(tx, ty)
        ), PAINT_COLORS.grass, palette.grass.color);
      }
      if (surface === 'path') return tintGround(pathColor(temperatureAt(tx, ty)), PAINT_COLORS.path, palette.path.color);
      if (surface === 'stone') return palette.stone.color === PAINT_COLORS.stone ? this.dungeonAt(tx, ty)?.theme.floor ?? palette.stone.color : palette.stone.color;
      return palette[surface].color;
    };
    const surfaceColor=(surface:Exclude<SurfaceKind,'water'>,tx:number,ty:number):string=>{
      const key=`${surface}:${tx},${ty}`,cached=this.colorSamples.get(key);
      return cached??remember(this.colorSamples,key,uncachedSurfaceColor(surface,tx,ty));
    };

    const cornerNeighbours = [
      [[0, -1], [-1, 0], [-1, -1]],
      [[0, -1], [1, 0], [1, -1]],
      [[0, 1], [1, 0], [1, 1]],
      [[0, 1], [-1, 0], [-1, 1]],
    ] as const;

    type ShoreBacking = { surface: Exclude<SurfaceKind, 'water'>; sourceX: number; sourceY: number };
    const shoreBackings = new Map<string, ShoreBacking>();
    const shoreBackingAt = (tx: number, ty: number): ShoreBacking => {
      const key = `${tx},${ty}`, cached = shoreBackings.get(key);
      if (cached) return cached;
      const candidates = new Map<Exclude<SurfaceKind, 'water'>, ShoreBacking & { score: number }>();
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]] as const) {
        const surface = surfaceAt(tx + dx, ty + dy);
        if (!surface || surface === 'water') continue;
        const existing = candidates.get(surface);
        const score = (existing?.score ?? 0) + (dx === 0 || dy === 0 ? 2 : 1);
        candidates.set(surface, {
          surface,
          sourceX: existing?.sourceX ?? tx + dx,
          sourceY: existing?.sourceY ?? ty + dy,
          score,
        });
      }
      let best: (ShoreBacking & { score: number }) | undefined;
      for (const candidate of candidates.values()) if (!best || candidate.score > best.score) best = candidate;
      const backing: ShoreBacking = best
        ? { surface: best.surface, sourceX: best.sourceX, sourceY: best.sourceY }
        : { surface: 'grass', sourceX: tx, sourceY: ty };
      shoreBackings.set(key, backing);
      return backing;
    };

    const chunksStart=perf.begin();
    for (let cy = Math.floor(bounds.top / CHUNK_SIZE); cy <= Math.floor(bounds.bottom / CHUNK_SIZE); cy++) {
      for (let cx = Math.floor(bounds.left / CHUNK_SIZE); cx <= Math.floor(bounds.right / CHUNK_SIZE); cx++) {
        world.getChunk(cx, cy);
      }
    }
    perf.end('terrain-chunks',chunksStart);

    if(!masksEnabled){
      // Independent comparison path: square cells, no transition masks. Water
      // effects can remain enabled, using simple tile edges for animated shores.
      for(let ty=Math.floor(bounds.top/TILE_SIZE);ty<=Math.floor(bounds.bottom/TILE_SIZE);ty++){
        for(let tx=Math.floor(bounds.left/TILE_SIZE);tx<=Math.floor(bounds.right/TILE_SIZE);tx++){
          const surface=surfaceAt(tx,ty),x=tx*TILE_SIZE,y=ty*TILE_SIZE;
          const left=Math.round(x*transform.a+transform.e),top=Math.round(y*transform.d+transform.f);
          const right=Math.round((x+TILE_SIZE)*transform.a+transform.e),bottom=Math.round((y+TILE_SIZE)*transform.d+transform.f);
          const wx=(left-transform.e)/transform.a,wy=(top-transform.f)/transform.d;
          const width=(right-left)/transform.a,height=(bottom-top)/transform.d;
          ctx.fillStyle=surface===null?'#202b29':surface==='water'?palette.water.color:surfaceColor(surface,tx,ty);
          ctx.fillRect(wx,wy,width,height);
          if(surface===null)continue;
          if(surface==='water'){
            if(!seaEnabled)continue;
            this.drawWater(world,tx,ty,x,y,time,ctx);
            if(this.maskedTerrain.motion.enabled&&perf.feature('sea')){
              const boundary=new Path2D();let hasBoundary=false;
              for(const [dx,dy,ax,ay,bx,by] of [[0,-1,wx,wy,wx+width,wy],[1,0,wx+width,wy,wx+width,wy+height],
                [0,1,wx+width,wy+height,wx,wy+height],[-1,0,wx,wy+height,wx,wy]]){
                const neighbour=surfaceAt(tx+dx,ty+dy);
                if(neighbour===null||neighbour==='water')continue;
                boundary.moveTo(ax,ay);boundary.lineTo(bx,by);hasBoundary=true;
              }
              if(hasBoundary){const water=new Path2D();water.rect(wx,wy,width,height);
                this.maskedTerrain.motion.record(tx,ty,water,boundary,[],new DOMMatrix());}
              else this.maskedTerrain.motion.recordRect(tx,ty,wx,wy,width,height);
            }
          }else{
            const temp=temperatureAt(tx,ty);
            if(surface!=='stone')this.environmentArt.draw(ctx,surface,x,y,noise(tx,ty),0,1,1,temp<.28);
            this.environmentArt.paintGround(ctx,surface==='stone'?'path':surface,x,y,surface==='stone');
            if(surface==='grass'||surface==='mud'||surface==='stone')this.environmentArt.drawSnowFringe(ctx,x,y,noise(tx,ty),climateSnowCoverage(temp));
          }
        }
      }
      if(seaEnabled)this.environmentArt.paintWater(ctx,bounds,world);
    }else if (this.painting.edges === 'masks') {
      // Scenery needs its larger overflow margin below. Mask fills and textures
      // already include neighbouring cells; only broad shore effects need reach.
      const materialBounds={left:requestedBounds.left-reach,top:requestedBounds.top-reach,
        right:requestedBounds.right+reach,bottom:requestedBounds.bottom+reach};
      this.maskedTerrain.draw(ctx, materialBounds, this.painting, this.environmentArt, surfaceAt, surfaceColor, world,temperatureAt);
    } else {
    for (let ty = Math.floor(bounds.top / TILE_SIZE); ty <= Math.floor(bounds.bottom / TILE_SIZE); ty++) {
      for (let tx = Math.floor(bounds.left / TILE_SIZE); tx <= Math.floor(bounds.right / TILE_SIZE); tx++) {
        if (this.outsideLocalMap(tx, ty) || (world.mode === 'arena' && (tx < -10 || tx > 9 || ty < -8 || ty > 7))) {
          ctx.fillStyle = '#202b29';
          ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE + 0.4, TILE_SIZE + 0.4);
          continue;
        }
        const tile = tileAt(tx, ty);
        const x = tx * TILE_SIZE, y = ty * TILE_SIZE;
        const dungeon = world.mode === 'world' ? this.dungeonAt(tx, ty) : undefined;
        const variation = noise(tx, ty);
        const surface = surfaceAt(tx, ty);
        const waterBacking = tile === 'water' ? shoreBackingAt(tx, ty) : undefined;

        ctx.fillStyle = waterBacking
          ? surfaceColor(waterBacking.surface, waterBacking.sourceX, waterBacking.sourceY)
          : surface && surface !== 'water'
            ? surfaceColor(surface, tx, ty)
            : dungeon ? dungeon.theme.floor : TERRAIN.grass;

        const left = Math.floor(x * transform.a + transform.e);
        const top = Math.floor(y * transform.d + transform.f);
        const right = Math.ceil((x + TILE_SIZE) * transform.a + transform.e);
        const bottom = Math.ceil((y + TILE_SIZE) * transform.d + transform.f);
        ctx.fillRect((left - transform.e) / transform.a, (top - transform.f) / transform.d, (right - left) / transform.a, (bottom - top) / transform.d);

        if (tile === 'water'&&seaEnabled) {
          for (let corner = 0; corner < 4; corner++) {
            const [aOffset, bOffset, diagonalOffset] = cornerNeighbours[corner];
            const a = surfaceAt(tx + aOffset[0], ty + aOffset[1]);
            const b = surfaceAt(tx + bOffset[0], ty + bOffset[1]);
            const diagonal = surfaceAt(tx + diagonalOffset[0], ty + diagonalOffset[1]);
            if (!diagonal || diagonal === 'water' || diagonal === waterBacking!.surface || (a !== diagonal && b !== diagonal)) continue;
            const dungeonJunction = diagonal === 'stone' || waterBacking!.surface === 'stone';
            const walkwayJunction = (diagonal === 'path' && waterBacking!.surface === 'grass') || (diagonal === 'grass' && waterBacking!.surface === 'path');
            const radius = dungeonJunction ? 19 : walkwayJunction ? 17 : 13;
            const color = surfaceColor(diagonal, tx + diagonalOffset[0], ty + diagonalOffset[1]);
            this.environmentArt.roundTerrainCorner(ctx, x, y, corner, color, radius);
            coverTileBleed(ctx, tx + (corner === 1 || corner === 2 ? 1 : 0), ty + (corner === 2 || corner === 3 ? 1 : 0), corner, radius, color, transform.a);
          }
          const shore = this.drawWater(world, tx, ty, x, y, time, ctx);
          if (shore) waterPlants.push({ x, y, variation: noise(tx, ty, 17), shore });
        } else if (tile === 'water') {
          ctx.fillStyle=palette.water.color;ctx.fillRect(x,y,TILE_SIZE+.4,TILE_SIZE+.4);
        } else if (tile === 'rock' || tile === 'bush') {
          // Gestito dal pass sceneryGroups
        } else {
          const isCold = world.getTemperature(tx, ty) < 0.28;
          this.environmentArt.draw(ctx, tile, x, y, variation, 0, 1, 1, isCold);
        }
      }
    }

    for (let ty = Math.floor(bounds.top / TILE_SIZE); ty <= Math.floor(bounds.bottom / TILE_SIZE); ty++) {
      for (let tx = Math.floor(bounds.left / TILE_SIZE); tx <= Math.floor(bounds.right / TILE_SIZE); tx++) {
        if (world.mode === 'arena' && (tx < -10 || tx > 9 || ty < -8 || ty > 7)) continue;
        const surface = surfaceAt(tx, ty);
        if (surface && surface !== 'water') {
          this.environmentArt.paintGround(ctx, surface === 'stone' ? 'path' : surface, tx * TILE_SIZE, ty * TILE_SIZE, surface === 'stone');

          if (surface === 'snow') {
            const isGround = (s: SurfaceKind | null) => s === 'grass' || s === 'mud' || s === 'path' || s === 'stone';
            const north = isGround(surfaceAt(tx, ty - 1));
            const south = isGround(surfaceAt(tx, ty + 1));
            const west = isGround(surfaceAt(tx - 1, ty));
            const east = isGround(surfaceAt(tx + 1, ty));

            if (north || south || west || east) {
              this.environmentArt.drawSnowBanks(ctx, tx * TILE_SIZE, ty * TILE_SIZE, north, south, west, east, noise(tx, ty));
            }
          }

          if (surface === 'grass' || surface === 'mud' || surface === 'stone') {
            const temp = world.getTemperature(tx, ty);
            if (temp < 0.38) {
              this.environmentArt.drawSnowFringe(ctx, tx * TILE_SIZE, ty * TILE_SIZE, noise(tx, ty), climateSnowCoverage(temp));
            }
          }
        }
      }
    }

    const seamAccents = new Map<string, { x: number; y: number; variation: number }>();
    const vertexQuadrants = [[-1, -1, 2], [0, -1, 3], [0, 0, 0], [-1, 0, 1]] as const;
    for (let vy = Math.floor(bounds.top / TILE_SIZE); vy <= Math.floor(bounds.bottom / TILE_SIZE) + 1; vy++) {
      for (let vx = Math.floor(bounds.left / TILE_SIZE); vx <= Math.floor(bounds.right / TILE_SIZE) + 1; vx++) {
        const quadrants = vertexQuadrants.map(([dx, dy, corner]) => ({
          tx: vx + dx, ty: vy + dy, corner, surface: surfaceAt(vx + dx, vy + dy),
        }));
        if (quadrants.some(quadrant => !quadrant.surface || quadrant.surface === 'water')) continue;
        const counts = new Map<SurfaceKind, number>();
        for (const quadrant of quadrants) counts.set(quadrant.surface!, (counts.get(quadrant.surface!) ?? 0) + 1);
        if (counts.size !== 2) continue;

        const unique = quadrants.find(quadrant => counts.get(quadrant.surface!) === 1);
        const majority = quadrants.find(quadrant => counts.get(quadrant.surface!) === 3);

        const cornersToRound: typeof quadrants = [];
        let overlaySurface: SurfaceKind;
        let overlayTx: number, overlayTy: number;

        if (unique && majority) {
          cornersToRound.push(unique);
          overlaySurface = majority.surface!;
          overlayTx = majority.tx;
          overlayTy = majority.ty;
        } else if (!unique && !majority && quadrants[0].surface === quadrants[2].surface && quadrants[1].surface === quadrants[3].surface) {
          const surfaceA = quadrants[0].surface!;
          const surfaceB = quadrants[1].surface!;
          const priority = (s: SurfaceKind) => {
            switch (s) {
              case 'stone': return 6;
              case 'path': return 4;
              case 'mud': return 3;
              case 'ice': return 2;
              case 'snow': return 5;
              default: return 1;
            }
          };
          const aAbove = priority(surfaceA) > priority(surfaceB);
          overlaySurface = aAbove ? surfaceA : surfaceB;
          const underSurface = aAbove ? surfaceB : surfaceA;
          for (const q of quadrants) if (q.surface === underSurface) cornersToRound.push(q);
          const overlayQ = quadrants.find(q => q.surface === overlaySurface)!;
          overlayTx = overlayQ.tx;
          overlayTy = overlayQ.ty;
        } else {
          continue;
        }

        for (const q of cornersToRound) {
          const current = q.surface!, other = overlaySurface;
          if (current === 'water' || other === 'water') continue;

          const dungeonJunction = current === 'stone' || other === 'stone';
          const walkwayJunction = (current === 'path' && other === 'grass') || (current === 'grass' && other === 'path');
          const radius = dungeonJunction ? 19 : walkwayJunction ? 17 : 13;
          const color = surfaceColor(other, overlayTx, overlayTy);
          const ux = q.tx * TILE_SIZE, uy = q.ty * TILE_SIZE;

          this.environmentArt.roundTerrainCorner(ctx, ux, uy, q.corner, color, radius);
          coverTileBleed(ctx, vx, vy, q.corner, radius, color, transform.a);

          if (dungeonJunction) {
            const cornerX = vx * TILE_SIZE, cornerY = vy * TILE_SIZE, key = `${cornerX},${cornerY}`;
            seamAccents.set(key, {
              x: cornerX, y: cornerY, variation: noise(cornerX / TILE_SIZE, cornerY / TILE_SIZE, 29),
            });
          }
        }
      }
    }

    for (const accent of seamAccents.values()) {
      this.environmentArt.drawTerrainSeam(ctx, accent.x, accent.y, accent.variation);
    }
    if(seaEnabled)this.environmentArt.paintWater(ctx, bounds, world);
    for (const plant of waterPlants) {
      this.environmentArt.drawWaterPlants(ctx, plant.x, plant.y, plant.variation, plant.shore);
    }

    }
    const sceneryStart=perf.begin();
    const getScenery = (tx: number, ty: number): TileKind => {
      if (this.outsideLocalMap(tx, ty)) return 'grass';
      if (world.mode === 'arena' && (tx < -10 || tx > 9 || ty < -8 || ty > 7)) return 'grass';
      return tileAt(tx, ty);
    };

    for (let ty = Math.floor(bounds.top / TILE_SIZE / 2) * 2; ty <= Math.floor(bounds.bottom / TILE_SIZE); ty += 2) {
      for (let tx = Math.floor(bounds.left / TILE_SIZE / 2) * 2; tx <= Math.floor(bounds.right / TILE_SIZE); tx += 2) {
        for (const group of sceneryGroups(getScenery, tx, ty)) {
          const isSnowy = surfaceAt(group.x, group.y) === 'snow' || surfaceAt(group.x, group.y) === 'ice';
          if (group.tile === 'bush' && world.authoring.tiles.at(group.x, group.y)?.bushStyle !== 'js') {
            const asset = world.authoring.terrainBushAt(group.x, group.y);
            this.bushArt.draw(ctx, asset, { id: `terrain-bush:${group.x},${group.y}`, assetId: asset.id, x: group.x, y: group.y });
          } else this.environmentArt.draw(ctx, group.tile, group.x * TILE_SIZE, group.y * TILE_SIZE,
              noise(group.x, group.y), 0, group.width, group.height, isSnowy);
        }
      }
    }
    perf.end('terrain-scenery',sceneryStart);
  }
  private drawWater(world: World, tx: number, ty: number, x: number, y: number, _time: number, ctx = this.ctx): number {
    const shore = shorelineMask((nx, ny) => world.getTile(nx, ny), tx, ty);
    this.environmentArt.draw(ctx, 'water', x, y, noise(tx, ty), shore);
    return shore;
  }
}
