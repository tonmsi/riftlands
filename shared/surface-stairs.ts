import { TILE_SIZE } from './tile-size';
import type { Vec2 } from './types';
import { BASE_SURFACE, ELEVATION_STEP, MAX_ELEVATION, surfaceKey, validSurfaceId, type StairProfile, type SurfaceCell, type SurfaceEndpoint, type SurfaceLink, type SurfaceStair, type TerrainSurfaceCell } from './world-surfaces';
import { deriveTerracedTerrain } from './terraced-terrain';

/** Half-tile landings on long flights; shorter flights reserve a quarter at each end. */
export const STAIR_LANDING = 24;
export const MIN_STAIR_WIDTH = 40;
export const stairSurfaceId = (stair: Pick<SurfaceStair, 'id'>): string => `stair:${stair.id}`;

/** The same world-space profile is used by artwork, feet, camera and clearance. */
export function stairGeometry(stair: SurfaceStair) {
  const low = stair.from.elevation < stair.to.elevation ? stair.from : stair.to;
  const high = low === stair.from ? stair.to : stair.from;
  const dx = Math.sign(high.x - low.x), dy = Math.sign(high.y - low.y);
  const run = (Math.abs(high.x - low.x) + Math.abs(high.y - low.y)) * TILE_SIZE;
  const rise = (high.elevation - low.elevation) * ELEVATION_STEP;
  const landing = stair.profile === 'incline' ? 0 : Math.min(TILE_SIZE / 2, run / 4);
  const inclinedRun = run - 2 * landing, angle = Math.atan2(rise, inclinedRun) * 180 / Math.PI;
  const start = { x: (low.x + .5) * TILE_SIZE, y: (low.y + .5) * TILE_SIZE };
  const progressAt = (point: Pick<Vec2, 'x' | 'y'>) => ((point.x - start.x) * dx + (point.y - start.y) * dy) / run;
  const elevationAt = (t: number) => low.elevation + (high.elevation - low.elevation) * Math.max(0, Math.min(1, (t * run - landing) / (run - 2 * landing)));
  const pointAt = (t: number): Vec2 => ({ x: start.x + dx * run * t, y: start.y + dy * run * t });
  const lateralAt = (point: Pick<Vec2, 'x' | 'y'>) => Math.abs((point.x - start.x) * -dy + (point.y - start.y) * dx);
  const contains = (point: Pick<Vec2, 'x' | 'y'>, radius = 0) => {
    const t = progressAt(point);
    return t >= 0 && t <= 1 && lateralAt(point) + radius <= stair.width / 2 + 1e-8;
  };
  return { low, high, dx, dy, run, rise, landing, inclinedRun, angle, width: stair.width, pointAt, progressAt, elevationAt, lateralAt, contains };
}

