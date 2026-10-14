import { TILE_SIZE } from '../../shared/config';
import type { SurfaceCell } from '../../shared/world-surfaces';
import { noise } from './render-primitives';

export interface ContourPoint { x: number; y: number; }
export type ContourEdge = 'north' | 'east' | 'south' | 'west';
export interface SurfaceContour {
  /** Clockwise local outline. Internal tile joints retain the full tile footprint. */
  outline: ContourPoint[];
  edges: Record<ContourEdge, ContourPoint[]>;
  corners: ContourPoint[][];
  exposed: Record<ContourEdge, boolean>;
  southFace: ContourPoint[];
  inlets: { outline: ContourPoint[]; rim: ContourPoint[]; lowerElevation: number }[];
}
type Neighbor = (dx: number, dy: number) => SurfaceCell | undefined;
const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const edgeNames = ['north', 'east', 'south', 'west'] as const;
const cornerDirections = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;

/** Masonry retains its deliberately straight silhouette; natural ground keeps the grid only for movement. */
export function hasNaturalContour(cell: SurfaceCell): boolean {
  return cell.kind === 'ground' && cell.elevation > 0 && (cell.wallMaterial === 'earth' || cell.wallMaterial === 'rock');
}

/** Smooth, small deviations share their samples across tile/chunk boundaries. */
export function naturalEdgeInset(worldX: number, worldY: number, horizontal: boolean): number {
  const along = horizontal ? worldX : worldY, across = horizontal ? worldY : worldX;
  const step = 12, index = Math.floor(along / step), t = along / step - index;
  const blend = t * t * (3 - 2 * t), salt = horizontal ? 431 : 449;
  return .7 + 1.8 * (noise(index, Math.round(across), salt) * (1 - blend) + noise(index + 1, Math.round(across), salt) * blend);
}

function quadratic(a: ContourPoint, control: ContourPoint, b: ContourPoint): ContourPoint[] {
  return Array.from({ length: 5 }, (_, i) => {
    const t = i / 4, u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * control.y + t * t * b.y };
  });
}

