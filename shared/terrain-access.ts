import { PLAYER_RADIUS, TILE_SIZE } from './config';
import { containsRectPoint, rectBounds, type WorldStair, type WorldSurface } from './elevation';
import { SpatialIndex, overlaps } from './world-authoring';
import type { WorldDocument } from './world-schema';
import { World } from './world';
import type { Vec2 } from './types';

export function stairEndpoints(s: WorldStair) {
  if (s.tiled) return s.axis === 'x'
    ? [{ x: s.x + .5, y: s.y + s.height / 2, elevation: s.from }, { x: s.x + s.width - .5, y: s.y + s.height / 2, elevation: s.to }]
    : [{ x: s.x + s.width / 2, y: s.y + .5, elevation: s.from }, { x: s.x + s.width / 2, y: s.y + s.height - .5, elevation: s.to }];
  return s.axis === 'x'
    ? [{ x: s.x - .05, y: s.y + s.height / 2, elevation: s.from }, { x: s.x + s.width + .05, y: s.y + s.height / 2, elevation: s.to }]
    : [{ x: s.x + s.width / 2, y: s.y - .05, elevation: s.from }, { x: s.x + s.width / 2, y: s.y + s.height + .05, elevation: s.to }];
}

/** Add one usable access per connected painted plateau, with no duplicate per stroke. */
export function ensureTerrainAccess(document: WorldDocument, world: World, seeds: readonly (Vec2 & { elevation: number })[]): { added: number; missing: number } {
  const g = document.geometry; if (!g) return { added: 0, missing: 0 };
  const blocked = (w: World, p: Vec2 & { elevation: number }) => w.elevation.blocked(p.x * TILE_SIZE, p.y * TILE_SIZE, PLAYER_RADIUS, p.elevation);
  g.stairs = g.stairs.filter(s => !s.automatic || stairEndpoints(s).every(p => !blocked(world, p)));
  let current = new World(world.seed, 16, 'world', document, world.dungeons), added = 0, missing = 0;
  const index = new SpatialIndex<WorldSurface>(rectBounds), visited = new Set<string>();
  for (const s of g.surfaces) if (s.ground) index.add(s);
  for (const seed of seeds) {
    const origin = index.query({ left: seed.x, top: seed.y, right: seed.x + 1, bottom: seed.y + 1 }).find(s => s.elevation === seed.elevation && containsRectPoint(s, seed.x + .5, seed.y + .5));
    if (!origin || visited.has(origin.id)) continue;
    const component: WorldSurface[] = [], queue = [origin]; visited.add(origin.id);
    for (let i = 0; i < queue.length; i++) {
      const s = queue[i]; component.push(s);
      for (const other of index.query({ left: s.x - .001, top: s.y - .001, right: s.x + s.width + .001, bottom: s.y + s.height + .001 })) {
        if (visited.has(other.id) || other.elevation !== s.elevation) continue;
        const horizontal = Math.min(s.x + s.width, other.x + other.width) - Math.max(s.x, other.x);
        const vertical = Math.min(s.y + s.height, other.y + other.height) - Math.max(s.y, other.y);
        if ((horizontal > 0 && vertical >= 0) || (vertical > 0 && horizontal >= 0)) { visited.add(other.id); queue.push(other); }
      }
    }
    if (g.stairs.some(s => stairEndpoints(s).some(p => p.elevation === seed.elevation && component.some(r => containsRectPoint(r, p.x, p.y))))) continue;
    component.sort((a,b) => b.y + b.height - a.y - a.height);
    let access: WorldStair | undefined;
    // Prefer the front edge. The two end landings are inside the plateau and the
    // lower ground; the middle tile replaces the cliff face with the visible steps.
    search: for (const s of component) for (const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const samples = dy ? [Math.floor(s.x + s.width / 2) + .5, s.x + .5, s.x + s.width - .5] : [Math.floor(s.y + s.height / 2) + .5, s.y + .5, s.y + s.height - .5];
      candidate: for (const cross of [...new Set(samples)]) {
        const high = { x: dx ? dx > 0 ? s.x + s.width - .5 : s.x + .5 : cross, y: dy ? dy > 0 ? s.y + s.height - .5 : s.y + .5 : cross };
        const low = { x: high.x + dx * 2.05, y: high.y + dy * 2.05 };
        const lower = current.elevation.terrainElevationAt(low.x, low.y);
        if (lower >= s.elevation || blocked(current, { ...low, elevation: lower })) continue;
        const stair: WorldStair = { id: `stair-${crypto.randomUUID()}`, x: high.x - .5 + (dx < 0 ? -2 : 0), y: high.y - .5 + (dy < 0 ? -2 : 0), width: dx ? 3 : 1, height: dy ? 3 : 1, axis: dx ? 'x' : 'y', from: dx + dy > 0 ? s.elevation : lower, to: dx + dy > 0 ? lower : s.elevation, automatic: true, tiled: true };
        if (g.stairs.some(other => overlaps(rectBounds(stair), rectBounds(other)))) continue;
        const probe = new World(world.seed, 16, 'world', { ...document, geometry: { ...g, stairs: [...g.stairs, stair] } }, world.dungeons);
        if (stairEndpoints(stair).some(p => blocked(probe, p))) continue;
        const [start,end] = stairEndpoints(stair);
        for (let t = 0; t <= 1; t += .125) {
          const p = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t, elevation: t < .5 ? stair.from : stair.to };
          if (blocked(probe, p)) continue candidate;
        }
        access = stair; current = probe; break search;
      }
    }
    if (access) { g.stairs.push(access); added++; } else missing++;
  }
  return { added, missing };
}