/** Intermediate supports never overwrite the ground underneath a staircase. */
export function stairPath(stair: SurfaceStair, lane = 0): SurfaceEndpoint[] {
  const length = Math.abs(stair.to.x - stair.from.x) + Math.abs(stair.to.y - stair.from.y);
  const dx = Math.sign(stair.to.x - stair.from.x), dy = Math.sign(stair.to.y - stair.from.y);
  return Array.from({ length: length + 1 }, (_, i) => ({ x: stair.from.x + dx * i - dy * lane, y: stair.from.y + dy * i + dx * lane,
    surfaceId: i === 0 ? stair.from.surfaceId : i === length ? stair.to.surfaceId : stairSurfaceId(stair) }));
}
export function stairLanes(stair: SurfaceStair): number[] {
  const half = Math.ceil((stair.width / 2 - TILE_SIZE / 2) / TILE_SIZE);
  return Array.from({ length: Math.max(0, half) * 2 + 1 }, (_, i) => i - Math.max(0, half));
}
export function stairFootprint(stair: SurfaceStair): SurfaceEndpoint[] { return stairLanes(stair).flatMap(lane => stairPath(stair, lane)); }
export function stairLinks(stair: SurfaceStair): SurfaceLink[] {
  return stairLanes(stair).flatMap(lane => { const path = stairPath(stair, lane);
    return path.slice(1).map((to, i) => ({ id: lane === 0 ? `${stair.id}:step:${i}` : `${stair.id}:lane:${lane}:step:${i}`, kind: stair.kind, from: path[i], to })); });
}
export interface StairData {
  surfaceCells?: SurfaceCell[]; surfaceLinks?: SurfaceLink[]; surfaceStairs?: SurfaceStair[];
  placements?: { surfaceId?: string }[]; npcs?: { surfaceId?: string }[];
  assetPlacements?: { surfaceId?: string }[]; entities?: { surfaceId?: string }[]; spawn?: Vec2;
}
export interface StairSettings {
  id: string; kind?: 'stairs' | 'ramp'; width?: number;
  underpass?: boolean;
  profile?: StairProfile;
  /** Authoring constraint, not a second runtime profile or a request to alter either bank. */
  angle?: 45;
  material?: SurfaceCell['material']; wallMaterial?: SurfaceCell['wallMaterial'];
  wallSkin?: string;
  cells?: readonly SurfaceCell[]; links?: readonly SurfaceLink[]; stairs?: readonly SurfaceStair[];
}
function flightsOverlap(a: SurfaceStair, b: SurfaceStair): boolean {
  const bounds = (stair: SurfaceStair) => {
    const g = stairGeometry(stair), start = g.pointAt(g.landing / g.run), end = g.pointAt(1 - g.landing / g.run);
    return { left: Math.min(start.x, end.x) - Math.abs(g.dy) * stair.width / 2,
      right: Math.max(start.x, end.x) + Math.abs(g.dy) * stair.width / 2,
      top: Math.min(start.y, end.y) - Math.abs(g.dx) * stair.width / 2,
      bottom: Math.max(start.y, end.y) + Math.abs(g.dx) * stair.width / 2 };
  };
  const x = bounds(a), y = bounds(b);
  return Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1e-8
    && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1e-8;
}
export function planStair(from: SurfaceEndpoint, to: SurfaceEndpoint,
  lookup: (x: number, y: number, surfaceId: string) => SurfaceCell | undefined, settings: StairSettings): { stair: SurfaceStair; cells: SurfaceCell[]; links: SurfaceLink[] } {
  const a = lookup(from.x, from.y, from.surfaceId), b = lookup(to.x, to.y, to.surfaceId);
  if (!a || !b || a.blocked || b.blocked || a.kind === 'stairs' || b.kind === 'stairs' || a.material === 'water' || b.material === 'water') throw new Error('Scala: scegli due pianerottoli percorribili.');
  const stair: SurfaceStair = { id: settings.id, kind: settings.kind ?? 'stairs', from: { ...from, elevation: a.elevation }, to: { ...to, elevation: b.elevation },
    width: settings.width ?? TILE_SIZE, ...(settings.profile !== undefined ? { profile: settings.profile } : {}),
    ...(settings.underpass !== undefined ? { underpass: settings.underpass } : {}) };
  validateStairShape(stair);
  const shape = stairGeometry(stair);
  if (settings.angle !== undefined && (settings.angle !== 45 || Math.abs(shape.rise - shape.inclinedRun) > 1e-8))
    throw new Error('Per 45° il dislivello deve essere 3 livelli ogni tile di corsa. Scegli le due quote e gli accessi corrispondenti.');
  if (settings.stairs?.some(s => s.id === stair.id)) throw new Error('Scala: identificativo già usato.');
  if (settings.stairs?.some(s => flightsOverlap(stair, s))) throw new Error('La scala incrocia il tratto inclinato di un’altra scala. Lascia spazio ai pianerottoli.');
  const geometry = stairGeometry(stair), cells: SurfaceCell[] = [];
  if (stair.profile === 'terraced') {
    const issues = terracedStairIssues(stair, lookup);
    if (issues.length) throw new Error(issues[0]);
  }
  for (const lane of stairLanes(stair)) {
    const path = stairPath(stair, lane);
    for (const [p, height] of [[path[0], a.elevation], [path.at(-1)!, b.elevation]] as const) {
      const bank = lookup(p.x, p.y, p.surfaceId);
      if (!bank || bank.blocked || bank.material === 'water' || bank.elevation !== height) throw new Error('Scala: pianerottoli laterali bloccati o a quote diverse.');
    }
    for (const p of path.slice(1, -1)) {
      if (settings.cells?.some(c => c.x === p.x && c.y === p.y && c.kind !== 'ground')) throw new Error('Scala: percorso occupato da un ponte o un’altra scala.');
      const ground = lookup(p.x, p.y, BASE_SURFACE), elevation = Math.round(geometry.elevationAt(geometry.progressAt({ x: (p.x + .5) * TILE_SIZE, y: (p.y + .5) * TILE_SIZE })));
      const t = geometry.progressAt({ x: (p.x + .5) * TILE_SIZE, y: (p.y + .5) * TILE_SIZE });
      const minimum = geometry.elevationAt(Math.max(0, t - TILE_SIZE / geometry.run / 2));
      if (stair.profile !== 'terraced' && ground && ground.elevation > minimum + 1e-8) throw new Error('Scala: il terreno intermedio interseca i gradini; abbassa prima il corridoio.');
      const wallSkin = 'wallSkin' in settings ? settings.wallSkin : a.wallSkin;
      cells.push({ ...p, elevation, material: settings.material ?? a.material, wallMaterial: settings.wallMaterial ?? a.wallMaterial,
        ...(wallSkin !== undefined ? { wallSkin } : {}), kind: 'stairs', blocked: false });
    }
  }
  const links = stairLinks(stair), existing = settings.links ?? [];
  for (const l of links) if (existing.some(e => e.id === l.id || [e.from, e.to].map(p => surfaceKey(p.x, p.y, p.surfaceId)).sort().join('|')
    === [l.from, l.to].map(p => surfaceKey(p.x, p.y, p.surfaceId)).sort().join('|'))) throw new Error('Scala: collegamento già presente.');
  return { stair, cells, links };
}

