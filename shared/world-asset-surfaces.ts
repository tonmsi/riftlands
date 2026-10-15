import type { Vec2 } from './types';
import { DEFAULT_ASSET_ELEVATION, type WorldAsset, type WorldDocument } from './world-schema';
import { BASE_SURFACE, ELEVATION_STEP, MAX_ELEVATION, SurfaceIndex, surfaceKey, type SurfaceCell } from './world-surfaces';
import { stairFootprint, stairGeometry, stairSpatialIssues } from './surface-stairs';
import { TILE_SIZE } from './tile-size';

function footprint(asset: WorldAsset, point: Vec2): { x: number; y: number }[] {
  return Array.from({ length: asset.columns * asset.rows }, (_, i) => ({ x: point.x + i % asset.columns, y: point.y + Math.floor(i / asset.columns) }));
}

/** A plateau is terrain, not a wall image with a collision mask. Planning never changes the document. */
export function planElevationAsset(document: WorldDocument, asset: WorldAsset, point: Vec2): SurfaceCell[] | undefined {
  if (asset.category !== 'elevation' || (point.surfaceId ?? BASE_SURFACE) !== BASE_SURFACE
    || ![point.x, point.y].every(Number.isSafeInteger)) return;
  const settings = asset.elevation ?? DEFAULT_ASSET_ELEVATION;
  if (!Number.isInteger(settings.height) || settings.height < 1 || settings.height > MAX_ELEVATION || settings.material === 'water') return;
  const points = footprint(asset, point), keys = new Set(points.map(p => `${p.x},${p.y}`));
  if (points.some(p => Math.abs(p.x) > 10_000_000 || Math.abs(p.y) > 10_000_000
    || document.interiorBounds && (p.x < 0 || p.y < 0 || p.x >= document.interiorBounds.width || p.y >= document.interiorBounds.height))) return;
  const cells = document.surfaceCells ?? [];
  // A ground stamp must not silently bury a bridge or invalidate an existing stair flight.
  if (cells.some(c => keys.has(`${c.x},${c.y}`) && c.kind === 'bridge' && settings.height >= c.elevation)) return;
  for (const stair of document.surfaceStairs ?? []) {
    if (stair.profile === 'terraced') continue;
    const g = stairGeometry(stair);
    for (const p of stairFootprint(stair)) {
      if (!keys.has(`${p.x},${p.y}`)) continue;
      const isStart = g.dx ? p.x === stair.from.x : p.y === stair.from.y;
      const isEnd = g.dx ? p.x === stair.to.x : p.y === stair.to.y;
      if ((isStart || isEnd) && p.surfaceId === BASE_SURFACE) {
        if (settings.height !== (isStart ? stair.from.elevation : stair.to.elevation)) return;
      } else if (!isStart && !isEnd) {
        const t = g.progressAt({ x: (p.x + .5) * TILE_SIZE, y: (p.y + .5) * TILE_SIZE });
        if (settings.height > g.elevationAt(Math.max(0, t - TILE_SIZE / g.run / 2)) + 1e-8) return;
      }
    }
  }
  const updates: SurfaceCell[] = points.map(p => ({ ...p, surfaceId: BASE_SURFACE, elevation: settings.height, material: settings.material, layout: 'terraced',
    wallMaterial: settings.wallMaterial, ...(settings.wallSkin !== undefined ? { wallSkin: settings.wallSkin } : {}), kind: 'ground', blocked: false }));
  // A stamp cannot influence a remote flight beyond the bounded height transform.
  const nearby = (document.surfaceStairs ?? []).filter(stair => stair.profile === 'terraced'
    && Math.max(stair.from.x, stair.to.x) + MAX_ELEVATION + 2 >= point.x && Math.min(stair.from.x, stair.to.x) - MAX_ELEVATION - 2 < point.x + asset.columns
    && Math.max(stair.from.y, stair.to.y) + MAX_ELEVATION + 2 >= point.y && Math.min(stair.from.y, stair.to.y) - MAX_ELEVATION - 2 < point.y + asset.rows);
  for (const stair of nearby) {
    const left = Math.min(stair.from.x, stair.to.x) - MAX_ELEVATION - 2, right = Math.max(stair.from.x, stair.to.x) + MAX_ELEVATION + 2;
    const top = Math.min(stair.from.y, stair.to.y) - MAX_ELEVATION - 2, bottom = Math.max(stair.from.y, stair.to.y) + MAX_ELEVATION + 2;
    const relevant = (cell: SurfaceCell) => cell.surfaceId === BASE_SURFACE && cell.x >= left && cell.x <= right && cell.y >= top && cell.y <= bottom;
    const revised = [...cells.filter(c => relevant(c) && !keys.has(`${c.x},${c.y}`)), ...updates.filter(relevant)];
    const index = new SurfaceIndex(revised);
    if (stairSpatialIssues(stair, (x, y, id) => index.at(x, y, id) ?? (id === BASE_SURFACE ? {
        x, y, surfaceId: BASE_SURFACE, elevation: 0, kind: 'ground', material: 'grass', wallMaterial: 'earth',
      } : undefined)).length) return;
  }
  return updates;
}

