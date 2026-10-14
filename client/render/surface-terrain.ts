import { TILE_SIZE } from '../../shared/config';
import type { Vec2 } from '../../shared/types';
import type { World } from '../../shared/world';
import { BASE_SURFACE, ELEVATION_STEP, MAX_ELEVATION, surfaceKey, type SurfaceCell } from '../../shared/world-surfaces';
import type { RenderBounds } from './render-types';
import { TerrainMaterials, WALL_COLORS, MATERIAL_PRIORITY } from './terrain-materials';
import { EnvironmentArt, paintWaterBank, type WaterBankStyle } from './environment-art';
import { connectedShore, curvePath, type ShoreCurve, type ShoreTile } from './water-shore';
import { noise } from './render-primitives';
import { NaturalTerrainEdges, SOFT_PATH_CORNER } from './natural-terrain-edges';
import { legacyRockInWater } from './legacy-water-rocks';
import { legacySceneryGround } from './scenery-ground';
import { paintPathEdges, DEFAULT_PATH_EDGE_STYLE, type PathEdgeStyle } from './path-terrain-edges';
import { RockCliffArt } from './rock-cliff-art';
import { authoredRockStairGeometry, authoredStairWallOpening, rockStairGeometry, rockWallOpenings, stairEndpointMouth } from './rock-cliff-geometry';
import { WallSpriteArt, type WallFaceTerminals } from './wall-sprite-art';
import { stairLanes, stairLinks, stairPath } from '../../shared/surface-stairs';
import { BridgeArt } from './bridge-art';
import { surfaceContour, traceContour, type SurfaceContour, type ContourPoint } from './surface-contours';
import { fillTerrainPaths, fillTerrainRect } from './terrain-fill';

export interface TerrainLevel { elevation: number; cells: SurfaceCell[]; }
function visibleSurface(world: World, tx: number, ty: number, surfaceId = BASE_SURFACE): SurfaceCell | undefined {
  const authored = world.surfaceIndex.at(tx, ty, surfaceId);
  if (authored) return authored;
  if (surfaceId !== BASE_SURFACE) return undefined;
  const tile = world.getTile(tx, ty);
  return { x: tx, y: ty, surfaceId, elevation: 0, material: tile === 'rock' && legacyRockInWater(world, tx, ty) ? 'water' : tile, wallMaterial: 'earth', kind: 'ground' };
}

function bankGroundMaterial(world: World, cell: SurfaceCell | undefined, surfaceId: string) {
  // A zero-height legacy rock is painted as scenery over inferred ground,
  // including redundant surface metadata. Authored mineral tops stay mineral.
  return cell?.material === 'rock' && surfaceId === BASE_SURFACE && cell.kind === 'ground' && cell.elevation === 0
    && world.getTile(cell.x,cell.y) === 'rock' ? legacySceneryGround(world,cell.x,cell.y) : cell?.material;
}