/** Removes only support and edges owned by this descriptor, preserving both landings and terrain. */
export function removeStair(data: StairData, id: string): boolean {
  const stair = data.surfaceStairs?.find(s => s.id === id); if (!stair) return false;
  const owned = new Set(stairLinks(stair).map(l => l.id)), support = stairSurfaceId(stair);
  data.surfaceStairs = data.surfaceStairs!.filter(s => s.id !== id);
  data.surfaceLinks = data.surfaceLinks?.filter(l => !owned.has(l.id) && l.from.surfaceId !== support && l.to.surfaceId !== support);
  data.surfaceCells = data.surfaceCells?.filter(c => c.surfaceId !== support);
  for (const key of ['placements', 'npcs', 'assetPlacements', 'entities'] as const)
    if (data[key]) data[key] = data[key]!.filter(p => p.surfaceId !== support);
  if (data.spawn?.surfaceId === support) {
    const landing = [stair.from, stair.to].find(p => p.surfaceId === BASE_SURFACE) ?? stair.from;
    data.spawn = { ...landing };
  }
  return true;
}

/** Referential checks need resolved terrain, so they supplement the data-only schema. */
export function stairSpatialIssues(stair: SurfaceStair, lookup: (x: number, y: number, surfaceId: string) => SurfaceCell | undefined): string[] {
  const issues: string[] = [], g = stairGeometry(stair);
  for (const lane of stairLanes(stair)) {
    const path = stairPath(stair, lane);
    for (const [p, height] of [[path[0], stair.from.elevation], [path.at(-1)!, stair.to.elevation]] as const) {
      const bank = lookup(p.x, p.y, p.surfaceId);
      if (!bank || bank.blocked || bank.elevation !== height) issues.push(`Scala ${stair.id}: pianerottolo assente, bloccato o a quota diversa alla casella ${p.x}, ${p.y}.`);
    }
    for (const p of path.slice(1, -1)) {
      const ground = lookup(p.x, p.y, BASE_SURFACE), t = g.progressAt({ x: (p.x + .5) * TILE_SIZE, y: (p.y + .5) * TILE_SIZE });
      const minimum = g.elevationAt(Math.max(0, t - TILE_SIZE / g.run / 2));
      if (stair.profile !== 'terraced' && ground && ground.elevation > minimum + 1e-8) issues.push(`Scala ${stair.id}: gradini intersecati dal terreno alla casella ${p.x}, ${p.y}.`);
    }
  }
  return [...issues, ...(stair.profile === 'terraced' ? terracedStairIssues(stair, lookup) : [])];
}

