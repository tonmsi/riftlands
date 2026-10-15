import { TILE_SIZE } from '../../shared/config';
import type { Vec2 } from '../../shared/types';
import type { WorldDocument } from '../../shared/world-schema';
import { removeStair, type StairData } from '../../shared/surface-stairs';
import {
  BASE_SURFACE, ELEVATION_STEP, MAX_ELEVATION, surfaceKey, validSurfaceId,
  type SurfaceCell, type SurfaceLink, type SurfaceMaterial, type TerrainSurfaceCell, type WallMaterial,
} from '../../shared/world-surfaces';

/** Map a projected top face back to its logical tile, including the selected plane. */
export function pickSurfacePoint(x: number, y: number,
  surfacesAt: (tx: number, ty: number) => readonly TerrainSurfaceCell[], surfaceId?: string, includeWalls = false): Vec2 {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Scegli un punto della mappa.');
  const tx = Math.floor(x), start = Math.floor(y), last = Math.floor(y + MAX_ELEVATION * ELEVATION_STEP / TILE_SIZE);
  let picked: TerrainSurfaceCell | undefined;
  for (let ty = start; ty <= last; ty++) {
    for (const surface of surfacesAt(tx, ty)) {
      if (surfaceId !== undefined && surface.surfaceId !== surfaceId) continue;
      if (surface.terrainRole === 'wall' && !includeWalls) continue;
      const top = ty - surface.elevation * ELEVATION_STEP / TILE_SIZE;
      if (y < top || y >= top + 1) continue;
      if (!picked || surface.elevation > picked.elevation || surface.elevation === picked.elevation
        && (surface.y > picked.y || surface.y === picked.y && surface.kind === 'bridge' && picked.kind !== 'bridge')) picked = surface;
    }
  }
  return picked ? { x: picked.x, y: picked.y, surfaceId: picked.surfaceId, elevation: picked.terrainRole === 'wall' ? picked.logicalElevation ?? picked.elevation : picked.elevation }
    : { x: tx, y: start, surfaceId: BASE_SURFACE, elevation: 0 };
}

