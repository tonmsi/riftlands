import { TILE_SIZE } from '../../shared/config';
import { bridgeGeometry, type BridgeEdge, type BridgeGeometry } from '../../shared/bridge-geometry';
import type { Vec2 } from '../../shared/types';
import type { World } from '../../shared/world';
import { DEFAULT_ASSET_FADE, type WorldAsset } from '../../shared/world-schema';
import { BASE_SURFACE, ELEVATION_STEP, type SurfaceCell } from '../../shared/world-surfaces';
import { noise } from './render-primitives';
import type { TerrainMaterials } from './terrain-materials';
import { AssetFadeTransitions } from './world-asset-fade';

export interface BridgeLevel { elevation: number; cells: SurfaceCell[]; }
const fadeSettings = { fade: DEFAULT_ASSET_FADE } as WorldAsset;
const thickness = 7, railHeight = 11;
const wood = { face: '#705238', rail: '#67513e', light: '#d4b18a', joint: '#5f493849', post: '#826040' };
const masonry = { face: '#767b72', rail: '#737d77', light: '#d5d6c1', joint: '#5f65533e', post: '#939b8e' };

/** Deck outline and access gaps follow the complete union, including L/T shapes and plazas. */
export class BridgeArt {
  private fades = new AssetFadeTransitions();
  private cache?: { world: World; revision: number; elevation: number; cells: SurfaceCell[]; geometry: BridgeGeometry };
  constructor(private readonly materials: TerrainMaterials) {}
  private geometry(world: World, level: BridgeLevel): BridgeGeometry {
    if (this.cache?.world !== world) this.fades = new AssetFadeTransitions();
    if (!this.cache || this.cache.world !== world || this.cache.revision !== world.authoringRevision
      || this.cache.elevation !== level.elevation || this.cache.cells !== level.cells) {
      this.cache = { world, revision: world.authoringRevision, elevation: level.elevation, cells: level.cells,
        geometry: bridgeGeometry(level.cells, (x, y, id) => world.surfaceAt(x, y, id),
          cell => world.surfaceIndex.exits(cell.x, cell.y, cell.surfaceId)) };
    }
    return this.cache.geometry;
  }
  private alpha(world: World, id: string, elevation: number, time: number, viewers: readonly Vec2[]): number {
    const underneath = viewers.slice(0, 1).some(viewer => {
      const deck = world.surfaceIndex.at(Math.floor(viewer.x / TILE_SIZE), Math.floor(viewer.y / TILE_SIZE), id);
      return deck?.elevation === elevation && world.elevationAt(viewer) < elevation;
    });
    return 1 - this.fades.amount(`bridge:${id}:${elevation}`, fadeSettings, underneath, time) * (1 - DEFAULT_ASSET_FADE.opacity);
  }
  private paintGroup(ctx: CanvasRenderingContext2D, world: World, geometry: BridgeGeometry, time: number,
    viewers: readonly Vec2[], paint: (cells: SurfaceCell[], edges: BridgeEdge[]) => void): void {
    const groups = new Map<string, SurfaceCell[]>();
    for (const cell of geometry.cells) {
      const group = groups.get(cell.surfaceId) ?? []; group.push(cell); groups.set(cell.surfaceId, group);
    }
    for (const [id, cells] of groups) {
      const elevation = cells[0].elevation, alpha = this.alpha(world, id, elevation, time, viewers);
      const covered = viewers.slice(1).filter(viewer => {
        const deck = world.surfaceIndex.at(Math.floor(viewer.x / TILE_SIZE), Math.floor(viewer.y / TILE_SIZE), id);
        return deck?.elevation === elevation && world.elevationAt(viewer) < elevation;
      });
      const edges = geometry.edges.filter(edge => edge.cell.surfaceId === id);
      ctx.save(); ctx.globalAlpha *= alpha;
      // The focused player's plane controls the whole deck. Other players underneath get
      // small local windows, so a distant player cannot make an entire bridge translucent.
      if (alpha > .9) for (const viewer of covered) {
        ctx.beginPath(); ctx.rect(-1e9, -1e9, 2e9, 2e9);
        const cy = viewer.y - world.elevationAt(viewer) * ELEVATION_STEP - 32;
        ctx.moveTo(viewer.x + 44, cy); ctx.arc(viewer.x, cy, 44, 0, Math.PI * 2); ctx.closePath();
        ctx.clip('evenodd');
      }
      paint(cells, edges); ctx.restore();
      if (alpha > .9 && covered.length) {
        ctx.save(); ctx.globalAlpha *= DEFAULT_ASSET_FADE.opacity;
        ctx.beginPath(); for (const viewer of covered) {
          const cy = viewer.y - world.elevationAt(viewer) * ELEVATION_STEP - 32;
          ctx.moveTo(viewer.x + 44, cy); ctx.arc(viewer.x, cy, 44, 0, Math.PI * 2); ctx.closePath();
        }
        ctx.clip(); paint(cells, edges); ctx.restore();
      }
    }
  }
  drawBase(ctx: CanvasRenderingContext2D, world: World, level: BridgeLevel, time: number,
    viewers: readonly Vec2[] = [], projectElevation = true, railClip?: (ctx: CanvasRenderingContext2D) => void): void {
    const geometry = this.geometry(world, level), lift = projectElevation ? level.elevation * ELEVATION_STEP : 0;
    this.paintGroup(ctx, world, geometry, time, viewers, (cells, edges) => {
      // One compound shadow prevents dark seams between adjacent cells.
      ctx.save(); ctx.beginPath();
      for (const cell of cells) ctx.rect(cell.x * TILE_SIZE + 7, cell.y * TILE_SIZE + 6, TILE_SIZE + .2, TILE_SIZE + .2);
      ctx.fillStyle = '#19241d25'; ctx.fill(); ctx.restore();
      if (projectElevation) for (const edge of edges) this.drawSupport(ctx, world, edge, lift);
      for (const edge of edges) {
        if (edge.direction !== 'south' && edge.direction !== 'east' && edge.direction !== 'west') continue;
        const palette = edge.cell.material === 'wood' ? wood : masonry;
        const a = { x: edge.a.x * TILE_SIZE, y: edge.a.y * TILE_SIZE - lift };
        const b = { x: edge.b.x * TILE_SIZE, y: edge.b.y * TILE_SIZE - lift };
        ctx.fillStyle = palette.face; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.lineTo(b.x, b.y + thickness); ctx.lineTo(a.x, a.y + thickness); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#35423870'; ctx.lineWidth = 1.4; ctx.beginPath();
        ctx.moveTo(a.x, a.y + thickness); ctx.lineTo(b.x, b.y + thickness); ctx.stroke();
      }
      for (const cell of cells) this.drawDeck(ctx, cell, lift);
      // A strip rather than independent cell outlines keeps even wide bends continuous.
      for (const edge of edges) {
        const palette = edge.cell.material === 'wood' ? wood : masonry;
        ctx.strokeStyle = edge.direction === 'north' || edge.direction === 'west' ? palette.light : palette.face;
        ctx.lineWidth = edge.entrance ? 1.3 : 3.5;
        ctx.beginPath(); ctx.moveTo(edge.a.x * TILE_SIZE, edge.a.y * TILE_SIZE - lift);
        ctx.lineTo(edge.b.x * TILE_SIZE, edge.b.y * TILE_SIZE - lift); ctx.stroke();
        if (edge.entrance) this.drawThreshold(ctx, edge, lift);
      }
      ctx.save(); railClip?.(ctx);
      this.drawRails(ctx, edges.filter(edge => edge.direction === 'north'), lift); ctx.restore();
    });
  }
  /** Called after actors on this elevation, so the nearest parapet can cover their feet. */
  drawForeground(ctx: CanvasRenderingContext2D, world: World, level: BridgeLevel, time: number,
    viewers: readonly Vec2[] = [], projectElevation = true, railClip?: (ctx: CanvasRenderingContext2D) => void): void {
    const geometry = this.geometry(world, level), lift = projectElevation ? level.elevation * ELEVATION_STEP : 0;
    this.paintGroup(ctx, world, geometry, time, viewers, (_cells, edges) => {
      ctx.save(); railClip?.(ctx);
      this.drawRails(ctx, edges.filter(edge => edge.direction !== 'north'), lift); ctx.restore();
    });
  }
  private drawDeck(ctx: CanvasRenderingContext2D, cell: SurfaceCell, lift: number): void {
    const x = cell.x * TILE_SIZE, y = cell.y * TILE_SIZE - lift;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, TILE_SIZE + .2, TILE_SIZE + .2); ctx.clip();
    ctx.fillStyle = this.materials.fill(ctx, cell.material, this.materials.color(cell.material), lift);
    ctx.fillRect(x, y, TILE_SIZE + .2, TILE_SIZE + .2);
    const isWood = cell.material === 'wood', palette = isWood ? wood : masonry;
    ctx.strokeStyle = palette.joint; ctx.lineWidth = isWood ? 1.1 : .8; ctx.beginPath();
    const rowHeight = isWood ? 8 : 16, blockWidth = isWood ? TILE_SIZE * 2 : 24;
    for (let row = 0; row < TILE_SIZE / rowHeight; row++) {
      const py = y + row * rowHeight;
      ctx.moveTo(x, py); ctx.lineTo(x + TILE_SIZE, py);
      const shift = ((Math.floor(cell.y * TILE_SIZE / rowHeight) + row) % 2) * blockWidth / 2;
      for (let px = Math.ceil((x - shift) / blockWidth) * blockWidth + shift; px < x + TILE_SIZE; px += blockWidth) {
        ctx.moveTo(px, py); ctx.lineTo(px, py + rowHeight);
      }
    }
    ctx.stroke();
    if (isWood) {
      ctx.strokeStyle = '#e1c39538'; ctx.lineWidth = .8;
      for (let row = 0; row < 6; row++) {
        const variation = noise(cell.x, cell.y, 729 + row), sx = x + 5 + variation * 17, py = y + row * 8 + 3;
        ctx.beginPath(); ctx.moveTo(sx, py); ctx.quadraticCurveTo(sx + 9, py + .9, sx + 17, py); ctx.stroke();
      }
    }
    ctx.restore();
  }
  private drawThreshold(ctx: CanvasRenderingContext2D, edge: BridgeEdge, lift: number): void {
    const x = edge.cell.x * TILE_SIZE, y = edge.cell.y * TILE_SIZE - lift;
    ctx.save(); ctx.fillStyle = edge.cell.material === 'wood' ? '#c5a17a85' : '#d3d2bd90';
    if (edge.direction === 'north' || edge.direction === 'south') ctx.fillRect(x + 3,
      y + (edge.direction === 'north' ? 0 : TILE_SIZE - 4), TILE_SIZE - 6, 4);
    else ctx.fillRect(x + (edge.direction === 'west' ? 0 : TILE_SIZE - 4), y + 3, 4, TILE_SIZE - 6);
    ctx.restore();
  }
  private drawSupport(ctx: CanvasRenderingContext2D, world: World, edge: BridgeEdge, lift: number): void {
    if (edge.entrance || edge.direction !== 'south') return;
    // Supports are decoration only: the lower plane remains fully available to navigation.
    if ((edge.cell.x + edge.cell.y * 2) % 3 !== 0) return;
    const ground = world.surfaceAt(edge.cell.x, edge.cell.y, BASE_SURFACE), lower = (ground?.elevation ?? 0) * ELEVATION_STEP;
    const height = lift - lower - thickness; if (height <= 5) return;
    const x = (edge.cell.x + .5) * TILE_SIZE, y = (edge.cell.y + 1) * TILE_SIZE - lift + thickness;
    const palette = edge.cell.material === 'wood' ? wood : masonry;
    ctx.fillStyle = '#19251d22'; ctx.beginPath(); ctx.ellipse(x + 4, y + height + 3, 8, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = palette.face; ctx.fillRect(x - 4, y, 8, height);
    ctx.fillStyle = palette.post; ctx.fillRect(x - 4, y, 2.5, height);
    ctx.fillStyle = '#3d483b60'; ctx.fillRect(x + 2.5, y, 1.5, height);
    ctx.fillStyle = palette.light; ctx.fillRect(x - 5.5, y + height - 3, 11, 3);
    ctx.fillStyle = palette.face; ctx.fillRect(x - 6, y, 12, 3);
  }
  private drawRails(ctx: CanvasRenderingContext2D, edges: readonly BridgeEdge[], lift: number): void {
    const posts = new Map<string, { x: number; y: number; material: SurfaceCell['material'] }>();
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const edge of edges) {
      if (edge.entrance) continue;
      const palette = edge.cell.material === 'wood' ? wood : masonry;
      const ax = edge.a.x * TILE_SIZE, ay = edge.a.y * TILE_SIZE - lift;
      const bx = edge.b.x * TILE_SIZE, by = edge.b.y * TILE_SIZE - lift;
      ctx.strokeStyle = palette.face; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(ax, ay - 4); ctx.lineTo(bx, by - 4); ctx.stroke();
      ctx.strokeStyle = '#39433740'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(ax + 1, ay + 2); ctx.lineTo(bx + 1, by + 2); ctx.stroke();
      for (const point of [edge.a, edge.b]) posts.set(`${point.x},${point.y}@${edge.cell.surfaceId}`, {
        x: point.x * TILE_SIZE, y: point.y * TILE_SIZE - lift, material: edge.cell.material,
      });
    }
    for (const post of posts.values()) {
      const palette = post.material === 'wood' ? wood : masonry;
      ctx.fillStyle = palette.face; ctx.fillRect(post.x - 2.5, post.y - railHeight + 1, 5, railHeight + 2);
      ctx.fillStyle = palette.post; ctx.fillRect(post.x - 2.5, post.y - railHeight + 1, 2, railHeight + 1);
      ctx.fillStyle = palette.light; ctx.fillRect(post.x - 3, post.y - railHeight - 1, 6, 2);
    }
    for (const edge of edges) {
      if (edge.entrance) continue;
      const palette = edge.cell.material === 'wood' ? wood : masonry;
      ctx.strokeStyle = palette.rail; ctx.lineWidth = 4; ctx.beginPath();
      ctx.moveTo(edge.a.x * TILE_SIZE, edge.a.y * TILE_SIZE - lift - railHeight);
      ctx.lineTo(edge.b.x * TILE_SIZE, edge.b.y * TILE_SIZE - lift - railHeight); ctx.stroke();
      ctx.strokeStyle = palette.light; ctx.lineWidth = 1.2; ctx.beginPath();
      ctx.moveTo(edge.a.x * TILE_SIZE, edge.a.y * TILE_SIZE - lift - railHeight - 1);
      ctx.lineTo(edge.b.x * TILE_SIZE, edge.b.y * TILE_SIZE - lift - railHeight - 1); ctx.stroke();
    }
    ctx.restore();
  }
}