/** A terrain flight replaces exactly one wall cell per crossed elevation level. */
function terracedStairIssues(stair: SurfaceStair,
  lookup: (x: number, y: number, surfaceId: string) => SurfaceCell | undefined): string[] {
  const issues: string[] = [], g = stairGeometry(stair);
  if (stair.from.surfaceId !== BASE_SURFACE || stair.to.surfaceId !== BASE_SURFACE)
    issues.push(`Scala ${stair.id}: le scale incassate collegano due quote del terreno.`);
  for (const lane of stairLanes(stair)) {
    const path = stairPath(stair, lane), ordered = stair.from.elevation > stair.to.elevation ? path.slice().reverse() : path;
    for (const [point, elevation] of [[ordered[0], g.low.elevation], [ordered.at(-1)!, g.high.elevation]] as const) {
      const bank = lookup(point.x, point.y, BASE_SURFACE) as TerrainSurfaceCell | undefined;
      if ((bank?.elevation ?? 0) !== elevation || bank?.blocked || bank?.terrainRole === 'wall' || bank?.material === 'water')
        issues.push(`Scala ${stair.id}: pianerottolo incassato assente, bloccato o a quota diversa alla casella ${point.x}, ${point.y}.`);
    }
    for (const [index, point] of ordered.slice(1, -1).entries()) {
      const ground = lookup(point.x, point.y, BASE_SURFACE) as TerrainSurfaceCell | undefined;
      if (ground?.layout !== 'terraced' || ground.terrainRole !== 'wall' || ground.elevation !== g.low.elevation + index + 1)
        issues.push(`Scala ${stair.id}: serve una fascia rocciosa consecutiva per ogni quota alla casella ${point.x}, ${point.y}.`);
    }
  }
  return issues;
}

function validateStairShape(stair: SurfaceStair): void {
  const fail = (detail: string): never => { throw new Error(`Scala non valida: ${detail}`); };
  if (!stair || !validSurfaceId(stair.id) || stair.id.length > 108 || !['stairs', 'ramp'].includes(stair.kind)) fail('identificativo o tipo');
  if (stair.underpass !== undefined && typeof stair.underpass !== 'boolean') fail('il passaggio sotto deve essere vero o falso');
  if (stair.profile !== undefined && !['landings', 'incline', 'terraced'].includes(stair.profile)) fail('profilo inclinato, con pianerottoli o incassato');
  for (const p of [stair.from, stair.to]) if (!p || !validSurfaceId(p.surfaceId) || !Number.isSafeInteger(p.x) || !Number.isSafeInteger(p.y)
    || Math.abs(p.x) > 10_000_000 || Math.abs(p.y) > 10_000_000 || !Number.isInteger(p.elevation) || p.elevation < 0 || p.elevation > MAX_ELEVATION) fail('accesso o quota');
  const dx = stair.to.x - stair.from.x, dy = stair.to.y - stair.from.y, length = Math.abs(dx) + Math.abs(dy);
  if (dx && dy || length < 1 || length > 32 || stair.from.elevation === stair.to.elevation) fail('usa 1–32 celle in linea e quote diverse');
  if (!Number.isFinite(stair.width) || stair.width < MIN_STAIR_WIDTH || stair.width > TILE_SIZE * 3) fail('larghezza: 40–144 pixel');
  if (stair.profile === 'terraced') {
    if (stair.underpass) fail('una scala incassata non può avere un passaggio sotto');
    if (length !== Math.abs(stair.to.elevation - stair.from.elevation) + 1)
      fail('la scala incassata richiede una cella per ogni dislivello e due pianerottoli; tra pianerottoli separati usa più scale');
    if (stair.width % TILE_SIZE !== 0) fail('larghezza della scala incassata: una, due o tre celle');
  }
  const g = stairGeometry(stair);
  if (g.dy > 0 && g.run - 2 * g.landing <= g.rise) fail('allunga la scala verso sud o cambia orientamento: a 45° la proiezione verso sud si appiattisce. Deve avanzare lungo tutta la salita');
}

