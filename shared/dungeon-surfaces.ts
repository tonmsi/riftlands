import { BASE_SURFACE, validateSurfaceData, type SurfaceCell, type SurfaceLink, type SurfaceStair } from './world-surfaces';

const materials = new Set(['grass', 'path', 'water', 'rock', 'bush', 'mud', 'snow', 'ice', 'stone', 'brick', 'sand', 'wood']);
const walls = new Set(['earth', 'rock', 'stone', 'brick', 'wood']);
const surfaceId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(value);

/** Keeps dungeon imports bounded and strips unknown fields, including endpoint metadata. */
export function parseDungeonSurfaces(input: { surfaceCells?: unknown; surfaceLinks?: unknown; surfaceStairs?: unknown }, bounds: { minTx: number; maxTx: number; minTy: number; maxTy: number }): { surfaceCells?: SurfaceCell[]; surfaceLinks?: SurfaceLink[]; surfaceStairs?: SurfaceStair[] } {
  validateSurfaceData(input.surfaceCells, input.surfaceLinks, input.surfaceStairs);
  const fail = (): never => { throw new Error('Superfici dungeon non valide: controlla quote, materiali e collegamenti.'); };
  const point = (p: any): boolean => !!p && Number.isInteger(p.x) && Number.isInteger(p.y)
    && p.x >= bounds.minTx && p.x <= bounds.maxTx && p.y >= bounds.minTy && p.y <= bounds.maxTy;
  const cells: SurfaceCell[] = [], links: SurfaceLink[] = [], keys = new Set<string>(), ids = new Set<string>();
  const limit = (bounds.maxTx - bounds.minTx + 1) * (bounds.maxTy - bounds.minTy + 1) * 4;
  if (input.surfaceCells !== undefined) {
    if (!Array.isArray(input.surfaceCells) || input.surfaceCells.length > limit) fail();
    for (const c of input.surfaceCells as any[]) {
      if (!point(c) || !surfaceId(c.surfaceId) || !Number.isInteger(c.elevation) || c.elevation < 0 || c.elevation > 16
        || !materials.has(c.material) || !walls.has(c.wallMaterial) || !['ground', 'bridge', 'stairs'].includes(c.kind)
        || (c.kind === 'ground' ? c.surfaceId !== BASE_SURFACE : c.surfaceId === BASE_SURFACE)
        || (c.blocked !== undefined && typeof c.blocked !== 'boolean')) fail();
      const key = `${c.x},${c.y}@${c.surfaceId}`; if (keys.has(key)) fail(); keys.add(key);
      cells.push({ x: c.x, y: c.y, surfaceId: c.surfaceId, elevation: c.elevation, material: c.material, wallMaterial: c.wallMaterial, kind: c.kind,
        ...(c.wallSkin !== undefined ? { wallSkin: c.wallSkin } : {}),
        ...(c.blocked !== undefined ? { blocked: c.blocked } : {}) });
    }
  }
  if (input.surfaceLinks !== undefined) {
    if (!Array.isArray(input.surfaceLinks) || input.surfaceLinks.length > limit * 2) fail();
    for (const l of input.surfaceLinks as any[]) {
      if (!l || !surfaceId(l.id) || ids.has(l.id) || !['stairs', 'ramp', 'bridge-entry'].includes(l.kind)
        || !point(l.from) || !point(l.to) || !surfaceId(l.from.surfaceId) || !surfaceId(l.to.surfaceId)
        || Math.abs(l.from.x - l.to.x) + Math.abs(l.from.y - l.to.y) !== 1) fail();
      for (const p of [l.from, l.to]) if (p.surfaceId !== BASE_SURFACE && !keys.has(`${p.x},${p.y}@${p.surfaceId}`)) fail();
      ids.add(l.id); links.push({ id: l.id, kind: l.kind, from: { x: l.from.x, y: l.from.y, surfaceId: l.from.surfaceId }, to: { x: l.to.x, y: l.to.y, surfaceId: l.to.surfaceId } });
    }
  }
  const stairs = (input.surfaceStairs ?? []) as SurfaceStair[];
  for (const stair of stairs) if (!point(stair.from) || !point(stair.to)) fail();
  return { ...(input.surfaceStairs !== undefined ? { surfaceStairs: stairs.map(s => ({ id: s.id, kind: s.kind, width: s.width,
    ...(s.underpass !== undefined ? { underpass: s.underpass } : {}),
    from: { x: s.from.x, y: s.from.y, surfaceId: s.from.surfaceId, elevation: s.from.elevation }, to: { x: s.to.x, y: s.to.y, surfaceId: s.to.surfaceId, elevation: s.to.elevation } })) } : {}), ...(input.surfaceCells !== undefined ? { surfaceCells: cells } : {}), ...(input.surfaceLinks !== undefined ? { surfaceLinks: links } : {}) };
}
