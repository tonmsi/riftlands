import { coordinateHash } from './coordinate-random';
import type { TileKind, Vec2 } from './types';
import type { WorldBrush } from './world-editing';
import type { TerrainElevationBrush } from './terrain-elevation-editing';

const smooth = (t: number): number => t * t * (3 - 2 * t);
function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), u = smooth(x - ix), v = smooth(y - iy);
  const a = coordinateHash(ix, iy, seed), b = coordinateHash(ix + 1, iy, seed);
  const c = coordinateHash(ix, iy + 1, seed), d = coordinateHash(ix + 1, iy + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

/** Coordinate-only terraces: strokes join consistently regardless of order or brush radius. */
export function proceduralTerrainAt(x: number, y: number, seed: number, temperature: number, moisture: number): { terrain: TileKind; elevation: number } {
  const height = noise(x / 48, y / 48, seed + 1709) * .8 + noise(x / 18, y / 18, seed + 1721) * .2;
  const elevation = Math.max(-1, Math.min(4, Math.floor(height * 6) - 1));
  const terrain: TileKind = elevation === -1 ? 'water' : temperature < .28 ? 'snow' : moisture > .72 && elevation === 0 ? 'mud' : 'grass';
  return { terrain, elevation };
}

/** Store real surfaces and supporting mass, together with the authored tile material. */
export function paintProceduralTerrain(point: Vec2, seed: number, temperature: number, moisture: number, tiles: WorldBrush, heights: TerrainElevationBrush): void {
  const { terrain, elevation } = proceduralTerrainAt(point.x, point.y, seed, temperature, moisture);
  // Clear old painted mass before replacing it, so repainting is independent of history.
  heights.paint(point, undefined, -1, -1);
  heights.paint(point, terrain, elevation, -1);
  tiles.tile(point, { terrain, suppressAssets: true });
}