export function surfaceContour(cell: SurfaceCell, neighbor: Neighbor): SurfaceContour | undefined {
  if (!hasNaturalContour(cell)) return undefined;
  const exposed = directions.map(([dx, dy]) => (neighbor(dx, dy)?.elevation ?? 0) < cell.elevation);
  const radii = cornerDirections.map(([dx, dy], corner) => {
    const a = corner === 0 || corner === 1 ? 0 : 2, b = corner === 0 || corner === 3 ? 3 : 1;
    // A diagonal at this height must remain joined at the shared vertex.
    if (!exposed[a] || !exposed[b] || (neighbor(dx, dy)?.elevation ?? 0) >= cell.elevation) return 0;
    const vx = cell.x + (dx > 0 ? 1 : 0), vy = cell.y + (dy > 0 ? 1 : 0);
    return 8 + noise(vx, vy, 467) * 3;
  });
  const [nw, ne, se, sw] = radii, size = TILE_SIZE;
  // Edges travel clockwise, so their adjoining corner endpoints agree exactly.
  const endpoints = [
    [{ x: nw, y: 0 }, { x: size - ne, y: 0 }],
    [{ x: size, y: ne }, { x: size, y: size - se }],
    [{ x: size - se, y: size }, { x: sw, y: size }],
    [{ x: 0, y: size - sw }, { x: 0, y: nw }],
  ];
  const edges = {} as Record<ContourEdge, ContourPoint[]>;
  for (let edge = 0; edge < 4; edge++) {
    const [a, b] = endpoints[edge], [nx, ny] = directions[edge], horizontal = ny !== 0;
    const length = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(length / 6));
    const alongX = horizontal ? 1 : 0, alongY = horizontal ? 0 : 1;
    const continues = (sign: number) => {
      const next = neighbor(alongX * sign, alongY * sign);
      const beyond = neighbor(nx + alongX * sign, ny + alongY * sign);
      return next && hasNaturalContour(next) && next.elevation === cell.elevation
        && (beyond?.elevation ?? 0) < cell.elevation;
    };
    const forward = edge === 0 || edge === 1;
    const startContinues = continues(forward ? -1 : 1), endContinues = continues(forward ? 1 : -1);
    edges[edgeNames[edge]] = Array.from({ length: steps + 1 }, (_, i) => {
      const t = i / steps, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      const taper = Math.min(1, startContinues ? 1 : t * length / 8, endContinues ? 1 : (1 - t) * length / 8);
      const inset = exposed[edge] ? naturalEdgeInset(cell.x * size + x, cell.y * size + y, horizontal) * taper : 0;
      return { x: x - nx * inset, y: y - ny * inset };
    });
  }
  // An exposed boundary can continue across an internal tile joint. Move both
  // incident endpoints to that same wave sample instead of leaving a square spike.
  for (let corner = 0; corner < 4; corner++) {
    if (radii[corner]) continue;
    const previous = edges[edgeNames[(corner + 3) % 4]], next = edges[edgeNames[corner]];
    const horizontal = corner === 0 || corner === 2 ? next[0] : previous[previous.length - 1];
    const vertical = corner === 0 || corner === 2 ? previous[previous.length - 1] : next[0];
    const joint = { x: vertical.x, y: horizontal.y };
    previous[previous.length - 1] = joint; next[0] = joint;
  }
  const corners = [
    quadratic(endpoints[3][1], { x: 0, y: 0 }, endpoints[0][0]),
    quadratic(endpoints[0][1], { x: size, y: 0 }, endpoints[1][0]),
    quadratic(endpoints[1][1], { x: size, y: size }, endpoints[2][0]),
    quadratic(endpoints[2][1], { x: 0, y: size }, endpoints[3][0]),
  ].map((points, i) => radii[i] ? points : []);
  const outline: ContourPoint[] = [];
  for (let edge = 0; edge < 4; edge++) {
    outline.push(...edges[edgeNames[edge]]);
    outline.push(...corners[(edge + 1) % 4].slice(1));
  }
  const southFace = [...corners[3].slice().reverse(), ...edges.south.slice().reverse(), ...corners[2].slice().reverse()]
    .filter((point, i, all) => !i || point.x !== all[i - 1].x || point.y !== all[i - 1].y);
  const inlets: SurfaceContour['inlets'] = [];
  for (let corner = 0; corner < 4; corner++) {
    const [dx, dy] = cornerDirections[corner], a = neighbor(dx, 0), b = neighbor(0, dy), diagonal = neighbor(dx, dy);
    if (!a || !b || !hasNaturalContour(a) || !hasNaturalContour(b) || a.elevation !== cell.elevation
      || b.elevation !== cell.elevation || (diagonal?.elevation ?? 0) >= cell.elevation) continue;
    const vertex = { x: dx > 0 ? size : 0, y: dy > 0 ? size : 0 }, radius = 9;
    const rim = quadratic({ x: vertex.x + dx * radius, y: vertex.y }, vertex,
      { x: vertex.x, y: vertex.y + dy * radius });
    inlets.push({ outline: [vertex, ...rim], rim, lowerElevation: diagonal?.elevation ?? 0 });
  }
  return { outline, edges, corners, exposed: Object.fromEntries(edgeNames.map((name, i) => [name, exposed[i]])) as SurfaceContour['exposed'], southFace, inlets };
}

export function traceContour(ctx: CanvasRenderingContext2D, points: readonly ContourPoint[], x: number, y: number, close = false): void {
  ctx.beginPath();
  points.forEach((point, i) => i ? ctx.lineTo(x + point.x, y + point.y) : ctx.moveTo(x + point.x, y + point.y));
  if (close) ctx.closePath();
}
