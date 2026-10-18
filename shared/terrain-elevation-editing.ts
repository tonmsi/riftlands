import { containsRectPoint, emptyGeometry, rectBounds, subtractRect, validElevation, type WorldSurface, type WorldSolid } from './elevation';
import { SpatialIndex } from './world-authoring';
import type { WorldDocument } from './world-schema';
import type { TileKind, Vec2 } from './types';

/** Local stroke index. Published once per frame, never scans the map for each dab. */
export class TerrainElevationBrush {
  readonly raisedPoints: (Vec2 & { elevation: number })[] = [];
  private surfaces = new Map<string, WorldSurface>();
  private solids = new Map<string, WorldSolid>();
  private index = new SpatialIndex<WorldSurface>(rectBounds);
  private dirty = false;
  private serial = 0;
  private prefix = `paint-${crypto.randomUUID()}`;
  constructor(private document: WorldDocument) {
    for (const s of document.geometry?.surfaces ?? []) { this.surfaces.set(s.id, s); if (s.ground) this.index.add(s); }
    for (const s of document.geometry?.solids ?? []) this.solids.set(s.id, s);
  }
  paint(p: Vec2, terrain: TileKind | undefined, elevation: number, base: number): boolean {
    if (!validElevation(elevation)) throw new Error('La quota deve essere intera, da -128 a 127.');
    const cut = { ...p, width: 1, height: 1 };
    const hits = this.index.query(rectBounds({ ...cut, id: '' })).filter(s => this.surfaces.get(s.id) === s);
    const current = hits.filter(s => containsRectPoint(s, p.x + .5, p.y + .5)).sort((a, b) => b.elevation - a.elevation)[0];
    if (hits.length === 1 && current?.terrain === terrain && current.elevation === elevation
      && current.x <= p.x && current.y <= p.y && current.x + current.width >= p.x + 1 && current.y + current.height >= p.y + 1) return false;
    let massBase = base;
    for (const s of hits) {
      this.surfaces.delete(s.id);
      const mass = this.solids.get(`${s.id}-mass`); this.solids.delete(`${s.id}-mass`);
      if (mass) massBase = Math.min(massBase, mass.base);
      for (const part of subtractRect(s, cut)) {
        const id = `${this.prefix}-${this.serial++}`, next = { ...part, id };
        this.surfaces.set(id, next); this.index.add(next);
        if (mass) this.solids.set(`${id}-mass`, { ...mass, ...rectBoundsToShape(next), id: `${id}-mass` });
      }
    }
    if (terrain && (elevation !== base || hits.length)) {
      const id = `${this.prefix}-${this.serial++}`;
      const next: WorldSurface = { id, ...cut, elevation, terrain, ground: true, painted: true };
      this.surfaces.set(id, next); this.index.add(next);
      if (massBase < elevation) this.solids.set(`${id}-mass`, { ...cut, id: `${id}-mass`, base: massBase, top: elevation });
      if (massBase < elevation && terrain !== 'water' && terrain !== 'rock') this.raisedPoints.push({ ...p, elevation });
    }
    this.dirty ||= hits.length > 0 || elevation !== base;
    return this.dirty;
  }
  /** Merge adjacent horizontal runs; storage depends on strokes/rows, not painted area. */
  flush(merge = false): boolean {
    if (!this.dirty && !merge) return false;
    if (!this.dirty && !this.document.geometry) return false;
    let surfaces = [...this.surfaces.values()];
    if (merge) {
      const fixed = surfaces.filter(s => !s.painted);
      const rows = surfaces.filter(s => s.painted).sort((a, b) => a.y - b.y || a.height - b.height || a.elevation - b.elevation || String(a.terrain).localeCompare(String(b.terrain)) || a.x - b.x);
      const runs: WorldSurface[] = [];
      for (const s of rows) {
        const prev = runs.at(-1), a = prev && this.solids.get(`${prev.id}-mass`), b = this.solids.get(`${s.id}-mass`);
        if (prev && prev.y === s.y && prev.height === s.height && prev.x + prev.width === s.x && prev.elevation === s.elevation && prev.terrain === s.terrain && a?.base === b?.base) {
          prev.width += s.width;
          if (a) this.solids.set(a.id, { ...a, width: prev.width });
          this.solids.delete(`${s.id}-mass`);
        } else runs.push({ ...s });
      }
      surfaces = [...fixed, ...runs];
    }
    const g = this.document.geometry ?? emptyGeometry();
    this.document.geometry = { surfaces, solids: [...this.solids.values()], stairs: g.stairs };
    this.dirty = false; return true;
  }
}
const rectBoundsToShape = (s: WorldSurface) => ({ x: s.x, y: s.y, width: s.width, height: s.height });
