import type { TileKind } from './types';

export type PaintMaterial = TileKind | 'stone';
export interface MaterialPaint { color: string; intensity: number; size: number; }
export interface MaskPoint { x: number; y: number; }
/** Interior control points only; shared edge endpoints are supplied by the renderer. */
export interface MaskShape { curves: MaskPoint[][]; smooth: boolean; }
export interface WorldPainting {
  maskShapes?: Partial<Record<number, MaskShape>>;
  edges: 'masks' | 'legacy';
  curve: number;
  materials: Record<PaintMaterial, MaterialPaint>;
}
export const PAINT_COLORS: Record<PaintMaterial, string> = {
  grass: '#91ad69', path: '#cfb47e', water: '#45a0ad', rock: '#8fa2ba',
  bush: '#559b55', mud: '#a09c72', snow: '#eaf4f8', ice: '#8fcee5', stone: '#b7ad90',
};
export function defaultWorldPainting(): WorldPainting {
  return { edges: 'masks', curve: 1, materials: Object.fromEntries(Object.entries(PAINT_COLORS)
    .map(([key, color]) => [key, { color, intensity: 1, size: 1 }])) as WorldPainting['materials'] };
}
/** Bounded data only: painting can never alter terrain, movement or climate. */
export function validWorldPainting(value: unknown): value is WorldPainting {
  if (!value || typeof value !== 'object') return false;
  const p = value as WorldPainting;
  if (p.maskShapes !== undefined) {
    if (!p.maskShapes || typeof p.maskShapes !== 'object' || Array.isArray(p.maskShapes)) return false;
    for (const [key, shape] of Object.entries(p.maskShapes)) {
      const mask = Number(key);
      if (!/^(?:[1-9]|1[0-4])$/.test(key) || !shape || typeof shape.smooth !== 'boolean'
        || !Array.isArray(shape.curves) || shape.curves.length !== (mask === 5 || mask === 10 ? 2 : 1)
        || !shape.curves.every(points => Array.isArray(points) && points.length >= 1 && points.length <= 8
          && points.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y)
            && point.x >= .03 && point.x <= .97 && point.y >= .03 && point.y <= .97))) return false;
    }
  }
  return ['masks', 'legacy'].includes(p.edges) && Number.isFinite(p.curve) && p.curve >= 0 && p.curve <= 1
    && !!p.materials && Object.keys(PAINT_COLORS).every(key => {
      const m = p.materials[key as PaintMaterial];
      return !!m && /^#[0-9a-f]{6}$/i.test(m.color) && Number.isFinite(m.intensity) && m.intensity >= 0 && m.intensity <= 2
        && Number.isFinite(m.size) && m.size >= .25 && m.size <= 2;
    });
}
