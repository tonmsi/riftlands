import { CHUNK_SIZE, TILE_SIZE } from '../../shared/config';
import type { TileKind } from '../../shared/types';
import type { World } from '../../shared/world';
import { dungeonAtTile, type DungeonDefinition } from '../../shared/dungeons';
import { EnvironmentArt } from './environment-art';
import { noise } from './render-primitives';
import { TERRAIN, groundColor, shorelineMask, sceneryGroups, pathColor } from './terrain-style';
import type { RenderBounds, TerrainViewport } from './render-types';
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
  private readonly environmentArt = new EnvironmentArt();
  private terrainCache?: {
    canvas: HTMLCanvasElement;
    world: World;
    scale: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  private lockRevision = -1;
  readonly spritesReady: Promise<void>;
  constructor(private readonly ctx: CanvasRenderingContext2D, private readonly localDungeons?: readonly DungeonDefinition[]) {
    this.spritesReady = Promise.resolve();
  }
  invalidate(): void { this.terrainCache = undefined; }
  private outsideLocalMap(tx: number, ty: number): boolean {
    return !!this.localDungeons && !this.localDungeons.some(d => {
      const b = d.layout.bounds;
      return tx >= b.minTx - 2 && tx <= b.maxTx + 2 && ty >= b.minTy - 2 && ty <= b.maxTy + 2;
    });
  }
  private dungeonAt(tx: number, ty: number): DungeonDefinition | undefined {
    return this.localDungeons
      ? this.localDungeons.find(d => {
          const b = d.layout.bounds;
          return tx >= b.minTx && tx <= b.maxTx && ty >= b.minTy && ty <= b.maxTy;
        })
      : dungeonAtTile(tx, ty);
  }
  drawCachedTerrain(world: World, view: TerrainViewport, time: number): void {
    if (this.lockRevision !== world.lockRevision) {
      this.invalidate();
      this.lockRevision = world.lockRevision;
    }
    const scale = view.dpr * view.zoom;
    const left = view.camera.x - view.width / (2 * view.zoom);
    const top = view.camera.y - view.height / (2 * view.zoom);
    const right = left + view.width / view.zoom, bottom = top + view.height / view.zoom;
    let cache = this.terrainCache;
    if (!cache || cache.world !== world || cache.scale !== scale ||
      left < cache.left || top < cache.top || right > cache.right || bottom > cache.bottom) {
      const margin = 192;
      const x = Math.floor((left - margin) * scale) / scale;
      const y = Math.floor((top - margin) * scale) / scale;
      const canvas = cache?.canvas ?? document.createElement('canvas');
      const width = Math.ceil((view.width / view.zoom + margin * 2) * scale) + 1;
      const height = Math.ceil((view.height / view.zoom + margin * 2) * scale) + 1;
      const dx = cache ? Math.round((cache.left - x) * scale) : 0;
      const dy = cache ? Math.round((cache.top - y) * scale) : 0;
      const reuse = cache?.world === world && cache.scale === scale &&
        canvas.width === width && canvas.height === height && Math.abs(dx) < width && Math.abs(dy) < height;
      if (!cache) canvas.addEventListener('contextrestored', () => {
        if (this.terrainCache?.canvas === canvas) this.terrainCache = undefined;
      });
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
          left: x + strip.left / scale - 100,
          top: y + strip.top / scale - 100,
          right: x + strip.right / scale + 100,
          bottom: y + strip.bottom / scale + 100,
        });
        ctx.restore();
      }
      this.terrainCache = cache;
    }
    this.ctx.drawImage(cache.canvas, cache.left, cache.top, cache.canvas.width / scale, cache.canvas.height / scale);
  }
  drawTerrain(world: World, time: number, ctx: CanvasRenderingContext2D, bounds: RenderBounds): void {
    const waterPlants: { x: number; y: number; variation: number; shore: number }[] = [];
    const transform = ctx.getTransform();
    type SurfaceKind = 'grass' | 'path' | 'mud' | 'stone' | 'water' | 'snow' | 'ice';
    const scenery = (tile: TileKind) => tile === 'rock' || tile === 'bush';

    const rawSurfaceAt = (tx: number, ty: number): SurfaceKind | null => {
      if (this.outsideLocalMap(tx, ty)) return null;
      if (world.mode === 'arena' && (tx < -10 || tx > 9 || ty < -8 || ty > 7)) return null;
      const tile = world.getTile(tx, ty);
      if (scenery(tile)) return null;
      const dungeon = world.mode === 'world' ? this.dungeonAt(tx, ty) : undefined;
      if (dungeon && tile === dungeon.layout.floor) return 'stone';
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
      return TERRAIN[surface];
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

    for (let cy = Math.floor(bounds.top / CHUNK_SIZE); cy <= Math.floor(bounds.bottom / CHUNK_SIZE); cy++) {
      for (let cx = Math.floor(bounds.left / CHUNK_SIZE); cx <= Math.floor(bounds.right / CHUNK_SIZE); cx++) {
        world.getChunk(cx, cy);
      }
    }

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

        if (tile === 'water') {
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
    this.environmentArt.paintWater(ctx, bounds, world);
    for (const plant of waterPlants) {
      this.environmentArt.drawWaterPlants(ctx, plant.x, plant.y, plant.variation, plant.shore);
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
    const shore = shorelineMask((nx, ny) => world.getTile(nx, ny), tx, ty);
    this.environmentArt.draw(ctx, 'water', x, y, noise(tx, ty), shore);
    return shore;
  }
}
