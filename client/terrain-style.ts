import type { TileKind } from '../shared/types';

/** Quiet scenery leaves the brightest colours to actors, pickups and spells. */
export const TERRAIN: Record<TileKind, string> = {
  grass: '#91ad69', path: '#cfb47e', water: '#45a0ad',
  rock: '#8fa2ba', bush: '#559b55', mud: '#a09c72',
};

export function groundColor(moisture: number): string {
  const from = moisture < .51 ? [145, 173, 105] : [130, 162, 96];
  const to = moisture < .51 ? [130, 162, 96] : [140, 164, 116];
  const t = Math.max(0, Math.min(1, (moisture - (moisture < .51 ? .27 : .51)) / .24));
  const blend = t * t * (3 - 2 * t);
  return `rgb(${from.map((value, i) => Math.round(value + (to[i] - value) * blend)).join(',')})`;
}

/** N/E/S/W followed by NE/SE/SW/NW; query neighbours across chunk boundaries. */
export function shorelineMask(getTile: (x: number, y: number) => TileKind, tx: number, ty: number): number {
  return [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]
    .reduce((mask, [dx, dy], index) => mask | (getTile(tx + dx, ty + dy) !== 'water' ? 1 << index : 0), 0);
}

export interface SceneryGroup { x: number; y: number; width: number; height: number; tile: TileKind }

/** Four reads per fixed 2x2 block, including in infinite obstacle regions. */
export function sceneryGroups(getTile: (x: number, y: number) => TileKind, tx: number, ty: number): SceneryGroup[] {
  const x = Math.floor(tx / 2) * 2, y = Math.floor(ty / 2) * 2;
  const tiles = [getTile(x, y), getTile(x + 1, y), getTile(x, y + 1), getTile(x + 1, y + 1)];
  const obstacle = (tile: TileKind) => tile === 'rock' || tile === 'bush';
  if (obstacle(tiles[0]) && tiles.every(tile => tile === tiles[0])) {
    return [{ x, y, width: 2, height: 2, tile: tiles[0] }];
  }
  return tiles.flatMap((tile, i) => obstacle(tile)
    ? [{ x: x + i % 2, y: y + Math.floor(i / 2), width: 1, height: 1, tile }] : []);
}

/** The same discrete foliage greens are used in the scenery atlas and minimap. */
export function bushColor(variation: number): string {
  return ['#559b55', '#68984f', '#4a9367'][Math.min(2, Math.floor(variation * 3))];
}

export function mapTerrainColor(tile: TileKind, moisture: number, variation: number): string {
  return tile === 'grass' ? groundColor(moisture) : tile === 'bush' ? bushColor(variation) : TERRAIN[tile];
}