function upsertCells(document: WorldDocument, updates: readonly SurfaceCell[], indices?: Map<string, number>): boolean {
  const cells = document.surfaceCells ??= [];
  indices ??= new Map(cells.map((cell, i) => [surfaceKey(cell.x, cell.y, cell.surfaceId), i]));
  let changed = false;
  for (const cell of updates) {
    const key = surfaceKey(cell.x, cell.y, cell.surfaceId), index = indices.get(key), old = index === undefined ? undefined : cells[index];
    if (old && old.elevation === cell.elevation && old.material === cell.material && old.wallMaterial === cell.wallMaterial
      && old.kind === cell.kind && old.wallSkin === cell.wallSkin && old.blocked === cell.blocked && old.layout === cell.layout) continue;
    if (index === undefined) { indices.set(key, cells.length); cells.push(cell); } else cells[index] = cell;
    changed = true;
  }
  return changed;
}

/** Keeps stones, bushes and NPCs attached to the edited terrain without creating a second floor. */
export function stampElevationAsset(document: WorldDocument, asset: WorldAsset, point: Vec2, id?: string, indices?: Map<string, number>): boolean {
  const cells = planElevationAsset(document, asset, point); if (!cells) return false;
  const existing = document.placements.find(p => p.assetId === asset.id && p.x === point.x && p.y === point.y && (p.surfaceId ?? BASE_SURFACE) === BASE_SURFACE);
  if (id && document.placements.some(p => p.id === id && p !== existing)) return false;
  let changed = upsertCells(document, cells, indices);
  if (id && !existing) {
    document.placements.push({ id, assetId: asset.id, x: point.x, y: point.y, surfaceId: BASE_SURFACE, elevation: cells[0].elevation });
    changed = true;
  }
  if (existing && existing.elevation !== cells[0].elevation) changed = true;
  if (!changed) return false;
  const heights = new Map(cells.map(c => [`${c.x},${c.y}`, c.elevation]));
  for (const p of [...document.placements, ...document.npcs, document.spawn]) {
    if ((p.surfaceId ?? BASE_SURFACE) !== BASE_SURFACE) continue;
    const height = heights.get(`${p.x},${p.y}`); if (height !== undefined) p.elevation = height;
  }
  return true;
}

/** An explicit floor repairs its own walkable support while retaining the selected plane's height. */
export function stampFloorSupport(document: WorldDocument, asset: WorldAsset, point: Vec2, indices?: Map<string, number>): void {
  if (asset.category !== 'floor') return;
  const surfaceId = point.surfaceId ?? BASE_SURFACE, cells = document.surfaceCells ?? [];
  indices ??= new Map(cells.map((cell, i) => [surfaceKey(cell.x, cell.y, cell.surfaceId), i]));
  const updates: SurfaceCell[] = [];
  for (const p of footprint(asset, point)) {
    const index = indices.get(surfaceKey(p.x, p.y, surfaceId)), cell = index === undefined ? undefined : cells[index];
    // Floors can decorate an existing bridge or flight, but cannot manufacture those structures.
    if (!cell && surfaceId !== BASE_SURFACE) continue;
    updates.push(cell ? { ...cell, blocked: false } : { ...p, surfaceId, elevation: point.elevation ?? 0,
      material: 'path', wallMaterial: 'earth', kind: 'ground', blocked: false });
  }
  upsertCells(document, updates, indices);
}

/** Descriptive dimensions for editor previews: the vertical rise is independent from the footprint. */
export function elevationAssetRise(asset: WorldAsset): number { return (asset.elevation ?? DEFAULT_ASSET_ELEVATION).height * ELEVATION_STEP; }
