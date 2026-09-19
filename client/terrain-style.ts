import type { TileKind } from '../shared/types';

/** Quiet scenery leaves the brightest colours to actors, pickups and spells. */
export const TERRAIN: Record<TileKind, string> = {
  grass: '#81916b', path: '#b6a382', water: '#527f89',
  rock: '#899497', bush: '#557b57', mud: '#8a8a70',
};

export function groundColor(moisture: number): string {
  const from = moisture < .51 ? [129, 145, 107] : [116, 133, 101];
  const to = moisture < .51 ? [116, 133, 101] : [122, 140, 118];
  const t = Math.max(0, Math.min(1, (moisture - (moisture < .51 ? .27 : .51)) / .24));
  const blend = t * t * (3 - 2 * t);
  return `rgb(${from.map((value, i) => Math.round(value + (to[i] - value) * blend)).join(',')})`;
}

/** N/E/S/W followed by NE/SE/SW/NW; query neighbours across chunk boundaries. */
export function shorelineMask(getTile: (x: number, y: number) => TileKind, tx: number, ty: number): number {
  return [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]
    .reduce((mask, [dx, dy], index) => mask | (getTile(tx + dx, ty + dy) !== 'water' ? 1 << index : 0), 0);
}
