import { CHUNK_SIZE, TILE_SIZE } from '../../shared/config';
import type { TileKind } from '../../shared/types';
import type { World } from '../../shared/world';
import type { DungeonDefinition } from '../../shared/dungeons';
import { EnvironmentArt } from './environment-art';
import { noise } from './render-primitives';
import { TERRAIN, groundColor, sceneryGroups, pathColor } from './terrain-style';
import type { RenderBounds, TerrainViewport } from './render-types';
import { TerrainMaterials, MATERIAL_PRIORITY } from './terrain-materials';
import { SurfaceTerrain, type TerrainLevel } from './surface-terrain';
import type { Vec2 } from '../../shared/types';
import { NaturalTerrainEdges, SOFT_PATH_CORNER } from './natural-terrain-edges';
import { legacyRockInWater } from './legacy-water-rocks';
import { inferSceneryGround } from './scenery-ground';
import { paintPathEdges, DEFAULT_PATH_EDGE_STYLE, type PathEdgeStyle } from './path-terrain-edges';
import { ELEVATION_STEP } from '../../shared/world-surfaces';
import { TerrainStream, type TerrainBitmap } from './terrain-stream';
type DirtyStrip = { left: number; top: number; right: number; bottom: number };
function coverTileBleed(ctx: CanvasRenderingContext2D, vx: number, vy: number, corner: number, radius: number, color: string | CanvasPattern, scale: number): void {
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
  private readonly environmentArt = new EnvironmentArt();
  private readonly materials = new TerrainMaterials();
  private readonly naturalEdges = new NaturalTerrainEdges();
  private readonly surfaceTerrain = new SurfaceTerrain(this.materials, this.environmentArt);
  private pathEdgeStyle: PathEdgeStyle = DEFAULT_PATH_EDGE_STYLE;
  private terrainCache?: TerrainBitmap;
  private spareTerrainCanvas?: HTMLCanvasElement;
  private rasterScale?: number;
  private readonly stream = new TerrainStream((bitmap, time) => this.paintStrip(bitmap,
    bitmap.canvas.getContext('2d', { alpha: false })!, { left: 0, top: 0, right: bitmap.canvas.width, bottom: bitmap.canvas.height }, time, TILE_SIZE));
  private lockRevision = -1;
  private authoringRevision = -1;
  private surfaceBounds?: RenderBounds;
  private groundCacheWorld?: World;
  private groundPixels = 0;
  private readonly groundCache = new Map<string, { canvas: HTMLCanvasElement; x: number; y: number; scale: number }>();
  readonly spritesReady: Promise<void>;
  constructor(private readonly ctx: CanvasRenderingContext2D, private readonly localDungeons?: readonly DungeonDefinition[], private readonly layeredSurfaces = false) {
    this.spritesReady = Promise.all([this.materials.ready, this.environmentArt.ready, this.surfaceTerrain.rockArt.ready,
      this.surfaceTerrain.wallArt.ready]).then(() => this.invalidate());
  }
  invalidate(): void { this.terrainCache = undefined; this.spareTerrainCanvas = undefined; this.rasterScale = undefined; this.stream.reset(); this.surfaceBounds = undefined; this.groundCache.clear(); this.groundPixels = 0; }
  /** Switch the painted margin without changing the world document. */
  setPathEdgeStyle(style: PathEdgeStyle): void {
    if(this.pathEdgeStyle===style)return;
    this.pathEdgeStyle=style;this.surfaceTerrain.pathEdgeStyle=style;this.invalidate();
  }
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
  drawCachedTerrain(world: World, view: TerrainViewport, time: number, rasterZoom = view.zoom, stream = false): void {
    this.activeWorld = world;
    if (this.lockRevision !== world.lockRevision || this.authoringRevision !== world.authoringRevision) {
      this.invalidate();
      this.lockRevision = world.lockRevision;
      this.authoringRevision = world.authoringRevision;
    }
    // Camera zoom changes how the bitmap is projected, not its raster resolution.
    const scale = view.dpr * rasterZoom;
    this.rasterScale = scale;
    if (stream && this.stream.supported(view, scale)) {
      if (!this.stream.matches(world, scale)) {
        this.drawCachedTerrain(world, view, time, rasterZoom);
        this.stream.seed(this.terrainCache!);
        this.terrainCache = undefined; this.spareTerrainCanvas = undefined;
      } else this.stream.draw(this.ctx, view, time);
      return;
    }
    const left = view.camera.x - view.width / (2 * view.zoom);
    const top = view.camera.y - view.height / (2 * view.zoom);
    const right = left + view.width / view.zoom, bottom = top + view.height / view.zoom;
    let cache = this.terrainCache;
    if (!cache || cache.world !== world || cache.scale !== scale ||
      left < cache.left || top < cache.top || right > cache.right || bottom > cache.bottom) {
      const margin = 192;
      const x = Math.floor((left - margin) * scale) / scale;
      const y = Math.floor((top - margin) * scale) / scale;
      const source = cache?.canvas;
      const width = Math.ceil((view.width / view.zoom + margin * 2) * scale) + 1;
      const height = Math.ceil((view.height / view.zoom + margin * 2) * scale) + 1;
      const dx = cache ? Math.round((cache.left - x) * scale) : 0;
      const dy = cache ? Math.round((cache.top - y) * scale) : 0;
      const reuse = cache?.world === world && cache.scale === scale &&
        source?.width === width && source.height === height && Math.abs(dx) < width && Math.abs(dy) < height;
      // Copy into another buffer: copying a canvas onto itself can force a costly GPU flush.
      const existing = reuse ? this.spareTerrainCanvas : source;
      const canvas = existing ?? document.createElement('canvas');
      if (reuse) this.spareTerrainCanvas = source;
      if (!existing) canvas.addEventListener('contextrestored', () => {
        if (this.terrainCache?.canvas === canvas || this.spareTerrainCanvas === canvas) this.invalidate();
      });
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const ctx = canvas.getContext('2d', { alpha: false })!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      const dirty: DirtyStrip[] = [];
      if (reuse) {
        ctx.drawImage(source!, dx, dy);
        if (dx) dirty.push({ left: dx > 0 ? 0 : width + dx, top: 0, right: dx > 0 ? dx : width, bottom: height });
        if (dy) dirty.push({ left: Math.max(0, dx), top: dy > 0 ? 0 : height + dy, right: Math.min(width, width + dx), bottom: dy > 0 ? dy : height });
      } else dirty.push({ left: 0, top: 0, right: width, bottom: height });

      cache = { canvas, world, scale, left: x, top: y, right: x + canvas.width / scale, bottom: y + canvas.height / scale };
      for (const strip of dirty) this.paintStrip(cache, ctx, strip, time);
      this.terrainCache = cache;
    }
    this.ctx.drawImage(cache.canvas, cache.left, cache.top, cache.canvas.width / scale, cache.canvas.height / scale);
  }
  private paintStrip(bitmap: TerrainBitmap, ctx: CanvasRenderingContext2D, strip: DirtyStrip, time: number, halo = 100): void {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath(); ctx.rect(strip.left, strip.top, strip.right - strip.left, strip.bottom - strip.top); ctx.clip();
    ctx.fillStyle = TERRAIN.grass; ctx.fillRect(strip.left, strip.top, strip.right - strip.left, strip.bottom - strip.top);
    ctx.setTransform(bitmap.scale, 0, 0, bitmap.scale, -bitmap.left * bitmap.scale, -bitmap.top * bitmap.scale);
    this.drawTerrain(bitmap.world, time, ctx, {
      left: bitmap.left + strip.left / bitmap.scale - halo, top: bitmap.top + strip.top / bitmap.scale - halo,
      right: bitmap.left + strip.right / bitmap.scale + halo, bottom: bitmap.top + strip.bottom / bitmap.scale + halo,
    }, !this.layeredSurfaces);
    ctx.restore();
  }
  drawTerrain(world: World, time: number, ctx: CanvasRenderingContext2D, bounds: RenderBounds, includeSurfaces = true): void {
    this.drawBaseTerrain(world, time, ctx, bounds);
    if (includeSurfaces) this.drawGroundSurfaces(world, time, ctx, bounds);
  }
  drawEditorTerrain(world: World, time: number, ctx: CanvasRenderingContext2D, bounds: RenderBounds, options: { projectElevation?: boolean; groundOnly?: boolean; foreground?: boolean } = {}): void {
    this.drawBaseTerrain(world, time, ctx, bounds);
    this.drawEditorSurfaces(world, time, ctx, bounds, options);
  }
  drawEditorSurfaces(world: World, time: number, ctx: CanvasRenderingContext2D, bounds: RenderBounds, options: { projectElevation?: boolean; groundOnly?: boolean; foreground?: boolean } = {}): void {
    const levels = this.surfaceTerrain.levels(world, bounds, options.groundOnly ? 'ground' : undefined);
    for (const level of levels) this.surfaceTerrain.drawLevel(ctx, world, level, time, [], options.projectElevation !== false);
    this.surfaceTerrain.drawLinks(ctx, world, options.projectElevation !== false, undefined, options.groundOnly);
    if (options.foreground !== false) for (const level of levels)
      this.surfaceTerrain.drawForeground(ctx, world, level, time, [], options.projectElevation !== false);
  }
  surfaceLevels(world: World, bounds: RenderBounds): TerrainLevel[] { this.surfaceBounds = bounds; return this.surfaceTerrain.levels(world, bounds); }
  drawSurfaceLevel(world: World, level: TerrainLevel, time: number, ctx: CanvasRenderingContext2D, viewers: readonly Vec2[] = []): void {
    this.drawCachedGroundLevel(world, level, ctx);
    // Bridges remain live: their fade and local windows depend on actors underneath.
    this.surfaceTerrain.drawBridgeLevel(ctx, world, level, time, viewers);
    this.surfaceTerrain.drawLinks(ctx, world, true, level.elevation, false, this.surfaceBounds);
  }
  private drawCachedGroundLevel(world: World, level: TerrainLevel, ctx: CanvasRenderingContext2D): void {
    const cells = level.cells.filter(cell => cell.kind === 'ground');
    if (!cells.length) return;
    if (cells.length > 4096) { this.surfaceTerrain.drawGroundLevel(ctx, world, level); return; }
    if (this.groundCacheWorld !== world) { this.groundCache.clear(); this.groundPixels = 0; this.groundCacheWorld = world; }
    const transform = ctx.getTransform(), scale = this.rasterScale ?? Math.hypot(transform.a, transform.b);
    const key = `${world.authoringRevision}:${world.lockRevision}:${level.elevation}:${scale}:${cells.map(cell => `${cell.surfaceId},${cell.x},${cell.y}`).join(';')}`;
    let bitmap = this.groundCache.get(key);
    if (!bitmap) {
      const left = Math.min(...cells.map(cell => cell.x)) * TILE_SIZE - 64;
      const top = Math.min(...cells.map(cell => cell.y)) * TILE_SIZE - level.elevation * ELEVATION_STEP - 64;
      const right = (Math.max(...cells.map(cell => cell.x)) + 1) * TILE_SIZE + 64;
      const bottom = (Math.max(...cells.map(cell => cell.y)) + 1) * TILE_SIZE + 64;
      const x = Math.floor(left * scale) / scale, y = Math.floor(top * scale) / scale;
      const width = Math.ceil((right - x) * scale), height = Math.ceil((bottom - y) * scale);
      // Sparse overview scenes can have huge bounding boxes; keep a fixed bitmap budget.
      if (width * height > 3_000_000 || width > 4096 || height > 4096) {
        this.surfaceTerrain.drawGroundLevel(ctx, world, level); return;
      }
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const paint = canvas.getContext('2d')!;
      paint.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
      this.surfaceTerrain.drawGroundLevel(paint, world, level);
      while (this.groundCache.size && (this.groundCache.size >= 8 || this.groundPixels + width * height > 3_000_000)) {
        const oldest = this.groundCache.keys().next().value!, item = this.groundCache.get(oldest)!;
        this.groundPixels -= item.canvas.width * item.canvas.height; this.groundCache.delete(oldest);
      }
      bitmap = { canvas, x, y, scale }; this.groundCache.set(key, bitmap); this.groundPixels += width * height;
    }
    this.groundCache.delete(key); this.groundCache.set(key, bitmap);
    ctx.drawImage(bitmap.canvas, bitmap.x, bitmap.y, bitmap.canvas.width / bitmap.scale, bitmap.canvas.height / bitmap.scale);
  }
  drawSurfaceForeground(world: World, level: TerrainLevel, time: number, ctx: CanvasRenderingContext2D,
    viewers: readonly Vec2[] = [], projectElevation = true): void {
    this.surfaceTerrain.drawForeground(ctx, world, level, time, viewers, projectElevation);
  }
  drawSurfaceLinks(world: World, ctx: CanvasRenderingContext2D): void { this.surfaceTerrain.drawLinks(ctx, world); }
  private drawGroundSurfaces(world: World, time: number, ctx: CanvasRenderingContext2D, bounds: RenderBounds): void {
    for (const level of this.surfaceTerrain.levels(world, bounds, 'ground')) this.surfaceTerrain.drawLevel(ctx, world, level, time);
    this.surfaceTerrain.drawLinks(ctx, world, true, undefined, false, bounds);
  }
  private drawBaseTerrain(world: World, time: number, ctx: CanvasRenderingContext2D, bounds: RenderBounds): void {
    this.activeWorld = world;
    const waterPlants: { x: number; y: number; variation: number; shore: number }[] = [];
    const transform = ctx.getTransform();
    type SurfaceKind = 'grass' | 'path' | 'mud' | 'stone' | 'water' | 'snow' | 'ice' | 'brick' | 'sand' | 'wood';
    const scenery = (tile: TileKind) => tile === 'rock' || tile === 'bush';

    const rawSurfaceAt = (tx: number, ty: number): SurfaceKind | null => {
      if (this.outsideLocalMap(tx, ty)) return null;
      if (world.mode === 'arena' && (tx < -10 || tx > 9 || ty < -8 || ty > 7)) return null;
      const tile = world.getTile(tx, ty);
      if (tile === 'rock' && !this.dungeonAt(tx, ty) && legacyRockInWater(world, tx, ty)) return 'water';
      if (scenery(tile)) return null;
      const authored = world.surfaceIndex.at(tx, ty)?.material;
      if (authored && authored !== 'bush' && authored !== 'rock' && authored !== tile) return authored;
      const dungeon = world.mode === 'world' ? this.dungeonAt(tx, ty) : undefined;
      if (dungeon && tile === dungeon.layout.floor) return 'stone';
      return tile === 'path' || tile === 'mud' || tile === 'water' || tile === 'snow' || tile === 'ice'
        ? tile
        : 'grass';
    };

    const inferredScenerySurface = (tx: number, ty: number): SurfaceKind => {
      return inferSceneryGround(tx,ty,rawSurfaceAt,this.dungeonAt(tx,ty) ? 'stone' : 'grass');
    };

    const surfaces = new Map<string, SurfaceKind | null>();
    const surfaceAt = (tx: number, ty: number): SurfaceKind | null => {
      if (this.outsideLocalMap(tx, ty)) return null;
      const key = `${tx},${ty}`;
      if (surfaces.has(key)) return surfaces.get(key)!;
      const raw = rawSurfaceAt(tx, ty);
      const surface = raw ?? (scenery(world.getTile(tx, ty)) ? inferredScenerySurface(tx, ty) : null);
      surfaces.set(key, surface);
      return surface;
    };

    const surfaceColor = (surface: Exclude<SurfaceKind, 'water'>, tx: number, ty: number) => {
      if (surface === 'grass') {
        return groundColor(
          world.getMoisture((tx + 0.5) * TILE_SIZE, (ty + 0.5) * TILE_SIZE),
          world.getTemperature(tx, ty)
        );
      }
      if (surface === 'path') return pathColor(world.getTemperature(tx, ty));
      if (surface === 'stone') return this.dungeonAt(tx, ty)?.theme.floor ?? TERRAIN.path;
      return this.materials.color(surface);
    };
    const surfacePaint = (surface: Exclude<SurfaceKind, 'water'>, tx: number, ty: number) => this.materials.fill(ctx, surface, surfaceColor(surface, tx, ty));

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

    for (let cy = Math.floor(bounds.top / CHUNK_SIZE); cy <= Math.floor(bounds.bottom / CHUNK_SIZE); cy++) {
      for (let cx = Math.floor(bounds.left / CHUNK_SIZE); cx <= Math.floor(bounds.right / CHUNK_SIZE); cx++) {
        world.getChunk(cx, cy);
      }
    }

    // Water sprites round outwards to device pixels. Paint opaque land afterwards
    // so that rounding cannot leave blue rectangles outside the curved shoreline.
    for (const waterPass of [true, false]) {
      for (let ty = Math.floor(bounds.top / TILE_SIZE); ty <= Math.floor(bounds.bottom / TILE_SIZE); ty++) {
        for (let tx = Math.floor(bounds.left / TILE_SIZE); tx <= Math.floor(bounds.right / TILE_SIZE); tx++) {
          if (this.outsideLocalMap(tx, ty) || (world.mode === 'arena' && (tx < -10 || tx > 9 || ty < -8 || ty > 7))) {
            ctx.fillStyle = '#202b29';
            ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE + 0.4, TILE_SIZE + 0.4);
            continue;
          }
          const tile = world.getTile(tx, ty);
          const x = tx * TILE_SIZE, y = ty * TILE_SIZE;
          const dungeon = world.mode === 'world' ? this.dungeonAt(tx, ty) : undefined;
          const variation = noise(tx, ty);
          const surface = surfaceAt(tx, ty);
          const isWaterSurface = surface === 'water';
          if (isWaterSurface !== waterPass) continue;
          const waterBacking = isWaterSurface ? shoreBackingAt(tx, ty) : undefined;

          ctx.fillStyle = waterBacking
            ? surfacePaint(waterBacking.surface, waterBacking.sourceX, waterBacking.sourceY)
            : surface && surface !== 'water'
              ? surfacePaint(surface, tx, ty)
              : dungeon ? dungeon.theme.floor : TERRAIN.grass;

          const left = Math.floor(x * transform.a + transform.e);
          const top = Math.floor(y * transform.d + transform.f);
          const right = Math.ceil((x + TILE_SIZE) * transform.a + transform.e);
          const bottom = Math.ceil((y + TILE_SIZE) * transform.d + transform.f);
          ctx.fillRect((left - transform.e) / transform.a, (top - transform.f) / transform.d, (right - left) / transform.a, (bottom - top) / transform.d);

          if (isWaterSurface) {
            for (let corner = 0; corner < 4; corner++) {
              const [aOffset, bOffset, diagonalOffset] = cornerNeighbours[corner];
              const a = surfaceAt(tx + aOffset[0], ty + aOffset[1]);
              const b = surfaceAt(tx + bOffset[0], ty + bOffset[1]);
              const diagonal = surfaceAt(tx + diagonalOffset[0], ty + diagonalOffset[1]);
              if (!diagonal || diagonal === 'water' || diagonal === waterBacking!.surface || (a !== diagonal && b !== diagonal)) continue;
              const dungeonJunction = diagonal === 'stone' || waterBacking!.surface === 'stone';
              const walkwayJunction = (diagonal === 'path' && waterBacking!.surface === 'grass') || (diagonal === 'grass' && waterBacking!.surface === 'path');
              const radius = dungeonJunction ? 19 : walkwayJunction ? SOFT_PATH_CORNER : 13;
              const color = surfacePaint(diagonal, tx + diagonalOffset[0], ty + diagonalOffset[1]);
              this.environmentArt.roundTerrainCorner(ctx, x, y, corner, color, radius);
              coverTileBleed(ctx, tx + (corner === 1 || corner === 2 ? 1 : 0), ty + (corner === 2 || corner === 3 ? 1 : 0), corner, radius, color, transform.a);
            }
            const shore = this.drawWater(world, tx, ty, x, y, time, ctx);
            if (shore) waterPlants.push({ x, y, variation: noise(tx, ty, 17), shore });
          } else if (tile === 'rock' || tile === 'bush') {
            // Gestito dal pass sceneryGroups
          } else {
            const isCold = world.getTemperature(tx, ty) < 0.28;
            this.environmentArt.draw(ctx, tile, x, y, variation, 0, 1, 1, isCold);
          }
        }
      }
    }

    for (let ty = Math.floor(bounds.top / TILE_SIZE); ty <= Math.floor(bounds.bottom / TILE_SIZE); ty++) {
      for (let tx = Math.floor(bounds.left / TILE_SIZE); tx <= Math.floor(bounds.right / TILE_SIZE); tx++) {
        if (world.mode === 'arena' && (tx < -10 || tx > 9 || ty < -8 || ty > 7)) continue;
        const surface = surfaceAt(tx, ty);
        if (surface && surface !== 'water') {
          this.environmentArt.paintGround(ctx, surface === 'stone' || surface === 'brick' ? 'path' : surface === 'sand' || surface === 'wood' ? 'mud' : surface, tx * TILE_SIZE, ty * TILE_SIZE, surface === 'stone',
            surface==='grass'?world.getMoisture((tx+.5)*TILE_SIZE,(ty+.5)*TILE_SIZE):.4,surface==='grass' && world.getTemperature(tx,ty)<.32);

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
              const level = temp < 0.30 ? 3 : temp < 0.34 ? 2 : 1;
              this.environmentArt.drawSnowFringe(ctx, tx * TILE_SIZE, ty * TILE_SIZE, noise(tx, ty), level);
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
        const elevations = quadrants.map(q => world.surfaceIndex.at(q.tx, q.ty)?.elevation ?? 0);
        if (elevations.some(elevation => elevation !== elevations[0])) continue;
        const counts = new Map<SurfaceKind, number>();
        for (const quadrant of quadrants) counts.set(quadrant.surface!, (counts.get(quadrant.surface!) ?? 0) + 1);
        if (counts.size >= 3) {
          const dominant = [...quadrants].sort((a, b) => MATERIAL_PRIORITY[b.surface!] - MATERIAL_PRIORITY[a.surface!] || a.surface!.localeCompare(b.surface!))[0];
          const color = surfacePaint(dominant.surface as Exclude<SurfaceKind, 'water'>, dominant.tx, dominant.ty);
          for (const q of quadrants) if (q.surface !== dominant.surface) {
            this.environmentArt.roundTerrainCorner(ctx, q.tx * TILE_SIZE, q.ty * TILE_SIZE, q.corner, color, 9);
            coverTileBleed(ctx, vx, vy, q.corner, 9, color, transform.a);
          }
          seamAccents.set(`${vx},${vy}`, { x: vx * TILE_SIZE, y: vy * TILE_SIZE, variation: noise(vx, vy, 29) });
          continue;
        }
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
          const aAbove = MATERIAL_PRIORITY[surfaceA] > MATERIAL_PRIORITY[surfaceB];
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
          if(walkwayJunction && this.pathEdgeStyle!=='current')continue;
          const radius = dungeonJunction ? 19 : walkwayJunction ? SOFT_PATH_CORNER : 13;
          const color = surfacePaint(other, overlayTx, overlayTy);
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
    const shoreCurves = this.surfaceTerrain.drawConnectedWaterBanks(ctx, world,
      waterPlants.map(plant => ({ x: Math.floor(plant.x / TILE_SIZE), y: Math.floor(plant.y / TILE_SIZE) })), 'ground', 0,
      (tx, ty, corner, mask) => {
        const previous = (corner + 3) % 4;
        const index = mask & (1 << corner) ? corner : mask & (1 << previous) ? previous : 4 + previous;
        const [dx, dy] = [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]][index];
        const surface = surfaceAt(tx + dx, ty + dy);
        const backing = shoreBackingAt(tx, ty);
        return surfacePaint(surface && surface !== 'water' ? surface : backing.surface,
          surface && surface !== 'water' ? tx + dx : backing.sourceX, surface && surface !== 'water' ? ty + dy : backing.sourceY);
      });
    this.environmentArt.paintWater(ctx, bounds, world);
    for (const plant of waterPlants) {
      const plantMask = this.surfaceTerrain.waterPlantsMask(world, Math.floor(plant.x / TILE_SIZE), Math.floor(plant.y / TILE_SIZE), plant.shore);
      const curves = shoreCurves.get(`${Math.floor(plant.x / TILE_SIZE)},${Math.floor(plant.y / TILE_SIZE)}`);
      this.environmentArt.drawWaterPlants(ctx, plant.x, plant.y, plant.variation, plantMask, curves);
      this.surfaceTerrain.drawNaturalWaterBanks(ctx, world, Math.floor(plant.x / TILE_SIZE), Math.floor(plant.y / TILE_SIZE), plant.x, plant.y,
        'ground', 0, curves);
    }

    if(this.pathEdgeStyle!=='current') {
      const pathCells:{x:number;y:number}[]=[];
      for(let y=Math.floor(bounds.top/TILE_SIZE);y<=Math.floor(bounds.bottom/TILE_SIZE);y++)
        for(let x=Math.floor(bounds.left/TILE_SIZE);x<=Math.floor(bounds.right/TILE_SIZE);x++)
          if(surfaceAt(x,y)==='path')pathCells.push({x,y});
      paintPathEdges(ctx,pathCells,(x,y)=>{
        const material=surfaceAt(x,y);return material?{material,elevation:world.surfaceIndex.at(x,y)?.elevation ?? 0}:undefined;
      },(x,y)=>surfacePaint('grass',x,y),this.pathEdgeStyle,0,
        (x,y,corner,curve)=>this.naturalEdges.path(ctx,x,y,corner,curve,world.getMoisture((x+.5)*TILE_SIZE,(y+.5)*TILE_SIZE),world.getTemperature(x,y)<.32));
    }

    for (let ty = Math.floor(bounds.top / TILE_SIZE); ty <= Math.floor(bounds.bottom / TILE_SIZE); ty++) {
      for (let tx = Math.floor(bounds.left / TILE_SIZE); tx <= Math.floor(bounds.right / TILE_SIZE); tx++) {
        if (surfaceAt(tx, ty) !== 'grass') continue;
        const elevation = world.surfaceIndex.at(tx, ty)?.elevation ?? 0;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const neighbor = surfaceAt(tx + dx, ty + dy);
          if (neighbor !== 'path' && neighbor !== 'mud' && neighbor !== 'sand') continue;
          if(neighbor==='path' && this.pathEdgeStyle!=='current')continue;
          if ((world.surfaceIndex.at(tx + dx, ty + dy)?.elevation ?? 0) !== elevation) continue;
          const alongX = dy ? 1 : 0, alongY = dx ? 1 : 0;
          const continues = (sign: number) => surfaceAt(tx + alongX * sign, ty + alongY * sign) === 'grass'
            && surfaceAt(tx + dx + alongX * sign, ty + dy + alongY * sign) === neighbor;
          this.naturalEdges.land(ctx, {
            tx, ty, x: tx * TILE_SIZE, y: ty * TILE_SIZE, direction: [dx, dy], paint: surfacePaint('grass', tx, ty),
            cold: world.getTemperature(tx, ty) < .32, moisture: world.getMoisture((tx + .5) * TILE_SIZE, (ty + .5) * TILE_SIZE),
            trimStart: continues(-1) ? 0 : neighbor === 'path' ? SOFT_PATH_CORNER : 13,
            trimEnd: continues(1) ? 0 : neighbor === 'path' ? SOFT_PATH_CORNER : 13, softRoad: neighbor === 'path',
          });
        }
      }
    }

    const getScenery = (tx: number, ty: number): TileKind => {
      if (this.outsideLocalMap(tx, ty)) return 'grass';
      if (world.mode === 'arena' && (tx < -10 || tx > 9 || ty < -8 || ty > 7)) return 'grass';
      return world.getTile(tx, ty);
    };

    for (let ty = Math.floor(bounds.top / TILE_SIZE / 2) * 2; ty <= Math.floor(bounds.bottom / TILE_SIZE); ty += 2) {
      for (let tx = Math.floor(bounds.left / TILE_SIZE / 2) * 2; tx <= Math.floor(bounds.right / TILE_SIZE); tx += 2) {
        for (const group of sceneryGroups(getScenery, tx, ty)) {
          const isSnowy = surfaceAt(group.x, group.y) === 'snow' || surfaceAt(group.x, group.y) === 'ice';
          this.environmentArt.draw(ctx, group.tile, group.x * TILE_SIZE, group.y * TILE_SIZE,
            noise(group.x, group.y), 0, group.width, group.height, isSnowy);
        }
      }
    }
  }
  private drawWater(world: World, tx: number, ty: number, x: number, y: number, _time: number, ctx = this.ctx): number {
    const { mask: shore } = this.surfaceTerrain.waterEdges(world, tx, ty);
    this.environmentArt.draw(ctx, 'water', x, y, noise(tx, ty), 0);
    this.surfaceTerrain.drawWaterBorders(ctx, world, tx, ty, x, y);
    return shore;
  }
}