export function validateSurfaceStairs(cells: readonly SurfaceCell[], links: readonly SurfaceLink[], stairs: unknown = []): void {
  if (!Array.isArray(stairs) || stairs.length > 100_000) throw new Error('Scale non valide: budget');
  const ids = new Set<string>(), supports = new Map(cells.map(c => [surfaceKey(c.x, c.y, c.surfaceId), c])), edges = new Map(links.map(l => [l.id, l])), ownedCells = new Set<string>(), ownedEdges = new Set<string>();
  const terraces = deriveTerracedTerrain(cells);
  for (const stair of stairs as SurfaceStair[]) {
    validateStairShape(stair);
    if (ids.has(stair.id)) throw new Error('Scale non valide: identificativi duplicati'); ids.add(stair.id);
    const g = stairGeometry(stair);
    if (stair.profile === 'terraced') {
      const issues = terracedStairIssues(stair, (x, y, id) => id === BASE_SURFACE
        ? terraces.get(`${x},${y}`) ?? supports.get(surfaceKey(x, y, id))
        : supports.get(surfaceKey(x, y, id)));
      if (issues.length) throw new Error(issues[0]);
    }
    for (const lane of stairLanes(stair)) {
      const path = stairPath(stair, lane);
      for (const [endpoint, height] of [[path[0], stair.from.elevation], [path.at(-1)!, stair.to.elevation]] as const) {
        const cell = supports.get(surfaceKey(endpoint.x, endpoint.y, endpoint.surfaceId));
        if ((cell?.elevation ?? (endpoint.surfaceId === BASE_SURFACE ? 0 : undefined)) !== height || cell?.kind === 'stairs') throw new Error('Scala non valida: quota o accesso non corrispondente');
      }
      for (const p of path.slice(1, -1)) {
        const cell = supports.get(surfaceKey(p.x, p.y, p.surfaceId));
        ownedCells.add(surfaceKey(p.x, p.y, p.surfaceId));
        const elevation = Math.round(g.elevationAt(g.progressAt({ x: (p.x + .5) * TILE_SIZE, y: (p.y + .5) * TILE_SIZE })));
        if (!cell || cell.kind !== 'stairs' || cell.elevation !== elevation || cell.blocked) throw new Error('Scala non valida: supporto intermedio assente o incoerente');
      }
    }
    for (const expected of stairLinks(stair)) {
      ownedEdges.add(expected.id);
      const actual = edges.get(expected.id);
      if (!actual || actual.kind !== expected.kind || ![0, 1].every(i => { const a = i ? actual.to : actual.from, b = i ? expected.to : expected.from; return surfaceKey(a.x, a.y, a.surfaceId) === surfaceKey(b.x, b.y, b.surfaceId); })) throw new Error('Scala non valida: collegamenti intermedi assenti o incoerenti');
    }
  }
  for (const c of cells) if (c.kind === 'stairs' && !ownedCells.has(surfaceKey(c.x, c.y, c.surfaceId))) throw new Error('Scala non valida: supporto senza struttura');
  for (const l of links) if ((supports.get(surfaceKey(l.from.x, l.from.y, l.from.surfaceId))?.kind === 'stairs'
    || supports.get(surfaceKey(l.to.x, l.to.y, l.to.surfaceId))?.kind === 'stairs') && !ownedEdges.has(l.id)) throw new Error('Scala non valida: collegamento estraneo alla struttura');
}