export type BridgeRoute = 'straight' | 'horizontal-first' | 'vertical-first';
export interface BridgePlanSettings {
  material: SurfaceMaterial; wallMaterial: WallMaterial; wallSkin?: string; id?: string;
  widthTiles?: 1 | 2 | 3; route?: BridgeRoute;
  /** A full column query catches overlapping decks which the selected-plane lookup cannot see. */
  existingAt?: (x: number, y: number) => readonly SurfaceCell[];
  /** Explicitly extend the supplied id instead of creating an independent overlapping deck. */
  extendExisting?: boolean;
}
export interface BridgePlan { cells: SurfaceCell[]; links: SurfaceLink[]; }
/** The editor's undo transaction removes an entire deck and its owned content, preserving the ground. */
export function removeBridge(data: StairData, id: string): boolean {
  if (id === BASE_SURFACE || !data.surfaceCells?.some(c => c.kind === 'bridge' && c.surfaceId === id)) return false;
  const landing = data.surfaceLinks?.flatMap(link => link.from.surfaceId === id ? [link.to] : link.to.surfaceId === id ? [link.from] : [])
    .find(point => point.surfaceId === BASE_SURFACE);
  for (const stair of [...data.surfaceStairs ?? []]) if ([stair.from, stair.to].some(p => p.surfaceId === id)) removeStair(data, stair.id);
  data.surfaceCells = data.surfaceCells.filter(c => c.surfaceId !== id);
  data.surfaceLinks = data.surfaceLinks?.filter(link => link.from.surfaceId !== id && link.to.surfaceId !== id);
  for (const key of ['placements', 'npcs', 'assetPlacements', 'entities'] as const)
    if (data[key]) data[key] = data[key]!.filter(p => p.surfaceId !== id);
  if (data.spawn?.surfaceId === id) {
    const point = landing ?? { x: data.spawn.x, y: data.spawn.y, surfaceId: BASE_SURFACE };
    data.spawn = { ...point, elevation: data.surfaceCells.find(c => c.x === point.x && c.y === point.y && c.surfaceId === point.surfaceId)?.elevation ?? 0 };
  }
  return true;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

function bridgeId(from: SurfaceCell, to: SurfaceCell): string {
  const endpoints = [surfaceKey(from.x, from.y, from.surfaceId), surfaceKey(to.x, to.y, to.surfaceId)].sort();
  return `bridge-${stableHash(`${endpoints.join('|')}@${from.elevation}`)}`;
}

/** Build a complete bridge transaction without replacing either bank or anything underneath. */
export function planBridge(from: Vec2, to: Vec2, lookup: (point: Vec2) => SurfaceCell | undefined,
  settings: BridgePlanSettings): BridgePlan {
  const route = settings.route ?? 'straight';
  if (!['straight', 'horizontal-first', 'vertical-first'].includes(route)) throw new Error('Scegli un percorso del ponte valido.');
  const bends = from.x !== to.x && from.y !== to.y && route !== 'straight'
    ? [route === 'horizontal-first' ? { x: to.x, y: from.y } : { x: from.x, y: to.y }] : [];
  return planBridgeRoute(from, bends, to, lookup, settings);
}

/** A continuous orthogonal route, widened before validating its whole footprint. */
export function planBridgeRoute(from: Vec2, waypoints: readonly Vec2[], to: Vec2,
  lookup: (point: Vec2) => SurfaceCell | undefined, settings: BridgePlanSettings): BridgePlan {
  const route = [from, ...waypoints, to], width = settings.widthTiles ?? 1;
  if (route.length > 18 || route.some(point => ![point.x, point.y].every(Number.isSafeInteger))) throw new Error('Scegli due celle della mappa come sponde del ponte.');
  if (![1, 2, 3].includes(width)) throw new Error('La larghezza del ponte deve essere di una, due o tre celle.');
  let distance = 0;
  for (let i = 1; i < route.length; i++) {
    const dx = route[i].x - route[i - 1].x, dy = route[i].y - route[i - 1].y;
    if (dx && dy) throw new Error('Allinea le due sponde in orizzontale o in verticale.');
    if (!dx && !dy) throw new Error('I segmenti del ponte devono avere una lunghezza positiva.');
    distance += Math.abs(dx) + Math.abs(dy);
  }
  if (distance < 2) throw new Error('Lascia almeno una cella tra le due sponde del ponte.');
  if (distance > 96) throw new Error('Il ponte può collegare sponde distanti al massimo 96 celle.');
  if (from.x === to.x && from.y === to.y) throw new Error('Scegli due sponde distinte per il ponte.');
  const start = lookup({ ...from, surfaceId: from.surfaceId ?? BASE_SURFACE });
  const end = lookup({ ...to, surfaceId: to.surfaceId ?? BASE_SURFACE });
  if (!start || !end || start.blocked || end.blocked || start.material === 'water' || end.material === 'water') {
    throw new Error('Scegli due sponde percorribili sulla terraferma.');
  }
  if (start.elevation !== end.elevation) throw new Error('Le sponde devono avere la stessa quota. Alza o abbassa il terreno prima di collegarle.');
  if (!Number.isInteger(start.elevation) || start.elevation < 0 || start.elevation > MAX_ELEVATION) throw new Error('La quota delle sponde deve essere compresa tra 0 e 16.');
  if (settings.material === 'water') throw new Error('Scegli un materiale percorribile per il ponte.');
  const routeKey = [route.map(p => `${p.x},${p.y}`).join('|'), [...route].reverse().map(p => `${p.x},${p.y}`).join('|')].sort()[0];
  const id = settings.id ?? (width === 1 && route.length === 2 ? bridgeId(start, end)
    : `bridge-${stableHash(`${routeKey}@${start.elevation}:width-${width}`)}`);
  if (!validSurfaceId(id) || id === BASE_SURFACE) throw new Error('Il ponte deve avere un identificatore valido diverso da ground.');
  if (settings.extendExisting && !settings.id) throw new Error('Scegli il ponte da estendere.');
  const offsets = width === 3 ? [-1, 0, 1] : width === 2 ? [0, 1] : [0];
  const first = { dx: Math.sign(route[1].x - from.x), dy: Math.sign(route[1].y - from.y) };
  const last = { dx: Math.sign(to.x - route[route.length - 2].x), dy: Math.sign(to.y - route[route.length - 2].y) };
  const bankLanes = (point: Vec2, direction: { dx: number; dy: number }) => offsets.map(offset => ({
    x: point.x + (direction.dy ? offset : 0), y: point.y + (direction.dx ? offset : 0), surfaceId: point.surfaceId ?? BASE_SURFACE,
  }));
  const startBanks = bankLanes(from, first), endBanks = bankLanes(to, last);
  const banks = new Set([...startBanks, ...endBanks].map(point => `${point.x},${point.y}`));
  const footprint = new Map<string, { x: number; y: number }>();
  const put = (x: number, y: number) => { if (!banks.has(`${x},${y}`)) footprint.set(`${x},${y}`, { x, y }); };
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
    for (let step = 0; step <= Math.abs(b.x - a.x) + Math.abs(b.y - a.y); step++) for (const offset of offsets) {
      put(a.x + dx * step + (dy ? offset : 0), a.y + dy * step + (dx ? offset : 0));
    }
    // The square at a bend joins every lane without pinholes or a disconnected outside lane.
    if (i < route.length - 1) for (const ox of offsets) for (const oy of offsets) put(b.x + ox, b.y + oy);
  }
  const resolveBanks = (points: typeof startBanks) => points.map(point => {
    const bank = lookup(point);
    if (!bank || bank.blocked || bank.material === 'water') throw new Error('Tutte le corsie richiedono sponde percorribili sulla terraferma.');
    if (bank.elevation !== start.elevation) throw new Error('Tutte le corsie delle sponde devono avere la stessa quota.');
    return bank;
  });
  const starts = resolveBanks(startBanks), ends = resolveBanks(endBanks);
  const cells: SurfaceCell[] = [];
  for (const { x, y } of footprint.values()) {
    const existing = settings.existingAt?.(x, y).filter(cell => cell.kind === 'bridge')
      ?? [lookup({ x, y, surfaceId: id })].filter((cell): cell is SurfaceCell => !!cell && cell.kind === 'bridge');
    if (existing.some(cell => cell.surfaceId !== id || !settings.extendExisting)) throw new Error('Il percorso attraversa un ponte esistente. Scegli un altro percorso oppure estendi esplicitamente quel ponte.');
    if (existing.some(cell => cell.elevation !== start.elevation || cell.blocked)) throw new Error('Il ponte da estendere deve essere percorribile e alla stessa quota.');
    if (existing.length) continue;
    const ground = lookup({ x, y, surfaceId: BASE_SURFACE });
    if (ground && ground.elevation >= start.elevation && !(ground.elevation === start.elevation && ground.material === 'water')) {
      throw new Error('Il percorso attraversa terreno alla quota del ponte o più alto. Alza le due sponde oppure scegli un altro percorso.');
    }
    cells.push({ x, y, surfaceId: id, elevation: start.elevation, material: settings.material, wallMaterial: settings.wallMaterial,
      ...(settings.wallSkin !== undefined ? { wallSkin: settings.wallSkin } : {}), kind: 'bridge' });
  }
  const endpoint = (cell: SurfaceCell): SurfaceLink['from'] => ({ x: cell.x, y: cell.y, surfaceId: cell.surfaceId });
  const entryId = id.length <= 112 ? id : `bridge-${stableHash(id)}`;
  const links: SurfaceLink[] = [];
  const entries = (bankCells: SurfaceCell[], direction: { dx: number; dy: number }, name: 'start' | 'end') => {
    for (const [lane, bank] of bankCells.entries()) {
      const sign = name === 'start' ? 1 : -1, x = bank.x + sign * direction.dx, y = bank.y + sign * direction.dy;
      if (!footprint.has(`${x},${y}`)) throw new Error('Il percorso è troppo corto per collegare tutte le corsie delle sponde.');
      if (bank.surfaceId === id) continue; // Same-plane cells already connect without an artificial access.
      const deck = { x, y, surfaceId: id };
      const suffix = settings.extendExisting ? `entry-${stableHash(`${bank.x},${bank.y}@${bank.surfaceId}|${x},${y}`)}`
        : `entry-${name}${width > 1 ? `-${lane}` : ''}`;
      links.push({ id: `${entryId}:${suffix}`, kind: 'bridge-entry',
        from: name === 'start' ? endpoint(bank) : deck, to: name === 'start' ? deck : endpoint(bank) });
    }
  };
  entries(starts, first, 'start'); entries(ends, last, 'end');
  return { cells, links };
}