/** Elevated surfaces use the same geometry and material painter in the game and both editors. */
export class SurfaceTerrain {
  pathEdgeStyle: PathEdgeStyle = DEFAULT_PATH_EDGE_STYLE;
  readonly rockArt = new RockCliffArt();
  readonly wallArt: WallSpriteArt;
  readonly bridgeArt: BridgeArt;
  private readonly naturalEdges = new NaturalTerrainEdges();
  private cachedLevels?: { world: World; key: string; levels: TerrainLevel[] };
  private cachedContours?: { world: World; revision: number; cells: WeakMap<SurfaceCell, SurfaceContour | undefined> };
  private cachedOpenings?: { world: World; revision: number; cells: Map<string, { x: number; width: number }[]>;
    mouths: Map<string, ContourPoint[][]>; owned: Set<string> };
  constructor(private readonly materials: TerrainMaterials, private readonly art: EnvironmentArt, wallArt = new WallSpriteArt()) {
    this.bridgeArt = new BridgeArt(materials); this.wallArt = wallArt;
  }
  private accessGeometry(world: World): NonNullable<SurfaceTerrain['cachedOpenings']> {
    if (!this.cachedOpenings || this.cachedOpenings.world !== world || this.cachedOpenings.revision !== world.authoringRevision) {
      const cells = new Map<string, { x: number; width: number }[]>();
      const mouths = new Map<string, ContourPoint[][]>();
      const lookup = (p: { x: number; y: number; surfaceId: string }) => visibleSurface(world, p.x, p.y, p.surfaceId);
      const addMouth = (low: SurfaceCell, high: SurfaceCell, cell: SurfaceCell, width: number) => {
        const mouth = stairEndpointMouth(low, high, cell, width, false); if (!mouth) return;
        const key = surfaceKey(cell.x, cell.y, cell.surfaceId); mouths.set(key, [...mouths.get(key) ?? [], mouth]);
      };
      const owned = new Set(world.surfaceIndex.stairs.flatMap(stair => stairLinks(stair).map(link => link.id)));
      for (const link of [...world.authoring.document.surfaceLinks ?? [], ...world.dungeons.flatMap(d => d.surfaceLinks ?? [])]) {
        if (owned.has(link.id) || link.kind === 'bridge-entry') continue;
        const from = lookup(link.from), to = lookup(link.to); if (!from || !to) continue;
        const [low, high] = from.elevation < to.elevation ? [from, to] : [to, from];
        addMouth(low, high, from, TILE_SIZE); addMouth(low, high, to, TILE_SIZE);
        const opening = rockWallOpenings(high, [link], lookup, !!high.wallSkin);
        if (opening.length) { const key = surfaceKey(high.x, high.y, high.surfaceId); cells.set(key, [...cells.get(key) ?? [], ...opening]); }
      }
      for (const stair of world.surfaceIndex.stairs) {
        const { low, high } = authoredRockStairGeometry(stair, false);
        for (const lane of stairLanes(stair)) {
          const path = stairPath(stair, lane);
          for (const endpoint of [path[0], path.at(-1)!]) {
            const bank = lookup(endpoint); if (!bank) continue;
            addMouth(low, high, bank, stair.width);
            const opening = authoredStairWallOpening(stair, bank);
            if (opening) { const key = surfaceKey(bank.x, bank.y, bank.surfaceId); cells.set(key, [...cells.get(key) ?? [], opening]); }
          }
        }
      }
      this.cachedOpenings = { world, revision: world.authoringRevision, cells, mouths, owned };
    }
    return this.cachedOpenings;
  }
  private wallOpenings(world: World, cell: SurfaceCell): { x: number; width: number }[] {
    return this.accessGeometry(world).cells.get(surfaceKey(cell.x, cell.y, cell.surfaceId)) ?? [];
  }
  private clipAccessMouths(ctx: CanvasRenderingContext2D, world: World, cell: SurfaceCell, lift: number,
    bounds?: { x: number; y: number; width: number; height: number }): void {
    const mouths = this.accessGeometry(world).mouths.get(surfaceKey(cell.x, cell.y, cell.surfaceId)) ?? [];
    // Subtract separately so overlapping accesses stay open instead of cancelling an even-odd hole.
    for (const mouth of mouths) {
      ctx.beginPath();
      const region = bounds ?? { x: cell.x * TILE_SIZE - 512, y: cell.y * TILE_SIZE - lift - 512, width: TILE_SIZE + 1024, height: TILE_SIZE + 1024 };
      ctx.rect(region.x, region.y, region.width, region.height);
      mouth.forEach((p, i) => i ? ctx.lineTo(p.x, p.y - lift) : ctx.moveTo(p.x, p.y - lift));
      ctx.closePath(); ctx.clip('evenodd');
    }
  }
  /** Exterior grid modules can overlap a neighboring access, including its lower face. */
  private clipGridAccessMouths(ctx: CanvasRenderingContext2D, world: World, cell: SurfaceCell, projectElevation: boolean): void {
    const lift = projectElevation ? cell.elevation * ELEVATION_STEP : 0;
    const bounds = { x: cell.x * TILE_SIZE - 512, y: cell.y * TILE_SIZE - lift - 512,
      width: TILE_SIZE + 1024, height: TILE_SIZE + 1024 };
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const neighbor = visibleSurface(world, cell.x + dx, cell.y + dy, cell.surfaceId); if (!neighbor) continue;
      const neighborLift = projectElevation ? neighbor.elevation * ELEVATION_STEP : 0;
      this.clipAccessMouths(ctx, world, neighbor, neighborLift, bounds);
      const south = visibleSurface(world, neighbor.x, neighbor.y + 1, neighbor.surfaceId);
      const height = Math.max(0, neighbor.elevation - (south?.elevation ?? 0)) * ELEVATION_STEP;
      if (!height) continue;
      for (const opening of this.wallOpenings(world, neighbor)) {
        ctx.beginPath(); ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
        ctx.rect(neighbor.x * TILE_SIZE + opening.x, neighbor.y * TILE_SIZE - neighborLift + TILE_SIZE - 13,
          opening.width, height + 31); ctx.clip('evenodd');
      }
    }
  }
  /** A southern top at this level occludes a front that projects across a low gap. */
  private clipGridFrontTops(ctx: CanvasRenderingContext2D, world: World, cell: SurfaceCell, lift: number, height: number): void {
    const x = cell.x * TILE_SIZE, y = cell.y * TILE_SIZE - lift;
    const bounds = { x: x - 96, y: y - 96, width: TILE_SIZE + 192, height: TILE_SIZE + height + 192 };
    for (let dy = 1; dy <= Math.ceil(height / TILE_SIZE) + 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const neighbor = visibleSurface(world, cell.x + dx, cell.y + dy, cell.surfaceId);
      if (!neighbor || neighbor.kind !== 'ground' || neighbor.elevation !== cell.elevation) continue;
      const ny = neighbor.y * TILE_SIZE - lift; if (ny >= y + TILE_SIZE + height) continue;
      const contour = this.cachedContours?.cells.get(neighbor) ?? surfaceContour(neighbor,
        (ox, oy) => visibleSurface(world, neighbor.x + ox, neighbor.y + oy, neighbor.surfaceId));
      const outline = contour?.outline ?? [{ x: 0, y: 0 }, { x: TILE_SIZE, y: 0 },
        { x: TILE_SIZE, y: TILE_SIZE }, { x: 0, y: TILE_SIZE }];
      for (const points of [outline, ...contour?.inlets.map(inlet => inlet.outline) ?? []]) {
        ctx.beginPath(); ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
        points.forEach((point, index) => index ? ctx.lineTo(neighbor.x * TILE_SIZE + point.x, ny + point.y)
          : ctx.moveTo(neighbor.x * TILE_SIZE + point.x, ny + point.y));
        ctx.closePath(); ctx.clip('evenodd');
      }
    }
  }
  private clipBridgeAccessMouths(ctx: CanvasRenderingContext2D, world: World, level: TerrainLevel, lift: number): void {
    const deck = level.cells.filter(cell => cell.kind === 'bridge'); if (!deck.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const cell of deck) { minX = Math.min(minX, cell.x); minY = Math.min(minY, cell.y); maxX = Math.max(maxX, cell.x); maxY = Math.max(maxY, cell.y); }
    const left = minX * TILE_SIZE - 64, top = minY * TILE_SIZE - lift - 64;
    const right = (maxX + 1) * TILE_SIZE + 64, bottom = (maxY + 1) * TILE_SIZE - lift + 64;
    const bounds = { x: left, y: top, width: right - left, height: bottom - top };
    for (const cell of deck) this.clipAccessMouths(ctx, world, cell, lift, bounds);
  }
  levels(world: World, bounds: RenderBounds, kind?: SurfaceCell['kind']): TerrainLevel[] {
    const key = `${world.authoringRevision}:${Math.floor(bounds.left / TILE_SIZE)}:${Math.floor(bounds.top / TILE_SIZE)}:${Math.ceil(bounds.right / TILE_SIZE)}:${Math.ceil(bounds.bottom / TILE_SIZE)}`;
    if (this.cachedLevels?.world === world && this.cachedLevels.key === key) return kind
      ? this.cachedLevels.levels.map(level => ({ ...level, cells: level.cells.filter(cell => cell.kind === kind) })).filter(level => level.cells.length)
      : this.cachedLevels.levels;
    const levels = new Map<number, SurfaceCell[]>();
    const margin = ELEVATION_STEP * MAX_ELEVATION;
    const minTx = Math.floor(bounds.left / TILE_SIZE), maxTx = Math.ceil(bounds.right / TILE_SIZE);
    const minTy = Math.floor(bounds.top / TILE_SIZE), maxTy = Math.ceil((bounds.bottom + margin) / TILE_SIZE);
    const seen = new Set<string>();
    // At overview zoom the viewport can span millions of empty tiles. Surfaces
    // are sparse, so inspect authored cells rather than every viewport column.
    for (const authored of [world.authoring.document.surfaceCells ?? [], ...world.dungeons.map(d => d.surfaceCells ?? [])]) {
      for (const candidate of authored) {
        if (candidate.x < minTx || candidate.x > maxTx || candidate.y < minTy || candidate.y > maxTy) continue;
        const key = surfaceKey(candidate.x, candidate.y, candidate.surfaceId);
        if (seen.has(key)) continue;
        seen.add(key);
        // Dungeon definitions override world metadata in the active index.
        const surface = world.surfaceIndex.at(candidate.x, candidate.y, candidate.surfaceId);
        if (!surface || surface.kind === 'ground' && surface.elevation === 0 && surface.material === world.getTile(surface.x, surface.y)) continue;
        const cells = levels.get(surface.elevation) ?? [];
        cells.push(surface); levels.set(surface.elevation, cells);
      }
    }
    const result = [...levels].map(([elevation, cells]) => ({ elevation, cells })).sort((a, b) => a.elevation - b.elevation);
    this.cachedLevels = { world, key, levels: result };
    return kind ? result.map(level => ({ ...level, cells: level.cells.filter(cell => cell.kind === kind) })).filter(level => level.cells.length) : result;
  }
  drawLevel(ctx: CanvasRenderingContext2D, world: World, level: TerrainLevel, time: number,
    viewers: readonly Vec2[] = [], projectElevation = true): void {
    this.drawGroundLevel(ctx, world, level, projectElevation);
    this.drawBridgeLevel(ctx, world, level, time, viewers, projectElevation);
  }
  drawGroundLevel(ctx: CanvasRenderingContext2D, world: World, level: TerrainLevel, projectElevation = true): void {
    const lift = projectElevation ? level.elevation * ELEVATION_STEP : 0;
    // Stair supports are painted once as their complete structure; bridges own their union contour.
    const cells = level.cells.filter(cell => cell.kind === 'ground').sort((a, b) => a.y - b.y || a.x - b.x);
    if (this.cachedContours?.world !== world || this.cachedContours.revision !== world.authoringRevision) {
      this.cachedContours = { world, revision: world.authoringRevision, cells: new WeakMap() };
    }
    const contourCache = this.cachedContours.cells;
    const contours = new Map(cells.map(cell => {
      if (!contourCache.has(cell)) contourCache.set(cell, surfaceContour(cell,
        (dx, dy) => visibleSurface(world, cell.x + dx, cell.y + dy, cell.surfaceId)));
      return [cell, contourCache.get(cell)] as const;
    }));
    // Faces precede all tops, including the little round fills at inward corners.
    for (const cell of cells) {
      const x = cell.x * TILE_SIZE, y = cell.y * TILE_SIZE - lift;
      const contour = contours.get(cell), grid = this.wallArt.isGrid(cell);
      if (grid) {
        ctx.save(); this.clipGridAccessMouths(ctx, world, cell, projectElevation);
        for (const [side, dx] of [['west', -1], ['east', 1]] as const) {
          const lower = visibleSurface(world, cell.x + dx, cell.y, cell.surfaceId);
          const height = Math.max(0, cell.elevation - (lower?.elevation ?? 0)) * ELEVATION_STEP;
          if (height) this.wallArt.paintFlank(ctx, cell, contour?.edges[side] ?? (side === 'west'
            ? [{ x: 0, y: TILE_SIZE }, { x: 0, y: 0 }]
            : [{ x: TILE_SIZE, y: 0 }, { x: TILE_SIZE, y: TILE_SIZE }]), x, y, height, side, contour);
        }
        ctx.restore(); continue;
      }
      if (cell.kind === 'ground') {
        const south = visibleSurface(world, cell.x, cell.y + 1);
        const drop = Math.max(0, cell.elevation - (south?.elevation ?? 0)) * ELEVATION_STEP;
        const damp = world.getMoisture((cell.x + .5) * TILE_SIZE, (cell.y + .5) * TILE_SIZE) > .6
          || [[0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => visibleSurface(world, cell.x + dx, cell.y + dy)?.material === 'water');
        if (drop && !grid) {
          const openings = this.wallOpenings(world, cell);
          if (contour) this.drawContourWall(ctx, cell, contour.southFace, x, y, drop, lift, damp, openings, contour);
          else {
            const below = (dx: number, dy: number) => (visibleSurface(world, cell.x + dx, cell.y + dy, cell.surfaceId)?.elevation ?? 0) < cell.elevation;
            this.drawWall(ctx, cell, x, y + TILE_SIZE, drop, lift, damp, openings,
              { left: below(-1, 0) && below(-1, 1), right: below(1, 0) && below(1, 1),
                innerLeft: !below(-1, 0) && !below(-1, 1), innerRight: !below(1, 0) && !below(1, 1) });
          }
        }
        if (!grid && ((contour && cell.wallMaterial === 'rock') || this.wallArt.kit(cell))) for (const [side, dx] of [['west', -1], ['east', 1]] as const) {
          const lower = visibleSurface(world, cell.x + dx, cell.y, cell.surfaceId);
          if (contour ? !contour.exposed[side] : (lower?.elevation ?? 0) >= cell.elevation) continue;
          const points = contour?.edges[side] ?? (side === 'west'
            ? [{ x: 0, y: TILE_SIZE }, { x: 0, y: 0 }]
            : [{ x: TILE_SIZE, y: 0 }, { x: TILE_SIZE, y: TILE_SIZE }]);
          ctx.save(); this.clipAccessMouths(ctx, world, cell, lift);
          if (contour) this.rockArt.paintFlank(ctx, cell, points, x, y, (cell.elevation - (lower?.elevation ?? 0)) * ELEVATION_STEP, side);
          this.wallArt.paintFlank(ctx, cell, points, x, y,
            (cell.elevation - (lower?.elevation ?? 0)) * ELEVATION_STEP, side, contour);
          ctx.restore();
        }
      }
    }
    // Inner returns occupy the joined vertex of two faces. Paint them after both
    // neighbors so their corner module cannot be overwritten by the next front tile.
    for (const cell of cells) {
      const contour = contours.get(cell); if (!contour?.inlets.length || this.wallArt.isGrid(cell)) continue;
      const x = cell.x * TILE_SIZE, y = cell.y * TILE_SIZE - lift;
      const damp = world.getMoisture((cell.x + .5) * TILE_SIZE, (cell.y + .5) * TILE_SIZE) > .6;
      ctx.save(); this.clipAccessMouths(ctx, world, cell, lift);
      for (const inlet of contour.inlets) this.drawContourWall(ctx, cell, inlet.rim, x, y,
        (cell.elevation - inlet.lowerElevation) * ELEVATION_STEP, lift, damp, [], undefined,
        inlet.rim.some(p => p.x < 0) ? 'left' : 'right');
      ctx.restore();
    }
    for (const cell of cells) {
      const x = cell.x * TILE_SIZE, y = cell.y * TILE_SIZE - lift, contour = contours.get(cell);
      const neighbor = (dx: number, dy: number) => visibleSurface(world, cell.x + dx, cell.y + dy, cell.surfaceId);
      ctx.save();
      if (contour) {
        const shared = (dx: number, dy: number) => {
          const n = neighbor(dx, dy); return n?.kind === 'ground' && n.elevation === cell.elevation;
        };
        const t = ctx.getTransform(), bleedX = 1 / (Math.hypot(t.a, t.b) || 1), bleedY = 1 / (Math.hypot(t.c, t.d) || 1);
        const west = shared(-1, 0), east = shared(1, 0), north = shared(0, -1), south = shared(0, 1);
        // Extend only internal joins by one device pixel; keep cliffs and river silhouettes intact.
        const outline = contour.outline.map(p => ({
          x: p.x + (west && Math.abs(p.x) < .001 ? -bleedX : east && Math.abs(p.x - TILE_SIZE) < .001 ? bleedX : 0),
          y: p.y + (north && Math.abs(p.y) < .001 ? -bleedY : south && Math.abs(p.y - TILE_SIZE) < .001 ? bleedY : 0),
        }));
        traceContour(ctx, outline, x, y, true); ctx.clip();
      }
      const moisture = world.getMoisture(x + TILE_SIZE / 2, cell.y * TILE_SIZE + TILE_SIZE / 2);
      const color = this.materials.color(cell.material, moisture, world.getTemperature(cell.x, cell.y));
      ctx.fillStyle = this.materials.fill(ctx, cell.material, color, lift);
      if (cell.material === 'water') {
        const backing = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => neighbor(dx, dy)).find(n => n && n.material !== 'water' && n.elevation === cell.elevation);
        if (backing) ctx.fillStyle = this.materials.fill(ctx, backing.material, this.materials.color(backing.material, moisture, world.getTemperature(backing.x, backing.y)), lift);
      }
      fillTerrainRect(ctx, x, y, TILE_SIZE, TILE_SIZE);
      if (cell.material === 'water') {
        this.art.draw(ctx, 'water', x, y, noise(cell.x, cell.y), 0);
        this.drawWaterBorders(ctx, world, cell.x, cell.y, x, y, cell.surfaceId, lift);
      } else {
        this.art.paintGround(ctx, cell.material === 'stone' || cell.material === 'brick' ? 'path'
          : cell.material === 'sand' || cell.material === 'wood' ? 'mud' : cell.material, x, y, cell.material === 'stone',moisture,world.getTemperature(cell.x,cell.y)<.32,cell.y*TILE_SIZE);
      }
      ctx.save(); this.clipAccessMouths(ctx, world, cell, lift);
      for (const [dx, dy, edge] of [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']] as const) {
        if (contour) continue;
        const n = neighbor(dx, dy);
        if (n && n.elevation === cell.elevation) continue;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = edge === 'north' ? '#e7e3b560' : '#4e58496e';
        const ax = x + (edge === 'east' ? TILE_SIZE - 1 : 1), ay = y + (edge === 'south' ? TILE_SIZE - 1 : 1);
        ctx.beginPath(); ctx.moveTo(ax, ay);
        ctx.lineTo(edge === 'north' || edge === 'south' ? x + TILE_SIZE : ax, edge === 'east' || edge === 'west' ? y + TILE_SIZE : ay);
        ctx.stroke();
      }
      this.drawMaterialEdges(ctx, world, cell, x, y, lift);
      ctx.restore();
      ctx.restore();
      if (contour && !this.wallArt.isGrid(cell)) {
        ctx.save(); this.clipAccessMouths(ctx, world, cell, lift);
        this.drawContourRim(ctx, contour, x, y); this.rockArt.paintRim(ctx, cell, contour, x, y);
        this.wallArt.paintRim(ctx, cell, contour, x, y); ctx.restore();
      } else if (!this.wallArt.isGrid(cell) && cell.elevation > 0) {
        ctx.save(); this.clipAccessMouths(ctx, world, cell, lift);
        this.wallArt.paintFlatRim(ctx, cell, x, y,
          (neighbor(0, 1)?.elevation ?? 0) < cell.elevation, (neighbor(0, -1)?.elevation ?? 0) < cell.elevation);
        ctx.restore();
      }
    }
    for (const cell of cells) {
      const contour = contours.get(cell); if (!contour?.inlets.length) continue;
      const x = cell.x * TILE_SIZE, y = cell.y * TILE_SIZE - lift;
      const moisture = world.getMoisture(x + TILE_SIZE / 2, cell.y * TILE_SIZE + TILE_SIZE / 2);
      ctx.save();
      ctx.fillStyle = this.materials.fill(ctx, cell.material, this.materials.color(cell.material, moisture, world.getTemperature(cell.x, cell.y)), lift);
      for (const inlet of contour.inlets) {
        traceContour(ctx, inlet.outline, x, y, true); ctx.fill();
        if (!this.wallArt.isGrid(cell)) {
          ctx.strokeStyle = '#4e58496e'; ctx.lineWidth = 1.3; traceContour(ctx, inlet.rim, x, y); ctx.stroke();
        }
      }
      ctx.restore();
    }
    // Fronts and rims retain their slight overlap after tops have settled. Side
    // extrusions precede the tops so concave return terraces naturally occlude them.
    const gridCells = cells.filter(cell => this.wallArt.isGrid(cell));
    for (const layer of ['faces', 'rims'] as const) for (const cell of gridCells) {
      const x = cell.x * TILE_SIZE, y = cell.y * TILE_SIZE - lift, contour = contours.get(cell);
      const neighbor = (dx: number, dy: number) => visibleSurface(world, cell.x + dx, cell.y + dy, cell.surfaceId);
      ctx.save(); this.clipGridAccessMouths(ctx, world, cell, projectElevation);
      if (layer === 'faces') {
        const south = neighbor(0, 1), height = Math.max(0, cell.elevation - (south?.elevation ?? 0)) * ELEVATION_STEP;
        if (height) {
          this.clipGridFrontTops(ctx, world, cell, lift, height);
          const openings = this.wallOpenings(world, cell);
          if (contour) this.drawContourWall(ctx, cell, [{ x: 0, y: TILE_SIZE }, { x: TILE_SIZE, y: TILE_SIZE }],
            x, y, height, lift, false, openings, contour);
          else {
            const below = (dx: number, dy: number) => (neighbor(dx, dy)?.elevation ?? 0) < cell.elevation;
            this.drawWall(ctx, cell, x, y + TILE_SIZE, height, lift, false, openings,
              { left: below(-1, 0) && below(-1, 1), right: below(1, 0) && below(1, 1) });
          }
        }
      } else if (contour) this.wallArt.paintRim(ctx, cell, contour, x, y);
      else this.wallArt.paintFlatRim(ctx, cell, x, y,
        (neighbor(0, 1)?.elevation ?? 0) < cell.elevation, (neighbor(0, -1)?.elevation ?? 0) < cell.elevation);
      ctx.restore();
    }
    const waterCurves = new Map<string, Map<string, (ShoreCurve | undefined)[]>>();
    for (const id of new Set(cells.filter(cell => cell.material === 'water').map(cell => cell.surfaceId))) {
      ctx.save();
      waterCurves.set(id, this.drawConnectedWaterBanks(ctx, world, cells.filter(cell => cell.material === 'water' && cell.surfaceId === id), id, lift, undefined, level.elevation));
      ctx.restore();
    }
    if(this.pathEdgeStyle!=='current')for(const id of new Set(cells.filter(cell=>cell.material==='path').map(cell=>cell.surfaceId))) {
      paintPathEdges(ctx,cells.filter(cell=>cell.material==='path' && cell.surfaceId===id),
        (x,y)=>{const cell=visibleSurface(world,x,y,id);return cell?{material:bankGroundMaterial(world,cell,id) ?? cell.material,elevation:cell.elevation}:undefined;},
        (x,y)=>this.materials.fill(ctx,'grass',this.materials.color('grass',world.getMoisture((x+.5)*TILE_SIZE,(y+.5)*TILE_SIZE),world.getTemperature(x,y)),lift),
        this.pathEdgeStyle,lift,
        (x,y,corner,curve)=>this.naturalEdges.path(ctx,x,y,corner,curve,world.getMoisture((x+.5)*TILE_SIZE,(y+.5)*TILE_SIZE),world.getTemperature(x,y)<.32));
    }
    // Edge plants can extend onto an adjacent cell; paint them after every top has been filled.
    for (const cell of cells) {
      const x = cell.x * TILE_SIZE, y = cell.y * TILE_SIZE - lift;
      ctx.save();
      this.clipAccessMouths(ctx, world, cell, lift);
      if (cell.material === 'water') this.drawNaturalWaterBanks(ctx, world, cell.x, cell.y, x, y, cell.surfaceId, lift,
        waterCurves.get(cell.surfaceId)?.get(`${cell.x},${cell.y}`));
      else this.drawNaturalLandEdges(ctx, world, cell, x, y, lift, contours.get(cell));
      ctx.restore();
    }
  }
  drawBridgeLevel(ctx: CanvasRenderingContext2D, world: World, level: TerrainLevel, time: number,
    viewers: readonly Vec2[] = [], projectElevation = true): void {
    this.bridgeArt.drawBase(ctx, world, level, time, viewers, projectElevation,
      paint => this.clipBridgeAccessMouths(paint, world, level, projectElevation ? level.elevation * ELEVATION_STEP : 0));
  }
  drawForeground(ctx: CanvasRenderingContext2D, world: World, level: TerrainLevel, time: number,
    viewers: readonly Vec2[] = [], projectElevation = true): void {
    this.bridgeArt.drawForeground(ctx, world, level, time, viewers, projectElevation,
      paint => this.clipBridgeAccessMouths(paint, world, level, projectElevation ? level.elevation * ELEVATION_STEP : 0));
  }
  waterPlantsMask(world: World, tx: number, ty: number, mask: number, surfaceId = BASE_SURFACE): number {
    const offsets = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
    // Frozen banks are mineral transitions; no reeds or lily pads at this contact.
    return offsets.some(([dx, dy]) => {
      const n = visibleSurface(world, tx + dx, ty + dy, surfaceId);
      return n?.material === 'ice' || n?.material === 'snow';
    }) ? 0 : mask;
  }
  waterEdges(world: World, tx: number, ty: number, surfaceId = BASE_SURFACE): { mask: number; banks: WaterBankStyle[] } {
    const water = visibleSurface(world, tx, ty, surfaceId)!;
    const neighbors = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([dx, dy]) => visibleSurface(world, tx + dx, ty + dy, surfaceId));
    const hard = (n?: SurfaceCell) => n && (n.elevation !== water.elevation || ['brick', 'stone', 'wood'].includes(n.material) || ['brick', 'stone'].includes(n.wallMaterial));
    let mask = neighbors.reduce((value, n, index) => value | (!n || n.material !== 'water' ? 1 << index : 0), 0);
    for (let i = 0; i < 4; i++) if (hard(neighbors[i])) mask &= ~(1 << i);
    for (let i = 4; i < 8; i++) if (hard(neighbors[i]) || hard(neighbors[(i - 4) % 4]) || hard(neighbors[(i - 3) % 4])) mask &= ~(1 << i);
    const palette = (material?: string): WaterBankStyle => material === 'grass' || material === 'bush' ? { edge: '#c2aa72', highlight: '#e4d39d', kind: 'raised' }
      : material === 'rock' ? { edge: '#72858a', highlight: '#a3b7b1', kind: 'rock' }
      : material === 'mud' ? { edge: '#787557', highlight: '#aba282', kind: 'slope' }
      : material === 'snow' || material === 'ice' ? { edge: '#a6cdd4', highlight: '#edf7fa', kind: 'frozen' }
      : { edge: '#a4916a', highlight: '#c9b589', kind: 'slope' };
    const banks = Array.from({ length: 4 }, (_, corner) => {
      const previous = (corner + 3) % 4;
      const index = mask & (1 << corner) ? corner : mask & (1 << previous) ? previous : 4 + previous;
      return palette(bankGroundMaterial(world,neighbors[index],surfaceId));
    });
    return { mask, banks };
  }
  drawWaterBorders(ctx: CanvasRenderingContext2D, world: World, tx: number, ty: number, x: number, y: number, surfaceId = BASE_SURFACE, lift = 0): void {
    const water = visibleSurface(world, tx, ty, surfaceId);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const n = visibleSurface(world, tx + dx, ty + dy, surfaceId);
      if (!n || n.material === 'water') continue;
      const cliff = n.elevation > (water?.elevation ?? 0);
      const constructed = n.material === 'brick' || n.material === 'stone' || n.material === 'wood' || n.wallMaterial === 'brick' || n.wallMaterial === 'stone';
      if (!cliff && (!constructed || n.elevation !== water?.elevation)) continue;
      const thickness = 5;
      const bx = x + (dx === 1 ? TILE_SIZE - thickness : 0), by = y + (dy === 1 ? TILE_SIZE - thickness : 0);
      ctx.save(); ctx.fillStyle = this.materials.fill(ctx, n.wallMaterial, WALL_COLORS[n.wallMaterial], lift);
      ctx.fillRect(bx, by, dx ? thickness : TILE_SIZE, dy ? thickness : TILE_SIZE);
      ctx.strokeStyle = '#253d3c80'; ctx.lineWidth = 1; ctx.beginPath();
      if (dx) { const edge = bx + (dx === 1 ? 0 : thickness); ctx.moveTo(edge, y); ctx.lineTo(edge, y + TILE_SIZE); }
      else { const edge = by + (dy === 1 ? 0 : thickness); ctx.moveTo(x, edge); ctx.lineTo(x + TILE_SIZE, edge); }
      ctx.stroke(); ctx.restore();
    }
  }
  /** Water is filled first. Carve the connected land silhouette and stroke its complete rim after all tiles. */
  drawConnectedWaterBanks(ctx: CanvasRenderingContext2D, world: World, cells: readonly { x: number; y: number }[],
    surfaceId = BASE_SURFACE, lift = 0, backing?: (tx: number, ty: number, corner: number, mask: number) => string | CanvasPattern,
    elevation?: number): Map<string, (ShoreCurve | undefined)[]> {
    const requested = new Set(cells.map(cell => `${cell.x},${cell.y}`)), inspected = new Set<string>();
    const tiles: ShoreTile[] = [], edges = new Map<string, ReturnType<SurfaceTerrain['waterEdges']>>();
    for (const cell of cells) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = cell.x + dx, y = cell.y + dy, key = `${x},${y}`;
      if (inspected.has(key)) continue; inspected.add(key);
      const surface = visibleSurface(world, x, y, surfaceId);
      if (surface?.material !== 'water' || elevation !== undefined && surface.elevation !== elevation) continue;
      const edge = this.waterEdges(world, x, y, surfaceId); edges.set(key, edge);
      if (edge.mask) tiles.push({ x, y, mask: edge.mask, variation: Math.floor(noise(x, y) * 6) / 5 });
    }
    const result = new Map<string, (ShoreCurve | undefined)[]>();
    const paths = new Map<string, { path: Path2D; style: WaterBankStyle; curves: ShoreCurve[] }>();
    const fills = new Map<string | CanvasPattern, Path2D>();
    for (const segment of connectedShore(tiles)) {
      const key = `${segment.x},${segment.y}`; if (!requested.has(key)) continue;
      const edge = edges.get(key)!, style = edge.banks[segment.corner];
      const move = ([x, y]: [number, number]): [number, number] => [x, y - lift];
      const curve: ShoreCurve = { start: move(segment.curve.start), end: move(segment.curve.end),
        c1: move(segment.curve.c1), c2: move(segment.curve.c2), closure: segment.curve.closure.map(move) };
      let paint: string | CanvasPattern;
      if (backing) paint = backing(segment.x, segment.y, segment.corner, edge.mask);
      else {
        const previous = (segment.corner + 3) % 4;
        const index = edge.mask & (1 << segment.corner) ? segment.corner : edge.mask & (1 << previous) ? previous : 4 + previous;
        const [dx, dy] = [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]][index];
        const land = visibleSurface(world, segment.x + dx, segment.y + dy, surfaceId);
        const material = bankGroundMaterial(world,land,surfaceId) ?? 'grass';
        paint = this.materials.fill(ctx, material, this.materials.color(material,
          world.getMoisture((segment.x + dx + .5) * TILE_SIZE, (segment.y + dy + .5) * TILE_SIZE),
          world.getTemperature(segment.x + dx, segment.y + dy)), lift);
      }
      const fill = fills.get(paint) ?? new Path2D(); fill.addPath(curvePath(curve, true)); fills.set(paint, fill);
      const styleKey = `${style.kind}:${style.edge}:${style.highlight}`;
      let group = paths.get(styleKey);
      if (!group) { group = { path: new Path2D(), style, curves: [] }; paths.set(styleKey, group); }
      group.path.addPath(curvePath(curve));
      group.curves.push(curve);
      const local = ([x, y]: [number, number]): [number, number] => [x - segment.x * TILE_SIZE, y - segment.y * TILE_SIZE];
      const curves = result.get(key) ?? [];
      curves[segment.corner] = { start: local(segment.curve.start), end: local(segment.curve.end),
        c1: local(segment.curve.c1), c2: local(segment.curve.c2), closure: segment.curve.closure.map(local) };
      result.set(key, curves);
    }
    fillTerrainPaths(ctx, fills);
    for (const { path, style, curves } of paths.values()) paintWaterBank(ctx, path, style, curves, lift);
    return result;
  }
  drawNaturalWaterBanks(ctx: CanvasRenderingContext2D, world: World, tx: number, ty: number, x: number, y: number, surfaceId = BASE_SURFACE, _lift = 0,
    curves?: readonly (ShoreCurve | undefined)[]): void {
    const edges = this.waterEdges(world, tx, ty, surfaceId);
    const mask = this.waterPlantsMask(world, tx, ty, edges.mask, surfaceId);
    this.naturalEdges.water(ctx, tx, ty, x, y, mask, edges.banks,
      world.getMoisture((tx + .5) * TILE_SIZE, (ty + .5) * TILE_SIZE), world.getTemperature(tx, ty) < .32, curves);
  }
  private drawMaterialEdges(ctx: CanvasRenderingContext2D, world: World, cell: SurfaceCell, x: number, y: number, lift: number): void {
    const corners = [[0, -1, -1, 0, -1, -1], [0, -1, 1, 0, 1, -1], [0, 1, 1, 0, 1, 1], [0, 1, -1, 0, -1, 1]];
    for (const [corner, [ax, ay, bx, by, dx, dy]] of corners.entries()) {
      const a = visibleSurface(world, cell.x + ax, cell.y + ay, cell.surfaceId);
      const b = visibleSurface(world, cell.x + bx, cell.y + by, cell.surfaceId);
      const diagonal = visibleSurface(world, cell.x + dx, cell.y + dy, cell.surfaceId);
      if (!a || !b || !diagonal || [a, b, diagonal].some(n => n.elevation !== cell.elevation || n.material === 'water')) continue;
      const candidates = [cell, a, b, diagonal], distinct = new Set(candidates.map(n => n.material));
      const dominant = distinct.size >= 3 ? [...candidates].sort((u, v) => MATERIAL_PRIORITY[v.material] - MATERIAL_PRIORITY[u.material] || u.material.localeCompare(v.material))[0]
        : a.material === b.material && a.material === diagonal.material ? a : undefined;
      if (!dominant || dominant.material === cell.material) continue;
      const color = this.materials.color(dominant.material, world.getMoisture((dominant.x + .5) * TILE_SIZE, (dominant.y + .5) * TILE_SIZE), world.getTemperature(dominant.x, dominant.y));
      const road = [cell.material,dominant.material].includes('path') && [cell.material,dominant.material].includes('grass');
      if(road && this.pathEdgeStyle!=='current')continue;
      this.art.roundTerrainCorner(ctx, x, y, corner, this.materials.fill(ctx, dominant.material, color, lift), distinct.size >= 3 ? 9 : road ? SOFT_PATH_CORNER : 13);
    }
  }
  private drawNaturalLandEdges(ctx: CanvasRenderingContext2D, world: World, cell: SurfaceCell, x: number, y: number, lift: number, contour?: SurfaceContour): void {
    if (cell.material !== 'grass') return;
    const moisture = world.getMoisture((cell.x + .5) * TILE_SIZE, (cell.y + .5) * TILE_SIZE);
    const cold = world.getTemperature(cell.x, cell.y) < .32;
    const paint = this.materials.fill(ctx, cell.material, this.materials.color(cell.material, moisture, world.getTemperature(cell.x, cell.y)), lift);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const n = visibleSurface(world, cell.x + dx, cell.y + dy, cell.surfaceId);
      const base = { tx: cell.x, ty: cell.y, x, y, direction: [dx, dy] as const, paint, moisture, cold };
      if (n && n.elevation === cell.elevation && ['path', 'mud', 'sand'].includes(n.material)) {
        if(n.material==='path' && this.pathEdgeStyle!=='current')continue;
        const alongX = dy ? 1 : 0, alongY = dx ? 1 : 0;
        const continues = (sign: number) => {
          const grass = visibleSurface(world, cell.x + alongX * sign, cell.y + alongY * sign, cell.surfaceId);
          const land = visibleSurface(world, n.x + alongX * sign, n.y + alongY * sign, cell.surfaceId);
          return grass?.material === 'grass' && grass.elevation === cell.elevation && land?.material === n.material && land.elevation === cell.elevation;
        };
        const corner = n.material === 'path' ? SOFT_PATH_CORNER : 10;
        this.naturalEdges.land(ctx, { ...base, trimStart: continues(-1) ? 0 : corner, trimEnd: continues(1) ? 0 : corner, softRoad: n.material === 'path' });
      } else if (cell.kind === 'ground' && (cell.wallMaterial === 'earth' || cell.wallMaterial === 'rock')
        && (!n || n.elevation < cell.elevation)) {
        if (contour) {
          const edge = dx === 1 ? 'east' : dx === -1 ? 'west' : dy === 1 ? 'south' : 'north';
          const points = contour.edges[edge];
          if (!cold) for (const index of [Math.floor(points.length / 3), Math.floor(points.length * 2 / 3)]) {
            const point = points[index], variation = noise(cell.x, cell.y, index + 523);
            if (variation < .38) continue;
            ctx.strokeStyle = moisture > .55 ? '#7f9b58' : '#91a45d'; ctx.lineWidth = 1.15;
            ctx.beginPath();
            const px = x + point.x - dx, py = y + point.y - dy;
            for (const spread of [-2, 0, 2]) { ctx.moveTo(px, py); ctx.quadraticCurveTo(px + spread, py - 3, px + spread * 1.8, py - 4 - variation * 3); }
            ctx.stroke();
          }
        } else this.naturalEdges.cliff(ctx, { ...base, trimStart: 3, trimEnd: 3 });
      }
    }
  }
  private drawContourRim(ctx: CanvasRenderingContext2D, contour: SurfaceContour, x: number, y: number): void {
    ctx.save(); ctx.lineWidth = 1.3;
    for (const edge of ['north', 'east', 'south', 'west'] as const) {
      if (!contour.exposed[edge]) continue;
      ctx.strokeStyle = edge === 'north' ? '#e7e3b560' : '#4e58496e';
      traceContour(ctx, contour.edges[edge], x, y); ctx.stroke();
    }
    for (let corner = 0; corner < 4; corner++) {
      if (!contour.corners[corner].length) continue;
      ctx.strokeStyle = corner < 2 ? '#e7e3b560' : '#4e58496e';
      traceContour(ctx, contour.corners[corner], x, y); ctx.stroke();
    }
    ctx.restore();
  }
  private drawContourWall(ctx: CanvasRenderingContext2D, cell: SurfaceCell, profile: readonly ContourPoint[], x: number, y: number,
    height: number, lift: number, damp: boolean, openings: readonly { x: number; width: number }[] = [],
    contour?: SurfaceContour, innerCorner?: 'left' | 'right'): void {
    if (height <= 0 || profile.length < 2) return;
    if (this.wallArt.isGrid(cell)) {
      ctx.save();
      for (const opening of openings) {
        ctx.beginPath(); ctx.rect(x - 96, y - 96, TILE_SIZE + 192, TILE_SIZE + height + 192);
        ctx.rect(x + opening.x, y + TILE_SIZE - 13, opening.width, height + 31); ctx.clip('evenodd');
      }
      this.wallArt.paintFace(ctx, cell, profile, x, y, height, contour, innerCorner); ctx.restore(); return;
    }
    ctx.save();
    const polygon = [...profile, ...profile.slice().reverse().map(point => ({ x: point.x, y: point.y + height }))];
    traceContour(ctx, polygon, x, y, true); ctx.clip();
    if (openings.length) {
      ctx.beginPath(); ctx.rect(x - 96, y - 96, TILE_SIZE + 192, TILE_SIZE + height + 192);
      for (const opening of openings) ctx.rect(x + opening.x, y + TILE_SIZE - 13, opening.width, height + 31);
      ctx.clip('evenodd');
    }
    const paintedRock = cell.wallMaterial === 'rock' && this.rockArt.paintFace(ctx, cell, profile, x, y, height);
    if (!paintedRock) {
    ctx.fillStyle = this.materials.fill(ctx, cell.wallMaterial, WALL_COLORS[cell.wallMaterial], lift);
    ctx.fillRect(x - 12, y - 12, TILE_SIZE + 24, TILE_SIZE + height + 24);
    const top = Math.min(...profile.map(point => point.y)), bottom = Math.max(...profile.map(point => point.y)) + height;
    const southRim = profile.every(point => point.y >= TILE_SIZE - 12);
    const shade = ctx.createLinearGradient(0, y + (southRim ? TILE_SIZE - 11 : top), 0, y + (southRim ? TILE_SIZE + height : bottom));
    shade.addColorStop(0, '#18231c10'); shade.addColorStop(1, '#18231c70');
    ctx.fillStyle = shade; ctx.fillRect(x - 12, y + top, TILE_SIZE + 24, bottom - top);
    // Strata share world coordinates, avoiding a new crack pattern at each tile.
    for (let layer = 7; layer < height; layer += 11) {
      ctx.strokeStyle = layer % 2 ? '#dcc9a030' : '#28382b38'; ctx.lineWidth = 1.2; ctx.beginPath();
      for (let offset = -12; offset <= TILE_SIZE + 12; offset += 6) {
        const worldX = x + offset, index = Math.floor(worldX / 12), fraction = worldX / 12 - index;
        const waviness = (noise(index, cell.y, 541 + layer) * (1 - fraction) + noise(index + 1, cell.y, 541 + layer) * fraction) * 4;
        const py = y + TILE_SIZE + layer - waviness;
        if (offset === -12) ctx.moveTo(worldX, py); else ctx.lineTo(worldX, py);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = '#24322750'; ctx.lineWidth = 1;
    for (let i = 0; i < 2; i++) {
      const px = x + 8 + noise(cell.x, cell.y, 563 + i) * 31;
      ctx.beginPath(); ctx.moveTo(px, y + top + 3);
      ctx.lineTo(px - 3, y + top + height * .46); ctx.lineTo(px + 2, y + bottom - 3); ctx.stroke();
    }
    if (damp) for (let i = 0; i < 4; i++) {
      const variation = noise(cell.x, cell.y, 581 + i); if (variation < .3) continue;
      ctx.fillStyle = i % 2 ? '#81975b85' : '#516f4d80'; ctx.beginPath();
      ctx.ellipse(x + 4 + variation * 37, y + bottom - 3 - variation * Math.min(8, height / 3),
        2 + variation * 3, 1 + variation * 1.5, variation * 2, 0, Math.PI * 2); ctx.fill();
    }
    }
    this.wallArt.paintFace(ctx, cell, profile, x, y, height, contour, innerCorner);
    ctx.restore();
    ctx.save();
    for (const opening of openings) {
      ctx.beginPath(); ctx.rect(x - 96, y - 96, TILE_SIZE + 192, TILE_SIZE + height + 192);
      ctx.rect(x + opening.x, y + TILE_SIZE - 13, opening.width, height + 31); ctx.clip('evenodd');
    }
    ctx.strokeStyle = '#16251a25'; ctx.lineWidth = 3;
    traceContour(ctx, profile, x, y + height + 1); ctx.stroke(); ctx.restore();
  }
  private drawWall(ctx: CanvasRenderingContext2D, cell: SurfaceCell, x: number, y: number, height: number, lift: number, damp = false,
    openings: readonly { x: number; width: number }[] = [], terminals?: WallFaceTerminals): void {
    ctx.save();
    for (const opening of openings) {
      ctx.beginPath(); ctx.rect(x - 96, y - 96, TILE_SIZE + 192, height + 192);
      ctx.rect(x + opening.x, y - 13, opening.width, height + 31); ctx.clip('evenodd');
    }
    if (this.wallArt.isGrid(cell)) {
      this.wallArt.paintFace(ctx, cell, [{ x: 0, y: 0 }, { x: TILE_SIZE, y: 0 }], x, y, height, undefined, undefined, terminals);
      ctx.restore(); return;
    }
    ctx.fillStyle = this.materials.fill(ctx, cell.wallMaterial, WALL_COLORS[cell.wallMaterial], lift);
    ctx.fillRect(x, y, TILE_SIZE + .4, height);
    const shade = ctx.createLinearGradient(0, y, 0, y + height);
    shade.addColorStop(0, '#18231c10'); shade.addColorStop(1, '#18231c70');
    ctx.fillStyle = shade; ctx.fillRect(x, y, TILE_SIZE + .4, height);
    ctx.strokeStyle = '#24322760'; ctx.lineWidth = 1;
    const masonry = cell.wallMaterial === 'brick' || cell.wallMaterial === 'stone';
    if (masonry) {
      const rowHeight = cell.wallMaterial === 'brick' ? 8 : 16;
      ctx.beginPath();
      for (let row = 0; row * rowHeight < height; row++) {
        const by = y + row * rowHeight;
        ctx.moveTo(x, by); ctx.lineTo(x + TILE_SIZE, by);
        for (let px = (row % 2) * 12; px <= TILE_SIZE; px += 24) { ctx.moveTo(x + px, by); ctx.lineTo(x + px, Math.min(y + height, by + rowHeight)); }
      }
      ctx.stroke();
      if (noise(cell.x, cell.y, 97) > .48) {
        const px = x + 8 + noise(cell.x, cell.y, 98) * 30;
        ctx.strokeStyle = '#313b3550'; ctx.lineWidth = .8; ctx.beginPath();
        ctx.moveTo(px, y + 2); ctx.lineTo(px - 3, y + height * .35); ctx.lineTo(px + 1, y + height * .6); ctx.stroke();
      }
    } else {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const px = x + 7 + noise(cell.x, cell.y, i + 60) * 32;
        ctx.moveTo(px, y + 2); ctx.lineTo(px - 4, y + height * .47); ctx.lineTo(px + 2, y + height - 2);
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#16251a25'; ctx.fillRect(x - 2, y + height, TILE_SIZE + 4, 4);
    if (damp) {
      for (let i = 0; i < 4; i++) {
        const variation = noise(cell.x, cell.y, i + 121); if (variation < .3) continue;
        const px = x + 4 + variation * 37, py = y + height - 2 - noise(cell.x, cell.y, i + 130) * Math.min(7, height / 3);
        ctx.fillStyle = i % 2 ? '#81975b85' : '#516f4d80'; ctx.beginPath();
        ctx.ellipse(px, py, 2 + variation * 3, 1 + variation * 1.5, variation * 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, TILE_SIZE + .4, height); ctx.clip();
    this.wallArt.paintFace(ctx, cell, [{ x: 0, y: 0 }, { x: TILE_SIZE, y: 0 }], x, y, height, undefined, undefined, terminals);
    ctx.restore();
    ctx.restore();
  }
  drawLinks(ctx: CanvasRenderingContext2D, world: World, projectElevation = true, elevation?: number, groundOnly = false, bounds?: RenderBounds): void {
    const owned = this.accessGeometry(world).owned;
    const visible = (from: Vec2 & { elevation: number }, to: Vec2 & { elevation: number }, width: number): boolean => {
      if (!bounds) return true;
      const margin = width + TILE_SIZE;
      const lift = projectElevation ? Math.max(from.elevation, to.elevation) * ELEVATION_STEP : 0;
      return (Math.max(from.x, to.x) + 1) * TILE_SIZE + margin >= bounds.left
        && Math.min(from.x, to.x) * TILE_SIZE - margin <= bounds.right
        && (Math.max(from.y, to.y) + 1) * TILE_SIZE + margin >= bounds.top
        && Math.min(from.y, to.y) * TILE_SIZE - lift - margin <= bounds.bottom;
    };
    for (const stair of world.surfaceIndex.stairs) {
      if (groundOnly && (stair.from.surfaceId !== BASE_SURFACE || stair.to.surfaceId !== BASE_SURFACE)) continue;
      if (elevation !== undefined && Math.max(stair.from.elevation, stair.to.elevation) !== elevation) continue;
      if (!visible(stair.from, stair.to, stair.width)) continue;
      this.rockArt.drawAuthoredStairs(ctx, stair, projectElevation);
      const high = stair.from.elevation > stair.to.elevation ? stair.from : stair.to;
      const bank = visibleSurface(world, high.x, high.y, high.surfaceId);
      if (bank) this.wallArt.paintStairs(ctx, bank, authoredRockStairGeometry(stair, projectElevation), stair.kind === 'ramp');
    }
    for (const link of [...world.authoring.document.surfaceLinks ?? [], ...world.dungeons.flatMap(d => d.surfaceLinks ?? [])]) {
      if (owned.has(link.id) || link.kind === 'bridge-entry') continue;
      if (groundOnly && (link.from.surfaceId !== BASE_SURFACE || link.to.surfaceId !== BASE_SURFACE)) continue;
      const from = visibleSurface(world, link.from.x, link.from.y, link.from.surfaceId);
      const to = visibleSurface(world, link.to.x, link.to.y, link.to.surfaceId);
      if (!from || !to) continue;
      if (!visible(from, to, TILE_SIZE)) continue;
      if (elevation !== undefined && Math.max(from.elevation, to.elevation) !== elevation) continue;
      const high = from.elevation > to.elevation ? from : to, custom = !!this.wallArt.kit(high);
      if (link.kind === 'stairs' && this.rockArt.drawStairs(ctx, from, to, projectElevation, custom)
        || link.kind === 'ramp' && this.rockArt.drawRamp(ctx, from, to, projectElevation, custom)) {
        const geometry = rockStairGeometry(from, to, projectElevation, TILE_SIZE, custom);
        if (geometry) this.wallArt.paintStairs(ctx, high, geometry, link.kind === 'ramp');
        continue;
      }
      const a = { x: (from.x + .5) * TILE_SIZE, y: (from.y + .5) * TILE_SIZE - (projectElevation ? from.elevation * ELEVATION_STEP : 0) };
      const b = { x: (to.x + .5) * TILE_SIZE, y: (to.y + .5) * TILE_SIZE - (projectElevation ? to.elevation * ELEVATION_STEP : 0) };
      const angle = Math.atan2(b.y - a.y, b.x - a.x), length = Math.hypot(b.x - a.x, b.y - a.y);
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(angle);
      ctx.fillStyle = '#a6a18b'; ctx.strokeStyle = '#454e416e'; ctx.lineWidth = 2;
      ctx.fillRect(-14, -15, length + 28, 30); ctx.strokeRect(-14, -15, length + 28, 30);
      if (link.kind === 'stairs') {
        ctx.beginPath(); for (let i = 0; i <= length; i += 8) { ctx.moveTo(i, -15); ctx.lineTo(i, 15); } ctx.stroke();
      } else {
        const gradient = ctx.createLinearGradient(0, 0, length, 0);
        gradient.addColorStop(0, '#eeeecc25'); gradient.addColorStop(1, '#24332735');
        ctx.fillStyle = gradient; ctx.fillRect(0, -15, length, 30);
      }
      ctx.restore();
    }
  }
}
