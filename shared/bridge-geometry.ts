import type { SurfaceCell, SurfaceEndpoint } from './world-surfaces';

export type BridgeEdgeDirection = 'north' | 'east' | 'south' | 'west';
export interface BridgePoint { x: number; y: number; }
export interface BridgeEdge {
  cell: SurfaceCell; direction: BridgeEdgeDirection; a: BridgePoint; b: BridgePoint;
  /** The footprint remains intact, while a physical access opens its parapet. */
  entrance: boolean;
}
export interface BridgeCorner {
  point: BridgePoint; surfaceId: string; elevation: number;
  kind: 'convex' | 'concave' | 'diagonal';
}
export interface BridgeGeometry { cells: SurfaceCell[]; edges: BridgeEdge[]; corners: BridgeCorner[]; }
const sides = [
  { direction: 'north', dx: 0, dy: -1, a: [0, 0], b: [1, 0] },
  { direction: 'east', dx: 1, dy: 0, a: [1, 0], b: [1, 1] },
  { direction: 'south', dx: 0, dy: 1, a: [1, 1], b: [0, 1] },
  { direction: 'west', dx: -1, dy: 0, a: [0, 1], b: [0, 0] },
] as const;

/** The union of complete deck cells is shared by drawing, selection and movement. */
export function bridgeGeometry(cells: readonly SurfaceCell[],
  lookup?: (x: number, y: number, surfaceId: string) => SurfaceCell | undefined,
  exits: (cell: SurfaceCell) => readonly SurfaceEndpoint[] = () => []): BridgeGeometry {
  const deck = cells.filter(cell => cell.kind === 'bridge');
  const byKey = new Map(deck.map(cell => [`${cell.x},${cell.y}@${cell.surfaceId}`, cell]));
  const at = (x: number, y: number, id: string) => lookup?.(x, y, id) ?? byKey.get(`${x},${y}@${id}`);
  const joined = (x: number, y: number, cell: SurfaceCell) => {
    const neighbor = at(x, y, cell.surfaceId);
    return neighbor?.kind === 'bridge' && neighbor.elevation === cell.elevation;
  };
  const edges: BridgeEdge[] = [], vertices = new Map<string, { point: BridgePoint; cell: SurfaceCell }>();
  for (const cell of deck) for (const side of sides) {
    if (joined(cell.x + side.dx, cell.y + side.dy, cell)) continue;
    const a = { x: cell.x + side.a[0], y: cell.y + side.a[1] };
    const b = { x: cell.x + side.b[0], y: cell.y + side.b[1] };
    const entrance = exits(cell).some(exit => {
      if (exit.x !== cell.x + side.dx || exit.y !== cell.y + side.dy) return false;
      const target = at(exit.x, exit.y, exit.surfaceId);
      // The renderer must not open a railing for an unrelated stair to a lower plane.
      return !!target && target.elevation === cell.elevation && !target.blocked;
    });
    edges.push({ cell, direction: side.direction, a, b, entrance });
    for (const point of [a, b]) vertices.set(`${point.x},${point.y}@${cell.surfaceId}:${cell.elevation}`, { point, cell });
  }
  const corners: BridgeCorner[] = [];
  for (const { point, cell } of vertices.values()) {
    const quadrants = [[-1, -1], [0, -1], [0, 0], [-1, 0]].map(([dx, dy]) => joined(point.x + dx, point.y + dy, cell));
    const count = quadrants.filter(Boolean).length;
    const kind = count === 1 ? 'convex' : count === 3 ? 'concave'
      : count === 2 && quadrants[0] === quadrants[2] ? 'diagonal' : undefined;
    if (kind) corners.push({ point, surfaceId: cell.surfaceId, elevation: cell.elevation, kind });
  }
  return { cells: deck, edges, corners };
}