/** A new access replaces the same undirected edge, even if the user clicks it backwards. */
export function upsertSurfaceLinks(data: { surfaceLinks?: SurfaceLink[] }, links: readonly SurfaceLink[]): void {
  const byEdge = new Map<string, SurfaceLink>();
  for (const link of [...data.surfaceLinks ?? [], ...links]) {
    const key = [surfaceKey(link.from.x, link.from.y, link.from.surfaceId), surfaceKey(link.to.x, link.to.y, link.to.surfaceId)].sort().join('|');
    byEdge.set(key, link);
  }
  data.surfaceLinks = [...byEdge.values()];
}

/** Keep doors and keys anchored to sculpted ground, including both directional copies of a door. */
export function syncGroundWarpElevations(project: WorldDocument, mapId: string,
  lookup: (point: Vec2) => SurfaceCell | undefined): void {
  const sync = (point: Vec2) => {
    if ((point.surfaceId ?? BASE_SURFACE) !== BASE_SURFACE) return;
    const surface = lookup({ ...point, surfaceId: BASE_SURFACE });
    if (!surface) return;
    if (surface.elevation) point.elevation = surface.elevation; else delete point.elevation;
  };
  for (const warp of project.warps ?? []) {
    if (warp.from === mapId) sync(warp.entry);
    if (warp.to === mapId) sync(warp.arrival);
    if (warp.keyGate?.mapId === mapId) sync(warp.keyGate.position);
  }
}
